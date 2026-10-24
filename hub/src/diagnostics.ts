// Diagnostics in one place: the Hub's own recent log lines, and the latest report from the box
// (its log, playback samples every 10 seconds, software version and screen details). GET
// /api/diagnostics returns it all as JSON, or as readable text with ?format=text, so a problem
// can be looked into from anything on the network without access to the box's or the Hub's
// files.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactUrls, type BoxDiagnostics, type PlaybackSample } from "@ultimatetv/shared";

const MAX_LINES = 1000;

/**
 * A log file that rolls over at `maxBytes`, keeping `keep` older files (name.1 the newest), so it
 * never takes more than (keep + 1) × maxBytes of disk: 50 MB with the defaults.
 */
export class RollingFile {
  private size: number;

  constructor(
    readonly file: string,
    private readonly maxBytes = 10 * 1024 * 1024,
    private readonly keep = 4,
  ) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.size = existsSync(file) ? statSync(file).size : 0;
  }

  append(text: string): void {
    if (!text) return;
    const bytes = Buffer.byteLength(text);
    try {
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.roll();
      appendFileSync(this.file, text);
      this.size += bytes;
    } catch {
      // A full or read-only disk mustn't take the Hub down with it.
    }
  }

  private roll(): void {
    for (let i = this.keep - 1; i >= 1; i--) if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
    renameSync(this.file, `${this.file}.1`);
    this.size = 0;
  }

  /** The last `count` lines, reaching back into the rolled files when the current one is short. */
  async tail(count: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i <= this.keep && out.length < count; i++) {
      const text = await readFile(i === 0 ? this.file : `${this.file}.${i}`, "utf8").catch(() => null);
      if (text === null) continue;
      const lines = text.split("\n").filter(Boolean);
      out.unshift(...lines.slice(-(count - out.length)));
    }
    return out;
  }
}

const LEVELS: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

/**
 * Takes the Hub's log (pino's JSON lines, through `stream`). Everything at the logger's level
 * (debug by default) goes to the rolling file; info and up also go to stdout (docker logs) and to
 * the last-1000-lines ring that /api/diagnostics shows.
 */
export class LogRing {
  private lines: string[] = [];
  private readonly stdoutLevel: number;

  constructor(private readonly opts: { file?: RollingFile; stdoutLevel?: string } = {}) {
    this.stdoutLevel = LEVELS[opts.stdoutLevel ?? "info"] ?? 30;
  }

  readonly stream = {
    write: (msg: string) => {
      for (const raw of msg.split("\n")) {
        if (!raw.trim()) continue;
        const level = LogRing.level(raw);
        if (level >= this.stdoutLevel) process.stdout.write(`${raw}\n`);
        if (LogRing.routine(raw)) continue;
        const line = redactUrls(LogRing.format(raw));
        this.opts.file?.append(`${line}\n`);
        if (level >= 30) this.push(line);
      }
    },
  };

  add(msg: string): void {
    for (const raw of msg.split("\n")) {
      if (!raw.trim() || LogRing.routine(raw)) continue;
      this.push(redactUrls(LogRing.format(raw)));
    }
  }

  private push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  static level(raw: string): number {
    try {
      return Number((JSON.parse(raw) as { level?: number }).level ?? 30);
    } catch {
      return 30;
    }
  }

  list(): string[] {
    return [...this.lines];
  }

  /** Fastify's per-request lines, except failed requests: they'd push everything else out. */
  static routine(raw: string): boolean {
    try {
      const { msg, res } = JSON.parse(raw) as { msg?: string; res?: { statusCode?: number } };
      if (msg === "incoming request") return true;
      return msg === "request completed" && (res?.statusCode ?? 0) < 400;
    } catch {
      return false;
    }
  }

  /** pino's JSON line as "time LEVEL message {rest}", which reads far better in a report. */
  static format(raw: string): string {
    try {
      const { time, level, msg, pid: _pid, hostname: _host, ...rest } = JSON.parse(raw) as Record<string, unknown>;
      const name = ({ 10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" } as Record<number, string>)[Number(level)] ?? String(level);
      const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
      return `${typeof time === "number" ? new Date(time).toISOString() : ""} ${name} ${msg ?? ""}${extra}`.trim();
    } catch {
      return raw;
    }
  }
}

export interface StoredBoxReport {
  receivedAt: string;
  from: string;
  report: BoxDiagnostics;
}

/** The box's latest report, kept on disk so it outlives a Hub restart. */
export class BoxReportStore {
  private latest: StoredBoxReport | null = null;
  private readonly file: string;

  /** `logs` keeps every box log line and playback sample, not just the latest report's. */
  constructor(
    dir: string,
    private readonly logs?: { box: RollingFile; playback: RollingFile },
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "box.json");
  }

  async load(): Promise<void> {
    this.latest = await readFile(this.file, "utf8")
      .then((t) => JSON.parse(t) as StoredBoxReport)
      .catch(() => null);
  }

  async save(report: BoxDiagnostics, from: string): Promise<void> {
    if (this.logs) {
      // Reports overlap: write only what's new since the last one.
      const prev = this.latest?.report;
      const lastLine = prev?.log.at(-1);
      const start = lastLine === undefined ? -1 : report.log.lastIndexOf(lastLine);
      this.logs.box.append(report.log.slice(start + 1).map((l) => `${l}\n`).join(""));
      const lastSample = prev?.samples.at(-1)?.at ?? "";
      this.logs.playback.append(report.samples.filter((x) => x.at > lastSample).map((x) => `${JSON.stringify(x)}\n`).join(""));
    }
    this.latest = { receivedAt: new Date().toISOString(), from, report };
    await writeFile(this.file, JSON.stringify(this.latest)).catch(() => undefined);
  }

  get(): StoredBoxReport | null {
    return this.latest;
  }
}

/** Accepts only something shaped like a box report, with every list capped and every line redacted. */
export function cleanBoxReport(body: unknown): BoxDiagnostics | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Partial<BoxDiagnostics>;
  if (typeof r.at !== "string" || typeof r.hostname !== "string") return null;
  return {
    ...(r as BoxDiagnostics),
    log: (Array.isArray(r.log) ? r.log : []).slice(-MAX_LINES).map((l) => redactUrls(String(l))),
    samples: (Array.isArray(r.samples) ? r.samples : []).slice(-720),
  };
}

const n = (v: number | undefined, digits = 0) => (v === undefined ? "?" : v.toFixed(digits));

function sampleLine(s: PlaybackSample, prev?: PlaybackSample): string {
  const f = s.frames ?? {};
  const p = prev?.frames ?? {};
  // Counters are running totals; the change since the last sample is what shows a steady problem.
  const delta = (k: keyof NonNullable<PlaybackSample["frames"]>) => (f[k] !== undefined && p[k] !== undefined && f[k]! >= p[k]! ? `+${f[k]! - p[k]!}` : "");
  return [
    s.at.slice(11, 19),
    s.status ?? "",
    s.positionS !== undefined ? `pos ${s.positionS}s` : "",
    s.video ? `${s.video.width}×${s.video.height} ${n(s.video.fps, 3)}fps ${s.video.hwdec ?? ""}` : "",
    s.display?.mode ? `screen ${s.display.mode}` : "",
    s.match !== undefined ? `match ${s.match ?? "none"}` : "",
    s.display?.sync ? `sync ${s.display.sync}` : "",
    `drop ${n(f.dropped)}${delta("dropped")} dec ${n(f.decoderDropped)}${delta("decoderDropped")} late ${n(f.delayed)}${delta("delayed")} mistimed ${n(f.mistimed)}${delta("mistimed")}`,
    s.avsyncMs !== undefined ? `avsync ${s.avsyncMs}ms` : "",
    s.bufferS !== undefined ? `buffer ${s.bufferS}s` : "",
    s.inputKbps !== undefined ? `in ${s.inputKbps}kbps` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The whole picture as plain text, newest playback samples and log lines last. */
export function renderDiagnostics(hub: { version: string; commit?: string; builtAt?: string; uptimeS: number; log: string[] }, box: StoredBoxReport | null): string {
  const out: string[] = [];
  out.push("== Hub ==", `version ${hub.version}${hub.commit ? ` (${hub.commit.slice(0, 7)})` : ""}${hub.builtAt ? ` built ${hub.builtAt}` : ""} · up ${Math.round(hub.uptimeS / 60)} min`, "");
  if (!box) {
    out.push("== Box ==", "No report from the box yet (it sends one a few seconds after starting, and every 30 s while playing).", "");
  } else {
    const r = box.report;
    out.push(
      "== Box ==",
      `report from ${r.hostname} (${box.from}) at ${r.at}, received ${box.receivedAt}`,
      `up ${Math.round(r.uptimeS / 60)} min · load ${r.load.join(" ")} · memory ${r.memory.freeMb}/${r.memory.totalMb} MB free`,
      `software ${JSON.stringify(r.software)}`,
      `info ${JSON.stringify(r.info)}`,
      "",
      "== Screen (kscreen-doctor -o) ==",
      r.kscreen.text.trim(),
      "",
      "== Screen (kscreen-doctor -j, modes cut down) ==",
      JSON.stringify(r.kscreen.json, null, 2),
      "",
      "== Playing now ==",
      r.now ? sampleLine(r.now) : "nothing",
      "",
      "== Playback samples (every 10 s; +n is the change since the previous one) ==",
      ...r.samples.map((s, i) => sampleLine(s, r.samples[i - 1])),
      "",
      "== Box log ==",
      ...r.log,
      "",
    );
  }
  out.push("== Hub log ==", ...hub.log, "");
  return out.join("\n");
}
