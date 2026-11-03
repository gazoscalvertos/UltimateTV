// Measuring how the TV app feels (issue #108). The UI is the only thing that can see any of this:
// how long the picker took to appear, when Home first drew and when it first took a key press, how
// long a guide step costs in frames, and how the video holds up while the overlays are up. So the TV
// app times itself on the box, at the box's real resolution and refresh rate, and sends the numbers
// to the Hub — where they land in `/api/diagnostics` next to the self-test and on the phone's Stats
// page, so a "the menus feel slow" report can be looked at with numbers instead of a shrug.
//
// Nothing here guesses at a fix. The numbers decide: each one is stored with the target from the
// issue, and the report says which targets were missed.

/** One thing that was timed. */
export type PerfId = "boot" | "home" | "guide" | "playback";

/** One measurement: a name in plain words, milliseconds, and how many samples it came from. */
export interface PerfSample {
  id: PerfId;
  /** Short name, e.g. "Home first paint". */
  label: string;
  /** What was measured, so a number can be read later without the code. */
  detail: string;
  /** Milliseconds: the middle sample (the median) where there is more than one. */
  ms: number;
  /** The slowest sample, when more than one was taken. */
  worstMs?: number;
  /** How many samples the figure came from. */
  samples: number;
  /** The target from the issue, in milliseconds. A sample misses when `ms` is above it. */
  targetMs: number;
}

export interface PerfReport {
  /** When the run finished, ISO 8601. */
  at: string;
  /** The screen it was measured on, so a 1080p number is never read as a 4K one. */
  width?: number;
  height?: number;
  /** The device pixel ratio, which is 1 on the box and 2 on some laptops. */
  pixelRatio?: number;
  /** Refresh rate the screen reported, when the browser knows it. */
  refreshHz?: number;
  /** The TV app's version. */
  appVersion?: string;
  /** Opaque name of the device, so two TVs' reports can be told apart. */
  device?: string;
  samples: PerfSample[];
  /** Anything worth knowing that isn't a number: a rough GPU string, lowered motion, and so on. */
  notes?: string[];
}

/** The targets from issue #108. A sample is "over" when it takes longer than its target. */
export const PERF_TARGETS: Record<PerfId, number> = {
  // Boot to "Who's watching?".
  boot: 15_000,
  // Home interactive: first rail drawn and a key press landing somewhere.
  home: 1_500,
  // A guide step has to leave room in a 50 fps frame: 1/50 s = 20 ms.
  guide: 20,
  // A frame gap while a film plays with the overlays up: 16.7 ms is 60 Hz.
  playback: 17,
};

/** A one-line-per-sample summary, for `/api/diagnostics` and the Stats page. */
export function perfSummary(report: PerfReport): string[] {
  const out: string[] = [];
  for (const s of report.samples) {
    const over = s.ms > s.targetMs;
    const worst = s.worstMs !== undefined && s.worstMs !== s.ms ? `, worst ${Math.round(s.worstMs)} ms` : "";
    out.push(`${over ? "over" : "ok"}: ${s.label} ${Math.round(s.ms)} ms${worst} (target ${s.targetMs} ms, ${s.samples} sample${s.samples === 1 ? "" : "s"})`);
  }
  return out;
}

/** The samples that missed their target, for a one-line verdict. */
export function perfMisses(report: PerfReport): PerfSample[] {
  return report.samples.filter((s) => s.ms > s.targetMs);
}

/** A sentence for the top of the report: "Everything is inside its target" or what isn't. */
export function perfVerdict(report: PerfReport): string {
  const missed = perfMisses(report);
  if (!report.samples.length) return "Nothing was measured.";
  if (!missed.length) return `All ${report.samples.length} measurements are inside their targets.`;
  return `${missed.length} of ${report.samples.length} measurements are slower than their target: ${missed.map((s) => s.label.toLowerCase()).join(", ")}.`;
}
