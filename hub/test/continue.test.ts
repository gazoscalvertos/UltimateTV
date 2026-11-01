// Continue watching (issue #130): what's saved when something stops, and how Home's row is built.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HomeScreen, PlaybackInfo, TitleDetails, TitleRef } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { Db } from "../src/db.js";
import { ProgressStore } from "../src/progress.js";
import { buildServer } from "../src/server.js";
import { resumeEpisode, type JfItem } from "../src/services/jellyfin.js";
import { pairAsTv } from "./helpers.js";

const MIN = 60_000;
const film = (slug: string): TitleRef => ({ id: `tmdb:movie:${slug}`, kind: "movie", name: slug });
const show: TitleRef = { id: "tmdb:series:1", kind: "series", name: "The Show" };

describe("ProgressStore.continueWatching", () => {
  const store = () => new ProgressStore(new Db(":memory:"));

  it("puts the film stopped last first, with how far it got", () => {
    const s = store();
    s.save({ key: "title:tmdb:movie:a", positionMs: 30 * MIN, durationMs: 100 * MIN, title: film("a") }, 1000);
    s.save({ key: "title:tmdb:movie:b", positionMs: 20 * MIN, durationMs: 100 * MIN, title: film("b") }, 2000);
    const rows = s.continueWatching();
    expect(rows.map((r) => r.title.id)).toEqual(["tmdb:movie:b", "tmdb:movie:a"]);
    expect(rows[0]!.title.progress).toBeCloseTo(0.2);
  });

  it("drops a film once it's past 90%, and ignores a peek under a minute", () => {
    const s = store();
    s.save({ key: "title:tmdb:movie:a", positionMs: 91 * MIN, durationMs: 100 * MIN, title: film("a") }, 1000);
    s.save({ key: "title:tmdb:movie:b", positionMs: 30_000, durationMs: 100 * MIN, title: film("b") }, 2000);
    expect(s.continueWatching()).toEqual([]);
  });

  it("shows a series once, on the episode played last, and the next one when that was finished", () => {
    const s = store();
    s.save({ key: "title:tmdb:series:1|s1e1", positionMs: 50 * MIN, durationMs: 50 * MIN, title: show, next: { episodeId: "s1e2", name: "S1 E2 · Two" } }, 1000);
    s.save({ key: "title:tmdb:series:1|s1e2", positionMs: 10 * MIN, durationMs: 50 * MIN, title: { ...show, subtitle: "S1 E2 · Two" }, next: { episodeId: "s1e3" } }, 2000);
    let rows = s.continueWatching();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: "resume", title: { id: show.id, episodeId: "s1e2", subtitle: "S1 E2 · Two" } });

    // A moment of episode 3 doesn't lose episode 2's place.
    s.save({ key: "title:tmdb:series:1|s1e3", positionMs: 20_000, durationMs: 50 * MIN, title: show }, 3000);
    expect(s.continueWatching()[0]!.title.episodeId).toBe("s1e2");

    // Episode 2 watched to the end: episode 3 is offered instead, from the start.
    s.save({ key: "title:tmdb:series:1|s1e2", positionMs: 48 * MIN, durationMs: 50 * MIN, title: show }, 4000);
    rows = s.continueWatching(20, 5000);
    expect(rows[0]).toMatchObject({ mode: "next", title: { episodeId: "s1e3", subtitle: "Next: S1 E3" } });
    expect(rows[0]!.title.progress).toBeUndefined();
    expect(s.seriesResume(show.id)).toEqual({ episodeId: "s1e3", positionMs: 0 });
  });

  it("drops a finished series with no next episode", () => {
    const s = store();
    s.save({ key: "title:tmdb:series:1|s1e6", positionMs: 50 * MIN, durationMs: 50 * MIN, title: show }, 1000);
    expect(s.continueWatching()).toEqual([]);
  });

  it("keeps the place across a restart", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "utv-progress-"));
    const file = path.join(dir, "hub.db");
    new ProgressStore(new Db(file)).save({ key: "title:tmdb:movie:a", positionMs: 30 * MIN, durationMs: 100 * MIN, title: film("a") });
    expect(new ProgressStore(new Db(file)).continueWatching()[0]?.entry.positionMs).toBe(30 * MIN);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("Jellyfin series: the episode to carry on with", () => {
  const ep = (n: number, data: JfItem["UserData"] = {}): JfItem => ({ Id: `e${n}`, Name: `E${n}`, Type: "Episode", ParentIndexNumber: 1, IndexNumber: n, UserData: data }) as JfItem;

  it("is the last played if stopped part way, else the one after", () => {
    const part = [ep(1, { Played: true, LastPlayedDate: "2026-10-01T00:00:00Z" }), ep(2, { PlaybackPositionTicks: 5e9, LastPlayedDate: "2026-10-02T00:00:00Z" }), ep(3)];
    expect(resumeEpisode(part)?.Id).toBe("e2");
    const done = [ep(1, { Played: true, LastPlayedDate: "2026-10-01T00:00:00Z" }), ep(2, { Played: true, LastPlayedDate: "2026-10-02T00:00:00Z" }), ep(3)];
    expect(resumeEpisode(done)?.Id).toBe("e3");
    expect(resumeEpisode([ep(1), ep(2)])).toBeUndefined();
  });
});

describe("Continue watching through the API (demo Hub)", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-continue-"));
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
    app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
    await pairAsTv(app);
  });

  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const play = async (payload: object) => (await app.inject({ method: "POST", url: "/api/play", payload, headers: { host: "hub.lan:8095" } })).json<PlaybackInfo>();
  const report = (body: object) => app.inject({ method: "POST", url: "/api/progress", payload: body });
  const continueRail = async () => (await app.inject("/api/home")).json<HomeScreen>().rails.find((r) => r.id === "continue")?.items ?? [];
  const details = async (id: string) => (await app.inject("/api/titles/" + encodeURIComponent(id))).json<TitleDetails>();

  it("puts a film stopped part way first, with its progress bar, and resumes it there", async () => {
    const info = await play({ kind: "title", id: "demo:movie:the-clockmaker" });
    const title = { id: "demo:movie:the-clockmaker", kind: "movie", name: "The Clockmaker" };
    await report({ key: info.progressKey, positionMs: 0, durationMs: 100 * MIN, event: "start", title });
    await report({ key: info.progressKey, positionMs: 25 * MIN, durationMs: 100 * MIN, event: "progress", title });
    // The player says 0 as it stops: the place stays.
    await report({ key: info.progressKey, positionMs: 0, durationMs: 100 * MIN, event: "stop", title });
    const rail = await continueRail();
    expect(rail[0]).toMatchObject({ id: "demo:movie:the-clockmaker" });
    expect(rail[0]!.progress).toBeCloseTo(0.25);
    expect((await play({ kind: "title", id: "demo:movie:the-clockmaker" })).startMs).toBe(25 * MIN);
  });

  it("shows the show for an episode, and Resume plays that episode from where it stopped", async () => {
    const info = await play({ kind: "title", id: "demo:series:harbour-lights", episodeId: "s2e2" });
    const title = { id: "demo:series:harbour-lights", kind: "series", name: "Harbour Lights" };
    await report({ key: info.progressKey, positionMs: 12 * MIN, durationMs: 58 * MIN, event: "stop", title });
    const card = (await continueRail())[0]!;
    expect(card).toMatchObject({ id: "demo:series:harbour-lights", name: "Harbour Lights", episodeId: "s2e2" });
    expect(card.subtitle).toMatch(/^S2 E2/);
    const d = await details("demo:series:harbour-lights");
    expect(d).toMatchObject({ episodeId: "s2e2", resumeMs: 12 * MIN });
    expect(d.seasons?.[1]?.episodes[1]?.progress).toBeCloseTo(12 / 58);
    expect((await play({ kind: "title", id: "demo:series:harbour-lights", episodeId: card.episodeId })).startMs).toBe(12 * MIN);

    // Watched to the end: the next episode shows instead.
    await report({ key: info.progressKey, positionMs: 58 * MIN, durationMs: 58 * MIN, event: "stop", title });
    const next = (await continueRail())[0]!;
    expect(next).toMatchObject({ id: "demo:series:harbour-lights", episodeId: "s2e3" });
    expect(next.subtitle).toMatch(/^Next: S2 E3/);
    const after = await details("demo:series:harbour-lights");
    expect(after.episodeId).toBe("s2e3");
    expect(after.resumeMs).toBeUndefined();
    expect(after.seasons?.[1]?.episodes[1]?.watched).toBe(true);
  });

  it("is the same after switching profiles and back", async () => {
    const first = async (profile?: string) => (await app.inject({ url: "/api/home", ...(profile ? { headers: { "x-profile": profile } } : {}) })).json<HomeScreen>().rails.find((r) => r.id === "continue")?.items[0]?.id;
    expect(await first("family")).toBe("demo:series:harbour-lights");
    expect(await first()).toBe("demo:series:harbour-lights");
    expect(await first("family")).toBe("demo:series:harbour-lights");
  });
});
