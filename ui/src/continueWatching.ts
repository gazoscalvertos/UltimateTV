// Taking a title off Continue watching (issue #100), from the card's Options menu on Home.
// Remove hides it for this profile and keeps the progress; Mark as watched finishes it, and
// Jellyfin is told for Jellyfin titles. Undo is offered for a few seconds after a Remove.

import type { TitleRef } from "@ultimatetv/shared";
import type { ChoiceOption } from "./components/Dialog";

export type ContinuePick = "play" | "watched" | "hide";

const percent = (t: TitleRef): string => {
  const p = Math.max(0, Math.min(1, t.progress ?? 0));
  return `${Math.round(p * 100)}%`;
};

/** The Options menu for a Continue watching card: Resume, Mark as watched, Remove. */
export function continueOptions(t: TitleRef): ChoiceOption<ContinuePick>[] {
  const next = t.subtitle?.startsWith("Next:") ?? false;
  const resume: ChoiceOption<ContinuePick> = next
    ? { label: "Play next episode", value: "play", icon: "play", ...(t.subtitle ? { detail: t.subtitle.replace(/^Next:\s*/, "") } : {}) }
    : { label: t.progress ? `Resume (${percent(t)})` : "Resume", value: "play", icon: "play", ...(t.subtitle ? { detail: t.subtitle } : {}) };
  return [resume, { label: "Mark as watched", value: "watched", icon: "check" }, { label: "Remove from Continue watching", value: "hide", icon: "eye" }];
}

/** What the toast says after a Remove, so the household knows where it went. */
export function undoLabel(t: TitleRef): string {
  return `${t.name} won't show in Continue watching again until it's played.`;
}
