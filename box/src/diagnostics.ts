// Diagnostics: the box keeps its recent log lines and a playback sample every 10 seconds, and sends
// them to the Hub with its software version and the screen's raw kscreen-doctor details. Anyone
// looking into a problem (Gary, or Claude over SSH) then reads it all from the Hub's
// /api/diagnostics, without needing access to the TV user's files.

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { redactUrls, type BoxDiagnostics, type PlaybackSample } from "@ultimatetv/shared";
import { HostMonitor } from "@ultimatetv/shared/host";

const run = promisify(execFile);

const MAX_LINES = 1000;
const MAX_SAMPLES = 720; // two hours at one every 10 seconds

/** Log lines go to the Hub with every address cut to its host. */
export const redact = redactUrls;

/** A ring buffer that drops the oldest entries past its size. */
export class Ring<T> {
  private items: T[] = [];
  constructor(private readonly size: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.size) this.items.splice(0, this.items.length - this.size);
  }
  list(): T[] {
    return [...this.items];
  }
}

/** kscreen-doctor's JSON with each output's mode list cut to its refresh rates, which is all that matters here. */
export function summariseKscreen(json: string): unknown {
  try {
    const data = JSON.parse(json) as { outputs?: Record<string, unknown>[] };
    return {
      outputs: (data.outputs ?? []).map((o) => {
        const modes = (o.modes as { id?: unknown; size?: { width?: number; height?: number }; refreshRate?: number }[]) ?? [];
        const { modes: _modes, ...rest } = o;
        return { ...rest, modes: modes.map((m) => `${m.id}: ${m.size?.width}×${m.size?.height}@${m.refreshRate}`) };
      }),
    };
  } catch {
    return json.slice(0, 20_000);
  }
}

export interface DiagnosticSources {
  /** A playback sample, or null when nothing plays. */
  sample: () => Promise<PlaybackSample | null>;
  software: () => Promise<unknown>;
  info: () => Promise<unknown>;
}

export class Diagnostics {
  private readonly lines = new Ring<string>(MAX_LINES);
  private readonly samples = new Ring<PlaybackSample>(MAX_SAMPLES);
  private sources: DiagnosticSources | null = null;
  private timer: NodeJS.Timeout | undefined;
  private lastSent = 0;
  private readonly host = new HostMonitor();

  constructor(private readonly hubUrl: string) {}

  /** Keeps a log line (addresses redacted) for the next report. */
  record(line: string): void {
    this.lines.push(redact(line));
  }

  /** Starts sampling and reporting; log lines are kept from the start. */
  start(sources: DiagnosticSources): void {
    this.sources = sources;
    this.timer = setInterval(() => void this.tick(), 10_000);
    setTimeout(() => void this.send(), 15_000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Samples playback every 10 s; reports every 30 s while playing and every 5 minutes otherwise. */
  private async tick(): Promise<void> {
    if (!this.sources) return;
    const sample = await this.sources.sample().catch(() => null);
    if (sample) this.samples.push(sample);
    const due = sample ? 30_000 : 300_000;
    if (Date.now() - this.lastSent >= due) await this.send();
  }

  /** Sends a report to the Hub now (also when playback starts or stops, so the start is captured). */
  async send(): Promise<void> {
    if (!this.sources) return;
    this.lastSent = Date.now();
    const report = await this.report();
    await fetch(`${this.hubUrl}/api/diagnostics/box`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  async report(): Promise<BoxDiagnostics> {
    const sources = this.sources ?? { sample: async () => null, software: async () => null, info: async () => null };
    const [software, info, kscreenJson, kscreenText, sample, host] = await Promise.all([
      sources.software().catch((e: Error) => ({ error: e.message })),
      sources.info().catch((e: Error) => ({ error: e.message })),
      run("kscreen-doctor", ["-j"], { timeout: 5000 }).then((r) => summariseKscreen(r.stdout)).catch((e: Error) => ({ error: e.message })),
      run("kscreen-doctor", ["-o"], { timeout: 5000 }).then((r) => r.stdout.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 20_000)).catch((e: Error) => `error: ${e.message}`),
      sources.sample().catch(() => null),
      this.host.stats([{ label: "System", path: "/" }]).catch(() => undefined),
    ]);
    return {
      at: new Date().toISOString(),
      hostname: os.hostname(),
      uptimeS: Math.round(os.uptime()),
      load: os.loadavg().map((l) => Math.round(l * 100) / 100),
      memory: { totalMb: Math.round(os.totalmem() / 2 ** 20), freeMb: Math.round(os.freemem() / 2 ** 20) },
      software,
      info,
      kscreen: { json: kscreenJson, text: kscreenText },
      now: sample,
      samples: this.samples.list(),
      log: this.lines.list(),
      ...(host ? { host } : {}),
    };
  }
}
