// SQLite storage (Node's built-in node:sqlite, so the image needs no native modules).
// Most rows keep their full object as JSON in `data`, with the columns we filter on alongside.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE channels (
    id TEXT PRIMARY KEY, number INTEGER NOT NULL, name TEXT NOT NULL, epg_id TEXT,
    hidden INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
  );
  CREATE INDEX channels_number ON channels(number);
  CREATE TABLE feeds (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, source_id TEXT NOT NULL, upstream_id TEXT NOT NULL,
    url TEXT NOT NULL, priority INTEGER NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX feeds_channel ON feeds(channel_id, priority);
  CREATE TABLE programmes (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
    title_norm TEXT NOT NULL, series_key TEXT, run INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
  );
  CREATE INDEX programmes_channel_time ON programmes(channel_id, start);
  CREATE INDEX programmes_time ON programmes(start);
  CREATE INDEX programmes_series ON programmes(series_key);
  CREATE TABLE series_links (id TEXT PRIMARY KEY, series_key TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE recordings (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
    series_link_id TEXT, episode_key TEXT, programme_id TEXT, data TEXT NOT NULL
  );
  CREATE INDEX recordings_status ON recordings(status, start);
  CREATE TABLE reminders (id TEXT PRIMARY KEY, start INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE TABLE progress (
    key TEXT PRIMARY KEY, position_ms INTEGER NOT NULL, duration_ms INTEGER, watched INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX progress_updated ON progress(updated_at);
  CREATE TABLE downloads (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE vod (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT NOT NULL, name_norm TEXT NOT NULL, year INTEGER,
    data TEXT NOT NULL
  );
  CREATE INDEX vod_name ON vod(name_norm);
  `,
  // Music video channels. Their guide rows live in `channels` too (kind 'mix'), so an IPTV refresh,
  // which replaces the IPTV channels, leaves them alone.
  `
  ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'iptv';
  CREATE TABLE mix_channels (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE mix_videos (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE mix_entries (
    channel_id TEXT NOT NULL, video_id TEXT NOT NULL, origin TEXT NOT NULL, added_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, video_id)
  );
  CREATE INDEX mix_entries_video ON mix_entries(video_id);
  `,
];

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly sql: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    const version = Number((this.sql.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.sql.exec(MIGRATIONS[v]!);
        this.sql.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  transaction<T>(fn: () => T): T {
    this.sql.exec("BEGIN");
    try {
      const result = fn();
      this.sql.exec("COMMIT");
      return result;
    } catch (err) {
      this.sql.exec("ROLLBACK");
      throw err;
    }
  }

  all<T = Row>(query: string, ...params: SQLInputValue[]): T[] {
    return this.sql.prepare(query).all(...params) as T[];
  }

  get<T = Row>(query: string, ...params: SQLInputValue[]): T | undefined {
    return this.sql.prepare(query).get(...params) as T | undefined;
  }

  run(query: string, ...params: SQLInputValue[]): void {
    this.sql.prepare(query).run(...params);
  }

  /** Parses the `data` column of each row. */
  json<T>(query: string, ...params: SQLInputValue[]): T[] {
    return this.all<{ data: string }>(query, ...params).map((r) => JSON.parse(r.data) as T);
  }

  jsonOne<T>(query: string, ...params: SQLInputValue[]): T | undefined {
    const row = this.get<{ data: string }>(query, ...params);
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  getKv<T>(key: string): T | undefined {
    const row = this.get<{ value: string }>("SELECT value FROM kv WHERE key = ?", key);
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  setKv(key: string, value: unknown): void {
    this.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }

  cacheGet<T>(key: string, now = Date.now()): T | undefined {
    const row = this.get<{ value: string; expires: number }>("SELECT value, expires FROM cache WHERE key = ?", key);
    if (!row || row.expires < now) return undefined;
    return JSON.parse(row.value) as T;
  }

  cacheSet(key: string, value: unknown, ttlMs: number, now = Date.now()): void {
    this.run(
      "INSERT INTO cache (key, value, expires) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires = excluded.expires",
      key,
      JSON.stringify(value),
      now + ttlMs,
    );
  }

  close(): void {
    this.sql.close();
  }
}

export function newId(prefix = ""): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
