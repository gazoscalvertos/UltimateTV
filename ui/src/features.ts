// Features switched off on this screen (issue #124). The list lives on the Hub, keyed by this
// screen's pairing, and is kept here too so a switched-off feature stays hidden while the Hub is
// slow to answer after a restart. Everything is on until someone switches something off.
//
// A switched-off feature leaves the top bar, Home, the key hints and the help screen, and nav
// (store.ts) refuses to open its screens, so no shortcut, colour key or phone request reaches it.

import { createSignal } from "solid-js";
import { cleanFeatureList, FEATURES, featureOfPlayback, featureOfRoute, type ClientFeatureState, type ClientKind, type FeatureId, type FeatureInfo, type Rail, type TitleRef } from "@ultimatetv/shared";
import { onBox, onDesktop } from "./agent";
import { api } from "./api";
import { onHubEvent } from "./events";

const KEY = "utv-features-off";

function saved(): FeatureId[] {
  try {
    return cleanFeatureList(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

const [off, setOffSignal] = createSignal<ReadonlySet<FeatureId>>(new Set(saved()));
const [state, setState] = createSignal<ClientFeatureState | null>(null);
/** What the Hub last said about this screen: its device id and the switches it offers. */
export { state as featureState };

/** What kind of app this is, so the Hub offers the right switches for it. */
export const clientKind: ClientKind = onDesktop ? "desktop" : onBox ? "box" : "browser";

export const featureOn = (id: FeatureId): boolean => !off().has(id);

export const featureLabel = (id: FeatureId): string => FEATURES.find((f) => f.id === id)?.label ?? id;

/** The switches this screen offers (its own kind's, before the Hub has answered). */
export const featureChoices = (): FeatureInfo[] => state()?.features ?? FEATURES.filter((f) => f.clients.includes(clientKind));

function apply(list: FeatureId[]): void {
  setOffSignal(new Set(list));
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // No storage: the Hub's answer is all it costs.
  }
}

/** Whether a screen may open; undefined when it may, else the feature that's off. */
export function blockedRoute(route: { name: string; kind?: string }): FeatureId | undefined {
  const f = featureOfRoute(route);
  return f && !featureOn(f) ? f : undefined;
}

/** Whether something may play here; undefined when it may, else the feature that's off. */
export function blockedPlayback(req: { kind: string; id?: string }, title?: TitleRef | { kind?: string } | null): FeatureId | undefined {
  const f = featureOfPlayback(req, title);
  return f && !featureOn(f) ? f : undefined;
}

/** A title passes when its kind's tab is on (films, TV shows). */
export const titleShown = (t: { kind?: string }): boolean => (t.kind === "series" ? featureOn("shows") : t.kind === "movie" ? featureOn("films") : true);

/** Home's rails without the switched-off ones, and title rails without switched-off kinds. */
export function shownRails(rails: Rail[]): Rail[] {
  return rails
    .filter((r) => !(r.kind === "channels" && !featureOn("live")) && !(r.kind === "recordings" && !featureOn("recordings")))
    .map((r) => (r.kind === "titles" ? { ...r, items: r.items.filter(titleShown) } : r))
    .filter((r) => r.kind !== "titles" || r.items.length > 0);
}

export async function loadFeatures(): Promise<void> {
  const s = await api<ClientFeatureState>(`/api/features?client=${clientKind}`).catch(() => null);
  if (!s) return;
  setState(s);
  apply(cleanFeatureList(s.off));
}

/** Switch features on this screen (or another paired one, from Settings). Needs the settings PIN when one is set. */
export async function saveFeatures(device: string, list: FeatureId[]): Promise<FeatureId[]> {
  const r = await api<{ off: FeatureId[] }>(`/api/features/${encodeURIComponent(device)}`, { method: "PUT", body: { off: list } });
  if (device === state()?.device) {
    apply(r.off);
    setState((s) => (s ? { ...s, off: r.off } : s));
  }
  return r.off;
}

export function startFeatures(): void {
  void loadFeatures();
  onHubEvent((e) => {
    if (e.type === "hello" || (e.type === "features.changed" && (!state()?.device || e.device === state()?.device))) void loadFeatures();
  });
}
