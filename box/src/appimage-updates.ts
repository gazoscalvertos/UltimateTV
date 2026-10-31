// Updates for the desktop AppImage (docs/desktop.md). CI builds the AppImage from main and puts it
// on the repository's "desktop-app" release with a small JSON naming the commit. Settings › About
// (and the phone) check that JSON, and Update downloads the new AppImage beside the running one,
// swaps it in (the old one is kept as <name>.old, for Roll back) and restarts the app.
// It has the same face as updates.ts, which updates the box through its root services instead.

import { createWriteStream } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { BoxSoftware } from "@ultimatetv/shared";

export const DEFAULT_UPDATE_URL = "https://github.com/gazoscalvertos/UltimateTV/releases/download/desktop-app";

/** What CI writes beside the AppImage, and bakes into it as build-info.json. */
export interface DesktopBuild {
  commit: string;
  date?: string;
  branch?: string;
}

/** The AppImage's file name on the release for this machine. */
export function appImageName(arch: string = process.arch): string {
  return `UltimateTV-${arch === "x64" ? "x86_64" : arch}.AppImage`;
}

/** A build description from JSON, or null when it isn't one. */
export function parseBuild(text: string): DesktopBuild | null {
  try {
    const b = JSON.parse(text) as Partial<DesktopBuild>;
    if (typeof b.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(b.commit)) return null;
    return { commit: b.commit, ...(typeof b.date === "string" ? { date: b.date } : {}), ...(typeof b.branch === "string" ? { branch: b.branch } : {}) };
  } catch {
    return null;
  }
}

/** An AppImage is an ELF executable: anything else (an error page, a cut-off download) isn't used. */
export function looksLikeAppImage(head: Buffer, size: number): boolean {
  return size > 20 * 1024 * 1024 && head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
}

interface UpdateRecord {
  at: string;
  ok: boolean;
  from?: string;
  to?: string;
  error?: string;
  rolledBack?: boolean;
}

export interface AppImageUpdatesOptions {
  /** The running AppImage ($APPIMAGE). */
  appImage: string;
  /** build-info.json inside the AppImage. */
  buildInfo: string;
  /** Where the record of the last update is kept (the app's userData folder). */
  stateDir: string;
  /** Restarts the app from the (new) AppImage. */
  relaunch: () => void;
  log: (line: string) => void;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class AppImageUpdates {
  private latest?: { build: DesktopBuild; at: string };
  private checking?: Promise<void>;
  private updating = false;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly recordFile: string;
  private readonly lines: string[] = [];

  constructor(private readonly o: AppImageUpdatesOptions) {
    this.baseUrl = (o.baseUrl ?? DEFAULT_UPDATE_URL).replace(/\/$/, "");
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.recordFile = path.join(o.stateDir, "appimage-update.json");
  }

  private note(line: string): void {
    this.o.log(line);
    this.lines.push(`${new Date().toISOString()} ${line}`);
    if (this.lines.length > 80) this.lines.shift();
  }

  private async own(): Promise<DesktopBuild | null> {
    return parseBuild(await readFile(this.o.buildInfo, "utf8").catch(() => ""));
  }

  private async record(): Promise<UpdateRecord | null> {
    try {
      return JSON.parse(await readFile(this.recordFile, "utf8")) as UpdateRecord;
    } catch {
      return null;
    }
  }

  private async saveRecord(r: UpdateRecord): Promise<void> {
    await mkdir(this.o.stateDir, { recursive: true });
    await writeFile(this.recordFile, JSON.stringify(r));
  }

  async status(check: boolean): Promise<BoxSoftware> {
    const sw: BoxSoftware = { updating: this.updating };
    const own = await this.own();
    if (own) {
      sw.commit = own.commit;
      if (own.date) sw.date = own.date;
      sw.branch = own.branch ?? "main";
    }
    if (check) await this.check();
    if (this.latest) {
      sw.latest = this.latest.build.commit;
      sw.checkedAt = this.latest.at;
    }
    const rec = await this.record();
    if (rec) {
      if (rec.rolledBack) sw.rollback = { at: rec.at, reason: "Asked for in Settings", manual: true, ok: rec.ok, how: "app", ...(rec.from ? { from: rec.from } : {}), ...(rec.to ? { to: rec.to } : {}) };
      else sw.lastUpdate = { at: rec.at, ok: rec.ok };
    }
    const old = await stat(`${this.o.appImage}.old`).catch(() => null);
    if (old && !rec?.rolledBack) {
      sw.canRollBack = true;
      if (rec?.from) sw.rollbackTo = rec.from;
    }
    return sw;
  }

  private check(): Promise<void> {
    this.checking ??= (async () => {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/ultimatetv-desktop.json`, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "UltimateTV-desktop" } });
        if (!res.ok) throw new Error(`GitHub said ${res.status}`);
        const build = parseBuild(await res.text());
        if (!build) throw new Error("the release has no build description");
        this.latest = { build, at: new Date().toISOString() };
      } catch (e) {
        this.note(`Update check failed: ${(e as Error).message}`);
      } finally {
        this.checking = undefined;
      }
    })();
    return this.checking;
  }

  /** Downloads the newest AppImage, swaps it in and restarts. Errors are kept for Settings › About. */
  async start(): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    const target = this.o.appImage;
    const tmp = `${target}.download`;
    const from = (await this.own())?.commit;
    try {
      await this.check();
      const url = `${this.baseUrl}/${appImageName()}`;
      this.note(`Downloading ${url}`);
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15 * 60_000), headers: { "User-Agent": "UltimateTV-desktop" } });
      if (!res.ok || !res.body) throw new Error(`GitHub said ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(tmp));
      const size = (await stat(tmp)).size;
      const fh = await open(tmp, "r");
      const head = Buffer.alloc(4);
      await fh.read(head, 0, 4, 0).finally(() => fh.close());
      if (!looksLikeAppImage(head, size)) throw new Error("the download isn't an AppImage");
      await chmod(tmp, 0o755);
      // The running copy keeps working after it's renamed (it's mounted from its open file).
      await rename(target, `${target}.old`);
      await rename(tmp, target);
      const to = this.latest?.build.commit;
      await this.saveRecord({ at: new Date().toISOString(), ok: true, ...(from ? { from } : {}), ...(to ? { to } : {}) });
      this.note(`Updated${to ? ` to ${to.slice(0, 7)}` : ""}: restarting`);
      this.o.relaunch();
    } catch (e) {
      const msg = (e as Error).message;
      this.note(`Update failed: ${msg}`);
      await rm(tmp, { force: true }).catch(() => undefined);
      await this.saveRecord({ at: new Date().toISOString(), ok: false, error: msg, ...(from ? { from } : {}) }).catch(() => undefined);
      this.updating = false;
      throw e;
    }
  }

  /** Puts the AppImage from before the last update back and restarts. */
  async rollBack(): Promise<void> {
    const target = this.o.appImage;
    const old = `${target}.old`;
    if (!(await stat(old).catch(() => null))) throw new Error("There's no earlier version to go back to");
    const from = (await this.own())?.commit;
    const rec = await this.record();
    await rename(target, `${target}.rolled-back`);
    await rename(old, target);
    await rm(`${target}.rolled-back`, { force: true });
    await this.saveRecord({ at: new Date().toISOString(), ok: true, rolledBack: true, ...(from ? { from } : {}), ...(rec?.from ? { to: rec.from } : {}) });
    this.note("Rolled back to the earlier version: restarting");
    this.o.relaunch();
  }

  async history(): Promise<string[]> {
    return [...this.lines];
  }
}
