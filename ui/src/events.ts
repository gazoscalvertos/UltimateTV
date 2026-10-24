// Hub events fan out to whichever screens are listening.

import type { HubEvent } from "@ultimatetv/shared";
import { connectEvents } from "./api";

const listeners = new Set<(e: HubEvent) => void>();
let started = false;

export function startEvents(): void {
  if (started) return;
  started = true;
  connectEvents((e) => {
    for (const l of listeners) l(e);
  });
}

/** Subscribes; returns the unsubscribe function (pass it to onCleanup). */
export function onHubEvent(listener: (e: HubEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
