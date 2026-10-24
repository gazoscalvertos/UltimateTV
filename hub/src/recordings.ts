// Recording, series link and reminder storage, plus library naming for finished recordings.

import path from "node:path";
import type { Programme, Recording, Reminder, SeriesLink } from "@ultimatetv/shared";
import { safeFileName } from "@ultimatetv/shared";
import type { Db } from "./db.js";

export class RecordingStore {
  constructor(private db: Db) {}

  save(r: Recording): Recording {
    this.db.run(
      "INSERT INTO recordings (id, status, start, end, series_link_id, episode_key, programme_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, start = excluded.start, end = excluded.end, series_link_id = excluded.series_link_id, episode_key = excluded.episode_key, programme_id = excluded.programme_id, data = excluded.data",
      r.id,
      r.status,
      r.start,
      r.end,
      r.seriesLinkId ?? null,
      r.programme.episodeKey ?? null,
      r.programme.id,
      JSON.stringify(r),
    );
    return r;
  }

  get(id: string): Recording | undefined {
    return this.db.jsonOne<Recording>("SELECT data FROM recordings WHERE id = ?", id);
  }

  list(): Recording[] {
    return this.db.json<Recording>("SELECT data FROM recordings ORDER BY start DESC");
  }

  withStatus(...statuses: Recording["status"][]): Recording[] {
    return this.db.json<Recording>(`SELECT data FROM recordings WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY start`, ...statuses);
  }

  forProgramme(programmeId: string): Recording | undefined {
    return this.db.jsonOne<Recording>("SELECT data FROM recordings WHERE programme_id = ? AND status NOT IN ('cancelled', 'failed') ORDER BY start DESC", programmeId);
  }

  forLink(linkId: string): Recording[] {
    return this.db.json<Recording>("SELECT data FROM recordings WHERE series_link_id = ? ORDER BY start", linkId);
  }

  delete(id: string): void {
    this.db.run("DELETE FROM recordings WHERE id = ?", id);
  }

  // Series links

  links(): SeriesLink[] {
    return this.db.json<SeriesLink>("SELECT data FROM series_links");
  }

  link(id: string): SeriesLink | undefined {
    return this.db.jsonOne<SeriesLink>("SELECT data FROM series_links WHERE id = ?", id);
  }

  linkForSeries(seriesKey: string): SeriesLink | undefined {
    return this.db.jsonOne<SeriesLink>("SELECT data FROM series_links WHERE series_key = ?", seriesKey);
  }

  saveLink(l: SeriesLink): SeriesLink {
    this.db.run("INSERT INTO series_links (id, series_key, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET series_key = excluded.series_key, data = excluded.data", l.id, l.seriesKey, JSON.stringify(l));
    return l;
  }

  deleteLink(id: string): void {
    this.db.run("DELETE FROM series_links WHERE id = ?", id);
  }

  // Reminders

  reminders(): Reminder[] {
    return this.db.json<Reminder>("SELECT data FROM reminders ORDER BY start");
  }

  saveReminder(r: Reminder): void {
    this.db.run("INSERT OR REPLACE INTO reminders (id, start, data) VALUES (?, ?, ?)", r.id, r.programme.start, JSON.stringify(r));
  }

  deleteReminder(id: string): void {
    this.db.run("DELETE FROM reminders WHERE id = ?", id);
  }
}

/** Where a finished recording goes, in Jellyfin's naming so it lands in the right library. */
export function recordingPath(root: string, p: Programme): string {
  const title = safeFileName(p.title.replace(/^(new|film)\s*:\s*/i, "")) || "Recording";
  if (p.isFilm) {
    const name = p.year ? `${title} (${p.year})` : title;
    return path.join(root, "Films", name, `${name}.mkv`);
  }
  const day = new Date(p.start);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  if (p.season !== undefined && p.episode !== undefined) {
    const se = `S${String(p.season).padStart(2, "0")}E${String(p.episode).padStart(2, "0")}`;
    const sub = p.subtitle ? ` - ${safeFileName(p.subtitle)}` : "";
    return path.join(root, title, `Season ${String(p.season).padStart(2, "0")}`, `${title} - ${se}${sub}.mkv`);
  }
  // No episode numbers: date-based naming, which Jellyfin also understands.
  const sub = p.subtitle ? ` - ${safeFileName(p.subtitle)}` : "";
  return path.join(root, title, `${title} - ${date}${sub}.mkv`);
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A Kodi/Jellyfin NFO so the recording shows with its guide description before any metadata lookup. */
export function nfoFor(p: Programme, channelName: string): string {
  const aired = new Date(p.start).toISOString().slice(0, 10);
  if (p.isFilm) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>${xml(p.title)}</title>
  ${p.year ? `<year>${p.year}</year>` : ""}
  <plot>${xml(p.description ?? "")}</plot>
  <studio>${xml(channelName)}</studio>
  ${p.categories.map((c) => `<genre>${xml(c)}</genre>`).join("")}
</movie>
`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<episodedetails>
  <title>${xml(p.subtitle ?? p.title)}</title>
  <showtitle>${xml(p.title)}</showtitle>
  ${p.season !== undefined ? `<season>${p.season}</season>` : ""}
  ${p.episode !== undefined ? `<episode>${p.episode}</episode>` : ""}
  <aired>${aired}</aired>
  <plot>${xml(p.description ?? "")}</plot>
  <studio>${xml(channelName)}</studio>
</episodedetails>
`;
}
