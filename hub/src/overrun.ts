// Works out how far to push a running recording's end when the programme overruns (#230).
// Pure: the recorder asks, then saves what comes back.

import { findConflicts } from "./serieslink.js";
import type { Recording } from "@ultimatetv/shared";

export const OVERRUN_AFTER_MIN_MS = 60_000;

export interface OverrunInput {
  rec: Recording;
  /** The end the guide now gives the programme. */
  guideEnd: number;
  /** The end the recording was planned with, before any extension. */
  plannedEnd: number;
  /** The programme end the recording was planned from, to keep the user's padding after it. */
  plannedProgrammeEnd: number;
  maxExtraMs: number;
  /** Other live recordings that haven't started. */
  upcoming: Recording[];
  limit: number;
  now: number;
}

export interface OverrunPlan {
  end: number;
  limited?: "cap" | "clash";
  /** The recordings the extra time would have bumped off the connection. */
  clashes: Recording[];
}

/** The new end for a recording: guide end plus its padding, held back by the cap or by a clash. */
export function planOverrun(i: OverrunInput): OverrunPlan | undefined {
  const pad = Math.max(OVERRUN_AFTER_MIN_MS, i.plannedEnd - i.plannedProgrammeEnd);
  let end = i.guideEnd + pad;
  if (end <= i.rec.end) return undefined;
  let limited: OverrunPlan["limited"];
  if (end > i.plannedEnd + i.maxExtraMs) {
    end = i.plannedEnd + i.maxExtraMs;
    limited = "cap";
  }
  // Don't take the connection from a recording that's about to start on another channel.
  const clashes: Recording[] = [];
  if (end > i.rec.end) {
    const candidate = { ...i.rec, end };
    const others = i.upcoming.filter((o) => o.id !== i.rec.id && o.channelId !== i.rec.channelId);
    const conflicts = findConflicts([candidate, ...others], i.limit, i.now, (id) => id).filter((c) => c.recordings.some((r) => r.id === i.rec.id));
    for (const c of conflicts) clashes.push(...c.recordings.filter((r) => r.id !== i.rec.id && r.channelId !== i.rec.channelId));
    if (clashes.length) {
      const stopAt = Math.min(...clashes.map((r) => r.start));
      end = Math.max(i.rec.end, Math.min(end, stopAt));
      limited = "clash";
    }
  }
  if (end <= i.rec.end) return clashes.length ? { end: i.rec.end, limited: "clash", clashes } : undefined;
  return { end, ...(limited ? { limited } : {}), clashes };
}
