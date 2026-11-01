// Favourites on the TV: the films, TV shows and guide channels the profile watching has starred.
// Each profile has its own (kept on the Hub, see hub/src/favourites.ts). Starred from a title's
// page (Blue), the player (Green, or Options), the guide (hold OK, or the programme card) and
// from the phone remote, which asks the TV so it lands on the profile watching.

import { createEffect, createRoot, createSignal, on } from "solid-js";
import type { Channel, FavouriteInput, FavouriteResult, Favourites, TitleRef } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { channels, setChannels } from "./player";
import { errorToast, profile, toast } from "./store";

const [state, setState] = createSignal<Favourites>({ titles: [], channels: [] });
export const favourites = state;

export const isFavouriteTitle = (id: string | undefined): boolean => Boolean(id) && state().titles.some((f) => f.title.id === id);
export const isFavouriteChannel = (id: string | null | undefined): boolean => Boolean(id) && state().channels.includes(id!);

/** Takes the Hub's answer, and marks the channels the guide and channel up/down use to match. */
function apply(f: Favourites): void {
  setState({ titles: f.titles, channels: f.channels });
  const set = new Set(f.channels);
  setChannels(channels().map((c) => (c.favourite === set.has(c.id) ? c : { ...c, favourite: set.has(c.id) })));
}

export async function loadFavourites(): Promise<void> {
  try {
    apply(await hub.favourites());
  } catch {
    // The Hub is away: keep what we had.
  }
}

/** Marks or unmarks it (`on` left out flips it), with a toast to say which. */
export async function setFavourite(input: FavouriteInput, name: string, quiet = false): Promise<FavouriteResult> {
  const r = await hub.favourite(input);
  apply(r);
  if (!quiet) toast(r.on ? `${name} added to Favourites` : `${name} taken out of Favourites`, r.on ? "good" : "info");
  return r;
}

export function toggleFavouriteTitle(title: TitleRef): void {
  void setFavourite({ title, on: !isFavouriteTitle(title.id) }, title.name).catch(errorToast);
}

export function toggleFavouriteChannel(channel: Pick<Channel, "id" | "name">): void {
  void setFavourite({ channel: channel.id, on: !isFavouriteChannel(channel.id) }, channel.name).catch(errorToast);
}

/** Loads them for each profile picked, and again when another device changes them. */
export function startFavourites(): void {
  createRoot(() => createEffect(on(() => profile()?.id, () => void loadFavourites())));
  onHubEvent((e) => {
    if (e.type === "favourites.changed" || e.type === "profiles.changed") void loadFavourites();
  });
}
