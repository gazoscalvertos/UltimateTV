// Finds the advert breaks in finished recordings, so the player can offer Skip adverts (or jump
// them on its own). Comskip does the finding when it's installed (the Hub's image builds it);
// otherwise ffmpeg looks for the black frames and silence that UK channels put between adverts.
// One recording at a time, at low priority, so it never gets in the way of watching.
//
// Each finished recording also gets an EDL file beside it (Kodi's "commercial break" type), so
// other players can skip the same breaks.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdBreak, Recording } from "@ultimatetv/shared";
import type { EventBus } from "./events.js";
import type { Logger } from "./log.js";
import type { RecordingStore } from "./recordings.js";
import type { SettingsStore } from "./settings.js";

/** Finds the breaks in a file. Throws when the file can't be read. */
export type AdvertDetect = (file: string, signal: AbortSignal) => Promise<AdBreak[]>;

interface Span {
  start: number;
  end: number;
}

/** Breaks shorter than this aren't worth a button (a channel ident, a sponsor's bumper). */
const MIN_BREAK_MS = 30_000;
/** Longer than this is more likely the programme than the adverts. */
const MAX_BREAK_MS = 10 * 60_000;

/** Comskip's EDL: "start end type" in seconds, one break a line. */
export function parseEdl(text: string): AdBreak[] {
  const breaks: AdBreak[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [a, b] = line.trim().split(/\s+/).map(Number);
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    breaks.push({ startMs: Math.round(a * 1000), endMs: Math.round(b * 1000) });
  }
  return tidy(breaks);
}

/** Kodi's EDL, type 3 (a commercial break): players skip it once and let you go back. */
export function toEdl(breaks: AdBreak[]): string {
  return breaks.map((b) => `${(b.startMs / 1000).toFixed(2)}\t${(b.endMs / 1000).toFixed(2)}\t3\n`).join("");
}

/** Sorted, merged where they touch, and only breaks of a believable length. */
export function tidy(breaks: AdBreak[]): AdBreak[] {
  const sorted = [...breaks].sort((a, b) => a.startMs - b.startMs);
  const merged: AdBreak[] = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    if (last && b.startMs <= last.endMs + 2000) last.endMs = Math.max(last.endMs, b.endMs);
    else merged.push({ ...b });
  }
  return merged.filter((b) => b.endMs - b.startMs >= MIN_BREAK_MS && b.endMs - b.startMs <= MAX_BREAK_MS);
}

/** Black frames and silence from ffmpeg's blackdetect and silencedetect log lines. */
export function parseDetectLog(log: string): { black: Span[]; silence: Span[] } {
  const black: Span[] = [];
  for (const m of log.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) black.push({ start: Number(m[1]) * 1000, end: Number(m[2]) * 1000 });
  const silence: Span[] = [];
  let open: number | null = null;
  for (const m of log.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]) * 1000);
    if (m[1] === "start") open = t;
    else if (open !== null) {
      silence.push({ start: open, end: t });
      open = null;
    }
  }
  return { black, silence };
}

/**
 * The fallback detector. Adverts on UK channels are separated by a moment of black and silence,
 * so a run of three or more such moments, each a believable advert length (5 s to 2 min) after
 * the last, is a break. Less sure than comskip (which also watches the channel logo), so it
 * only marks runs that look like at least two adverts.
 */
export function breaksFromMarks(black: Span[], silence: Span[]): AdBreak[] {
  const marks = black
    .filter((b) => silence.some((s) => s.start <= b.end + 500 && s.end >= b.start - 500))
    .map((b) => (b.start + b.end) / 2)
    .sort((a, b) => a - b);
  const breaks: AdBreak[] = [];
  let run: number[] = [];
  const close = () => {
    if (run.length >= 3) breaks.push({ startMs: Math.round(run[0]!), endMs: Math.round(run[run.length - 1]!) });
    run = [];
  };
  for (const t of marks) {
    const last = run[run.length - 1];
    if (last !== undefined && t - last < 5_000) continue;
    if (last !== undefined && t - last > 125_000) close();
    run.push(t);
  }
  close();
  return tidy(breaks);
}

/** Runs a program at low priority, keeping the end of its log. Resolves with the exit code. */
function run(bin: string, args: string[], signal: AbortSignal, onLog?: (chunk: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("nice", ["-n", "15", bin, ...args], { stdio: ["ignore", "ignore", "pipe"], signal });
    child.stderr.setEncoding("utf8").on("data", (c: string) => onLog?.(c));
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
}

/** ffmpeg's black and silence detection over the whole recording, decoded at a small size. */
export function ffmpegDetect(ffmpeg = "ffmpeg"): AdvertDetect {
  return async (file, signal) => {
    let log = "";
    const code = await run(
      ffmpeg,
      ["-hide_banner", "-nostats", "-threads", "2", "-i", file, "-sn", "-dn", "-vf", "scale=320:-2,blackdetect=d=0.08:pic_th=0.98:pix_th=0.12", "-af", "silencedetect=noise=-45dB:d=0.15", "-f", "null", "-"],
      signal,
      (c) => {
        // Keep only the detection lines, so a long recording's log stays small.
        for (const line of c.split(/\r?\n/)) if (/black_start|silence_(start|end)/.test(line)) log += `${line}\n`;
      },
    );
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
    const { black, silence } = parseDetectLog(log);
    return breaksFromMarks(black, silence);
  };
}

/** Comskip's settings: an EDL out, and breaks between 25 s and 10 min made of adverts of 4 s to 2 min. */
export const COMSKIP_INI = `; Written by the UltimateTV Hub. Put your own comskip.ini in the Hub's data folder to use that instead.
detect_method=43
verbose=0
min_commercialbreak=25
max_commercialbreak=600
min_commercial_size=4
max_commercial_size=125
min_show_segment_length=120
max_avg_brightness=19
output_edl=1
output_default=0
output_txt=0
delete_logo_file=1
`;

/** Comskip, writing into a scratch folder, then the breaks from its EDL. */
export function comskipDetect(opts: { bin?: string; ini: string; workDir: string }): AdvertDetect {
  return async (file, signal) => {
    await mkdir(opts.workDir, { recursive: true });
    const out = await mkdtemp(path.join(opts.workDir, "comskip-"));
    try {
      let log = "";
      const code = await run(opts.bin ?? "comskip", ["--quiet", "--threads=2", `--ini=${opts.ini}`, `--output=${out}`, file], signal, (c) => (log = (log + c).slice(-2000)));
      // Comskip exits 0 when it found adverts and 1 when it found none; anything else went wrong.
      if (code !== 0 && code !== 1) throw new Error(`comskip exited ${code}: ${log.trim().slice(-300)}`);
      const edl = (await readdir(out)).find((f) => f.endsWith(".edl"));
      return edl ? parseEdl(await readFile(path.join(out, edl), "utf8")) : [];
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  };
}

/** Comskip when it's installed, else ffmpeg. */
export function defaultDetect(dataDir: string, env: NodeJS.ProcessEnv = process.env): AdvertDetect {
  const own = path.join(dataDir, "comskip.ini");
  const ini = path.join(dataDir, "adverts", "comskip.ini");
  const comskip = comskipDetect({ ...(env.COMSKIP_PATH ? { bin: env.COMSKIP_PATH } : {}), ini: existsSync(own) ? own : ini, workDir: path.join(dataDir, "adverts") });
  const ffmpeg = ffmpegDetect();
  let missing = false;
  return async (file, signal) => {
    if (!missing) {
      try {
        if (!existsSync(own)) {
          await mkdir(path.dirname(ini), { recursive: true });
          await writeFile(ini, COMSKIP_INI);
        }
        return await comskip(file, signal);
      } catch (err) {
        // nice runs, but can't find comskip: it exits 127.
        if (!/exited 127|ENOENT/.test(String(err))) throw err;
        missing = true;
      }
    }
    return ffmpeg(file, signal);
  };
}

export interface AdvertFinderDeps {
  store: RecordingStore;
  events: EventBus;
  settings: SettingsStore;
  log: Logger;
  detect: AdvertDetect;
}

export class AdvertFinder {
  private queue: string[] = [];
  private busy = false;
  private abort = new AbortController();
  private stopped = false;
  private offs: (() => void)[] = [];

  constructor(private readonly d: AdvertFinderDeps) {}

  /** Looks at new recordings as they finish, and at any finished recordings not looked at yet. */
  start(): void {
    this.offs.push(
      this.d.events.on((e) => {
        if (e.type === "recording.finished" && e.recording.status === "completed") this.enqueue(e.recording.id);
      }),
    );
    // Turned back on: look at the recordings that finished while it was off.
    let was = this.d.settings.get().recording.findAdverts;
    this.offs.push(
      this.d.settings.onChange((s) => {
        if (s.recording.findAdverts && !was) this.backlog(["off"]);
        was = s.recording.findAdverts;
      }),
    );
    this.backlog([undefined, "waiting", "scanning"]);
  }

  private backlog(states: Recording["advertScan"][]): void {
    for (const r of this.d.store.withStatus("completed")) if (r.path && states.includes(r.advertScan)) this.enqueue(r.id);
  }

  stop(): void {
    this.stopped = true;
    for (const off of this.offs) off();
    this.abort.abort();
  }

  /** Puts a recording in line (again, for "Find adverts again"). */
  enqueue(id: string): boolean {
    const r = this.d.store.get(id);
    if (!r || r.status !== "completed" || !r.path) return false;
    if (!this.queue.includes(id)) this.queue.push(id);
    if (r.advertScan !== "waiting") this.save(r, { advertScan: "waiting" });
    void this.pump();
    return true;
  }

  /** Waits until everything in line has been looked at (tests). */
  async idle(): Promise<void> {
    while (this.busy || this.queue.length) await new Promise((r) => setTimeout(r, 10));
  }

  private save(r: Recording, patch: Partial<Recording>): void {
    // Re-read: the recording may have been watched (or deleted) while comskip ran.
    const now = this.d.store.get(r.id);
    if (!now) return;
    this.d.store.save({ ...now, ...patch });
    this.d.events.emit({ type: "recordings.changed" });
  }

  private async pump(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.stopped) {
        const r = this.d.store.get(this.queue.shift()!);
        if (!r?.path || r.status !== "completed") continue;
        if (!this.d.settings.get().recording.findAdverts) {
          this.save(r, { advertScan: "off" });
          continue;
        }
        this.save(r, { advertScan: "scanning" });
        const started = Date.now();
        try {
          const adverts = await this.d.detect(r.path, this.abort.signal);
          this.save(r, { advertScan: "done", adverts });
          await writeFile(r.path.replace(/\.[^./]+$/, ".edl"), toEdl(adverts)).catch(() => undefined);
          this.d.log.info({ id: r.id, title: r.programme.title, breaks: adverts.length, seconds: Math.round((Date.now() - started) / 1000) }, "Found the advert breaks");
        } catch (err) {
          if (this.stopped) return;
          this.d.log.warn({ id: r.id, err: String(err) }, "Couldn't look for adverts");
          this.save(r, { advertScan: "failed" });
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
