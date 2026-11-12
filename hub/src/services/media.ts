// The media servers the Hub keeps its films and TV in: Jellyfin, Plex and Emby, any of them, at the
// same time (CombinedMedia puts several behind this one interface).
//
// Everything above this layer (library.ts, playback.ts, the routes) talks to a MediaServer and never
// to a particular product, and everything it gets back is in the same shape: the Jellyfin item
// (JfItem), which Plex items are mapped onto field by field. That is why the type keeps its Jellyfin
// name: it is the Hub's internal shape, not a claim about where it came from.
//
// Ids are the one thing that is not product neutral. They read `<kind>:<itemId>` ("jellyfin:abc",
// "plex:1234"), and the prefix is what tells the Hub whose item id follows: it is the key the
// Hub's own progress store, Continue watching's hidden list and Kids' allow list are kept under.
// Existing Jellyfin installs keep their "jellyfin:" keys, so nothing has to be migrated when this
// layer is added; a household that switches to Plex starts a new set of keys.

import type { Episode, Season, TitleDetails, TitleRef, Trickplay } from "@ultimatetv/shared";

/** The media server on the other end of the Hub's library. */
export type MediaServerKind = "jellyfin" | "plex" | "emby";

/** A library item, in Jellyfin's shape whichever server it came from. */
export interface JfItem {
  Id: string;
  Name: string;
  Type: "Movie" | "Series" | "Season" | "Episode" | "BoxSet" | "Folder" | "CollectionFolder" | string;
  ProductionYear?: number;
  Overview?: string;
  Genres?: string[];
  CommunityRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  ProviderIds?: Record<string, string>;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  PremiereDate?: string;
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean; PlayedPercentage?: number; LastPlayedDate?: string };
  People?: { Name: string; Type: string }[];
  MediaSources?: JfMediaSource[];
  Path?: string;
  CollectionType?: string;
  /** Jellyfin 10.9+: by media source id, then by frame width. Only present when asked for in Fields. */
  Trickplay?: Record<string, Record<string, { Width: number; Height: number; TileWidth: number; TileHeight: number; ThumbnailCount: number; Interval: number }>>;
}

export interface JfMediaSource {
  Id: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  MediaStreams?: JfStream[];
}

export interface JfStream {
  Type: "Video" | "Audio" | "Subtitle" | string;
  Index: number;
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsExternal?: boolean;
  Height?: number;
  Width?: number;
  Channels?: number;
  Profile?: string;
  VideoRange?: string;
  VideoRangeType?: string;
  RealFrameRate?: number;
  AverageFrameRate?: number;
  IsDefault?: boolean;
}

/** A skip marker as the player wants it (ticks are 100 ns, as everywhere else here). */
export interface MediaSegment {
  Type: string;
  StartTicks: number;
  EndTicks: number;
}

/** What one library browse asks for. */
export interface ItemsQuery {
  type: "Movie" | "Series";
  sortBy?: string;
  limit?: number;
  start?: number;
  genre?: string;
  search?: string;
  maxRating?: string;
}

export type MediaProvider = "tmdb" | "imdb" | "tvdb";
export type MediaImageKind = "Primary" | "Backdrop" | "Logo" | "Thumb";

/**
 * What the Hub needs from a media server. JellyfinClient and PlexClient both implement it, and only
 * one of them is connected at a time, so the rest of the Hub never asks which it is talking to.
 */
export interface MediaServer {
  readonly kind: MediaServerKind;
  /** "Jellyfin" or "Plex", for the source list and for anything said to the household. */
  readonly name: string;
  /** The Hub's id for a library item: `${kind}:${itemId}`. */
  key(itemId: string): string;
  /** The item id inside one of this server's ids, or undefined for another server's id. */
  parseKey(id: string): string | undefined;
  /**
   * Which server an item id belongs to. A single server answers its own kind; when several servers
   * are connected at once their item ids carry the server (see CombinedMedia), and this reads it.
   */
  kindOf(itemId: string): MediaServerKind;
  /** The server's own id for an item: itemId itself for a single server. */
  rawId(itemId: string): string;

  toTitleRef(item: JfItem): TitleRef;
  toDetails(item: JfItem, episodes?: JfItem[]): TitleDetails;
  toEpisode(e: JfItem): Episode;

  item(id: string): Promise<JfItem>;
  items(params: ItemsQuery): Promise<{ items: JfItem[]; total: number }>;
  /** Continue watching, as the server itself sees it. */
  resume(limit?: number): Promise<JfItem[]>;
  nextUp(limit?: number): Promise<JfItem[]>;
  latest(type: "Movie" | "Episode", limit?: number): Promise<JfItem[]>;
  /**
   * Films and series this server's viewer has played, from any device (an episode stands for its
   * series, named in SeriesName). Newest first. Used to keep suggestions from repeating them.
   */
  played?(limit?: number): Promise<JfItem[]>;
  /** The server's collections (Jellyfin/Emby BoxSets, Plex collections) as items of Type "BoxSet" (#238). */
  collections?(): Promise<JfItem[]>;
  /** The films in one of those collections, in whatever order the server gives. */
  collectionItems?(id: string): Promise<JfItem[]>;
  byProviderId(provider: MediaProvider, id: string, type: "Movie" | "Series"): Promise<JfItem | undefined>;
  hasProviderId(provider: MediaProvider, id: string, type: "Movie" | "Series"): Promise<boolean>;
  seasons(seriesId: string): Promise<JfItem[]>;
  /** Every episode of a series, in the same shape `seasons` groups. */
  episodes(seriesId: string): Promise<JfItem[]>;
  segments(itemId: string): Promise<MediaSegment[]>;
  /** Seek-bar preview pictures for an item fetched with item(); only Jellyfin has them. */
  trickplay(itemId: string, item: JfItem, mediaSourceId: string | undefined): Trickplay | undefined;

  /** The original file, untouched, for direct play. */
  streamUrl(itemId: string, mediaSourceId?: string): string;
  /**
   * A smaller copy the server makes on the fly, for phones. Plex's transcoder is not implemented,
   * so PlexClient throws here and the caller falls back to `streamUrl` (direct play).
   */
  hlsUrl(itemId: string, mediaSourceId: string | undefined, session: string, maxHeight?: number, videoBitrate?: number): string;
  subtitleUrl(itemId: string, mediaSourceId: string, index: number, codec?: string): string;

  reportProgress(itemId: string, positionMs: number, event: "start" | "progress" | "stop", paused?: boolean): Promise<void>;
  markPlayed(itemId: string, played: boolean): Promise<void>;
  /** Tells the server about files that just appeared. `added: false` means it needs a scan instead. */
  mediaUpdated(paths: string[]): Promise<{ added: boolean; note: string }>;
  refreshLibrary(): Promise<void>;

  image(item: JfItem, kind: MediaImageKind, maxWidth: number): string | undefined;
}

/**
 * The episode of a series to carry on with: the one played last if it was stopped part way, else
 * the one after it. Undefined when none has been played (Play then starts the first unwatched).
 */
export function resumeEpisode(episodes: JfItem[]): JfItem | undefined {
  let last = -1;
  let lastAt = 0;
  episodes.forEach((e, i) => {
    const at = Date.parse(e.UserData?.LastPlayedDate ?? "") || 0;
    if (at > lastAt) [last, lastAt] = [i, at];
  });
  if (last < 0) return undefined;
  const e = episodes[last]!;
  if (!e.UserData?.Played) return e;
  return episodes.slice(last + 1).find((n) => !n.UserData?.Played && (n.ParentIndexNumber ?? 0) > 0);
}

/** The seasons of a series, from its episodes: shared by both clients, and by the demo library. */
export function groupSeasons<T>(episodes: T[], map: (e: T) => Episode): Season[] {
  const bySeason = new Map<number, Episode[]>();
  for (const e of episodes) {
    const ep = map(e);
    const list = bySeason.get(ep.season) ?? [];
    list.push(ep);
    bySeason.set(ep.season, list);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
    .map(([season, eps]) => ({ season, name: season === 0 ? "Specials" : `Series ${season}`, episodes: eps.sort((a, b) => a.episode - b.episode) }));
}
