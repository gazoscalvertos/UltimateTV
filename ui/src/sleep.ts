// The sleep timer and auto-off on the TV. The Hub keeps the timer so the phone sees the same one
// (see hub/src/sleep.ts); this side counts it down, asks "Still watching?" a minute before, then
// stops what's on and puts the TV to standby over HDMI-CEC. Auto-off does the same after a few hours
// with nothing pressed on the remote, as Sky boxes do, so a TV left on all night turns itself off.

import { createSignal } from "solid-js";
import { SLEEP_MINUTES, type SleepTimer } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";
import { hub } from "./api";
import { choose, type ChoiceOption } from "./components/Dialog";
import { onHubEvent } from "./events";
import { wake } from "./idle";
import { onAnyKey } from "./keys";
import { pauseAllMusic } from "./music";
import { liveChannelId, nowPlaying, playerState, stopPlayback } from "./player";
import { errorToast, nav, toast } from "./store";

/** The warning shows this long before the TV goes off. */
export const WARN_MS = 60_000;
/** OK on the warning gives this much more. */
const SNOOZE_MS = 30 * 60_000;

const [timer, setTimer] = createSignal<SleepTimer>({ mode: "off", leftMs: null });
/** When the timer runs out by this TV's clock, or null. */
const [endsAt, setEndsAt] = createSignal<number | null>(null);
export { timer as sleepTimer, endsAt as sleepEndsAt };

export type SleepReason = "timer" | "idle";
const [warning, setWarning] = createSignal<{ endsAt: number; reason: SleepReason } | null>(null);
export { warning as sleepWarning };

let autoOffHours = 4;
let lastKey = Date.now();
/** False while the TV shows another input or is in standby: auto-off only counts on the box's input. */
let tvShowing = true;
let filling = false;

function apply(t: SleepTimer): void {
  setTimer(t);
  setEndsAt(t.leftMs === null ? null : Date.now() + t.leftMs);
  if (t.mode === "off" && warning()?.reason === "timer") setWarning(null);
  // Pushed back past the warning (from the phone, say): put it away.
  const w = warning();
  if (w?.reason === "timer" && t.leftMs !== null && t.leftMs > WARN_MS) setWarning(null);
}

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} minutes`;
  if (m === 60) return "1 hour";
  if (m % 60 === 30) return `${Math.floor(m / 60)}½ hours`;
  return `${m / 60} hours`;
}

/** "23 min", "1 h 5 min", for the top bar and Settings. */
export function leftLabel(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** How long until what's on now ends, and its name: the live programme, or the rest of the film. */
async function programmeEnd(): Promise<{ leftMs: number; name: string } | null> {
  const np = nowPlaying();
  if (!np) return null;
  if (np.info.live) {
    const id = liveChannelId();
    const now = id ? (await hub.nowNext([id]).catch(() => null))?.items[0]?.now : undefined;
    return now ? { leftMs: Math.max(WARN_MS, now.end - Date.now()), name: now.title } : null;
  }
  const st = playerState();
  const duration = st.durationMs ?? np.info.durationMs;
  return duration ? { leftMs: Math.max(WARN_MS, duration - st.positionMs), name: np.info.title } : null;
}

/** Sets the timer from the TV: minutes, the end of this programme, or 0 for off. */
export async function setSleep(choice: number | "programme"): Promise<void> {
  try {
    if (choice === "programme") {
      const end = await programmeEnd();
      if (!end) return toast("Nothing on has an end time. Pick a number of minutes instead.");
      apply(await hub.setSleep({ mode: "programme", leftMs: end.leftMs, programme: end.name }));
      toast(`The TV goes off when ${end.name} ends`, "good");
    } else if (choice === 0) {
      apply(await hub.clearSleep());
      toast("Sleep timer off");
    } else {
      apply(await hub.setSleep({ minutes: choice }));
      toast(`The TV goes off in ${minutesLabel(choice)}`, "good");
    }
  } catch (err) {
    errorToast(err);
  }
}

/** The sleep timer's choices (Options in the player, Settings, the help screen). */
export async function chooseSleep(): Promise<void> {
  const t = timer();
  const end = endsAt();
  const options: ChoiceOption<number | "programme">[] = [
    ...(nowPlaying() ? [{ label: "When this programme ends", value: "programme" as const, icon: t.mode === "programme" ? "check" : "moon" }] : []),
    ...SLEEP_MINUTES.map((m) => ({ label: minutesLabel(m), value: m, ...(t.mode === "minutes" && t.minutes === m ? { icon: "check" } : {}) })),
    ...(t.mode !== "off" ? [{ label: "Turn it off", value: 0, tone: "danger" as const }] : []),
  ];
  const pick = await choose({
    title: "Sleep timer",
    message: t.mode !== "off" && end ? `The TV goes off in ${leftLabel(end - Date.now())}${t.programme ? `, when ${t.programme} ends` : ""}.` : "The TV turns itself off when it runs out. A minute before, it asks whether you're still watching.",
    options,
  });
  if (pick !== undefined) await setSleep(pick);
}

/** OK on the warning: a timer gets half an hour more, auto-off starts counting again. */
export function keepWatching(): void {
  const w = warning();
  setWarning(null);
  lastKey = Date.now();
  if (w?.reason !== "timer") return;
  const left = Math.max(0, (endsAt() ?? Date.now()) - Date.now()) + SNOOZE_MS;
  void hub.setSleep({ leftMs: left }).then(apply, errorToast);
  toast(`Half an hour more: the TV goes off in ${leftLabel(left)}`);
}

/** Back on the warning: the timer's off, and the TV stays on. */
export function cancelSleep(): void {
  const w = warning();
  setWarning(null);
  lastKey = Date.now();
  if (w?.reason === "timer") void setSleep(0);
}

async function sleepNow(reason: SleepReason): Promise<void> {
  setWarning(null);
  lastKey = Date.now();
  if (reason === "timer") {
    apply({ mode: "off", leftMs: null });
    void hub.clearSleep().catch(() => undefined);
  }
  await stopPlayback().catch(() => undefined);
  await pauseAllMusic().catch(() => undefined);
  nav.reset({ name: "home" });
  // Older box apps can't send standby: what's on still stops.
  if (agentHas("standbyTv")) await agent.standbyTv().catch(() => undefined);
}

/** Up over everything, with the screensaver out of the way so it's seen. */
function showWarning(w: { endsAt: number; reason: SleepReason }): void {
  wake();
  setWarning(w);
}

function tick(): void {
  const now = Date.now();
  const t = timer();
  // Set from the phone for "the end of this programme": only the TV knows when that is.
  if (t.mode === "programme" && endsAt() === null && !filling) {
    filling = true;
    void programmeEnd()
      .then((end) => (end ? hub.setSleep({ mode: "programme", leftMs: end.leftMs, programme: end.name }).then(apply) : setSleep(0)))
      .catch(errorToast)
      .finally(() => (filling = false));
  }
  const end = endsAt();
  const w = warning();
  if (w && now >= w.endsAt) {
    void sleepNow(w.reason);
    return;
  }
  if (end !== null && !w && end - now <= WARN_MS) {
    // A film that was paused ends later than it did: move the timer rather than cut it off.
    const st = playerState();
    const np = nowPlaying();
    const duration = st.durationMs ?? np?.info.durationMs;
    if (t.mode === "programme" && np && !np.info.live && duration && duration - st.positionMs > WARN_MS + 30_000 && !filling) {
      filling = true;
      void hub
        .setSleep({ mode: "programme", leftMs: duration - st.positionMs, programme: np.info.title })
        .then(apply, () => showWarning({ endsAt: end, reason: "timer" }))
        .finally(() => (filling = false));
      return;
    }
    showWarning({ endsAt: Math.max(end, now + 5000), reason: "timer" });
    return;
  }
  if (autoOffHours > 0 && tvShowing && !w) {
    const idleEnd = lastKey + autoOffHours * 3600_000;
    if (now >= idleEnd - WARN_MS) showWarning({ endsAt: Math.max(idleEnd, now + 5000), reason: "idle" });
  }
}

export function startSleep(): void {
  const load = () => {
    void hub.sleep().then(apply, () => undefined);
    void hub.settings().then((s) => (autoOffHours = s.sleep?.autoOffHours ?? 4), () => undefined);
  };
  load();
  onHubEvent((e) => {
    if (e.type === "hello") load();
    if (e.type === "settings.changed") void hub.settings().then((s) => (autoOffHours = s.sleep?.autoOffHours ?? 4), () => undefined);
    if (e.type === "sleep") apply(e.timer);
  });
  // Any key (the remote, the phone, HDMI-CEC) means someone's there, even one that only wakes
  // the screensaver (those stop before the app's key handlers).
  onAnyKey(() => (lastKey = Date.now()));
  window.addEventListener("keydown", () => (lastKey = Date.now()), true);
  agent.onPower((active) => {
    tvShowing = active;
    lastKey = Date.now();
    if (!active) setWarning(null);
  });
  window.setInterval(tick, 1000);
}
