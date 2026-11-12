// The family board's items (calendar events, birthdays, bin day, the school run), loaded once and
// again when the Hub says the calendars were read, and when the profile changes: a Kids profile
// is told a reduced version, so it has to ask again.

import { createEffect, createRoot, createSignal } from "solid-js";
import { type FamilyState, visibleItems } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { now, profile } from "./store";

const [family, setFamily] = createSignal<FamilyState | null>(null);
export { family };

export function loadFamily(): Promise<void> {
  return hub.family().then(
    (st) => void setFamily(st),
    () => undefined,
  );
}

/** Whether the family board has anything to show on this profile. */
export const familyViewer = () => (profile()?.kind === "kids" ? "kids" : profile()?.kind === "guest" ? "guest" : "adult");

/** The next `limit` things, with what has already passed since the Hub last answered dropped (the clock moves on). */
export function familyNext(limit: number) {
  const st = family();
  return st ? visibleItems(st.items, now(), familyViewer(), { days: 7, limit }) : [];
}

export function startFamily(): void {
  void loadFamily();
  // The Hub reads calendars every 15 minutes and says so; this catches a missed event.
  window.setInterval(() => void loadFamily(), 10 * 60_000);
  onHubEvent((e) => {
    if (e.type === "family.changed" || e.type === "hello") void loadFamily();
  });
  createRoot(() => createEffect(() => void (profile()?.id, loadFamily())));
}
