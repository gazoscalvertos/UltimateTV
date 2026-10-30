// Skip markers: Jellyfin's media segments (filled in by the Intro Skipper plugin, or anything else
// that provides segments) as the player's Skip intro / Skip credits / Skip adverts buttons, and
// when Up Next takes over during the credits.

import type { PlaybackInfo } from "./domain.js";

export type SkipMarker = PlaybackInfo["skip"][number];

/** A segment as Jellyfin's /MediaSegments returns it (10.10 and later). Ticks are 100 ns. */
export interface JellyfinSegment {
  Type: string;
  StartTicks: number;
  EndTicks: number;
}

const KINDS: [RegExp, SkipMarker["kind"]][] = [
  [/intro/i, "intro"],
  [/recap/i, "recap"],
  [/outro|credits/i, "credits"],
  [/commercial/i, "adverts"],
];

/**
 * Jellyfin's segments as skip markers, in order. Previews ("next time on…") and unknown ones are
 * left out, and so are empty or back-to-front ones.
 */
export function skipMarkersFrom(segments: JellyfinSegment[]): SkipMarker[] {
  const out: SkipMarker[] = [];
  for (const s of segments) {
    const kind = KINDS.find(([re]) => re.test(s.Type))?.[1];
    if (!kind) continue;
    const startMs = Math.round(s.StartTicks / 10_000);
    const endMs = Math.round(s.EndTicks / 10_000);
    if (!(endMs > startMs) || startMs < 0) continue;
    out.push({ kind, startMs, endMs });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** How long the Up Next card counts down once the credits start, before the next episode plays. */
export const CREDITS_COUNTDOWN_S = 15;

/**
 * When the next episode takes over, for a title whose credits are marked: the countdown after
 * the credits start, but never after they end (a scene after the credits still plays). Credits
 * in the first half (a cold open's titles) don't count. Undefined without credits markers, when
 * the player falls back to the last 30 seconds.
 */
export function creditsHandover(skip: SkipMarker[], durationMs: number | undefined, countdownS = CREDITS_COUNTDOWN_S): { startMs: number; atMs: number } | undefined {
  const credits = skip.filter((s) => s.kind === "credits" && (!durationMs || s.startMs >= durationMs / 2)).at(-1);
  if (!credits) return undefined;
  // The skip button goes 2 s before the end of a segment: hand over no later than that.
  return { startMs: credits.startMs, atMs: Math.min(credits.startMs + countdownS * 1000, credits.endMs - 2000) };
}
