// Recording clashes (issue: the planner said "choose which one to keep" and then offered no way to
// choose). Finding the clashes is the Hub's job; this is the choosing: what to offer, and what has
// to be cancelled once a choice is made.

import type { Conflict, Recording } from "@ultimatetv/shared";
import { clockTime } from "@ultimatetv/shared";
import type { ChoiceOption } from "./components/Dialog";

/** The choice that means "record all of them anyway" — nothing gets cancelled. */
export const KEEP_ALL = "keep-all";

export type ClashPick = string;

/**
 * One option per recording in the clash, in the order they start, so the household can see what
 * they would be giving up. "Keep them all" comes last: the Hub would then only manage to record one
 * of them live, but that is the household's call to make and it cancels nothing.
 */
export function clashOptions(c: Conflict): ChoiceOption<ClashPick>[] {
  const sorted = [...c.recordings].sort((a, b) => a.start - b.start);
  return [
    ...sorted.map((r) => ({
      label: r.programme.title,
      value: r.id,
      icon: "record" as const,
      detail: `${r.channelName} · ${clockTime(r.start)}`,
    })),
    { label: "Keep them all", value: KEEP_ALL, detail: "Record them anyway; only one will play at once" },
  ];
}

/**
 * Which recordings have to be cancelled: everything in the clash the household did not pick. The
 * choice is stated plainly ("which one to keep"), so it is honoured plainly — no second-guessing
 * about how many connections there are. "Keep them all" cancels nothing.
 */
export function clashCancel(c: Conflict, kept: readonly ClashPick[]): string[] {
  if (kept.includes(KEEP_ALL)) return [];
  return c.recordings.filter((r) => !kept.includes(r.id)).map((r) => r.id);
}

/** A one-line summary for a clash row, e.g. "Vera (ITV1) and Quiz Night (BBC One) clash at 21:00". */
export function clashTitle(c: Conflict): string {
  const names = [...c.recordings].sort((a, b) => a.start - b.start).map((r) => r.programme.title);
  return names.length > 2 ? `${names.length} recordings clash at ${clockTime(c.start)}` : `${names.join(" and ")} clash at ${clockTime(c.start)}`;
}

/** The programme that starts the clash, for a poster or an icon. */
export function clashLead(c: Conflict): Recording {
  return [...c.recordings].sort((a, b) => a.start - b.start)[0]!;
}
