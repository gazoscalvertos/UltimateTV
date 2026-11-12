// A small iCal reader for the family board: events (with the usual repeats, exceptions and time
// zones) inside a window of time. It is not a full RFC 5545 engine: it covers what Google, Nextcloud,
// iCloud and Outlook publish for a family calendar, and skips what it can't understand.

import { addDays, dayKey, dayStart, type FamilyItem } from "@ultimatetv/shared";

/** A wall-clock moment: the numbers on a calendar, not yet pinned to a time zone. */
interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** "Z" for UTC, an IANA name for a zone, undefined for floating (the Hub's own clock). */
  tz?: string;
  allDay: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

const unescapeText = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const [name, ...rest] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const r of rest) {
    const eq = r.indexOf("=");
    if (eq > 0) params[r.slice(0, eq).toUpperCase()] = r.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

function parseWall(p: Prop): Wall | null {
  const v = p.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date) return { y: +date[1]!, m: +date[2]!, d: +date[3]!, h: 0, mi: 0, s: 0, allDay: true };
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dt) return null;
  return { y: +dt[1]!, m: +dt[2]!, d: +dt[3]!, h: +dt[4]!, mi: +dt[5]!, s: +dt[6]!, allDay: false, ...(dt[7] ? { tz: "Z" } : p.params.TZID ? { tz: p.params.TZID } : {}) };
}

/** How far ahead of UTC a zone is at a moment, in ms; 0 when the zone isn't one Node knows. */
function zoneOffset(ms: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(ms / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** The moment a wall-clock time is, in its own zone. */
export function wallToMs(w: Wall): number {
  if (w.allDay) return new Date(w.y, w.m - 1, w.d).getTime();
  if (!w.tz) return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime();
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (w.tz === "Z") return guess;
  // Twice, so a time just either side of a clock change still lands right.
  const first = guess - zoneOffset(guess, w.tz);
  return guess - zoneOffset(first, w.tz);
}

const withDate = (w: Wall, y: number, m: number, d: number): Wall => {
  const n = new Date(y, m - 1, d);
  return { ...w, y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
};

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: number;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
}

function parseRule(value: string): Rule | null {
  const kv = Object.fromEntries(value.split(";").map((p) => p.split("=") as [string, string]));
  const freq = kv.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const until = kv.UNTIL ? parseWall({ name: "UNTIL", params: {}, value: kv.UNTIL }) : null;
  const untilMs = until ? (until.allDay ? wallToMs({ ...until, h: 23, mi: 59, s: 59, allDay: false }) : wallToMs(until)) : undefined;
  return {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL) || 1),
    ...(kv.COUNT ? { count: Number(kv.COUNT) } : {}),
    ...(untilMs !== undefined ? { until: untilMs } : {}),
    byDay: (kv.BYDAY ?? "")
      .split(",")
      .map((s) => /^([+-]?\d)?([A-Z]{2})$/.exec(s.trim()))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({ n: m[1] ? Number(m[1]) : 0, wd: DAYS.indexOf(m[2]!) }))
      .filter((x) => x.wd >= 0),
    byMonthDay: (kv.BYMONTHDAY ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 31),
    byMonth: (kv.BYMONTH ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 12),
  };
}

/** The nth (1-based, or -1 for the last) given weekday of a month, as a day of the month; 0 if none. */
function nthWeekday(y: number, m: number, wd: number, n: number): number {
  const days = new Date(y, m, 0).getDate();
  const hits: number[] = [];
  for (let d = 1; d <= days; d++) if (new Date(y, m - 1, d).getDay() === wd) hits.push(d);
  return (n > 0 ? hits[n - 1] : hits[hits.length + n]) ?? 0;
}

/** Every start of a repeating event (as wall-clock times) from the first one on. A generous cap stops a runaway rule. */
function* occurrences(start: Wall, rule: Rule | null, stopMs: number): Generator<Wall> {
  if (!rule) {
    yield start;
    return;
  }
  let emitted = 0;
  const limit = rule.count ?? Infinity;
  const emit = (w: Wall): "yield" | "skip" | "stop" => {
    const ms = wallToMs(w);
    if (ms < wallToMs(start)) return "skip";
    if ((rule.until !== undefined && ms > rule.until) || ms > stopMs) return "stop";
    return "yield";
  };
  for (let i = 0; i < 4000; i++) {
    let batch: Wall[] = [];
    if (rule.freq === "DAILY") batch = [withDate(start, start.y, start.m, start.d + i * rule.interval)];
    else if (rule.freq === "WEEKLY") {
      const wds = rule.byDay.length ? rule.byDay.map((b) => b.wd) : [new Date(start.y, start.m - 1, start.d).getDay()];
      const startDow = new Date(start.y, start.m - 1, start.d).getDay();
      // Weeks run Monday to Sunday (the iCal default).
      const monday = start.d - ((startDow + 6) % 7);
      batch = wds.map((wd) => withDate(start, start.y, start.m, monday + i * 7 * rule.interval + ((wd + 6) % 7))).sort((a, b) => wallToMs(a) - wallToMs(b));
    } else if (rule.freq === "MONTHLY") {
      const first = new Date(start.y, start.m - 1 + i * rule.interval, 1);
      const y = first.getFullYear();
      const m = first.getMonth() + 1;
      const dim = new Date(y, m, 0).getDate();
      const days = rule.byDay.length ? rule.byDay.map((b) => (b.n ? nthWeekday(y, m, b.wd, b.n) : 0)).filter(Boolean) : rule.byMonthDay.length ? rule.byMonthDay : [start.d];
      batch = days.filter((d) => d <= dim).map((d) => withDate(start, y, m, d));
    } else {
      const y = start.y + i * rule.interval;
      const months = rule.byMonth.length ? rule.byMonth : [start.m];
      batch = months.filter((m) => start.d <= new Date(y, m, 0).getDate()).map((m) => withDate(start, y, m, start.d));
    }
    let past = false;
    for (const w of batch) {
      const r = emit(w);
      if (r === "stop") past = true;
      else if (r === "yield") {
        if (emitted++ >= limit) return;
        yield w;
      }
    }
    if (past) return;
  }
}

export interface IcsOptions {
  /** Window of time to keep events from, in ms. */
  from: number;
  to: number;
  /** Shown small under the title. */
  detail?: string;
  kids: boolean;
  /** Prefix for the items' ids, so two calendars never clash. */
  source: string;
}

/** Reads an iCal file into the board's items inside the window. */
export function parseIcs(ics: string, opts: IcsOptions): FamilyItem[] {
  const lines = ics.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  type Ev = { props: Prop[] };
  const events: Ev[] = [];
  let cur: Ev | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) cur = { props: [] };
    else if (/^END:VEVENT$/i.test(line)) {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const p = parseLine(line);
      if (p) cur.props.push(p);
    }
  }
  const out: FamilyItem[] = [];
  const first = (e: Ev, name: string) => e.props.find((p) => p.name === name);
  // Edited single occurrences of a repeating event replace the one they name.
  const replaced = new Set<string>();
  for (const e of events) {
    const rid = first(e, "RECURRENCE-ID");
    const uid = first(e, "UID")?.value;
    const w = rid ? parseWall(rid) : null;
    if (uid && w) replaced.add(`${uid}|${w.allDay ? dayKey(wallToMs(w)) : wallToMs(w)}`);
  }
  for (const e of events) {
    if (/^CANCELLED$/i.test(first(e, "STATUS")?.value ?? "")) continue;
    const dtstart = first(e, "DTSTART");
    const start = dtstart ? parseWall(dtstart) : null;
    if (!start) continue;
    const title = unescapeText(first(e, "SUMMARY")?.value ?? "") || "Busy";
    const location = unescapeText(first(e, "LOCATION")?.value ?? "");
    const uid = first(e, "UID")?.value ?? `${title}${wallToMs(start)}`;
    const dtend = first(e, "DTEND");
    const endWall = dtend ? parseWall(dtend) : null;
    const startMs = wallToMs(start);
    // How long it lasts: an all-day event with no end is one day, a timed one with none is instant.
    const span = endWall ? wallToMs(endWall) - startMs : start.allDay ? 86_400_000 : 0;
    const dayCount = start.allDay ? Math.max(1, Math.round(span / 86_400_000)) : 1;
    const rrule = first(e, "RRULE");
    const rule = rrule ? parseRule(rrule.value) : null;
    const isOverride = Boolean(first(e, "RECURRENCE-ID"));
    const ex = new Set<number | string>();
    for (const p of e.props.filter((x) => x.name === "EXDATE")) {
      for (const v of p.value.split(",")) {
        const w = parseWall({ ...p, value: v });
        if (w) ex.add(w.allDay ? dayKey(wallToMs(w)) : wallToMs({ ...w, ...(w.tz ? {} : start.tz ? { tz: start.tz } : {}) }));
      }
    }
    let n = 0;
    for (const w of occurrences(start, isOverride ? null : rule, opts.to)) {
      const s = wallToMs(w);
      const key = w.allDay ? dayKey(s) : s;
      if (ex.has(key) || (!isOverride && replaced.has(`${uid}|${key}`))) continue;
      const wallEnd = start.allDay ? null : s + span;
      const e2 = start.allDay ? new Date(w.y, w.m - 1, w.d + dayCount).getTime() : wallEnd!;
      if (s > opts.to) break;
      // Already over (an event with no end is over once it has started).
      if (e2 > s ? e2 <= opts.from : s < opts.from) continue;
      // A several-day all-day event is one item for each day it covers.
      if (start.allDay) {
        const day0 = dayKey(s);
        for (let k = 0; k < dayCount; k++) {
          const day = addDays(day0, k);
          if (dayStart(day) < opts.from - 86_400_000 || dayStart(day) > opts.to) continue;
          out.push({ id: `${opts.source}:${uid}:${day}`, kind: "event", title, start: dayStart(day), allDay: true, day, ...(opts.detail || location ? { detail: location || opts.detail! } : {}), kids: opts.kids });
        }
      } else out.push({ id: `${opts.source}:${uid}:${s}`, kind: "event", title, start: s, ...(span > 0 ? { end: e2 } : {}), allDay: false, ...(opts.detail || location ? { detail: location || opts.detail! } : {}), kids: opts.kids });
      if (++n > 400) break;
    }
  }
  return out;
}
