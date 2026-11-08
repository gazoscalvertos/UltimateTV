// Films and TV pages are built from several sources (the media server, the online catalogue, the
// IPTV provider), so the same title turns up twice in a row, or in nearly every row. This keeps
// each title once per row, and in at most a few rows overall, so a small library still looks full.

import { normaliseTitle } from "@ultimatetv/shared";
import type { Rail, TitleRef } from "@ultimatetv/shared";

export interface DedupeOptions {
  /** The most rows one title may appear in (first rows win). */
  maxRows: number;
  /** Rows that are exempt from the cap (they're about a specific list, e.g. "Watch again"). */
  exempt?: ReadonlySet<string>;
  /** A capped row left with fewer titles than this is dropped. */
  minRow?: number;
}

/** The same title from any source: kind, plain name and (when both know it) the year. */
export const titleKey = (t: Pick<TitleRef, "kind" | "name">): string => `${t.kind}|${normaliseTitle(t.name)}`;

export function dedupeRails(rails: Rail[], opts: DedupeOptions): Rail[] {
  const minRow = opts.minRow ?? 3;
  const uses = new Map<string, number>();
  const out: Rail[] = [];
  for (const r of rails) {
    if (r.kind !== "titles" || !r.items) {
      out.push(r);
      continue;
    }
    const exempt = opts.exempt?.has(r.id) ?? false;
    const inRow = new Set<string>();
    const items: TitleRef[] = [];
    for (const t of r.items) {
      const k = titleKey(t);
      if (inRow.has(k)) continue;
      if (!exempt && (uses.get(k) ?? 0) >= opts.maxRows) continue;
      inRow.add(k);
      items.push(t);
    }
    if (!exempt && items.length < minRow && items.length < r.items.length) continue;
    if (!exempt) for (const k of inRow) uses.set(k, (uses.get(k) ?? 0) + 1);
    out.push({ ...r, items });
  }
  return out;
}
