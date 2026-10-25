import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryItem, Spotify, toState } from "../src/spotify.js";

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

  it("is unavailable when the receiver doesn't answer", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const s = new Spotify("http://box", () => undefined);
    expect((await s.refresh()).available).toBe(false);
    s.stop();
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
