import { copyFile, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Recording } from "@ultimatetv/shared";
import { ChannelStore } from "../src/channels.js";
import { ConnectionGuard } from "../src/connections.js";
import { Db } from "../src/db.js";
import { GuideStore } from "../src/epg.js";
import { EventBus } from "../src/events.js";
import { silentLogger } from "../src/log.js";
import { Recorder } from "../src/recorder.js";
import { RecordingStore, recordingPath } from "../src/recordings.js";
import { LiveRelay } from "../src/relay.js";
import { Scheduler } from "../src/scheduler.js";
import { defaultSettings, SettingsStore } from "../src/settings.js";
import { channel, liveFetch, programme } from "./helpers.js";

async function setup(fetchImpl: typeof fetch) {
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
  const scheduler = new Scheduler({ store, guide, channels, recorder, guard, settings, events, log: silentLogger });
  return { dir, db, settings, channels, guard, relay, store, guide, recorder, scheduler, remuxed, events };
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
