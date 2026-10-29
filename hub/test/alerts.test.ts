import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent, Recording, Settings } from "@ultimatetv/shared";
import { Alerts, findAlerts, type AlertInput, type Disk } from "../src/alerts.js";
import { Db } from "../src/db.js";
import { EventBus } from "../src/events.js";
import type { NoticeInput } from "../src/notify.js";
import { buildServer } from "../src/server.js";
import { defaultSettings } from "../src/settings.js";
import { pairAsTv, programme } from "./helpers.js";

const DAY = 86_400_000;
const GB = 1024 ** 3;
const NOW = Date.UTC(2026, 9, 29, 12);

const input = (extra: Partial<AlertInput> = {}): AlertInput => ({ now: NOW, expiryDays: 14, iptv: [], recordings: [], disks: [], ...extra });

function failed(id: string, endsAgo: number): Recording {
  const p = programme("bbc1", NOW - endsAgo - 3600_000, 60, { title: "Harbour Lights" });
  return { id, programme: p, channelId: "bbc1", channelName: "BBC One", status: "failed", method: "live", start: p.start, end: p.end, incomplete: false, watched: false, positionMs: 0, createdAt: p.start, error: "The stream stopped" };
}

describe("finding alerts", () => {
  it("warns about subscriptions inside the warning window, and badly in the last three days", () => {
    const found = findAlerts(input({ iptv: [{ id: "x1", name: "Your IPTV", expires: NOW + 10 * DAY }, { id: "x2", name: "Spare", expires: NOW + 40 * DAY }, { id: "x3", name: "Old", expires: NOW + 2 * DAY }], torboxExpires: NOW - DAY }));
    expect(found.map((a) => [a.id, a.level])).toEqual([
      ["iptv-expiry-x1", "warn"],
      ["iptv-expiry-x3", "bad"],
      ["torbox-expiry", "bad"],
    ]);
    expect(found[0]!.title).toBe("Your IPTV ends in 10 days");
    expect(found[2]!.title).toMatch(/^TorBox ended on /);
  });

  it("mentions failed recordings for three days", () => {
    const found = findAlerts(input({ recordings: [failed("r1", 3600_000), failed("r2", 4 * DAY), { ...failed("r3", 0), status: "completed" }] }));
    expect(found.map((a) => a.id)).toEqual(["recording-failed-r1"]);
    expect(found[0]!.text).toContain("The stream stopped");
  });

  it("warns once per disk when it's under 10% or 20 GB free, badly under 3% or 5 GB", () => {
    const disk = (label: string, free: number, total: number): Disk => ({ label, freeBytes: free * GB, totalBytes: total * GB });
    const found = findAlerts(input({ disks: [disk("Recordings", 300, 4000), disk("Films", 300, 4000), disk("TV", 4, 100), disk("Big", 900, 4000)] }));
    expect(found.map((a) => [a.id, a.level])).toEqual([
      ["disk-full-recordings", "warn"],
      ["disk-full-tv", "bad"],
    ]);
  });
});

describe("alerts on the Hub", () => {
  let tmp: string;
  let db: Db;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-alerts-"));
    db = new Db(path.join(tmp, "hub.db"));
  });
  afterEach(async () => {
    db.close();
    await rm(tmp, { recursive: true, force: true });
  });

  function make(opts: { expires?: () => number | undefined; tv?: boolean; settings?: Partial<Settings> } = {}) {
    const events = new EventBus();
    const seen: HubEvent[] = [];
    events.on((e) => seen.push(e));
    const notices: NoticeInput[] = [];
    const settings: Settings = { ...defaultSettings(tmp), iptv: [{ id: "x1", kind: "xtream", name: "Your IPTV", url: "http://iptv", username: "u", password: "p", connections: 1 }], ...opts.settings };
    const alerts = new Alerts({
      db,
      events,
      log: { warn() {} } as never,
      settings: () => settings,
      expiresOf: () => (opts.expires ?? (() => NOW + 10 * DAY))(),
      torboxExpires: async () => undefined,
      recordings: () => [],
      notify: (n) => (notices.push(n), null),
      tvConnected: () => opts.tv ?? true,
      disks: async () => [],
      now: () => NOW,
    });
    return { alerts, notices, seen };
  }

  it("pops each alert up once, and again only when it gets worse", async () => {
    let expires = NOW + 10 * DAY;
    const { alerts, notices, seen } = make({ expires: () => expires });
    await alerts.check();
    await alerts.check();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "warning", title: "Your IPTV ends in 10 days", seconds: 120 });
    expect(seen.filter((e) => e.type === "alerts.changed")).toHaveLength(1);
    expires = NOW + 2 * DAY;
    await alerts.check();
    expect(notices).toHaveLength(2);
    expect(notices[1]).toMatchObject({ seconds: 0 });
  });

  it("waits for a TV, and keeps quiet when pop-ups are off", async () => {
    const off = make({ tv: false });
    await off.alerts.check();
    expect(off.notices).toHaveLength(0);
    expect(off.alerts.visible()).toHaveLength(1);
    const quiet = make({ settings: { alerts: { onTv: false, expiryDays: 14 } } });
    await quiet.alerts.check();
    expect(quiet.notices).toHaveLength(0);
  });

  it("hides a dismissed alert until it gets worse or the subscription is renewed", async () => {
    let expires = NOW + 10 * DAY;
    const { alerts } = make({ expires: () => expires, tv: false });
    await alerts.check();
    expect(alerts.dismiss("iptv-expiry-x1")).toBe(true);
    expect(alerts.visible()).toHaveLength(0);
    expires = NOW + 9 * DAY;
    await alerts.check();
    // A different date: renewed and running out again, so it's new.
    expect(alerts.visible()).toHaveLength(1);
    alerts.dismiss("iptv-expiry-x1");
    expires = NOW + 9 * DAY;
    await alerts.check();
    expect(alerts.visible()).toHaveLength(0);
  });
});

describe("the alerts and sleep timer routes", () => {
  let tmp: string;
  let app: FastifyInstance & { hub: { events: EventBus } };
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-sleep-"));
    app = (await buildServer(
      { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
      { systemReport: async () => ({}) as never, alerts: { disks: async () => [{ label: "Recordings", freeBytes: 2 * GB, totalBytes: 4000 * GB }], torboxExpires: async () => undefined } },
    )) as never;
    await pairAsTv(app);
  });
  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("lists, checks and dismisses alerts, and puts them on the Stats page", async () => {
    expect((await app.inject("/api/alerts")).json().alerts).toEqual([]);
    const checked = (await app.inject({ method: "POST", url: "/api/alerts/check" })).json().alerts;
    expect(checked).toMatchObject([{ id: "disk-full-recordings", level: "bad" }]);
    // No TV app on the event socket: the pop-up waits for one.
    expect((await app.inject("/api/notify")).json().notices).toEqual([]);
    expect((await app.inject({ method: "POST", url: "/api/alerts/disk-full-recordings/dismiss" })).json().alerts).toEqual([]);
    expect((await app.inject({ method: "POST", url: "/api/alerts/nope/dismiss" })).statusCode).toBe(404);
  });

  it("keeps the sleep timer for the TV and the phone", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    expect((await app.inject("/api/sleep")).json().timer).toEqual({ mode: "off", leftMs: null });
    const set = (await app.inject({ method: "PUT", url: "/api/sleep", payload: { minutes: 30 } })).json().timer;
    expect(set).toMatchObject({ mode: "minutes", minutes: 30, by: "phone" });
    expect(set.leftMs).toBeGreaterThan(29 * 60_000);
    expect(events.at(-1)).toMatchObject({ type: "sleep", timer: { mode: "minutes" } });
    // From the phone, "the end of this programme" waits for the TV to say when that is.
    const prog = (await app.inject({ method: "PUT", url: "/api/sleep", payload: { mode: "programme" } })).json().timer;
    expect(prog).toMatchObject({ mode: "programme", leftMs: null });
    const filled = (await app.inject({ method: "PUT", url: "/api/sleep", payload: { mode: "programme", leftMs: 20 * 60_000, programme: "Harbour Lights", by: "tv" } })).json().timer;
    expect(filled).toMatchObject({ mode: "programme", programme: "Harbour Lights", by: "tv" });
    // OK on the TV's warning pushes it back.
    const later = (await app.inject({ method: "PUT", url: "/api/sleep", payload: { leftMs: 31 * 60_000, by: "tv" } })).json().timer;
    expect(later).toMatchObject({ mode: "programme" });
    expect(later.leftMs).toBeGreaterThan(30 * 60_000);
    expect((await app.inject({ method: "PUT", url: "/api/sleep", payload: { minutes: "lots" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/api/sleep" })).json().timer).toMatchObject({ mode: "off", leftMs: null });
  });

  it("saves the sleep, alert and hint settings", async () => {
    const s = (await app.inject({ method: "PUT", url: "/api/settings", payload: { keyHints: false, sleep: { autoOffHours: 99 }, alerts: { onTv: false, expiryDays: 7 } } })).json();
    expect(s).toMatchObject({ keyHints: false, sleep: { autoOffHours: 12 }, alerts: { onTv: false, expiryDays: 7 } });
  });
});
