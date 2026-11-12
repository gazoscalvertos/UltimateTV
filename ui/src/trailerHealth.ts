// Whether this box can afford the muted trailer behind Home (#240). A video that drops a quarter of
// its frames is hurting the TV more than it's helping, so after that the trailer stays off until
// the app restarts, and the still is all anyone sees.

import { createSignal } from "solid-js";
import type { Trailer } from "@ultimatetv/shared";

const [gaveUp, setGaveUp] = createSignal(false);

/** Share of frames dropped at which the trailer stops for the session. */
export const GIVE_UP_AT = 0.25;

export const trailerGivenUp = gaveUp;

/** The share (0 to 1) of the trailer's frames the browser dropped. */
export function reportTrailerHealth(droppedShare: number): void {
  if (droppedShare >= GIVE_UP_AT) setGaveUp(true);
}

/** For tests. */
export function resetTrailerHealth(): void {
  setGaveUp(false);
}

/** The address the page plays: the Hub's relay for a YouTube trailer, the clip's own address otherwise (the demo). */
export function trailerSrc(t: Trailer): string {
  const key = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,20})/.exec(t.url)?.[1];
  return key ? `/api/trailers/${key}` : t.url;
}
