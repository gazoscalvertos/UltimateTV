// Collections and franchises (issue #238): Jellyfin/Emby BoxSets, Plex collections and TMDB's own
// collections ("The James Bond Collection") shown as a Collections row and on a film's page, with
// the films in release order and "Play next in collection".
//
// A collection is addressed as `collection:<where>` so it can ride in a TitleRef's id:
// `collection:jellyfin:abc` (a media server's), `collection:tmdb:645` (TMDB's).

import type { TitleRef } from "./domain.js";

export const COLLECTION_PREFIX = "collection:";

export const isCollectionId = (id: string): boolean => id.startsWith(COLLECTION_PREFIX);

/** A collection's id from where it lives: a media server's key ("jellyfin:abc") or `tmdb:<id>`. */
export const collectionIdOf = (key: string): string => `${COLLECTION_PREFIX}${key}`;

/** One collection, opened. The films are only those this profile may see, in order. */
export interface CollectionView {
  id: string;
  name: string;
  overview?: string;
  poster?: string;
  backdrop?: string;
  /** "library" when a media server has the collection; "tmdb" when it is TMDB's list of the franchise. */
  source: "library" | "tmdb";
  /** In release order. */
  films: CollectionFilmRef[];
  /** The film Play starts: the first one not watched yet, or the first one when all are. */
  next?: TitleRef;
}

export type CollectionFilmRef = TitleRef & {
  /** Seen on this profile (a media server's played mark, or the Hub's own record). */
  watched?: boolean;
};

/** What a film's page shows: the collection it belongs to, where this film sits, and what follows it. */
export interface TitleCollection {
  id: string;
  name: string;
  /** Where this film is among the visible films, counted from 0. */
  position: number;
  total: number;
  films: CollectionFilmRef[];
  /** The film after this one that has not been watched (the one Play next in collection starts). */
  next?: TitleRef;
}

/** A card for a collection on a row: it rides as a TitleRef so every row and list can show it. */
export function collectionCard(c: { id: string; name: string; poster?: string; backdrop?: string }, films: number): TitleRef {
  const ref: TitleRef = { id: c.id, kind: "movie", name: c.name, subtitle: films === 1 ? "1 film" : `${films} films`, badges: ["Collection"] };
  if (c.poster) ref.poster = c.poster;
  if (c.backdrop) ref.backdrop = c.backdrop;
  return ref;
}

/** Films in release order: by release date, else year, else name. Films with no date go last. */
export function releaseOrder<T extends { name: string; year?: number; released?: string }>(films: T[]): T[] {
  const key = (f: T): number => {
    const t = f.released ? Date.parse(f.released) : NaN;
    if (!Number.isNaN(t)) return t;
    return f.year ? Date.UTC(f.year, 6, 1) : Number.MAX_SAFE_INTEGER;
  };
  return [...films].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
}

/**
 * The film to play after `current`: the first one after it that has not been watched. When every
 * later film has been watched there is nothing to offer, so the next episode-style hand-over
 * never loops back to the start by itself.
 */
export function nextInCollection(films: CollectionFilmRef[], currentId: string): CollectionFilmRef | undefined {
  const at = films.findIndex((f) => f.id === currentId);
  return films.slice(at + 1).find((f) => !f.watched);
}

/** The film Play starts on the collection's page. */
export function firstToWatch(films: CollectionFilmRef[]): CollectionFilmRef | undefined {
  return films.find((f) => !f.watched) ?? films[0];
}
