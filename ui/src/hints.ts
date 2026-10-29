// What the buttons do on the screen you're on. Each screen says (useHints); the newest screen's
// hints win. The colour ones show along the bottom (KeyHints), and the help screen lists them all.

import { createSignal, onCleanup, onMount } from "solid-js";

export type HintKey = "red" | "green" | "yellow" | "blue" | "ok" | "back" | "info" | "play" | "record" | "guide" | "updown" | "leftright" | "chupdown" | "digits" | "rewff";

export interface KeyHint {
  key: HintKey;
  label: string;
}

export const COLOUR_KEYS: readonly HintKey[] = ["red", "green", "yellow", "blue"];

interface Entry {
  hints: () => KeyHint[];
  /** The screen shows its own legend (the guide does), so the bar keeps out of the way. */
  legend: boolean;
}
const [stack, setStack] = createSignal<Entry[]>([]);

/** Registers the calling screen's hints for as long as it's open. The function may read signals. */
export function useHints(hints: () => KeyHint[], opts: { legend?: boolean } = {}): void {
  const entry: Entry = { hints, legend: opts.legend ?? false };
  onMount(() => setStack((s) => [...s, entry]));
  onCleanup(() => setStack((s) => s.filter((e) => e !== entry)));
}

/** The hints of the screen on top. */
export function currentHints(): KeyHint[] {
  const s = stack();
  return s.length ? s[s.length - 1]!.hints() : [];
}

/** Whether the screen on top has its own legend of the keys. */
export function hasOwnLegend(): boolean {
  return stack().at(-1)?.legend ?? false;
}

/** The bar along the bottom, from Settings › Help (on unless turned off). */
export const [keyHintsOn, setKeyHintsOn] = createSignal(true);
