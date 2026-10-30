import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AlertSettings, KidsTimeStatus, Profile } from "@ultimatetv/shared";
import { cleanKidsLimits, DEFAULT_ALERT_SETTINGS } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { Db } from "../src/db.js";
import { bedtimeWindow, HARD_CAP_MS, KidsTime, LimitError, nextMorning } from "../src/kidstime.js";
import { ProfileStore } from "../src/profiles.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

// Local times, so the tests pass whatever the machine's time zone. 30 October 2026 is a Friday.
const thu = (h: number, m = 0) => new Date(2026, 9, 29, h, m).getTime();
const fri = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();
const MIN = 60_000;

function setup(alerts: Partial<AlertSettings> = {}) {
  const db = new Db(":memory:");
  const profiles = new ProfileStore(db);
  const sent: unknown[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sent.push(init?.body);
    return new Response("ok");
  }) as typeof fetch;
  const kids = new KidsTime({ db, profiles, alertSettings: () => ({ ...DEFAULT_ALERT_SETTINGS, ...alerts }), appName: () => "UltimateTV", fetchImpl, warn: () => undefined });
  const limit = (limits: Parameters<typeof cleanKidsLimits>[0]) => profiles.update("kids", { limits: cleanKidsLimits(limits) })!;
  /** Plays for `minutes`, reporting every 30 seconds like the TV. */
  const watch = (p: Profile, from: number, minutes: number): KidsTimeStatus => {
    let st = kids.report(p, true, from);
    for (let t = from + 30_000; t <= from + minutes * MIN; t += 30_000) st = kids.report(p, true, t);
    return st;
  };
  return { db, profiles, kids, limit, watch, sent };
}

describe("Kids time: counting", () => {
  it("counts only while something plays", () => {
    const { kids, limit, watch } = setup();
    const p = limit({ dailyMinutes: 60 });
    expect(watch(p, thu(9), 20)).toMatchObject({ limited: true, usedMinutes: 20, minutesLeft: 40, state: "ok" });
    // Stopped for an hour: none of it counts.
    kids.report(p, false, thu(9, 20) + 10_000);
    const st = watch(p, thu(10, 30), 10);
    expect(st.usedMinutes).toBe(30);
    // A long silence (the TV was off) isn't counted either.
    expect(kids.report(p, true, thu(12)).usedMinutes).toBe(30);
  });

  it("doesn't count adults or profiles without limits", () => {
    const { profiles, kids, watch } = setup();
    expect(watch(profiles.get("kids")!, thu(9), 10)).toMatchObject({ limited: false, state: "ok", minutesLeft: null });
    expect(kids.report(profiles.get("family")!, true, thu(9)).limited).toBe(false);
  });

  it("resets at midnight", () => {
    const { kids, limit, watch } = setup();
    const p = limit({ dailyMinutes: 30 });
    expect(watch(p, thu(18), 40).state).toBe("finishing");
    expect(kids.status(p, fri(7))).toMatchObject({ usedMinutes: 0, state: "ok", minutesLeft: 30 });
  });

  it("counts across midnight from midnight", () => {
    const { kids, limit, watch } = setup();
    const p = limit({ dailyMinutes: 120 });
    watch(p, thu(23, 50), 20);
    expect(kids.status(p, fri(0, 10)).usedMinutes).toBe(10);
  });
});

describe("Kids time: limits", () => {
  it("warns in the last five minutes, then lets what's on finish, then stops", () => {
    const { kids, limit, watch } = setup();
    const p = limit({ dailyMinutes: 30 });
    expect(watch(p, thu(9), 26)).toMatchObject({ state: "warn", minutesLeft: 4, reason: "allowance" });
    const out = watch(p, thu(9, 26), 4);
    expect(out).toMatchObject({ state: "finishing", minutesLeft: 0 });
    expect(out.stopBy).toBe(thu(9, 30) + HARD_CAP_MS);
    expect(() => kids.check(p, thu(9, 31))).toThrow(LimitError);
    expect(kids.status(p, thu(10, 1)).state).toBe("stopped");
  });

  it("uses the weekday and weekend bedtimes, until six the next morning", () => {
    const limits = cleanKidsLimits({ weekdayBedtime: "19:30", weekendBedtime: "20:30" });
    expect(bedtimeWindow(limits, thu(12))).toEqual({ bedtime: "19:30", start: thu(19, 30), end: fri(6) });
    // Friday night is a weekend night; early Friday morning is still Thursday night.
    expect(bedtimeWindow(limits, fri(12))?.bedtime).toBe("20:30");
    expect(bedtimeWindow(limits, fri(5))?.bedtime).toBe("19:30");
    expect(nextMorning(fri(5))).toBe(fri(6));
    expect(nextMorning(fri(15))).toBe(new Date(2026, 9, 31, 6).getTime());
  });

  it("enforces bedtime by the clock", () => {
    const { kids, limit } = setup();
    const p = limit({ weekdayBedtime: "19:30" });
    expect(kids.status(p, thu(19, 27))).toMatchObject({ state: "warn", reason: "bedtime", minutesLeft: 3, bedtime: "19:30" });
    expect(kids.status(p, thu(19, 45))).toMatchObject({ state: "finishing", stopBy: thu(20) });
    expect(kids.status(p, thu(21)).state).toBe("stopped");
    // Still bedtime after midnight, not a fresh half hour.
    expect(kids.status(p, fri(1)).state).toBe("stopped");
    expect(kids.status(p, fri(7)).state).toBe("ok");
  });

  it("refuses new plays only on a Kids profile whose time is up", () => {
    const { profiles, kids, limit } = setup();
    const p = limit({ weekdayBedtime: "19:30" });
    expect(() => kids.check(p, thu(19))).not.toThrow();
    expect(() => kids.check(p, thu(20))).toThrow(/bedtime/);
    expect(() => kids.check(profiles.get("family")!, thu(20))).not.toThrow();
    expect(() => kids.check(null, thu(20))).not.toThrow();
  });
});

describe("Kids time: more time", () => {
  it("adds minutes past the allowance and past bedtime", () => {
    const { kids, limit, watch } = setup();
    let p = limit({ dailyMinutes: 30 });
    watch(p, thu(9), 40);
    expect(kids.extra(p, 15, thu(9, 40))).toMatchObject({ state: "ok", minutesLeft: 15 });
    expect(watch(p, thu(9, 40), 15).state).toBe("finishing");

    p = limit({ dailyMinutes: null, weekdayBedtime: "19:30" });
    expect(kids.extra(p, 30, thu(19, 40))).toMatchObject({ state: "ok", minutesLeft: 30 });
    expect(kids.status(p, thu(20, 10))).toMatchObject({ state: "finishing", stopBy: thu(20, 40) });
  });

  it("lifts the limits until the morning", () => {
    const { kids, limit } = setup();
    const p = limit({ dailyMinutes: 30, weekdayBedtime: "19:30" });
    expect(kids.extra(p, 0, thu(20))).toMatchObject({ state: "ok", unlockedUntil: fri(6) });
    expect(() => kids.check(p, thu(23))).not.toThrow();
    expect(kids.status(p, fri(6, 1)).unlockedUntil).toBeUndefined();
  });
});

describe("Kids time: alerts", () => {
  it("tells ntfy once when time runs out", () => {
    const { kids, limit, watch, sent } = setup({ ntfyUrl: "http://ntfy.local/tv" });
    const p = limit({ dailyMinutes: 30, alert: true });
    watch(p, thu(9), 35);
    kids.status(p, thu(9, 40));
    expect(sent).toHaveLength(1);
    expect(String(sent[0])).toMatch(/can finish/);
  });

  it("stays quiet when the alert is off", () => {
    const { limit, watch, sent } = setup({ ntfyUrl: "http://ntfy.local/tv" });
    watch(limit({ dailyMinutes: 30 }), thu(9), 35);
    expect(sent).toHaveLength(0);
  });
});

describe("Kids time over the API", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const kids = { "x-profile": "kids" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-kidstime-"));
    const config: HubConfig = {
      port: 8095,
      host: "127.0.0.1",
      dataDir: path.join(tmp, "data"),
      clipsDir: path.join(tmp, "clips"),
      probeDir: path.join(tmp, "probe"),
      uiDir: path.join(tmp, "ui"),
      setupDir: path.join(tmp, "setup"),
      mediaRoot: path.join(tmp, "media"),
      demo: true,
    };
    app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
    await pairAsTv(app);
  });

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("saves limits, refuses plays at bedtime and takes an adult PIN for more time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(thu(18));
    const saved = await app.inject({ method: "PATCH", url: "/api/profiles/kids", payload: { limits: { dailyMinutes: 60, weekdayBedtime: "19:30", weekendBedtime: "20:30", alert: false } } });
    expect(saved.json<Profile>().limits).toEqual({ dailyMinutes: 60, weekdayBedtime: "19:30", weekendBedtime: "20:30", alert: false });
    // Kids can't change their own limits.
    expect((await app.inject({ method: "PATCH", url: "/api/profiles/kids", payload: { limits: null }, headers: kids })).statusCode).toBe(403);

    const play = () => app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "cbeebies" }, headers: kids });
    expect((await play()).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/kids-time/report", payload: { playing: true }, headers: kids })).json()).toMatchObject({ status: { state: "ok", minutesLeft: 60 } });

    vi.setSystemTime(thu(19, 40));
    const refused = await play();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "limit", status: { state: "finishing", reason: "bedtime" } });
    // The Android client's downloads are refused too.
    expect((await app.inject({ method: "POST", url: "/api/offline", payload: { kind: "title", id: "demo:movie:paper-moons" }, headers: kids })).statusCode).toBe(403);
    // Adults carry on.
    expect((await app.inject({ method: "POST", url: "/api/play", payload: { kind: "channel", id: "cbeebies" } })).statusCode).toBe(200);

    expect((await app.inject({ method: "GET", url: "/api/kids-time", headers: kids })).json()).toMatchObject({ current: { state: "finishing" } });

    // Lock the household, then more time needs the PIN.
    await app.inject({ method: "PATCH", url: "/api/profiles/family", payload: { pin: "2468" } });
    const extra = (pin: string, minutes = 30) => app.inject({ method: "POST", url: "/api/kids-time/kids/extra", payload: { minutes, pin }, headers: kids });
    expect((await extra("1111")).statusCode).toBe(403);
    expect((await extra("2468", 20)).statusCode).toBe(400);
    expect((await extra("2468")).json()).toMatchObject({ status: { state: "ok", minutesLeft: 30 } });
    expect((await play()).statusCode).toBe(200);
  });
});
