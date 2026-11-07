// The extra rows on the Kids profile's Films and TV Shows pages: genres, age bands, top rated, and
// "Best of 2026 / 2025 / ..." built from the library itself. Everything here is pure: the caller
// passes titles that have already been through the profile's rating limit and allow list, so no
// row can show anything the profile couldn't open.

import type { Rail, TitleRef } from "@ultimatetv/shared";

export interface KidsCandidate {
  ref: TitleRef;
  year?: number;
  /** Community rating, 0-10. */
  rating?: number;
  genres: string[];
  watched: boolean;
  lastPlayed?: string;
}

export interface KidsRailOptions {
  /** The current year; "Best of" rows count back from it. */
  thisYear: number;
  /** How many years back "Best of" goes (default 8). */
  years?: number;
  /** Titles per row (default 20). */
  perRow?: number;
  /** A row with fewer titles than this is left out (default 3). */
  minRow?: number;
}

/** A row of genres: any title with one of these (case-insensitive, whole word) lands in it. */
const GENRE_ROWS: { id: string; title: string; any: string[] }[] = [
  { id: "animation", title: "Animation", any: ["animation", "anime"] },
  { id: "adventure", title: "Adventure", any: ["adventure", "action & adventure"] },
  { id: "comedy", title: "Comedy", any: ["comedy"] },
  { id: "family", title: "Family", any: ["family"] },
  { id: "fantasy", title: "Fantasy and magic", any: ["fantasy", "sci-fi & fantasy"] },
  { id: "heroes", title: "Superheroes and action", any: ["action", "superhero", "sci-fi", "science fiction"] },
  { id: "animals", title: "Animals and nature", any: ["animals", "nature", "documentary", "wildlife"] },
  { id: "musicals", title: "Musicals and music", any: ["music", "musical"] },
  { id: "mystery", title: "Mystery", any: ["mystery"] },
];

/** UK and US certificates that mean "for the youngest", and "for the middle band". */
const LITTLE = new Set(["u", "uc", "g", "tv-y", "tv-g", "all", "0"]);
const MIDDLE = new Set(["pg", "tv-y7", "tv-y7-fv", "tv-pg", "6", "7"]);

const hasGenre = (c: KidsCandidate, any: string[]): boolean => c.genres.some((g) => any.includes(g.toLowerCase()));
const byRating = (a: KidsCandidate, b: KidsCandidate) => (b.rating ?? 0) - (a.rating ?? 0);

/**
 * The rows, in the order they're shown: top rated, age bands, genres, watch again, then the "Best
 * of" years newest first. `candidates` should be newest-added first.
 */
export function buildKidsRails(kind: "movie" | "series", candidates: KidsCandidate[], opts: KidsRailOptions): Rail[] {
  const perRow = opts.perRow ?? 20;
  const minRow = opts.minRow ?? 3;
  const rails: Rail[] = [];
  const add = (id: string, title: string, list: KidsCandidate[]) => {
    if (list.length >= minRow) rails.push({ id, title, kind: "titles", items: list.slice(0, perRow).map((c) => c.ref) });
  };
  const noun = kind === "movie" ? "films" : "shows";

  add("kids-top", `Top rated ${noun}`, candidates.filter((c) => (c.rating ?? 0) >= 6.5).sort(byRating));
  add("kids-new", "New additions you haven't seen", candidates.filter((c) => !c.watched));

  const cert = (c: KidsCandidate) => (c.ref.certification ?? "").toLowerCase();
  add("kids-little", "For little ones", candidates.filter((c) => LITTLE.has(cert(c))));
  add("kids-middle", "For bigger kids (PG)", candidates.filter((c) => MIDDLE.has(cert(c))));

  for (const g of GENRE_ROWS) add(`kids-genre-${g.id}`, g.title, candidates.filter((c) => hasGenre(c, g.any)));

  add(
    "kids-again",
    "Watch again",
    candidates.filter((c) => c.watched).sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "")),
  );

  for (let i = 0; i < (opts.years ?? 8); i++) {
    const y = opts.thisYear - i;
    add(`bestof-${y}`, `Best of ${y}`, candidates.filter((c) => c.year === y).sort(byRating));
  }
  return rails;
}
