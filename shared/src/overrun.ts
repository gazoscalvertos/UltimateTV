// Following overruns (#230): live sport and chat shows run past their slot, so a recording that
// stops at the guide's end time loses the finish. These are the shared rules for which
// recordings follow the guide, and how the extra time is worded.

import type { Programme, Recording } from "./domain.js";

/** "auto" follows sport and live programmes only, "on" follows every recording, "off" none. */
export type FollowOverruns = "auto" | "on" | "off";

export const FOLLOW_OVERRUNS: FollowOverruns[] = ["auto", "on", "off"];

const LIVE_OR_SPORT =
  /\b(sports?|football|soccer|premier league|champions league|formula ?1|formula one|f1|grand prix|motorsport|racing|rugby|cricket|tennis|golf|darts|snooker|boxing|wrestling|ufc|athletics|olympics?|nba|nfl|live)\b/i;

/** Sport, or something billed as live: the programmes that overrun. */
export function isLiveOrSport(p: Programme): boolean {
  return p.categories.some((c) => LIVE_OR_SPORT.test(c)) || /\blive\b/i.test(p.title) || /\blive\b/i.test(p.subtitle ?? "");
}

/** Does this recording watch the guide for an overrun? The recording's own choice beats the setting. */
export function followsOverrun(rec: Pick<Recording, "followOverrun" | "programme" | "method">, setting: FollowOverruns | undefined): boolean {
  if (rec.method === "catchup") return false; // catch-up copies the whole programme as the provider cut it
  if (rec.followOverrun !== undefined) return rec.followOverrun;
  const mode = setting ?? "auto";
  return mode === "on" || (mode === "auto" && isLiveOrSport(rec.programme));
}

/** "Extended by 12 minutes", or undefined when the recording wasn't extended. */
export function extendedLabel(rec: Pick<Recording, "extendedMs">): string | undefined {
  const min = Math.round((rec.extendedMs ?? 0) / 60_000);
  if (min <= 0) return undefined;
  return `Extended by ${min} ${min === 1 ? "minute" : "minutes"}`;
}
