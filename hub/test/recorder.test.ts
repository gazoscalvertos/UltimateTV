import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recording, SeriesLink } from "@ultimatetv/shared";
import { ChannelStore } from "../src/channels.js";
import { ConnectionGuard } from "../src/connections.js";
import { Db } from "../src/db.js";
import { GuideStore } from "../src/epg.js";
import { EventBus } from "../src/events.js";
import { silentLogger } from "../src/log.js";
import { Recorder } from "../src/recorder.js";
import { RecordingStore, recordingPath } from "../src/recordings.js";
import { PlayQueue } from "../src/queue.js";
import { LiveRelay } from "../src/relay.js";
import { Scheduler } from "../src/scheduler.js";
import { defaultSettings, SettingsStore } from "../src/settings.js";
import { channel, liveFetch, programme } from "./helpers.js";

async function setup(fetchImpl: typeof fetch, extra: { refreshLibrary?: () => void | Promise<void> } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "utv-"));
  const db = new Db(":memory:");
  const settings = new SettingsStore(db, defaultSettings(dir));
  settings.update({ iptv: [{ id: "x", kind: "xtream", name: "IPTV", url: "http://iptv", username: "u", password: "p", connections: 1 }] });
  const channels = new ChannelStore(db);
  channels.replace(
    [channel("bbc1", { name: "BBC One", catchupDays: 7 }), channel("bbc2", { name: "BBC Two" })],
    [
      { id: "x:1", sourceId: "x", name: "BBC One", height: 1080, priority: 0, catchupDays: 7, channelId: "bbc1", upstreamId: "1", url: "http://iptv/live/u/p/1.ts" },
      { id: "x:1b", sourceId: "x", name: "BBC One SD", height: 576, priority: 1, catchupDays: 0, channelId: "bbc1", upstreamId: "1b", url: "http://iptv/live/u/p/1b.ts" },
      { id: "x:2", sourceId: "x", name: "BBC Two", height: 1080, priority: 0, catchupDays: 0, channelId: "bbc2", upstreamId: "2", url: "http://iptv/live/u/p/2.ts" },
    ],
  );
  const guard = new ConnectionGuard(() => settings.connectionLimit());
  const relay = new LiveRelay(channels, guard, silentLogger, fetchImpl);
  const store = new RecordingStore(db);
  const guide = new GuideStore(db);
  const events = new EventBus();
  const remuxed: string[] = [];
  const recorder = new Recorder({
    store, channels, relay, guard, settings, events, log: silentLogger, tmpDir: path.join(dir, "tmp"), fetchImpl,
    catchup: { settings: settings.get(), timeZoneOf: () => "Europe/London" },
    remux: async (i, o) => {
      remuxed.push(o);
      await copyFile(i, o);
    },
  });
  const queue = new PlayQueue(db, events);
  const scheduler = new Scheduler({
    store, guide, channels, recorder, guard, settings, events, queue, log: silentLogger,
    ...(extra.refreshLibrary ? { refreshLibrary: extra.refreshLibrary } : {}),
  });
  return { dir, db, settings, channels, guard, relay, store, guide, recorder, scheduler, remuxed, events, queue };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

describe("live relay", () => {
  it("fans one upstream out to several consumers and falls back to the next feed", async () => {
    const f = liveFetch({ failFirst: 1, chunkMs: 2 });
    const t = await setup(f.impl);
    cleanups.push(() => t.relay.closeAll());
    const a = t.relay.subscribe("bbc1", "box", "view");
    const b = t.relay.subscribe("bbc1", "recording:1", "record");
    let bytesA = 0;
    let bytesB = 0;
    a.stream.on("data", (c: Buffer) => (bytesA += c.length));
    b.stream.on("data", (c: Buffer) => (bytesB += c.length));
    await new Promise((r) => setTimeout(r, 900));
    expect(bytesA).toBeGreaterThan(0);
    expect(bytesB).toBeGreaterThan(0);
    expect(f.urls[0]).toContain("/1.ts");
    expect(f.urls[1]).toContain("/1b.ts");
    expect(t.guard.status().used).toBe(1);
    a.close();
    b.close();
  });

  it("ends the viewer's stream when a recording needs the only connection", async () => {
    const f = liveFetch();
    const t = await setup(f.impl);
    cleanups.push(() => t.relay.closeAll());
    const viewer = t.relay.subscribe("bbc2", "box", "view");
    viewer.stream.resume();
    const rec = t.relay.subscribe("bbc1", "recording:1", "record");
    rec.stream.resume();
    expect(await viewer.ended).toMatch(/^recording:/);
    rec.close();
  });
});

describe("recorder", () => {
  it("records a live window, remuxes and writes an NFO", async () => {
    const f = liveFetch({ chunkMs: 2, chunkBytes: 188 * 64 });
    const t = await setup(f.impl);
    const now = Date.now();
    const p = programme("bbc1", now - 1000, 1, { title: "Silent Witness", season: 28, episode: 3, subtitle: "Part One" });
    // End the window quickly: the recorder stops at `end`.
    const rec: Recording = { id: "r1", programme: p, channelId: "bbc1", channelName: "BBC One", status: "scheduled", method: "live", start: now - 1000, end: now + 1500, incomplete: false, watched: false, positionMs: 0, createdAt: now };
    t.store.save(rec);
    await t.recorder.recordLive(rec);
    const done = t.store.get("r1")!;
    expect(done.status).toBe("completed");
    expect(done.path).toBe(recordingPath(path.join(t.dir, "Recordings"), p));
    expect(done.path).toContain(path.join("Silent Witness", "Season 28", "Silent Witness - S28E03 - Part One.mkv"));
    expect((await stat(done.path!)).size).toBeGreaterThan(256 * 1024);
    expect(await readFile(done.path!.replace(".mkv", ".nfo"), "utf8")).toContain("<season>28</season>");
    expect(t.guard.status().used).toBe(0);
  }, 10_000);

  it("downloads catch-up recordings", async () => {
    const big = new Uint8Array(400 * 1024).fill(0x47);
    const urls: string[] = [];
    const t = await setup((async (u: string) => {
      urls.push(String(u));
      return new Response(big, { status: 200 });
    }) as unknown as typeof fetch);
    const start = Date.UTC(2026, 9, 24, 19, 0);
    const p = programme("bbc1", start, 60, { title: "Planet Earth", isFilm: false });
    const rec: Recording = { id: "r2", programme: p, channelId: "bbc1", channelName: "BBC One", status: "waiting-catchup", method: "catchup", start: start - 120_000, end: start + 3_900_000, incomplete: false, watched: false, positionMs: 0, createdAt: 0 };
    t.store.save(rec);
    const realNow = Date.now;
    Date.now = () => start + 5 * 3_600_000;
    cleanups.push(() => (Date.now = realNow));
    expect(await t.recorder.recordCatchup(rec)).toBe(true);
    expect(urls[0]).toBe("http://iptv/timeshift/u/p/67/2026-10-24:19-58/1.ts");
    expect(t.store.get("r2")!.status).toBe("completed");
  });
});

describe("scheduler", () => {
  it("records a programme, creates series links and follows schedule changes", async () => {
    const t = await setup(liveFetch().impl);
    const H = 3_600_000;
    const now = Date.now();
    const p1 = programme("bbc2", now + 2 * H, 60, { title: "Show", episodeKey: "e1" });
    const p2 = programme("bbc2", now + 26 * H, 60, { title: "Show", episodeKey: "e2" });
    t.guide.upsert([p1, p2]);
    const one = t.scheduler.recordProgramme(p1.id);
    expect(one).toMatchObject({ status: "scheduled", method: "live" });
    expect(t.scheduler.recordProgramme(p1.id).id).toBe(one.id);

    const link = t.scheduler.createSeriesLink(p1.id);
    expect(link.scope).toBe("any");
    const scheduled = t.store.withStatus("scheduled");
    expect(scheduled.map((r) => r.programme.episodeKey).sort()).toEqual(["e1", "e2"]);

    // The guide moves episode 2 by 30 minutes.
    t.db.run("DELETE FROM programmes WHERE id = ?", p2.id);
    const moved = { ...p2, id: `bbc2:${p2.start + H / 2}`, start: p2.start + H / 2, end: p2.end + H / 2 };
    t.guide.upsert([moved]);
    t.scheduler.replan();
    const e2 = t.store.withStatus("scheduled").find((r) => r.programme.episodeKey === "e2")!;
    expect(e2.programme.start).toBe(moved.start);

    t.scheduler.deleteSeriesLink(link.id);
    expect(t.store.withStatus("scheduled").filter((r) => r.seriesLinkId)).toHaveLength(0);
  });

  it("uses catch-up for channels that have it and marks it waiting after the programme ends", async () => {
    const t = await setup(liveFetch().impl);
    const now = Date.now();
    const p = programme("bbc1", now - 2 * 3_600_000, 60, { title: "Earlier" });
    t.guide.upsert([p]);
    const r = t.scheduler.recordProgramme(p.id);
    expect(r).toMatchObject({ method: "catchup", status: "waiting-catchup" });
  });
});

// ---------------------------------------------------------------------------
// Keeping only the latest N episodes of a series link (issue #98)

type Setup = Awaited<ReturnType<typeof setup>>;

/** A completed recording on disk, with the file and NFO a real one would leave. */
async function completed(t: Setup, id: string, start: number, extra: Partial<Recording> = {}): Promise<Recording> {
  const dir = path.join(t.dir, "Recordings", id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.mkv`);
  await writeFile(file, "pretend mkv");
  await writeFile(file.replace(/\.mkv$/, ".nfo"), "<episodedetails/>");
  const r: Recording = {
    id,
    programme: programme("bbc2", start, 60, { title: "Show", episodeKey: id }),
    channelId: "bbc2",
    channelName: "BBC Two",
    status: "completed",
    method: "live",
    start,
    end: start + 60 * 60_000,
    incomplete: false,
    watched: false,
    positionMs: 0,
    createdAt: start,
    path: file,
    sizeBytes: 11,
    ...extra,
  };
  t.store.save(r);
  return r;
}

const seriesLink = (extra: Partial<SeriesLink> = {}): SeriesLink => ({
  id: "l1",
  seriesKey: "t:show",
  title: "Show",
  channelId: "bbc2",
  channelName: "BBC Two",
  scope: "any",
  newOnly: false,
  keepLatest: 2,
  paddingBeforeMin: 2,
  paddingAfterMin: 5,
  createdAt: 0,
  ...extra,
});

const there = (p: string | undefined): Promise<boolean> =>
  p ? stat(p).then((s) => s.isFile(), () => false) : Promise.resolve(false);

describe("series link housekeeping", () => {
  const HOUR = 3_600_000;
  const T0 = Date.UTC(2026, 9, 20, 20, 0);

  it("keeps the newest N completed episodes and deletes the older file and NFO", async () => {
    const t = await setup(liveFetch().impl);
    t.store.saveLink(seriesLink({ keepLatest: 2 }));
    const old1 = await completed(t, "e1", T0, { seriesLinkId: "l1" });
    const old2 = await completed(t, "e2", T0 + HOUR, { seriesLinkId: "l1" });
    await completed(t, "e3", T0 + 2 * HOUR, { seriesLinkId: "l1" });
    await completed(t, "e4", T0 + 3 * HOUR, { seriesLinkId: "l1" });

    await t.scheduler.tick();

    const done = t.store.forLink("l1").filter((r) => r.status === "completed");
    expect(done.map((r) => r.id).sort()).toEqual(["e3", "e4"]);
    expect(await there(old1.path)).toBe(false);
    expect(await there(old1.path!.replace(/\.mkv$/, ".nfo"))).toBe(false);
    expect(await there(old2.path)).toBe(false);
    // The stub stays so the planner doesn't record the episode again.
    expect(t.store.get("e1")).toMatchObject({ status: "cancelled", seriesLinkId: "l1" });
    expect(t.store.get("e1")!.path).toBeUndefined();
    expect(await there(t.store.get("e3")!.path)).toBe(true);
  });

  it("does not touch an episode that is still recording, even when it is the oldest", async () => {
    const t = await setup(liveFetch().impl);
    t.store.saveLink(seriesLink({ keepLatest: 1 }));
    const active = await completed(t, "e1", T0, { seriesLinkId: "l1", status: "recording" });
    await completed(t, "e2", T0 + HOUR, { seriesLinkId: "l1" });
    await completed(t, "e3", T0 + 2 * HOUR, { seriesLinkId: "l1" });

    await t.scheduler.tick();

    expect(t.store.get("e1")).toMatchObject({ status: "recording" });
    expect(await there(active.path)).toBe(true);
    // The newest finished episode is kept and the middle one goes; the unfinished one is untouched.
    expect(t.store.get("e3")!.status).toBe("completed");
    expect(t.store.get("e2")!.status).toBe("cancelled");
  });

  it("leaves recordings that aren't part of a series link alone", async () => {
    const t = await setup(liveFetch().impl);
    t.store.saveLink(seriesLink({ keepLatest: 1 }));
    const single = await completed(t, "single", T0 - 5 * HOUR, { programme: programme("bbc1", T0 - 5 * HOUR, 60, { title: "Film" }) });
    await completed(t, "e1", T0, { seriesLinkId: "l1" });
    await completed(t, "e2", T0 + HOUR, { seriesLinkId: "l1" });

    await t.scheduler.tick();

    expect(t.store.get("single")).toMatchObject({ status: "completed" });
    expect(await there(single.path)).toBe(true);
    expect(t.store.forLink("l1").filter((r) => r.status === "completed").map((r) => r.id)).toEqual(["e2"]);
  });

  it("keeps everything when the link says keep all", async () => {
    const t = await setup(liveFetch().impl);
    t.store.saveLink(seriesLink({ keepLatest: 0 }));
    for (let i = 0; i < 4; i += 1) await completed(t, `e${i}`, T0 + i * HOUR, { seriesLinkId: "l1" });

    await t.scheduler.tick();

    expect(t.store.forLink("l1").filter((r) => r.status === "completed")).toHaveLength(4);
  });

  it("keeps an episode that is still in the play queue", async () => {
    const t = await setup(liveFetch().impl);
    t.store.saveLink(seriesLink({ keepLatest: 1 }));
    const queued = await completed(t, "e1", T0, { seriesLinkId: "l1" });
    t.queue.add({ req: { kind: "recording", id: "e1" }, name: "Show" });
    await completed(t, "e2", T0 + HOUR, { seriesLinkId: "l1" });
    await completed(t, "e3", T0 + 2 * HOUR, { seriesLinkId: "l1" });

    await t.scheduler.tick();

    expect(t.store.get("e1")).toMatchObject({ status: "completed" });
    expect(await there(queued.path)).toBe(true);
    expect(t.store.get("e2")!.status).toBe("cancelled");
    expect(t.store.forLink("l1").filter((r) => r.status === "completed").map((r) => r.id)).toEqual(["e1", "e3"]);
  });

  it("prunes the link as soon as a recording finishes, without waiting for the hourly sweep", async () => {
    const t = await setup(liveFetch().impl);
    t.store.saveLink(seriesLink({ keepLatest: 1 }));
    await completed(t, "e1", T0, { seriesLinkId: "l1" });
    const newest = await completed(t, "e2", T0 + HOUR, { seriesLinkId: "l1" });

    t.events.emit({ type: "recording.finished", recording: newest });

    await vi.waitFor(() => expect(t.store.get("e1")).toMatchObject({ status: "cancelled" }));
    expect(await there(t.store.get("e1")!.path)).toBe(false);
    expect(t.store.get("e2")!.status).toBe("completed");
  });

  it("asks Jellyfin to refresh once for the whole batch of deletions", async () => {
    const refreshed: number[] = [];
    const t = await setup(liveFetch().impl, { refreshLibrary: () => void refreshed.push(Date.now()) });
    t.store.saveLink(seriesLink({ keepLatest: 1 }));
    await completed(t, "e1", T0, { seriesLinkId: "l1" });
    await completed(t, "e2", T0 + HOUR, { seriesLinkId: "l1" });
    await completed(t, "e3", T0 + 2 * HOUR, { seriesLinkId: "l1" });
    await completed(t, "e4", T0 + 3 * HOUR, { seriesLinkId: "l1" });

    await t.scheduler.tick();
    expect(refreshed).toHaveLength(1);
  });

  it("does not ask Jellyfin to refresh when nothing was deleted", async () => {
    const refreshed: number[] = [];
    const t = await setup(liveFetch().impl, { refreshLibrary: () => void refreshed.push(Date.now()) });
    t.store.saveLink(seriesLink({ keepLatest: 3 }));
    await completed(t, "e1", T0, { seriesLinkId: "l1" });

    await t.scheduler.tick();
    expect(refreshed).toHaveLength(0);
  });
});
