// Watch progress for everything Jellyfin doesn't track itself (recordings, IPTV VOD, streams).

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
}

/** Over this fraction of the runtime counts as watched (credits). */
export const WATCHED_AT = 0.92;

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

  /** Part-watched items with a title, newest first, for Continue Watching. */
  continueWatching(limit = 20): ProgressEntry[] {
    return this.db
      .json<ProgressEntry>("SELECT data FROM progress WHERE watched = 0 AND position_ms > 60000 ORDER BY updated_at DESC LIMIT ?", limit * 2)
      .filter((p) => p.title)
      .slice(0, limit);
  }
}
