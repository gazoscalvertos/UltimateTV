// Dimming and the screensaver. With nothing playing and no key pressed for a while the screen
// dims, and later the screensaver starts. The first key afterwards only wakes the screen.

import { createSignal } from "solid-js";
import { DEFAULT_SCREENSAVER, type ScreensaverSettings } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { setWakeHandler } from "./keys";
import { webApp } from "./music";
import { playerState, starting } from "./player";

export type IdleMode = "awake" | "dim" | "saver";

const [mode, setMode] = createSignal<IdleMode>("awake");
export { mode as idleMode };
const [config, setConfig] = createSignal<ScreensaverSettings>(DEFAULT_SCREENSAVER);
export { config as screensaverConfig };

let lastActive = Date.now();

/** Something happened that someone may be looking at: wakes the screen. True if it was asleep. */
export function wake(): boolean {
  lastActive = Date.now();
  if (mode() === "awake") return false;
  setMode("awake");
  return true;
}

/** Shows the screensaver now (Settings' "Try it now"); any key ends it. */
export function previewScreensaver(): void {
  setMode("saver");
}

/** Video playing (not paused), something starting, or a music web player on screen keeps it awake. */
function busy(): boolean {
  const st = playerState().status;
  return st === "playing" || st === "loading" || st === "buffering" || Boolean(starting()) || webApp().open;
}

function check(): void {
  if (busy()) {
    // Playback started from the phone or a recording reminder: back to full brightness.
    wake();
    return;
  }
  const c = config();
  const idleMin = (Date.now() - lastActive) / 60_000;
  // Only ever deeper from here: a key or playback wakes it.
  if (c.theme !== "off" && c.startAfterMin > 0 && idleMin >= c.startAfterMin) setMode("saver");
  else if (mode() === "awake" && c.dimAfterMin > 0 && idleMin >= c.dimAfterMin) setMode("dim");
}

export function startIdle(): void {
  setWakeHandler(wake);
  const load = () => hub.settings().then((s) => s.screensaver && setConfig(s.screensaver), () => undefined);
  void load();
  onHubEvent((e) => {
    if (e.type === "settings.changed") void load();
    // Pop-ups, news flashes and reminders are meant to be seen.
    if (e.type === "notice" || e.type === "reminder" || (e.type === "flash" && e.flash)) wake();
  });
  // Keys come through the wake handler; a mouse (on a computer) counts too.
  for (const type of ["mousemove", "wheel", "pointerdown"]) window.addEventListener(type, () => void wake(), { capture: true, passive: true });
  window.setInterval(check, 5000);
}
