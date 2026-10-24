// Guide storage and queries: time windows for the grid, now/next, series airings and search.

import type { Channel, Programme } from "@ultimatetv/shared";
import { normaliseChannelName, normaliseTitle } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import { episodeIdentity, type XmltvChannel, type XmltvProgramme } from "./ingest/xmltv.js";

const FILM = /\b(film|movie)s?\b/i;

export function programmeId(channelId: string, start: number): string {
  return `${channelId}:${start}`;
}

export function toProgramme(channelId: string, p: XmltvProgramme): Programme {
  const ident = episodeIdentity(p);
  const prog: Programme = {
    id: programmeId(channelId, p.start),
    channelId,
    start: p.start,
    end: p.end,
    title: p.title,
    categories: p.categories,
    isNew: p.isNew,
    isRepeat: p.previouslyShown,
    isFilm: p.categories.some((c) => FILM.test(c)),
    seriesKey: ident.seriesKey,
  };
  if (p.subtitle) prog.subtitle = p.subtitle;
  if (p.description) prog.description = p.description;
  if (ident.season !== undefined) prog.season = ident.season;
  if (ident.episode !== undefined) prog.episode = ident.episode;
  if (ident.episodeKey) prog.episodeKey = ident.episodeKey;
  if (p.icon) prog.image = p.icon;
  if (p.year) prog.year = p.year;
  if (p.rating) prog.rating = p.rating;
  return prog;
}

/**
 * Maps XMLTV channel ids to our channels: by tvg-id first, then by display name, so playlists
 * without tvg-ids still get a guide.
 */
export class EpgMatcher {
  private byEpgId = new Map<string, string[]>();
  private byName = new Map<string, string[]>();
  private xmltvToChannels = new Map<string, string[]>();

  constructor(channels: Channel[]) {
    for (const c of channels) {
      if (c.epgId) push(this.byEpgId, c.epgId.toLowerCase(), c.id);
      push(this.byName, normaliseChannelName(c.name), c.id);
    }
  }

  addXmltvChannel(c: XmltvChannel): void {
    const ids = new Set<string>(this.byEpgId.get(c.id.toLowerCase()) ?? []);
    if (ids.size === 0) {
      for (const n of c.names) for (const id of this.byName.get(normaliseChannelName(n)) ?? []) ids.add(id);
    }
    if (ids.size > 0) this.xmltvToChannels.set(c.id, [...ids]);
  }

  channelsFor(xmltvId: string): string[] {
    return this.xmltvToChannels.get(xmltvId) ?? this.byEpgId.get(xmltvId.toLowerCase()) ?? [];
  }
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export class GuideStore {
  constructor(private db: Db) {}

  /** Writes a batch of programmes, replacing any that start at the same time on the same channel. */
  upsert(programmes: Programme[], run = 0): void {
    this.db.transaction(() => {
      for (const p of programmes) {
        this.db.run(
          "INSERT OR REPLACE INTO programmes (id, channel_id, start, end, title_norm, series_key, run, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          p.id,
          p.channelId,
          p.start,
          p.end,
          normaliseTitle(p.title),
          p.seriesKey ?? null,
          run,
          JSON.stringify(p),
        );
      }
    });
  }

  /** Drops programmes older than the catch-up window and those for channels that no longer exist. */
  prune(before: number): void {
    this.db.run("DELETE FROM programmes WHERE end < ?", before);
    this.db.run("DELETE FROM programmes WHERE channel_id NOT IN (SELECT id FROM channels)");
  }

  /** After an import, removes future programmes the import didn't include (cancelled or moved shows). */
  dropStale(channelIds: Iterable<string>, run: number, from: number): void {
    this.db.transaction(() => {
      for (const id of channelIds) this.db.run("DELETE FROM programmes WHERE channel_id = ? AND start >= ? AND run != ?", id, from, run);
    });
  }

  window(channelIds: string[], from: number, to: number): Record<string, Programme[]> {
    const result: Record<string, Programme[]> = {};
    for (const id of channelIds) result[id] = [];
    if (channelIds.length === 0) return result;
    const placeholders = channelIds.map(() => "?").join(",");
    const rows = this.db.json<Programme>(
      `SELECT data FROM programmes WHERE channel_id IN (${placeholders}) AND end > ? AND start < ? ORDER BY start`,
      ...channelIds,
      from,
      to,
    );
    for (const p of rows) result[p.channelId]?.push(p);
    return result;
  }

  nowNext(channelId: string, at = Date.now()): { now?: Programme; next?: Programme } {
    const rows = this.db.json<Programme>("SELECT data FROM programmes WHERE channel_id = ? AND end > ? ORDER BY start LIMIT 2", channelId, at);
    const result: { now?: Programme; next?: Programme } = {};
    const [a, b] = rows;
    if (a && a.start <= at) {
      result.now = a;
      if (b) result.next = b;
    } else if (a) {
      result.next = a;
    }
    return result;
  }

  get(id: string): Programme | undefined {
    return this.db.jsonOne<Programme>("SELECT data FROM programmes WHERE id = ?", id);
  }

  /** Programmes on one channel from `from`, for the mini guide's left/right browsing. */
  onChannel(channelId: string, from: number, limit = 12): Programme[] {
    return this.db.json<Programme>("SELECT data FROM programmes WHERE channel_id = ? AND end > ? ORDER BY start LIMIT ?", channelId, from, limit);
  }

  airings(seriesKey: string, from: number, to = from + 14 * 86_400_000): Programme[] {
    return this.db.json<Programme>("SELECT data FROM programmes WHERE series_key = ? AND start >= ? AND start < ? ORDER BY start", seriesKey, from, to);
  }

  /** All upcoming programmes in a time range (for the series link planner). */
  between(from: number, to: number): Programme[] {
    return this.db.json<Programme>("SELECT data FROM programmes WHERE start >= ? AND start < ? ORDER BY start", from, to);
  }

  search(query: string, from: number, to: number, limit = 40): Programme[] {
    const q = `%${normaliseTitle(query)}%`;
    return this.db.json<Programme>(
      "SELECT p.data FROM programmes p JOIN channels c ON c.id = p.channel_id WHERE c.hidden = 0 AND p.title_norm LIKE ? AND p.end > ? AND p.start < ? ORDER BY p.start LIMIT ?",
      q,
      from,
      to,
      limit,
    );
  }

  /** Films starting in a time range, for "Films for tonight". */
  films(from: number, to: number, limit = 20): Programme[] {
    return this.db
      .json<Programme>(
        "SELECT p.data FROM programmes p JOIN channels c ON c.id = p.channel_id WHERE c.hidden = 0 AND p.start >= ? AND p.start < ? ORDER BY p.start",
        from,
        to,
      )
      .filter((p) => p.isFilm)
      .slice(0, limit);
  }

  count(): number {
    return Number(this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM programmes")?.n ?? 0);
  }
}
