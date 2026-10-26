import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuideWindow, HomeScreen, PlaybackInfo, TitleDetails } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-api-"));
  const config: HubConfig = {
    port: 8095,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    uiDir: path.join(tmp, "ui"),
    setupDir: path.join(tmp, "setup"),
    remoteDir: new URL("../public/remote", import.meta.url).pathname,
    mediaRoot: path.join(tmp, "media"),
    demo: true,
  };
  app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
  await pairAsTv(app);
});

afterAll(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("Hub API in demo mode", () => {
  it("serves the guide with Sky-style numbers and recording marks", async () => {
    const res = await app.inject("/api/guide?from=" + (Date.now() - 3_600_000) + "&to=" + (Date.now() + 6 * 3_600_000));
    const g = res.json<GuideWindow>();
    expect(g.channels[0]).toMatchObject({ number: 101, name: "BBC One" });
    expect(Object.keys(g.programmes)).toHaveLength(g.channels.length);
    expect(g.programmes["bbc-one"]!.length).toBeGreaterThan(3);
    const sport = await app.inject("/api/guide?category=sport");
    expect(sport.json<GuideWindow>().channels.every((c) => c.category === "sport")).toBe(true);
  });

  it("builds the home screen", async () => {
    const home = (await app.inject("/api/home")).json<HomeScreen>();
    const ids = home.rails.map((r) => r.id);
    expect(ids).toContain("live");
    expect(ids).toContain("continue");
    expect(ids).toContain("recordings");
    expect(home.hero?.name).toBe("Copper Sky");
  });

  it("shows title details, streams and plays them", async () => {
    const d = (await app.inject("/api/titles/" + encodeURIComponent("demo:movie:copper-sky"))).json<TitleDetails>();
    expect(d).toMatchObject({ name: "Copper Sky", year: 2024, inLibrary: true, resumeMs: 48 * 60_000 });
    const streams = (await app.inject("/api/titles/" + encodeURIComponent("demo:movie:copper-sky") + "/streams")).json<{ streams: { badges: string[] }[] }>();
    expect(streams.streams[0]!.badges).toEqual(expect.arrayContaining(["4K", "Atmos"]));
    const play = await app.inject({ method: "POST", url: "/api/play", payload: { kind: "title", id: "demo:movie:copper-sky" }, headers: { host: "hub.lan:8095" } });
    const info = play.json<PlaybackInfo>();
    expect(info.url).toMatch(/^http:\/\/hub\.lan:8095\/clips\//);
    expect(info.startMs).toBe(48 * 60_000);
  });

  it("plays a channel through the relay URL", async () => {
    const res = await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "bbc-one" }, headers: { host: "hub.lan:8095" } });
    expect(res.json<PlaybackInfo>()).toMatchObject({ url: "http://hub.lan:8095/api/live/bbc-one.ts", live: true, title: "BBC One" });
  });

  it("asks a phone before it takes the TV's IPTV connection", async () => {
    const guard = app.hub.guard;
    guard.acquire({ key: "live:bbc-one", holder: "box", kind: "view", label: "Watching BBC One" });
    try {
      const phone = { host: "hub.lan:8095", "x-device": "phone:pixel" };
      const asked = await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "bbc-two" }, headers: phone });
      expect(asked.statusCode).toBe(409);
      expect(asked.json()).toMatchObject({ code: "busy", error: expect.stringContaining("the TV (Watching BBC One)") });
      // The same channel shares the TV's stream, so there's nothing to ask.
      const same = await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "bbc-one" }, headers: phone });
      expect(same.json<PlaybackInfo>().url).toBe("http://hub.lan:8095/api/live/bbc-one.ts?holder=phone%3Apixel");
      const forced = await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "bbc-two", force: true }, headers: phone });
      expect(forced.json<PlaybackInfo>().url).toBe("http://hub.lan:8095/api/live/bbc-two.ts?force=1&holder=phone%3Apixel");
      // The TV itself switches without asking, as before.
      expect((await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "bbc-two" }, headers: { host: "hub.lan:8095" } })).statusCode).toBe(200);
    } finally {
      guard.release("live:bbc-one", "box");
    }
  });

  it("gives the phone films and recordings to download, but not live TV", async () => {
    const live = await app.inject({ method: "POST", url: "/api/offline", payload: { kind: "channel", id: "bbc-one" } });
    expect(live.statusCode).toBe(422);
    const film = await app.inject({ method: "POST", url: "/api/offline", payload: { kind: "title", id: "demo:movie:copper-sky" }, headers: { host: "hub.lan:8095" } });
    expect(film.json<PlaybackInfo>()).toMatchObject({ title: "Copper Sky", live: false });
  });

  it("lists recordings, series links and the clash", async () => {
    const r = (await app.inject("/api/recordings")).json<{ recordings: unknown[]; seriesLinks: { title: string }[]; conflicts: { message: string }[] }>();
    expect(r.recordings.length).toBeGreaterThan(5);
    expect(r.seriesLinks[0]!.title).toBe("Harbour Lights");
  });

  it("searches channels, the guide and titles", async () => {
    const res = (await app.inject("/api/search?q=harbour")).json<{ results: { kind: string; name: string }[] }>();
    const kinds = new Set(res.results.map((x) => x.kind));
    expect(kinds.has("title")).toBe(true);
    expect([...kinds].some((k) => k === "upcoming" || k === "on-now")).toBe(true);
    const ch = (await app.inject("/api/search?q=bbc")).json<{ results: { kind: string }[] }>();
    expect(ch.results[0]!.kind).toBe("channel");
  });

  it("serves generated artwork and the setup QR code", async () => {
    const art = await app.inject("/api/art/poster/copper-sky.svg");
    expect(art.headers["content-type"]).toContain("image/svg+xml");
    expect(art.body).toContain("COPPER");
    const qr = await app.inject("/api/setup/qr.svg");
    expect(qr.body).toContain("<svg");
  });

  it("keeps secrets out of the public settings", async () => {
    await app.inject({ method: "PUT", url: "/api/settings", payload: { tmdbApiKey: "secret-key", addonUrls: ["https://aiostreams.example.com/stremio/abc123/eyJzZWNyZXQ/manifest.json"] } });
    const s = await app.inject("/api/settings");
    expect(s.body).not.toContain("secret-key");
    expect(s.body).not.toContain("eyJzZWNyZXQ");
    expect(s.json()).toMatchObject({ tmdb: true, addons: [{ name: "AIOStreams" }] });
  });

  it("renames the app", async () => {
    expect((await app.inject("/api/settings")).json()).toMatchObject({ appName: "UltimateTV" });
    const saved = await app.inject({ method: "PUT", url: "/api/settings", payload: { appName: "  GazosTV  " } });
    expect(saved.json()).toMatchObject({ appName: "GazosTV" });
    expect((await app.inject("/api/settings")).json()).toMatchObject({ appName: "GazosTV" });
    const manifest = await app.inject("/remote/manifest.webmanifest");
    expect(manifest.json()).toMatchObject({ name: "GazosTV Remote" });
    // Blank goes back to the default.
    expect((await app.inject({ method: "PUT", url: "/api/settings", payload: { appName: " " } })).json()).toMatchObject({ appName: "UltimateTV" });
  });

  it("refuses to add the same IPTV source twice", async () => {
    const payload = { kind: "m3u", name: "Playlist", url: "http://playlist.example/get.php?type=m3u" };
    const first = await app.inject({ method: "POST", url: "/api/settings/iptv", payload });
    expect(first.statusCode).toBe(201);
    const again = await app.inject({ method: "POST", url: "/api/settings/iptv", payload: { ...payload, url: payload.url + " " } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: expect.stringContaining("already added") });
    const s = (await app.inject("/api/settings")).json<{ iptv: { id: string }[] }>();
    expect(s.iptv).toHaveLength(1);
    await app.inject({ method: "DELETE", url: `/api/settings/iptv/${s.iptv[0]!.id}` });
    await app.hub.ingest.refreshAll();
  });
});
