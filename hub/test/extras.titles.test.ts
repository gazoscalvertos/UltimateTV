// Trailers, review scores, More like this and subtitles from OpenSubtitles.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HomeScreen, Profile, PublicSettings, TitleExtras } from "@ultimatetv/shared";
import { cleanSubtitleStyle, DEFAULT_SUBTITLE_STYLE } from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { buildServer } from "../src/server.js";
import { OmdbClient, scoresFrom } from "../src/services/omdb.js";
import { OpenSubtitlesClient, openSubtitlesLang, resultsFrom, searchParams } from "../src/services/opensubtitles.js";
import { pickTrailer } from "../src/services/tmdb.js";
import { parseEpisodeId } from "../src/subtitles.js";
import { pairAsTv } from "./helpers.js";

function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const body = routes[key];
    if (typeof body === "number") return new Response("no", { status: body });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("trailers", () => {
  it("picks an official English YouTube trailer over teasers and clips", () => {
    const t = pickTrailer([
      { key: "clip1234567", name: "Clip", site: "YouTube", type: "Clip" },
      { key: "teaser12345", name: "Teaser", site: "YouTube", type: "Teaser", official: true, iso_639_1: "en" },
      { key: "fanmade1234", name: "Fan trailer", site: "YouTube", type: "Trailer", official: false, iso_639_1: "en" },
      { key: "official123", name: "Official Trailer", site: "YouTube", type: "Trailer", official: true, iso_639_1: "en" },
      { key: "vimeo123456", name: "Vimeo", site: "Vimeo", type: "Trailer", official: true },
    ]);
    expect(t).toEqual({ name: "Official Trailer", url: "https://www.youtube.com/watch?v=official123" });
    expect(pickTrailer([{ key: "x", name: "Bad key", site: "YouTube", type: "Trailer" }])).toBeUndefined();
  });
});

describe("review scores from OMDb", () => {
  const heat = { Response: "True", Ratings: [{ Source: "Internet Movie Database", Value: "8.3/10" }, { Source: "Rotten Tomatoes", Value: "88%" }, { Source: "Metacritic", Value: "76/100" }] };

  it("reads IMDb, Rotten Tomatoes and Metacritic", () => {
    expect(scoresFrom(heat as never)).toEqual([
      { source: "imdb", label: "IMDb", value: "8.3", pct: 83 },
      { source: "rotten-tomatoes", label: "Rotten Tomatoes", value: "88%", pct: 88 },
      { source: "metacritic", label: "Metacritic", value: "76", pct: 76 },
    ]);
    expect(scoresFrom({ Response: "False", Error: "Movie not found!" })).toEqual([]);
    expect(scoresFrom({ Response: "True", imdbRating: "N/A", Ratings: [] })).toEqual([]);
  });

  it("asks once a week per film, and never keeps a bad key's answer", async () => {
    const db = new Db(":memory:");
    const f = fakeFetch({ "i=tt0113277": heat });
    const omdb = new OmdbClient("k", db, f.impl);
    expect(await omdb.scores("tt0113277")).toHaveLength(3);
    expect(await omdb.scores("tt0113277")).toHaveLength(3);
    expect(f.calls).toHaveLength(1);
    expect(await omdb.scores("not-an-id")).toEqual([]);
    const bad = fakeFetch({ "omdbapi.com": { Response: "False", Error: "Invalid API key!" } });
    const badClient = new OmdbClient("x", db, bad.impl);
    await expect(badClient.scores("tt0000001")).rejects.toThrow(/Invalid API key/);
    await expect(badClient.scores("tt0000001")).rejects.toThrow();
    expect(bad.calls).toHaveLength(2);
  });
});

describe("OpenSubtitles", () => {
  it("builds the search the way OpenSubtitles wants it: sorted, lower case, no tt", () => {
    expect(searchParams({ kind: "movie", imdbId: "tt0113277", lang: "eng" })).toBe("imdb_id=113277&languages=en&order_by=download_count&type=movie");
    expect(searchParams({ kind: "series", tmdbId: 1399, season: 2, episode: 5, lang: "en" })).toBe("episode_number=5&languages=en&order_by=download_count&parent_tmdb_id=1399&season_number=2&type=episode");
    expect(openSubtitlesLang("por")).toBe("pt-PT");
    expect(openSubtitlesLang("deu")).toBe("de");
    expect(parseEpisodeId("s2e5")).toEqual({ season: 2, episode: 5 });
    expect(parseEpisodeId("nope")).toBeUndefined();
  });

  it("lists people-made subtitles first, then the most downloaded", () => {
    const r = resultsFrom([
      { id: "1", attributes: { language: "en", release: "Machine", download_count: 9000, machine_translated: true, files: [{ file_id: 11 }] } },
      { id: "2", attributes: { language: "en", release: "Popular", download_count: 500, files: [{ file_id: 22 }] } },
      { id: "3", attributes: { language: "en", release: "Trusted", download_count: 100, from_trusted: true, hearing_impaired: true, files: [{ file_id: 33 }] } },
      { id: "4", attributes: { language: "en", release: "No file", files: [] } },
    ]);
    expect(r.map((x) => x.release)).toEqual(["Trusted", "Popular", "Machine"]);
    expect(r[0]).toMatchObject({ fileId: 33, hearingImpaired: true, trusted: true });
  });

  it("signs in, downloads once and keeps the file", async () => {
    const db = new Db(":memory:");
    const f = fakeFetch({
      "/login": { token: "tok", base_url: "vip-api.opensubtitles.com" },
      "/download": { link: "https://dl.opensubtitles.com/file/abc.srt", remaining: 19 },
      "dl.opensubtitles.com": "1\n00:00:01,000 --> 00:00:02,000\nHello\n",
    });
    const os = new OpenSubtitlesClient({ apiKey: "key", username: "gary", password: "pw" }, db, f.impl);
    expect(await os.file(42)).toContain("Hello");
    expect(await os.file(42)).toContain("Hello");
    expect(f.calls.map((c) => new URL(c.url).host + new URL(c.url).pathname)).toEqual(["api.opensubtitles.com/api/v1/login", "vip-api.opensubtitles.com/api/v1/download", "dl.opensubtitles.com/file/abc.srt"]);
    const headers = new Headers(f.calls[1]!.init!.headers);
    expect(headers.get("Api-Key")).toBe("key");
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("User-Agent")).toMatch(/UltimateTV/);
  });

  it("says when the day's downloads are used up", async () => {
    const os = new OpenSubtitlesClient({ apiKey: "key" }, new Db(":memory:"), fakeFetch({ "/download": 406 }).impl);
    await expect(os.file(7)).rejects.toThrow(/downloads used up: sign in/);
  });
});

describe("subtitle style", () => {
  it("keeps only known choices", () => {
    expect(cleanSubtitleStyle({ size: "huge", background: "pink", colour: "yellow" })).toEqual({ ...DEFAULT_SUBTITLE_STYLE, size: "huge", colour: "yellow" });
    expect(cleanSubtitleStyle(null, { ...DEFAULT_SUBTITLE_STYLE, position: "raised" }).position).toBe("raised");
  });
});

describe("in the demo Hub", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-extras-"));
    app = await buildServer(
      { port: 8095, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), mediaRoot: path.join(tmp, "media"), demo: true },
      { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) },
    );
    await pairAsTv(app);
  });
  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("gives a film's page a trailer, scores and More like this", async () => {
    const x = (await app.inject("/api/titles/" + encodeURIComponent("demo:movie:copper-sky") + "/extras")).json<TitleExtras>();
    expect(x.trailer?.url).toBeTruthy();
    expect(x.scores.map((s) => s.label)).toEqual(["TMDB", "IMDb", "Rotten Tomatoes"]);
    expect(x.similar[0]!.name).toBe("Starfall");
    expect(x.similar.some((t) => t.id === "demo:movie:copper-sky")).toBe(false);
  });

  it("keeps More like this to what Kids may see", async () => {
    const kids = (await app.inject({ url: "/api/titles/" + encodeURIComponent("demo:movie:paper-moons") + "/extras", headers: { "x-profile": "kids" } })).json<TitleExtras>();
    expect(kids.similar.every((t) => t.genres?.some((g) => /Family|Animation|Kids/.test(g)))).toBe(true);
    expect((await app.inject({ url: "/api/titles/" + encodeURIComponent("demo:movie:night-ferry") + "/extras", headers: { "x-profile": "kids" } })).statusCode).toBe(403);
  });

  it("puts Because you watched on Home", async () => {
    const home = (await app.inject("/api/home")).json<HomeScreen>();
    const rail = home.rails.find((r) => r.id === "because");
    expect(rail?.title).toBe("Because you watched Copper Sky");
  });

  it("says OpenSubtitles isn't set up, and serves only files it has", async () => {
    const r = (await app.inject("/api/subtitles?titleId=" + encodeURIComponent("demo:movie:copper-sky"))).json<{ configured: boolean; note?: string }>();
    expect(r).toMatchObject({ configured: false });
    expect((await app.inject("/api/subtitles/files/1.srt")).statusCode).toBe(404);
    expect((await app.inject("/api/subtitles/files/..%2Fhub.db")).statusCode).toBe(404);
  });

  it("saves subtitle style and OpenSubtitles without showing the password", async () => {
    const s = (await app.inject({ method: "PUT", url: "/api/settings", payload: { playback: { subtitleStyle: { size: "huge", colour: "purple" } }, omdbApiKey: "abc", openSubtitles: { apiKey: "os", username: "gary", password: "secret" } } })).json<PublicSettings>();
    expect(s.playback.subtitleStyle).toEqual({ ...DEFAULT_SUBTITLE_STYLE, size: "huge" });
    expect(s.omdb).toBe(true);
    expect(s.openSubtitles).toEqual({ configured: true, signedIn: true });
    expect(JSON.stringify(s)).not.toContain("secret");
    // Keys the playback settings no longer have (a retired setting sent by an old app) are dropped.
    const old = (await app.inject({ method: "PUT", url: "/api/settings", payload: { playback: { retiredSetting: "home" } } })).json<PublicSettings>();
    expect(old.playback).not.toHaveProperty("retiredSetting");
    expect(old.playback.subtitleStyle.size).toBe("huge");
    // A new key alone keeps the login.
    const again = (await app.inject({ method: "PUT", url: "/api/settings", payload: { openSubtitles: { apiKey: "os2" } } })).json<PublicSettings>();
    expect(again.openSubtitles).toEqual({ configured: true, signedIn: true });
  });

  it("keeps a subtitle choice per profile", async () => {
    const p = (await app.inject({ method: "PATCH", url: "/api/profiles/kids", payload: { subtitles: "foreign" } })).json<Profile>();
    expect(p.subtitles).toBe("foreign");
    const back = (await app.inject({ method: "PATCH", url: "/api/profiles/kids", payload: { subtitles: null } })).json<Profile>();
    expect(back.subtitles).toBeUndefined();
  });
});
