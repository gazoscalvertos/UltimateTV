// What each profile has already seen, so suggestions can leave it out or put it last.
//
// Three sources feed it:
//   - the TV's own playback: a title played to the end (or started for a while) on a profile is
//     noted for that profile only, whatever the title's id looks like (Jellyfin, Plex, Emby, TMDB,
//     IPTV), because titles are matched by id and by name and year;
//   - the media servers' played flags, synced now and then, which also covers titles watched on
//     other devices (the servers keep one viewer, so these count for every profile);
//   - "Mark as watched" on Continue watching.
//
// The Continue watching row is not touched by any of this: a part-watched title stays there. Only
// suggestion rows ask `lookup()` whether to hold a title back.

import type { TitleKind, TitleRef } from "@ultimatetv/shared";
import { normaliseTitle } from "@ultimatetv/shared";
import type { Db } from "./db.js";

/** What happens to titles already seen in a suggestion row. */
export type SeenMode = "end" | "hide" | "off";

export const SEEN_MODES: readonly SeenMode[] = ["end", "hide", "off"];

export const cleanSeenMode = (v: unknown): SeenMode => (SEEN_MODES as readonly unknown[]).includes(v) ? (v as SeenMode) : "end";

interface SeenEntry {
  at: number;
  year?: number;
  ids: string[];
}

type SeenMap = Record<string, SeenEntry>;

/** The part of a title that identifies it. */
export type SeenRef = Pick<TitleRef, "id" | "kind" | "name"> & { year?: number | undefined };

export type SeenLookup = (ref: SeenRef) => boolean;

const MAX_ENTRIES = 4000;
const MAX_IDS = 4;
const HOUSEHOLD = "household";
const SERVER = "watched-titles:server";

const nameKey = (kind: TitleKind, name: string) => `${kind}|${normaliseTitle(name)}`;

/** Years in two catalogues can differ by one (release against premiere). */
const sameYear = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined || Math.abs(a - b) <= 1;

export class WatchedTitles {
  constructor(private readonly db: Db) {}

  private key(profileId: string | null) {
    return `watched-titles:${profileId ?? HOUSEHOLD}`;
  }

  private read(key: string): SeenMap {
    return this.db.getKv<SeenMap>(key) ?? {};
  }

  private write(key: string, map: SeenMap): void {
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].at - a[1].at);
      map = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    this.db.setKv(key, map);
  }

  private add(map: SeenMap, ref: SeenRef, at: number): void {
    if (!ref.name || (ref.kind !== "movie" && ref.kind !== "series")) return;
    const k = nameKey(ref.kind, ref.name);
    if (!k.split("|")[1]) return;
    const prev = map[k];
    const ids = [ref.id, ...(prev?.ids ?? [])].filter((id, i, all) => id && all.indexOf(id) === i).slice(0, MAX_IDS);
    const year = ref.year ?? prev?.year;
    map[k] = { at: Math.max(at, prev?.at ?? 0), ids, ...(year ? { year } : {}) };
  }

  /** Notes that this profile has seen a title (finished it, or watched a good part of it). */
  mark(profileId: string | null, ref: SeenRef, at = Date.now()): void {
    const key = this.key(profileId);
    const map = this.read(key);
    this.add(map, ref, at);
    this.write(key, map);
  }

  /** "Not watched" from Continue watching: forgotten for this profile and for the media servers' list. */
  unmark(profileId: string | null, ref: SeenRef): void {
    const k = nameKey(ref.kind, ref.name);
    for (const key of [this.key(profileId), SERVER]) {
      const map = this.read(key);
      if (map[k]) {
        delete map[k];
        this.write(key, map);
      }
    }
  }

  /** Replaces what the media servers say is played (all of it, so an unplayed title drops out). */
  setServerPlayed(refs: SeenRef[], at = Date.now()): void {
    const map: SeenMap = {};
    for (const r of refs) this.add(map, r, at);
    this.db.setKv(SERVER, map);
  }

  /** How many titles the media servers last said were played (for diagnostics and tests). */
  serverCount(): number {
    return Object.keys(this.read(SERVER)).length;
  }

  /** Whether a title is one this profile has seen: here, or on any device the media servers know of. */
  lookup(profileId: string | null): SeenLookup {
    const maps = [this.read(this.key(profileId)), this.read(SERVER)];
    if (profileId) maps.push(this.read(this.key(null)));
    const ids = new Set(maps.flatMap((m) => Object.values(m).flatMap((e) => e.ids)));
    return (ref) => {
      if (ids.has(ref.id)) return true;
      if (!ref.name || (ref.kind !== "movie" && ref.kind !== "series")) return false;
      const k = nameKey(ref.kind, ref.name);
      return maps.some((m) => {
        const e = m[k];
        return e !== undefined && sameYear(e.year, ref.year);
      });
    };
  }
}

/**
 * Holds seen titles back in a list of suggestions. `end` keeps them but moves them behind the rest
 * (in their order), `hide` drops them, `off` leaves the list alone. A row left empty is not shown.
 */
export function deprioritise<T>(items: T[], seen: (item: T) => boolean, mode: SeenMode): T[] {
  if (mode === "off" || items.length === 0) return items;
  const fresh: T[] = [];
  const old: T[] = [];
  for (const item of items) (seen(item) ? old : fresh).push(item);
  if (old.length === 0) return items;
  return mode === "hide" ? fresh : [...fresh, ...old];
}
