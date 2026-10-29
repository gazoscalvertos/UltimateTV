// The profile's watchlist, kept by the Hub so the phone can add to it too. Each entry comes with
// when it's next on TV and whether there's a recording, for the Home row.

import { createEffect, createRoot, createSignal, on } from "solid-js";
import type { Programme, TitleRef, Watchlist, WatchlistEntry } from "@ultimatetv/shared";
import { normaliseTitle, programmeName, watchlistMatches } from "@ultimatetv/shared";
import { api } from "./api";
import { onHubEvent } from "./events";
import { errorToast, profile, toast } from "./store";

export const [watchlist, setWatchlist] = createSignal<WatchlistEntry[]>([]);

type Answer = Watchlist & { added?: boolean };
const enc = encodeURIComponent;

async function load(): Promise<void> {
  if (!profile()) return void setWatchlist([]);
  const r = await api<Watchlist>("/api/watchlist").catch(() => null);
  if (r) setWatchlist(r.items);
}

let started = false;
export function startWatchlist(): void {
  if (started) return;
  started = true;
  onHubEvent((e) => {
    if (e.type === "hello" || (e.type === "watchlist.changed" && e.profileId === profile()?.id)) void load();
    // A recording finishing, or a new guide, changes what the row says about each entry.
    if (e.type === "recording.finished" || e.type === "guide.updated") void load();
  });
  createRoot(() => createEffect(on(() => profile()?.id, () => void load())));
}

/** The entry for a film or series, if it's on the watchlist. */
export function watchlistEntryForTitle(id: string, name?: string): WatchlistEntry | undefined {
  return watchlist().find((i) => i.title?.id === id) ?? (name ? watchlist().find((i) => i.kind === "programme" && normaliseTitle(i.name) === normaliseTitle(name)) : undefined);
}

/** The entry for a programme in the guide, if it's on the watchlist (by its series or its name). */
export function watchlistEntryForProgramme(p: Programme): WatchlistEntry | undefined {
  return watchlist().find((i) => watchlistMatches(i, p));
}

async function add(body: { title?: TitleRef; programmeId?: string }, name: string): Promise<void> {
  try {
    const r = await api<Answer>("/api/watchlist", { method: "POST", body });
    setWatchlist(r.items);
    toast(r.added === false ? `${name} is already on your watchlist` : `${name} added to your watchlist`, "good");
  } catch (err) {
    errorToast(err);
  }
}

export const addTitleToWatchlist = (title: TitleRef) => add({ title }, title.name);
export const addProgrammeToWatchlist = (p: Programme) => add({ programmeId: p.id }, programmeName(p.title));

export async function removeFromWatchlist(entry: WatchlistEntry, quiet = false): Promise<void> {
  try {
    const r = await api<Answer>(`/api/watchlist/${enc(entry.id)}`, { method: "DELETE" });
    setWatchlist(r.items);
    if (!quiet) toast(`${entry.name} taken off your watchlist`);
  } catch (err) {
    errorToast(err);
  }
}
