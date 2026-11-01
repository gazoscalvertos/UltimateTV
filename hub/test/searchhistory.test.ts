import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent, RecentSearch } from "@ultimatetv/shared";
import { matchSearches } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";
import { HomeAssistant } from "../src/homeassistant.js";
import type { HubContext } from "../src/context.js";
import { MAX_SEARCHES } from "../src/searchhistory.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: { events: { on(fn: (e: HubEvent) => void): () => void } } };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

let token = "";
async function start() {
  app = await buildServer(options(), { systemReport: async () => ({}) as never });
  const fresh = await pairAsTv(app);
  if (fresh) token = fresh;
  else {
    // Restarted on the same data: the TV's token from last time still works.
    const inject = app.inject.bind(app) as (o: object) => unknown;
    (app as { inject: unknown }).inject = (o: string | { headers?: Record<string, string> }) => {
      const opts = typeof o === "string" ? { url: o } : o;
      return inject({ ...opts, headers: { "x-device-token": token, ...opts.headers } });
    };
  }
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-searches-"));
  await start();
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const as = (profile?: string) => (profile ? { "x-profile": profile } : {});
const add = (q: string, profile?: string) => app.inject({ method: "POST", url: "/api/search/history", payload: { q }, headers: as(profile) });
const list = async (profile?: string) => ((await app.inject({ url: "/api/search/history", headers: as(profile) })).json().searches as RecentSearch[]).map((s) => s.q);
const profile = async (name: string, kind: "adult" | "kids") => (await app.inject({ method: "POST", url: "/api/profiles", payload: { name, kind } })).json().id as string;

describe("recent searches", () => {
  it("keeps the newest first, folds repeats together and tells the screens", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    await add("Dune");
    await add("bbc one");
    await add("  DUNE  ");
    expect(await list()).toEqual(["DUNE", "bbc one"]);
    expect(events.filter((e) => e.type === "search.history.changed")).toHaveLength(3);
    expect((await add("x")).statusCode).toBe(400);
  });

  it(`holds at most ${MAX_SEARCHES}`, async () => {
    for (let i = 0; i < MAX_SEARCHES + 5; i++) await add(`search ${i}`);
    const all = await list();
    expect(all).toHaveLength(MAX_SEARCHES);
    expect(all[0]).toBe(`search ${MAX_SEARCHES + 4}`);
  });

  it("clears one, then all", async () => {
    for (const q of ["Dune", "Bluey", "News"]) await add(q);
    const one = (await app.inject({ method: "DELETE", url: `/api/search/history?q=${encodeURIComponent("bluey")}` })).json();
    expect(one.ok).toBe(true);
    expect(one.searches.map((s: RecentSearch) => s.q)).toEqual(["News", "Dune"]);
    expect((await app.inject({ method: "DELETE", url: "/api/search/history" })).json().searches).toEqual([]);
    expect(await list()).toEqual([]);
  });

  it("keeps each profile's own, Kids included, and survives a restart", async () => {
    const dad = await profile("Dad", "adult");
    const kids = await profile("Kids", "kids");
    await add("Alien", dad);
    await add("Bluey", kids);
    expect(await list(dad)).toEqual(["Alien"]);
    expect(await list(kids)).toEqual(["Bluey"]);
    expect(await list()).toEqual([]);
    await app.inject({ method: "DELETE", url: "/api/search/history", headers: as(kids) });
    expect(await list(dad)).toEqual(["Alien"]);

    await app.close();
    await start();
    expect(await list(dad)).toEqual(["Alien"]);
  });

  it("gives the phone remote the TV's profile's list", async () => {
    const dad = await profile("Dad", "adult");
    await add("Alien", dad);
    // No TV connected: the household's list.
    expect((await app.inject("/api/search/history?tv=1")).json().searches).toEqual([]);
  });

  it("knows the TV's profile only while the TV app is connected", () => {
    let connected = true;
    const ha = new HomeAssistant((app as unknown as { hub: HubContext }).hub, () => connected);
    expect(ha.tvProfileId()).toBeNull();
    ha.report({ status: "idle", profile: { id: "p1", name: "Gary", kind: "adult" }, playing: null });
    expect(ha.tvProfileId()).toBe("p1");
    connected = false;
    expect(ha.tvProfileId()).toBeNull();
  });
});

describe("suggestions while typing", () => {
  const recent = ["Dune", "Mad dune", "Bluey", "BBC One"].map((q, i) => ({ q, at: i }));
  it("offers everything before typing, then words starting with what's typed", () => {
    expect(matchSearches(recent, "").map((s) => s.q)).toEqual(["Dune", "Mad dune", "Bluey", "BBC One"]);
    expect(matchSearches(recent, "du").map((s) => s.q)).toEqual(["Dune", "Mad dune"]);
    expect(matchSearches(recent, "b").map((s) => s.q)).toEqual(["Bluey", "BBC One"]);
    expect(matchSearches(recent, "dune").map((s) => s.q)).toEqual(["Mad dune"]);
    expect(matchSearches(recent, "un")).toEqual([]);
  });
});
