// App-wide state: where we are, who's watching, toasts and dialogs.

import { createSignal, type JSX } from "solid-js";
import type { Profile } from "@ultimatetv/shared";

export type Route =
  | { name: "profiles" }
  | { name: "home" }
  | { name: "guide" }
  | { name: "player" }
  | { name: "browse"; kind: "movie" | "series" }
  | { name: "details"; id: string }
  | { name: "search" }
  | { name: "planner"; tab?: PlannerTab }
  | { name: "settings" };

export type PlannerTab = "recorded" | "scheduled" | "series" | "downloads";

const [stack, setStack] = createSignal<Route[]>([{ name: "profiles" }]);

export const nav = {
  stack,
  current: () => stack()[stack().length - 1]!,
  push(route: Route): void {
    setStack((s) => [...s, route]);
  },
  /** Swap the current screen (top menu tabs), so Back doesn't walk through every tab. */
  replace(route: Route): void {
    setStack((s) => [...s.slice(0, -1), route]);
  },
  reset(route: Route): void {
    setStack([route]);
  },
  back(): boolean {
    if (stack().length <= 1) return false;
    setStack((s) => s.slice(0, -1));
    return true;
  },
  /** The screen a full-screen player would return to. */
  previous: () => stack()[stack().length - 2],
};

// ---------------------------------------------------------------------------
// Profile

export const [profile, setProfile] = createSignal<Profile | null>(null);
export const isKids = () => profile()?.kind === "kids";

// ---------------------------------------------------------------------------
// Toasts

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "good" | "bad";
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
export { toasts };
let toastId = 0;

export function toast(message: string, tone: Toast["tone"] = "info"): void {
  const id = ++toastId;
  setToasts((t) => [...t.slice(-2), { id, message, tone }]);
  setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
}

export function errorToast(err: unknown): void {
  toast(err instanceof Error ? err.message : String(err), "bad");
}

// ---------------------------------------------------------------------------
// Dialogs

export interface DialogEntry {
  id: number;
  render: (close: (value?: unknown) => void) => JSX.Element;
  resolve: (value: unknown) => void;
}

const [dialogs, setDialogs] = createSignal<DialogEntry[]>([]);
export { dialogs };
let dialogId = 0;

/** Opens a dialog; resolves with whatever it closes with (undefined for Back). */
export function openDialog<T>(render: (close: (value?: T) => void) => JSX.Element): Promise<T | undefined> {
  return new Promise((resolve) => {
    const id = ++dialogId;
    const entry: DialogEntry = {
      id,
      render: render as DialogEntry["render"],
      resolve: (v) => {
        setDialogs((d) => d.filter((x) => x.id !== id));
        resolve(v as T | undefined);
      },
    };
    setDialogs((d) => [...d, entry]);
  });
}

export function closeTopDialog(): boolean {
  const top = dialogs()[dialogs().length - 1];
  if (!top) return false;
  top.resolve(undefined);
  return true;
}

// ---------------------------------------------------------------------------
// Clock, ticking once a minute (on the minute) for progress bars and the top bar.

const [now, setNow] = createSignal(Date.now());
export { now };
const align = () => {
  setNow(Date.now());
  setTimeout(align, 60_000 - (Date.now() % 60_000) + 50);
};
setTimeout(align, 60_000 - (Date.now() % 60_000) + 50);
setInterval(() => setNow(Date.now()), 15_000);
