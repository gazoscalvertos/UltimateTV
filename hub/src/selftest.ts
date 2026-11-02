// The Hub's half of the on-box self-test (issue #105): it keeps the last finished run so the phone's
// Stats page and `/api/diagnostics` can show it without the TV being on.
//
// Only the last run is kept. A self-test is about "is the box right *now*" — after changing a TV
// setting or taking an update, the thing that matters is the newest answer, and an old pass would be
// misleading. The box's own rolling log keeps the history.

import { type SelfTestAnswer, type SelfTestId, type SelfTestKey, type SelfTestReport, type SelfTestResult, SELF_TEST_KEYS, SELF_TEST_STEPS } from "@ultimatetv/shared";
import type { Db } from "./db.js";

const KEY = "selftest-report";
const MAX_NOTE = 400;

const ANSWER_OF = new Set<SelfTestAnswer>(["yes", "no", "skipped"]);
const STEP_IDS = new Set<string>(SELF_TEST_STEPS.map((s) => s.id));
const KEY_NAMES = new Set<string>(SELF_TEST_KEYS);

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined;

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

/** Turns whatever the TV sent into a report, or null when it isn't one. */
export function cleanSelfTestReport(body: unknown): SelfTestReport | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Partial<Record<keyof SelfTestReport, unknown>>;
  const at = text(raw.at, 40);
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  const results: SelfTestResult[] = [];
  if (Array.isArray(raw.results)) {
    for (const item of raw.results) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === "string" && STEP_IDS.has(r.id) ? (r.id as SelfTestId) : null;
      if (!id) continue;
      const answer = typeof r.answer === "string" && ANSWER_OF.has(r.answer as SelfTestAnswer) ? (r.answer as SelfTestAnswer) : "skipped";
      const step = SELF_TEST_STEPS.find((s) => s.id === id)!;
      const o = (r.observed ?? {}) as Record<string, unknown>;
      const observed = {
        ...(text(o.display, 80) ? { display: text(o.display, 80)! } : {}),
        ...(num(o.width, 1, 16_384) ? { width: num(o.width, 1, 16_384)! } : {}),
        ...(num(o.height, 1, 16_384) ? { height: num(o.height, 1, 16_384)! } : {}),
        ...(num(o.refreshHz, 1, 1_000) ? { refreshHz: num(o.refreshHz, 1, 1_000)! } : {}),
        ...(typeof o.hdr === "boolean" ? { hdr: o.hdr } : {}),
        ...(text(o.codec, 80) ? { codec: text(o.codec, 80)! } : {}),
        ...(text(o.hwdec, 40) ? { hwdec: text(o.hwdec, 40)! } : {}),
      };
      const note = text(r.note, MAX_NOTE);
      results.push({ id, label: step.label, answer, observed, ...(note ? { note } : {}) });
    }
  }
  const missingKeys: SelfTestKey[] = Array.isArray(raw.missingKeys)
    ? [...new Set(raw.missingKeys.filter((k): k is SelfTestKey => typeof k === "string" && KEY_NAMES.has(k)))]
    : [];
  return {
    at,
    ...(text(raw.hostname, 100) ? { hostname: text(raw.hostname, 100)! } : {}),
    ...(text(raw.appVersion, 40) ? { appVersion: text(raw.appVersion, 40)! } : {}),
    results,
    missingKeys,
  };
}

/** Keeps the last run in the Hub's key/value store. */
export class SelfTestStore {
  constructor(private readonly db: Db) {}

  get(): SelfTestReport | null {
    return this.db.getKv<SelfTestReport>(KEY) ?? null;
  }

  save(report: SelfTestReport): SelfTestReport {
    this.db.setKv(KEY, report);
    return report;
  }

  clear(): void {
    this.db.setKv(KEY, null);
  }
}
