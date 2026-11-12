// Requesting a title that isn't in the library (issue #225): who can ask, what goes to which
// program, how a request is followed and announced.

import { describe, expect, it } from "vitest";
import type { Profile, RequestSettings } from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { EventBus } from "../src/events.js";
import { mergeRequestSettings, RequestError, TitleRequests } from "../src/requests.js";

const profile = (id: string, kind: Profile["kind"]): Profile => ({ id, name: id === "mia" ? "Mia" : "Dad", kind, colour: "#fff", hasPin: false, maxCertification: "15" as never, channelCategories: [], channelAllow: [] } as unknown as Profile);
const dad = profile("dad", "adult");
const mia = profile("mia", "kids");
const dune = { id: "tmdb:movie:693134", kind: "movie" as const, name: "Dune: Part Two", year: 2024 };
const slow = { id: "tmdb:series:1399", kind: "series" as const, name: "Slow Horses" };

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** A fetch that answers from a table of "METHOD path" → JSON, and remembers what it was asked. */
function fake(routes: Record<string, unknown | ((call: Call) => unknown)>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input));
    const call: Call = { method: init.method ?? "GET", url: `${u.pathname}${u.search}`, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    const hit = routes[`${call.method} ${call.url}`] ?? routes[`${call.method} ${u.pathname}`];
    if (hit === undefined) return new Response("no", { status: 404 });
    const out = typeof hit === "function" ? (hit as (c: Call) => unknown)(call) : hit;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

function setup(settings: RequestSettings | undefined, routes: Record<string, unknown> = {}) {
  const db = new Db(":memory:");
  const events = new EventBus();
  const sent: { type: string }[] = [];
  events.on((e) => sent.push(e as { type: string }));
  const told: string[] = [];
  const f = fake(routes);
  const requests = new TitleRequests({ db, events, settings: () => settings, tvdbOf: async () => 81189, fetchImpl: f.impl, tell: (t) => told.push(t) });
  return { requests, sent, told, calls: f.calls, db };
}

const SEERR: RequestSettings = { jellyseerr: { url: "http://seerr:5055/", apiKey: "k" } };

describe("Request", () => {
  it("is off until a program is set up", async () => {
    const { requests } = setup(undefined);
    expect(requests.enabled()).toBe(false);
    expect(requests.view(dad).configured).toBe(false);
    await expect(requests.create(dad, dune)).rejects.toThrow(/isn't set up/);
  });

  it("sends an adult's request to Jellyseerr at once and follows it by TMDB id", async () => {
    const { requests, calls } = setup(SEERR, { "POST /api/v1/request": { id: 7 } });
    const { request, fresh } = await requests.create(dad, dune);
    expect(fresh).toBe(true);
    expect(request.status).toBe("requested");
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/request", body: { mediaType: "movie", mediaId: 693134 } });
    // The same film asked for again while it is on its way is the same request.
    const again = await requests.create(dad, dune);
    expect(again).toMatchObject({ fresh: false, request: { id: request.id } });
    expect(calls).toHaveLength(1);
  });

  it("asks for every season of a series", async () => {
    const { requests, calls } = setup(SEERR, { "POST /api/v1/request": { id: 8 } });
    await requests.create(dad, slow);
    expect(calls[0]?.body).toEqual({ mediaType: "tv", mediaId: 1399, seasons: "all" });
  });

  it("treats Jellyseerr's 'already requested' as done", async () => {
    const { requests } = setup(SEERR, { "POST /api/v1/request": new Response("exists", { status: 409 }) });
    expect((await requests.create(dad, dune)).request.status).toBe("requested");
  });

  it("says why the program refused, and keeps nothing", async () => {
    const { requests } = setup(SEERR, { "POST /api/v1/request": new Response("bad", { status: 401 }) });
    await expect(requests.create(dad, dune)).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining("API key") });
    expect(requests.view(dad).requests).toHaveLength(0);
  });

  it("holds a Kids request for a grown-up: nothing is sent until it's approved", async () => {
    const { requests, sent, told, calls } = setup(SEERR, { "POST /api/v1/request": { id: 9 } });
    const { request } = await requests.create(mia, dune);
    expect(request.status).toBe("awaiting");
    expect(calls).toHaveLength(0);
    expect(sent.some((e) => e.type === "request.awaiting")).toBe(true);
    expect(told[0]).toMatch(/Mia is asking/);
    // The child sees its own; an adult sees it waiting.
    expect(requests.view(mia).requests).toHaveLength(1);
    expect(requests.view(mia).awaiting).toHaveLength(0);
    expect(requests.view(dad).awaiting).toHaveLength(1);
    const done = await requests.answer(request.id, "approve");
    expect(done.status).toBe("requested");
    expect(calls).toHaveLength(1);
    // The first answer wins.
    await expect(requests.answer(request.id, "decline")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("lets an adult say no, and sends nothing", async () => {
    const { requests, calls } = setup(SEERR);
    const { request } = await requests.create(mia, dune);
    expect((await requests.answer(request.id, "decline")).status).toBe("declined");
    expect(calls).toHaveLength(0);
    // The child may ask again later.
    expect((await requests.create(mia, dune)).fresh).toBe(true);
  });

  it("limits how many a child can leave waiting", async () => {
    const { requests } = setup(SEERR);
    for (let i = 1; i <= 8; i++) await requests.create(mia, { id: `tmdb:movie:${i}`, kind: "movie", name: `Film ${i}` });
    await expect(requests.create(mia, { id: "tmdb:movie:99", kind: "movie", name: "One more" })).rejects.toBeInstanceOf(RequestError);
  });

  it("only takes titles with a TMDB id", async () => {
    const { requests } = setup(SEERR);
    await expect(requests.create(dad, { id: "jellyfin:abc", kind: "movie", name: "X" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("follows a request to 'ready' and announces it once", async () => {
    let media: unknown = { mediaInfo: { status: 2, requests: [{ status: 1 }] } };
    const { requests, sent, told } = setup(SEERR, { "POST /api/v1/request": { id: 7 }, "GET /api/v1/movie/693134": () => media });
    const { request } = await requests.create(dad, dune);
    expect(await requests.refresh()).toBe(0);
    expect(requests.get(request.id)?.status).toBe("requested");
    media = { mediaInfo: { status: 3 } };
    await requests.refresh();
    expect(requests.get(request.id)?.status).toBe("downloading");
    media = { mediaInfo: { status: 5 } };
    expect(await requests.refresh()).toBe(1);
    expect(requests.get(request.id)?.status).toBe("ready");
    expect(sent.filter((e) => e.type === "request.ready")).toHaveLength(1);
    expect(told).toContain("Dune: Part Two is ready");
    // Nothing more to follow, so nothing is announced twice.
    expect(await requests.refresh()).toBe(0);
    expect(sent.filter((e) => e.type === "request.ready")).toHaveLength(1);
  });

  it("notices a request Jellyseerr's owner declined", async () => {
    const { requests } = setup(SEERR, { "POST /api/v1/request": { id: 7 }, "GET /api/v1/movie/693134": { mediaInfo: { status: 1, requests: [{ status: 3 }] } } });
    const { request } = await requests.create(dad, dune);
    await requests.refresh();
    expect(requests.get(request.id)).toMatchObject({ status: "declined" });
  });

  it("offers Request only for a title no source has", async () => {
    const { requests } = setup(SEERR, { "POST /api/v1/request": { id: 7 } });
    const base = { id: dune.id, kind: "movie" as const, tmdbId: 693134 };
    expect(requests.stateFor({ ...base, inLibrary: false, availability: [] })).toEqual({ requestable: true });
    expect(requests.stateFor({ ...base, inLibrary: true, availability: ["jellyfin"] })).toEqual({ requestable: false });
    expect(requests.stateFor({ ...base, inLibrary: false, availability: ["xtream"] })).toEqual({ requestable: false });
    await requests.create(dad, dune);
    expect(requests.stateFor({ ...base, inLibrary: false, availability: [] })).toMatchObject({ requestable: false, request: { status: "requested" } });
    expect(setup(undefined).requests.stateFor({ ...base, inLibrary: false, availability: [] })).toBeUndefined();
    expect(requests.badgeFor(dune.id)).toBe("Requested");
  });

  it("lists a profile's own requests on Home", async () => {
    const { requests } = setup(SEERR, { "POST /api/v1/request": { id: 7 } });
    await requests.create(dad, dune);
    await requests.create(mia, slow);
    expect(requests.homeItems(dad).map((t) => t.name)).toEqual(["Dune: Part Two"]);
    expect(requests.homeItems(mia).map((t) => [t.name, t.badges])).toEqual([["Slow Horses", ["Waiting for a grown-up"]]]);
  });
});

describe("Radarr and Sonarr direct", () => {
  const ARR: RequestSettings = { radarr: { url: "http://radarr:7878", apiKey: "r" }, sonarr: { url: "http://sonarr:8989", apiKey: "s" } };
  const routes = {
    "GET /api/v3/movie?tmdbId=693134": [],
    "GET /api/v3/movie/lookup/tmdb?tmdbId=693134": { title: "Dune: Part Two", tmdbId: 693134, year: 2024 },
    "GET /api/v3/qualityprofile": [{ id: 4 }],
    "GET /api/v3/rootfolder": [{ path: "/movies" }],
    "POST /api/v3/movie": { id: 55 },
    "GET /api/v3/series/lookup?term=tvdb%3A81189": [{ title: "Slow Horses", tvdbId: 81189 }],
    "POST /api/v3/series": { id: 12 },
    "GET /api/v3/queue?page=1&pageSize=200": { records: [{ movieId: 55 }] },
  };

  it("adds a film to Radarr with its first profile and folder, and searches for it", async () => {
    const { requests, calls } = setup(ARR, routes);
    expect(requests.view(dad).via).toBe("arr");
    const { request } = await requests.create(dad, dune);
    expect(request.status).toBe("requested");
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ tmdbId: 693134, qualityProfileId: 4, rootFolderPath: "/movies", monitored: true, addOptions: { searchForMovie: true } });
  });

  it("adds a series to Sonarr by its TheTVDB id", async () => {
    const { requests, calls } = setup(ARR, routes);
    await requests.create(dad, slow);
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ tvdbId: 81189, qualityProfileId: 4, rootFolderPath: "/movies", addOptions: { monitor: "all", searchForMissingEpisodes: true } });
  });

  it("sees a film downloading, then arrive", async () => {
    let file = false;
    const { requests, sent } = setup(ARR, { ...routes, "GET /api/v3/movie/55": () => ({ hasFile: file }) });
    const { request } = await requests.create(dad, dune);
    await requests.refresh();
    expect(requests.get(request.id)?.status).toBe("downloading");
    file = true;
    expect(await requests.refresh()).toBe(1);
    expect(sent.some((e) => e.type === "request.ready")).toBe(true);
  });

  it("only offers what is set up: Radarr alone can't take a series", async () => {
    const { requests } = setup({ radarr: ARR.radarr! }, routes);
    expect(requests.enabled("movie")).toBe(true);
    expect(requests.enabled("series")).toBe(false);
    await expect(requests.create(dad, slow)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("Test button", () => {
  it("names the program and its version", async () => {
    const { requests } = setup(undefined, { "GET /api/v1/status": { version: "2.1.0" }, "GET /api/v1/auth/me": { id: 1 } });
    expect(await requests.test("jellyseerr", { url: "http://seerr:5055", apiKey: "k" })).toMatchObject({ ok: true, detail: "Jellyseerr/Overseerr 2.1.0" });
  });

  it("says when the key is wrong, or Radarr has nowhere to put a film", async () => {
    const a = setup(undefined, { "GET /api/v1/status": { version: "2" }, "GET /api/v1/auth/me": new Response("no", { status: 403 }) });
    expect(await a.requests.test("jellyseerr", { url: "http://x", apiKey: "bad" })).toMatchObject({ ok: false, error: "It didn't accept the API key" });
    const b = setup(undefined, { "GET /api/v3/system/status": { appName: "Radarr", version: "5.9" }, "GET /api/v3/qualityprofile": [{ id: 1 }], "GET /api/v3/rootfolder": [] });
    expect((await b.requests.test("radarr", { url: "http://x", apiKey: "k" })).error).toMatch(/no root folder/);
    expect(await b.requests.test("sonarr", { url: "", apiKey: "" })).toMatchObject({ ok: false });
  });
});

describe("Settings from the setup page", () => {
  it("keeps the saved key when the key box is blank, and drops a program whose address is cleared", () => {
    const saved: RequestSettings = { jellyseerr: { url: "http://old", apiKey: "secret" }, radarr: { url: "http://r", apiKey: "rk" } };
    expect(mergeRequestSettings(saved, { jellyseerr: { url: "http://new:5055/", apiKey: "" }, radarr: { url: "" } })).toEqual({ jellyseerr: { url: "http://new:5055", apiKey: "secret" } });
    expect(mergeRequestSettings(saved, {})).toEqual(saved);
  });

  it("refuses a bad address or a missing key", () => {
    expect(() => mergeRequestSettings(undefined, { sonarr: { url: "sonarr:8989", apiKey: "k" } })).toThrow(/http/);
    expect(() => mergeRequestSettings(undefined, { sonarr: { url: "http://s", apiKey: "" } })).toThrow(/API key/);
  });
});
