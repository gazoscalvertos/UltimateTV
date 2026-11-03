// The Plex client, against Plex's own JSON (faked): the mapping into the Hub's item shape, the ids,
// streams, images, progress and skip markers, and the Hub with Plex as its media server.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HomeScreen, TitleDetails, TitleRef } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { PlexClient, plexAuthUrl, plexPinCheck, plexPinStart, plexRatingRank, plexResources, type PlexAuth } from "../src/services/plex.js";
import { pairAsTv } from "./helpers.js";

const auth: PlexAuth = { url: "http://plex:32400/", token: "t0k3n", serverName: "Nas" };

/** A faked fetch: the first route whose key the URL contains answers with its JSON. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** A film part, as Plex describes one. */
const movie = {
  ratingKey: "4242",
  key: "/library/metadata/4242",
  type: "movie",
  title: "Heat",
  summary: "A crew, a cop.",
  year: 1995,
  thumb: "/library/metadata/4242/thumb/1699999999",
  art: "/library/metadata/4242/art/1699999999",
  duration: 10_020_000, // ms
  audienceRating: 8.2,
  contentRating: "15",
  updatedAt: 1,
  Guid: [{ id: "imdb://tt0113277" }, { id: "tmdb://949" }, { id: "tvdb://1234" }],
  Genre: [{ tag: "Crime" }, { tag: "Drama" }],
  Role: [{ tag: "Al Pacino" }, { tag: "Robert De Niro" }],
  viewOffset: 600_000,
  Media: [
    {
      id: 1,
      duration: 10_020_000,
      bitrate: 15_000,
      container: "mkv",
      Part: [
        {
          id: 77,
          key: "/library/parts/77/1699999999/file.mkv",
          file: "/mnt/nas/Films/Heat (1995).mkv",
          size: 9_000_000_000,
          container: "mkv",
          Stream: [
            { id: 1, index: 0, streamType: 1, codec: "hevc", height: 2160, width: 3840, colorTrc: "smpte2084", profile: "main 10" },
            { id: 2, index: 1, streamType: 2, codec: "eac3", channels: 6, language: "eng" },
            { id: 3, index: 2, streamType: 3, codec: "srt", language: "eng", displayTitle: "English (SRT)", key: "/library/streams/3" },
            { id: 4, index: 3, streamType: 3, codec: "pgs", language: "fra", displayTitle: "French (PGS)", key: "/library/metadata/4242/file?sub=4" },
          ],
        },
      ],
    },
  ],
  Marker: [
    { type: "intro", startTimeOffset: 1_000, endTimeOffset: 91_000 },
    { type: "credits", startTimeOffset: 9_900_000, endTimeOffset: 10_020_000 },
  ],
};

const show = {
  ratingKey: "100",
  key: "/library/metadata/100",
  type: "show",
  title: "The Wire",
  summary: "Baltimore.",
  year: 2002,
  thumb: "/library/metadata/100/thumb/1",
  art: "/library/metadata/100/art/1",
  Guid: [{ id: "tmdb://1438" }, { id: "tvdb://79126" }],
  Genre: [{ tag: "Drama" }],
  childCount: 2,
};

const season = { ratingKey: "200", key: "/library/metadata/200", type: "season", title: "Season 1", index: 1, parentRatingKey: "100", thumb: "/library/metadata/200/thumb/1" };

const episodes = [
  {
    ratingKey: "301",
    type: "episode",
    title: "The Target",
    summary: "D'Angelo.",
    index: 1,
    parentIndex: 1,
    parentRatingKey: "200",
    grandparentRatingKey: "100",
    grandparentTitle: "The Wire",
    grandparentThumb: "/library/metadata/100/thumb/1",
    duration: 3_600_000,
    viewCount: 1,
    lastViewedAt: 1_700_000_000,
    Media: [{ id: 5, Part: [{ id: 91, key: "/library/parts/91/file.mkv", file: "/mnt/nas/TV/The Wire/S01E01.mkv", size: 2_000_000_000, container: "mkv" }] }],
  },
  {
    ratingKey: "302",
    type: "episode",
    title: "The Detail",
    index: 2,
    parentIndex: 1,
    parentRatingKey: "200",
    grandparentRatingKey: "100",
    grandparentTitle: "The Wire",
    duration: 3_540_000,
    viewOffset: 120_000,
    Media: [{ id: 6, Part: [{ id: 92, key: "/library/parts/92/file.mkv", file: "/mnt/nas/TV/The Wire/S01E02.mkv", size: 2_000_000_000, container: "mkv" }] }],
  },
];

const sections = { MediaContainer: { size: 2, Directory: [{ key: "1", title: "Films", type: "movie" }, { key: "2", title: "TV", type: "show" }] } };

describe("PlexClient", () => {
  it("maps a film into the Hub's item shape and its title details", async () => {
    const f = fakeFetch({ "/library/metadata/4242": { MediaContainer: { Metadata: [movie] } } });
    const plex = new PlexClient(auth, f.impl);
    const item = await plex.item("4242");

    expect(item.UserData?.PlayedPercentage).toBeCloseTo(5.988, 3);
    expect(item).toMatchObject({
      Id: "4242",
      Name: "Heat",
      Type: "Movie",
      ProductionYear: 1995,
      Overview: "A crew, a cop.",
      Genres: ["Crime", "Drama"],
      CommunityRating: 8.2,
      OfficialRating: "15",
      RunTimeTicks: 100_200_000_000,
      ProviderIds: { Imdb: "tt0113277", Tmdb: "949", Tvdb: "1234" },
      UserData: { PlaybackPositionTicks: 6_000_000_000 },
    });

    const d = plex.toDetails(item);
    expect(d.id).toBe("plex:4242");
    expect(d.kind).toBe("movie");
    expect(d.name).toBe("Heat");
    expect(d.availability).toEqual(["plex"]);
    expect(d.inLibrary).toBe(true);
    expect(d.runtimeMin).toBe(167);
    expect(d.resumeMs).toBe(600_000);
    expect(d.tmdbId).toBe(949);
    expect(d.imdbId).toBe("tt0113277");
    expect(d.certification).toBe("15");
    expect(d.cast).toEqual(["Al Pacino", "Robert De Niro"]);
    expect(d.poster).toContain("http://plex:32400/library/metadata/4242/thumb/1699999999");
    expect(d.poster).toContain("width=400");
    expect(d.poster).toContain("X-Plex-Token=t0k3n");
    expect(d.backdrop).toContain("/art/1699999999");
    expect(d.backdrop).toContain("width=1280");

    // A film with a TMDB id is a TMDB title, so its card is the same whichever server it came from.
    const ref = plex.toTitleRef(item);
    expect(ref).toMatchObject({ id: "tmdb:movie:949", kind: "movie", name: "Heat", year: 1995 });
    expect(ref.progress).toBeCloseTo(0.0599, 3);
    expect(ref.certification).toBe("15");
    expect(ref.genres).toEqual(["Crime", "Drama"]);

    // The item's own keys and helpers.
    expect(plex.kind).toBe("plex");
    expect(plex.name).toBe("Plex");
    expect(plex.key("4242")).toBe("plex:4242");
    expect(plex.parseKey("plex:4242")).toBe("4242");
    expect(plex.parseKey("jellyfin:4242")).toBeUndefined();
  });

  it("maps an episode through its show, and fills in the seasons of a series", async () => {
    const f = fakeFetch({
      "/library/metadata/100/allLeaves": { MediaContainer: { size: 2, Metadata: episodes } },
      "/library/metadata/301": { MediaContainer: { Metadata: [episodes[0]] } },
      "/library/metadata/100": { MediaContainer: { Metadata: [show] } },
    });
    const plex = new PlexClient(auth, f.impl);
    const s = (await plex.item("100")) as never;
    const eps = await plex.episodes("100");
    expect(eps.map((e) => e.Id)).toEqual(["301", "302"]);
    expect(eps[0]!.SeriesId).toBe("100");
    expect(eps[0]!.ParentIndexNumber).toBe(1);
    expect(eps[0]!.IndexNumber).toBe(1);

    const item = await plex.item("301");
    // An episode is found by its show, so its card is the show's, with the episode underneath. The
    // episode itself carries no Guid, so the card keeps the server's id rather than guessing one.
    const ref = plex.toTitleRef(item);
    expect(ref.id).toBe("plex:100");
    expect(ref.kind).toBe("series");
    expect(ref.name).toBe("The Wire");
    expect(ref.subtitle).toBe("S1 E1 · The Target");
    expect(ref.poster).toContain("/library/metadata/100/thumb/1");

    const ep = plex.toEpisode(item);
    expect(ep).toMatchObject({ id: "plex:301", season: 1, episode: 1, name: "The Target", runtimeMin: 60, watched: true });
    expect(ep.still).toContain("width=640");

    const d = plex.toDetails(s, eps);
    expect(d.seasons?.map((x) => x.season)).toEqual([1]);
    expect(d.seasons?.[0]?.episodes.map((e) => e.name)).toEqual(["The Target", "The Detail"]);
    // The last one played was finished, so Play carries on with the next.
    expect(d.episodeId).toBe("s1e2");
    expect(d.resumeMs).toBe(120_000);
  });

  it("reports On Deck as Continue watching, and derives Next up from the next unwatched episode", async () => {
    const f = fakeFetch({
      "/library/onDeck": { MediaContainer: { size: 1, Metadata: [episodes[1]] } },
      "/library/metadata/100/allLeaves": { MediaContainer: { Metadata: episodes } },
    });
    const plex = new PlexClient(auth, f.impl);
    const resume = await plex.resume();
    expect(resume.map((i) => i.Id)).toEqual(["302"]);
    expect(resume[0]!.UserData?.PlaybackPositionTicks).toBe(1_200_000_000);
    expect(resume[0]!.SeriesId).toBe("100");

    // Plex has no Next up: it is the first episode after the last one watched.
    const next = await plex.nextUp();
    expect(next.map((i) => i.Id)).toEqual(["302"]);
    expect(next[0]!.ParentIndexNumber).toBe(1);
  });

  it("finds a title by its TMDB or IMDb id through the provider index", async () => {
    const f = fakeFetch({
      "/library/sections/1/all": { MediaContainer: { size: 1, totalSize: 1, Metadata: [movie] } },
      "/library/sections/2/all": { MediaContainer: { size: 1, totalSize: 1, Metadata: [show] } },
      "/library/sections": sections,
      "/library/metadata/4242": { MediaContainer: { Metadata: [movie] } },
    });
    const plex = new PlexClient(auth, f.impl);
    expect(await plex.hasProviderId("tmdb", "949", "Movie")).toBe(true);
    expect(await plex.hasProviderId("imdb", "tt0113277", "Movie")).toBe(true);
    expect(await plex.hasProviderId("tmdb", "1438", "Series")).toBe(true);
    expect(await plex.hasProviderId("tmdb", "1", "Movie")).toBe(false);
    const hit = await plex.byProviderId("tmdb", "949", "Movie");
    expect(hit?.Name).toBe("Heat");
    expect(await plex.byProviderId("tmdb", "1", "Movie")).toBeUndefined();
    // One pass over the sections, not one per lookup.
    expect(f.calls.filter((c) => c.url.includes("includeGuids=1"))).toHaveLength(2);
  });

  it("plays a film from its part, with the token, and a smaller copy falls back rather than pretending", async () => {
    const f = fakeFetch({ "/library/metadata/4242": { MediaContainer: { Metadata: [movie] } } });
    const plex = new PlexClient(auth, f.impl);
    const item = await plex.item("4242");
    expect(item.MediaSources?.[0]).toMatchObject({ Id: "77", Path: "/mnt/nas/Films/Heat (1995).mkv", Container: "mkv", Size: 9_000_000_000, Bitrate: 15_000_000 });
    const url = plex.streamUrl("4242", "77");
    expect(url).toBe("http://plex:32400/library/parts/77/1699999999/file.mkv?download=1&X-Plex-Token=t0k3n");
    // Without a media source, the first part is the one that plays.
    expect(plex.streamUrl("4242")).toContain("/library/parts/77/");

    // Only the external subtitle has a URL; the one inside the file does not.
    const src = item.MediaSources![0]!;
    const external = src.MediaStreams!.filter((s) => s.Type === "Subtitle" && s.IsExternal);
    expect(external).toHaveLength(1);
    expect(plex.subtitleUrl("4242", src.Id, external[0]!.Index, external[0]!.Codec)).toBe("http://plex:32400/library/streams/3?encoding=utf-8&X-Plex-Token=t0k3n");

    // Plex's transcoder isn't implemented: the caller gets an error, and playback.ts keeps direct play.
    expect(() => plex.hlsUrl("4242", "77", "sess")).toThrow(/smaller copy/);
  });

  it("reports progress as Plex's timeline, and marks a title played and unplayed", async () => {
    const f = fakeFetch({
      "/library/metadata/4242": { MediaContainer: { Metadata: [movie] } },
      "/:/timeline": {},
      "/:/scrobble": {},
      "/:/unscrobble": {},
    });
    const plex = new PlexClient(auth, f.impl);
    await plex.item("4242"); // remembers the run time the timeline has to carry
    await plex.reportProgress("4242", 600_000, "progress");
    await plex.reportProgress("4242", 600_000, "start", true);
    await plex.reportProgress("4242", 660_000, "stop");

    const timeline = f.calls.filter((c) => c.url.includes("/:/timeline"));
    expect(timeline).toHaveLength(3);
    expect(timeline[0]!.url).toContain("ratingKey=4242");
    expect(timeline[0]!.url).toContain("state=playing");
    expect(timeline[0]!.url).toContain("time=600000");
    expect(timeline[0]!.url).toContain("duration=10020000");
    expect(timeline[1]!.url).toContain("state=paused");
    expect(timeline[2]!.url).toContain("state=stopped");
    expect(decodeURIComponent(timeline[0]!.url)).toContain("key=/library/metadata/4242");

    await plex.markPlayed("4242", true);
    await plex.markPlayed("4242", false);
    expect(f.calls.some((c) => c.url.includes("/:/scrobble?key=4242"))).toBe(true);
    expect(f.calls.some((c) => c.url.includes("/:/unscrobble?key=4242"))).toBe(true);
    expect(f.calls.every((c) => !c.url.includes("X-Plex-Token") || c.init)).toBe(true);
  });

  it("turns Plex's intro and credits markers into the skip markers the player wants", async () => {
    const f = fakeFetch({ "/library/metadata/4242": { MediaContainer: { Metadata: [movie] } }, "/library/metadata/1": { MediaContainer: { Metadata: [{ ratingKey: "1", type: "movie", title: "No markers" }] } } });
    const plex = new PlexClient(auth, f.impl);
    expect(await plex.segments("4242")).toEqual([
      { Type: "Intro", StartTicks: 10_000_000, EndTicks: 910_000_000 },
      { Type: "Credits", StartTicks: 99_000_000_000, EndTicks: 100_200_000_000 },
    ]);
    // An item with none, and a server that doesn't answer, are both simply no markers.
    expect(await plex.segments("1")).toEqual([]);
    expect(await plex.segments("404")).toEqual([]);
  });

  it("lists and searches the libraries, with a Kids rating limit applied here", async () => {
    const f = fakeFetch({
      "/library/sections/1/all": { MediaContainer: { size: 1, totalSize: 1, Metadata: [movie, { ...movie, ratingKey: "9", title: "Paddington", contentRating: "U", Guid: [{ id: "tmdb://1" }] }] } },
      "/library/sections/2/all": { MediaContainer: { size: 1, totalSize: 1, Metadata: [show] } },
      "/library/sections": sections,
      "/search": { MediaContainer: { Hub: [{ Metadata: [movie] }, { Metadata: [show] }] } },
    });
    const plex = new PlexClient(auth, f.impl);
    const all = await plex.items({ type: "Movie" });
    expect(all.items.map((i) => i.Name)).toEqual(["Heat", "Paddington"]);
    expect(all.total).toBe(1);
    const asked = f.calls.find((c) => c.url.includes("/library/sections/1/all"))!;
    expect(decodeURIComponent(asked.url)).toContain("sort=titleSort:asc");
    const sorted = await plex.items({ type: "Movie", sortBy: "DateCreated" });
    expect(sorted.items).toHaveLength(2);
    expect(decodeURIComponent(f.calls.filter((c) => c.url.includes("/library/sections/1/all")).at(-1)!.url)).toContain("sort=addedAt:desc");

    // A Kids profile's limit is a certificate one, and Plex has no query for it.
    const kids = await plex.items({ type: "Movie", maxRating: "PG" });
    expect(kids.items.map((i) => i.Name)).toEqual(["Paddington"]);

    const found = await plex.items({ type: "Series", search: "wire" });
    expect(found.items.map((i) => i.Name)).toEqual(["The Wire"]);
    expect(f.calls.some((c) => c.url.includes("/search?query=wire"))).toBe(true);
  });

  it("says plainly that it can only rescan a Plex library, not add one file", async () => {
    const f = fakeFetch({ "/library/sections/all/refresh": {} });
    const plex = new PlexClient(auth, f.impl);
    const res = await plex.mediaUpdated(["/mnt/nas/Films/Heat (1995).mkv"]);
    expect(res.added).toBe(false);
    expect(res.note).toContain("next scan");
    expect(f.calls.some((c) => c.url.includes("/library/sections/all/refresh"))).toBe(true);
    // The scheduler's own refresh goes to the same place.
    await plex.refreshLibrary();
    expect(f.calls.filter((c) => c.url.includes("/library/sections/all/refresh"))).toHaveLength(2);
  });

  it("surfaces a refused token and a broken server as errors, not as empty libraries", async () => {
    const unauthorized = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const broken = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(new PlexClient(auth, unauthorized).item("4242")).rejects.toThrow(/401/);
    await expect(new PlexClient(auth, broken).resume()).rejects.toThrow(/500/);
    await expect(new PlexClient(auth, broken).markPlayed("4242", true)).rejects.toThrow(/500/);
    // Connecting checks the URL and token, so a wrong token is caught in Settings.
    await expect(PlexClient.connect({ url: "http://plex:32400", token: "nope" }, unauthorized)).rejects.toThrow(/401/);
  });
});

describe("Plex sign-in", () => {
  it("starts a PIN, gives the page to approve it on, and reads the token back", async () => {
    const f = fakeFetch({ "/api/v2/pins/4242": { id: 4242, code: "abcd", authToken: "tok" }, "/api/v2/pins": { id: 4242, code: "abcd" } });
    const start = await plexPinStart(f.impl);
    expect(start.id).toBe(4242);
    expect(start.code).toBe("abcd");
    expect(start.authUrl).toContain("https://app.plex.tv/auth#?");
    expect(start.authUrl).toContain("clientID=ultimatetv-hub");
    expect(start.authUrl).toContain("code=abcd");
    expect(f.calls[0]!.init?.method).toBe("POST");
    expect((f.calls[0]!.init!.headers as Record<string, string>)["X-Plex-Client-Identifier"]).toBe("ultimatetv-hub");
    expect(await plexPinCheck("4242", f.impl)).toBe("tok");

    const waiting = fakeFetch({ "/api/v2/pins/4242": { id: 4242 } });
    expect(await plexPinCheck("4242", waiting.impl)).toBeUndefined();
    expect(plexAuthUrl(1, "wxyz")).toContain("code=wxyz");
  });

  it("lists the household's servers from plex.tv, keeping the local connection first", async () => {
    const f = fakeFetch({
      "/api/resources": [
        { name: "Nas", provides: "server", connections: [{ uri: "https://relay.plex.direct/x", relay: true }, { uri: "https://1-2-3-4.plex.direct:32400", local: false }, { uri: "http://192.168.0.23:32400", local: true }] },
        { name: "Phone", provides: "client", connections: [{ uri: "http://phone:1" }] },
      ],
    });
    expect(await plexResources("tok", f.impl)).toEqual([{ name: "Nas", urls: ["http://192.168.0.23:32400", "https://1-2-3-4.plex.direct:32400"] }]);
  });

  it("reads the server's friendly name when connecting with a URL and token", async () => {
    const f = fakeFetch({ "/identity": { MediaContainer: { machineIdentifier: "abc", version: "1.40" } }, "http://plex:32400/": { MediaContainer: { friendlyName: "Nas", version: "1.40", machineIdentifier: "abc" } } });
    expect(await PlexClient.connect({ url: "http://plex:32400///", token: "tok" }, f.impl)).toEqual({ url: "http://plex:32400", token: "tok", serverName: "Nas" });
    const info = await new PlexClient(auth, f.impl).serverInfo();
    expect(info.name).toBe("Nas");
    expect((await new PlexClient(auth, f.impl).identity()).machineId).toBe("abc");
  });

  it("ranks Plex's certificates like Jellyfin's", () => {
    expect(plexRatingRank("U")).toBe(0);
    expect(plexRatingRank("PG")).toBe(1);
    expect(plexRatingRank("12A")).toBe(2);
    expect(plexRatingRank("15")).toBe(3);
    expect(plexRatingRank("TV-MA")).toBe(3);
    expect(plexRatingRank(undefined)).toBeNull();
    expect(plexRatingRank("unrated thing")).toBeNull();
  });
});

describe("the Hub with Plex", () => {
  let tmp: string;
  let app: FastifyInstance & { hub: HubContext };
  const asks: string[] = [];

  /** Answers what the Hub asks Plex for on Home, and records it. */
  const fakeFetch = (async (url: string | URL | Request) => {
    const href = String(url);
    asks.push(href);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    // The server's own name, which Settings shows once it is connected.
    if (new URL(href).pathname === "/") return json({ MediaContainer: { friendlyName: "Nas", version: "1.40" } });
    if (href.includes("/library/onDeck")) return json({ MediaContainer: { Metadata: [episodes[1]] } });
    if (href.includes("/allLeaves")) return json({ MediaContainer: { Metadata: episodes } });
    if (href.includes("/library/recentlyAdded")) return json({ MediaContainer: { Metadata: [movie] } });
    if (href.includes("/library/sections/1/all")) return json({ MediaContainer: { totalSize: 1, Metadata: [movie] } });
    if (href.includes("/library/sections/2/all")) return json({ MediaContainer: { totalSize: 1, Metadata: [show] } });
    if (href.includes("/library/sections")) return json(sections);
    if (href.includes("/library/metadata/4242")) return json({ MediaContainer: { Metadata: [movie] } });
    if (href.includes("/library/metadata/100")) return json({ MediaContainer: { Metadata: [show] } });
    if (href.includes("/library/metadata/301")) return json({ MediaContainer: { Metadata: [episodes[0]] } });
    if (href.includes("/library/metadata/302")) return json({ MediaContainer: { Metadata: [episodes[1]] } });
    if (href.includes("/library/metadata/200")) return json({ MediaContainer: { Metadata: [season] } });
    return json({ MediaContainer: {} });
  }) as unknown as typeof fetch;

  const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: true });

  async function start(before?: (ctx: HubContext) => void) {
    const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
    before?.(context);
    app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
    await pairAsTv(app);
  }

  const plexOnly = (ctx: HubContext) => ctx.settings.update({ plex: { url: "http://plex:32400", token: "t0k3n", serverName: "Nas" } });
  const family = { "x-profile": "family" };

  beforeEach(async () => {
    asks.length = 0;
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-plex-"));
  });

  afterEach(async () => {
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("is enough on its own for Home, with Plex's rails", async () => {
    await start(plexOnly);
    const home = (await app.inject({ url: "/api/home", headers: family })).json<HomeScreen>();
    const ids = home.rails.map((r) => r.id);
    expect(ids).toContain("continue");
    expect(ids).toContain("latest");
    expect(home.rails.length).toBeGreaterThan(1);
    expect(asks.some((u) => u.includes("/library/onDeck"))).toBe(true);
    expect(asks.some((u) => u.includes("/library/recentlyAdded"))).toBe(true);
    // Next up was derived too, though this show is already in Continue watching, so its rail is
    // left out rather than repeating the same card.
    expect(asks.some((u) => u.includes("/allLeaves"))).toBe(true);

    const cont = home.rails.find((r) => r.id === "continue")!;
    const card = cont.items.find((i) => (i as TitleRef).id === "plex:100") as TitleRef;
    // Plex's id, not Jellyfin's: the prefix is what the Hub's own progress is kept under.
    expect(card).toBeDefined();
    expect(card.kind).toBe("series");
    expect(card.subtitle).toBe("S1 E2 · The Detail");
  });

  it("shows its films and series on Details, and plays them direct", async () => {
    await start(plexOnly);
    const details = (await app.inject({ url: "/api/titles/plex:4242", headers: family })).json<TitleDetails>();
    expect(details.name).toBe("Heat");
    expect(details.availability).toEqual(["plex"]);
    expect(details.resumeMs).toBe(600_000);

    const streams = (await app.inject({ url: "/api/titles/plex:4242/streams", headers: family })).json<{ streams: { id: string; kind: string; label: string }[] }>();
    const plex = streams.streams.find((c) => c.kind === "plex")!;
    expect(plex.id).toBe("plex:4242:77");
    expect(plex.label).toBe("Plex");
    expect(streams.streams.some((c) => c.kind === "jellyfin")).toBe(false);

    // Starting it hands the player the direct file, its place, and Plex's skip markers.
    const play = (await app.inject({ method: "POST", url: "/api/play", headers: family, payload: { kind: "title", id: "plex:4242", streamId: "plex:4242:77" } })).json();
    expect(play.url).toContain("/library/parts/77/");
    expect(play.startMs).toBe(600_000);
    expect(play.durationMs).toBe(10_020_000);
    expect(play.progressKey).toBe("plex:4242");
    expect(play.skip?.map((m: { kind: string }) => m.kind)).toEqual(["intro", "credits"]);

    // A smaller copy isn't offered by Plex: it plays direct rather than failing.
    const smaller = (await app.inject({ method: "POST", url: "/api/play", headers: family, payload: { kind: "title", id: "plex:4242", streamId: "plex:4242:77", smaller: true } })).json();
    expect(smaller.hls).not.toBe(true);
    expect(smaller.url).toContain("/library/parts/77/");
  });

  it("sends a place and a played flag back to Plex", async () => {
    await start(plexOnly);
    const played = await app.inject({ method: "POST", url: "/api/progress", headers: family, payload: { key: "plex:4242", positionMs: 600_000, durationMs: 10_020_000, event: "progress" } });
    expect(played.statusCode).toBe(200);
    expect(asks.some((u) => u.includes("/:/timeline") && u.includes("ratingKey=4242"))).toBe(true);
    // The Hub keeps its own copy too, whatever the server says.
    expect(app.hub.progress.get("plex:4242")?.positionMs).toBe(600_000);

    const watched = await app.inject({ method: "POST", url: "/api/continue/plex%3A4242/watched", headers: family, payload: { watched: true } });
    expect(watched.statusCode).toBe(200);
    expect(asks.some((u) => u.includes("/:/scrobble") && u.includes("key=4242"))).toBe(true);
  });

  it("connects with a URL and token, and says so in the info and settings routes", async () => {
    await start();
    expect((await app.inject({ url: "/api/status" })).json().configured.plex).toBe(false);
    const bad = await app.inject({ method: "POST", url: "/api/plex/login", payload: { url: "http://plex:32400", token: "" } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);

    const res = await app.inject({ method: "POST", url: "/api/plex/login", payload: { url: "http://plex:32400", token: "t0k3n" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().plex.serverName).toBe("Nas");
    expect((await app.inject({ url: "/api/status" })).json().configured.plex).toBe(true);
    const settings = (await app.inject({ url: "/api/settings" })).json();
    expect(settings.plex).toEqual({ url: "http://plex:32400", serverName: "Nas" });
    expect(settings.plex.token).toBeUndefined();
    expect(app.hub.media()?.kind).toBe("plex");

    // Connecting Plex replaces Jellyfin: one media server at a time.
    app.hub.saveJellyfin({ url: "http://jf:8096", userId: "u1", token: "jftok" });
    expect(app.hub.media()?.kind).toBe("jellyfin");
    expect(app.hub.jellyfin()).not.toBeNull();

    const off = await app.inject({ method: "DELETE", url: "/api/plex" });
    expect(off.statusCode).toBe(200);
    expect(app.hub.settings.get().plex).toBeUndefined();
  });

  it("starts a Plex PIN and finishes it once the household has approved it", async () => {
    const pinFetch = (async (url: string | URL | Request) => {
      const href = String(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (href.includes("/api/v2/pins/") && !href.endsWith("strong=true")) return json({ id: 99, authToken: "tok" });
      if (href.includes("/api/v2/pins")) return json({ id: 99, code: "wxyz" });
      if (href.includes("/identity")) return json({ MediaContainer: { machineIdentifier: "m" } });
      return json({ MediaContainer: { friendlyName: "Nas" } });
    }) as unknown as typeof fetch;
    await start((ctx) => Object.assign(ctx, { fetchImpl: pinFetch }));

    const started = await app.inject({ method: "POST", url: "/api/plex/pin" });
    expect(started.statusCode).toBe(200);
    expect(started.json().code).toBe("wxyz");
    expect(started.json().authUrl).toContain("app.plex.tv/auth");

    const pending = await app.inject({ url: "/api/plex/pin/99?url=http%3A%2F%2Fplex%3A32400" });
    expect(pending.json().authenticated).toBe(true);
    expect(app.hub.settings.get().plex?.url).toBe("http://plex:32400");
  });
});
