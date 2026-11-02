// The Hub's nightly backup. Everything the household set up lives in the Hub's database (profiles,
// PINs, IPTV logins, series links, watch history, music channels), so once a night the Hub copies
// it, with the clips it keeps beside it, to the NAS as ultimatetv-hub-<date>-<time>.tar.gz and
// keeps the last 14. The archive is the same shape a trip's move-in uses (see move.ts), so restoring
// one is putting it at data/restore.tar.gz and restarting: tools/hub/restore.sh does that, and so
// does Restore on the phone's Settings page. What a restore replaces is kept in data/before-restore-*.
//
// The NAS is in the same room as the Hub, so a fire or a flood takes both. BACKUP_OFFSITE adds a
// second copy somewhere else: a disk on the box, or an rclone remote (which can be encrypted). It
// runs after the NAS copy has landed, has its own retention, and never undoes the NAS copy: a second
// copy that fails is logged, listed in the state and raised as an alert, and the NAS one stays.
//
// Settings (environment):
//   BACKUP               off to turn it off
//   BACKUP_DIR           where the copies go (default <MEDIA_ROOT>/.ultimatetv-backups, beside the Hub's
//                        data when the NAS isn't mounted in the Hub)
//   BACKUP_KEEP          how many to keep (default 14)
//   BACKUP_TIME          when, in the Hub's time zone (default 03:30)
//   BACKUP_OFFSITE       the second destination: a path (/mnt/usb/ultimatetv) or an rclone remote
//                        (gdrive:UltimateTV/backups); unset or off for no second copy
//   BACKUP_OFFSITE_DIR   a path, when BACKUP_OFFSITE is used for something else
//   BACKUP_OFFSITE_RCLONE  an rclone remote, likewise
//   BACKUP_OFFSITE_KEEP_DAYS   days kept, every copy (default 7)
//   BACKUP_OFFSITE_KEEP_WEEKS  then one a week this far back (default 4)
//
//   GET  /api/backup          what's kept and how the last one went
//   POST /api/backup          back up now
//   POST /api/backup/restore  { name, from? } puts that copy back and restarts the Hub
//
// rclone isn't in the Hub's image (it's a static binary of its own), so it is only ever used when
// the person at home has installed it: `rclone version` is asked first, and a missing one is shown
// as a problem to fix rather than a failure.

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BackupFile, BackupOffsite, BackupState } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import type { Logger } from "./log.js";
import { MOVED_DIRS, RESTORE_FILE } from "./move.js";

const run = promisify(execFile);
/** Runs a command and hands back its output: rclone in production, a stand-in in the tests. */
export type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
const KV = "backup-status";
const NAME = /^ultimatetv-hub-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.tar\.gz$/;
/** The first backup waits this long after the Hub starts, so it doesn't slow the start. */
const START_DELAY_MS = 10 * 60_000;
const CHECK_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

interface Stored {
  lastAttemptAt?: number;
  last?: BackupFile;
  error?: { at: number; message: string };
  /** The second copy's last success and last failure, kept apart from the NAS copy's. */
  offsite?: { last?: BackupFile; error?: { at: number; message: string } };
}

export interface BackupOptions {
  db: Db;
  dataDir: string;
  /** Where the NAS is mounted in the Hub; the copies go there when it is. */
  mediaRoot: string;
  log: Logger;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** How rclone is run; the tests give this a stand-in. */
  exec?: Exec;
}

/** A second destination: what it is, where, and how much it keeps. */
export interface OffsiteConfig {
  kind: "dir" | "rclone";
  target: string;
  keepDays: number;
  keepWeeks: number;
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

/** A file an rclone remote lists: rclone lsf gives its size and modified time, not its age. */
export function backupFileFrom(name: string, bytes: number, at: number): BackupFile | undefined {
  return NAME.test(name) ? { name, at, bytes } : undefined;
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

/**
 * The second destination out of the environment, or undefined when there isn't one. BACKUP_OFFSITE
 * takes either a path or an rclone remote, so one variable is enough; the explicit ones win.
 */
export function offsiteConfig(env: NodeJS.ProcessEnv = process.env): OffsiteConfig | undefined {
  const off = env.BACKUP_OFFSITE === "off" || env.BACKUP_OFFSITE === "0";
  if (off) return undefined;
  const positive = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const keepDays = positive(env.BACKUP_OFFSITE_KEEP_DAYS, 7);
  const keepWeeks = positive(env.BACKUP_OFFSITE_KEEP_WEEKS, 4);
  const dir = env.BACKUP_OFFSITE_DIR?.trim();
  if (dir) return { kind: "dir", target: dir, keepDays, keepWeeks };
  const remote = env.BACKUP_OFFSITE_RCLONE?.trim();
  if (remote) return { kind: "rclone", target: remote, keepDays, keepWeeks };
  // A path is absolute, or starts at home or here; an rclone remote is name:path.
  const both = env.BACKUP_OFFSITE?.trim();
  if (!both) return undefined;
  const looksLikeRemote = !/^[/.~]/.test(both) && !/^[A-Za-z]:[\\/]/.test(both) && /^[^/\\:]+:/.test(both);
  return looksLikeRemote ? { kind: "rclone", target: both, keepDays, keepWeeks } : { kind: "dir", target: both, keepDays, keepWeeks };
}

/**
 * What the second destination keeps: the newest copy of each of the last `keepDays` days, then the
 * newest in each 7-day window going back `keepWeeks` weeks. Pure, so it can be tested on its own.
 */
export function offsiteKeep(files: BackupFile[], now: number, keepDays: number, keepWeeks: number): BackupFile[] {
  const newestFirst = [...files].sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  const kept: BackupFile[] = [];
  const days = new Set<string>();
  const weeks = new Set<number>();
  const dayOf = (at: number) => new Date(at).toDateString();
  for (const f of newestFirst) {
    const ageDays = Math.floor((now - f.at) / DAY_MS);
    if (ageDays < 0) continue; // dated in the future: not ours to keep or drop
    if (ageDays < keepDays) {
      // Only the newest copy made on a given day.
      if (days.has(dayOf(f.at))) continue;
      days.add(dayOf(f.at));
      kept.push(f);
      continue;
    }
    const week = Math.floor((ageDays - keepDays) / 7);
    if (week >= keepWeeks) continue;
    if (weeks.has(week)) continue;
    weeks.add(week);
    kept.push(f);
  }
  return kept;
}

export class Backups {
  readonly enabled: boolean;
  readonly dir: string;
  readonly onNas: boolean;
  readonly keep: number;
  readonly time: string;
  readonly offsite: OffsiteConfig | undefined;
  private running: Promise<BackupFile> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;
  /** rclone's presence, asked once: it doesn't appear where the Hub can see it by itself. */
  private rcloneReady: Promise<boolean> | undefined;

  constructor(private readonly o: BackupOptions) {
    const env = o.env ?? process.env;
    this.enabled = env.BACKUP !== "off" && env.BACKUP !== "0";
    ({ dir: this.dir, onNas: this.onNas } = backupDir(o.dataDir, o.mediaRoot, env));
    const keep = Number(env.BACKUP_KEEP);
    this.keep = Number.isInteger(keep) && keep > 0 ? keep : 14;
    this.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(env.BACKUP_TIME ?? "") ? env.BACKUP_TIME! : "03:30";
    this.offsite = offsiteConfig(env);
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private stored(): Stored {
    return this.o.db.getKv<Stored>(KV) ?? {};
  }

  private exec(): Exec {
    return this.o.exec ?? ((cmd, args) => run(cmd, args, { maxBuffer: 16 * 1024 * 1024 }) as unknown as Promise<{ stdout: string; stderr: string }>);
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

  /** Backs up now (or joins the one already running). A failed second copy doesn't fail this. */
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
      // The second copy comes after the NAS one is safely in place, so its failure can't lose it.
      await this.copyOffsite(done);
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

  /** Whether rclone is there at all, asked once and remembered. */
  private rclonePresent(): Promise<boolean> {
    this.rcloneReady ??= this.exec()("rclone", ["version"]).then(
      () => true,
      () => false,
    );
    return this.rcloneReady;
  }

  /**
   * Copies the archive to the second destination and prunes there, or records why it couldn't. Never
   * throws: the NAS copy is already made and must stay the one that decides whether the night failed.
   */
  private async copyOffsite(done: BackupFile): Promise<void> {
    const cfg = this.offsite;
    if (!cfg) return;
    const at = this.now();
    const source = path.join(this.dir, done.name);
    // The first copy made it, so "last" is the newest one that went across.
    const stored = this.stored();
    try {
      if (cfg.kind === "dir") {
        await mkdir(cfg.target, { recursive: true });
        await copyFile(source, path.join(cfg.target, done.name));
        await chmod(path.join(cfg.target, done.name), 0o600).catch(() => undefined);
        for (const old of this.toDrop(await this.listOffsite(), at, cfg)) {
          await rm(path.join(cfg.target, old.name), { force: true }).catch(() => undefined);
        }
      } else {
        if (!(await this.rclonePresent())) {
          this.o.log.warn({ target: cfg.target }, "BACKUP_OFFSITE_RCLONE is set but rclone isn't installed");
          this.o.db.setKv(KV, {
            ...stored,
            offsite: { ...(stored.offsite?.last ? { last: stored.offsite.last } : {}), error: { at, message: "rclone isn't installed in the Hub, so the second copy can't be made" } },
          } satisfies Stored);
          return;
        }
        await this.exec()("rclone", ["copyto", source, `${cfg.target}/${done.name}`]);
        // rclone lists the remote: what's there, newest first, is what retention works on.
        const { stdout } = await this.exec()("rclone", ["lsf", "--format", "sp", cfg.target]);
        for (const old of this.toDrop(this.filesFromRclone(stdout), at, cfg)) {
          await this.exec()("rclone", ["delete", `${cfg.target}/${old.name}`]);
        }
      }
      this.o.db.setKv(KV, { ...this.stored(), offsite: { ...(stored.offsite?.error ? { error: stored.offsite.error } : {}), last: done } } satisfies Stored);
      this.o.log.info({ target: cfg.target, name: done.name }, "Copied the backup off-site");
    } catch (err) {
      const message = ((err as { stderr?: string }).stderr || (err as Error).message || String(err)).trim().split("\n")[0]!.slice(0, 300);
      this.o.db.setKv(KV, { ...this.stored(), offsite: { ...(stored.offsite?.last ? { last: stored.offsite.last } : {}), error: { at, message } } } satisfies Stored);
      this.o.log.error({ target: cfg.target, err: message }, "The second copy of the Hub's backup failed; the NAS copy is still there");
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

  /** The name's date as the archive's time, for a listing that only gives its name. */
  private nameAt(name: string): number {
    const m = NAME.exec(name);
    if (!m) return 0;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  }

  /** What the second destination has, newest first. */
  private async listOffsite(): Promise<BackupFile[]> {
    const cfg = this.offsite;
    if (!cfg) return [];
    if (cfg.kind === "dir") {
      const names = await readdir(cfg.target).catch(() => [] as string[]);
      const out: BackupFile[] = [];
      for (const name of names) {
        if (!NAME.test(name)) continue;
        const info = await stat(path.join(cfg.target, name)).catch(() => null);
        if (!info?.isFile()) continue;
        out.push({ name, at: this.nameAt(name), bytes: info.size });
      }
      return out.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
    }
    if (!(await this.rclonePresent())) return [];
    const { stdout } = await this.exec()("rclone", ["lsf", "--format", "sp", cfg.target]).catch(() => ({ stdout: "", stderr: "" }));
    return this.filesFromRclone(stdout);
  }

  /** What retention drops at the second destination: everything the policy doesn't keep. */
  private toDrop(files: BackupFile[], at: number, cfg: OffsiteConfig): BackupFile[] {
    const kept = new Set(offsiteKeep(files, at, cfg.keepDays, cfg.keepWeeks).map((f) => f.name));
    return files.filter((f) => !kept.has(f.name));
  }

  /** rclone lsf --format sp gives "-1;2026-11-02 03:30:00;name", one a line. */
  private filesFromRclone(stdout: string): BackupFile[] {
    const out: BackupFile[] = [];
    for (const line of stdout.split("\n")) {
      const parts = line.trim().split(";");
      if (parts.length < 3) continue;
      const name = parts.slice(2).join(";").trim();
      if (!NAME.test(name)) continue;
      const bytes = Number(parts[0]);
      out.push({ name, at: this.nameAt(name), bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0 });
    }
    return out.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  }

  /** The state of the second destination for the TV and the setup page. */
  private async offsiteState(): Promise<BackupOffsite | undefined> {
    const cfg = this.offsite;
    if (!cfg) return undefined;
    const stored = this.stored().offsite;
    let problem: string | undefined;
    if (cfg.kind === "rclone" && !(await this.rclonePresent())) {
      problem = "rclone isn't installed in the Hub, so the second copy can't be made. Install it on the Docker LXC and restart the Hub.";
    }
    return {
      kind: cfg.kind,
      target: cfg.target,
      keepDays: cfg.keepDays,
      keepWeeks: cfg.keepWeeks,
      ...(stored?.last ? { last: stored.last } : {}),
      ...(stored?.error ? { error: stored.error } : {}),
      ...(problem ? { problem } : {}),
      files: await this.listOffsite().catch(() => [] as BackupFile[]),
    };
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
    const offsite = await this.offsiteState();
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
      ...(offsite ? { offsite } : {}),
    };
  }

  /** For the alerts: when the last good copy was made, whether the latest attempt failed, and the second copy. */
  health(): { enabled: boolean; lastOkAt?: number; error?: string; offsite?: { target: string; error?: string }; since: number } {
    const s = this.stored();
    const failed = s.error && (!s.last || s.error.at > s.last.at);
    const offsite = this.offsite;
    const offsiteFailed = offsite && s.offsite?.error && (!s.offsite.last || s.offsite.error.at > s.offsite.last.at);
    return {
      enabled: this.enabled,
      since: this.startedAt,
      ...(s.last ? { lastOkAt: s.last.at } : {}),
      ...(failed ? { error: s.error!.message } : {}),
      ...(offsite ? { offsite: { target: offsite.target, ...(offsiteFailed ? { error: s.offsite!.error!.message } : {}) } } : {}),
    };
  }

  /**
   * Puts a copy where the Hub unpacks it at its next start (see applyPendingRestore). The NAS copy is
   * used when it's there; when it has gone, the second destination is asked.
   */
  async stageRestore(name: string, from?: "nas" | "offsite"): Promise<void> {
    if (!NAME.test(name)) throw Object.assign(new Error("That isn't one of the Hub's backups"), { statusCode: 400 });
    const part = path.join(this.o.dataDir, `${RESTORE_FILE}.in`);
    const local = path.join(this.dir, name);
    if (from !== "offsite" && (await stat(local).catch(() => null))?.isFile()) {
      await copyFile(local, part);
    } else if (this.offsite) {
      await this.stageFromOffsite(name, part);
    } else {
      throw Object.assign(new Error("That backup has gone"), { statusCode: 404 });
    }
    await rename(part, path.join(this.o.dataDir, RESTORE_FILE));
    this.o.log.info({ name, from: from ?? "nas" }, "Restoring a backup; restarting with it");
  }

  /** Copies a backup down from the second destination into `part`. */
  private async stageFromOffsite(name: string, part: string): Promise<void> {
    const cfg = this.offsite!;
    if (cfg.kind === "dir") {
      const from = path.join(cfg.target, name);
      if (!(await stat(from).catch(() => null))?.isFile()) throw Object.assign(new Error("That backup has gone from both places"), { statusCode: 404 });
      await copyFile(from, part);
      return;
    }
    if (!(await this.rclonePresent())) {
      throw Object.assign(new Error("That backup has gone, and rclone isn't installed to fetch the second copy"), { statusCode: 404 });
    }
    await this.exec()("rclone", ["copyto", `${cfg.target}/${name}`, part]).catch(() => {
      throw Object.assign(new Error("That backup has gone from both places"), { statusCode: 404 });
    });
    if (!(await stat(part).catch(() => null))?.isFile()) throw Object.assign(new Error("That backup has gone from both places"), { statusCode: 404 });
  }
}

export function registerBackups(app: FastifyInstance, backups: Backups, restart: () => void): void {
  app.get("/api/backup", async () => backups.state());
  app.post("/api/backup", async () => {
    await backups.run();
    return backups.state();
  });
  app.post("/api/backup/restore", async (req: FastifyRequest<{ Body: { name?: string; from?: string } }>, reply) => {
    const from = req.body?.from === "offsite" ? "offsite" : undefined;
    await backups.stageRestore(String(req.body?.name ?? ""), from);
    reply.raw.on("close", () => restart());
    return { ok: true, restarting: true };
  });
}
