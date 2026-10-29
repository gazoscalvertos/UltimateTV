// What the remote's buttons do right here: each screen says, and the strip along the bottom
// (components/KeyHints.tsx) shows it, as Sky Q does. Info opens the help screen with the lot.

import { createSignal, onCleanup, onMount } from "solid-js";

export type HintKey = "red" | "green" | "yellow" | "blue" | "ok" | "back" | "info" | "guide" | "play" | "record" | "arrows" | "updown" | "leftright" | "digits";

export interface Hint {
  key: HintKey;
  label: string;
}

const [stack, setStack] = createSignal<{ id: number; hints: () => Hint[] }[]>([]);
let seq = 0;

/** Says what the buttons do on this screen, for as long as it's showing. The newest screen wins. */
export function useHints(hints: () => Hint[]): void {
  const id = ++seq;
  onMount(() => setStack((s) => [...s, { id, hints }]));
  onCleanup(() => setStack((s) => s.filter((x) => x.id !== id)));
}

export const currentHints = (): Hint[] => {
  const top = stack()[stack().length - 1];
  return top ? top.hints() : [];
};

/** The buttons that work the same everywhere, for the help screen. */
export const EVERYWHERE: Hint[] = [
  { key: "arrows", label: "Move around" },
  { key: "ok", label: "Choose" },
  { key: "back", label: "Go back a step" },
  { key: "guide", label: "TV guide, from anywhere" },
  { key: "info", label: "This help (or more about a programme in the guide)" },
  { key: "play", label: "Play and pause" },
  { key: "digits", label: "Type a channel number while watching" },
];

/** On Home the colour keys are shortcuts. */
export const HOME_KEYS: Hint[] = [
  { key: "red", label: "Recordings" },
  { key: "green", label: "TV guide" },
  { key: "yellow", label: "Search" },
  { key: "blue", label: "Cast and games" },
];
