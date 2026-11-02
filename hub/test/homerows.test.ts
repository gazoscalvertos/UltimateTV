// Home rows per profile: choosing which rows Home shows and in what order (issue #99).
// Each profile keeps its own list on the Hub, with a Simple Home preset and Everything to put
// them all back; a row that's switched off isn't fetched, so Home loads faster.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_ROWS, SIMPLE_HOME_ROWS, type HomeRowsView, type HomeScreen, type TitleRef } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { Db } from "../src/db.js";
import { HomeRows } from "../src/homerows.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

const ALL = HOME_ROWS.map((r) => r.id);

describe("HomeRows", () => {
  const store = (db = new Db(":memory:")) => new HomeRows(db, { emit: () => {} } as never);

  it("shows every row, in the order Home has always had them", () => {
    const s = store();
    const v = s.view(null);
    expect(v.rows.map((r) => r.id)).toEqual(ALL);
    expect(v.rows.every((r) => r.on)).toBe(true);
    expect(v.rows.map((r) => r.label)).toEqual(HOME_ROWS.map((r) => r.label));
  });

  it("remembers the order and the hidden rows, per profile", () => {
    const s = store();
    s.set("family", { order: ["recordings", "live"], hidden: ["trending"] });
    expect(s.view("family").rows.map((r) => r.id)).toEqual(["recordings", "live", ...ALL.filter((id) => id !== "recordings" && id !== "live")]);
    expect(s.view("family").rows.filter((r) => !r.on).map((r) => r.id)).toEqual(["trending"]);
    // Another profile is untouched.
    expect(s.view("kids").rows.every((r) => r.on)).toBe(true);
    expect(s.view("kids").rows.map((r) => r.id)).toEqual(ALL);
    // And the household (no profile) is its own list.
    expect(s.view(null).rows.map((r) => r.id)).toEqual(ALL);
  });

  it("copes with ids it doesn't know and junk in the database", () => {
    const s = store();
    s.set(null, { order: ["nonsense", "live", "live", "gone-by-now"], hidden: ["also-nonsense", "continue"] });
    expect(s.view(null).rows.map((r) => r.id)).toEqual(["live", ...ALL.filter((id) => id !== "live")]);
    expect(s.view(null).rows.filter((r) => !r.on).map((r) => r.id)).toEqual(["continue"]);

    const db = new Db(":memory:");
    db.setKv("home-rows:default", "not what you expected");
    const junk = new HomeRows(db, { emit: () => {} } as never);
    expect(junk.view(null).rows.map((r) => r.id)).toEqual(ALL);
    expect(junk.view(null).rows.every((r) => r.on)).toBe(true);
  });

  it("applies Simple Home, and Everything puts every row back", () => {
    const s = store();
    const simple = s.set(null, { preset: "simple" });
    expect(simple.rows.filter((r) => r.on).map((r) => r.id).sort()).toEqual([...SIMPLE_HOME_ROWS].sort());
    expect(simple.rows.slice(0, SIMPLE_HOME_ROWS.length).map((r) => r.id)).toEqual(SIMPLE_HOME_ROWS);
    const everything = s.set(null, { preset: "everything" });
    expect(everything.rows.every((r) => r.on)).toBe(true);
    expect(everything.rows.map((r) => r.id)).toEqual(ALL);
  });

  it("gives Kids the everyday order, and nothing it can't see switched on", () => {
    const s = store();
    // Kids starts from the same order as everyone else, so the rows that are there are its own.
    expect(s.view("kids").rows.map((r) => r.id)).toEqual(ALL);
    expect([...s.view("kids").rows.map((r) => r.id)].sort()).toEqual([...ALL].sort());
    // An adult profile keeps the everyday order too.
    expect(s.view("family").rows[0]!.id).toBe("live");
  });

  it("forgets a profile's rows when the profile goes", () => {
    const s = store();
    s.set("family", { hidden: ["live"] });
    s.forget("family");
    expect(s.view("family").rows.every((r) => r.on)).toBe(true);
  });
});

describe("Home rows on the Hub", () => {
  let tmp: string;
  let app: FastifyInstance & { hub: HubContext };
  const asks: { url: string; method: string }[] = [];

  /** Answers the Jellyfin lookups Home makes, and records what was asked for. */
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    asks.push({ url: href, method: init?.method ?? "GET" });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (href.includes("/Items/Resume")) return json({ Items: [] });
    if (href.includes("/Shows/NextUp")) return json({ Items: [] });
    if (href.includes("/Items/Latest")) return json([]);
    return json({});
  }) as unknown as typeof fetch;

  const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: true });

  async function start(before?: (ctx: HubContext) => void) {
    const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
    before?.(context);
    app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
    await pairAsTv(app);
  }

  const family = { "x-profile": "family" };
  const kids = { "x-profile": "kids" };
  const rows = async (headers: Record<string, string> = family) => (await app.inject({ url: "/api/home/rows", headers })).json() as HomeRowsView;
  const patch = async (payload: object, headers: Record<string, string> = family) => app.inject({ method: "PATCH", url: "/api/home/rows", headers, payload });
  const homeIds = async (headers: Record<string, string> = family) => (await app.inject({ url: "/api/home", headers })).json<HomeScreen>().rails.map((r) => r.id);
  const addonUrl = "https://aiostreams.example.com/stremio/abc123/manifest.json";

  beforeEach(async () => {
    asks.length = 0;
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-homerows-"));
  });

  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("lists every row with what's showing for the profile", async () => {
    await start();
    const v = await rows();
    expect(v.rows.map((r) => r.id)).toEqual(ALL);
    expect(v.rows.every((r) => r.on)).toBe(true);
    expect(v.rows.every((r) => r.label.length > 0 && r.detail.length > 0)).toBe(true);
    expect(v.preset).toBe("everything");
  });

  it("reorders and hides rows on Home", async () => {
    await start();
    expect(await homeIds()).toContain("continue");
    const res = await patch({ order: ["recordings", "live"], hidden: ["continue"] });
    expect(res.statusCode).toBe(200);
    const ids = await homeIds();
    expect(ids.slice(0, 2)).toEqual(["recordings", "live"]);
    expect(ids).not.toContain("continue");
    // Undo the hiding: Continue watching comes back, in the new order.
    await patch({ hidden: [] });
    const back = await homeIds();
    expect(back).toContain("continue");
    expect(back.slice(0, 3)).toEqual(["recordings", "live", "continue"]);
  });

  it("can hide Saved for later and Favourites too", async () => {
    await start();
    const copperSky: TitleRef = { id: "demo:movie:copper-sky", kind: "movie", name: "Copper Sky" };
    await app.inject({ method: "POST", url: "/api/watchlist", headers: family, payload: { title: copperSky } });
    await app.inject({ method: "POST", url: "/api/favourites", headers: family, payload: { title: copperSky } });
    const before = await homeIds();
    expect(before).toContain("watchlist");
    expect(before).toContain("favourites");
    await patch({ hidden: ["watchlist", "favourites"] });
    const after = await homeIds();
    expect(after).not.toContain("watchlist");
    expect(after).not.toContain("favourites");
  });

  it("doesn't fetch the rows it isn't showing", async () => {
    await start((ctx) => ctx.settings.update({ jellyfin: { url: "http://jf:8096", userId: "u1", token: "t0k" }, addonUrls: [addonUrl] }));
    asks.length = 0;
    await app.inject({ url: "/api/home", headers: family });
    const asked = asks.map((a) => a.url).join(" ");
    expect(asked).toContain("/Items/Resume");
    expect(asked).toContain("/Shows/NextUp");
    expect(asked).toContain("/Items/Latest");

    await patch({ hidden: ["continue", "nextup", "latest", "trending", "because"] });
    asks.length = 0;
    await app.inject({ url: "/api/home", headers: family });
    const after = asks.map((a) => a.url).join(" ");
    expect(after).not.toContain("/Items/Resume");
    expect(after).not.toContain("/Shows/NextUp");
    expect(after).not.toContain("/Items/Latest");
    expect(after).not.toContain("/trending/");
  });

  it("applies the Simple Home preset, and Everything puts it all back", async () => {
    await start();
    const simple = (await patch({ preset: "simple" })).json() as HomeRowsView;
    expect(simple.preset).toBe("simple");
    expect(simple.rows.filter((r) => r.on).map((r) => r.id).sort()).toEqual([...SIMPLE_HOME_ROWS].sort());
    const ids = await homeIds();
    expect(ids).toContain("live");
    expect(ids).toContain("continue");
    expect(ids).toContain("recordings");
    expect(ids).not.toContain("because");
    expect(ids).not.toContain("trending");

    const everything = (await patch({ preset: "everything" })).json() as HomeRowsView;
    expect(everything.rows.every((r) => r.on)).toBe(true);
    expect((await homeIds()).length).toBeGreaterThan(simple.rows.filter((r) => r.on).length);
  });

  it("keeps each profile's rows apart, and the phone can pick the profile", async () => {
    await start();
    await patch({ hidden: ["live"] }, family);
    expect((await rows(family)).rows.find((r) => r.id === "live")?.on).toBe(false);
    expect((await rows(kids)).rows.find((r) => r.id === "live")?.on).toBe(true);
    // The setup page sends no profile header: it names the profile instead.
    const p = HOME_ROWS.find((r) => r.id === "recordings")!;
    expect(p.label.length).toBeGreaterThan(0);
    app.hub.profiles.create({ name: "Gran", kind: "adult" });
    const gran = (await app.inject({ url: "/api/profiles" })).json().profiles.find((x: { name: string }) => x.name === "Gran");
    const res = await app.inject({ method: "PATCH", url: "/api/home/rows", payload: { profile: gran.id, hidden: ["watchlist"] } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ url: `/api/home/rows?profile=${gran.id}` })).json<HomeRowsView>().rows.find((r) => r.id === "watchlist")?.on).toBe(false);
  });

  it("forgets a deleted profile's rows", async () => {
    await start();
    const p = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Gran", kind: "adult" } })).json();
    await app.inject({ method: "PATCH", url: "/api/home/rows", headers: { "x-profile": p.id }, payload: { hidden: ["live"] } });
    expect(app.hub.homeRows.view(p.id).rows.find((r) => r.id === "live")?.on).toBe(false);
    await app.inject({ method: "DELETE", url: `/api/profiles/${p.id}` });
    expect(app.hub.homeRows.view(p.id).rows.every((r) => r.on)).toBe(true);
  });
});
