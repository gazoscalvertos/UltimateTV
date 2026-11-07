// What the TV box does when the TV goes to standby or switches to another input (the CEC events
// from box/src/cec.ts), and when it comes back. Settings › Picture and sound › When the TV turns off.

import type { PlayerState } from "@ultimatetv/shared";

export type TvOffMode = "pause" | "stop" | "keep";

/** What to do with the video when the TV goes off. */
export function tvOffAction(mode: TvOffMode | undefined, playing: { live: boolean; status: PlayerState["status"] } | null): "pause" | "stop" | "nothing" {
  if (!playing || mode === "keep") return "nothing";
  // Hubs from before the setting stopped, as did the box.
  if (mode === undefined || mode === "stop") return "stop";
  // Live TV keeps the IPTV connection open (and recordings may need it) while paused, and coming back
  // hours later to an old picture is no use: stop it.
  if (playing.live) return "stop";
  return playing.status === "paused" ? "nothing" : "pause";
}

/** What to show when the TV comes back: the video (paused, or still playing), or Home / the profile picker. */
export function tvOnAction(hasVideo: boolean, locked: boolean): "back-to-video" | "start-afresh" {
  // A PIN on the profiles means the profile picker comes first, whatever was playing.
  return hasVideo && !locked ? "back-to-video" : "start-afresh";
}
