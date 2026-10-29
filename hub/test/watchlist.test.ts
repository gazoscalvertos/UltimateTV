import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent, Recording, Watchlist } from "@ultimatetv/shared";
import { watchlistMatches } from "@ultimatetv/shared";
import type { HubContext } from "../src/context.js";
import { buildServer } from "../src/server.js";
import { channel, pairAsTv, programme } from "./helpers.js";

let tmp: string;
let app: Awaited<ReturnType<typeof buildServer>> & { hub: HubContext };
const family = { "x-profile": "family" };
const kids = { "x-profile": "kids" };
const HOUR = 3_600_000;

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-watchlist-"));
  app = (await buildServer(options(), { systemReport: async () => ({}) as never })) as typeof app;
  await pairAsTv(app);
  app.hub.channels.replace([channel("film4", { number: 315, name: "Film4" }), channel("cbbc", { number: 601, name: "CBBC", category: "kids" })], []);
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const list = async (headers: Record<string, string> = family, query = "") => (await app.inject({ url: `/api/watchlist${query}`, headers })).json<Watchlist>();
const dune = { id: "tmdb:movie:438631", kind: "movie", name: "Dune", year: 2021, poster: "https://img/dune.jpg", certification: "12A", genres: ["Science Fiction"] };

describe("watchlists", () => {
  it("keeps one per profile and tells the TV when it changes", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    const r = await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: dune }, headers: family });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ added: true, item: { kind: "title", name: "Dune", film: true, year: 2021, image: "https://img/dune.jpg" } });
    expect((await list()).items.map((i) => i.name)).toEqual(["Dune"]);
    expect((await list(kids)).items).toEqual([]);
    expect(events).toContainEqual({ type: "watchlist.changed", profileId: "family" });
  });

  it("doesn't add the same thing twice", async () => {
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: dune }, headers: family });
    const again = (await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: dune }, headers: family })).json();
    expect(again.added).toBe(false);
    expect(again.items).toHaveLength(1);
  });

  it("says when it's next on TV and finds recordings of it", async () => {
    const now = Date.now();
    app.hub.guide.upsert([
      programme("film4", now + 2 * HOUR, 150, { title: "Film: Dune", isFilm: true, year: 2021, seriesKey: "t:film dune" }),
      programme("film4", now + 30 * HOUR, 150, { title: "Dune", isFilm: true, year: 1984, seriesKey: "t:dune" }),
    ]);
    const rec: Recording = {
      id: "r1",
      programme: programme("film4", now - 48 * HOUR, 150, { title: "Dune", isFilm: true, year: 2021 }),
      channelId: "film4",
      channelName: "Film4",
      status: "completed",
      method: "live",
      start: now - 48 * HOUR,
      end: now - 45 * HOUR,
      incomplete: false,
      watched: false,
      positionMs: 0,
      createdAt: now - 48 * HOUR,
      path: "/x.mkv",
    };
    app.hub.recordings.save(rec);
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: dune }, headers: family });
    const [entry] = (await list()).items;
    // The 1984 film of the same name isn't it.
    expect(entry).toMatchObject({ showings: 1, recordings: 1, recordingId: "r1", onTv: { channelName: "Film4", channelNumber: 315 } });
    expect(entry!.onTv!.programme.title).toBe("Film: Dune");
  });

  it("adds a programme from the guide and follows its series", async () => {
    const now = Date.now();
    const ep1 = programme("film4", now + HOUR, 60, { title: "Harbour Lights", seriesKey: "crid:harbour", season: 1, episode: 1 });
    const ep2 = programme("film4", now + 25 * HOUR, 60, { title: "Harbour Lights: Special", seriesKey: "crid:harbour" });
    app.hub.guide.upsert([ep1, ep2]);
    const r = (await app.inject({ method: "POST", url: "/api/watchlist", payload: { programmeId: ep1.id }, headers: family })).json();
    expect(r.item).toMatchObject({ kind: "programme", name: "Harbour Lights", seriesKey: "crid:harbour", film: false });
    expect(r.items[0]).toMatchObject({ showings: 2 });
  });

  it("keeps Kids to their own channels and ratings", async () => {
    const now = Date.now();
    const p = programme("film4", now + HOUR, 60, { title: "Late Film", isFilm: true });
    app.hub.guide.upsert([p]);
    expect((await app.inject({ method: "POST", url: "/api/watchlist", payload: { programmeId: p.id }, headers: kids })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: dune }, headers: kids })).statusCode).toBe(403);
    const cartoon = { id: "tmdb:tv:1", kind: "series", name: "Bluey", certification: "U", genres: ["Kids"] };
    expect((await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: cartoon }, headers: kids })).statusCode).toBe(200);
    expect((await list(kids)).items.map((i) => i.name)).toEqual(["Bluey"]);
  });

  it("lets the phone, which has no profile, name whose watchlist", async () => {
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: dune }, headers: family });
    expect((await app.inject({ url: "/api/watchlist" })).statusCode).toBe(400);
    const w = await list({}, "?profile=family");
    expect(w.profile).toEqual({ id: "family", name: "Family" });
    expect(w.items).toHaveLength(1);
    const del = await app.inject({ method: "DELETE", url: `/api/watchlist/${w.items[0]!.id}?profile=family` });
    expect(del.json().items).toEqual([]);
  });

  it("goes when its profile is deleted", async () => {
    const p = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Sam", kind: "adult" } })).json<{ id: string }>();
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: dune }, headers: { "x-profile": p.id } });
    await app.inject({ method: "DELETE", url: `/api/profiles/${p.id}` });
    expect(app.hub.db.getKv(`watchlist:${p.id}`)).toBeUndefined();
  });
});

describe("watchlistMatches", () => {
  const show = { name: "The Office", film: false, seriesKey: "crid:office" };
  it("matches a series by its key or its name", () => {
    expect(watchlistMatches(show, { title: "Office", seriesKey: "t:office" })).toBe(true);
    expect(watchlistMatches(show, { title: "Something Else", seriesKey: "crid:office" })).toBe(true);
    expect(watchlistMatches(show, { title: "The Office Party", seriesKey: "t:party" })).toBe(false);
  });
  it("needs a film's year to agree when both are known", () => {
    const film = { name: "Dune", film: true, year: 2021 };
    expect(watchlistMatches(film, { title: "Film: Dune", year: 2021 })).toBe(true);
    expect(watchlistMatches(film, { title: "Dune", year: 1984 })).toBe(false);
    expect(watchlistMatches(film, { title: "Dune" })).toBe(true);
  });
});
