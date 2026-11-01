// The Hub's health check (#96). GET /api/health answers with this, Docker's HEALTHCHECK reads `ok`
// from it, and the box's Hub-down screen and the update scripts check it too.
//
// It looks at four things - the database answers, the data volume has room, the scheduler's
// recording loop is still ticking and the data folder can be written - answers in well under a
// second, and never throws: a check that fails becomes `ok: false` plus a plain reason there.
//
// Only things a restart can fix make it unhealthy: a Hub whose NAS recording share is unmounted is
// for the alerts page, not for Docker's autoheal, because restarting the container won't mount it.

import { rm, statfs as fsStatfs, writeFile } from "node:fs/promises";
import path from "node:path";

/** The scheduler ticks every 10 s: this long without one means its loop is stuck. */
export const SCHEDULER_STALE_MS = 2 * 60_000;
/** The data volume holds the database, logs and art: below this room the Hub is nearly full. */
export const MIN_DATA_FREE_BYTES = 2 * 1e9;

/** The bits of the Hub the checks need. `HubContext` satisfies it; tests pass a small fake. */
export interface HealthContext {
  db: { get(query: string): unknown };
  scheduler: { running: boolean; lastTickAt?: number | undefined };
  recorder: { activeIds(): string[] };
}

export interface HealthCheck {
  ok: boolean;
  detail?: string;
}

export interface HubHealth {
  ok: boolean;
  status: "ok" | "degraded";
  checks: {
    db: HealthCheck;
    /** Free space on the volume that holds the data folder. */
    disk: HealthCheck & { freeGb: number };
    scheduler: HealthCheck & { lastTickAgeMs?: number };
    dataDir: HealthCheck & { writable: boolean };
  };
  /** Plain sentences for the checks that failed, for the phone, the logs and the box's screen. */
  reasons: string[];
}

export interface HealthOptions {
  /** The Hub's data folder (`config.dataDir`): the free-space check and the write check both use it. */
  dataDir: string;
  /** Tests pass a fixed time so the scheduler's age is predictable. */
  now?: number;
  /** Tests pass a fake free-space answer; the Hub uses node:fs. */
  statfs?: (folder: string) => Promise<{ bavail: number; bsize: number }>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads a row: the cheapest true test of "the database answers", and a broken one throws. */
function checkDb(ctx: HealthContext): HealthCheck {
  try {
    ctx.db.get("SELECT 1 AS ok");
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: message(err) };
  }
}

async function checkDisk(dataDir: string, statfs: HealthOptions["statfs"]): Promise<HubHealth["checks"]["disk"]> {
  try {
    const fs = await (statfs ?? fsStatfs)(dataDir);
    const freeBytes = fs.bavail * fs.bsize;
    const freeGb = Math.round(freeBytes / 1e9);
    return freeBytes >= MIN_DATA_FREE_BYTES ? { ok: true, freeGb } : { ok: false, freeGb, detail: `only ${freeGb} GB free` };
  } catch (err) {
    return { ok: false, freeGb: 0, detail: message(err) };
  }
}

function checkScheduler(ctx: HealthContext, now: number): HubHealth["checks"]["scheduler"] {
  // A Hub that never started the clock (standing by after a move-out, or demo mode) has nothing
  // to be late: only a running loop that stopped ticking is a fault.
  if (!ctx.scheduler.running) return { ok: true };
  const last = ctx.scheduler.lastTickAt;
  if (last === undefined) return { ok: true };
  const lastTickAgeMs = Math.max(0, now - last);
  // A recording in progress must never make the Hub look dead: a restart would cut it off, and the
  // recorder has its own reconnecting loop.
  if (lastTickAgeMs <= SCHEDULER_STALE_MS || ctx.recorder.activeIds().length > 0) return { ok: true, lastTickAgeMs };
  return { ok: false, lastTickAgeMs, detail: `no tick for ${Math.round(lastTickAgeMs / 1000)} s` };
}

async function checkDataDir(dataDir: string): Promise<HubHealth["checks"]["dataDir"]> {
  // A real write, with a name of its own: two health checks at once mustn't delete each other's file.
  const probe = path.join(dataDir, `.health-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(probe, "");
    await rm(probe, { force: true });
    return { ok: true, writable: true };
  } catch (err) {
    await rm(probe, { force: true }).catch(() => undefined);
    return { ok: false, writable: false, detail: message(err) };
  }
}

/**
 * Everything that's wrong with the Hub right now, in under a second. `ok` is true only when every
 * check answered; a failure never throws out of here.
 */
export async function hubHealth(ctx: HealthContext, opts: HealthOptions): Promise<HubHealth> {
  const now = opts.now ?? Date.now();
  const [disk, dataDir] = await Promise.all([checkDisk(opts.dataDir, opts.statfs), checkDataDir(opts.dataDir)]);
  const checks: HubHealth["checks"] = { db: checkDb(ctx), disk, scheduler: checkScheduler(ctx, now), dataDir };

  const reasons: string[] = [];
  if (!checks.db.ok) reasons.push(`The database didn't answer${checks.db.detail ? `: ${checks.db.detail}` : ""}`);
  if (!checks.disk.ok) reasons.push(checks.disk.freeGb > 0 ? `The data disk is nearly full (${checks.disk.freeGb} GB free)` : `Can't read the data disk's free space${checks.disk.detail ? `: ${checks.disk.detail}` : ""}`);
  if (!checks.scheduler.ok) reasons.push(`The recording loop hasn't ticked${checks.scheduler.lastTickAgeMs !== undefined ? ` for ${Math.round(checks.scheduler.lastTickAgeMs / 1000)} s` : ""}`);
  if (!checks.dataDir.ok) reasons.push(`The data folder can't be written${checks.dataDir.detail ? `: ${checks.dataDir.detail}` : ""}`);

  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, status: ok ? "ok" : "degraded", checks, reasons };
}
