// App-wide state: where we are, who's watching, toasts and dialogs.

import { createSignal, type JSX } from "solid-js";
import { cleanAccessibility, DEFAULT_APP_NAME, isThemeName, themeInfo, type AccessibilitySettings, type MusicItem, type Profile, type ThemeName } from "@ultimatetv/shared";

export type Route =
  | { name: "profiles" }
  | { name: "home" }
  | { name: "guide" }
  | { name: "guide-edit"; id?: string }
  | { name: "player" }
  | { name: "browse"; kind: "movie" | "series" }
  | { name: "details"; id: string }
  | { name: "search" }
  | { name: "planner"; tab?: PlannerTab }
  | { name: "music" }
  | { name: "music-list"; item: MusicItem }
  | { name: "settings"; section?: string }
  | { name: "mix-channel"; id: string }
  | { name: "downloads" }
  | { name: "cast" }
  | { name: "weather" };

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

// The app's name, set on the phone's settings page. Remembered so the TV starts with it before
// the Hub answers; the page title carries it to the box, which shows it while the Hub is away.
function readAppName(): string {
  try {
    return localStorage.getItem("utv-app-name") || DEFAULT_APP_NAME;
  } catch {
    return DEFAULT_APP_NAME;
  }
}
const [appName, setAppNameSignal] = createSignal(readAppName());
export { appName };
document.title = appName();
export function setAppName(name: string): void {
  setAppNameSignal(name);
  document.title = name;
  try {
    localStorage.setItem("utv-app-name", name);
  } catch {
    // Private storage off: the name still shows once the Hub answers.
  }
}

// The look of the app, chosen in Settings and kept on the Hub. Remembered here too, so the TV
// wears the right one before the Hub answers (and on the offline screen).
function readTheme(): ThemeName {
  try {
    const saved = localStorage.getItem("utv-theme");
    if (isThemeName(saved)) return saved;
  } catch {
    // Private storage off: the dark theme until the Hub answers.
  }
  return "default";
}
/** Puts a theme's colours on the page: its palette as CSS custom properties, and its name for the decorations. */
function wear(name: ThemeName): void {
  const t = themeInfo(name);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.palette)) root.style.setProperty(k, v);
  root.style.colorScheme = t.light ? "light" : "dark";
  root.dataset.theme = t.id;
}
const [theme, setThemeSignal] = createSignal<ThemeName>(readTheme());
export { theme };
let worn = theme();
wear(worn);
/** The theme the household chose (or the season brought): worn, and remembered. */
export function setTheme(name: ThemeName): void {
  worn = name;
  setThemeSignal(name);
  wear(name);
  try {
    localStorage.setItem("utv-theme", name);
  } catch {
    // Nothing to remember it with: the Hub says again next time.
  }
}
/** Tries a theme on while choosing in Settings; `null` goes back to the one being worn. */
export function previewTheme(name: ThemeName | null): void {
  const next = name ?? worn;
  setThemeSignal(next);
  wear(next);
}

const [profile, setProfileSignal] = createSignal<Profile | null>(null);
export { profile };
export const isKids = () => profile()?.kind === "kids";

// Accessibility (Settings › Accessibility) belongs to the profile watching. The last one worn is
// remembered, so the profile picker and the offline screen keep the bigger text.
function readAccessibility(): AccessibilitySettings {
  try {
    return cleanAccessibility(JSON.parse(localStorage.getItem("utv-a11y") ?? "null"));
  } catch {
    return cleanAccessibility(null);
  }
}
const [accessibility, setAccessibilitySignal] = createSignal<AccessibilitySettings>(readAccessibility());
export { accessibility };
const systemReducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Nothing moving that doesn't have to: the profile asked, or the system did. */
export const reducedMotion = () => accessibility().reducedMotion || systemReducedMotion;
/** Puts the text size, focus ring and motion on the page. */
export function wearAccessibility(a: AccessibilitySettings): void {
  setAccessibilitySignal(a);
  const root = document.documentElement;
  root.style.setProperty("--ts", String(a.textScale / 100));
  root.dataset.textScale = String(a.textScale);
  root.classList.toggle("high-contrast", a.highContrast);
  root.classList.toggle("reduce-motion", a.reducedMotion);
  try {
    localStorage.setItem("utv-a11y", JSON.stringify(a));
  } catch {
    // Nothing to remember it with: the profile brings it back.
  }
}
wearAccessibility(accessibility());
/** Who's watching, and their accessibility settings with them. */
export function setProfile(p: Profile | null): void {
  setProfileSignal(p);
  if (p) wearAccessibility(cleanAccessibility(p.accessibility));
}

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

/** The playback stats overlay, remembered on this TV (it's for checking picture and sound). */
const statsKey = "utv-stats";
const readStats = () => {
  try {
    return localStorage.getItem(statsKey) === "1";
  } catch {
    return false;
  }
};
const [showStats, setShowStatsSignal] = createSignal(readStats());
export { showStats };
export function setShowStats(on: boolean): void {
  setShowStatsSignal(on);
  try {
    localStorage.setItem(statsKey, on ? "1" : "0");
  } catch {
    // No storage: it lasts until the app reloads.
  }
}
