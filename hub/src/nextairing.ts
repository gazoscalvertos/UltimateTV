// When is a saved title next on telly? Matching "Saved for later" against the guide answers that
// so the saved card can say "On Film4 · Sat 21:00" and offer one-press Record or Remind (#74).
//
// There is no cache on purpose: the guide changes under us every few hours, and one indexed query
// over the saved names is cheaper than getting a stale answer wrong.

import type { NextAiring, WatchItem } from "@ultimatetv/shared";
import { clockTime, dayLabel, normaliseTitle } from "@ultimatetv/shared";
import type { ChannelStore } from "./channels.js";
import type { GuideStore } from "./epg.js";
import type { ContentFilter } from "./profiles.js";

/** How far ahead a saved title is looked for: about as far as the guide reaches. */
export const LOOK_AHEAD_MS = 14 * 86_400_000;

/** A film and its remake share a title; a year within one keeps them apart. */
function yearOk(saved: number | undefined, airing: number | undefined): boolean {
  if (!saved || !airing) return true;
  return Math.abs(saved - airing) <= 1;
}

export class NextAirings {
  constructor(
    private readonly guide: GuideStore,
    private readonly channels: ChannelStore,
  ) {}

  /**
   * The next airing of each saved title, keyed by watch item id. Titles match on their normalised
   * name ("The Office (UK)" and "Office" are the same programme), and a near miss never counts:
   * "Dune" does not match "Dune: Part Two".
   */
  find(items: WatchItem[], filter: ContentFilter, now = Date.now()): Map<string, NextAiring> {
    const out = new Map<string, NextAiring>();
    if (!items.length) return out;
    // Which saved items each normalised name belongs to (two profiles can save the same title).
    const byName = new Map<string, WatchItem[]>();
    for (const item of items) {
      const key = normaliseTitle(item.title?.name ?? item.name);
      if (!key) continue;
      const list = byName.get(key);
      if (list) list.push(item);
      else byName.set(key, [item]);
    }
    if (!byName.size) return out;
    const rows = this.guide.byTitles([...byName.keys()], now, now + LOOK_AHEAD_MS);
    if (!rows.length) return out;
    const channelName = new Map<string, string>();
    for (const p of rows) {
      const saved = byName.get(normaliseTitle(p.title));
      if (!saved) continue;
      const channel = this.channels.get(p.channelId);
      // Hidden channels, music video channels (nothing to record) and channels this profile can't
      // watch are all no use as a "next on TV".
      if (!channel || channel.hidden || channel.mix) continue;
      if (!filter.programme(p, channel)) continue;
      let name = channelName.get(channel.id);
      if (name === undefined) {
        name = channel.name;
        channelName.set(channel.id, name);
      }
      const airing: NextAiring = {
        programmeId: p.id,
        channelId: channel.id,
        channelName: name,
        channelNumber: channel.number,
        start: p.start,
        end: p.end,
        when: `On ${name} · ${dayLabel(p.start, now)} ${clockTime(p.start)}`,
      };
      for (const item of saved) {
        if (!yearOk(item.year ?? item.title?.year, p.year)) continue;
        const seen = out.get(item.id);
        if (seen && seen.start <= airing.start) continue;
        out.set(item.id, airing);
      }
    }
    return out;
  }

  /** Copies of these items carrying their next airing, for the TV, the phone and the API. */
  attach(items: WatchItem[], filter: ContentFilter, now = Date.now()): WatchItem[] {
    const found = this.find(items, filter, now);
    if (!found.size) return items;
    return items.map((item) => {
      const next = found.get(item.id);
      return next ? { ...item, next } : item;
    });
  }
}
