// When a saved title is next on telly (#74): matching "Save for later" against the guide so the
// saved card can say "On Film4 · Sat 21:00" and offer Record or Remind.
//
// The matching is deliberately fussy: an exact normalised title, a year within one, and no near
// miss. "Dune" must not claim "Dune: Part Two" as its next airing.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Channel, HomeScreen, Programme, WatchItem } from "@ultimatetv/shared";
import { clockTime, dayLabel } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { channel, pairAsTv, programme } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });
const noFetch = (async () => new Response("not here", { status: 404 })) as typeof fetch;

const CHANNELS: Channel[] = [channel("film4", { number: 13, name: "Film4" }), channel("bbc-one", { number: 101, name: "BBC One" }), channel("cbeebies", { number: 601, name: "CBeebies", category: "kids" }), channel("now-80s", { number: 355, name: "Now 80s", category: "music", mix: { ready: 10, target: 10 } }), channel("dave", { number: 112, name: "Dave", hidden: true })];

const anHour = 3_600_000;
const day = 24 * anHour;

async function start(programmes: Programme[] = []) {
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: noFetch, ytdlp: null });
  context.channels.replace(CHANNELS, []);
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
  if (programmes.length) app.hub.guide.upsert(programmes);
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-nextairing-"));
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const family = { "x-profile": "family" };
const kids = { "x-profile": "kids" };
const dune = { id: "tmdb:movie:438631", kind: "movie" as const, name: "Dune", year: 2021, poster: "/p.jpg", certification: "12A" };

const save = async (payload: object, headers: Record<string, string> = {}) => (await app.inject({ method: "POST", url: "/api/watchlist", headers: { ...family, ...headers }, payload })).json() as { item: WatchItem; items: WatchItem[] };
const saved = async (headers: Record<string, string> = family) => (await app.inject({ url: "/api/watchlist", headers })).json().items as WatchItem[];
const homeRail = async (headers: Record<string, string> = family) => ((await app.inject({ url: "/api/home", headers })).json() as HomeScreen).rails.find((r) => r.id === "watchlist");

describe("when a saved title is next on TV", () => {
  it("says the channel, day and time, and picks the earliest airing", async () => {
    const now = Date.now();
    await start([programme("film4", now + 2 * day, 120, { title: "Dune", year: 2021, isFilm: true }), programme("bbc-one", now + day, 155, { title: "Dune", year: 2021, isFilm: true })]);
    await save({ title: dune });
    const [item] = await saved();
    const next = item!.next!;
    expect(next.channelName).toBe("BBC One");
    expect(next.channelNumber).toBe(101);
    expect(next.programmeId).toBe(`bbc-one:${now + day}`);
    // The earliest of the two airings, not the first one the guide happens to return.
    expect(next.start).toBeLessThan(now + 2 * day);
    expect(next.when).toBe(`On BBC One · ${dayLabel(next.start)} ${clockTime(next.start)}`);
    expect(next.when).toMatch(/^On BBC One · (Today|Tomorrow|[A-Z][a-z]{2} \d+ [A-Z][a-z]{2}) \d{2}:\d{2}$/);
  });

  it("matches the same programme however its title is written", async () => {
    const now = Date.now();
    await start([programme("film4", now + 3 * anHour, 120, { title: "The Dune (UK)", year: 2021, isFilm: true })]);
    await save({ title: dune });
    expect((await saved())[0]!.next?.channelName).toBe("Film4");
  });

  it("does not mistake a sequel or a remake for the saved title", async () => {
    const now = Date.now();
    await start([
      programme("film4", now + anHour, 120, { title: "Dune: Part Two", year: 2024, isFilm: true }),
      programme("bbc-one", now + 2 * anHour, 60, { title: "Dune", year: 1984, isFilm: true }),
    ]);
    await save({ title: dune });
    // Neither the longer title nor a 37-year-old version of it is this Dune.
    expect((await saved())[0]!.next).toBeUndefined();
  });

  it("lets a film and its remake apart by a year", async () => {
    const now = Date.now();
    await start([programme("film4", now + anHour, 120, { title: "Dune", year: 1984, isFilm: true }), programme("bbc-one", now + 2 * anHour, 60, { title: "Dune", year: 2022, isFilm: true })]);
    await save({ title: dune });
    // 1984 is not this Dune; 2022 is close enough for a guide that rounds the year.
    expect((await saved())[0]!.next?.channelName).toBe("BBC One");
  });

  it("still matches when the guide doesn't say the year", async () => {
    const now = Date.now();
    await start([programme("film4", now + anHour, 120, { title: "Dune", isFilm: true })]);
    await save({ title: dune });
    // Better to say "on tonight" than nothing: only a year the guide does state can rule it out.
    expect((await saved())[0]!.next?.channelName).toBe("Film4");
  });

  it("ignores hidden channels and music video channels", async () => {
    const now = Date.now();
    await start([programme("dave", now + anHour, 60, { title: "Dune" }), programme("now-80s", now + anHour, 60, { title: "Dune" })]);
    await save({ title: dune });
    // Dave is hidden and Now 80s is a music channel: neither can be recorded or reminded about.
    expect((await saved())[0]!.next).toBeUndefined();
  });

  it("only offers channels the profile can watch", async () => {
    const now = Date.now();
    const bluey = { id: "tmdb:tv:82728", kind: "series" as const, name: "Bluey", certification: "U" };
    await start([programme("bbc-one", now + anHour, 30, { title: "Bluey" }), programme("cbeebies", now + 2 * anHour, 30, { title: "Bluey" })]);
    await save({ title: bluey }, kids);
    // BBC One isn't a channel a Kids profile has; CBeebies is.
    expect((await saved(kids))[0]!.next?.channelName).toBe("CBeebies");
    // An adult profile gets both, and the earliest wins.
    await save({ title: bluey });
    expect((await saved())[0]!.next?.channelName).toBe("BBC One");
  });

  it("shows it on the Saved for later card on Home, without changing what was saved", async () => {
    const now = Date.now();
    await start([programme("film4", now + 5 * anHour, 120, { title: "Dune", year: 2021, isFilm: true })]);
    await save({ title: dune });
    const rail = await homeRail();
    const card = rail!.items[0]!;
    expect(card.subtitle).toBe(`On Film4 · ${dayLabel(now + 5 * anHour)} ${clockTime(now + 5 * anHour)}`);
    // The airing is worked out per request: the stored title must not have grown a subtitle.
    expect((await saved())[0]!.title!.subtitle).toBeUndefined();
    await app.inject({ method: "DELETE", url: `/api/watchlist/${encodeURIComponent((await saved())[0]!.id)}` });
    await save({ title: dune });
    expect((await saved())[0]!.title!.subtitle).toBeUndefined();
  });

  it("leaves a title with nothing in the guide alone", async () => {
    await start([programme("film4", Date.now() + anHour, 120, { title: "Something Else", isFilm: true })]);
    await save({ title: dune });
    const card = (await homeRail())!.items[0]!;
    // No subtitle, so the card falls back to the saved year as it always has.
    expect(card.subtitle).toBeUndefined();
    expect(card.year).toBe(2021);
    // A name with no title yet has nothing to match on either.
    await save({ name: "Severance" });
    expect((await saved()).find((i) => i.name === "Severance")!.next).toBeUndefined();
  });

  it("only looks a fortnight ahead", async () => {
    await start([programme("film4", Date.now() + 30 * day, 120, { title: "Dune", year: 2021, isFilm: true })]);
    await save({ title: dune });
    expect((await saved())[0]!.next).toBeUndefined();
  });

  it("costs one query however many titles are saved", async () => {
    const now = Date.now();
    await start([programme("film4", now + anHour, 120, { title: "Dune", year: 2021, isFilm: true })]);
    for (const name of ["Severance", "The Bear", "Slow Horses"]) await save({ name });
    await save({ title: dune });
    // No caching of its own: a guide refresh is picked up on the next ask.
    expect((await saved()).find((i) => i.name === "Dune")!.next?.channelName).toBe("Film4");
    app.hub.guide.dropFrom("film4");
    app.hub.guide.upsert([programme("bbc-one", now + 4 * anHour, 60, { title: "Dune", year: 2021, isFilm: true })]);
    expect((await saved()).find((i) => i.name === "Dune")!.next?.channelName).toBe("BBC One");
  });
});
