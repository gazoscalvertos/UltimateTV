// The household's reminders (issue: they were write-only). Setting one is easy — the guide's
// programme card does it — but until now the only way to take one back was to find the programme
// again. This is the pure part: what is still to come, in order, and how to say when it is on.

import type { Reminder } from "@ultimatetv/shared";
import { clockTime, dayLabel } from "@ultimatetv/shared";

/** A programme that is on now or later still matters; one that has finished does not. */
export function reminderIsDue(r: Reminder, now = Date.now()): boolean {
  return r.programme.start <= now && now < r.programme.end;
}

/**
 * The reminders worth listing: everything that has not finished yet, earliest first. One entry per
 * programme, so a guide refresh that hands us the same one twice cannot show it twice.
 */
export function upcomingReminders(reminders: readonly Reminder[], now = Date.now()): Reminder[] {
  const seen = new Set<string>();
  const out: Reminder[] = [];
  for (const r of reminders) {
    if (r.programme.end <= now) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out.sort((a, b) => a.programme.start - b.programme.start);
}

/** "On now", "Today at 20:30", "Tomorrow at 21:00" — the same words the guide uses. */
export function reminderWhen(r: Reminder, now = Date.now()): string {
  if (reminderIsDue(r, now)) return "On now";
  const day = dayLabel(r.programme.start, now);
  const time = clockTime(r.programme.start);
  return day === "Today" || day === "Tomorrow" || day === "Yesterday" ? `${day} at ${time}` : `${day} ${time}`;
}
