// The family board: one "today" view for the household, built from calendars (iCal links or Home
// Assistant calendars), birthdays, the bin collection and the school run. It shows on Home as a card
// and on the idle screen as the "Today" screensaver. The Hub gathers and cleans the items; this file
// has the settings, the date rules and the words, so the TV, the phone and the tests agree.

export type FamilyKind = "event" | "birthday" | "bin" | "school";

/** One calendar the board reads. */
export interface FamilyCalendar {
  id: string;
  /** What the household calls it: "Family", "Gaz's work". */
  name: string;
  /** "ical" is a link (Google's secret address, Nextcloud's public link, Outlook's published calendar); "ha" is a Home Assistant calendar entity. */
  kind: "ical" | "ha";
  /** An iCal link (https, or webcal which is read as https). */
  url?: string;
  /** A Home Assistant calendar, like calendar.family. */
  entity?: string;
  /** Whether Kids profiles see this calendar's events. Off by default: a calendar is private until the household says otherwise. */
  kids: boolean;
}

export interface FamilyBirthday {
  id: string;
  name: string;
  month: number;
  day: number;
  /** The birth year, when known, for "turns 7". */
  year?: number;
}

/** A bin that goes out on a regular weekday, every week or every few weeks. */
export interface BinRule {
  id: string;
  /** "Green bin", "Recycling". */
  name: string;
  /** 0 is Sunday. */
  weekday: number;
  /** 1 is every week, 2 every other week. */
  everyWeeks: number;
  /** Any date the bin was (or will be) collected, so alternating weeks line up: YYYY-MM-DD. */
  from: string;
}

export interface FamilyBins {
  /** A schedule typed in, a Home Assistant sensor (a date as its state), or no bin card. */
  mode: "off" | "schedule" | "ha";
  rules: BinRule[];
  /** Home Assistant entities whose state is the next collection date, like sensor.green_bin. */
  entities: string[];
  /** Say it the evening before, from this hour (0 to switch the early notice off). */
  eveningFrom: number;
}

/** "School run 08:15" on school days until it has passed. */
export interface FamilySchool {
  on: boolean;
  label: string;
  /** HH:MM. */
  time: string;
  /** 0 is Sunday. */
  days: number[];
}

export interface FamilyHomeAssistant {
  /** The Home Assistant address, like http://192.168.0.20:8123. */
  url: string;
  /** A long-lived access token. The Hub keeps it and never sends it back to a screen. */
  token: string;
}

export interface FamilySettings {
  calendars: FamilyCalendar[];
  ha: FamilyHomeAssistant;
  birthdays: FamilyBirthday[];
  bins: FamilyBins;
  school: FamilySchool;
  /** Whether Kids profiles see birthdays. */
  birthdaysForKids: boolean;
  /** The card on Home. */
  onHome: boolean;
  /** How many items the card shows. */
  homeItems: number;
}

export const DEFAULT_FAMILY_SETTINGS: FamilySettings = {
  calendars: [],
  ha: { url: "", token: "" },
  birthdays: [],
  bins: { mode: "off", rules: [], entities: [], eveningFrom: 17 },
  school: { on: false, label: "School run", time: "08:15", days: [1, 2, 3, 4, 5] },
  birthdaysForKids: true,
  onHome: true,
  homeItems: 5,
};

/** What a screen is told about the settings: the Home Assistant token is only ever "set" or not. */
export interface FamilySettingsView extends Omit<FamilySettings, "ha"> {
  ha: { url: string; tokenSet: boolean };
}

export interface FamilyItem {
  id: string;
  kind: FamilyKind;
  title: string;
  /** Milliseconds; an all-day item starts at local midnight. */
  start: number;
  end?: number;
  allDay: boolean;
  /** YYYY-MM-DD for all-day items (the day itself, whatever the screen's time zone). */
  day?: string;
  /** Where or which calendar, shown small. */
  detail?: string;
  /** Whether a Kids profile may see it. */
  kids: boolean;
}

export type FamilyViewer = "adult" | "kids" | "guest";

export interface FamilyState {
  /** What's coming, soonest first, already cleaned for whoever asked. */
  items: FamilyItem[];
  /** Whether anything is set up at all. */
  configured: boolean;
  onHome: boolean;
  homeItems: number;
  fetchedAt?: number;
  /** Calendars that couldn't be read last time (adults only). */
  errors?: { name: string; message: string }[];
}

// ---------------------------------------------------------------------------
// Dates

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of a moment in the screen's own time zone. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(day: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(y, mo - 1, d);
  return check.getFullYear() === y && check.getMonth() === mo - 1 && check.getDate() === d ? { y, m: mo, d } : null;
}

/** Local midnight of a YYYY-MM-DD day. */
export function dayStart(day: string): number {
  const p = parseDay(day);
  return p ? new Date(p.y, p.m - 1, p.d).getTime() : NaN;
}

/** The day `n` days after a YYYY-MM-DD one (n may be negative). */
export function addDays(day: string, n: number): string {
  const p = parseDay(day);
  if (!p) return day;
  return dayKey(new Date(p.y, p.m - 1, p.d + n).getTime());
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDay(a);
  const pb = parseDay(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const weekdayName = (n: number) => WEEKDAYS[((n % 7) + 7) % 7]!;

/** The day an item falls on, YYYY-MM-DD. */
export function itemDay(item: Pick<FamilyItem, "allDay" | "day" | "start">): string {
  return item.allDay && item.day ? item.day : dayKey(item.start);
}

/** "Today", "Tomorrow", "Saturday", "Sat 21 Nov" for a day, seen from `now`. */
export function familyDayLabel(day: string, now: number): string {
  const diff = daysBetween(dayKey(now), day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const p = parseDay(day);
  if (!p) return day;
  const wd = WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()]!;
  return diff > 1 && diff < 7 ? wd : `${wd.slice(0, 3)} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** "18:30", or "6:30pm" with `clock12`. */
export function timeLabel(ms: number, clock12 = false): string {
  const d = new Date(ms);
  if (!clock12) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const h = d.getHours() % 12 || 12;
  return `${h}${d.getMinutes() ? `:${pad(d.getMinutes())}` : ""}${d.getHours() < 12 ? "am" : "pm"}`;
}

/** When an item is, in a few words: "Today 18:30", "Tomorrow", "Saturday 10:00". */
export function whenLabel(item: FamilyItem, now: number, clock12 = false): string {
  const day = familyDayLabel(itemDay(item), now);
  return item.allDay ? day : `${day} ${timeLabel(item.start, clock12)}`;
}

// ---------------------------------------------------------------------------
// The items that don't come from a calendar

/** The next collections of every bin rule from `fromDay` for `days` days. */
export function binItems(rules: BinRule[], fromDay: string, days: number): FamilyItem[] {
  const out: FamilyItem[] = [];
  for (const rule of rules) {
    const anchor = parseDay(rule.from);
    if (!anchor) continue;
    const every = Math.max(1, rule.everyWeeks);
    for (let i = 0; i <= days; i++) {
      const day = addDays(fromDay, i);
      const p = parseDay(day)!;
      if (new Date(p.y, p.m - 1, p.d).getDay() !== rule.weekday) continue;
      const weeks = Math.round(daysBetween(rule.from, day) / 7);
      if (weeks % every !== 0) continue;
      out.push({ id: `bin:${rule.id}:${day}`, kind: "bin", title: rule.name, start: dayStart(day), allDay: true, day, kids: true });
    }
  }
  return out;
}

/** The household's birthdays in the next `days` days from `fromDay`. */
export function birthdayItems(list: FamilyBirthday[], fromDay: string, days: number, kids = true): FamilyItem[] {
  const out: FamilyItem[] = [];
  const from = parseDay(fromDay);
  if (!from) return out;
  for (const b of list) {
    for (let i = 0; i <= days; i++) {
      const day = addDays(fromDay, i);
      const p = parseDay(day)!;
      if (p.m !== b.month || p.d !== b.day) continue;
      const age = b.year ? p.y - b.year : 0;
      out.push({ id: `bday:${b.id}:${day}`, kind: "birthday", title: `${b.name}'s birthday`, start: dayStart(day), allDay: true, day, ...(age > 0 ? { detail: `Turns ${age}` } : {}), kids });
    }
  }
  return out;
}

/** "School run 08:15" for today when it's a school day and the time hasn't gone. */
export function schoolItem(s: FamilySchool, now: number): FamilyItem | null {
  if (!s.on) return null;
  const today = new Date(now);
  if (!s.days.includes(today.getDay())) return null;
  const [h, m] = s.time.split(":").map(Number);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h ?? 8, m ?? 0).getTime();
  if (start < now - 15 * 60_000) return null;
  return { id: `school:${dayKey(now)}`, kind: "school", title: s.label, start, allDay: false, kids: true };
}

// ---------------------------------------------------------------------------
// What a screen shows

const KIND_ORDER: Record<FamilyKind, number> = { school: 0, event: 1, birthday: 2, bin: 3 };

/**
 * Cleans a pile of items for one viewer: what has already happened goes, private items stay off
 * Kids profiles, a Guest sees nothing of the household's calendars, and the rest comes soonest
 * first. A Kids profile gets the reduced version: at most three things, no times past tomorrow.
 */
export function visibleItems(items: FamilyItem[], now: number, viewer: FamilyViewer, opts: { days?: number; limit?: number } = {}): FamilyItem[] {
  if (viewer === "guest") return [];
  const today = dayKey(now);
  const last = addDays(today, opts.days ?? 7);
  const limit = viewer === "kids" ? Math.min(opts.limit ?? 3, 3) : (opts.limit ?? 40);
  const seen = new Set<string>();
  return items
    .filter((i) => {
      const day = itemDay(i);
      if (day > last) return false;
      if (i.allDay ? day < today : (i.end ?? i.start) < now) return false;
      if (viewer === "kids" && (!i.kids || daysBetween(today, day) > 1)) return false;
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    })
    .sort((a, b) => itemDay(a).localeCompare(itemDay(b)) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || a.start - b.start || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/**
 * The bin line for the evening before: "Green bin goes out tonight" once it's `eveningFrom` o'clock
 * and the collection is tomorrow; "Green bin today" on the day. Empty when none is near.
 */
export function binNotice(items: FamilyItem[], now: number, eveningFrom: number): string {
  const today = dayKey(now);
  const names = (day: string) => [...new Set(items.filter((i) => i.kind === "bin" && itemDay(i) === day).map((i) => i.title))];
  const join = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : (l[0] ?? ""));
  const todays = names(today);
  if (todays.length) return `${join(todays)} collected today`;
  const tomorrows = names(addDays(today, 1));
  if (tomorrows.length && eveningFrom > 0 && new Date(now).getHours() >= eveningFrom) return `${join(tomorrows)} out tonight`;
  return "";
}

/** The first line for a screen's greeting. */
export function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// ---------------------------------------------------------------------------
// Cleaning what a person typed

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const id = (v: unknown) => text(v, 40).replace(/[^\w-]/g, "") || Math.random().toString(36).slice(2, 10);

/** An iCal link: https or http, with webcal:// read as https. Anything else is nothing. */
export function cleanIcalUrl(v: unknown): string {
  const raw = text(v, 800).replace(/^webcal:\/\//i, "https://");
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/** A Home Assistant address without the trailing slash. */
export function cleanHaUrl(v: unknown): string {
  const raw = text(v, 200);
  if (!raw) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

/** A change to the settings: the Home Assistant address and token can each be sent alone. */
export type FamilyPatch = Partial<Omit<FamilySettings, "ha">> & { ha?: Partial<FamilyHomeAssistant> };

export function cleanFamilySettings(patch: FamilyPatch | undefined, base: FamilySettings = DEFAULT_FAMILY_SETTINGS): FamilySettings {
  const p = patch ?? {};
  const bool = (v: unknown, fallback: boolean) => (v === undefined ? fallback : Boolean(v));
  const calendars = Array.isArray(p.calendars)
    ? p.calendars
        .map((c): FamilyCalendar | null => {
          if (!c || typeof c !== "object") return null;
          const kind = c.kind === "ha" ? "ha" : "ical";
          const url = kind === "ical" ? cleanIcalUrl(c.url) : "";
          const entity = kind === "ha" ? text(c.entity, 80).toLowerCase() : "";
          if (kind === "ical" ? !url : !/^calendar\.[a-z0-9_]+$/.test(entity)) return null;
          return { id: id(c.id), name: text(c.name, 40) || (kind === "ha" ? entity.replace(/^calendar\./, "") : "Calendar"), kind, ...(url ? { url } : {}), ...(entity ? { entity } : {}), kids: Boolean(c.kids) };
        })
        .filter((c): c is FamilyCalendar => c !== null)
        .slice(0, 8)
    : base.calendars;
  const birthdays = Array.isArray(p.birthdays)
    ? p.birthdays
        .map((b): FamilyBirthday | null => {
          if (!b || typeof b !== "object") return null;
          const name = text(b.name, 40);
          const month = int(b.month, 0, 12, 0);
          const day = int(b.day, 0, 31, 0);
          if (!name || !month || !day || day > new Date(2024, month, 0).getDate()) return null;
          const year = int(b.year, 1900, 2100, 0);
          return { id: id(b.id), name, month, day, ...(year ? { year } : {}) };
        })
        .filter((b): b is FamilyBirthday => b !== null)
        .slice(0, 40)
    : base.birthdays;
  const rules = Array.isArray(p.bins?.rules)
    ? p.bins!.rules
        .map((r): BinRule | null => {
          if (!r || typeof r !== "object") return null;
          const name = text(r.name, 30);
          const from = typeof r.from === "string" && parseDay(r.from) ? r.from : "";
          if (!name || !from) return null;
          return { id: id(r.id), name, weekday: int(r.weekday, 0, 6, 1), everyWeeks: [1, 2, 3, 4].includes(Number(r.everyWeeks)) ? Number(r.everyWeeks) : 1, from };
        })
        .filter((r): r is BinRule => r !== null)
        .slice(0, 8)
    : base.bins.rules;
  const entities = Array.isArray(p.bins?.entities)
    ? p.bins!.entities
        .map((e) => text(e, 80).toLowerCase())
        .filter((e) => ENTITY.test(e))
        .slice(0, 6)
    : base.bins.entities;
  const bm = p.bins?.mode;
  const school = p.school ?? ({} as Partial<FamilySchool>);
  const time = typeof school.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(school.time) ? school.time : base.school.time;
  const days = Array.isArray(school.days) ? [...new Set(school.days.map((d) => int(d, 0, 6, -1)).filter((d) => d >= 0))].sort() : base.school.days;
  // A token left out of an update keeps the saved one (the screens never see it); a new one replaces it.
  const token = typeof p.ha?.token === "string" ? text(p.ha.token, 600) : base.ha.token;
  return {
    calendars,
    ha: { url: p.ha && "url" in p.ha ? cleanHaUrl(p.ha.url) : base.ha.url, token },
    birthdays,
    bins: { mode: bm === "schedule" || bm === "ha" || bm === "off" ? bm : base.bins.mode, rules, entities, eveningFrom: p.bins?.eveningFrom === undefined ? base.bins.eveningFrom : int(p.bins.eveningFrom, 0, 23, base.bins.eveningFrom) },
    school: { on: bool(school.on, base.school.on), label: text(school.label, 30) || base.school.label, time, days },
    birthdaysForKids: bool(p.birthdaysForKids, base.birthdaysForKids),
    onHome: bool(p.onHome, base.onHome),
    homeItems: int(p.homeItems, 3, 8, base.homeItems),
  };
}

/** The settings as a screen may see them. */
export function familySettingsView(s: FamilySettings): FamilySettingsView {
  return { ...s, ha: { url: s.ha.url, tokenSet: Boolean(s.ha.token) } };
}

/** Whether there's anything to show: a calendar, a birthday, a bin or the school run. */
export function familyConfigured(s: FamilySettings): boolean {
  return s.calendars.length > 0 || s.birthdays.length > 0 || (s.bins.mode === "schedule" && s.bins.rules.length > 0) || (s.bins.mode === "ha" && s.bins.entities.length > 0) || s.school.on;
}

/** A birthday typed in: "14 March", "14 Mar 2017", "14/3", "14/03/2017". Day first, as in the UK. */
export function parseBirthdayText(input: string): { month: number; day: number; year?: number } | null {
  const t = input.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const ok = (day: number, month: number, year?: number) => {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= new Date(2024, month, 0).getDate())) return null;
    return { month, day, ...(year && year >= 1900 && year <= 2100 ? { year } : {}) };
  };
  const num = /^(\d{1,2})[\s/.-]+(\d{1,2})(?:[\s/.-]+(\d{2,4}))?$/.exec(t);
  if (num) {
    const y = num[3] ? Number(num[3]) : undefined;
    return ok(Number(num[1]), Number(num[2]), y !== undefined && y < 100 ? 2000 + y : y);
  }
  const named = /^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?$/.exec(t) ?? /^([a-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(t);
  if (!named) return null;
  const [a, b] = /^\d/.test(named[1]!) ? [named[1]!, named[2]!] : [named[2]!, named[1]!];
  const month = MONTHS.findIndex((m) => b.startsWith(m.toLowerCase())) + 1;
  return month ? ok(Number(a), month, named[3] ? Number(named[3]) : undefined) : null;
}
