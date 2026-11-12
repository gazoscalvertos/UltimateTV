// The family board: reading calendars (iCal and Home Assistant), what each kind of profile is told,
// and keeping the Home Assistant token and secret calendar links to the grown-ups.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, dayKey, type FamilyState } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { binDayFromState, haEventItems } from "../src/family.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };
let requests: { url: string; auth?: string }[];
let answers: Record<string, () => Response>;

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/calendar" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
/** An iCal file with one event an hour from now, one tomorrow and one for tonight. */
function calendar(): string {
  const now = Date.now();
  const ev = (uid: string, title: string, start: number) => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${title}\r\nDTSTART:${stamp(start)}\r\nDTEND:${stamp(start + 3600_000)}\r\nEND:VEVENT`;
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev("1", "Dentist", now + 3600_000)}\r\n${ev("2", "Swimming", now + 26 * 3600_000)}\r\nEND:VCALENDAR\r\n`;
}

const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  requests.push({ url: u, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
  const answer = Object.entries(answers).find(([k]) => u.startsWith(k))?.[1];
  return answer ? answer() : json({ error: "not here" }, 404);
}) as typeof fetch;

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-family-"));
  requests = [];
  answers = {};
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const put = (payload: object) => app.inject({ method: "PUT", url: "/api/family/settings", payload });
const state = async (profile?: string): Promise<FamilyState> => (await app.inject({ url: "/api/family", headers: profile ? { "x-profile": profile } : {} })).json();

describe("the board", () => {
  it("has nothing until something is set up", async () => {
    expect(await state()).toMatchObject({ configured: false, items: [] });
  });

  it("reads an iCal link and keeps private calendars off Kids", async () => {
    answers["https://calendar.example/work.ics"] = () => text(calendar());
    answers["https://calendar.example/family.ics"] = () => text(calendar().replace(/Dentist/g, "Football").replace(/Swimming/g, "Gran's"));
    await put({
      calendars: [
        { id: "w", name: "Work", kind: "ical", url: "https://calendar.example/work.ics", kids: false },
        { id: "f", name: "Family", kind: "ical", url: "webcal://calendar.example/family.ics", kids: true },
      ],
    });
    const adult = await state();
    expect(adult.items.map((i) => i.title).sort()).toEqual(["Dentist", "Football", "Gran's", "Swimming"]);
    expect(requests.map((r) => r.url)).toContain("https://calendar.example/family.ics");
    const kids = await state("kids");
    // The family calendar's events (which one falls tomorrow depends on the hour the test runs) and none of the work one.
    expect(kids.items.map((i) => i.title)).toContain("Football");
    expect(kids.items.every((i) => ["Football", "Gran's"].includes(i.title))).toBe(true);
  });

  it("shows a Guest nothing", async () => {
    answers["https://calendar.example/f.ics"] = () => text(calendar());
    await put({ calendars: [{ id: "f", name: "Family", kind: "ical", url: "https://calendar.example/f.ics", kids: true }] });
    await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Visitor", kind: "guest" } });
    const guest = (await app.inject("/api/profiles")).json().profiles?.find((p: { kind: string }) => p.kind === "guest") ?? (await app.inject("/api/profiles")).json().find?.((p: { kind: string }) => p.kind === "guest");
    expect(guest).toBeTruthy();
    expect((await state(guest.id)).items).toEqual([]);
  });

  it("works out birthdays, bin day and the school run without the network", async () => {
    const tomorrow = addDays(dayKey(Date.now()), 1);
    await put({
      birthdays: [{ id: "m", name: "Maya", month: Number(tomorrow.slice(5, 7)), day: Number(tomorrow.slice(8)), year: 2017 }],
      bins: { mode: "schedule", rules: [{ id: "g", name: "Green bin", weekday: new Date(Date.now() + 86_400_000).getDay(), everyWeeks: 1, from: tomorrow }] },
    });
    const adult = await state();
    expect(adult.items.map((i) => i.kind).sort()).toEqual(["bin", "birthday"]);
    expect(adult.items.find((i) => i.kind === "birthday")?.title).toBe("Maya's birthday");
    expect(requests).toEqual([]);
    // Kids see birthdays and bins (they're theirs) unless birthdays are switched off for them.
    expect((await state("kids")).items).toHaveLength(2);
    await put({ birthdaysForKids: false });
    expect((await state("kids")).items.map((i) => i.kind)).toEqual(["bin"]);
  });

  it("reports a calendar it can't read to adults only, and keeps what it has", async () => {
    answers["https://calendar.example/f.ics"] = () => text("<html>log in</html>");
    await put({ calendars: [{ id: "f", name: "Family", kind: "ical", url: "https://calendar.example/f.ics", kids: true }] });
    expect((await state()).errors?.[0]).toMatchObject({ name: "Family", message: expect.stringContaining("iCal") });
    expect((await state("kids")).errors).toBeUndefined();
  });

  it("reads Home Assistant calendars and bin sensors with the token", async () => {
    const tomorrow = addDays(dayKey(Date.now()), 1);
    answers["http://ha.local:8123/api/calendars/calendar.family?"] = () => json([{ summary: "Parents' evening", start: { dateTime: new Date(Date.now() + 7200_000).toISOString() }, end: { dateTime: new Date(Date.now() + 10_800_000).toISOString() } }]);
    answers["http://ha.local:8123/api/states/sensor.green_bin"] = () => json({ state: tomorrow, attributes: { friendly_name: "Green bin next collection" } });
    await put({ ha: { url: "ha.local:8123", token: "secret-token" }, calendars: [{ id: "h", name: "Home", kind: "ha", entity: "calendar.family", kids: false }], bins: { mode: "ha", entities: ["sensor.green_bin"] } });
    const adult = await state();
    expect(adult.items.map((i) => i.title).sort()).toEqual(["Green bin", "Parents' evening"]);
    expect(requests.every((r) => r.auth === "Bearer secret-token")).toBe(true);
    expect((await state("kids")).items.map((i) => i.title)).toEqual(["Green bin"]);
  });
});

describe("the settings", () => {
  it("never send the Home Assistant token back and need a grown-up", async () => {
    const saved = await put({ ha: { url: "http://ha.local:8123", token: "secret-token" } });
    expect(saved.json().ha).toEqual({ url: "http://ha.local:8123", tokenSet: true });
    expect(JSON.stringify((await app.inject("/api/family/settings")).json())).not.toContain("secret-token");
    // Only the address changes: the token stays.
    await put({ ha: { url: "http://other:8123" } });
    expect(app.hub.db.getKv<{ ha: { token: string } }>("family-settings")?.ha.token).toBe("secret-token");
    await app.inject({ method: "PATCH", url: "/api/profiles/family", payload: { pin: "1234" } });
    const kids = await app.inject({ method: "GET", url: "/api/family/settings", headers: { "x-profile": "kids" } });
    expect(kids.statusCode).toBeGreaterThanOrEqual(401);
    const write = await app.inject({ method: "PUT", url: "/api/family/settings", headers: { "x-profile": "kids" }, payload: { onHome: false } });
    expect(write.statusCode).toBeGreaterThanOrEqual(401);
  });
});

describe("Home Assistant answers", () => {
  it("turns calendar events into items, an all-day end being the day after", () => {
    const cal = { id: "h", name: "Home", kind: "ha" as const, entity: "calendar.family", kids: true };
    const items = haEventItems([{ summary: "Trip", start: { date: "2026-11-20" }, end: { date: "2026-11-22" } }, { summary: "Tea", start: { dateTime: "2026-11-12T17:00:00+00:00" }, end: { dateTime: "2026-11-12T18:00:00+00:00" } }, { summary: "Odd" }], cal);
    expect(items.map((i) => [i.title, i.day ?? i.start])).toEqual([["Trip", "2026-11-20"], ["Trip", "2026-11-21"], ["Tea", Date.parse("2026-11-12T17:00:00Z")]]);
  });
  it("reads a bin sensor's state as a date or a number of days", () => {
    const now = new Date(2026, 10, 12, 10).getTime();
    expect(binDayFromState("2026-11-17", now)).toBe("2026-11-17");
    expect(binDayFromState("2026-11-17T00:00:00+00:00", now)).toBe("2026-11-17");
    expect(binDayFromState("3", now)).toBe("2026-11-15");
    expect(binDayFromState("unknown", now)).toBeNull();
  });
});
