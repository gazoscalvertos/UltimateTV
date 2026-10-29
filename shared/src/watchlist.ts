// Watchlist matching, shared so the Hub (finding showings and recordings) and the TV (marking the
// guide's programme card) agree on what counts as the same film or show.

import type { Programme, WatchlistItem } from "./domain.js";
import { normaliseTitle } from "./text.js";

/** "Film: Dune" → "Dune". Some guides put "Film:" in front of every film's name. */
export function programmeName(title: string): string {
  return title.replace(/^film\s*:\s*/i, "").trim();
}

/**
 * True when a programme in the guide is the thing on the watchlist: the same series, or the same
 * name (a film's year has to agree too, when both are known, so a remake isn't mistaken for it).
 */
export function watchlistMatches(item: Pick<WatchlistItem, "name" | "seriesKey" | "film" | "year">, p: Pick<Programme, "title" | "seriesKey" | "year">): boolean {
  if (item.seriesKey && p.seriesKey === item.seriesKey) return true;
  if (normaliseTitle(programmeName(p.title)) !== normaliseTitle(item.name)) return false;
  if (item.film && item.year && p.year && Math.abs(item.year - p.year) > 1) return false;
  return true;
}
