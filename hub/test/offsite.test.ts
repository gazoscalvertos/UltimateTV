// The second copy of the nightly backup: somewhere that isn't the NAS (a disk on the box, or an
// rclone remote, which can be encrypted). See docs/backup.md.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "@ultimatetv/shared";
import { currentAlerts } from "../src/alerts.js";
import { backupName, Backups, offsiteConfig, offsiteKeep } from "../src/backup.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";
import { Db } from "../src/db.js";
import { silentLogger } from "../src/log.js";

let tmp: string;
let db: Db;
const dataDir = () => path.join(tmp, "data");
const nas = () => path.join(tmp, "nas");
const offsite = () => path.join(tmp, "offsite");

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-offsite-"));
  await mkdir(dataDir(), { recursive: true });
  await mkdir(path.join(nas(), "Films"), { recursive: true });
  db = new Db(path.join(dataDir(), "hub.db"));
});

afterEach(async () => {
  db.close();
  await rm(tmp, { recursive: true, force: true });
});

const at = (s: string) => new Date(s).getTime();
const DAYS = 86_400_000;

/** Files named as if one was made at each of `daysAgo` days before `now`. */
const madeOn = (now: number, daysAgo: number[]) => daysAgo.map((d) => ({ name: backupName(now - d * DAYS), at: now - d * DAYS, bytes: 1000 }));

describe("where the second copy goes", () => {
  it("reads a path or an rclone remote out of BACKUP_OFFSITE, and off means off", () => {
    // One variable is enough: a path has a slash, a remote is name:path.
    expect(offsiteConfig({ BACKUP_OFFSITE: "/mnt/usb/ultimatetv" })).toMatchObject({ kind: "dir", target: "/mnt/usb/ultimatetv" });
    expect(offsiteConfig({ BACKUP_OFFSITE: "gdrive:UltimateTV/backups" })).toMatchObject({ kind: "rclone", target: "gdrive:UltimateTV/backups" });
    // The explicit ones win over the shorthand.
    expect(offsiteConfig({ BACKUP_OFFSITE: "gdrive:x", BACKUP_OFFSITE_DIR: "/mnt/usb" })).toMatchObject({ kind: "dir", target: "/mnt/usb" });
    expect(offsiteConfig({ BACKUP_OFFSITE: "/mnt/usb", BACKUP_OFFSITE_RCLONE: "gdrive:x" })).toMatchObject({ kind: "rclone", target: "gdrive:x" });
    // Nothing set, or turned off, means no second copy at all.
    expect(offsiteConfig({})).toBeUndefined();
    expect(offsiteConfig({ BACKUP_OFFSITE: "off" })).toBeUndefined();
    expect(offsiteConfig({ BACKUP_OFFSITE_DIR: "/mnt/usb", BACKUP_OFFSITE: "off" })).toBeUndefined();
    // Retention: 7 daily and 4 weekly unless told otherwise.
    expect(offsiteConfig({ BACKUP_OFFSITE_DIR: "/mnt/usb" })).toMatchObject({ keepDays: 7, keepWeeks: 4 });
    expect(offsiteConfig({ BACKUP_OFFSITE_DIR: "/mnt/usb", BACKUP_OFFSITE_KEEP_DAYS: "3", BACKUP_OFFSITE_KEEP_WEEKS: "2" })).toMatchObject({ keepDays: 3, keepWeeks: 2 });
    expect(offsiteConfig({ BACKUP_OFFSITE_DIR: "/mnt/usb", BACKUP_OFFSITE_KEEP_DAYS: "nonsense" })).toMatchObject({ keepDays: 7, keepWeeks: 4 });
  });
});

describe("what the second copy keeps", () => {
  it("keeps the newest of each of the last days, then one a week before that", () => {
    const now = at("2026-11-02T03:30:00");
    // A copy every day for 40 days, newest first.
    const files = madeOn(now, Array.from({ length: 40 }, (_, d) => d));
    const kept = offsiteKeep(files, now, 7, 4).map((f) => Math.round((now - f.at) / DAYS));
    // 0-6 days: every day. 7-34 days: the newest of each week (7, 14, 21, 28).
    expect(kept).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 14, 21, 28]);
  });

  it("keeps what it has when there is less, and nothing when there is nothing", () => {
    const now = at("2026-11-02T03:30:00");
    expect(offsiteKeep([], now, 7, 4)).toEqual([]);
    const two = madeOn(now, [0, 1]);
    expect(offsiteKeep(two, now, 7, 4).map((f) => f.name)).toEqual(two.map((f) => f.name));
  });

  it("keeps only the newest copy made on the same day", () => {
    const now = at("2026-11-02T08:00:00");
    const first = { name: backupName(at("2026-11-02T03:30:00")), at: at("2026-11-02T03:30:00"), bytes: 1 };
    const again = { name: "ultimatetv-hub-2026-11-02-0715.tar.gz", at: at("2026-11-02T07:15:00"), bytes: 1 };
    const kept = offsiteKeep([first, again], now, 7, 4);
    expect(kept.map((f) => f.name)).toEqual([again.name]);
  });
});

describe("copying to a second disk", () => {
  it("copies the backup there as well, keeps the NAS copy, and prunes what's old", async () => {
    let now = at("2026-11-02T03:30:00");
    const backups = new Backups({
      db,
      dataDir: dataDir(),
      mediaRoot: nas(),
      log: silentLogger,
      env: { BACKUP_OFFSITE_DIR: offsite(), BACKUP_OFFSITE_KEEP_DAYS: "2", BACKUP_OFFSITE_KEEP_WEEKS: "1" },
      now: () => now,
    });
    const first = await backups.run();
    // The same file in both places, and it is the real archive.
    const files = execFileSync("tar", ["-tzf", path.join(offsite(), first.name)], { encoding: "utf8" });
    expect(files).toContain("hub.db");
    const state = await backups.state();
    expect(state.last?.name).toBe(first.name);
    expect(state.offsite).toMatchObject({ kind: "dir", target: offsite(), last: { name: first.name } });
    expect(state.offsite?.error).toBeUndefined();
    expect((state.offsite?.files ?? []).map((f) => f.name)).toEqual([first.name]);

    // Each night's copy goes across, and the second copy's own retention clears the rest.
    for (const day of ["2026-11-03T03:30:00", "2026-11-04T03:30:00", "2026-11-05T03:30:00"]) {
      now = at(day);
      await backups.run();
    }
    const after = await backups.state();
    expect(after.backups).toHaveLength(4); // the NAS keeps its own 14
    // 2 daily, then 1 for the week before: the oldest two have gone, and only from the second copy.
    expect((await readdir(offsite())).sort()).toEqual(["ultimatetv-hub-2026-11-03-0330.tar.gz", "ultimatetv-hub-2026-11-04-0330.tar.gz", "ultimatetv-hub-2026-11-05-0330.tar.gz"]);
    expect((after.offsite?.files ?? []).map((f) => f.name)).toContain("ultimatetv-hub-2026-11-05-0330.tar.gz");
  });

  it("carries on when the second copy fails, keeps the NAS copy, and says so", async () => {
    const now = at("2026-11-02T03:30:00");
    // A file where the folder should be, so writing there fails.
    await writeFile(path.join(tmp, "blocked"), "");
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_OFFSITE_DIR: path.join(tmp, "blocked", "backups") }, now: () => now });
    // The local backup still works, so run() resolves rather than rejecting.
    const done = await backups.run();
    const state = await backups.state();
    expect(state.last?.name).toBe(done.name);
    expect(state.error).toBeUndefined();
    expect(state.offsite?.error?.message).toBeTruthy();
    // The NAS copy is intact and unfailed.
    expect(execFileSync("tar", ["-tzf", path.join(backups.dir, done.name)], { encoding: "utf8" })).toContain("hub.db");
    const alerts = currentAlerts({ now, settings: DEFAULT_ALERT_SETTINGS, iptv: [], events: [], backup: backups.health() });
    expect(alerts.map((a) => a.key)).toContain("backup-offsite-failed");
  });

  it("stops complaining once a second copy goes across again", async () => {
    let now = at("2026-11-02T03:30:00");
    // A file where the folder should be, so writing there fails tonight.
    const blocked = path.join(tmp, "blocked");
    await writeFile(blocked, "");
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_OFFSITE_DIR: path.join(blocked, "backups") }, now: () => now });
    await backups.run();
    const alerts = () => currentAlerts({ now, settings: DEFAULT_ALERT_SETTINGS, iptv: [], events: [], backup: backups.health() }).map((a) => a.key);
    expect(alerts()).toContain("backup-offsite-failed");

    // Whatever was in the way is gone, and tomorrow's copy goes across: the alert goes with it.
    await rm(blocked);
    now = at("2026-11-03T03:30:00");
    const done = await backups.run();
    const state = await backups.state();
    expect(state.offsite).toMatchObject({ last: { name: done.name } });
    expect(state.offsite?.error).toBeUndefined();
    expect(alerts()).not.toContain("backup-offsite-failed");
  });
});

describe("copying to an rclone remote", () => {
  /** A stand-in for rclone: records what it was asked, and answers the way rclone would. */
  function fakeRclone(opts: { fail?: boolean; missing?: boolean } = {}) {
    const calls: string[][] = [];
    const exec = async (cmd: string, args: string[]) => {
      if (cmd !== "rclone") throw new Error(`unexpected command ${cmd}`);
      calls.push(args);
      if (opts.missing && args[0] === "version") throw Object.assign(new Error("spawn rclone ENOENT"), { code: "ENOENT" });
      if (opts.fail && args[0] !== "version") throw Object.assign(new Error("rclone: upload failed"), { stderr: "rclone: upload failed: quota exceeded" });
      if (args[0] === "lsf") return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    return { calls, exec };
  }

  it("copies the archive with rclone and lists what it keeps", async () => {
    const now = at("2026-11-02T03:30:00");
    const rclone = fakeRclone();
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_OFFSITE: "gdrive:UltimateTV/backups" }, now: () => now, exec: rclone.exec });
    const done = await backups.run();
    const commands = rclone.calls.map((c) => c[0]);
    expect(commands).toContain("version"); // it checks before trusting it is there
    expect(rclone.calls).toContainEqual(["copyto", path.join(backups.dir, done.name), `gdrive:UltimateTV/backups/${done.name}`]);
    const state = await backups.state();
    expect(state.offsite).toMatchObject({ kind: "rclone", target: "gdrive:UltimateTV/backups", last: { name: done.name } });
    expect(state.offsite?.problem).toBeUndefined();
  });

  it("does not assume rclone is installed: the local backup carries on without it", async () => {
    const now = at("2026-11-02T03:30:00");
    const rclone = fakeRclone({ missing: true });
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_OFFSITE: "gdrive:UltimateTV/backups" }, now: () => now, exec: rclone.exec });
    const done = await backups.run();
    const state = await backups.state();
    // The NAS copy is made and recorded; the second destination explains itself instead.
    expect(state.last?.name).toBe(done.name);
    expect(state.error).toBeUndefined();
    expect(state.offsite?.problem).toMatch(/rclone/);
    expect(state.offsite?.last).toBeUndefined();
    // Nothing was uploaded and nothing was deleted.
    expect(rclone.calls.some((c) => c[0] === "copyto" || c[0] === "delete")).toBe(false);
  });

  it("records an upload that fails and keeps the local copy", async () => {
    const now = at("2026-11-02T03:30:00");
    const rclone = fakeRclone({ fail: true });
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_OFFSITE: "gdrive:UltimateTV/backups" }, now: () => now, exec: rclone.exec });
    const done = await backups.run();
    const state = await backups.state();
    expect(state.last?.name).toBe(done.name);
    expect(state.offsite?.error?.message).toMatch(/quota exceeded/);
    expect(execFileSync("tar", ["-tzf", path.join(backups.dir, done.name)], { encoding: "utf8" })).toContain("hub.db");
  });
});

describe("restoring from the second copy", () => {
  it("uses it when the NAS copy has gone", async () => {
    const now = at("2026-11-02T03:30:00");
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_OFFSITE_DIR: offsite() }, now: () => now });
    const done = await backups.run();
    // The NAS loses it (a new server, or a wipe).
    await rm(path.join(backups.dir, done.name));
    expect((await backups.state()).offsite?.files.map((f) => f.name)).toEqual([done.name]);
    await backups.stageRestore(done.name);
    // The Hub restarts with it in place, and its database comes back.
    expect(execFileSync("tar", ["-tzf", path.join(dataDir(), "restore.tar.gz")], { encoding: "utf8" })).toContain("hub.db");
  });

  it("says so plainly when the copy is in neither place", async () => {
    const now = at("2026-11-02T03:30:00");
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_OFFSITE_DIR: offsite() }, now: () => now });
    await backups.run();
    await expect(backups.stageRestore("../../etc/passwd")).rejects.toMatchObject({ statusCode: 400 });
    // A name it would have made, but that has gone from both places.
    await expect(backups.stageRestore("ultimatetv-hub-2026-10-01-0330.tar.gz")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("the second copy over the Hub's API", () => {
  it("reports both destinations, and fetches a restore from the second one", async () => {
    db.close();
    const app = await buildServer(
      { port: 0, host: "127.0.0.1", dataDir: dataDir(), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: nas(), demo: false },
      { systemReport: async () => ({}) as never, restart: () => {}, env: { BACKUP_OFFSITE_DIR: offsite() } },
    );
    await pairAsTv(app);
    const made = await app.inject({ method: "POST", url: "/api/backup" });
    expect(made.statusCode).toBe(200);
    const body = made.json();
    // One state, both destinations.
    expect(body.last.name).toBe(body.offsite.last.name);
    expect(body.offsite.target).toBe(offsite());
    expect(body.offsite.files.map((f: { name: string }) => f.name)).toEqual([body.last.name]);

    // The NAS copy goes, and the phone restores it from the second one.
    await rm(path.join(app.jobs.backups.dir, body.last.name));
    expect((await app.inject({ url: "/api/backup" })).json().backups).toHaveLength(0);
    const restore = await app.inject({ method: "POST", url: "/api/backup/restore", payload: { name: body.last.name, from: "offsite" } });
    expect(restore.statusCode).toBe(200);
    expect(execFileSync("tar", ["-tzf", path.join(dataDir(), "restore.tar.gz")], { encoding: "utf8" })).toContain("hub.db");
    await app.close();
    // afterEach closes the shared Db; give it one to close.
    db = new Db(path.join(dataDir(), "hub.db"));
  });
});
