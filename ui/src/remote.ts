// The phone remote: key presses and typed text arrive from the Hub and are fed in as if they
// came from the TV remote.

import { createSignal } from "solid-js";
import type { Action, BoxSoftware } from "@ultimatetv/shared";
import { agent, agentHas, onBox } from "./agent";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { takeRemoteText } from "./components/Dialog";
import { showAlertCard } from "./components/Overlays";
import { dispatch } from "./keys";
import { sendWebAppKey, sendWebAppText, webAppTakesRemote } from "./music";
import { play } from "./player";
import { errorToast, isKids, nav, setShowStats, showStats, toast } from "./store";

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
  noticeRollback(software);
  await hub.reportBox({ software, stats: showStats() }).catch(() => undefined);
}

const ROLLBACK_SEEN_KEY = "utv-rollback-seen";

/** Once per automatic roll back, a card on the TV saying the box undid a bad update (not for Kids). */
function noticeRollback(sw: BoxSoftware | null): void {
  const r = sw?.rollback;
  if (!r || r.manual || isKids()) return;
  try {
    if (localStorage.getItem(ROLLBACK_SEEN_KEY) === r.at) return;
    localStorage.setItem(ROLLBACK_SEEN_KEY, r.at);
  } catch {
    // No storage: show it anyway.
  }
  showAlertCard(
    r.ok
      ? { level: "warn", title: "The box undid an update", message: `${r.reason}, so the box went back to how it was before. Everything works as it did; Settings › About has the details.` }
      : { level: "bad", title: "The box couldn't undo a bad update", message: `${r.reason}. It tried to go back to how it was before but didn't finish cleanly. Settings › About has the details.` },
    60_000,
  );
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
      if (e.command === "rollback" && onBox && agentHas("rollback")) {
        toast("Rolling back the box's last update from the phone. The box restarts when it's done.", "good");
        void agent
          .rollback()
          .then(() => setTimeout(() => void reportBox(false), 3000))
          .catch(errorToast);
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
      // Deezer's player is showing over the UI: the keys are for it.
      if (webAppTakesRemote()) return sendWebAppKey(e.action);
      // Wake the screen the same way a real key would (the box may also be asleep).
      dispatch(e.action);
    }
    if (e.type === "remote.text") {
      if (webAppTakesRemote()) return sendWebAppText(e.text);
      // A text dialog is open (a channel name, a playlist link): the text goes in it.
      if (takeRemoteText(e.text)) return;
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


