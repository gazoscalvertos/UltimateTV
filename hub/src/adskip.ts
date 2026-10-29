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
import { DEFAULT_ADSKIP_SETTINGS, parseEdl, type AdSkipSettings, type Recording } from "@ultimatetv/shared";
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
      const breaks = parseEdl(await readFile(edl, "utf8").catch(() => ""));
      this.ctx.log.info({ recording: id, breaks: breaks.length }, "Advert breaks found");
      return this.save(this.ctx.recordings.get(id) ?? r, { adScan: "done", adBreaks: breaks });
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
}

export async function registerAdSkip(app: FastifyInstance, skipper: AdSkipper, dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  type Req<B> = FastifyRequest<{ Body: B; Params: { id: string } }>;
  const state = () => ({ settings: skipper.settings(), installed: skipper.installed() });
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
