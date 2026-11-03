// Files for phones and computers to download from the Hub: the Android apps' APKs (the remote and
// the watching client) and, since #127 and #128, the Windows installer, the Mac disk image and the
// Linux AppImage. CI publishes each build from main to a GitHub release; the Hub keeps a copy in its
// data folder and refreshes it now and then, so a phone on the home Wi-Fi never needs GitHub.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type DesktopKind, looksLikeDesktopDownload } from "@ultimatetv/shared";

const REPO = process.env.HUB_REPO ?? "gazoscalvertos/UltimateTV";
const FRESH_MS = 30 * 60_000;

/** What a copy is checked against once it's downloaded, so an error page is never served as an app. */
export type AssetCheck = (head: Buffer, tail: Buffer, size: number) => boolean;

/** An APK is a zip: it starts "PK" and is bigger than a stub. */
export const looksLikeApk: AssetCheck = (head, _tail, size) => size >= 10_000 && head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;

export interface AssetOptions {
  /** The GitHub release tag CI uploads to. */
  tag: string;
  /** The file's name in that release, and the name it's cached under. */
  file: string;
  /**
   * What a good download looks like. Defaults to an APK's size check; the desktop installers use
   * the same check the app applies before it opens one (shared/src/desktop.ts).
   */
  check?: AssetCheck;
}

/** The APK, installer or disk image, fetched first if there's no copy or it's old. */
export class RemoteAsset {
  private readonly file: string;
  private readonly url: string;
  private readonly check: AssetCheck;
  private refreshing: Promise<void> | null = null;

  constructor(
    dataDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
    app: AssetOptions = { tag: "remote-app", file: "ultimatetv-remote.apk" },
  ) {
    this.file = path.join(dataDir, app.tag, app.file);
    this.url = `https://github.com/${REPO}/releases/download/${app.tag}/${app.file}`;
    this.check = app.check ?? looksLikeApk;
  }

  /** The file, fetched first if there's no copy or it's old. Null when there's none at all. */
  async open(): Promise<{ stream: Readable; size: number } | null> {
    const st = await stat(this.file).catch(() => null);
    if (!st || Date.now() - st.mtimeMs > FRESH_MS) {
      this.refreshing ??= this.download().finally(() => (this.refreshing = null));
      await this.refreshing.catch(() => undefined);
    }
    const now = await stat(this.file).catch(() => null);
    return now ? { stream: createReadStream(this.file), size: now.size } : null;
  }

  /** Downloads to `<file>.new` and only renames it into place once it passes `check`. */
  private async download(): Promise<void> {
    const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(10 * 60_000), headers: { "User-Agent": "UltimateTV-Hub" } });
    if (!res.ok || !res.body) throw new Error(`GitHub said ${res.status}`);
    const part = `${this.file}.new`;
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      // Streamed rather than read into memory: an installer is tens of megabytes and a disk image
      // is a hundred. The check needs the first and last bytes, not the whole thing.
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(part));
      const size = (await stat(part)).size;
      const { head, tail } = await endsOf(part, size);
      if (!this.check(head, tail, size)) throw new Error("Not the file it should be");
      await rename(part, this.file);
    } catch (e) {
      await rm(part, { force: true });
      throw e;
    }
  }
}

/** The first and last few hundred bytes of a file: enough for a magic-number check. */
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

/** The check for one desktop platform's download. */
export function desktopCheck(kind: DesktopKind): AssetCheck {
  return (head, tail, size) => looksLikeDesktopDownload(kind, head, tail, size);
}

/**
 * The Android apps' APKs, kept as the class it has always been: hub/src/server.ts and its tests
 * call this name, and the desktop downloads are the same idea with a different check.
 */
export class RemoteApp extends RemoteAsset {}
