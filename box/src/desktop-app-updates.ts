// Updates for an installed Windows or Mac copy of the app (#127, #128).
//
// An AppImage is a file you can swap under a running app, so appimage-updates.ts replaces it in
// place and keeps the old one to roll back to. An installed Windows or Mac app is not that: the
// installer owns it, and the person running the app is not necessarily an administrator. So Update
// here downloads the new installer from the same `desktop-app` release, checks it looks like the
// real thing, and opens it. What happens next is the installer's job:
//
//   Windows  NSIS, per-user (perMachine: false), so it upgrades the copy in %LOCALAPPDATA%\Programs
//            with no administrator prompt, and starts the app again when it's done.
//   macOS    the .dmg opens in Finder; the person drags UltimateTV to Applications, replacing the
//            old copy. Gatekeeper may ask once (see docs/desktop.md).
//
// The last step is therefore a person seeing an installer, not a relaunch of a swapped file, and
// there is no roll back: the older installer isn't kept. Both are said in Settings › About and in
// docs/desktop.md. The rest of the face is the same as updates.ts and appimage-updates.ts, so
// Settings, the phone and the diagnostics agree whichever kind of install is running.
//
// Nothing here touches Electron: openInstaller is passed in (shell.openPath in main.ts), which is
// what makes the whole check-and-download flow testable (box/test/desktop-app-updates.test.ts).

import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type BoxSoftware, type DesktopKind, desktopAsset, desktopBuildFile, desktopKind, looksLikeDesktopDownload, DESKTOP_BUILD_FILE } from "@ultimatetv/shared";
import { DEFAULT_UPDATE_URL, type DesktopBuild, parseBuild } from "./appimage-updates.js";

/**
 * Which kind of download this platform's update is; null for a platform whose desktop build swaps
 * itself in place (Linux), and for the box.
 */
export function installerFor(platform: string): DesktopKind | null {
  const kind = desktopKind(platform);
  return kind === "linux" ? null : kind;
}

/** What a bad download is called in the error, per platform. */
export function installerWord(kind: DesktopKind): string {
  return kind === "windows" ? "a Windows installer" : kind === "macos" ? "a disk image" : "an AppImage";
}

/** Some of the first and last bytes of a file, for looksLikeDesktopDownload. */
export async function endsOf(file: string, size: number): Promise<{ head: Buffer; tail: Buffer }> {
  const want = Math.min(512, size);
  const fh = await open(file, "r");
  try {
    const head = Buffer.alloc(want);
    await fh.read(head, 0, want, 0);
    const tail = Buffer.alloc(want);
    await fh.read(tail, 0, want, Math.max(0, size - want));
    return { head, tail };
  } finally {
    await fh.close();
  }
}

interface UpdateRecord {
  at: string;
  ok: boolean;
  from?: string;
  to?: string;
  error?: string;
}

export interface DesktopAppUpdatesOptions {
  /** Which platform's installer to fetch: process.platform. */
  platform: string;
  /** Which architecture built this copy: process.arch (x64, arm64). */
  arch: string;
  /** The build-info.json beside the app's dist, written by the build scripts. */
  buildInfo: string;
  /** Where the record and the download live: app.getPath("userData"). */
  stateDir: string;
  log: (line: string) => void;
  /** Opens the downloaded installer (Electron's shell.openPath): "" when it opened, else why not. */
  openInstaller: (file: string) => Promise<string>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class DesktopAppUpdates {
  private latest: { build: DesktopBuild; at: string } | null = null;
  private checking: Promise<void> | null = null;
  private updating = false;
  private readonly kind: DesktopKind;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly recordFile: string;
  private readonly lines: string[] = [];

  constructor(private readonly o: DesktopAppUpdatesOptions) {
    this.kind = desktopKind(o.platform);
    this.baseUrl = (o.baseUrl ?? DEFAULT_UPDATE_URL).replace(/\/$/, "");
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.recordFile = path.join(o.stateDir, "desktop-app-update.json");
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
    await mkdir(path.dirname(this.recordFile), { recursive: true });
    await writeFile(this.recordFile, `${JSON.stringify(r, null, 2)}\n`);
  }

  /** The same answers AppImageUpdates gives: what this copy is, what the release has, what happened last time. */
  async status(check: boolean): Promise<BoxSoftware> {
    const own = await this.own();
    const sw: BoxSoftware = {
      ...(own ? { commit: own.commit, date: own.date, branch: own.branch } : { branch: "main" }),
      updating: this.updating,
    };
    if (check) await this.check();
    if (this.latest) {
      sw.latest = this.latest.build.commit;
      sw.checkedAt = this.latest.at;
    }
    const rec = await this.record();
    if (rec) sw.lastUpdate = { at: rec.at, ok: rec.ok };
    return sw;
  }

  /**
   * Asks the release what it has. Never throws: a failed check only goes in the log.
   *
   * This platform's own description is read first, because the three desktop jobs build from the
   * same push and one of them can fail while the others' files move on; the shared
   * ultimatetv-desktop.json is the fallback, for a release that predates the per-platform files.
   */
  private async check(): Promise<void> {
    this.checking ??= (async () => {
      let lastError = "";
      for (const file of [desktopBuildFile(this.kind), DESKTOP_BUILD_FILE]) {
        try {
          const res = await this.fetchImpl(`${this.baseUrl}/${file}`, {
            signal: AbortSignal.timeout(15_000),
            headers: { "User-Agent": "UltimateTV-desktop" },
          });
          if (!res.ok) throw new Error(`GitHub said ${res.status}`);
          const build = parseBuild(await res.text());
          if (!build) throw new Error("the release has no build description");
          this.latest = { build, at: new Date().toISOString() };
          return;
        } catch (e) {
          lastError = (e as Error).message;
          // Only a missing file falls through to the shared one; a real answer is taken as final.
          if (!/GitHub said 404/.test(lastError)) break;
        }
      }
      this.note(`Update check failed: ${lastError}`);
    })().finally(() => {
      this.checking = null;
    });
    await this.checking;
  }

  /** Downloads this platform's installer and opens it. The installer upgrades the app. */
  async start(): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    const own = await this.own();
    const name = desktopAsset(this.kind, this.o.arch);
    const dir = path.join(this.o.stateDir, "updates");
    const target = path.join(dir, name);
    const tmp = `${target}.download`;
    try {
      await this.check();
      if (this.latest && own && this.latest.build.commit === own.commit) {
        this.note("Already up to date");
        return;
      }
      await mkdir(dir, { recursive: true });
      this.note(`Downloading ${name}`);
      const res = await this.fetchImpl(`${this.baseUrl}/${name}`, {
        signal: AbortSignal.timeout(15 * 60_000),
        headers: { "User-Agent": "UltimateTV-desktop" },
      });
      if (!res.ok || !res.body) throw new Error(`GitHub said ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
      const size = (await stat(tmp)).size;
      const { head, tail } = await endsOf(tmp, size);
      if (!looksLikeDesktopDownload(this.kind, head, tail, size)) throw new Error(`the download isn't ${installerWord(this.kind)}`);
      await rename(tmp, target);
      await this.saveRecord({ at: new Date().toISOString(), ok: true, ...(own ? { from: own.commit } : {}), ...(this.latest ? { to: this.latest.build.commit } : {}) });
      this.note(`Downloaded the new version: ${target}`);
      // The last step is the person's, not ours: the installer upgrades the app and starts it again
      // when they let it. Settings says so, and the note in the log says so.
      const notOpened = await this.o.openInstaller(target);
      if (notOpened) throw new Error(`couldn't open the installer: ${notOpened}`);
      this.note("The installer is open: it updates the app and starts it again");
    } catch (e) {
      const message = (e as Error).message;
      this.note(`Update failed: ${message}`);
      await rm(tmp, { force: true });
      await this.saveRecord({ at: new Date().toISOString(), ok: false, ...(own ? { from: own.commit } : {}), error: message }).catch(() => undefined);
      throw e;
    } finally {
      this.updating = false;
    }
  }

  /**
   * There is nothing to go back to: the installer replaced the app and the older installer isn't
   * kept. Saying so, with what to do instead, beats pretending.
   */
  async rollBack(): Promise<void> {
    throw new Error(
      this.kind === "macos"
        ? "A Mac install can't roll back by itself. Download an older .dmg from the release page to go back."
        : "A Windows install can't roll back by itself. Download an older installer from the release page to go back.",
    );
  }

  async history(): Promise<string[]> {
    return [...this.lines];
  }
}
