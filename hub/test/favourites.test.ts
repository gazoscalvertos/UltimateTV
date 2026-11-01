// Favourites per profile: films, shows and guide channels, kept apart for each profile, the
// household's channel stars copied to every profile once, and the guide and Home following the
// profile watching.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Channel, FavouriteResult, Favourites, GuideChoices, HubEvent } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { channel, pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });
const noFetch = (async () => new Response("not here", { status: 404 })) as typeof fetch;
const newContext = () => new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: noFetch, ytdlp: null });

/** Starts the Hub; `before` runs on its database first (the channel list as it was before favourites per profile). */
async function start(before?: (ctx: HubContext) => void) {
  const context = newContext();
  before?.(context);
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
}

const CHANNELS: Channel[] = [channel("bbc-one", { number: 101 }), channel("itv", { number: 103, favourite: true }), channel("cbeebies", { number: 601, category: "kids", favourite: true })];

const family = { "x-profile": "family" };
const kids = { "x-profile": "kids" };
const dune = { id: "tmdb:movie:438631", kind: "movie", name: "Dune", year: 2021, poster: "/p.jpg", certification: "12A", progress: 0.4 };
const bluey = { id: "tmdb:tv:82728", kind: "series", name: "Bluey", genres: ["Animation", "Kids"] };

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-favourites-"));
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const favs = async (headers: Record<string, string>) => (await app.inject({ url: "/api/favourites", headers })).json() as Favourites;
const star = async (headers: Record<string, string>, payload: object) => app.inject({ method: "POST", url: "/api/favourites", headers, payload });

describe("favourites per profile", () => {
  it("copies the household's favourite channels to every profile, once", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    expect((await favs(family)).channels.sort()).toEqual(["cbeebies", "itv"]);
    // Kids see only the channels their profile allows.
    expect((await favs(kids)).channels).toEqual(["cbeebies"]);
    await star(family, { channel: "itv", on: false });
    await app.close();
    // Starting again doesn't copy them over a second time.
    await start();
    expect((await favs(family)).channels).toEqual(["cbeebies"]);
  });

  it("keeps each profile's favourites to itself", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    const seen: HubEvent[] = [];
    app.hub.events.on((e) => seen.push(e));
    const r = (await star(family, { title: dune })).json() as FavouriteResult;
    expect(r.on).toBe(true);
    // The progress bar isn't kept.
    expect(r.titles[0]!.title).toEqual({ id: dune.id, kind: "movie", name: "Dune", year: 2021, poster: "/p.jpg", certification: "12A" });
    await star(family, { channel: "bbc-one" });
    expect((await favs(kids)).titles).toEqual([]);
    expect((await favs(kids)).channels).toEqual(["cbeebies"]);
    // Leaving `on` out flips it.
    expect((await star(family, { channel: "bbc-one" })).json().on).toBe(false);
    expect(seen.filter((e) => e.type === "favourites.changed").map((e) => (e as { profileId: string | null }).profileId)).toEqual(["family", "family", "family"]);
  });

  it("puts the profile's channels in the guide's Favourites list and its titles on Home", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    await star(family, { channel: "itv", on: false });
    await star(family, { channel: "bbc-one", on: true });
    await star(family, { title: dune });
    const guides = (await app.inject({ url: "/api/guides", headers: family })).json() as GuideChoices;
    expect(guides.choices.find((c) => c.id === "favourites")?.count).toBe(2);
    const listed = (await app.inject({ url: "/api/guide?category=favourites", headers: family })).json().channels.map((c: Channel) => c.id);
    expect(listed.sort()).toEqual(["bbc-one", "cbeebies"]);
    // The household's stars (no profile) are untouched.
    const household = (await app.inject("/api/channels")).json().channels.filter((c: Channel) => c.favourite).map((c: Channel) => c.id);
    expect(household.sort()).toEqual(["cbeebies", "itv"]);
    const home = (await app.inject({ url: "/api/home", headers: family })).json();
    expect(home.rails.find((r: { id: string }) => r.id === "favourites")?.items.map((t: { name: string }) => t.name)).toEqual(["Dune"]);
    expect((await app.inject({ url: "/api/home", headers: kids })).json().rails.some((r: { id: string }) => r.id === "favourites")).toBe(false);
  });

  it("lets Kids star only what they may watch", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    expect((await star(kids, { title: dune })).statusCode).toBe(403);
    expect((await star(kids, { channel: "itv" })).statusCode).toBe(404);
    expect((await star(kids, { title: bluey })).json().on).toBe(true);
    expect((await star(family, {})).statusCode).toBe(400);
    expect((await star(family, { title: { id: "x", kind: "episode", name: "X" } })).statusCode).toBe(400);
  });

  it("with no profile, stars the household's channel", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    expect((await star({}, { channel: "bbc-one" })).json().on).toBe(true);
    expect(app.hub.channels.get("bbc-one")?.favourite).toBe(true);
    // A profile's own list is separate.
    expect((await favs(family)).channels).not.toContain("bbc-one");
  });

  it("forgets a deleted profile's favourites", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    const p = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Gran", kind: "adult" } })).json();
    const gran = { "x-profile": p.id as string };
    // Profiles made after the copy start with no favourites.
    expect((await favs(gran)).channels).toEqual([]);
    await star(gran, { title: dune });
    await app.inject({ method: "DELETE", url: `/api/profiles/${p.id}` });
    expect(app.hub.db.getKv(`favourites:${p.id}`)).toBeNull();
  });
});
