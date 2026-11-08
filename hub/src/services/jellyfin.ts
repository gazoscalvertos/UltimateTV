// Jellyfin API client: Quick Connect sign-in, libraries, playback URLs (always direct play: the box
// plays every format), progress sync, skip markers and library refresh.

import type { Episode, TitleDetails, TitleRef, Trickplay } from "@ultimatetv/shared";
import { fetchJson, fetchOk, type Fetch } from "../http.js";
import {
  groupSeasons,
  resumeEpisode,
  type ItemsQuery,
  type JfItem,
  type JfMediaSource,
  type MediaImageKind,
  type MediaProvider,
  type MediaSegment,
  type MediaServer,
  type MediaServerKind,
} from "./media.js";

// The internal item shape is shared with Plex, so it lives in media.ts; it is re-exported here
// because this is where it grew up and where the rest of the Hub still imports it from.
export type { JfItem, JfMediaSource, JfStream } from "./media.js";
export { groupSeasons, resumeEpisode } from "./media.js";

export interface JellyfinAuth {
  url: string;
  userId: string;
  token: string;
  serverName?: string;
}

const TICKS_PER_MS = 10_000;

export class JellyfinClient implements MediaServer {
  /** Emby subclasses this: its API is Jellyfin's ancestor, so only the differences are overridden. */
  readonly kind: MediaServerKind = "jellyfin";
  readonly name: string = "Jellyfin";

  protected deviceId = "ultimatetv-hub";

  constructor(
    readonly auth: JellyfinAuth | { url: string; userId?: undefined; token?: undefined },
    protected fetchImpl: Fetch = fetch,
  ) {}

  protected get base(): string {
    return this.auth.url.replace(/\/+$/, "");
  }

  protected headers(): Record<string, string> {
    const token = this.auth.token ? `, Token="${this.auth.token}"` : "";
    return {
      Authorization: `MediaBrowser Client="UltimateTV", Device="UltimateTV Hub", DeviceId="${this.deviceId}", Version="1.0.0"${token}`,
      "Content-Type": "application/json",
    };
  }

  protected get<T>(path: string): Promise<T> {
    return fetchJson<T>(`${this.base}${path}`, this.fetchImpl, { headers: this.headers() }, 20_000);
  }

  protected async post(path: string, body?: unknown): Promise<Response> {
    return fetchOk(`${this.base}${path}`, this.fetchImpl, { method: "POST", headers: this.headers(), body: body === undefined ? null : JSON.stringify(body) }, 20_000);
  }

  protected get userId(): string {
    if (!this.auth.userId) throw new Error(`${this.name} isn't signed in`);
    return this.auth.userId;
  }

  /** The Hub's id for one of Jellyfin's items: "jellyfin:abc123". */
  key(itemId: string): string {
    return `${this.kind}:${itemId}`;
  }

  kindOf(_itemId: string): MediaServerKind {
    return this.kind;
  }

  rawId(itemId: string): string {
    return itemId;
  }

  /** The Jellyfin item id inside one of the Hub's ids, or undefined for another server's. */
  parseKey(id: string): string | undefined {
    return id.startsWith(`${this.kind}:`) ? id.slice(this.kind.length + 1) : undefined;
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

  protected async toAuth(body: { AccessToken: string; User: { Id: string } }): Promise<JellyfinAuth> {
    const auth: JellyfinAuth = { url: this.base, userId: body.User.Id, token: body.AccessToken };
    try {
      auth.serverName = (await this.publicInfo()).ServerName;
    } catch {
      // Optional.
    }
    return auth;
  }

  // Browsing -------------------------------------------------------------

  protected static FIELDS = "Overview,Genres,ProviderIds,PrimaryImageAspectRatio,CommunityRating,OfficialRating,People,MediaSources,Path";

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

  async played(limit = 1500): Promise<JfItem[]> {
    const ask = (types: string, extra: Record<string, string> = {}) => {
      const q = new URLSearchParams({
        IncludeItemTypes: types,
        Recursive: "true",
        Filters: "IsPlayed",
        SortBy: "DatePlayed",
        SortOrder: "Descending",
        Limit: String(limit),
        Fields: "ProviderIds,ProductionYear",
        ...extra,
      });
      return this.get<{ Items: JfItem[] }>(`/Users/${this.userId}/Items?${q}`).then((r) => r.Items);
    };
    // Films and fully watched series, and episodes, which put a series that is only part watched on the list.
    const [titles, episodes] = await Promise.all([ask("Movie,Series"), ask("Episode")]);
    return [...titles, ...episodes];
  }

  async items(params: ItemsQuery): Promise<{ items: JfItem[]; total: number }> {
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
    // Trickplay (10.9+) rides along on the single item only: it is too big to ask of a whole list.
    return this.get<JfItem>(`/Users/${this.userId}/Items/${id}?Fields=${JellyfinClient.FIELDS}${this.kind === "jellyfin" ? ",Trickplay" : ""}`);
  }

  private providerIndex: { at: number; map: Promise<Map<string, string>> } | null = null;

  /**
   * The library item with this TMDB/IMDb/TVDB id. Jellyfin 10.9+ ignores AnyProviderIdEquals and
   * returns the first item in the library, which made every film "available" as the same file, so
   * the Hub builds its own index of provider ids instead (cached for ten minutes).
   */
  async byProviderId(provider: MediaProvider, id: string, type: "Movie" | "Series"): Promise<JfItem | undefined> {
    const itemId = (await this.providerIds()).get(`${type}|${provider}|${id.toLowerCase()}`);
    return itemId ? this.item(itemId) : undefined;
  }

  /** Whether the library has a title, without fetching it. */
  async hasProviderId(provider: MediaProvider, id: string, type: "Movie" | "Series"): Promise<boolean> {
    return (await this.providerIds()).has(`${type}|${provider}|${id.toLowerCase()}`);
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

  async segments(itemId: string): Promise<MediaSegment[]> {
    try {
      const r = await this.get<{ Items: MediaSegment[] }>(`/MediaSegments/${itemId}`);
      return r.Items ?? [];
    } catch {
      return []; // Older servers, or no segment provider installed.
    }
  }

  /**
   * The seek bar's preview pictures for this item, from the sheets Jellyfin has already made (10.9+;
   * Emby and Plex have none). Undefined when there are none, so the player shows nothing.
   */
  trickplay(itemId: string, item: JfItem, mediaSourceId: string | undefined): Trickplay | undefined {
    if (this.kind !== "jellyfin" || !item.Trickplay) return undefined;
    const sourceId = mediaSourceId && item.Trickplay[mediaSourceId] ? mediaSourceId : Object.keys(item.Trickplay)[0];
    const sizes = sourceId ? Object.values(item.Trickplay[sourceId] ?? {}) : [];
    // The biggest frame up to 480 wide is plenty for a thumbnail; failing that, the smallest there is.
    const usable = sizes.filter((s) => s.Interval > 0 && s.ThumbnailCount > 0 && s.TileWidth > 0 && s.TileHeight > 0);
    const small = usable.filter((s) => s.Width <= 480).sort((a, b) => b.Width - a.Width)[0] ?? usable.sort((a, b) => a.Width - b.Width)[0];
    if (!small || !sourceId) return undefined;
    const q = new URLSearchParams({ mediaSourceId: sourceId, api_key: this.auth.token ?? "" });
    return {
      url: `${this.base}/Videos/${itemId}/Trickplay/${small.Width}/{n}.jpg?${q}`,
      intervalMs: small.Interval,
      width: small.Width,
      height: small.Height,
      tileWidth: small.TileWidth,
      tileHeight: small.TileHeight,
      count: small.ThumbnailCount,
    };
  }

  // Playback -------------------------------------------------------------

  /** The original file, untouched: mpv on the box plays every container and codec. */
  streamUrl(itemId: string, mediaSourceId?: string): string {
    const q = new URLSearchParams({ static: "true", api_key: this.auth.token ?? "" });
    if (mediaSourceId) q.set("mediaSourceId", mediaSourceId);
    return `${this.base}/Videos/${itemId}/stream?${q}`;
  }

  /**
   * A smaller H.264/AAC stereo copy that Jellyfin makes on the fly as HLS, for phones to download
   * or play when the original is huge (a 4K remux on a phone).
   */
  hlsUrl(itemId: string, mediaSourceId: string | undefined, session: string, maxHeight = 720, videoBitrate = 3_000_000): string {
    const q = new URLSearchParams({
      api_key: this.auth.token ?? "",
      MediaSourceId: mediaSourceId ?? itemId,
      DeviceId: `ultimatetv-${session}`,
      PlaySessionId: session,
      VideoCodec: "h264",
      AudioCodec: "aac",
      MaxHeight: String(maxHeight),
      VideoBitrate: String(videoBitrate),
      AudioBitrate: "160000",
      MaxAudioChannels: "2",
      TranscodingMaxAudioChannels: "2",
      SegmentContainer: "ts",
      BreakOnNonKeyFrames: "false",
    });
    return `${this.base}/Videos/${itemId}/master.m3u8?${q}`;
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

  /**
   * Tells Jellyfin about new files so they appear without a full library scan. Jellyfin quietly
   * ignores a file outside its libraries, so check the folders first (that needs an admin
   * account; without one, just send the update) and say where Jellyfin looks instead.
   */
  async mediaUpdated(paths: string[]): Promise<{ added: boolean; note: string }> {
    const folders = await this.get<{ Name: string; Locations?: string[] }[]>("/Library/VirtualFolders").catch(() => null);
    if (folders) {
      const locations = folders.flatMap((f) => f.Locations ?? []).map((l) => l.replace(/\/+$/, ""));
      const outside = paths.filter((p) => !locations.some((l) => p.startsWith(`${l}/`)));
      if (outside.length === paths.length && locations.length) {
        return { added: false, note: `${this.name} doesn't look in that folder. Its libraries are in ${locations.join(", ")}: set MOVIES_PATH and TV_PATH in the Hub's .env to folders inside them.` };
      }
    }
    try {
      await this.post("/Library/Media/Updated", { Updates: paths.map((Path) => ({ Path, UpdateType: "Created" })) });
    } catch {
      await this.post("/Library/Refresh");
    }
    return { added: true, note: `Added to ${this.name}` };
  }

  /** Asks Jellyfin to rescan its libraries, so deleted files disappear from it too. */
  async refreshLibrary(): Promise<void> {
    await this.post("/Library/Refresh");
  }

  // Mapping --------------------------------------------------------------

  image(item: JfItem, kind: MediaImageKind, maxWidth: number): string | undefined {
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
      id: isEpisode ? this.key(item.SeriesId ?? item.Id) : tmdb ? `tmdb:${kind}:${tmdb}` : this.key(item.Id),
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
      id: this.key(item.Id),
      genres: item.Genres ?? [],
      cast: (item.People ?? []).filter((p) => p.Type === "Actor").slice(0, 8).map((p) => p.Name),
      availability: [this.kind],
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
    if (item.Type === "Series") {
      details.seasons = groupSeasons(episodes, (e) => this.toEpisode(e));
      const carryOn = resumeEpisode(episodes);
      if (carryOn) {
        details.episodeId = `s${carryOn.ParentIndexNumber ?? 0}e${carryOn.IndexNumber ?? 0}`;
        const at = carryOn.UserData?.Played ? 0 : (carryOn.UserData?.PlaybackPositionTicks ?? 0);
        if (at) details.resumeMs = Math.round(at / TICKS_PER_MS);
      }
    }
    return details;
  }

  toEpisode(e: JfItem): Episode {
    const ep: Episode = { id: this.key(e.Id), season: e.ParentIndexNumber ?? 0, episode: e.IndexNumber ?? 0, name: e.Name };
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

export function ticksToMs(ticks: number): number {
  return Math.round(ticks / TICKS_PER_MS);
}
