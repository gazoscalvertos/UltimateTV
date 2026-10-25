// Jellyfin API client: Quick Connect sign-in, libraries, playback URLs (always direct play: the box
// plays every format), progress sync, skip markers and library refresh.

import type { Episode, Season, TitleDetails, TitleRef } from "@ultimatetv/shared";
import { fetchJson, fetchOk, type Fetch } from "../http.js";

export interface JellyfinAuth {
  url: string;
  userId: string;
  token: string;
  serverName?: string;
}

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
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean; PlayedPercentage?: number };
  People?: { Name: string; Type: string }[];
  MediaSources?: JfMediaSource[];
  Path?: string;
  CollectionType?: string;
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

const TICKS_PER_MS = 10_000;

export class JellyfinClient {
  private deviceId = "ultimatetv-hub";

  constructor(
    readonly auth: JellyfinAuth | { url: string; userId?: undefined; token?: undefined },
    private fetchImpl: Fetch = fetch,
  ) {}

  private get base(): string {
    return this.auth.url.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    const token = this.auth.token ? `, Token="${this.auth.token}"` : "";
    return {
      Authorization: `MediaBrowser Client="UltimateTV", Device="UltimateTV Hub", DeviceId="${this.deviceId}", Version="1.0.0"${token}`,
      "Content-Type": "application/json",
    };
  }

  private get<T>(path: string): Promise<T> {
    return fetchJson<T>(`${this.base}${path}`, this.fetchImpl, { headers: this.headers() }, 20_000);
  }

  private async post(path: string, body?: unknown): Promise<Response> {
    return fetchOk(`${this.base}${path}`, this.fetchImpl, { method: "POST", headers: this.headers(), body: body === undefined ? null : JSON.stringify(body) }, 20_000);
  }

  private get userId(): string {
    if (!this.auth.userId) throw new Error("Jellyfin isn't signed in");
    return this.auth.userId;
  }

  // Sign-in --------------------------------------------------------------

  publicInfo(): Promise<{ ServerName: string; Version: string; Id: string }> {
    return this.get("/System/Info/Public");
  }

  async quickConnectInitiate(): Promise<{ code: string; secret: string }> {
    const res = await this.post("/QuickConnect/Initiate");
    const body = (await res.json()) as { Code: string; Secret: string };
    return { code: body.Code, secret: body.Secret };
  }

  async quickConnectStatus(secret: string): Promise<boolean> {
    const body = await this.get<{ Authenticated: boolean }>(`/QuickConnect/Connect?Secret=${encodeURIComponent(secret)}`);
    return body.Authenticated;
  }

  async quickConnectAuthenticate(secret: string): Promise<JellyfinAuth> {
    const res = await this.post("/Users/AuthenticateWithQuickConnect", { Secret: secret });
    return this.toAuth((await res.json()) as { AccessToken: string; User: { Id: string } });
  }

  async authenticateByName(username: string, password: string): Promise<JellyfinAuth> {
    const res = await this.post("/Users/AuthenticateByName", { Username: username, Pw: password });
    return this.toAuth((await res.json()) as { AccessToken: string; User: { Id: string } });
  }

  private async toAuth(body: { AccessToken: string; User: { Id: string } }): Promise<JellyfinAuth> {
    const auth: JellyfinAuth = { url: this.base, userId: body.User.Id, token: body.AccessToken };
    try {
      auth.serverName = (await this.publicInfo()).ServerName;
    } catch {
      // Optional.
    }
    return auth;
  }

  // Browsing -------------------------------------------------------------

  private static FIELDS = "Overview,Genres,ProviderIds,PrimaryImageAspectRatio,CommunityRating,OfficialRating,People,MediaSources,Path";

  async resume(limit = 20): Promise<JfItem[]> {
    const r = await this.get<{ Items: JfItem[] }>(`/Users/${this.userId}/Items/Resume?Limit=${limit}&MediaTypes=Video&Fields=${JellyfinClient.FIELDS}`);
    return r.Items;
  }

  async nextUp(limit = 20): Promise<JfItem[]> {
    const r = await this.get<{ Items: JfItem[] }>(`/Shows/NextUp?UserId=${this.userId}&Limit=${limit}&Fields=${JellyfinClient.FIELDS}`);
    return r.Items;
  }

  async latest(type: "Movie" | "Episode", limit = 20): Promise<JfItem[]> {
    return this.get<JfItem[]>(`/Users/${this.userId}/Items/Latest?IncludeItemTypes=${type}&Limit=${limit}&GroupItems=true&Fields=${JellyfinClient.FIELDS}`);
  }

  async items(params: { type: "Movie" | "Series"; sortBy?: string; limit?: number; start?: number; genre?: string; search?: string; maxRating?: string }): Promise<{ items: JfItem[]; total: number }> {
    const q = new URLSearchParams({
      IncludeItemTypes: params.type,
      Recursive: "true",
      SortBy: params.sortBy ?? "SortName",
      SortOrder: params.sortBy === "DateCreated" ? "Descending" : "Ascending",
      Limit: String(params.limit ?? 60),
      StartIndex: String(params.start ?? 0),
      Fields: JellyfinClient.FIELDS,
    });
    if (params.genre) q.set("Genres", params.genre);
    if (params.search) q.set("SearchTerm", params.search);
    if (params.maxRating) q.set("MaxOfficialRating", params.maxRating);
    const r = await this.get<{ Items: JfItem[]; TotalRecordCount: number }>(`/Users/${this.userId}/Items?${q}`);
    return { items: r.Items, total: r.TotalRecordCount };
  }

  item(id: string): Promise<JfItem> {
    return this.get<JfItem>(`/Users/${this.userId}/Items/${id}?Fields=${JellyfinClient.FIELDS}`);
  }

  private providerIndex: { at: number; map: Promise<Map<string, string>> } | null = null;

  /**
   * The library item with this TMDB/IMDb/TVDB id. Jellyfin 10.9+ ignores AnyProviderIdEquals and
   * returns the first item in the library, which made every film "available" as the same file, so
   * the Hub builds its own index of provider ids instead (cached for ten minutes).
   */
  async byProviderId(provider: "tmdb" | "imdb" | "tvdb", id: string, type: "Movie" | "Series"): Promise<JfItem | undefined> {
    const itemId = (await this.providerIds()).get(`${type}|${provider}|${id.toLowerCase()}`);
    return itemId ? this.item(itemId) : undefined;
  }

  private providerIds(): Promise<Map<string, string>> {
    if (this.providerIndex && Date.now() - this.providerIndex.at < 10 * 60_000) return this.providerIndex.map;
    const map = (async () => {
      const index = new Map<string, string>();
      const r = await this.get<{ Items: JfItem[] }>(`/Users/${this.userId}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds&EnableImages=false`);
      for (const item of r.Items) {
        for (const [key, value] of Object.entries(item.ProviderIds ?? {})) {
          if (value) index.set(`${item.Type}|${key.toLowerCase()}|${value.toLowerCase()}`, item.Id);
        }
      }
      return index;
    })();
    this.providerIndex = { at: Date.now(), map };
    // A failed fetch shouldn't stick for ten minutes.
    map.catch(() => (this.providerIndex = null));
    return map;
  }

  async seasons(seriesId: string): Promise<JfItem[]> {
    const r = await this.get<{ Items: JfItem[] }>(`/Shows/${seriesId}/Seasons?UserId=${this.userId}`);
    return r.Items;
  }

  async episodes(seriesId: string): Promise<JfItem[]> {
    const r = await this.get<{ Items: JfItem[] }>(`/Shows/${seriesId}/Episodes?UserId=${this.userId}&Fields=Overview,MediaSources,ProviderIds`);
    return r.Items;
  }

  async segments(itemId: string): Promise<{ Type: string; StartTicks: number; EndTicks: number }[]> {
    try {
      const r = await this.get<{ Items: { Type: string; StartTicks: number; EndTicks: number }[] }>(`/MediaSegments/${itemId}`);
      return r.Items ?? [];
    } catch {
      return []; // Older servers, or no segment provider installed.
    }
  }

  // Playback -------------------------------------------------------------

  /** The original file, untouched: mpv on the box plays every container and codec. */
  streamUrl(itemId: string, mediaSourceId?: string): string {
    const q = new URLSearchParams({ static: "true", api_key: this.auth.token ?? "" });
    if (mediaSourceId) q.set("mediaSourceId", mediaSourceId);
    return `${this.base}/Videos/${itemId}/stream?${q}`;
  }

  subtitleUrl(itemId: string, mediaSourceId: string, index: number, codec = "srt"): string {
    const ext = codec === "ass" || codec === "ssa" ? codec : "srt";
    return `${this.base}/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/0/Stream.${ext}?api_key=${encodeURIComponent(this.auth.token ?? "")}`;
  }

  async reportProgress(itemId: string, positionMs: number, event: "start" | "progress" | "stop", paused = false): Promise<void> {
    const body = { ItemId: itemId, PositionTicks: Math.round(positionMs * TICKS_PER_MS), IsPaused: paused, PlayMethod: "DirectPlay" };
    const path = event === "start" ? "/Sessions/Playing" : event === "progress" ? "/Sessions/Playing/Progress" : "/Sessions/Playing/Stopped";
    await this.post(path, body);
  }

  async markPlayed(itemId: string, played: boolean): Promise<void> {
    await fetchOk(`${this.base}/Users/${this.userId}/PlayedItems/${itemId}`, this.fetchImpl, { method: played ? "POST" : "DELETE", headers: this.headers() });
  }

  /** Tells Jellyfin about a new file so it appears without a full library scan. */
  async mediaUpdated(paths: string[]): Promise<void> {
    try {
      await this.post("/Library/Media/Updated", { Updates: paths.map((Path) => ({ Path, UpdateType: "Created" })) });
    } catch {
      await this.post("/Library/Refresh");
    }
  }

  // Mapping --------------------------------------------------------------

  image(item: JfItem, kind: "Primary" | "Backdrop" | "Logo" | "Thumb", maxWidth: number): string | undefined {
    if (kind === "Backdrop") {
      if (item.BackdropImageTags?.length) return `${this.base}/Items/${item.Id}/Images/Backdrop/0?maxWidth=${maxWidth}&tag=${item.BackdropImageTags[0]}&quality=85`;
      if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) return `${this.base}/Items/${item.ParentBackdropItemId}/Images/Backdrop/0?maxWidth=${maxWidth}&tag=${item.ParentBackdropImageTags[0]}&quality=85`;
      return undefined;
    }
    const tag = item.ImageTags?.[kind];
    if (tag) return `${this.base}/Items/${item.Id}/Images/${kind}?maxWidth=${maxWidth}&tag=${tag}&quality=90`;
    if (kind === "Primary" && item.SeriesId) return `${this.base}/Items/${item.SeriesId}/Images/Primary?maxWidth=${maxWidth}&quality=90`;
    return undefined;
  }

  toTitleRef(item: JfItem): TitleRef {
    const isEpisode = item.Type === "Episode";
    const tmdb = item.ProviderIds?.Tmdb;
    const kind = item.Type === "Movie" ? "movie" : "series";
    const ref: TitleRef = {
      id: isEpisode ? `jellyfin:${item.SeriesId}` : tmdb ? `tmdb:${kind}:${tmdb}` : `jellyfin:${item.Id}`,
      kind,
      name: isEpisode ? (item.SeriesName ?? item.Name) : item.Name,
    };
    if (item.ProductionYear) ref.year = item.ProductionYear;
    const poster = this.image(isEpisode ? { ...item, Id: item.SeriesId ?? item.Id, ImageTags: {} } : item, "Primary", 400);
    if (poster) ref.poster = poster;
    const backdrop = this.image(item, "Backdrop", 1280);
    if (backdrop) ref.backdrop = backdrop;
    const logo = this.image(item, "Logo", 600);
    if (logo) ref.logo = logo;
    if (isEpisode) ref.subtitle = `S${item.ParentIndexNumber ?? 0} E${item.IndexNumber ?? 0} · ${item.Name}`;
    if (item.Genres?.length) ref.genres = item.Genres;
    if (item.OfficialRating) ref.certification = item.OfficialRating;
    const pct = item.UserData?.PlayedPercentage;
    if (pct && pct > 0 && pct < 100) ref.progress = pct / 100;
    return ref;
  }

  toDetails(item: JfItem, episodes: JfItem[] = []): TitleDetails {
    const ref = this.toTitleRef(item);
    const details: TitleDetails = {
      ...ref,
      id: `jellyfin:${item.Id}`,
      genres: item.Genres ?? [],
      cast: (item.People ?? []).filter((p) => p.Type === "Actor").slice(0, 8).map((p) => p.Name),
      availability: ["jellyfin"],
      inLibrary: true,
    };
    if (item.Overview) details.overview = item.Overview;
    if (item.RunTimeTicks) details.runtimeMin = Math.round(item.RunTimeTicks / TICKS_PER_MS / 60_000);
    if (item.CommunityRating) details.rating = item.CommunityRating;
    if (item.OfficialRating) details.certification = item.OfficialRating;
    if (item.ProviderIds?.Tmdb) details.tmdbId = Number(item.ProviderIds.Tmdb);
    if (item.ProviderIds?.Imdb) details.imdbId = item.ProviderIds.Imdb;
    const resume = item.UserData?.PlaybackPositionTicks;
    if (resume) details.resumeMs = Math.round(resume / TICKS_PER_MS);
    if (item.Type === "Series") details.seasons = groupSeasons(episodes, (e) => this.toEpisode(e));
    return details;
  }

  toEpisode(e: JfItem): Episode {
    const ep: Episode = { id: `jellyfin:${e.Id}`, season: e.ParentIndexNumber ?? 0, episode: e.IndexNumber ?? 0, name: e.Name };
    if (e.Overview) ep.overview = e.Overview;
    const still = this.image(e, "Primary", 640);
    if (still) ep.still = still;
    if (e.PremiereDate) ep.airDate = e.PremiereDate.slice(0, 10);
    if (e.RunTimeTicks) ep.runtimeMin = Math.round(e.RunTimeTicks / TICKS_PER_MS / 60_000);
    if (e.UserData?.PlayedPercentage) ep.progress = e.UserData.PlayedPercentage / 100;
    if (e.UserData?.Played) ep.watched = true;
    return ep;
  }
}

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

export function ticksToMs(ticks: number): number {
  return Math.round(ticks / TICKS_PER_MS);
}
