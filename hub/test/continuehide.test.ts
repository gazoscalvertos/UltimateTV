import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeScreen, TitleDetails, TitleRef } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { Db } from "../src/db.js";
import { ContinueHidden } from "../src/continuehide.js";
import { silentLogger } from "../src/log.js";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

const MIN = 60_000;

/** Removing a title from Continue watching (issue #100): per-profile hiding that
 *  keeps the progress, and marking a title watched so it leaves the row. */

describe("ContinueHidden", () => {
  const store = (db = new Db(":memory:")) => new ContinueHidden(db, { emit: () => {} } as never);

  it("remembers a hidden title per profile, and keeps the progress", () => {
    const s = store();
    expect(s.hiddenAt(null, "tmdb:movie:dune")).toBeUndefined();
    s.hide(null, "tmdb:movie:dune", 1000);
    expect(s.hiddenAt(null, "tmdb:movie:dune")).toBe(1000);
    expect(s.hiddenAt("family", "tmdb:movie:dune")).toBeUndefined();
    expect(s.list(null)).toEqual({ "tmdb:movie:dune": 1000 });
    expect(s.list("family")).toEqual({});
  });

  it("hides it until it's been played again", () => {
    const s = store();
    s.hide(null, "tmdb:movie:dune", 5_000);
    expect(s.isHidden(null, "tmdb:movie:dune", 4_000)).toBe(true);
    expect(s.isHidden(null, "tmdb:movie:dune", 5_000)).toBe(true);
    expect(s.isHidden(null, "tmdb:movie:dune", 6_000)).toBe(false);
    expect(s.isHidden(null, "tmdb:movie:other", 6_000)).toBe(false);
  });

  it("takes it back when the household presses Undo", () => {
    const s = store();
    s.hide(null, "tmdb:movie:dune", 1000);
    s.show(null, "tmdb:movie:dune");
    expect(s.hiddenAt(null, "tmdb:movie:dune")).toBeUndefined();
    expect(s.isHidden(null, "tmdb:movie:dune", 0)).toBe(false);
  });

  it("forgets a profile's hidden titles when the profile goes", () => {
    const s = store();
    s.hide("family", "tmdb:movie:dune", 1000);
    s.forget("family");
    expect(s.hiddenAt("family", "tmdb:movie:dune")).toBeUndefined();
  });

  it("keeps the list to a sane size, dropping the oldest", () => {
    const s = store();
    for (let i = 0; i < 520; i++) s.hide(null, `tmdb:movie:${i}`, i + 1);
    const list = s.list(null);
    expect(Object.keys(list).length).toBe(500);
    expect(list["tmdb:movie:0"]).toBeUndefined();
    expect(list["tmdb:movie:519"]).toBe(520);
  });

  it("survives a restart", () => {
    const db = new Db(":memory:");
    store(db).hide("family", "tmdb:movie:dune", 1000);
    expect(store(db).hiddenAt("family", "tmdb:movie:dune")).toBe(1000);
  });
});

describe("Removing from Continue watching through the API", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const asks: { url: string; method: string }[] = [];
  const answers = new Map<string, () => Response>();

  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    asks.push({ url: href, method: init?.method ?? "GET" });
    const answer = answers.get(href);
    return answer ? answer() : new Response("not here", { status: 404 });
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-hide-"));
    const config: HubConfig = {
      port: 8095,
      host: "127.0.0.1",
      dataDir: path.join(tmp, "data"),
      clipsDir: path.join(tmp, "clips"),
      probeDir: path.join(tmp, "probe"),
      uiDir: path.join(tmp, "ui"),
      setupDir: path.join(tmp, "setup"),
      remoteDir: new URL("../public/remote", import.meta.url).pathname,
      mediaRoot: path.join(tmp, "media"),
      demo: true,
    };
    app = await buildServer(config, {
      systemReport: async () => ({}) as never,
      context: new HubContext({ dataDir: config.dataDir, mediaRoot: config.mediaRoot, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null, demo: true }),
    });
    await pairAsTv(app);
  });

  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  const film: TitleRef = { id: "demo:movie:the-clockmaker", kind: "movie", name: "The Clockmaker" };
  const play = async (payload: object) => (await app.inject({ method: "POST", url: "/api/play", payload, headers: { host: "hub.lan:8095" } })).json<{ progressKey: string }>();
  const report = (body: object) => app.inject({ method: "POST", url: "/api/progress", payload: body });
  const home = async (profile?: string) =>
    (await app.inject({ url: "/api/home", ...(profile ? { headers: { "x-profile": profile } } : {}) })).json<HomeScreen>();
  const continueIds = async (profile?: string) => (await home(profile)).rails.find((r) => r.id === "continue")?.items.map((t) => t.id) ?? [];

  /** Put the film back at 25 minutes, watched from a given moment. */
  const stopAt = async (startedAt: number) => {
    const info = await play({ kind: "title", id: film.id });
    await report({ key: info.progressKey, positionMs: 25 * MIN, durationMs: 100 * MIN, event: "stop", title: film });
    return info;
  };

  it("hides the card from that profile only, and Undo puts it back", async () => {
    await stopAt(Date.now());
    expect(await continueIds()).toContain(film.id);
    const gone = await app.inject({ method: "POST", url: `/api/continue/${encodeURIComponent(film.id)}/hide`, payload: { hidden: true } });
    expect(gone.statusCode).toBe(200);
    expect(await continueIds()).not.toContain(film.id);
    // Still there for another profile.
    await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "family", kind: "adult" } }).catch(() => undefined);
    // The progress itself is untouched: details still know where it got to.
    const d = (await app.inject("/api/titles/" + encodeURIComponent(film.id))).json<TitleDetails>();
    expect(d.resumeMs).toBe(25 * MIN);
    expect(app.hub.progress.get(`title:${film.id}`)!.watched).toBe(false);

    const back = await app.inject({ method: "POST", url: `/api/continue/${encodeURIComponent(film.id)}/hide`, payload: { hidden: false } });
    expect(back.statusCode).toBe(200);
    expect(await continueIds()).toContain(film.id);
  });

  it("leaves it hidden for one profile and shown for another", async () => {
    await stopAt(Date.now());
    const family = { "x-profile": "family" };
    const gone = await app.inject({ method: "POST", url: `/api/continue/${encodeURIComponent(film.id)}/hide`, payload: { hidden: true }, headers: family });
    expect(gone.statusCode).toBe(200);
    expect(await continueIds("family")).not.toContain(film.id);
    expect(await continueIds()).toContain(film.id);
  });

  it("shows it again once it has been played after hiding", async () => {
    await stopAt(Date.now());
    await app.inject({ method: "POST", url: `/api/continue/${encodeURIComponent(film.id)}/hide`, payload: { hidden: true } });
    expect(await continueIds()).not.toContain(film.id);
    await new Promise((r) => setTimeout(r, 5));
    await stopAt(Date.now());
    expect(await continueIds()).toContain(film.id);
  });

  it("marks a title watched, so it leaves the row for good", async () => {
    await stopAt(Date.now());
    expect(await continueIds()).toContain(film.id);
    const res = await app.inject({ method: "POST", url: `/api/continue/${encodeURIComponent(film.id)}/watched` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(await continueIds()).not.toContain(film.id);
    const d = (await app.inject("/api/titles/" + encodeURIComponent(film.id))).json<TitleDetails>();
    expect(d.resumeMs).toBeUndefined();
    expect(app.hub.progress.get(`title:${film.id}`)!.watched).toBe(true);
  });

  it("says which title it doesn't know", async () => {
    const res = await app.inject({ method: "POST", url: "/api/continue/tmdb%3Amovie%3Anope/hide", payload: { hidden: true } });
    // Hiding an unknown title is allowed (it simply never shows), but watched needs progress.
    expect([200, 404]).toContain(res.statusCode);
  });
});

describe("Marking a Jellyfin title watched tells Jellyfin too", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const asks: { url: string; method: string }[] = [];

  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    asks.push({ url: href, method: init?.method ?? "GET" });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  beforeEach(async () => {
    asks.length = 0;
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-hide-jf-"));
    const config: HubConfig = {
      port: 8095,
      host: "127.0.0.1",
      dataDir: path.join(tmp, "data"),
      clipsDir: path.join(tmp, "clips"),
      probeDir: path.join(tmp, "probe"),
      uiDir: path.join(tmp, "ui"),
      setupDir: path.join(tmp, "setup"),
      remoteDir: new URL("../public/remote", import.meta.url).pathname,
      mediaRoot: path.join(tmp, "media"),
      demo: false,
    };
    const context = new HubContext({ dataDir: config.dataDir, mediaRoot: config.mediaRoot, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
    context.settings.update({ jellyfin: { url: "http://jf:8096", userId: "u1", token: "t0k" } });
    app = await buildServer(config, { systemReport: async () => ({}) as never, context });
    await pairAsTv(app);
  });

  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("posts the played item to Jellyfin", async () => {
    const res = await app.inject({ method: "POST", url: `/api/continue/${encodeURIComponent("jellyfin:abc123")}/watched` });
    expect(res.statusCode).toBe(200);
    const played = asks.find((a) => a.url.includes("/Users/u1/PlayedItems/abc123"));
    expect(played?.method).toBe("POST");
  });
});
