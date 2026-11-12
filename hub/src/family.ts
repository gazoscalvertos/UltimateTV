// The family board on the Hub (see shared/src/family.ts): reads the household's calendars (iCal
// links and Home Assistant calendars), keeps what it found, and hands each screen the next few
// things, cleaned for whoever is asking. Birthdays, the bin schedule and the school run need no
// network, so they are worked out fresh on every request.

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  addDays,
  binItems,
  birthdayItems,
  cleanFamilySettings,
  dayKey,
  dayStart,
  DEFAULT_FAMILY_SETTINGS,
  familyConfigured,
  familySettingsView,
  schoolItem,
  visibleItems,
  type FamilyCalendar,
  type FamilyPatch,
  type FamilyItem,
  type FamilySettings,
  type FamilyState,
  type FamilyViewer,
  type Profile,
} from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import { fetchOk, redactUrl } from "./http.js";
import { parseIcs } from "./ical.js";

/** Calendars are read again after this long. */
const FRESH_MS = 15 * 60_000;
const RETRY_MS = 3 * 60_000;
/** How far ahead calendars are read, and how far back (an event still on). */
const AHEAD_DAYS = 14;
const MAX_ICS_BYTES = 8_000_000;

interface Cache {
  fetchedAt: number;
  items: FamilyItem[];
  errors: { name: string; message: string }[];
}

const dayOf = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso);

/** Home Assistant's answer for a calendar: {summary, start: {date | dateTime}, end}. */
interface HaEvent {
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  location?: string;
}

export function haEventItems(events: HaEvent[], cal: FamilyCalendar): FamilyItem[] {
  const out: FamilyItem[] = [];
  for (const e of events) {
    const title = String(e.summary ?? "").trim() || "Busy";
    const detail = String(e.location ?? "").trim() || cal.name;
    if (e.start?.date && dayOf(e.start.date)) {
      // An all-day end is the day after the last one.
      const endDay = e.end?.date && dayOf(e.end.date) ? e.end.date : addDays(e.start.date, 1);
      for (let day = e.start.date, n = 0; day < endDay && n < 14; day = addDays(day, 1), n++) out.push({ id: `${cal.id}:${title}:${day}`, kind: "event", title, start: dayStart(day), allDay: true, day, detail, kids: cal.kids });
    } else if (e.start?.dateTime) {
      const start = Date.parse(e.start.dateTime);
      if (!Number.isFinite(start)) continue;
      const end = e.end?.dateTime ? Date.parse(e.end.dateTime) : NaN;
      out.push({ id: `${cal.id}:${title}:${start}`, kind: "event", title, start, ...(Number.isFinite(end) && end > start ? { end } : {}), allDay: false, detail, kids: cal.kids });
    }
  }
  return out;
}

/** A bin sensor's state ("2026-11-17", an ISO time, or the number of days to go) as a day. */
export function binDayFromState(state: string, now: number): string | null {
  const s = state.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{1,2}$/.test(s)) return addDays(dayKey(now), Number(s));
  return null;
}

/** A made-up fortnight for demo mode and the screenshots: no network needed. */
export function demoItems(now: number): FamilyItem[] {
  const today = dayKey(now);
  const at = (days: number, h: number, m = 0) => {
    const d = new Date(dayStart(addDays(today, days)));
    d.setHours(h, m);
    return d.getTime();
  };
  const ev = (id: string, title: string, start: number, detail: string, kids = true, mins = 60): FamilyItem => ({ id: `demo:${id}`, kind: "event", title, start, end: start + mins * 60_000, allDay: false, detail, kids });
  return [
    ev("swim", "Swimming lessons", at(0, 17, 30), "Leisure centre", true, 45),
    ev("parents", "Parents' evening", at(0, 19, 0), "Year 4", false, 90),
    ev("dentist", "Dentist", at(1, 9, 15), "Gaz's calendar", false, 30),
    ev("football", "Football practice", at(2, 10, 0), "Family", true, 90),
    ev("gran", "Dinner at Gran's", at(3, 18, 0), "Family"),
    { id: "demo:inset", kind: "event", title: "Teacher training day", start: dayStart(addDays(today, 5)), allDay: true, day: addDays(today, 5), detail: "School", kids: true },
  ];
}

export class Family {
  private timer: NodeJS.Timeout | undefined;
  private fetching: Promise<void> | null = null;
  private failedAt = 0;

  constructor(
    private readonly ctx: HubContext,
    private readonly demo = false,
    private readonly now: () => number = Date.now,
  ) {}

  settings(): FamilySettings {
    const saved = this.ctx.db.getKv<Partial<FamilySettings>>("family-settings");
    const s = cleanFamilySettings(saved ?? {}, DEFAULT_FAMILY_SETTINGS);
    if (!this.demo || familyConfigured(s)) return s;
    // Demo mode shows a household, so the board can be seen without setting it up.
    const today = dayKey(this.now());
    return {
      ...s,
      calendars: [{ id: "demo", name: "Family", kind: "ical", url: "https://example.invalid/family.ics", kids: true }],
      birthdays: [{ id: "b1", name: "Maya", month: Number(addDays(today, 1).slice(5, 7)), day: Number(addDays(today, 1).slice(8)), year: 2017 }],
      bins: { mode: "schedule", eveningFrom: 17, entities: [], rules: [{ id: "r1", name: "Green bin", weekday: new Date(this.now() + 2 * 86_400_000).getDay(), everyWeeks: 2, from: addDays(today, 2) }] },
      school: { ...s.school, on: true },
    };
  }

  saveSettings(patch: FamilyPatch): FamilySettings {
    const s = cleanFamilySettings(patch, this.settings());
    this.ctx.db.setKv("family-settings", s);
    this.ctx.db.setKv("family-cache", null);
    this.ctx.events.emit({ type: "family.changed" });
    this.failedAt = 0;
    void this.refresh().catch(() => undefined);
    return s;
  }

  private cache(): Cache | null {
    return this.ctx.db.getKv<Cache>("family-cache") ?? null;
  }

  /** Everything the board knows, for one viewer. Starts a fresh read first when the last one is old. */
  async state(profile: Profile | null | undefined, now = this.now()): Promise<FamilyState> {
    const s = this.settings();
    const viewer: FamilyViewer = profile?.kind === "guest" ? "guest" : profile?.kind === "kids" ? "kids" : "adult";
    const base = { configured: familyConfigured(s), onHome: s.onHome, homeItems: s.homeItems };
    if (!base.configured) return { ...base, items: [] };
    let cache = this.cache();
    if ((!cache || now - cache.fetchedAt > FRESH_MS) && now - this.failedAt > RETRY_MS && s.calendars.length + (s.bins.mode === "ha" ? 1 : 0) > 0) {
      const job = this.refresh().catch(() => undefined);
      // Birthdays and bins don't wait for a slow calendar, but with nothing yet the first call does.
      if (!cache) await job;
      cache = this.cache();
    }
    const items = visibleItems(this.allItems(s, cache, now), now, viewer, { days: 7 });
    return { ...base, items, ...(cache ? { fetchedAt: cache.fetchedAt } : {}), ...(viewer === "adult" && cache?.errors.length ? { errors: cache.errors } : {}) };
  }

  private allItems(s: FamilySettings, cache: Cache | null, now: number): FamilyItem[] {
    const today = dayKey(now);
    const items = [...(cache?.items ?? [])];
    items.push(...birthdayItems(s.birthdays, today, 14, s.birthdaysForKids));
    if (s.bins.mode === "schedule") items.push(...binItems(s.bins.rules, today, 14));
    const school = schoolItem(s.school, now);
    if (school) items.push(school);
    return items;
  }

  /** Reads every calendar (and bin sensor) once, keeping what worked and what didn't. */
  refresh(): Promise<void> {
    if (this.fetching) return this.fetching;
    const s = this.settings();
    this.fetching = (async () => {
      const now = this.now();
      const items: FamilyItem[] = [];
      const errors: Cache["errors"] = [];
      if (this.demo) items.push(...demoItems(now));
      else {
        const from = now - 86_400_000;
        const to = now + (AHEAD_DAYS + 1) * 86_400_000;
        await Promise.all([
          ...s.calendars.map(async (cal) => {
            try {
              items.push(...(cal.kind === "ha" ? await this.readHa(s, cal, from, to) : await this.readIcal(cal, from, to)));
            } catch (err) {
              const message = err instanceof Error ? redactUrl(err.message) : "Couldn't read it";
              errors.push({ name: cal.name, message: message.slice(0, 160) });
              this.ctx.log.warn({ calendar: cal.name, err: message }, "Couldn't read a family calendar");
            }
          }),
          ...(s.bins.mode === "ha"
            ? [
                this.readBins(s, now).then(
                  (b) => void items.push(...b),
                  (err) => void errors.push({ name: "Bin collection", message: String(err instanceof Error ? err.message : err).slice(0, 160) }),
                ),
              ]
            : []),
        ]);
      }
      // Every calendar failing counts as a failure (try again soon); some working is progress.
      if (!this.demo && errors.length && !items.length) this.failedAt = this.now();
      else this.failedAt = 0;
      this.ctx.db.setKv("family-cache", { fetchedAt: now, items, errors } satisfies Cache);
      this.ctx.events.emit({ type: "family.changed" });
    })().finally(() => {
      this.fetching = null;
    });
    return this.fetching;
  }

  private async readIcal(cal: FamilyCalendar, from: number, to: number): Promise<FamilyItem[]> {
    if (!cal.url) return [];
    const res = await fetchOk(cal.url, this.ctx.fetchImpl, { headers: { Accept: "text/calendar, */*" } }, 20_000);
    const text = await res.text();
    if (text.length > MAX_ICS_BYTES) throw new Error("That calendar is too big to read");
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link isn't an iCal calendar");
    return parseIcs(text, { from, to, source: cal.id, kids: cal.kids, detail: cal.name });
  }

  private haHeaders(s: FamilySettings): Record<string, string> {
    if (!s.ha.url || !s.ha.token) throw new Error("Set the Home Assistant address and token first");
    return { Authorization: `Bearer ${s.ha.token}`, Accept: "application/json" };
  }

  private async readHa(s: FamilySettings, cal: FamilyCalendar, from: number, to: number): Promise<FamilyItem[]> {
    const q = new URLSearchParams({ start: new Date(from).toISOString(), end: new Date(to).toISOString() });
    const res = await fetchOk(`${s.ha.url}/api/calendars/${encodeURIComponent(cal.entity ?? "")}?${q}`, this.ctx.fetchImpl, { headers: this.haHeaders(s) }, 15_000);
    return haEventItems((await res.json()) as HaEvent[], cal);
  }

  private async readBins(s: FamilySettings, now: number): Promise<FamilyItem[]> {
    const headers = this.haHeaders(s);
    const out: FamilyItem[] = [];
    for (const entity of s.bins.entities) {
      const res = await fetchOk(`${s.ha.url}/api/states/${encodeURIComponent(entity)}`, this.ctx.fetchImpl, { headers }, 10_000);
      const st = (await res.json()) as { state?: string; attributes?: { friendly_name?: string } };
      const day = binDayFromState(String(st.state ?? ""), now);
      if (!day) continue;
      const name = String(st.attributes?.friendly_name ?? entity).replace(/\s*(next )?(collection|pickup|pick-up)\s*$/i, "").trim() || "Bin";
      out.push({ id: `bin:${entity}:${day}`, kind: "bin", title: name, start: dayStart(day), allDay: true, day, kids: true });
    }
    return out;
  }

  start(): void {
    this.timer = setInterval(() => {
      const s = this.settings();
      if (s.calendars.length || s.bins.mode === "ha") void this.refresh().catch(() => undefined);
    }, FRESH_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

export function registerFamily(app: FastifyInstance, family: Family, viewerProfile: (req: FastifyRequest) => Profile | null | undefined): void {
  /** What's coming, for Home and the idle screen: cleaned for the profile asking. */
  app.get("/api/family", async (req) => family.state(viewerProfile(req)));
  /** The settings with the Home Assistant token left out (adults only: calendar links can be secret). */
  app.get("/api/family/settings", async () => familySettingsView(family.settings()));
  app.put("/api/family/settings", async (req: FastifyRequest<{ Body: FamilyPatch }>) => {
    family.saveSettings(req.body ?? {});
    return familySettingsView(family.settings());
  });
  /** Reads the calendars again now and says how each went. */
  app.post("/api/family/refresh", async (req) => {
    await family.refresh().catch(() => undefined);
    return family.state(viewerProfile(req));
  });
}
