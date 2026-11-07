// "Ask a parent" (#224): a Kids profile asks, the first adult answer wins, Allow once lasts an
// evening, Always allow lands in the existing allow list, and a child can't answer for itself.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KIDS_ASK_LIMIT, KIDS_ASK_ONCE_MS, KIDS_ASK_PENDING_MS, KIDS_ASK_WINDOW_MS, kidsAllowLookup, type KidsAsk, type KidsAllowReply, type KidsSummary } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { Db } from "../src/db.js";
import { KidsAllow } from "../src/kidsallow.js";
import { AskError, KidsAsks } from "../src/kidsasks.js";
import { silentLogger } from "../src/log.js";
import { ContentFilter, ProfileStore } from "../src/profiles.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };

const noFetch = (async () => new Response("not here", { status: 404 })) as typeof fetch;
async function start() {
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: noFetch, ytdlp: null });
  app = (await buildServer({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false }, { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-kidsasks-"));
});
afterEach(async () => {
  if (app) await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const store = () => {
  const db = new Db(":memory:");
  const profiles = new ProfileStore(db);
  const allow = new KidsAllow(db, { emit: () => undefined });
  const events: KidsAsk[] = [];
  const asks = new KidsAsks(db, { emit: (e) => events.push(e.ask) }, allow);
  return { db, profiles, allow, asks, events, kids: profiles.get("kids")! };
};
const dune = { id: "tmdb:movie:1", kind: "movie" as const, name: "Dune" };

describe("the requests on their own", () => {
  it("records a request, announces it, and hands the same one back when asked twice", () => {
    const { asks, kids, events } = store();
    const a = asks.create(kids, dune, 1000);
    expect(a.fresh).toBe(true);
    expect(a.ask).toMatchObject({ profileId: "kids", titleId: dune.id, status: "pending" });
    expect(asks.create(kids, dune, 2000)).toMatchObject({ fresh: false, ask: { id: a.ask.id } });
    expect(events).toHaveLength(1);
    expect(asks.pending(3000)).toHaveLength(1);
  });

  it("limits how often a child can ask, and does not let a No be asked again at once", () => {
    const { asks, kids } = store();
    for (let i = 0; i < KIDS_ASK_LIMIT; i++) asks.create(kids, { id: `tmdb:movie:${i}`, kind: "movie", name: `Film ${i}` }, 1000 + i);
    expect(() => asks.create(kids, { id: "tmdb:movie:99", kind: "movie", name: "Another" }, 2000)).toThrowError(AskError);
    // Once the window has gone the child may ask again.
    expect(asks.create(kids, { id: "tmdb:movie:99", kind: "movie", name: "Another" }, 1000 + KIDS_ASK_WINDOW_MS + 5).fresh).toBe(true);

    const s = store();
    const first = s.asks.create(s.kids, dune, 1000).ask;
    s.asks.answer(first.id, "no", 2000);
    expect(s.asks.create(s.kids, dune, 3000)).toMatchObject({ fresh: false, ask: { status: "no" } });
  });

  it("lets a request lapse after half an hour so the child can ask again", () => {
    const { asks, kids } = store();
    const first = asks.create(kids, dune, 1000).ask;
    const later = 1000 + KIDS_ASK_PENDING_MS + 1;
    expect(asks.pending(later)).toEqual([]);
    expect(() => asks.answer(first.id, "once", later)).toThrowError(/run out of time/);
    expect(asks.create(kids, dune, later)).toMatchObject({ fresh: true });
  });

  it("takes the first answer, and a late one learns who got there first", () => {
    const { asks, kids } = store();
    const ask = asks.create(kids, dune, 1000).ask;
    expect(asks.answer(ask.id, "once", 1500).status).toBe("once");
    try {
      asks.answer(ask.id, "no", 1600);
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ statusCode: 409, ask: { status: "once" } });
    }
  });

  it("adds Always allow to the Kids allow list, and Allow once only for an evening", () => {
    const { asks, allow, kids } = store();
    const a = asks.create(kids, dune, 1000).ask;
    asks.answer(a.id, "always", 1100);
    expect(allow.list("kids").allow.map((e) => e.name)).toEqual(["Dune"]);

    const b = asks.create(kids, { id: "tmdb:movie:2", kind: "movie", name: "Alien" }, 1200).ask;
    asks.answer(b.id, "once", 1300);
    expect(allow.list("kids").allow.map((e) => e.name)).toEqual(["Dune"]);
    expect(asks.grants("kids", 1400).map((g) => g.name)).toEqual(["Alien"]);
    expect(asks.grants("kids", 1300 + KIDS_ASK_ONCE_MS + 1)).toEqual([]);
  });

  it("never gives a Guest an Always allow, since a Guest has no list", () => {
    const { asks, profiles } = store();
    const guest = profiles.create({ name: "Visitor", kind: "guest" });
    const a = asks.create(guest, dune, 1000).ask;
    expect(() => asks.answer(a.id, "always", 1100)).toThrowError(/only for a Kids profile/);
    expect(asks.answer(a.id, "once", 1200).status).toBe("once");
  });

  it("will not take a request from an adult, and forgets a deleted profile", () => {
    const { asks, profiles, kids } = store();
    expect(() => asks.create(profiles.get("family")!, dune)).toThrowError(AskError);
    asks.create(kids, dune);
    asks.forget("kids");
    expect(asks.since("kids", 0)).toEqual([]);
  });

  it("lets an allowed-once title through the rating filter, over a block", () => {
    const { asks, allow, kids } = store();
    allow.add("kids", "block", { id: dune.id, kind: "movie", name: "Dune" });
    const filter = (lookup: ReturnType<typeof kidsAllowLookup>) => new ContentFilter(kids, undefined, lookup);
    const title = { id: dune.id, kind: "movie" as const, name: "Dune", certification: "18", genres: [] };
    expect(filter(kidsAllowLookup(allow.list("kids"))).title(title)).toBe(false);
    const a = asks.create(kids, dune).ask;
    asks.answer(a.id, "once");
    const stored = allow.list("kids");
    const once = asks.grants("kids");
    const keys = new Set(once.map((e) => `${e.kind}:${e.id}`));
    const lookup = kidsAllowLookup({ allow: [...once, ...stored.allow], block: stored.block.filter((e) => !keys.has(`${e.kind}:${e.id}`)) });
    expect(filter(lookup).title(title)).toBe(true);
  });
});

describe("the routes", () => {
  const kidsH = { "x-profile": "kids" };
  const familyH = { "x-profile": "family" };
  const ask = (headers: Record<string, string>, payload: object = { id: "tmdb:movie:1", kind: "movie", name: "Dune" }) => app.inject({ method: "POST", url: "/api/kids-asks", headers, payload });

  it("takes a request from Kids, shows it to an adult, and tells the child the answer", async () => {
    await start();
    const made = await ask(kidsH);
    expect(made.statusCode).toBe(200);
    const id = (made.json() as { ask: KidsAsk }).ask.id;
    expect(((await app.inject({ url: "/api/kids-asks", headers: familyH })).json() as { asks: KidsAsk[] }).asks.map((a) => a.id)).toEqual([id]);
    // The child sees only its own, and no PIN or hash is anywhere in it.
    const mine = (await app.inject({ url: "/api/kids-asks", headers: kidsH })).json() as { asks: KidsAsk[] };
    expect(mine.asks[0]).toMatchObject({ id, status: "pending" });
    expect(JSON.stringify(mine)).not.toMatch(/pin|hash|salt/i);

    const ok = await app.inject({ method: "POST", url: `/api/kids-asks/${id}/answer`, headers: familyH, payload: { answer: "always" } });
    expect(ok.statusCode).toBe(200);
    expect(((await app.inject({ url: "/api/kids-asks", headers: kidsH })).json() as { asks: KidsAsk[] }).asks[0]!.status).toBe("always");
    const list = (await app.inject({ url: "/api/kids-allow", headers: familyH })).json() as KidsAllowReply;
    expect(list.profiles[0]!.list.allow.map((e) => e.name)).toEqual(["Dune"]);
    // A second adult answer is too late.
    const late = await app.inject({ method: "POST", url: `/api/kids-asks/${id}/answer`, headers: familyH, payload: { answer: "no" } });
    expect(late.statusCode).toBe(409);
    expect((late.json() as { ask: KidsAsk }).ask.status).toBe("always");
    // And it is on the week's summary.
    const summary = (await app.inject({ url: "/api/kids-summary/kids", headers: familyH })).json() as KidsSummary;
    expect(summary.asks?.map((a) => a.name)).toEqual(["Dune"]);
  });

  it("never lets a child answer, and turns away an adult asking", async () => {
    await start();
    const id = ((await ask(kidsH)).json() as { ask: KidsAsk }).ask.id;
    const own = await app.inject({ method: "POST", url: `/api/kids-asks/${id}/answer`, headers: kidsH, payload: { answer: "once", pin: "1234" } });
    expect(own.statusCode).toBe(403);
    expect((await ask(familyH)).statusCode).toBe(403);
    expect((await ask(kidsH, { id: "", kind: "movie", name: "" })).statusCode).toBe(400);
  });

  it("makes a phone with no profile give an adult PIN once one is set", async () => {
    await start();
    app.hub.profiles.update("family", { pin: "4321" });
    const id = ((await ask(kidsH)).json() as { ask: KidsAsk }).ask.id;
    const url = `/api/kids-asks/${id}/answer`;
    expect((await app.inject({ method: "POST", url, payload: { answer: "once" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, payload: { answer: "once", pin: "0000" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, payload: { answer: "once", pin: "4321" } })).statusCode).toBe(200);
  });

  it("rate limits a child who keeps asking", async () => {
    await start();
    for (let i = 0; i < KIDS_ASK_LIMIT; i++) expect((await ask(kidsH, { id: `tmdb:movie:${i}`, kind: "movie", name: `Film ${i}` })).statusCode).toBe(200);
    expect((await ask(kidsH, { id: "tmdb:movie:9", kind: "movie", name: "One more" })).statusCode).toBe(429);
  });
});
