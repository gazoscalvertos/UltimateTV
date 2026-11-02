// Skipping the adverts on recordings. After each recording finishes, the Hub runs comskip on it
// (one at a time, at low priority: the N150 has all night) and keeps the advert breaks it finds on
// the recording. The player then shows "Skip adverts" in a break, as it does for intros, or jumps
// straight over them when Settings › Recording says so.
//
// comskip is built into the Hub's Docker image; COMSKIP_PATH points at another one. Without it,
// recordings just play as they always have.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { DEFAULT_ADSKIP_SETTINGS, parseEdl, type AdBreak, type AdSkipSettings, type AdvertScan, type Recording } from "@ultimatetv/shared";
import { breaksFromBlackAndSilence, detectArgs, detectAudioArgs, FALLBACK_MIN_RECORDING_MS, parseBlackdetect, parseSilencedetect } from "./adbreaks.js";
import type { HubContext } from "./context.js";
import type { Db } from "./db.js";
import { spawnRun, type Run } from "./ytdlp.js";

/** comskip's settings: EDL output only, with detection tuned for UK channels (black frames plus silence, logo). */
export const COMSKIP_INI = `; Written by UltimateTV. Delete this file to get the default back.
detect_method=111
validate_silence=1
validate_uniform=1
validate_scenechange=1
max_brightness=60
test_brightness=40
max_avg_brightness=25
maxbright=1
max_commercialbreak=600
min_commercialbreak=20
max_commercial_size=125
min_commercial_size=4
min_show_segment_length=125
non_uniformity=500
max_volume=500
min_silence=12
punish_no_logo=1
output_edl=1
output_default=0
output_framearray=0
output_videoredo=0
output_womble=0
output_mls=0
output_mpgtx=0
output_dvrmstb=0
output_vcf=0
output_txt=0
output_chapters=0
delete_show_after_last_commercial=0
thread_count=2
lowres=1
`;

/** How long comskip may take on one recording before it's given up on. */
const TIMEOUT_MS = 3 * 3600_000;
/** On start, look at recordings finished in the last fortnight that haven't been searched. */
const BACKFILL_MS = 14 * 86_400_000;

export function adSkipSettings(db: Db): AdSkipSettings {
  const s = db.getKv<Partial<AdSkipSettings>>("adskip") ?? {};
  return { enabled: s.enabled ?? DEFAULT_ADSKIP_SETTINGS.enabled, mode: s.mode === "auto" ? "auto" : "button" };
}

export class AdSkipper {
  private queue: string[] = [];
  private running = false;
  private available: boolean | null = null;
  private readonly run: Run;
  private stopped = false;

  constructor(
    private readonly ctx: HubContext,
    private readonly dataDir: string,
    run?: Run,
    private readonly ffmpeg: Run = spawnRun(process.env.FFMPEG_PATH || "ffmpeg"),
  ) {
    this.run = run ?? spawnRun(process.env.COMSKIP_PATH || "comskip");
  }

  settings(): AdSkipSettings {
    return adSkipSettings(this.ctx.db);
  }

  saveSettings(patch: Partial<AdSkipSettings>): AdSkipSettings {
    const s = this.settings();
    const next: AdSkipSettings = { enabled: patch.enabled === undefined ? s.enabled : Boolean(patch.enabled), mode: patch.mode === "auto" || patch.mode === "button" ? patch.mode : s.mode };
    this.ctx.db.setKv("adskip", next);
    if (next.enabled && !s.enabled) this.backfill();
    return next;
  }

  /** Whether comskip is installed, once it has been tried. */
  installed(): boolean | null {
    return this.available;
  }

  /**
   * How the advert search has gone across every recording, for diagnostics: which detector found
   * the breaks, and how many recordings nothing was found in (#73).
   */
  summary(): AdvertScan {
    const out = { comskip: 0, ffmpeg: 0, none: 0, unavailable: 0, pending: 0, failed: 0 };
    for (const r of this.ctx.recordings.list()) {
      if (r.adScan === "pending") out.pending++;
      else if (r.adScan === "failed") out.failed++;
      else if (r.adScan === "unavailable") out.unavailable++;
      else if (r.adScan === "done") {
        if (!r.adBreaks?.length) out.none++;
        else if (r.adScanMethod === "ffmpeg") out.ffmpeg++;
        else out.comskip++;
      }
    }
    return out;
  }

  start(): void {
    this.ctx.events.on((e) => {
      if (e.type === "recording.finished" && e.recording.status === "completed" && this.settings().enabled) this.add(e.recording.id);
    });
    // After the Hub has settled in.
    setTimeout(() => this.backfill(), 5 * 60_000).unref();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  backfill(now = Date.now()): void {
    if (!this.settings().enabled) return;
    for (const r of this.ctx.recordings.withStatus("completed")) if (!r.adScan && r.path && r.end > now - BACKFILL_MS) this.add(r.id);
  }

  add(id: string): void {
    if (this.queue.includes(id)) return;
    this.queue.push(id);
    const r = this.ctx.recordings.get(id);
    if (r && r.adScan !== "pending") this.save(r, { adScan: "pending" });
    void this.next();
  }

  private save(r: Recording, patch: Partial<Recording>): Recording {
    const next = this.ctx.recordings.save({ ...r, ...patch });
    this.ctx.events.emit({ type: "recordings.changed" });
    return next;
  }

  private async next(): Promise<void> {
    if (this.running || this.stopped) return;
    const id = this.queue.shift();
    if (!id) return;
    this.running = true;
    try {
      await this.scan(id);
    } finally {
      this.running = false;
      void this.next();
    }
  }

  /** Runs comskip on one recording and keeps the breaks it finds. */
  async scan(id: string): Promise<Recording | undefined> {
    const r = this.ctx.recordings.get(id);
    if (!r?.path) return r;
    if (this.available === false) return this.save(r, { adScan: "unavailable" });
    const ini = path.join(this.dataDir, "comskip.ini");
    await writeFile(ini, COMSKIP_INI, { flag: "wx" }).catch(() => undefined);
    const out = await mkdtemp(path.join(os.tmpdir(), "comskip-"));
    try {
      // nice -n 19 isn't available everywhere; comskip itself is told to use two threads.
      const res = await this.run([`--ini=${ini}`, `--output=${out}`, "--quiet", r.path], { timeoutMs: TIMEOUT_MS });
      this.available = true;
      // 0: adverts found; 1: none found. Anything else went wrong.
      if (res.code !== 0 && res.code !== 1) {
        this.ctx.log.warn({ code: res.code, err: res.stderr.slice(-500), recording: id }, "comskip failed");
        return this.save(this.ctx.recordings.get(id) ?? r, { adScan: "failed" });
      }
      const edl = path.join(out, `${path.basename(r.path, path.extname(r.path))}.edl`);
      const found = parseEdl(await readFile(edl, "utf8").catch(() => ""));
      // comskip found nothing: on a long recording, ask ffmpeg before giving up (#73).
      if (!found.length) {
        const guessed = await this.fallback(r);
        if (guessed.length) {
          this.ctx.log.info({ recording: id, breaks: guessed.length, method: "ffmpeg" }, "Advert breaks found by the ffmpeg fallback");
          return this.save(this.ctx.recordings.get(id) ?? r, { adScan: "done", adBreaks: guessed, adScanMethod: "ffmpeg" });
        }
      }
      this.ctx.log.info({ recording: id, breaks: found.length, method: "comskip" }, "Advert breaks found");
      return this.save(this.ctx.recordings.get(id) ?? r, { adScan: "done", adBreaks: found, adScanMethod: "comskip" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.available = false;
        this.ctx.log.info("comskip isn't installed, so adverts can't be found in recordings");
        return this.save(this.ctx.recordings.get(id) ?? r, { adScan: "unavailable" });
      }
      this.ctx.log.warn({ err: String(err), recording: id }, "comskip failed");
      return this.save(this.ctx.recordings.get(id) ?? r, { adScan: "failed" });
    } finally {
      await rm(out, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * The fallback when comskip finds nothing (#73): ffmpeg reports the black frames and the silence,
   * and the stretches that look like an advert break are kept. Only worth the time on a long
   * recording, and a failure here must not lose the recording: it just means no breaks.
   */
  private async fallback(r: Recording): Promise<AdBreak[]> {
    if (!r.path || r.end - r.start < FALLBACK_MIN_RECORDING_MS) return [];
    const opts = { timeoutMs: TIMEOUT_MS };
    try {
      const video = await this.ffmpeg(detectArgs(r.path), opts);
      const audio = await this.ffmpeg(detectAudioArgs(r.path), opts);
      // ffmpeg exits 0 for a scan that found nothing; anything else means it didn't run.
      if (video.code !== 0 || audio.code !== 0) {
        this.ctx.log.warn({ code: video.code, audioCode: audio.code, err: (video.stderr || audio.stderr).slice(-500) }, "The ffmpeg advert fallback didn't finish");
        return [];
      }
      return breaksFromBlackAndSilence(parseBlackdetect(video.stderr), parseSilencedetect(audio.stderr));
    } catch (err) {
      this.ctx.log.warn({ err: String(err) }, "The ffmpeg advert fallback failed");
      return [];
    }
  }
}

export async function registerAdSkip(app: FastifyInstance, skipper: AdSkipper, dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  type Req<B> = FastifyRequest<{ Body: B; Params: { id: string } }>;
  const state = () => ({ settings: skipper.settings(), installed: skipper.installed(), advertScan: skipper.summary() });
  app.get("/api/adskip", async () => state());
  app.put("/api/adskip", async (req: Req<Partial<AdSkipSettings>>) => {
    skipper.saveSettings(req.body ?? {});
    return state();
  });
  /** Look for the adverts in a recording again (or for the first time). */
  app.post("/api/recordings/:id/adscan", async (req: Req<unknown>, reply) => {
    const id = req.params.id;
    skipper.add(id);
    return reply.code(202).send({ ok: true });
  });
}
