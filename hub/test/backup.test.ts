import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "@ultimatetv/shared";
import { currentAlerts } from "../src/alerts.js";
import { backupDir, backupName, Backups, slotBefore } from "../src/backup.js";
import { Db } from "../src/db.js";
import { silentLogger } from "../src/log.js";
import { applyPendingRestore } from "../src/move.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let db: Db;
const dataDir = () => path.join(tmp, "data");
const nas = () => path.join(tmp, "nas");

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-backup-"));
  await mkdir(dataDir(), { recursive: true });
  await mkdir(path.join(nas(), "Films"), { recursive: true });
  db = new Db(path.join(dataDir(), "hub.db"));
});

afterEach(async () => {
  db.close();
  await rm(tmp, { recursive: true, force: true });
});

const at = (s: string) => new Date(s).getTime();

describe("the Hub's nightly backup", () => {
  it("copies the database and clips to the NAS and keeps only the newest", async () => {
    db.setKv("marker", "home");
    await mkdir(path.join(dataDir(), "scare-clips"), { recursive: true });
    await writeFile(path.join(dataDir(), "scare-clips", "boo.mp4"), "boo");
    let now = at("2026-10-30T03:30:00");
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_KEEP: "2" }, now: () => now });
    expect(backups.dir).toBe(path.join(nas(), ".ultimatetv-backups"));
    expect(backups.onNas).toBe(true);

    const first = await backups.run();
    expect(first.name).toBe("ultimatetv-hub-2026-10-30-0330.tar.gz");
    const files = execFileSync("tar", ["-tzf", path.join(backups.dir, first.name)], { encoding: "utf8" });
    expect(files).toContain("hub.db");
    expect(files).toContain("scare-clips/boo.mp4");

    for (const day of ["2026-10-31T03:30:00", "2026-11-01T03:30:00"]) {
      now = at(day);
      await backups.run();
    }
    const state = await backups.state();
    expect(state.backups.map((b) => b.name)).toEqual(["ultimatetv-hub-2026-11-01-0330.tar.gz", "ultimatetv-hub-2026-10-31-0330.tar.gz"]);
    expect(state.last?.name).toBe("ultimatetv-hub-2026-11-01-0330.tar.gz");
    expect(state.error).toBeUndefined();
    // No staging folder or half-written file left behind.
    expect(await readdir(dataDir())).not.toContain("backup-staging");
    expect((await readdir(backups.dir)).some((f) => f.endsWith(".part"))).toBe(false);
  });

  it("runs once a night at its time, the first a while after the Hub starts", async () => {
    let now = at("2026-10-30T12:00:00");
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: {}, now: () => now });
    backups.start();
    try {
      await backups.tick();
      expect((await backups.state()).backups).toHaveLength(0); // too soon after starting
      now += 11 * 60_000;
      await backups.tick();
      expect((await backups.state()).backups).toHaveLength(1); // never backed up: catch up now
      now = at("2026-10-31T03:00:00");
      await backups.tick();
      expect((await backups.state()).backups).toHaveLength(1);
      expect((await backups.state()).nextAt).toBe(at("2026-10-31T03:30:00"));
      now = at("2026-10-31T03:35:00");
      await backups.tick();
      await backups.tick();
      expect((await backups.state()).backups).toHaveLength(2);
    } finally {
      backups.stop();
    }
  });

  it("works out the slot, the file name and where the copies go", () => {
    expect(slotBefore(at("2026-10-30T03:29:00"), "03:30")).toBe(at("2026-10-29T03:30:00"));
    expect(slotBefore(at("2026-10-30T03:30:00"), "03:30")).toBe(at("2026-10-30T03:30:00"));
    expect(backupName(at("2026-01-02T04:05:00"))).toBe("ultimatetv-hub-2026-01-02-0405.tar.gz");
    expect(backupDir("/data", path.join(tmp, "missing"), {})).toEqual({ dir: "/data/backups", onNas: false });
    expect(backupDir("/data", nas(), { BACKUP_DIR: "/backups" })).toEqual({ dir: "/backups", onNas: true });
  });

  it("records a failure, and the alerts say so until a backup works", async () => {
    const now = at("2026-10-30T03:30:00");
    await writeFile(path.join(tmp, "a-file"), "");
    const backups = new Backups({ db, dataDir: dataDir(), mediaRoot: nas(), log: silentLogger, env: { BACKUP_DIR: path.join(tmp, "a-file", "sub") }, now: () => now });
    await expect(backups.run()).rejects.toThrow(/backup failed/);
    const state = await backups.state();
    expect(state.error?.message).toBeTruthy();
    const alerts = currentAlerts({ now, settings: DEFAULT_ALERT_SETTINGS, iptv: [], events: [], backup: backups.health() });
    expect(alerts.map((a) => a.key)).toContain("backup-failed");
  });

  it("warns when no backup has worked for two nights", () => {
    const now = at("2026-10-30T12:00:00");
    const alerts = (backup: Parameters<typeof currentAlerts>[0]["backup"]) => currentAlerts({ now, settings: DEFAULT_ALERT_SETTINGS, iptv: [], events: [], ...(backup ? { backup } : {}) }).map((a) => a.key);
    expect(alerts({ enabled: true, since: now - 3600_000 })).toEqual([]);
    expect(alerts({ enabled: true, since: now - 30 * 86_400_000, lastOkAt: now - 20 * 3600_000 })).toEqual([]);
    expect(alerts({ enabled: true, since: now - 30 * 86_400_000, lastOkAt: now - 3 * 86_400_000 })).toEqual(["backup-stale"]);
    expect(alerts({ enabled: false, since: now - 30 * 86_400_000 })).toEqual([]);
  });
});

describe("backups from the phone", () => {
  it("backs up on request and restores a copy at the next start", async () => {
    db.close();
    let restarts = 0;
    const app = await buildServer(
      { port: 0, host: "127.0.0.1", dataDir: dataDir(), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: nas(), demo: false },
      { systemReport: async () => ({}) as never, restart: () => restarts++, env: {} },
    );
    await pairAsTv(app);
    app.hub.db.setKv("marker", "before");
    const made = await app.inject({ method: "POST", url: "/api/backup" });
    expect(made.statusCode).toBe(200);
    const name = made.json().last.name as string;
    expect((await app.inject({ url: "/api/backup" })).json().backups).toHaveLength(1);
    app.hub.db.setKv("marker", "after");

    expect((await app.inject({ method: "POST", url: "/api/backup/restore", payload: { name: "../../etc/passwd" } })).statusCode).toBe(400);
    const restore = await app.inject({ method: "POST", url: "/api/backup/restore", payload: { name } });
    expect(restore.statusCode).toBe(200);
    expect(restarts).toBe(1);
    await app.close();

    expect(applyPendingRestore(dataDir(), { info() {}, error() {} })).toBe(true);
    db = new Db(path.join(dataDir(), "hub.db"));
    expect(db.getKv("marker")).toBe("before");
  });
});
