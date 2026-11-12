// The PlayStation 5 app's Hub side (docs/ps5-architecture.md): rows and streams shaped for EVO's
// provider, and the look the Hub serves to the console.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";
import type { HomeScreen, PlaybackInfo, TitleDetails } from "@ultimatetv/shared";
import { THEMES } from "@ultimatetv/shared";
import { HEADER, HERO, absolute, bundle, clip, homeRows, parseRowId, resolved, seriesRows, titleRowId } from "../src/ps5.js";

const O = "http://hub.lan:8095";

describe("row ids", () => {
  it("round-trips titles, episodes, channels and series", () => {
    expect(parseRowId(titleRowId({ id: "tmdb:movie:603", kind: "movie", name: "M" }))).toEqual({ what: "title", id: "tmdb:movie:603" });
    expect(parseRowId(titleRowId({ id: "tmdb:series:1", kind: "series", name: "S" }))).toEqual({ what: "series", id: "tmdb:series:1" });
    expect(parseRowId(titleRowId({ id: "tmdb:series:1", kind: "series", name: "S", episodeId: "s2e5" }))).toEqual({ what: "episode", id: "tmdb:series:1", episodeId: "s2e5" });
    expect(parseRowId("channel:bbc1")).toEqual({ what: "channel", id: "bbc1" });
  });
  it("refuses what it didn't make", () => {
    for (const bad of ["", "x", "nope:1", "title:", "episode:abc"]) expect(parseRowId(bad)).toBeNull();
  });
});

describe("text and addresses", () => {
  it("clips on whole characters", () => {
    expect(clip("a".repeat(10), 5)).toBe("aaaa…");
    expect(clip("😀".repeat(4), 3)).toBe("😀😀…");
    expect(clip(undefined, 5)).toBe("");
  });
  it("makes Hub paths absolute and leaves full addresses and nonsense alone", () => {
    expect(absolute("/api/art/x.jpg", O)).toBe(O + "/api/art/x.jpg");
    expect(absolute("https://image.tmdb.org/a.jpg", O)).toBe("https://image.tmdb.org/a.jpg");
    expect(absolute("relative.jpg", O)).toBe("");
    expect(absolute(undefined, O)).toBe("");
  });
});

describe("home as rows", () => {
  const home: HomeScreen = {
    hero: { id: "tmdb:movie:1", kind: "movie", name: "Hero", backdrop: "/b.jpg", overview: "Plot", action: "resume" },
    rails: [
      { id: "continue", title: "Continue watching", kind: "titles", items: [{ id: "tmdb:movie:2", kind: "movie", name: "Two", poster: "/p.jpg", progress: 0.4 }] },
      { id: "empty", title: "Nothing", kind: "titles", items: [] },
      { id: "sport", title: "Sport", kind: "sport", items: [] },
    ],
  };
  it("puts the hero first, then each non-empty rail as a heading and its cards, in order", () => {
    const { items } = homeRows(home, O);
    expect(items.map((r) => r.kind)).toEqual(["hero", "header", "movie"]);
    expect(items[0]).toMatchObject({ subtitle: "Resume", next_title: HERO, art_url: O + "/b.jpg" });
    expect(items[1]).toMatchObject({ overview: HEADER, title: "Continue watching" });
    expect(items[2]).toMatchObject({ id: "title:tmdb:movie:2", parent_id: "rail:continue", art_url: O + "/p.jpg" });
  });
});

describe("series", () => {
  it("lists each season under a heading, with episodes that play", () => {
    const d = { id: "tmdb:series:1", kind: "series", name: "S", genres: [], seasons: [{ season: 1, name: "Season 1", episodes: [{ id: "e", season: 1, episode: 2, name: "Two", runtimeMin: 50, watched: true }] }] } as unknown as TitleDetails;
    const { items } = seriesRows(d, O);
    expect(items[0]).toMatchObject({ overview: HEADER });
    expect(items[1]).toMatchObject({ id: "episode:tmdb:series:1|s1e2", title: "2. Two", duration_sec: 3000, played: true });
    expect(parseRowId(items[1]!.id)).toEqual({ what: "episode", id: "tmdb:series:1", episodeId: "s1e2" });
  });
});

describe("what plays", () => {
  const info = { url: "/api/live/bbc1.ts", title: "BBC One", live: true, startMs: 0, externalSubtitles: [], progressKey: "k", skip: [], headers: { "X-A": "b" } } as unknown as PlaybackInfo;
  it("hands the console an absolute stream address, its headers and whether it is live", () => {
    const r = resolved(info, O);
    expect(r.live).toBe(true);
    expect(r.choices[0]).toMatchObject({ url: O + "/api/live/bbc1.ts", container: "ts", is_live: true, headers: "X-A: b\r\n" });
  });
  it("starts a film where the TV would, in seconds", () => {
    expect(resolved({ ...info, live: false, url: "http://x/a.mkv", startMs: 90_500, durationMs: 7_200_000 }, O)).toMatchObject({ start_sec: 91, duration_sec: 7200, choices: [{ container: "mkv" }] });
  });
});

describe("the look the console downloads", () => {
  it("has a manifest whose sizes and hashes match the files, for every theme", () => {
    for (const t of THEMES) {
      const { files, manifest } = bundle(t.id);
      expect(manifest.assets.map((a) => a.path)).toEqual(files.map((f) => f.path));
      for (const f of files) {
        const a = manifest.assets.find((x) => x.path === f.path)!;
        expect(a.bytes).toBe(Buffer.byteLength(f.body));
        expect(a.sha256).toBe(createHash("sha256").update(f.body).digest("hex"));
      }
    }
  });
  it("changes version when the theme does, and not otherwise", () => {
    expect(bundle("default").manifest.version).toBe(bundle("default").manifest.version);
    expect(bundle("default").manifest.version).not.toBe(bundle("halloween").manifest.version);
  });
  it("carries the theme's colours in a form the console's styling reads", () => {
    const css = bundle("default").files[1]!.body;
    expect(css).toContain("background-color: #070b14");
    expect(css).not.toMatch(/var\(|--/);
    expect(css).not.toMatch(/rgb\(\d+ \d+ \d+\)/);
  });
  it("is markup and styling only, with no script and only the three events the console understands", () => {
    const rml = bundle("default").files[0]!.body;
    expect(rml).not.toMatch(/<script|onclick|javascript:/i);
    const events = new Set([...rml.matchAll(/data-event-\w+="(\w+)\(/g)].map((m) => m[1]));
    expect([...events].sort()).toEqual(["activate", "load_more"]);
    expect(rml).toContain("data-attr-rowid");
  });
});

describe("the PlayStation 5 routes (demo Hub)", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const host = { host: "hub.lan:8095" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-ps5-"));
    const config: HubConfig = {
      port: 8095, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"),
      uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), remoteDir: new URL("../public/remote", import.meta.url).pathname, mediaRoot: path.join(tmp, "media"), demo: true,
    };
    app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
    await pairAsTv(app);
  });
  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("serves the look, and the manifest matches what it serves", async () => {
    const manifest = (await app.inject({ url: "/ps5/bundle/manifest.json" })).json<{ assets: { path: string; sha256: string }[] }>();
    expect(manifest.assets.map((a) => a.path)).toEqual(["main.rml", "main.rcss"]);
    for (const a of manifest.assets) {
      const res = await app.inject({ url: `/ps5/bundle/${a.path}` });
      expect(res.statusCode).toBe(200);
      expect(createHash("sha256").update(res.body).digest("hex")).toBe(a.sha256);
    }
    expect((await app.inject({ url: "/ps5/bundle/../x" })).statusCode).toBe(404);
  });

  it("lists Home as rows the provider can show, with posters the console can fetch", async () => {
    const page = (await app.inject({ url: "/api/ps5/catalog", headers: host })).json<{ items: { kind: string; art_url: string; id: string }[] }>();
    expect(page.items.length).toBeGreaterThan(3);
    expect(page.items.some((r) => r.kind === "header")).toBe(true);
    for (const r of page.items) expect(r.art_url === "" || /^https?:\/\//.test(r.art_url)).toBe(true);
  });

  it("resolves a film from Home into a stream and reports progress against it", async () => {
    const page = (await app.inject({ url: "/api/ps5/catalog", headers: host })).json<{ items: { kind: string; id: string }[] }>();
    const film = page.items.find((r) => r.kind === "movie")!;
    const res = (await app.inject({ method: "POST", url: "/api/ps5/resolve", payload: { id: film.id }, headers: host })).json<{ choices: { url: string }[] }>();
    expect(res.choices[0]!.url).toMatch(/^https?:\/\//);
    const ok = (await app.inject({ method: "POST", url: "/api/ps5/progress", payload: { id: film.id, pos_sec: 120, dur_sec: 6000, state: "update" }, headers: host })).json<{ ok: boolean }>();
    expect(ok.ok).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/ps5/progress", payload: { id: "title:never", pos_sec: 1 }, headers: host })).json<{ ok: boolean }>().ok).toBe(false);
  });

  it("won't resolve a heading or a nonsense id", async () => {
    for (const id of ["rail:continue", "junk"]) expect((await app.inject({ method: "POST", url: "/api/ps5/resolve", payload: { id }, headers: host })).statusCode).toBe(400);
  });
});
