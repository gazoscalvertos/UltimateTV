import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lastProblem, libraryItem, signInOf, Spotify, toState, withSignIn } from "../src/spotify.js";

const status = {
  username: "gary",
  device_name: "UltimateTV",
  context_uri: "spotify:playlist:abc",
  context_name: "Friday Night",
  stopped: false,
  paused: false,
  buffering: false,
  volume: 35,
  volume_steps: 100,
  repeat_context: true,
  repeat_track: false,
  shuffle_context: true,
  track: { uri: "spotify:track:1", name: "Song", artist_names: ["A", "B"], album_name: "Album", album_cover_url: "https://i.scdn.co/x", position: 61000, duration: 200000 },
};

describe("Spotify receiver status", () => {
  it("reads what's playing", () => {
    const s = toState(status, 1000);
    expect(s).toMatchObject({ available: true, signedIn: true, status: "playing", positionMs: 61000, at: 1000, volume: 35, shuffle: true, repeat: "all", username: "gary" });
    expect(s.track).toEqual({ uri: "spotify:track:1", name: "Song", artists: ["A", "B"], album: "Album", cover: "https://i.scdn.co/x", durationMs: 200000 });
    expect(s.context).toEqual({ uri: "spotify:playlist:abc", name: "Friday Night" });
  });

  it("knows paused, repeat one and nothing playing", () => {
    expect(toState({ ...status, paused: true, repeat_track: true }, 0)).toMatchObject({ status: "paused", repeat: "one" });
    expect(toState({ ...status, stopped: true, track: null }, 0)).toMatchObject({ status: "stopped" });
    expect(toState({ ...status, volume: 64, volume_steps: 64 }, 0).volume).toBe(100);
  });

  it("turns library entries into cards", () => {
    expect(libraryItem("playlists", { uri: "spotify:playlist:1", name: "Mix", length: 1, owner_username: "spotify", image_url: "https://x" })).toEqual({ uri: "spotify:playlist:1", kind: "playlist", name: "Mix", subtitle: "1 song · Spotify", image: "https://x" });
    expect(libraryItem("albums", { uri: "spotify:album:1", name: "LP", artist_names: ["Band"], year: 2024, image_url: null })).toEqual({ uri: "spotify:album:1", kind: "album", name: "LP", subtitle: "Band · 2024" });
    expect(libraryItem("artists", { uri: "spotify:artist:1", name: "Band" })).toEqual({ uri: "spotify:artist:1", kind: "artist", name: "Band" });
  });
});

describe("Spotify receiver config", () => {
  const template = readFileSync(path.join(__dirname, "../../tools/box/files/go-librespot.yml"), "utf8");

  it("signs in from a phone out of the box", () => {
    expect(signInOf(template)).toBe("phone");
    expect(template).toMatch(/^zeroconf_enabled: true$/m);
  });

  it("switches between phone and code and back, keeping the rest", () => {
    const code = withSignIn(template, "code");
    expect(signInOf(code)).toBe("code");
    expect(code).toMatch(/^credentials:\n  type: device_auth\n/m);
    expect(code).toMatch(/^zeroconf_enabled: false$/m);
    expect(code).toContain("port: 3678");
    expect(code).toContain("device_name: UltimateTV");
    const back = withSignIn(code, "phone");
    expect(signInOf(back)).toBe("phone");
    expect(back).toContain("persist_credentials: true");
    expect(withSignIn(back, "phone")).toBe(back);
  });

  it("reads the old config's code sign-in", () => {
    expect(signInOf("zeroconf_enabled: true\ncredentials:\n  type: device_auth\nserver:\n  enabled: true\n")).toBe("code");
  });

  it("picks the receiver's complaint out of its log", () => {
    const log = 'level=info msg="running go-librespot 0.0.0"\nlevel=error msg="failed creating app" error="failed initializing audio output: pulse: connection refused"\n';
    expect(lastProblem(log)).toBe("failed creating app: failed initializing audio output: pulse: connection refused");
    expect(lastProblem("")).toBeUndefined();
  });
});

describe("Spotify receiver API", () => {
  afterEach(() => vi.unstubAllGlobals());

  const fake = (responses: Record<string, () => Response>) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const path = url.replace("http://box", "");
      calls.push(`${init?.method ?? "GET"} ${path}${init?.body ? ` ${String(init.body)}` : ""}`);
      const r = responses[path.split("?")[0]!];
      return r ? r() : new Response(null, { status: 404 });
    });
    return calls;
  };

  it("shows the sign-in code while nobody is signed in", async () => {
    fake({ "/status": () => new Response(null, { status: 204 }), "/auth/code": () => Response.json({ url: "https://www.spotify.com/pair", code: "ABC123" }) });
    const s = new Spotify("http://box", () => undefined);
    const state = await s.refresh();
    s.stop();
    expect(state).toMatchObject({ available: true, signedIn: false, pair: { url: "https://www.spotify.com/pair", code: "ABC123" } });
  });

  it("is unavailable when the receiver doesn't answer, and says whether it's installed", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const missing = new Spotify("http://box", () => undefined, { bin: "/nonexistent/go-librespot", config: "/nonexistent/config.yml" });
    expect(await missing.refresh()).toMatchObject({ available: false, installed: false });
    missing.stop();
    const there = new Spotify("http://box", () => undefined, { bin: process.execPath, config: "/nonexistent/config.yml" });
    expect(await there.refresh()).toMatchObject({ available: false, installed: true });
    there.stop();
  });

  it("shows the code even while /status can't answer (a receiver busy signing in)", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/status")) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      return Response.json({ url: "https://www.spotify.com/pair", code: "XYZ789" });
    });
    const s = new Spotify("http://box", () => undefined, { config: "/nonexistent/config.yml" });
    expect(await s.refresh()).toMatchObject({ available: true, signedIn: false, pair: { code: "XYZ789" } });
    s.stop();
  });

  it("switches to a code sign-in by rewriting the config and restarting the receiver", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "spotify-"));
    const config = path.join(dir, "config.yml");
    writeFileSync(config, readFileSync(path.join(__dirname, "../../tools/box/files/go-librespot.yml"), "utf8"));
    const ran: string[] = [];
    fake({ "/status": () => new Response(null, { status: 204 }), "/auth/code": () => Response.json({ url: "https://www.spotify.com/pair", code: "ABC123" }) });
    const s = new Spotify("http://box", () => undefined, { config, exec: async (cmd, args) => (ran.push(`${cmd} ${args.join(" ")}`), "") });
    const state = await s.setup({ signIn: "code" });
    s.stop();
    expect(ran).toContain("systemctl --user restart ultimatetv-spotify.service");
    expect(signInOf(readFileSync(config, "utf8"))).toBe("code");
    expect(readFileSync(config, "utf8")).toMatch(/^zeroconf_enabled: false$/m);
    expect(state).toMatchObject({ signIn: "code", pair: { code: "ABC123" } });
  });

  it("sets shuffle before playing, and repeat as two switches", async () => {
    const ok = () => new Response(null, { status: 200 });
    const calls = fake({ "/player/shuffle_context": ok, "/player/play": ok, "/player/repeat_track": ok, "/player/repeat_context": ok, "/status": () => Response.json(status) });
    const s = new Spotify("http://box", () => undefined);
    await s.play("spotify:playlist:abc", { shuffle: true });
    await s.control({ cmd: "repeat", mode: "one" });
    s.stop();
    const posts = calls.filter((c) => c.startsWith("POST"));
    expect(posts).toEqual([
      'POST /player/shuffle_context {"shuffle_context":true}',
      'POST /player/play {"uri":"spotify:playlist:abc"}',
      'POST /player/repeat_track {"repeat_track":true}',
      'POST /player/repeat_context {"repeat_context":true}',
    ]);
  });

  it("treats a receiver without the library API as an empty library", async () => {
    fake({});
    const s = new Spotify("http://box", () => undefined);
    expect(await s.library("playlists", 0)).toEqual({ items: [], total: 0 });
    s.stop();
  });
});
