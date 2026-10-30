// The sleep timer: in 15 minutes to two hours, or at the end of what's on. A minute before, a
// card asks whether anyone's still watching (OK gives another 15 minutes); then the sound fades,
// playback stops and the TV goes to standby over HDMI-CEC. Set from Options while watching, the
// phone remote, or by voice ("sleep in half an hour").

import { createSignal } from "solid-js";
import type { SleepChoice, SleepState } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";
import { hub } from "./api";
import { choose } from "./components/Dialog";
import { onHubEvent } from "./events";
import { markTvOff } from "./homeassistant";
import { pauseAllMusic } from "./music";
import { liveChannelId, nowPlaying, playerState, stopPlayback } from "./player";
import { toast } from "./store";

const OFF: SleepState = { at: null, end: false, label: "" };
const [sleep, setSleepSignal] = createSignal<SleepState>(OFF);
/** The "still watching?" card is up. */
const [warning, setWarning] = createSignal(false);
export { sleep, warning as sleepWarning };

let timer: number | undefined;
let fading = false;

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** When what's on ends: the programme on the live channel, or the film or episode. */
async function endOfThis(): Promise<{ at: number; name: string } | null> {
  const np = nowPlaying();
  if (!np) return null;
  if (np.info.live) {
    const id = liveChannelId();
    const now = id ? (await hub.nowNext([id]).catch(() => null))?.items[0]?.now : undefined;
    return now ? { at: now.end, name: now.title } : null;
  }
  const st = playerState();
  const duration = st.durationMs ?? np.info.durationMs;
  if (!duration) return null;
  return { at: Date.now() + Math.max(0, duration - st.positionMs) + 15_000, name: np.title?.name ?? np.info.title };
}

function schedule(): void {
  clearInterval(timer);
  if (sleep().at === null) return;
  timer = window.setInterval(() => void tick(), 5000);
  void tick();
}

async function tick(): Promise<void> {
  const at = sleep().at;
  if (at === null || fading) return;
  const left = at - Date.now();
  if (left <= 0) return void goToSleep();
  if (left <= 60_000 && !warning()) setWarning(true);
}

/** Fades the sound, stops everything and puts the TV to standby. */
async function goToSleep(): Promise<void> {
  fading = true;
  setWarning(false);
  clearInterval(timer);
  try {
    if (agentHas("setVolume")) {
      for (let v = 90; v >= 0; v -= 10) {
        await agent.setVolume(v).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    await stopPlayback();
    await pauseAllMusic();
    if (agentHas("tvStandby")) {
      await agent.tvStandby().catch(() => undefined);
      markTvOff();
    }
  } finally {
    fading = false;
    setSleepSignal(OFF);
  }
}

export async function setSleep(choice: SleepChoice): Promise<SleepState> {
  setWarning(false);
  if ("off" in choice) {
    setSleepSignal(OFF);
    schedule();
    return OFF;
  }
  let next: SleepState;
  if ("end" in choice) {
    const end = await endOfThis();
    if (!end) throw new Error("Nothing's playing with an end time, so pick a number of minutes");
    next = { at: end.at, end: true, label: `End of ${end.name} (${clock(end.at)})` };
  } else {
    const minutes = Math.max(1, Math.min(600, Math.round(choice.minutes)));
    const at = Date.now() + minutes * 60_000;
    next = { at, end: false, label: `${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} min`} (${clock(at)})` };
  }
  setSleepSignal(next);
  schedule();
  return next;
}

/** "Still watching?": another 15 minutes. */
export function stillWatching(): void {
  const at = Math.max(sleep().at ?? Date.now(), Date.now()) + 15 * 60_000;
  setSleepSignal({ at, end: false, label: `15 min more (${clock(at)})` });
  setWarning(false);
  toast(`Sleep timer moved to ${clock(at)}`);
}

/** The menu: Options while watching, and Settings. */
export async function openSleepMenu(): Promise<void> {
  const s = sleep();
  const pick = await choose<string>({
    title: "Sleep timer",
    message: s.at ? `Set for ${s.label}. When it goes off the sound fades, playback stops and the TV turns off.` : "When it goes off the sound fades, playback stops and the TV turns off.",
    options: [
      ...(nowPlaying() ? [{ label: "At the end of this", value: "end", icon: "moon" }] : []),
      ...[15, 30, 45, 60, 90, 120].map((m) => ({ label: m >= 60 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`, value: String(m) })),
      ...(s.at ? [{ label: "Turn the timer off", value: "off", tone: "danger" as const }] : []),
    ],
  });
  if (!pick) return;
  try {
    const next = await setSleep(pick === "off" ? { off: true } : pick === "end" ? { end: true } : { minutes: Number(pick) });
    toast(next.at ? `Sleeping at ${clock(next.at)}` : "Sleep timer off", "good");
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "bad");
  }
}

/** Voice and the phone set it through the Hub. */
export function startSleep(): void {
  onHubEvent((e) => {
    if (e.type !== "sleep") return;
    void setSleep(e.choice).then(
      (s) => toast(s.at ? `Sleep timer: ${s.label}` : "Sleep timer off", "good"),
      (err: Error) => toast(err.message, "bad"),
    );
  });
}
