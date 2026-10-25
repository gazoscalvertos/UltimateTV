// One keydown listener for the whole app. Screens and dialogs register handlers; the newest
// gets first refusal, so an open dialog sees keys before the screen under it. Whatever nobody
// handles falls through to spatial navigation (arrows), a click (OK) or going back (Back).

import { onCleanup, onMount } from "solid-js";
import { actionForKey, type Action } from "@ultimatetv/shared";
import { current, move } from "./focus";

export type KeyHandler = (action: Action, e: KeyboardEvent) => boolean | void;

const handlers: KeyHandler[] = [];
const pressListeners: (() => void)[] = [];
let fallbackBack: () => void = () => undefined;

/** Told of every key the app gets: a real key press, the phone remote or HDMI-CEC. */
export function onAnyKey(fn: () => void): () => void {
  pressListeners.push(fn);
  return () => {
    const i = pressListeners.indexOf(fn);
    if (i >= 0) pressListeners.splice(i, 1);
  };
}

export function onBack(fn: () => void): void {
  fallbackBack = fn;
}

/** Registers a handler for the life of the calling component. Return true to stop the key. */
export function useKeys(handler: KeyHandler): void {
  onMount(() => handlers.push(handler));
  onCleanup(() => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  });
}

/** Feeds a key into the app as if pressed (used by the box for CEC power events and by tests). */
export function dispatch(action: Action, e: KeyboardEvent = new KeyboardEvent("keydown")): void {
  for (const fn of pressListeners) fn();
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]!(action, e) === true) return;
  switch (action) {
    case "up":
    case "down":
    case "left":
    case "right":
      move(action);
      return;
    case "ok":
      current()?.click();
      return;
    case "back":
      fallbackBack();
      return;
  }
}

window.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  // A real keyboard typing into a box: letters are letters, not colour keys.
  if (typing && (e.key.length === 1 || e.key === "Backspace")) return;
  const action = actionForKey(e);
  if (!action) return;
  e.preventDefault();
  dispatch(action, e);
});
