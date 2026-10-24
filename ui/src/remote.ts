// The phone remote: key presses and typed text arrive from the Hub and are fed in as if they
// came from the TV remote.

import { createSignal } from "solid-js";
import type { Action } from "@ultimatetv/shared";
import { onHubEvent } from "./events";
import { dispatch } from "./keys";
import { nav } from "./store";

/** Text typed on the phone, for the search box. */
export const [remoteText, setRemoteText] = createSignal<{ text: string; at: number } | null>(null);

const ACTIONS = new Set<string>([
  "up", "down", "left", "right", "ok", "back", "red", "green", "yellow", "blue", "guide", "info", "play", "pause", "playPause", "stop",
  "rewind", "fastForward", "record", "channelUp", "channelDown", "home",
  ...Array.from({ length: 10 }, (_, i) => `digit${i}`),
]);

export function isAction(a: string): a is Action {
  return ACTIONS.has(a);
}

export function startRemoteBridge(): void {
  onHubEvent((e) => {
    if (e.type === "remote.key" && isAction(e.action)) {
      // Wake the screen the same way a real key would (the box may also be asleep).
      dispatch(e.action);
    }
    if (e.type === "remote.text") {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement) {
        el.value = e.text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (nav.current().name !== "search") nav.push({ name: "search" });
      setRemoteText({ text: e.text, at: Date.now() });
    }
  });
}


