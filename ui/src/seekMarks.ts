// The advert breaks comskip found, as the player's seek bar shows them: one shaded mark per break,
// so you can see where the breaks are before you reach one. Geometry only, so it is testable
// without a renderer; the bar itself just puts the percentages on screen.

import type { SkipMarker } from "@ultimatetv/shared";

export interface AdvertMark {
  /** Where the break starts, in percent of the recording. */
  left: number;
  /** How wide the break is, in percent of the recording. */
  width: number;
}

/**
 * The advert breaks among the skip markers, clamped to the recording and as percentages of it.
 * Nothing without a known length or without breaks, and breaks that are wholly outside the
 * recording (or have no length) are left out rather than drawn as a sliver at an edge.
 */
export function advertMarks(skip: SkipMarker[] | undefined, durationMs: number): AdvertMark[] {
  if (!skip?.length || !(durationMs > 0)) return [];
  const marks: AdvertMark[] = [];
  for (const s of skip) {
    if (s.kind !== "adverts") continue;
    const start = Math.max(0, Math.min(durationMs, s.startMs));
    const end = Math.max(0, Math.min(durationMs, s.endMs));
    if (end <= start) continue;
    marks.push({ left: (start / durationMs) * 100, width: ((end - start) / durationMs) * 100 });
  }
  return marks;
}
