// Seek-bar preview pictures for finished recordings (#227). Jellyfin makes its own trickplay
// sheets for films and episodes; recordings live on the NAS as plain files, so after each one
// finishes the Hub makes the same kind of sheet with a cheap, low-priority ffmpeg pass: one small
// frame every 10 seconds, 10 x 10 frames to a JPEG. The player gets it as a `trickplay` block, so
// the TV, desktop and Android players need nothing new. No sheet (ffmpeg missing, pass failed, still
// recording) means no `trickplay` block: nothing is shown and nothing is waited for.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Recording, Trickplay } from "@ultimatetv/shared";
import type { EventBus } from "./events.js";
import type { Logger } from "./log.js";
import { spawnRun, type Run } from "./ytdlp.js";

export const SHEET_INTERVAL_MS = 10_000;
export const SHEET_WIDTH = 320;
export const SHEET_HEIGHT = 180;
export const SHEET_TILES = 10;
/** One recording's pass may take this long before it is given up on. */
const TIMEOUT_MS = 60 * 60_000;
/** On start, look at recordings finished in the last fortnight that have no sheet. */
const BACKFILL_MS = 14 * 86_400_000;

interface Meta {
  intervalMs: number;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  count: number;
  sheets: number;
}

/** The ffmpeg arguments: a frame every interval, scaled to fit, tiled into numbered JPEGs. */
export function sheetArgs(input: string, outPattern: string): string[] {
  const vf = [
    `fps=1/${SHEET_INTERVAL_MS / 1000}`,
    `scale=${SHEET_WIDTH}:${SHEET_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${SHEET_WIDTH}:${SHEET_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `tile=${SHEET_TILES}x${SHEET_TILES}`,
  ].join(",");
  // -skip_frame nokey keeps it cheap: only keyframes are decoded (a recording has one every second or two).
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-skip_frame", "nokey", "-i", input, "-an", "-sn", "-dn", "-vf", vf, "-fps_mode", "vfr", "-q:v", "6", "-y", outPattern];
}

export interface SeekSheetDeps {
  dir: string;
  events: EventBus;
  log: Logger;
  list: () => Recording[];
  get: (id: string) => Recording | undefined;
  run?: Run;
  /** Tests: skip the start-up backfill delay. */
  backfillDelayMs?: number;
}

export class SeekSheets {
  private queue: string[] = [];
  private running = false;
  private stopped = false;
  private available: boolean | null = null;
  private readonly run: Run;

  constructor(private readonly d: SeekSheetDeps) {
    this.run = d.run ?? spawnRun(process.env.FFMPEG_PATH || "ffmpeg");
  }

  start(): void {
    this.d.events.on((e) => {
      if (e.type === "recording.finished" && e.recording.status === "completed") this.add(e.recording.id);
    });
    setTimeout(() => this.backfill(), this.d.backfillDelayMs ?? 10 * 60_000).unref();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  backfill(now = Date.now()): void {
    for (const r of this.d.list()) if (r.status === "completed" && r.path && r.end > now - BACKFILL_MS && !this.has(r.id)) this.add(r.id);
  }

  has(id: string): boolean {
    return existsSync(path.join(this.dirFor(id), "meta.json"));
  }

  add(id: string): void {
    if (this.queue.includes(id) || this.has(id)) return;
    this.queue.push(id);
    void this.next();
  }

  /** Waits until everything queued has been made (tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 5));
  }

  private dirFor(id: string): string {
    return path.join(this.d.dir, id.replace(/[^\w.-]/g, "_"));
  }

  /** The `trickplay` block for the player, or undefined when there is no sheet. */
  trickplay(id: string, hubBase: string): Trickplay | undefined {
    try {
      const meta = JSON.parse(readFileSync(path.join(this.dirFor(id), "meta.json"), "utf8")) as Meta;
      if (!(meta.count > 0)) return undefined;
      return {
        url: `${hubBase}/api/recordings/${encodeURIComponent(id)}/seek/{n}.jpg`,
        intervalMs: meta.intervalMs,
        width: meta.width,
        height: meta.height,
        tileWidth: meta.tileWidth,
        tileHeight: meta.tileHeight,
        count: meta.count,
      };
    } catch {
      return undefined;
    }
  }

  /** Where sheet `n` of this recording is, if it exists. */
  sheetFile(id: string, n: number): string | undefined {
    if (!Number.isInteger(n) || n < 0) return undefined;
    const f = path.join(this.dirFor(id), `${n}.jpg`);
    return existsSync(f) ? f : undefined;
  }

  async remove(id: string): Promise<void> {
    await rm(this.dirFor(id), { recursive: true, force: true }).catch(() => undefined);
  }

  private async next(): Promise<void> {
    if (this.running || this.stopped) return;
    const id = this.queue.shift();
    if (!id) return;
    this.running = true;
    try {
      await this.make(id);
    } catch (err) {
      this.d.log.warn({ err: String(err), recording: id }, "Seek preview sheet failed");
    } finally {
      this.running = false;
      void this.next();
    }
  }

  /** Makes the sheets for one recording. Failure just means no preview. */
  async make(id: string): Promise<boolean> {
    const r = this.d.get(id);
    if (!r?.path || this.available === false) return false;
    const final = this.dirFor(id);
    const work = `${final}.work`;
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    try {
      let res;
      try {
        res = await this.run(sheetArgs(r.path, path.join(work, "%d.jpg")), { timeoutMs: TIMEOUT_MS });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this.available = false;
          this.d.log.info("ffmpeg isn't installed, so recordings get no seek previews");
          return false;
        }
        throw err;
      }
      this.available = true;
      const sheets = (await readdir(work)).filter((f) => /^\d+\.jpg$/.test(f)).length;
      if (res.code !== 0 || sheets === 0) {
        this.d.log.warn({ code: res.code, err: res.stderr.slice(-300), recording: id }, "Seek preview pass didn't finish");
        return false;
      }
      // ffmpeg numbers sheets from 1 with %d; the player counts from 0.
      const tmp = path.join(work, "shift");
      await mkdir(tmp);
      for (let i = 1; i <= sheets; i++) await rename(path.join(work, `${i}.jpg`), path.join(tmp, `${i - 1}.jpg`));
      // The last sheet may be part-full; the programme's length says how many frames are real.
      const perSheet = SHEET_TILES * SHEET_TILES;
      const byLength = Math.max(1, Math.floor((r.programme.end - r.programme.start) / SHEET_INTERVAL_MS) + 1);
      const count = Math.min(byLength, sheets * perSheet);
      const meta: Meta = { intervalMs: SHEET_INTERVAL_MS, width: SHEET_WIDTH, height: SHEET_HEIGHT, tileWidth: SHEET_TILES, tileHeight: SHEET_TILES, count, sheets };
      await writeFile(path.join(tmp, "meta.json"), JSON.stringify(meta));
      await rm(final, { recursive: true, force: true });
      await rename(tmp, final);
      this.d.log.info({ recording: id, sheets }, "Seek preview sheets made");
      return true;
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
