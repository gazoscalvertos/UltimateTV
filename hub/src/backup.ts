// The Hub's nightly backup. Everything the household set up lives in the Hub's database (profiles,
// PINs, IPTV logins, series links, watch history, music channels), so once a night the Hub copies
// it, with the clips it keeps beside it, to the NAS as ultimatetv-hub-<date>-<time>.tar.gz and
// keeps the last 14. The archive is the same shape a trip's move-in uses (see move.ts), so restoring
// one is putting it at data/restore.tar.gz and restarting: tools/hub/restore.sh does that, and so
// does Restore on the phone's Settings page. What a restore replaces is kept in data/before-restore-*.
//
// Settings (environment):
//   BACKUP       off to turn it off
//   BACKUP_DIR   where the copies go (default <MEDIA_ROOT>/.ultimatetv-backups, beside the Hub's
//                data when the NAS isn't mounted in the Hub)
//   BACKUP_KEEP  how many to keep (default 14)
//   BACKUP_TIME  when, in the Hub's time zone (default 03:30)
//
//   GET  /api/backup          what's kept and how the last one went
//   POST /api/backup          back up now
//   POST /api/backup/restore  { name } puts that copy back and restarts the Hub

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BackupFile, BackupState } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import type { Logger } from "./log.js";
import { MOVED_DIRS, RESTORE_FILE } from "./move.js";

const run = promisify(execFile);
const KV = "backup-status";
const NAME = /^ultimatetv-hub-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.tar\.gz$/;
/** The first backup waits this long after the Hub starts, so it doesn't slow the start. */
const START_DELAY_MS = 10 * 60_000;
const CHECK_MS = 5 * 60_000;

interface Stored {
  lastAttemptAt?: number;
  last?: BackupFile;
  error?: { at: number; message: string };
}

export interface BackupOptions {
  db: Db;
  dataDir: string;
  /** Where the NAS is mounted in the Hub; the copies go there when it is. */
  mediaRoot: string;
  log: Logger;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/** The most recent "HH:MM" at or before `now`, in local time. */
export function slotBefore(now: number, time: string): number {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h ?? 3, m ?? 30, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** The next "HH:MM" after `now`. */
export function slotAfter(now: number, time: string): number {
  const d = new Date(slotBefore(now, time));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function backupName(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `ultimatetv-hub-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.tar.gz`;
}

/** Where the copies go: BACKUP_DIR, else a hidden folder on the NAS when it's mounted, else beside the data. */
export function backupDir(dataDir: string, mediaRoot: string, env: NodeJS.ProcessEnv = process.env): { dir: string; onNas: boolean } {
  if (env.BACKUP_DIR) return { dir: env.BACKUP_DIR, onNas: !path.resolve(env.BACKUP_DIR).startsWith(path.resolve(dataDir)) };
  let nas = false;
  try {
    nas = readdirSync(mediaRoot).length > 0;
  } catch {
    // Not mounted.
  }
  return nas ? { dir: path.join(mediaRoot, ".ultimatetv-backups"), onNas: true } : { dir: path.join(dataDir, "backups"), onNas: false };
}

export class Backups {
  readonly enabled: boolean;
  readonly dir: string;
  readonly onNas: boolean;
  readonly keep: number;
  readonly time: string;
  private running: Promise<BackupFile> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;

  constructor(private readonly o: BackupOptions) {
    const env = o.env ?? process.env;
    this.enabled = env.BACKUP !== "off" && env.BACKUP !== "0";
    ({ dir: this.dir, onNas: this.onNas } = backupDir(o.dataDir, o.mediaRoot, env));
    const keep = Number(env.BACKUP_KEEP);
    this.keep = Number.isInteger(keep) && keep > 0 ? keep : 14;
    this.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(env.BACKUP_TIME ?? "") ? env.BACKUP_TIME! : "03:30";
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private stored(): Stored {
    return this.o.db.getKv<Stored>(KV) ?? {};
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.startedAt = this.now();
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Backs up when tonight's (or a missed night's) copy is due. */
  async tick(now = this.now()): Promise<void> {
    if (!this.enabled || this.running || now - this.startedAt < START_DELAY_MS) return;
    if ((this.stored().lastAttemptAt ?? 0) >= slotBefore(now, this.time)) return;
    await this.run().catch(() => undefined);
  }

  /** Backs up now (or joins the one already running). */
  run(): Promise<BackupFile> {
    this.running ??= this.backup().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async backup(): Promise<BackupFile> {
    const at = this.now();
    const name = backupName(at);
    const staging = path.join(this.o.dataDir, "backup-staging");
    const file = path.join(this.dir, name);
    try {
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      await mkdir(this.dir, { recursive: true });
      // A consistent copy of the database while the Hub carries on using it.
      this.o.db.sql.exec(`VACUUM INTO '${path.join(staging, "hub.db").replace(/'/g, "''")}'`);
      const dirs = MOVED_DIRS.filter((n) => existsSync(path.join(this.o.dataDir, n)) && readdirSync(path.join(this.o.dataDir, n)).length);
      await run("tar", ["-czf", `${file}.part`, "-C", staging, "hub.db", ...(dirs.length ? ["-C", this.o.dataDir, ...dirs] : [])], { maxBuffer: 16 * 1024 * 1024 });
      // It holds the IPTV and music logins: only the Hub's own user may read it.
      await chmod(`${file}.part`, 0o600).catch(() => undefined);
      await rename(`${file}.part`, file);
      const bytes = (await stat(file)).size;
      const done: BackupFile = { name, at, bytes };
      this.o.db.setKv(KV, { lastAttemptAt: at, last: done } satisfies Stored);
      this.o.log.info({ file, bytes }, "Backed up the Hub");
      await this.prune();
      return done;
    } catch (err) {
      await rm(`${file}.part`, { force: true }).catch(() => undefined);
      const message = ((err as { stderr?: string }).stderr || (err as Error).message || String(err)).trim().split("\n")[0]!.slice(0, 300);
      const s = this.stored();
      this.o.db.setKv(KV, { ...s, lastAttemptAt: at, error: { at, message } } satisfies Stored);
      this.o.log.error({ dir: this.dir, err: message }, "The Hub's backup failed");
      throw Object.assign(new Error(`The backup failed: ${message}`), { statusCode: 500 });
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** The copies kept, newest first. */
  async list(): Promise<BackupFile[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const out: BackupFile[] = [];
    for (const name of names) {
      const m = NAME.exec(name);
      if (!m) continue;
      const info = await stat(path.join(this.dir, name)).catch(() => null);
      if (!info?.isFile()) continue;
      const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
      out.push({ name, at, bytes: info.size });
    }
    return out.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  }

  private async prune(): Promise<void> {
    for (const old of (await this.list()).slice(this.keep)) {
      await rm(path.join(this.dir, old.name), { force: true }).catch(() => undefined);
    }
  }

  async state(): Promise<BackupState> {
    const s = this.stored();
    const now = this.now();
    const error = s.error && (!s.last || s.error.at > s.last.at) ? s.error : undefined;
    const due = (s.lastAttemptAt ?? 0) < slotBefore(now, this.time);
    return {
      enabled: this.enabled,
      dir: this.dir,
      onNas: this.onNas,
      keep: this.keep,
      time: this.time,
      running: Boolean(this.running),
      ...(s.last ? { last: s.last } : {}),
      ...(error ? { error } : {}),
      ...(this.enabled ? { nextAt: due ? Math.max(now, this.startedAt + START_DELAY_MS) : slotAfter(now, this.time) } : {}),
      backups: await this.list(),
    };
  }

  /** For the alerts: when the last good copy was made, and whether the latest attempt failed. */
  health(): { enabled: boolean; lastOkAt?: number; error?: string; since: number } {
    const s = this.stored();
    const failed = s.error && (!s.last || s.error.at > s.last.at);
    return { enabled: this.enabled, since: this.startedAt, ...(s.last ? { lastOkAt: s.last.at } : {}), ...(failed ? { error: s.error!.message } : {}) };
  }

  /** Puts a copy where the Hub unpacks it at its next start (see applyPendingRestore). */
  async stageRestore(name: string): Promise<void> {
    if (!NAME.test(name)) throw Object.assign(new Error("That isn't one of the Hub's backups"), { statusCode: 400 });
    const from = path.join(this.dir, name);
    if (!(await stat(from).catch(() => null))?.isFile()) throw Object.assign(new Error("That backup has gone"), { statusCode: 404 });
    const part = path.join(this.o.dataDir, `${RESTORE_FILE}.in`);
    await copyFile(from, part);
    await rename(part, path.join(this.o.dataDir, RESTORE_FILE));
    this.o.log.info({ name }, "Restoring a backup; restarting with it");
  }
}

export function registerBackups(app: FastifyInstance, backups: Backups, restart: () => void): void {
  app.get("/api/backup", async () => backups.state());
  app.post("/api/backup", async () => {
    await backups.run();
    return backups.state();
  });
  app.post("/api/backup/restore", async (req: FastifyRequest<{ Body: { name?: string } }>, reply) => {
    await backups.stageRestore(String(req.body?.name ?? ""));
    reply.raw.on("close", () => restart());
    return { ok: true, restarting: true };
  });
}
