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

/** The most a single show will keep in memory and send to a client. */
export const MAX_PODCAST_EPISODES = 200;
export const MAX_PODCAST_SHOWS = 50;
export const MAX_PODCAST_SEARCH = 12;
/** How long an episode has to be to offer "carry on from where you were". */
export const PODCAST_RESUME_MS = 60_000;
