// The phone remote: key presses and typed text arrive from the Hub and are fed in as if they
// came from the TV remote.

import { createSignal } from "solid-js";
import type { Action } from "@ultimatetv/shared";
import { agent, agentHas, onBox } from "./agent";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { dispatch } from "./keys";
import { play } from "./player";
import { errorToast, nav, setShowStats, showStats, toast } from "./store";

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

/** Tells the Hub what the box runs, for the phone's settings page. Only the box itself reports. */
async function reportBox(check: boolean): Promise<void> {
  if (!onBox) return;
  const software = agentHas("software") ? await agent.software(check).catch(() => null) : null;
  await hub.reportBox({ software, stats: showStats() }).catch(() => undefined);
}

export function startRemoteBridge(): void {
  onHubEvent((e) => {
    if (e.type === "hello") void reportBox(false);
    if (e.type === "remote.channel") void play({ kind: "channel", id: e.channelId });
    if (e.type === "remote.said") toast(`🎤 ${e.text}`);
    if (e.type === "box.command") {
      if (e.command === "report") void reportBox(true);
      if (e.command === "reload") void agent.reload();
      if (e.command === "stats") {
        setShowStats(Boolean(e.on));
        void reportBox(false);
      }
      if (e.command === "update" && onBox && agentHas("update")) {
        toast("Updating the box from the phone. The app restarts by itself when it's done.", "good");
        void agent
          .update()
          .then(() => setTimeout(() => void reportBox(false), 3000))
          .catch(errorToast);
      }
    }
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


