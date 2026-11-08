// Lip-sync and subtitle timing in the player (issue #223). Sound delay is kept per sound output
// (the TV's speakers, or each pair of Bluetooth headphones), so headphones keep their offset;
// subtitle delay starts at 0 for every title.

import { createSignal } from "solid-js";
import { cleanDelayMs, DELAY_STEP_MS } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";

export const [soundDelayMs, setSoundDelayMs] = createSignal(0);
export const [subDelayMs, setSubDelayMs] = createSignal(0);

const KEY = "utv-sound-delay";

function saved(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** The sound output now: "tv", or the headphones' address. */
async function outputKey(): Promise<string> {
  if (!agentHas("bluetooth")) return "tv";
  const bt = await agent.bluetooth?.({ do: "status" }).catch(() => null);
  return bt?.output.kind === "bluetooth" ? bt.output.address : "tv";
}

export const canDelay = () => agentHas("setSoundOffset") && agentHas("setSubtitleDelay");

/** A new title starts: the sound offset this output keeps, and subtitles back on time. */
export async function startDelays(): Promise<void> {
  if (!canDelay()) return;
  const ms = cleanDelayMs(saved()[await outputKey()]);
  setSoundDelayMs(ms);
  setSubDelayMs(0);
  await agent.setSoundOffset?.(ms / 1000).catch(() => undefined);
  await agent.setSubtitleDelay?.(0).catch(() => undefined);
}

/** Moves the sound by steps (or to a value); remembered for this output. */
export async function setSound(ms: number): Promise<number> {
  const v = cleanDelayMs(ms);
  setSoundDelayMs(v);
  await agent.setSoundOffset?.(v / 1000).catch(() => undefined);
  try {
    const all = saved();
    const key = await outputKey();
    if (v) all[key] = v;
    else delete all[key];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private storage off: it still applies to this title.
  }
  return v;
}

export async function setSubs(ms: number): Promise<number> {
  const v = cleanDelayMs(ms);
  setSubDelayMs(v);
  await agent.setSubtitleDelay?.(v / 1000).catch(() => undefined);
  return v;
}

export const stepSound = (dir: 1 | -1) => setSound(soundDelayMs() + dir * DELAY_STEP_MS);
export const stepSubs = (dir: 1 | -1) => setSubs(subDelayMs() + dir * DELAY_STEP_MS);
