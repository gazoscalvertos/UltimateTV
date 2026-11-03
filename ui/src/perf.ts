// Timing the TV app itself (issue #108). None of this is visible on screen: it watches the moments
// that make the app feel fast or slow — the picker appearing, Home taking a key press, a guide step
// landing on screen, and video frames while the overlays are up — and keeps the numbers until
// something asks for them. Settings › Measure the UI sends them to the Hub, where they sit in
// /api/diagnostics and on the phone's Stats page next to the self-test.
//
// Everything is measured from inside the app on the real box at the real resolution, because that is
// the only place the question "is it fast enough on this TV" has an answer. On a laptop the numbers
// are uninteresting; the report says what screen it came from so they're never confused.

import { createSignal } from "solid-js";
import { type PerfId, type PerfReport, type PerfSample, PERF_TARGETS } from "@ultimatetv/shared";

/** Kept to a handful: a guide step every key press for the whole session would grow for ever. */
const MAX_STEPS = 24;
const MAX_FRAMES = 180;

/** When this module first ran: the closest thing to "the app started" a browser gives us. */
const bootAt = typeof performance !== "undefined" ? performance.now() : 0;

interface Timing {
  ms: number;
  worstMs?: number;
  samples: number;
}

const timings = new Map<PerfId, Timing>();
const notes: string[] = [];
const [running, setRunning] = createSignal(false);

function put(id: PerfId, ms: number, worstMs?: number, samples = 1): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const had = timings.get(id);
  // The first answer wins for boot and home: a later screen change isn't a second boot.
  if (had && (id === "boot" || id === "home")) return;
  timings.set(id, { ms: Math.round(ms), ...(worstMs !== undefined ? { worstMs: Math.round(worstMs) } : {}), samples });
}

/** The app got as far as "Who's watching?": that is boot, from the first line of script to now. */
export function markReady(): void {
  put("boot", performance.now() - bootAt);
}

// The moment a profile was picked, so Home's figure includes the wait for rails and for focus.
let homeStart: number | null = null;

/** A profile was just picked: Home's clock starts here. */
export function profilePicked(): void {
  homeStart = performance.now();
}

/** Home has drawn its first rail and something has focus: that is "Home is usable". */
export function markHome(): void {
  if (homeStart === null) return;
  put("home", performance.now() - homeStart);
  homeStart = null;
}

// ---------------------------------------------------------------------------
// The guide: a key press to the frame that shows its effect.

let guideSteps: number[] = [];
let guideWaiting: number | null = null;

/** A key was pressed in the guide: start counting the frames until it lands. */
export function guideKey(): void {
  if (guideWaiting !== null) return;
  guideWaiting = performance.now();
  requestAnimationFrame(() => {
    if (guideWaiting === null) return;
    guideSteps.push(performance.now() - guideWaiting);
    guideWaiting = null;
    if (guideSteps.length > MAX_STEPS) guideSteps.shift();
    if (guideSteps.length >= 3) {
      const sorted = [...guideSteps].sort((a, b) => a - b);
      put("guide", sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!, sorted.length);
    }
  });
}

// ---------------------------------------------------------------------------
// Playback: the gap between frames while a film plays and the overlays are up.

let frameGaps: number[] = [];
let frameRaf = 0;
let frameLast = 0;

/** Starts watching frame spacing. Safe to call repeatedly. */
export function startFrameWatch(): void {
  if (frameRaf) return;
  frameLast = performance.now();
  const tick = () => {
    const now = performance.now();
    const gap = now - frameLast;
    frameLast = now;
    // Ignore the gap after the tab was hidden: that isn't a dropped frame, it's a stopped tab.
    if (gap < 250) {
      frameGaps.push(gap);
      if (frameGaps.length > MAX_FRAMES) frameGaps.shift();
      if (frameGaps.length >= 30) {
        const sorted = [...frameGaps].sort((a, b) => a - b);
        put("playback", sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!, sorted.length);
      }
    }
    frameRaf = requestAnimationFrame(tick);
  };
  frameRaf = requestAnimationFrame(tick);
}

export function stopFrameWatch(): void {
  if (!frameRaf) return;
  cancelAnimationFrame(frameRaf);
  frameRaf = 0;
  frameGaps = [];
}

// ---------------------------------------------------------------------------

/** Everything measured so far, as the Hub wants it. */
export function perfReport(appVersion?: string): PerfReport {
  const samples: PerfSample[] = [];
  const labels: Record<PerfId, { label: string; detail: string }> = {
    boot: { label: "Boot to \"Who's watching?\"", detail: "From the app's first line of script until the profile picker is on screen." },
    home: { label: "Home, ready to take a key press", detail: "From picking a profile until Home's first rail is drawn and something has focus." },
    guide: { label: "A guide step, key press to frame", detail: "The middle of the last few arrow presses in the guide, in milliseconds to the next frame." },
    playback: { label: "A frame while a film plays", detail: "The middle gap between frames with the player and overlays going." },
  };
  for (const id of ["boot", "home", "guide", "playback"] as PerfId[]) {
    const t = timings.get(id);
    if (!t) continue;
    samples.push({
      id,
      label: labels[id].label,
      detail: labels[id].detail,
      ms: t.ms,
      ...(t.worstMs !== undefined ? { worstMs: t.worstMs } : {}),
      samples: t.samples,
      targetMs: PERF_TARGETS[id],
    });
  }
  let refreshHz: number | undefined;
  try {
    const hz = (screen as Screen & { refreshRate?: number }).refreshRate;
    if (typeof hz === "number" && hz > 0) refreshHz = Math.round(hz);
  } catch {
    // No Screen API on this build.
  }
  return {
    at: new Date().toISOString(),
    ...(typeof window !== "undefined" ? { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio } : {}),
    ...(refreshHz ? { refreshHz } : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(notes.length ? { notes } : {}),
    samples,
  };
}

/** Adds a line to the report's notes: useful context that isn't a timing. */
export function perfNote(line: string): void {
  if (notes.includes(line)) return;
  notes.push(line);
}

/** True while a measurement pass is running, so Settings can say so. */
export const perfRunning = running;

/**
 * Runs a pass for Settings: it needs a guide open and a film playing to have anything to say, so it
 * only reports what it has and says so when a piece was never seen.
 */
export function finishPass(): PerfReport {
  setRunning(true);
  try {
    for (const id of ["boot", "home", "guide", "playback"] as PerfId[]) {
      if (!timings.has(id)) {
        const was = { boot: "the app starting", home: "picking a profile", guide: "the guide", playback: "playing something" }[id];
        perfNote(`Not measured: ${was} hasn't happened since the TV app started.`);
      }
    }
    return perfReport();
  } finally {
    setRunning(false);
  }
}

/** Forgets every figure, so the next pass measures this session rather than an old one. */
export function resetMeasurements(): void {
  timings.clear();
  notes.length = 0;
  guideSteps = [];
  frameGaps = [];
}
