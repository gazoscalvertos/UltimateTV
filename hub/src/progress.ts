// Watch progress for everything played on the TV: what Jellyfin doesn't track itself (IPTV VOD,
// online streams), and Jellyfin items too, so Continue watching still has them when Jellyfin's own
// resume list leaves them out (under 5% watched, say).

import type { TitleRef } from "@ultimatetv/shared";
import type { Db } from "./db.js";

export interface ProgressEntry {
  key: string;
  positionMs: number;
  durationMs?: number;
  watched: boolean;
  updatedAt: number;
  title?: TitleRef;
  /** What to play to resume (a PlaybackRequest serialised by the UI). */
  resume?: { kind: string; id: string; episodeId?: string; streamId?: string };
  /** For an episode: which one (`s2e5`), and the one after it, for when this one is finished. */
  episodeId?: string;
  next?: { episodeId: string; name?: string };
}

/** Over this fraction of the runtime counts as watched (credits), as Jellyfin does. */
export const WATCHED_AT = 0.9;
/** Less than this is a peek, not something to carry on with. */
export const MIN_RESUME_MS = 60_000;
/** A finished episode offers the next one in Continue watching for this long. */
const NEXT_EPISODE_FOR_MS = 60 * 86_400_000;

/** A row of Continue watching: the title, where it's up to, and when it was last played. */
export interface ContinueItem {
  title: TitleRef;
  entry: ProgressEntry;
  /** "resume" carries on part way through; "next" starts the episode after a finished one. */
  mode: "resume" | "next";
}

/** The episode in a progress key (`title:tmdb:series:1|s2e5`) or entry. */
export function episodeOf(e: Pick<ProgressEntry, "key" | "episodeId">): string | undefined {
  return e.episodeId ?? /\|(s\d+e\d+)$/i.exec(e.key)?.[1]?.toLowerCase();
}

export class ProgressStore {
  constructor(private db: Db) {}

  get(key: string): ProgressEntry | undefined {
    return this.db.jsonOne<ProgressEntry>("SELECT data FROM progress WHERE key = ?", key);
  }

  save(entry: Omit<ProgressEntry, "updatedAt" | "watched"> & { watched?: boolean }, now = Date.now()): ProgressEntry {
    const prev = this.get(entry.key);
    const watched = entry.watched ?? (entry.durationMs ? entry.positionMs / entry.durationMs >= WATCHED_AT : false);
    const next: ProgressEntry = { ...prev, ...entry, watched, updatedAt: now };
    if (watched) next.positionMs = 0;
    this.db.run(
      "INSERT INTO progress (key, position_ms, duration_ms, watched, updated_at, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET position_ms = excluded.position_ms, duration_ms = excluded.duration_ms, watched = excluded.watched, updated_at = excluded.updated_at, data = excluded.data",
      next.key,
      next.positionMs,
      next.durationMs ?? null,
      next.watched ? 1 : 0,
      now,
      JSON.stringify(next),
    );
    return next;
  }

  /** The latest things played that have a title, watched or not, newest first ("Because you watched"). */
  recent(limit = 5): ProgressEntry[] {
    return this.db
      .json<ProgressEntry>("SELECT data FROM progress WHERE position_ms > 300000 OR watched = 1 ORDER BY updated_at DESC LIMIT ?", limit * 4)
      .filter((p) => p.title && !p.key.startsWith("link:") && !p.key.startsWith("recording:"))
      .slice(0, limit);
  }

  /** Titled entries, newest first (links and recordings have their own places). */
  private titled(limit: number): ProgressEntry[] {
    return this.db
      .json<ProgressEntry>("SELECT data FROM progress ORDER BY updated_at DESC LIMIT ?", limit)
      .filter((p) => p.title && !p.key.startsWith("link:") && !p.key.startsWith("recording:"));
  }

  /**
   * Continue watching, newest first, one row per title: a film or episode stopped part way, or
   * for a series whose latest episode was finished, the next one. Finished films drop off.
   */
  continueWatching(limit = 20, now = Date.now()): ContinueItem[] {
    const seen = new Set<string>();
    const out: ContinueItem[] = [];
    for (const entry of this.titled(Math.max(200, limit * 10))) {
      const t = entry.title!;
      if (seen.has(t.id)) continue;
      const episodeId = episodeOf(entry);
      // A peek (under a minute, not finished) doesn't count: an older episode stopped part way stays.
      if (!entry.watched && entry.positionMs < MIN_RESUME_MS) continue;
      seen.add(t.id);
      if (!entry.watched) {
        const title: TitleRef = { ...t, progress: entry.durationMs ? entry.positionMs / entry.durationMs : 0 };
        if (episodeId) {
          title.episodeId = episodeId;
          title.subtitle = episodeSubtitle(episodeId, t.subtitle);
        }
        out.push({ title, entry, mode: "resume" });
      } else if (entry.watched && t.kind === "series" && entry.next && now - entry.updatedAt < NEXT_EPISODE_FOR_MS) {
        const { progress: _, ...rest } = t;
        out.push({ title: { ...rest, episodeId: entry.next.episodeId, subtitle: `Next: ${entry.next.name ?? episodeSubtitle(entry.next.episodeId)}` }, entry, mode: "next" });
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Where a series is up to on this Hub: the episode last played part way (and how far), or the
   * one after the latest finished. Undefined when nothing of it has been played here.
   */
  seriesResume(titleId: string): { episodeId: string; positionMs: number } | undefined {
    const latest = this.titled(500).find((e) => e.title!.id === titleId && episodeOf(e));
    if (!latest) return undefined;
    if (!latest.watched) return { episodeId: episodeOf(latest)!, positionMs: latest.positionMs >= MIN_RESUME_MS ? latest.positionMs : 0 };
    return latest.next ? { episodeId: latest.next.episodeId, positionMs: 0 } : undefined;
  }

  /** How far each episode of a series got on this Hub, by `s2e5`. */
  episodes(titleId: string): Map<string, ProgressEntry> {
    const map = new Map<string, ProgressEntry>();
    for (const e of this.titled(2000)) {
      const ep = e.title!.id === titleId ? episodeOf(e) : undefined;
      if (ep && !map.has(ep)) map.set(ep, e);
    }
    return map;
  }
}

/** "S2 E5", keeping an episode name from a subtitle that already starts with the same label. */
function episodeSubtitle(episodeId: string, existing?: string): string {
  const m = /^s(\d+)e(\d+)$/i.exec(episodeId);
  const label = m ? `S${Number(m[1])} E${Number(m[2])}` : episodeId;
  return existing?.startsWith(label) ? existing : label;
}
