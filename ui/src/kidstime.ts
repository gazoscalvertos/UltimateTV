// Kids time limits on the TV. While a Kids profile watches, the TV tells the Hub every half
// minute; the Hub counts the time and says how long is left (it enforces the limits, see
// hub/src/kidstime.ts). Here we show the 5 and 2 minute warnings, let what's on finish once time
// is up, then fade the sound and go back to "Who's watching?", where an adult's PIN gives more.

import { createSignal } from "solid-js";
import type { KidsTimeStatus, Profile } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";
import { ApiError, hub } from "./api";
import { askPin, choose } from "./components/Dialog";
import { nowPlaying, playerState, stopPlayback } from "./player";
import { endOfThis } from "./sleep";
import { isKids, nav, toast } from "./store";

const REPORT_MS = 30_000;

/** A card over everything: the warnings, and "time's up, this can finish". */
const [kidsCard, setKidsCard] = createSignal<{ title: string; message: string } | null>(null);
export { kidsCard };

let timer: number | undefined;
let cardTimer: number | undefined;
let warned = new Set<string>();
let stopping = false;
/** When what's on ends, once time is up: we stop then, or at the Hub's hard cap if sooner. */
let finishAt: number | null = null;

function showCard(title: string, message: string, ms = 15_000): void {
  setKidsCard({ title, message });
  clearTimeout(cardTimer);
  cardTimer = window.setTimeout(() => setKidsCard(null), ms);
}

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const why = (st: KidsTimeStatus) => (st.reason === "bedtime" ? "bedtime" : "the end of today's TV time");

async function tick(): Promise<void> {
  // At the picker nobody is watching on this profile yet.
  if (!isKids() || stopping || nav.current().name === "profiles") return;
  const st = playerState().status;
  const playing = Boolean(nowPlaying()) && st !== "paused" && st !== "idle" && st !== "ended" && st !== "error";
  const res = await hub.kidsReport(playing).catch(() => null);
  if (res?.status) await act(res.status);
}

async function act(st: KidsTimeStatus): Promise<void> {
  if (!st.limited) return;
  const key = `${st.reason}:${st.allowanceMinutes}:${st.bedtime}`;
  if (st.state === "warn" && st.minutesLeft !== null) {
    // The 5 minute warning, then the 2 minute one.
    const step = st.minutesLeft <= 2 ? "2" : "5";
    if (!warned.has(`${key}:${step}`)) {
      warned.add(`${key}:${step}`);
      showCard(`${st.minutesLeft} more minute${st.minutesLeft === 1 ? "" : "s"}`, `Then it's ${why(st)}.`);
    }
    return;
  }
  if (st.state === "ok") {
    finishAt = null;
    return;
  }
  if (st.state === "stopped" || !nowPlaying()) return void timeUp(st);
  // Finishing: what's on may end, up to the Hub's cap.
  if (finishAt === null) {
    const end = await endOfThis().catch(() => null);
    finishAt = Math.min(end?.at ?? st.stopBy!, st.stopBy!);
    showCard(st.reason === "bedtime" ? "It's bedtime" : "That's all the TV for today", `This can finish (until ${clock(finishAt)}), then the TV stops.`, 20_000);
  }
  if (Date.now() >= finishAt) await timeUp(st);
}

/** Fades the sound, stops and goes back to the profile picker. */
export async function timeUp(st?: KidsTimeStatus): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    if (nowPlaying()) {
      if (agentHas("setVolume")) {
        for (let v = 90; v >= 0; v -= 15) {
          await agent.setVolume(v).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      await stopPlayback();
      if (agentHas("setVolume")) await agent.setVolume(100).catch(() => undefined);
    }
    finishAt = null;
    nav.reset({ name: "profiles" });
    showCard(st?.reason === "bedtime" ? "Goodnight!" : "Time's up for today", "A grown-up can give more time: pick the profile and enter their PIN.", 20_000);
  } finally {
    stopping = false;
  }
}

/**
 * At the profile picker: a Kids profile whose time is up needs an adult's PIN for more.
 * Returns false when nobody gave any.
 */
export async function askForMoreTime(p: Profile): Promise<boolean> {
  if (p.kind !== "kids" || !p.limits) return true;
  const st = await hub.kidsTimeOf(p.id).catch(() => null);
  if (!st || (st.state !== "finishing" && st.state !== "stopped")) return true;
  const minutes = await choose<number>({
    title: st.reason === "bedtime" ? `Bedtime for ${p.name}` : `TV time is up for ${p.name}`,
    message: "A grown-up can give more time with their PIN.",
    options: [
      { label: "15 more minutes", value: 15 },
      { label: "30 more minutes", value: 30 },
      { label: "An hour more", value: 60 },
      { label: "No limits until the morning", value: 0 },
    ],
  });
  if (minutes === undefined) return false;
  let given = false;
  const tryPin = async (pin?: string) => {
    await hub.kidsExtra(p.id, minutes, pin);
    given = true;
  };
  try {
    // No adult PIN set: nothing to ask (Settings says to set one so the limits stick).
    await tryPin();
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 403)) {
      toast(err instanceof Error ? err.message : String(err), "bad");
      return false;
    }
    await askPin("A grown-up's PIN", async (pin) => {
      try {
        await tryPin(pin);
        return null;
      } catch (e) {
        return e instanceof ApiError && e.status === 403 ? "That PIN isn't right. Try again." : String(e);
      }
    });
  }
  if (given) {
    warned = new Set();
    finishAt = null;
    toast(minutes ? `${minutes} more minutes for ${p.name}` : `No limits for ${p.name} until the morning`, "good");
  }
  return given;
}

/** Starts the half-minute report; it does nothing on adult profiles. */
export function startKidsTime(): void {
  clearInterval(timer);
  timer = window.setInterval(() => void tick(), REPORT_MS);
}

/** Just switched profile: a new day of warnings, and check straight away. */
export function kidsProfileEntered(): void {
  warned = new Set();
  finishAt = null;
  void tick();
}

/** The Hub refused to start something: time's up. */
export function playRefused(err: unknown): boolean {
  if (!(err instanceof ApiError && err.code === "limit")) return false;
  void timeUp();
  return true;
}
