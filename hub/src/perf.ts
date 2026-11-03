// The Hub's half of the UI timings (issue #108): it keeps the last run the TV app sent so the
// phone's Stats page and `/api/diagnostics` can show the numbers without the TV being on.
//
// Only the last run is kept, for the same reason as the self-test: a timing is about "how does it
// feel *now*", and an old figure would be read as today's. The box's own log keeps the history.

import { type PerfId, type PerfReport, type PerfSample, PERF_TARGETS } from "@ultimatetv/shared";
import type { Db } from "./db.js";

const KEY = "perf-report";
const MAX_SAMPLES = 12;
const MAX_NOTES = 8;

const IDS = new Set<string>(Object.keys(PERF_TARGETS));

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined;

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

/**
 * Turns whatever the TV sent into a report, or null when it isn't one. Every label is taken from the
 * catalogue on this side, never from the body, so a report can't put arbitrary text in the
 * diagnostics page; an unknown id is dropped rather than stored.
 */
export function cleanPerfReport(body: unknown): PerfReport | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Partial<Record<keyof PerfReport, unknown>>;
  const at = text(raw.at, 40);
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  const samples: PerfSample[] = [];
  if (Array.isArray(raw.samples)) {
    for (const item of raw.samples) {
      if (!item || typeof item !== "object" || samples.length >= MAX_SAMPLES) continue;
      const s = item as Record<string, unknown>;
      const id = typeof s.id === "string" && IDS.has(s.id) ? (s.id as PerfId) : null;
      if (!id) continue;
      const ms = num(s.ms, 0, 600_000);
      if (ms === undefined) continue;
      const samples_ = num(s.samples, 1, 10_000) ?? 1;
      const worst = num(s.worstMs, 0, 600_000);
      const label = text(s.label, 60);
      const detail = text(s.detail, 200);
      samples.push({
        id,
        label: label ?? id,
        detail: detail ?? "",
        ms,
        ...(worst !== undefined ? { worstMs: worst } : {}),
        samples: samples_,
        targetMs: PERF_TARGETS[id],
      });
    }
  }
  const notes = Array.isArray(raw.notes) ? raw.notes.map((n) => text(n, 200)).filter((n): n is string => !!n).slice(0, MAX_NOTES) : [];
  return {
    at,
    ...(num(raw.width, 1, 16_384) ? { width: num(raw.width, 1, 16_384)! } : {}),
    ...(num(raw.height, 1, 16_384) ? { height: num(raw.height, 1, 16_384)! } : {}),
    ...(num(raw.pixelRatio, 0.1, 10) ? { pixelRatio: num(raw.pixelRatio, 0.1, 10)! } : {}),
    ...(num(raw.refreshHz, 1, 1_000) ? { refreshHz: num(raw.refreshHz, 1, 1_000)! } : {}),
    ...(text(raw.appVersion, 40) ? { appVersion: text(raw.appVersion, 40)! } : {}),
    ...(text(raw.device, 100) ? { device: text(raw.device, 100)! } : {}),
    samples,
    ...(notes.length ? { notes } : {}),
  };
}

export class PerfStore {
  constructor(private readonly db: Db) {}

  get(): PerfReport | null {
    return this.db.getKv<PerfReport>(KEY) ?? null;
  }

  save(report: PerfReport): PerfReport {
    this.db.setKv(KEY, report);
    return report;
  }

  clear(): void {
    this.db.setKv(KEY, null);
  }
}
