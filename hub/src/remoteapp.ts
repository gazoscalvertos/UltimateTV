// The Android apps' APKs (the remote, and the watching client), for phones to download from the Hub.
// CI publishes each build from main to a GitHub release; the Hub keeps a copy in its data folder
// and refreshes it now and then.

import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

const REPO = process.env.HUB_REPO ?? "gazoscalvertos/UltimateTV";
const FRESH_MS = 30 * 60_000;

export class RemoteApp {
  private readonly file: string;
  private readonly url: string;
  private refreshing: Promise<void> | null = null;

  constructor(
    dataDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
    /** The GitHub release tag CI uploads to, and the APK's file name in it. */
    app: { tag: string; file: string } = { tag: "remote-app", file: "ultimatetv-remote.apk" },
  ) {
    this.file = path.join(dataDir, app.tag, app.file);
    this.url = `https://github.com/${REPO}/releases/download/${app.tag}/${app.file}`;
  }

  /** The APK, fetched first if there's no copy or it's old. Null when there's none at all. */
  async open(): Promise<{ stream: Readable; size: number } | null> {
    const st = await stat(this.file).catch(() => null);
    if (!st || Date.now() - st.mtimeMs > FRESH_MS) {
      this.refreshing ??= this.download().finally(() => (this.refreshing = null));
      await this.refreshing.catch(() => undefined);
    }
    const now = await stat(this.file).catch(() => null);
    return now ? { stream: createReadStream(this.file), size: now.size } : null;
  }

  private async download(): Promise<void> {
    const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "UltimateTV-Hub" } });
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    // An APK is a zip: anything else (an error page) isn't kept.
    if (body.length < 10_000 || body[0] !== 0x50 || body[1] !== 0x4b) throw new Error("Not an APK");
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.new`, body);
    await rename(`${this.file}.new`, this.file);
  }
}
