// A parent's allow/block list for a Kids profile (#110): the rating limit is blunt, so a parent
// saying "this one's fine" or "not this one" wins over the certificate either way, and the weekly
// summary says what the profile actually watched.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Channel, KidsAllowReply, KidsSummary, Profile } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { Db } from "../src/db.js";
import { KidsAllow } from "../src/kidsallow.js";
import { KidsLockoutLog } from "../src/kidslockouts.js";
import { KidsViewing, dayKey } from "../src/kidsviewing.js";
import { silentLogger } from "../src/log.js";
import { ContentFilter, ProfileStore } from "../src/profiles.js";
import { buildServer } from "../src/server.js";
import { channel, pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });
const noFetch = (async () => new Response("not here", { status: 404 })) as typeof fetch;

async function start(before?: (ctx: HubContext) => void) {
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: noFetch, ytdlp: null });
  before?.(context);
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
}

const CHANNELS: Channel[] = [channel("bbc-one", { number: 101 }), channel("cbeebies", { number: 601, category: "kids" }), channel("film4", { number: 13 })];

const family = { "x-profile": "family" };
const kids = { "x-profile": "kids" };

const allowList = async (headers: Record<string, string>) => (await app.inject({ url: "/api/kids-allow", headers })).json() as KidsAllowReply;
const setAllow = async (id: string, payload: object, headers: Record<string, string> = family) => app.inject({ method: "PATCH", url: `/api/kids-allow/${id}`, headers, payload });
const summaryOf = async (id: string, headers: Record<string, string> = family) => (await app.inject({ url: `/api/kids-summary/${id}`, headers })).json() as KidsSummary;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-kidsallow-"));
});

afterEach(async () => {
  if (app) await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("the allow/block list on its own", () => {
  const store = () => {
    const db = new Db(":memory:");
    const profiles = new ProfileStore(db);
    const allow = new KidsAllow(db, { emit: () => undefined });
    return { db, profiles, allow };
  };

  it("starts empty, and adds to a side newest first", () => {
    const { allow } = store();
    expect(allow.list("kids")).toEqual({ allow: [], block: [] });
    allow.add("kids", "allow", { id: "tmdb:movie:1", kind: "movie", name: "Dune" }, 1);
    const list = allow.add("kids", "allow", { id: "tmdb:movie:2", kind: "movie", name: "Arrival" }, 2);
    expect(list.allow.map((e) => e.name)).toEqual(["Arrival", "Dune"]);
    expect(list.allow[0]).toMatchObject({ id: "tmdb:movie:2", kind: "movie", addedAt: 2 });
  });

  it("moves an entry when a parent changes their mind", () => {
    const { allow } = store();
    allow.add("kids", "block", { id: "tmdb:movie:1", kind: "movie", name: "Dune" }, 1);
    expect(allow.list("kids").block).toHaveLength(1);
    const list = allow.add("kids", "allow", { id: "tmdb:movie:1", kind: "movie", name: "Dune" }, 2);
    expect(list.block).toEqual([]);
    expect(list.allow.map((e) => e.id)).toEqual(["tmdb:movie:1"]);
  });

  it("takes an entry off both sides, and forgets a profile's list", () => {
    const { allow } = store();
    allow.add("kids", "allow", { id: "tmdb:movie:1", kind: "movie", name: "Dune" });
    allow.add("kids", "block", { id: "tmdb:movie:2", kind: "movie", name: "Alien" });
    expect(allow.remove("kids", "movie", "tmdb:movie:1").allow).toEqual([]);
    expect(allow.list("kids").block).toHaveLength(1);
    allow.forget("kids");
    expect(allow.list("kids")).toEqual({ allow: [], block: [] });
  });

  it("keeps one profile's list away from another's", () => {
    const { allow, profiles } = store();
    const second = profiles.create({ name: "Sam", kind: "kids" });
    allow.add("kids", "allow", { id: "tmdb:movie:1", kind: "movie", name: "Dune" });
    expect(allow.list(second.id)).toEqual({ allow: [], block: [] });
  });

  it("ignores junk in the database", () => {
    const { db, allow } = store();
    db.setKv("kids-allow:kids", "not a list");
    expect(allow.list("kids")).toEqual({ allow: [], block: [] });
    db.setKv("kids-allow:kids", { allow: [{ id: "" }, { id: "tmdb:movie:1", kind: "nonsense", name: "Dune" }, 7], block: "no" });
    expect(allow.list("kids")).toEqual({ allow: [], block: [] });
  });
});

describe("what a parent allows beating the rating", () => {
  const ask = (allow: KidsAllow, id: string, kind: "movie" | "series" | "channel", name: string, rest: { certification?: string; genres?: string[] }) => {
    const db = new Db(":memory:");
    const profiles = new ProfileStore(db);
    const filter = new ContentFilter(profiles.get("kids")!, undefined, kidsAllowLookupOf(allow));
    if (kind === "channel") return filter.channel({ ...channel(id, { number: 1, name }), id, name });
    return filter.title({ id, kind, name, certification: rest.certification ?? "", genres: rest.genres ?? [] });
  };
  const kidsAllowLookupOf = (allow: KidsAllow) => {
    const list = allow.list("kids");
    return { allow: new Set(list.allow.map((e) => `${e.kind}:${e.id}`)), block: new Set(list.block.map((e) => `${e.kind}:${e.id}`)), allowNames: new Set(list.allow.map((e) => e.name.toLowerCase())), blockNames: new Set(list.block.map((e) => e.name.toLowerCase())) };
  };

  it("lets an allowed 15 through, and keeps a blocked U back", () => {
    const db = new Db(":memory:");
    const allow = new KidsAllow(db, { emit: () => undefined });
    allow.add("kids", "allow", { id: "tmdb:movie:1", kind: "movie", name: "Dune" });
    allow.add("kids", "block", { id: "tmdb:movie:2", kind: "movie", name: "Peppa" });
    expect(ask(allow, "tmdb:movie:1", "movie", "Dune", { certification: "15" })).toBe(true);
    expect(ask(allow, "tmdb:movie:2", "movie", "Peppa", { certification: "U" })).toBe(false);
    // Left alone, the rating still decides.
    expect(ask(allow, "tmdb:movie:3", "movie", "Alien", { certification: "18" })).toBe(false);
    expect(ask(allow, "tmdb:movie:4", "movie", "Paddington", { certification: "U" })).toBe(true);
  });

  it("matches a broadcast by name, because its id is one airing", () => {
    const db = new Db(":memory:");
    const allow = new KidsAllow(db, { emit: () => undefined });
    allow.add("kids", "allow", { id: "tmdb:movie:1", kind: "movie", name: "Dune" });
    expect(ask(allow, "programme:film4:1793600000000", "movie", "The Dune (UK)", { genres: [] })).toBe(true);
    expect(ask(allow, "programme:film4:1793600000001", "movie", "Dune: Part Two", { genres: [] })).toBe(false);
  });

  it("lets an allowed channel through even when its category says no, and blocks a blocked one", () => {
    const db = new Db(":memory:");
    const allow = new KidsAllow(db, { emit: () => undefined });
    allow.add("kids", "allow", { id: "film4", kind: "channel", name: "Film4" });
    allow.add("kids", "block", { id: "cbeebies", kind: "channel", name: "CBeebies" });
    const profiles = new ProfileStore(db);
    const filter = new ContentFilter(profiles.get("kids")!, undefined, kidsAllowLookupOf(allow));
    expect(filter.channel(channel("film4", { number: 13, name: "Film4", category: "entertainment" }))).toBe(true);
    expect(filter.channel(channel("cbeebies", { number: 601, name: "CBeebies", category: "kids" }))).toBe(false);
  });
});

describe("the weekly summary", () => {
  it("adds up the minutes and lists the titles once, oldest day first", () => {
    const db = new Db(":memory:");
    const viewing = new KidsViewing(db);
    const now = new Date(2026, 10, 2, 12).getTime();
    const day = (back: number) => dayKey(now - back * 86_400_000);
    viewing.record("kids", { id: "tmdb:movie:1", kind: "movie", name: "Dune" }, now - 2 * 86_400_000);
    viewing.record("kids", { id: "tmdb:movie:1", kind: "movie", name: "Dune" }, now - 2 * 86_400_000);
    viewing.record("kids", { id: "tmdb:tv:2", kind: "series", name: "Bluey" }, now);
    const used = new Map<string, number>([
      [day(2), 30 * 60_000],
      [day(0), 12 * 60_000],
      // Outside the window: not in the summary.
      [day(20), 60 * 60_000],
    ]);
    const s = viewing.summary("kids", "Kids", used, [], now, 7);
    expect(s.days.map((d) => d.day)).toEqual([day(6), day(5), day(4), day(3), day(2), day(1), day(0)]);
    expect(s.days.find((d) => d.day === day(2))!.minutes).toBe(30);
    expect(s.days.find((d) => d.day === day(0))!.minutes).toBe(12);
    // Two plays of the same film on the same day, one title in the list.
    expect(s.days.find((d) => d.day === day(2))!.titles).toHaveLength(1);
    expect(s.titles.map((t) => t.name)).toEqual(["Dune", "Bluey"]);
    expect(s.totalMinutes).toBe(42);
    expect(s.from).toBe(day(6));
    expect(s.to).toBe(day(0));
  });

  it("keeps each profile's viewing apart, and a lockout with the profile it was for", () => {
    const db = new Db(":memory:");
    const viewing = new KidsViewing(db);
    const profiles = new ProfileStore(db);
    const second = profiles.create({ name: "Sam", kind: "kids" });
    const now = new Date(2026, 10, 2, 12).getTime();
    viewing.record("kids", { id: "tmdb:movie:1", kind: "movie", name: "Dune" }, now);
    const lockouts = new KidsLockoutLog(db);
    lockouts.add("kids", 5, now);
    lockouts.add(second.id, 1, now);
    expect(viewing.summary("kids", "Kids", new Map(), lockouts.list(), now, 7).titles.map((t) => t.name)).toEqual(["Dune"]);
    expect(viewing.summary("kids", "Kids", new Map(), lockouts.list(), now, 7).lockouts).toHaveLength(1);
    expect(viewing.summary(second.id, "Sam", new Map(), lockouts.list(), now, 7).titles).toEqual([]);
    viewing.forget("kids");
    expect(viewing.summary("kids", "Kids", new Map(), [], now, 7).titles).toEqual([]);
  });

  it("ignores junk titles and non-positive lockouts", () => {
    const db = new Db(":memory:");
    const viewing = new KidsViewing(db);
    const now = Date.now();
    db.setKv("kids-viewing", { kids: { [dayKey(now)]: [{ id: "" }, "nope", { id: "tmdb:movie:1", kind: "nonsense", name: "x" }] } });
    expect(viewing.summary("kids", "Kids", new Map(), [], now, 7).titles).toEqual([]);
    const lockouts = new KidsLockoutLog(db);
    lockouts.add("kids", 0, now);
    lockouts.add("kids", -3, now);
    expect(lockouts.list()).toEqual([]);
    db.setKv("kids-lockouts", "junk");
    expect(lockouts.list()).toEqual([]);
  });
});

describe("the phone's routes", () => {
  it("lists every Kids profile's lists for an adult, and only its own for a Kid", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    const reply = await allowList(family);
    expect(reply.profiles.map((p) => p.profileId)).toEqual(["kids"]);
    expect(reply.profiles[0]!.list).toEqual({ allow: [], block: [] });
    expect((await allowList(kids)).profiles.map((p) => p.profileId)).toEqual(["kids"]);
  });

  it("allows a film from an adult's device, and refuses a Kid doing it", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    const res = await setAllow("kids", { side: "allow", id: "tmdb:movie:1", kind: "movie", name: "Dune" });
    expect(res.statusCode).toBe(200);
    expect(res.json().list.allow.map((e: { name: string }) => e.name)).toEqual(["Dune"]);
    // The Kid sees the list too — it's what it's allowed to watch — but not who else's.
    expect((await allowList(kids)).profiles.map((p) => p.profileId)).toEqual(["kids"]);
    // A Kids profile can't edit its own list.
    const denied = await setAllow("kids", { side: "allow", id: "tmdb:movie:9", kind: "movie", name: "Anything" }, kids);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "pin" });
  });

  it("refuses an adult profile's list, a bad kind and a missing name", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    expect((await setAllow("family", { side: "allow", id: "x", kind: "movie", name: "Dune" })).statusCode).toBe(400);
    expect((await setAllow("kids", { side: "allow", id: "x", kind: "nonsense", name: "Dune" })).statusCode).toBe(400);
    expect((await setAllow("kids", { side: "allow", id: "x", kind: "movie", name: "  " })).statusCode).toBe(400);
    expect((await setAllow("kids", { side: "maybe", id: "x", kind: "movie", name: "Dune" })).statusCode).toBe(400);
    expect((await setAllow("nobody", { side: "allow", id: "x", kind: "movie", name: "Dune" })).statusCode).toBe(404);
  });

  it("takes an entry back off, for the TV's button too", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    await setAllow("kids", { side: "block", id: "tmdb:movie:2", kind: "movie", name: "Peppa" });
    const del = await app.inject({ method: "DELETE", url: "/api/kids-allow/kids/movie/tmdb%3Amovie%3A2", headers: family });
    expect(del.statusCode).toBe(200);
    expect((await allowList(family)).profiles[0]!.list.block).toEqual([]);
  });

  it("answers the week's viewing for a profile, and keeps Kids to their own", async () => {
    await start((ctx) => {
      ctx.channels.replace(CHANNELS, []);
      ctx.kidsViewing.record("kids", { id: "tmdb:movie:1", kind: "movie", name: "Dune" });
      ctx.kidsLockouts.add("kids", 5);
    });
    const s = await summaryOf("kids");
    expect(s.titles.map((t) => t.name)).toEqual(["Dune"]);
    expect(s.lockouts).toHaveLength(1);
    // The phone without a profile (the setup page) sees it too.
    const all = (await app.inject({ url: "/api/kids-summary", headers: family })).json() as { summaries: KidsSummary[] };
    expect(all.summaries.map((x) => x.profileId)).toEqual(["kids"]);
    expect((await app.inject({ url: "/api/kids-summary/family", headers: family })).statusCode).toBe(404);
  });

  it("takes a deleted profile's lists, viewing and lockouts with it", async () => {
    await start((ctx) => ctx.channels.replace(CHANNELS, []));
    const made = (await app.inject({ method: "POST", url: "/api/profiles", headers: family, payload: { name: "Sam", kind: "kids" } })).json() as Profile;
    await setAllow(made.id, { side: "allow", id: "tmdb:movie:1", kind: "movie", name: "Dune" });
    app.hub.kidsViewing.record(made.id, { id: "tmdb:movie:1", kind: "movie", name: "Dune" });
    app.hub.kidsLockouts.add(made.id, 5);
    expect(app.hub.kidsAllow.list(made.id).allow).toHaveLength(1);
    const del = await app.inject({ method: "DELETE", url: `/api/profiles/${made.id}`, headers: family });
    expect(del.statusCode).toBe(200);
    expect(app.hub.kidsAllow.list(made.id)).toEqual({ allow: [], block: [] });
    expect(app.hub.kidsViewing.summary(made.id, "Sam", new Map(), [], Date.now(), 7).titles).toEqual([]);
    expect(app.hub.kidsLockouts.list()).toEqual([]);
  });
});
