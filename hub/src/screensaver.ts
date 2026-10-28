// The screensaver's "Your photos": a folder on the NAS of the household's own photos and short
// videos. The TV gets a shuffled list of ids and fetches each file by id, so paths never leave
// the Hub and nothing outside the folder can be read.

import { createHash } from "node:crypto";
import path from "node:path";
import type { NasListing, ScreensaverPhoto } from "@ultimatetv/shared";
import { filesIn, insideRoots, listNas, nasRoots } from "./nasvideos.js";

const IMAGES = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]);
/** Videos the TV's browser plays itself (no mkv/avi: those need the full player). */
const VIDEOS = new Set([".mp4", ".m4v", ".webm", ".mov"]);
const kindOf = (file: string): ScreensaverPhoto["kind"] | undefined => {
  const ext = path.extname(file).toLowerCase();
  return IMAGES.has(ext) ? "image" : VIDEOS.has(ext) ? "video" : undefined;
};
export const isPhotoFile = (file: string) => kindOf(file) !== undefined;

const FRESH_MS = 10 * 60_000;
const LIMIT = 5000;

export class PhotoFolder {
  private cache: { dir: string; at: number; files: Map<string, string> } | null = null;
  private loading: { dir: string; files: Promise<Map<string, string>> } | null = null;

  constructor(private readonly mediaRoot: string) {}

  roots(): Promise<string[]> {
    return nasRoots(this.mediaRoot);
  }

  /** The real path of a folder on the NAS, or an error saying why it can't be used. */
  async check(dir: string): Promise<string> {
    const roots = await this.roots();
    const real = await insideRoots(dir, roots);
    if (!real) throw Object.assign(new Error(`That folder isn't on the NAS (${roots.join(", ") || "no shares mounted"})`), { statusCode: 400 });
    return real;
  }

  /** Folders and pictures, for choosing the folder on the TV or the phone. */
  async browse(dir?: string): Promise<NasListing> {
    return listNas(dir, await this.roots(), isPhotoFile);
  }

  /** Every photo and video in the folder and its subfolders, shuffled. */
  async list(dir: string): Promise<ScreensaverPhoto[]> {
    const files = await this.files(dir);
    const out = [...files].map(([id, file]) => ({ id, kind: kindOf(file)! }));
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** The file for an id from the last listing of `dir`. */
  async file(dir: string, id: string): Promise<string | undefined> {
    return (await this.files(dir)).get(id);
  }

  private async files(dir: string): Promise<Map<string, string>> {
    if (!dir) return new Map();
    if (this.cache?.dir === dir && Date.now() - this.cache.at < FRESH_MS) return this.cache.files;
    if (this.loading?.dir === dir) return this.loading.files;
    const loading = {
      dir,
      files: (async () => {
        const real = await this.check(dir);
        const files = new Map<string, string>();
        for (const f of await filesIn(real, isPhotoFile, LIMIT)) files.set(createHash("sha1").update(f).digest("hex").slice(0, 20), f);
        this.cache = { dir, at: Date.now(), files };
        return files;
      })().finally(() => {
        if (this.loading === loading) this.loading = null;
      }),
    };
    this.loading = loading;
    return loading.files;
  }
}
