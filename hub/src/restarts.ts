// Restart counting, so a Hub that Docker keeps restarting raises an alert instead of just
// looking healthy between crashes (#96).
//
// The boot times live in the database (KV "hub-boots"), not in memory: the restart we most want to
// notice is the one that wipes the process that would have remembered it. `hub/src/index.ts`
// records a boot when a real Hub starts (not a test server, not DEMO=1), and `Alerts.check()` reads
// the same list back.

import type { Alert } from "@ultimatetv/shared";

/** How many restarts inside the window count as "it keeps doing this". */
export const REPEAT_RESTARTS = 3;

/** The window restarts are counted over: long enough to be a pattern, short enough to be current. */
export const RESTART_WINDOW_MS = 6 * 3_600_000;

/** Where the boot times are kept. */
export const BOOTS_KEY = "hub-boots";

/** The alert's key, so it can't be raised twice at once. */
export const RESTART_ALERT_KEY = "hub-restarts";

/** The minimum of a database, as far as this file is concerned. */
export interface BootStore {
  getKv<T>(key: string): T | undefined;
  setKv(key: string, value: unknown): void;
}

/**
 * The boots inside the window, oldest first. Boots in the future are ignored: they'd be a clock
 * change, not a restart, and one wrong timestamp shouldn't raise an alert forever.
 */
export function recentBoots(boots: readonly number[], now: number): number[] {
  const from = now - RESTART_WINDOW_MS;
  return boots.filter((at) => at > from && at <= now).sort((a, b) => a - b);
}

/**
 * How many restarts the boots add up to. The boot in progress is the Hub that's running now, so it
 * isn't a restart: three boots in the window is two restarts.
 */
export function restartCount(boots: readonly number[], now: number): number {
  return Math.max(0, recentBoots(boots, now).length - 1);
}

/**
 * Record this boot and return the boots still in the window. Called once, when a real Hub starts.
 * Older boots are dropped here, so the stored list can't grow without bound.
 */
export function recordBoot(db: BootStore, now = Date.now()): number[] {
  const kept = recentBoots(readBoots(db), now);
  const next = [...kept, now];
  db.setKv(BOOTS_KEY, next);
  return next;
}

/** The boots as stored, tolerating a database that has never recorded one or has junk in it. */
export function readBoots(db: BootStore): number[] {
  const stored = db.getKv<unknown>(BOOTS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((at): at is number => typeof at === "number" && Number.isFinite(at));
}

/**
 * The alert for repeated restarts, or null when the Hub has restarted once at most. It's a warning
 * at the threshold and bad at twice the threshold: a Hub restarting six times in six hours is stuck
 * in a loop, and waiting for the next check wouldn't help.
 */
export function restartAlert(boots: readonly number[], now: number): Omit<Alert, "since"> | null {
  const restarts = restartCount(boots, now);
  if (restarts < REPEAT_RESTARTS) return null;
  const hours = Math.round(RESTART_WINDOW_MS / 3_600_000);
  const loop = restarts >= REPEAT_RESTARTS * 2;
  return {
    key: RESTART_ALERT_KEY,
    level: loop ? "bad" : "warn",
    title: "The Hub keeps restarting",
    message: loop
      ? `The Hub has restarted ${restarts} times in the last ${hours} hours, so it is probably stuck in a crash loop. Check data/logs/hub.log, and the reasons on /api/health, before it settles down.`
      : `The Hub has restarted ${restarts} times in the last ${hours} hours. If it keeps going, Docker will keep bringing it back but something is wrong: the reasons are on /api/health and in data/logs/hub.log.`,
  };
}
