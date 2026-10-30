// Kids time limits: a daily allowance and a bedtime per Kids profile. The TV (and the Android
// client) tell the Hub every half minute while something plays; the Hub adds up the time, says
// how long is left, and once it's up refuses to start anything new on that profile. What's on
// may finish (up to HARD_CAP_MS), then the TV goes back to the profile picker, where an adult's
// PIN gives 15, 30 or 60 more minutes or lifts the limits until the morning.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AlertSettings, KidsLimits, KidsTimeStatus, Profile } from "@ultimatetv/shared";
import { hasKidsLimits, KIDS_EXTRA_TIME } from "@ultimatetv/shared";
import { deliver } from "./alerts.js";
import type { Db } from "./db.js";
import type { ProfileStore } from "./profiles.js";

/** The last five minutes count as a warning; the TV shows one at 5 and at 2 minutes. */
export const WARN_MS = 5 * 60_000;
/** Time's up, but what's on may finish: for this long at most. */
export const HARD_CAP_MS = 30 * 60_000;
/** Bedtime lasts until this time the next morning. */
export const MORNING = "06:00";
/** A gap between two "still playing" reports longer than this isn't counted (the TV was off, or the Hub restarted). */
const MAX_GAP_MS = 90_000;

/** One profile's day: kept in the database so a Hub restart doesn't hand out fresh time. */
interface DayRecord {
  day: string;
  usedMs: number;
  /** Extra allowance an adult gave today. */
  bonusMs: number;
  /** The last report that something was playing. */
  lastPlayingAt?: number;
  /** When the allowance ran out today. */
  allowanceOutAt?: number;
  /** Alerts sent today, by reason. */
  alerted: ("allowance" | "bedtime")[];
}

/** Bedtime passes and unlocks run across midnight, so they're kept apart from the day. */
interface Passes {
  /** More time at bedtime: watching is allowed until then. */
  bedtimeUntil?: number;
  /** No limits until then. */
  unlockedUntil?: number;
}

interface Stored {
  days: Record<string, DayRecord>;
  passes: Record<string, Passes>;
}

/** The local date as YYYY-MM-DD: the allowance resets at midnight on the Hub's clock. */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function at(base: Date, hhmm: string, addDays = 0): number {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, h, m).getTime();
}

function midnight(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Tonight's bedtime window: from bedtime until MORNING. Before MORNING it's still last night.
 * Friday and Saturday nights use the weekend bedtime.
 */
export function bedtimeWindow(limits: KidsLimits, now: number): { bedtime: string; start: number; end: number } | null {
  const d = new Date(now);
  const evening = now < at(d, MORNING) ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1) : d;
  const weekend = evening.getDay() === 5 || evening.getDay() === 6;
  const bedtime = weekend ? limits.weekendBedtime : limits.weekdayBedtime;
  if (!bedtime) return null;
  // A bedtime after midnight (not offered in Settings, but allowed) belongs to the next day.
  const afterMidnight = bedtime < MORNING;
  return { bedtime, start: at(evening, bedtime, afterMidnight ? 1 : 0), end: at(evening, MORNING, 1) };
}

/** The next MORNING after now: how long "no limits today" lasts. */
export function nextMorning(now: number): number {
  const d = new Date(now);
  const today = at(d, MORNING);
  return now < today ? today : at(d, MORNING, 1);
}

/** Works out where a profile stands. Pure, for the tests. */
export function kidsStatus(profile: Pick<Profile, "id" | "limits">, rec: DayRecord, passes: Passes, now: number): KidsTimeStatus {
  const limits = profile.limits;
  const base = { profileId: profile.id, usedMinutes: Math.floor(rec.usedMs / 60_000) };
  if (!limits || !hasKidsLimits(limits)) return { ...base, limited: false, state: "ok", allowanceMinutes: null, bedtime: null, minutesLeft: null };
  const allowanceMs = limits.dailyMinutes === null ? null : limits.dailyMinutes * 60_000 + rec.bonusMs;
  const win = bedtimeWindow(limits, now);
  const out = { ...base, limited: true, allowanceMinutes: allowanceMs === null ? null : Math.round(allowanceMs / 60_000), bedtime: win?.bedtime ?? null };
  if (passes.unlockedUntil && passes.unlockedUntil > now) return { ...out, state: "ok", minutesLeft: null, unlockedUntil: passes.unlockedUntil };

  // How long is left before each limit, and when it ran out if it has.
  const left: { reason: "allowance" | "bedtime"; ms: number; since?: number }[] = [];
  if (allowanceMs !== null) {
    const ms = allowanceMs - rec.usedMs;
    left.push({ reason: "allowance", ms, ...(ms <= 0 ? { since: rec.allowanceOutAt ?? now } : {}) });
  }
  if (win) {
    const pass = passes.bedtimeUntil ?? 0;
    if (now < win.start) left.push({ reason: "bedtime", ms: Math.max(win.start, pass) - now });
    else if (now < win.end) {
      if (pass > now) left.push({ reason: "bedtime", ms: pass - now });
      else left.push({ reason: "bedtime", ms: 0, since: Math.max(win.start, pass) });
    }
  }
  if (!left.length) return { ...out, state: "ok", minutesLeft: null };
  const nearest = left.reduce((a, b) => (b.ms < a.ms ? b : a));
  if (nearest.ms > 0) return { ...out, state: nearest.ms <= WARN_MS ? "warn" : "ok", reason: nearest.reason, minutesLeft: Math.ceil(nearest.ms / 60_000) };
  // Out of time: the limit that ran out first decides when watching has to stop.
  const since = Math.min(...left.filter((l) => l.ms <= 0).map((l) => l.since ?? now));
  const stopBy = since + HARD_CAP_MS;
  return { ...out, state: now < stopBy ? "finishing" : "stopped", reason: nearest.reason, minutesLeft: 0, stopBy };
}

export class LimitError extends Error {
  constructor(readonly status: KidsTimeStatus) {
    super(status.reason === "bedtime" ? "It's bedtime. Ask a grown-up for more time." : "That's all the TV for today. Ask a grown-up for more time.");
  }
}

export interface KidsTimeDeps {
  db: Db;
  profiles: ProfileStore;
  /** Where alerts go (Settings › Alerts), and what the app is called. */
  alertSettings: () => AlertSettings;
  appName: () => string;
  fetchImpl: typeof fetch;
  warn: (msg: string, err: unknown) => void;
}

export class KidsTime {
  constructor(private deps: KidsTimeDeps) {}

  private load(): Stored {
    const s = this.deps.db.getKv<Stored>("kids-time");
    return { days: s?.days ?? {}, passes: s?.passes ?? {} };
  }

  private save(s: Stored): void {
    this.deps.db.setKv("kids-time", s);
  }

  /** Today's record, starting a new one after midnight. */
  private day(s: Stored, id: string, now: number): DayRecord {
    const today = dayKey(now);
    const old = s.days[id];
    if (old?.day === today) return old;
    const fresh: DayRecord = { day: today, usedMs: 0, bonusMs: 0, alerted: [] };
    // Something playing across midnight keeps counting from midnight.
    if (old?.lastPlayingAt && now - old.lastPlayingAt <= MAX_GAP_MS) fresh.lastPlayingAt = Math.max(old.lastPlayingAt, midnight(now));
    s.days[id] = fresh;
    return fresh;
  }

  /** Where a profile stands, noting when the allowance ran out and sending the alert once. */
  status(profile: Profile, now = Date.now()): KidsTimeStatus {
    const s = this.load();
    const rec = this.day(s, profile.id, now);
    const passes = s.passes[profile.id] ?? {};
    const st = kidsStatus(profile, rec, passes, now);
    let changed = false;
    if (profile.limits?.dailyMinutes != null && !rec.allowanceOutAt && rec.usedMs >= profile.limits.dailyMinutes * 60_000 + rec.bonusMs) {
      rec.allowanceOutAt = now;
      changed = true;
    }
    if ((st.state === "finishing" || st.state === "stopped") && st.reason && !rec.alerted.includes(st.reason)) {
      rec.alerted.push(st.reason);
      changed = true;
      // Only just reached (not the morning after, or a Hub that was off): worth a word.
      if (profile.limits?.alert && st.stopBy && now - (st.stopBy - HARD_CAP_MS) < 10 * 60_000) this.alert(profile, st.reason);
    }
    if (changed) this.save(s);
    return st;
  }

  /** "Still playing" (or "stopped") from the TV or the Android client on this profile. */
  report(profile: Profile, playing: boolean, now = Date.now()): KidsTimeStatus {
    if (profile.kind !== "kids") return this.status(profile, now);
    const s = this.load();
    const rec = this.day(s, profile.id, now);
    if (rec.lastPlayingAt && now > rec.lastPlayingAt && now - rec.lastPlayingAt <= MAX_GAP_MS) rec.usedMs += now - rec.lastPlayingAt;
    if (playing) rec.lastPlayingAt = now;
    else delete rec.lastPlayingAt;
    this.save(s);
    return this.status(profile, now);
  }

  /** Throws when the profile's time is up, so nothing new starts. */
  check(profile: Profile | null, now = Date.now()): void {
    if (!profile || profile.kind !== "kids" || !hasKidsLimits(profile.limits)) return;
    const st = this.status(profile, now);
    if (st.state === "finishing" || st.state === "stopped") throw new LimitError(st);
  }

  /** An adult gives more time: minutes on the allowance and past bedtime, or 0 for no limits until the morning. */
  extra(profile: Profile, minutes: number, now = Date.now()): KidsTimeStatus {
    const s = this.load();
    const rec = this.day(s, profile.id, now);
    const passes = (s.passes[profile.id] ??= {});
    if (minutes === 0) passes.unlockedUntil = nextMorning(now);
    else {
      const ms = minutes * 60_000;
      // The allowance gets the extra on top of what's been used, so it doesn't vanish into time already over.
      if (profile.limits?.dailyMinutes != null) {
        const allowance = profile.limits.dailyMinutes * 60_000 + rec.bonusMs;
        rec.bonusMs += Math.max(0, rec.usedMs - allowance) + ms;
      }
      passes.bedtimeUntil = Math.max(passes.bedtimeUntil ?? 0, now) + ms;
      delete rec.allowanceOutAt;
      rec.alerted = [];
    }
    this.save(s);
    return this.status(profile, now);
  }

  private alert(profile: Profile, reason: "allowance" | "bedtime"): void {
    const settings = this.deps.alertSettings();
    if (!settings.webhookUrl && !settings.ntfyUrl) return;
    const title = reason === "bedtime" ? `Bedtime for ${profile.name}` : `TV time is up for ${profile.name}`;
    const message = `What's on can finish (up to ${HARD_CAP_MS / 60_000} minutes), then the TV goes back to "Who's watching?". An adult PIN gives more time.`;
    void deliver({ key: `kids-time:${profile.id}`, level: "info", title, message }, settings, this.deps.appName(), this.deps.fetchImpl).catch((err) => this.deps.warn("Couldn't send the Kids time alert", err));
  }
}

type Viewer = { profile: Profile | null; admin: boolean };

export function registerKidsTime(app: FastifyInstance, kids: KidsTime, profiles: ProfileStore, viewer: (req: FastifyRequest) => Viewer): void {
  type Req<P, B> = FastifyRequest<{ Params: P; Body: B }>;
  /** The current profile's standing, or every Kids profile's for an adult (the phone setup page). */
  app.get("/api/kids-time", async (req) => {
    const who = viewer(req);
    if (who.profile?.kind === "kids") return { current: kids.status(who.profile), profiles: [] };
    return { current: null, profiles: who.admin ? profiles.list().filter((p) => p.kind === "kids").map((p) => ({ name: p.name, ...kids.status(p) })) : [] };
  });

  /** One Kids profile's standing: the profile picker asks before switching to it. */
  app.get("/api/kids-time/:id", async (req: Req<{ id: string }, unknown>, reply) => {
    const p = profiles.get(req.params.id);
    if (!p || p.kind !== "kids") return reply.code(404).send({ error: "No such Kids profile" });
    return kids.status(p);
  });

  app.post("/api/kids-time/report", async (req: Req<Record<string, string>, { playing?: boolean }>) => {
    const who = viewer(req);
    return { status: who.profile ? kids.report(who.profile, Boolean(req.body?.playing)) : null };
  });

  /** More time: an adult on the setup page, or anyone with an adult's PIN (the TV at the profile picker). */
  app.post("/api/kids-time/:id/extra", async (req: Req<{ id: string }, { minutes?: number; pin?: string }>, reply) => {
    const p = profiles.get(req.params.id);
    if (!p || p.kind !== "kids") return reply.code(404).send({ error: "No such Kids profile" });
    const minutes = Number(req.body?.minutes);
    if (!(KIDS_EXTRA_TIME as readonly number[]).includes(minutes)) return reply.code(400).send({ error: "Give 15, 30 or 60 minutes, or 0 for no limits today" });
    if (!viewer(req).admin && !profiles.adultPin(req.body?.pin)) return reply.code(403).send({ error: "That PIN isn't right", code: "pin" });
    return { status: kids.extra(p, minutes) };
  });
}
