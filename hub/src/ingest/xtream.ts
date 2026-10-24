// Xtream Codes API client (player_api.php). Credentials never leave the Hub.

import type { XtreamSource } from "@ultimatetv/shared";
import { fetchJson, type Fetch } from "../http.js";

export interface XtreamCategory {
  category_id: string;
  category_name: string;
}

export interface XtreamLiveStream {
  num?: number;
  name: string;
  stream_id: number;
  stream_icon?: string;
  epg_channel_id?: string | null;
  category_id?: string;
  tv_archive?: number | string;
  tv_archive_duration?: number | string;
}

export interface XtreamVodStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  rating?: string | number;
  category_id?: string;
  container_extension?: string;
  tmdb?: string | number;
  added?: string;
  year?: string | number;
}

export interface XtreamSeries {
  series_id: number;
  name: string;
  cover?: string;
  plot?: string;
  releaseDate?: string;
  category_id?: string;
  tmdb?: string | number;
  rating?: string | number;
  backdrop_path?: string[];
}

export interface XtreamEpisode {
  id: string;
  episode_num: number | string;
  title?: string;
  container_extension?: string;
  season?: number;
  info?: { plot?: string; movie_image?: string; duration_secs?: number; releasedate?: string; air_date?: string };
}

export interface XtreamSeriesInfo {
  info?: { name?: string; plot?: string; cover?: string; tmdb?: string | number };
  episodes?: Record<string, XtreamEpisode[]>;
}

export interface XtreamAuth {
  user_info?: { auth?: number; status?: string; exp_date?: string | null; max_connections?: string | number; active_cons?: string | number };
  server_info?: { timezone?: string; url?: string; port?: string; server_protocol?: string };
}

export class XtreamClient {
  constructor(
    readonly source: XtreamSource,
    private fetchImpl: Fetch = fetch,
  ) {}

  private get base(): string {
    return this.source.url.replace(/\/+$/, "");
  }

  private api(action?: string, params: Record<string, string | number> = {}): string {
    const q = new URLSearchParams({ username: this.source.username, password: this.source.password });
    if (action) q.set("action", action);
    for (const [k, v] of Object.entries(params)) q.set(k, String(v));
    return `${this.base}/player_api.php?${q}`;
  }

  auth(): Promise<XtreamAuth> {
    return fetchJson<XtreamAuth>(this.api(), this.fetchImpl);
  }

  liveCategories(): Promise<XtreamCategory[]> {
    return fetchJson<XtreamCategory[]>(this.api("get_live_categories"), this.fetchImpl);
  }

  liveStreams(): Promise<XtreamLiveStream[]> {
    return fetchJson<XtreamLiveStream[]>(this.api("get_live_streams"), this.fetchImpl);
  }

  vodCategories(): Promise<XtreamCategory[]> {
    return fetchJson<XtreamCategory[]>(this.api("get_vod_categories"), this.fetchImpl);
  }

  vodStreams(): Promise<XtreamVodStream[]> {
    return fetchJson<XtreamVodStream[]>(this.api("get_vod_streams"), this.fetchImpl);
  }

  vodInfo(id: number | string): Promise<{ info?: Record<string, unknown>; movie_data?: XtreamVodStream }> {
    return fetchJson(this.api("get_vod_info", { vod_id: id }), this.fetchImpl);
  }

  series(): Promise<XtreamSeries[]> {
    return fetchJson<XtreamSeries[]>(this.api("get_series"), this.fetchImpl);
  }

  seriesInfo(id: number | string): Promise<XtreamSeriesInfo> {
    return fetchJson<XtreamSeriesInfo>(this.api("get_series_info", { series_id: id }), this.fetchImpl);
  }

  xmltvUrl(): string {
    const q = new URLSearchParams({ username: this.source.username, password: this.source.password });
    return `${this.base}/xmltv.php?${q}`;
  }

  liveUrl(streamId: number | string, ext: "ts" | "m3u8" = "ts"): string {
    return `${this.base}/live/${encodeURIComponent(this.source.username)}/${encodeURIComponent(this.source.password)}/${streamId}.${ext}`;
  }

  movieUrl(streamId: number | string, ext = "mkv"): string {
    return `${this.base}/movie/${encodeURIComponent(this.source.username)}/${encodeURIComponent(this.source.password)}/${streamId}.${ext}`;
  }

  episodeUrl(episodeId: number | string, ext = "mkv"): string {
    return `${this.base}/series/${encodeURIComponent(this.source.username)}/${encodeURIComponent(this.source.password)}/${episodeId}.${ext}`;
  }

  /**
   * Catch-up (timeshift) URL. Xtream panels expect the start time in the panel's own time zone,
   * which `server_info.timezone` reports.
   */
  catchupUrl(streamId: number | string, start: number, durationMin: number, timeZone = "Europe/London"): string {
    return `${this.base}/timeshift/${encodeURIComponent(this.source.username)}/${encodeURIComponent(this.source.password)}/${Math.ceil(durationMin)}/${xtreamTime(start, timeZone)}/${streamId}.ts`;
  }
}

/** Formats a time as Xtream's `YYYY-MM-DD:HH-MM` in the given time zone. */
export function xtreamTime(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}:${get("hour")}-${get("minute")}`;
}
