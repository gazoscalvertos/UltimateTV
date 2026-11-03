// Radio and podcasts: the stations the Hub knows about, and the shows someone has
// subscribed to. Both are plain data — the Hub hands the TV a stream address and the
// TV plays it like any other stream, so nothing here is specific to one client.

import type { Id } from "./domain.js";

/** Where a station came from: one of the built-in presets, or added by the household. */
export type RadioSource = "preset" | "custom";

export interface RadioStation {
  id: Id;
  name: string;
  /** The stream itself (an ICY/MP3 or AAC address). */
  url: string;
  /** A station logo, if we have one. Most presets have only a name. */
  logo?: string;
  /** "Pop", "Classical", "News", and so on — shown under the name. */
  genre?: string;
  source: RadioSource;
  /** True when only a Kids profile should see it. */
  kidsOnly?: boolean;
}

/** A station's now-playing text, when its stream sends one. */
export interface RadioNow {
  stationId: Id;
  /** e.g. the song or programme name. Absent when the stream says nothing. */
  now?: string;
  /** When this answer was worked out, so the TV can say how old it is. */
  at: number;
}

export interface RadioReply {
  stations: RadioStation[];
}

export interface RadioAddInput {
  name: string;
  url: string;
}

export interface PodcastEpisode {
  id: Id;
  showId: Id;
  title: string;
  /** The audio file. */
  url: string;
  publishedAt: number;
  durationMs?: number;
  description?: string;
  image?: string;
  /** Where this listener got to, when they've played it before. */
  positionMs?: number;
  /** True when it arrived after the household last opened the show. */
  fresh?: boolean;
}

export interface PodcastShow {
  id: Id;
  title: string;
  feedUrl: string;
  author?: string;
  description?: string;
  image?: string;
  /** How many episodes the feed had the last time it was read. */
  episodeCount: number;
  /** How many of those are new since the household last opened the show. */
  freshCount: number;
  checkedAt?: number;
  /** Set when the feed couldn't be read on the last try. */
  problem?: string;
}

export interface PodcastShowWithEpisodes {
  show: PodcastShow;
  episodes: PodcastEpisode[];
}

export interface PodcastsReply {
  shows: PodcastShow[];
}

/** One row of a podcast search: enough to subscribe with one press. */
export interface PodcastSearchResult {
  title: string;
  feedUrl: string;
  author?: string;
  image?: string;
  episodeCount?: number;
}

export interface PodcastSearchReply {
  results: PodcastSearchResult[];
}

/** What the Hub could work out from an RSS feed. */
export interface ParsedFeed {
  title: string;
  author?: string;
  description?: string;
  image?: string;
  episodes: {
    title: string;
    url: string;
    publishedAt: number;
    durationMs?: number;
    description?: string;
    image?: string;
  }[];
}

/** The order the station list is shown in. */
export type StationOrder = "presets" | "custom" | "name";

/** How this household likes the radio and podcasts: set on the phone's settings page or the TV's. */
export interface RadioSettings {
  /** Radio and podcasts keep the screen awake, as a video does; off lets the screensaver take over. */
  keepAwake: boolean;
  /** What the station is playing shows on the screensaver's clock. */
  onScreensaver: boolean;
  /** The Hub asks each station what it's playing, so the TV can name the song. */
  nowPlaying: boolean;
  /** Podcasts sit under the stations on the Music tab. */
  showPodcasts: boolean;
  /** The order the stations are listed in. */
  stationOrder: StationOrder;
}

export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
  keepAwake: false,
  onScreensaver: true,
  nowPlaying: true,
  showPodcasts: true,
  stationOrder: "presets",
};

export const STATION_ORDERS: readonly StationOrder[] = ["presets", "custom", "name"];

export const isStationOrder = (v: unknown): v is StationOrder => STATION_ORDERS.includes(v as StationOrder);

export const STATION_ORDER_NAMES: Record<StationOrder, string> = {
  presets: "As they come",
  custom: "Yours first",
  name: "By name",
};

/** Settings as sent, made safe: known choices only, anything else left as it was. */
export function cleanRadioSettings(s: Partial<RadioSettings> | undefined, base: RadioSettings = DEFAULT_RADIO_SETTINGS): RadioSettings {
  const pick = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    keepAwake: pick(s?.keepAwake, base.keepAwake),
    onScreensaver: pick(s?.onScreensaver, base.onScreensaver),
    nowPlaying: pick(s?.nowPlaying, base.nowPlaying),
    showPodcasts: pick(s?.showPodcasts, base.showPodcasts),
    stationOrder: isStationOrder(s?.stationOrder) ? s.stationOrder : base.stationOrder,
  };
}

/**
 * The stations in the order the household asked for. The built-in order is the presets in the
 * order they were written (BBC first, then the commercial ones, then the children's), which is
 * a sensible running order; "yours first" puts the family's own stations on top of it; "by name"
 * sorts the lot, ignoring case, with the children's stations kept together at the top so they are
 * still easy to find.
 */
export function sortStations(stations: readonly RadioStation[], order: StationOrder, kids = false): RadioStation[] {
  const list = [...stations];
  const byName = (a: RadioStation, b: RadioStation) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });
  if (order === "name") {
    // A Kids profile only ever sees the children's stations, so sorting them together is right.
    return kids ? list.sort(byName) : [...list.filter((s) => s.kidsOnly).sort(byName), ...list.filter((s) => !s.kidsOnly).sort(byName)];
  }
  if (order === "custom") {
    // Stable: the presets keep their running order under the household's own stations.
    return [...list.filter((s) => s.source === "custom"), ...list.filter((s) => s.source === "preset")];
  }
  return list;
}

/** The most a single show will keep in memory and send to a client. */
export const MAX_PODCAST_EPISODES = 200;
export const MAX_PODCAST_SHOWS = 50;
export const MAX_PODCAST_SEARCH = 12;
/** How long an episode has to be to offer "carry on from where you were". */
export const PODCAST_RESUME_MS = 60_000;
