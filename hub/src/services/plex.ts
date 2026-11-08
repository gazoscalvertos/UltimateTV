// Plex Media Server as the Hub's media library, alongside Jellyfin (services/media.ts is the
// interface both implement; only one of them is connected at a time).
//
// Everything Plex returns is mapped into the Hub's internal item shape (JfItem) field by field, so
// library.ts and playback.ts never learn which server they are talking to. Playback is always
// direct play — the box's mpv plays every container and codec — so a Plex item plays from its
// Part's file URL with the token in the query string. Plex's transcoder is deliberately not
// implemented: the Hub's "smaller copy" option throws here and falls back to direct play.
//
// Two places where Plex differs in more than shape, both documented again where they are handled:
//   - "Next up" does not exist. It is derived from the next unwatched episode after the last one
//     watched (or part watched) of each show on Plex's On Deck list.
//   - `mediaUpdated` has no per-file equivalent: Plex answers "scan the whole section", so a file
//     the Hub saves appears after Plex's next scan and the note says so.

import type { Episode, TitleDetails, TitleRef } from "@ultimatetv/shared";
import { fetchJson, fetchOk, type Fetch } from "../http.js";
import {
  groupSeasons,
  resumeEpisode,
  type ItemsQuery,
  type JfItem,
  type JfMediaSource,
  type JfStream,
  type MediaImageKind,
  type MediaProvider,
  type MediaSegment,
  type MediaServer,
  type MediaServerKind,
} from "./media.js";

const TICKS_PER_MS = 10_000;

/** The client identifier Plex ties a token and a PIN to; the same on every Hub. */
export const PLEX_CLIENT_ID = "ultimatetv-hub";
export const PLEX_PRODUCT = "UltimateTV";
const PLEX_TV = "https://plex.tv";

export interface PlexAuth {
  /** The server's base URL, e.g. "http://192.168.0.23:32400". */
  url: string;
  token: string;
  clientId?: string;
  serverName?: string;
}

// Plex's JSON, only the fields the Hub uses. Everything is optional: the same shapes come back
// from /library/sections, /library/onDeck, /search and /library/metadata.
interface PlexStream {
  id?: number;
  index?: number;
  streamType?: number;
  codec?: string;
  language?: string;
  displayTitle?: string;
  title?: string;
  key?: string;
  height?: number;
  width?: number;
  channels?: number;
  profile?: string;
  colorTrc?: string;
  DOVIPresent?: boolean;
  audioChannelLayout?: string;
}

interface PlexPart {
  id?: number;
  key?: string;
  file?: string;
  size?: number;
  container?: string;
  Stream?: PlexStream[];
}

interface PlexMedia {
  id?: number;
  duration?: number;
  bitrate?: number;
  container?: string;
  Part?: PlexPart[];
}

interface PlexMarker {
  type?: string;
  startTimeOffset?: number;
  endTimeOffset?: number;
}

interface PlexMetadata {
  ratingKey?: string | number;
  key?: string;
  guid?: string;
  type?: string;
  title?: string;
  summary?: string;
  year?: number;
  thumb?: string;
  art?: string;
  grandparentThumb?: string;
  grandparentArt?: string;
  parentThumb?: string;
  parentRatingKey?: string | number;
  grandparentRatingKey?: string | number;
  parentIndex?: number;
  index?: number;
  parentTitle?: string;
  grandparentTitle?: string;
  duration?: number;
  audienceRating?: number;
  rating?: number;
  contentRating?: string;
  originallyAvailableAt?: string;
  viewOffset?: number;
  viewCount?: number;
  lastViewedAt?: number;
  addedAt?: number;
  leafCount?: number;
  viewedLeafCount?: number;
  Guid?: { id?: string }[];
  Genre?: { tag?: string }[];
  Role?: { tag?: string }[];
  Director?: { tag?: string }[];
  Media?: PlexMedia[];
  Marker?: PlexMarker[];
  Image?: { type?: string; url?: string }[];
}

/** Every Plex answer is wrapped in a MediaContainer; these are the fields it always may carry. */
interface PlexHeader {
  size?: number;
  totalSize?: number;
  friendlyName?: string;
  machineIdentifier?: string;
  version?: string;
  Directory?: { key?: string; title?: string; type?: string }[];
  Metadata?: PlexMetadata[];
  Hub?: { Metadata?: PlexMetadata[] }[];
}

type PlexContainer<T = unknown> = { MediaContainer?: PlexHeader & T };

interface PlexSection {
  key: string;
  title: string;
  type: string;
}

/** Plex's type names as the Hub's. */
function itemType(type: string | undefined): string {
  switch (type) {
    case "movie":
      return "Movie";
    case "show":
      return "Series";
    case "season":
      return "Season";
    case "episode":
      return "Episode";
    default:
      return type ?? "Folder";
  }
}

/** Plex's streamType numbers as the Hub's stream kinds. */
function streamType(n: number | undefined): string {
  switch (n) {
    case 1:
      return "Video";
    case 2:
      return "Audio";
    case 3:
      return "Subtitle";
    default:
      return String(n ?? "");
  }
}

/**
 * The ratings Jellyfin's own ladder uses ("U", "PG", "12", "12A", "15", "18"), by the names Plex
 * servers give the same films (US and UK, films and TV). Used to keep a Kids profile's limit when
 * browsing Plex, which has no MaxOfficialRating query.
 */
const RATING_RANK: Record<string, number> = {
  U: 0,
  "TV-Y": 0,
  "TV-Y7": 0,
  "TV-G": 0,
  G: 0,
  PG: 1,
  "TV-PG": 1,
  "PG-13": 2,
  "12": 2,
  "12A": 2,
  "TV-14": 2,
  M: 2,
  R: 3,
  "15": 3,
  "TV-MA": 3,
  "NC-17": 4,
  "18": 4,
};

/** How a rating on a Plex item compares with Jellyfin's ladder; null when Plex doesn't say. */
export function plexRatingRank(rating: string | undefined): number | null {
  if (!rating) return null;
  const key = rating.trim().toUpperCase();
  return RATING_RANK[key] ?? null;
}

// ---------------------------------------------------------------------------
// plex.tv: the PIN sign-in and server discovery. These talk to plex.tv, not to the household's
// server, so they live outside the client (a client needs a server URL first).

function plexTvHeaders(clientId = PLEX_CLIENT_ID): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Version": "1.0.0",
  };
}

/** The page the household opens to approve the Hub: they sign in to Plex, and the Hub is linked. */
export function plexAuthUrl(id: number | string, code: string, clientId = PLEX_CLIENT_ID): string {
  const q = new URLSearchParams({ clientID: clientId, code, "context[device][product]": PLEX_PRODUCT });
  return `https://app.plex.tv/auth#?${q}`;
}

/**
 * Starts a PIN sign-in: shows a code, and the household approves it on plex.tv. `id` is what the
 * Hub polls with; `code` is the four characters shown on screen.
 */
export async function plexPinStart(fetchImpl: Fetch = fetch): Promise<{ id: number; code: string; authUrl: string }> {
  const res = await fetchOk(`${PLEX_TV}/api/v2/pins?strong=true`, fetchImpl, { method: "POST", headers: plexTvHeaders() }, 20_000);
  const body = (await res.json()) as { id: number; code: string };
  return { id: body.id, code: body.code, authUrl: plexAuthUrl(body.id, body.code) };
}

/** The token once the household has approved the PIN, or undefined while they haven't. */
export async function plexPinCheck(pinId: string | number, fetchImpl: Fetch = fetch): Promise<string | undefined> {
  const body = await fetchJson<{ authToken?: string }>(`${PLEX_TV}/api/v2/pins/${encodeURIComponent(String(pinId))}`, fetchImpl, { headers: plexTvHeaders() }, 20_000);
  return body.authToken || undefined;
}

/**
 * The household's servers, from plex.tv. A server has several connections (local, remote, relay);
 * the first HTTP one is used. Only a convenience for the setup page, which also accepts a URL
 * typed in by hand — that is the fallback when discovery returns nothing useful.
 */
export async function plexResources(token: string, fetchImpl: Fetch = fetch): Promise<{ name: string; urls: string[] }[]> {
  const body = await fetchJson<{ name?: string; provides?: string; connections?: { uri?: string; local?: boolean; relay?: boolean }[] }[]>(
    `${PLEX_TV}/api/resources?X-Plex-Token=${encodeURIComponent(token)}`,
    fetchImpl,
    { headers: plexTvHeaders() },
    20_000,
  );
  return (body ?? [])
    .filter((d) => String(d.provides ?? "").split(",").includes("server"))
    .map((d) => ({
      name: d.name ?? "Plex",
      urls: (d.connections ?? [])
        .filter((c) => c.uri && !c.relay)
        .sort((a, b) => Number(b.local ?? false) - Number(a.local ?? false))
        .map((c) => String(c.uri).replace(/\/+$/, "")),
    }))
    .filter((d) => d.urls.length > 0);
}

/** Appends the token the way Plex wants it on media and image URLs. */
function withToken(url: string, token: string | undefined): string {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------

export class PlexClient implements MediaServer {
  readonly kind = "plex" as const;
  readonly name = "Plex";

  /** Image paths by item id, from the last time Plex described that item. */
  private imagePaths = new Map<string, { thumb?: string; art?: string; logo?: string }>();
  /** Part URLs and subtitle stream keys by "<itemId>|<partId>[|<index>]", filled in by item(). */
  private parts = new Map<string, string>();
  /** Run times by item id, so the timeline report can carry a duration. */
  private durations = new Map<string, number>();
  private sectionCache: { at: number; list: Promise<PlexSection[]> } | null = null;
  private providerIndex: { at: number; map: Promise<Map<string, string>> } | null = null;

  constructor(
    readonly auth: PlexAuth | { url: string; token?: undefined; clientId?: undefined; serverName?: undefined },
    private fetchImpl: Fetch = fetch,
  ) {}

  private get base(): string {
    return this.auth.url.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    const token = this.auth.token;
    return {
      Accept: "application/json",
      "X-Plex-Client-Identifier": this.auth.clientId ?? PLEX_CLIENT_ID,
      "X-Plex-Product": PLEX_PRODUCT,
      ...(token ? { "X-Plex-Token": token } : {}),
    };
  }

  private get<T>(path: string): Promise<T> {
    return fetchJson<T>(`${this.base}${path}`, this.fetchImpl, { headers: this.headers() }, 20_000);
  }

  /** A GET with no body to read (progress, scrobble, refresh). */
  private async send(path: string): Promise<void> {
    await fetchOk(`${this.base}${path}`, this.fetchImpl, { headers: this.headers() }, 20_000);
  }

  /** The Hub's id for one of Plex's items: "plex:1234". */
  key(itemId: string): string {
    return `${this.kind}:${itemId}`;
  }

  /** The Plex ratingKey inside one of the Hub's ids, or undefined for another server's. */
  parseKey(id: string): string | undefined {
    return id.startsWith(`${this.kind}:`) ? id.slice(this.kind.length + 1) : undefined;
  }

  kindOf(_itemId: string): MediaServerKind {
    return this.kind;
  }

  rawId(itemId: string): string {
    return itemId;
  }

  // Server identity ------------------------------------------------------

  /** The server's friendly name and version, for Settings and the setup page. */
  async serverInfo(): Promise<{ name: string; version?: string; machineId?: string }> {
    const body = await this.get<PlexContainer>("/");
    const mc = body.MediaContainer ?? {};
    return { name: mc.friendlyName ?? "Plex", ...(mc.version ? { version: mc.version } : {}), ...(mc.machineIdentifier ? { machineId: mc.machineIdentifier } : {}) };
  }

  async identity(): Promise<{ machineId: string; version?: string }> {
    const body = await this.get<PlexContainer>("/identity");
    const mc = body.MediaContainer ?? {};
    return { machineId: mc.machineIdentifier ?? "", ...(mc.version ? { version: mc.version } : {}) };
  }

  /**
   * Checks a URL and token answer, and fills in the server's name. The setup page and Settings both
   * call this before saving, so a wrong token is caught there rather than on the first film.
   */
  static async connect(auth: Pick<PlexAuth, "url" | "token" | "clientId">, fetchImpl: Fetch = fetch): Promise<PlexAuth> {
    const client = new PlexClient(auth, fetchImpl);
    const info = await client.serverInfo();
    const out: PlexAuth = { url: client.base, token: auth.token, serverName: info.name };
    if (auth.clientId) out.clientId = auth.clientId;
    return out;
  }

  private async sections(): Promise<PlexSection[]> {
    if (!this.sectionCache || Date.now() - this.sectionCache.at > 5 * 60_000) {
      const list = (async () => {
        const body = await this.get<PlexContainer>("/library/sections");
        return (body.MediaContainer?.Directory ?? []).filter((d) => d.key).map((d) => ({ key: String(d.key), title: d.title ?? "", type: d.type ?? "" }));
      })();
      this.sectionCache = { at: Date.now(), list };
      list.catch(() => (this.sectionCache = null));
    }
    return this.sectionCache.list;
  }

  // Browsing -------------------------------------------------------------

  /** Plex's On Deck: the films and episodes it thinks are being watched, with `viewOffset` set. */
  async resume(limit = 20): Promise<JfItem[]> {
    const body = await this.get<PlexContainer>(`/library/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`);
    return (body.MediaContainer?.Metadata ?? []).slice(0, limit).map((m) => this.toJf(m));
  }

  /**
   * Plex has no "next up" list, so it is derived: for each show in On Deck, the show's episodes are
   * read and the first one after the last watched (or part watched) is returned. A show with
   * nothing watched yet is skipped, exactly like Jellyfin's own Next Up.
   */
  async nextUp(limit = 20): Promise<JfItem[]> {
    const onDeck = await this.resume(40);
    const showKeys = [...new Set(onDeck.filter((i) => i.Type === "Episode" && i.SeriesId).map((i) => i.SeriesId!))].slice(0, limit);
    const lists = await Promise.all(showKeys.map((id) => this.episodes(id).catch((): JfItem[] => [])));
    const out: JfItem[] = [];
    for (const episodes of lists) {
      const sorted = [...episodes].sort((a, b) => (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) || (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0));
      let current = -1;
      sorted.forEach((e, i) => {
        if (e.UserData?.Played) current = i;
      });
      const next = current < 0 ? undefined : sorted.slice(current + 1).find((e) => !e.UserData?.Played && (e.ParentIndexNumber ?? 0) > 0);
      if (next) out.push(next);
    }
    return out.slice(0, limit);
  }

  /** Recently added films or episodes, newest first. */
  async latest(type: "Movie" | "Episode", limit = 20): Promise<JfItem[]> {
    // Plex's own type filter (1 = films, 4 = episodes) is a hint some versions ignore, so a wider
    // page is fetched and filtered here.
    const kind = type === "Movie" ? "1" : "4";
    const body = await this.get<PlexContainer>(`/library/recentlyAdded?type=${kind}&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit * 4}`);
    const wanted = type === "Movie" ? "Movie" : "Episode";
    return (body.MediaContainer?.Metadata ?? []).filter((m) => itemType(m.type) === wanted).slice(0, limit).map((m) => this.toJf(m));
  }

  async items(params: ItemsQuery): Promise<{ items: JfItem[]; total: number }> {
    const limit = params.limit ?? 60;
    const start = params.start ?? 0;
    const source = params.search ? await this.search(params.search, params.type) : await this.browse(params, limit, start);
    const kept = this.filterRating(source.items, params.maxRating);
    return { items: kept.slice(0, limit), total: source.total };
  }

  private async browse(params: ItemsQuery, limit: number, start: number): Promise<{ items: JfItem[]; total: number }> {
    const wanted = params.type === "Movie" ? "movie" : "show";
    const sections = (await this.sections()).filter((s) => s.type === wanted);
    const items: JfItem[] = [];
    let total = 0;
    for (const section of sections) {
      const q = new URLSearchParams({ "X-Plex-Container-Start": String(start), "X-Plex-Container-Size": String(limit) });
      if (params.genre) q.set("genre", params.genre);
      q.set("sort", params.sortBy === "DateCreated" ? "addedAt:desc" : "titleSort:asc");
      const body = await this.get<PlexContainer>(`/library/sections/${encodeURIComponent(section.key)}/all?${q}`);
      total += body.MediaContainer?.totalSize ?? body.MediaContainer?.size ?? 0;
      items.push(...(body.MediaContainer?.Metadata ?? []).map((m) => this.toJf(m)));
    }
    return { items, total };
  }

  /**
   * Plex's /search across every library: it answers either one Metadata list or a list of Hubs, so
   * both are read and the results kept are the ones of the wanted type.
   */
  private async search(query: string, type: "Movie" | "Series"): Promise<{ items: JfItem[]; total: number }> {
    const body = await this.get<PlexContainer>(
      `/search?query=${encodeURIComponent(query)}&X-Plex-Container-Start=0&X-Plex-Container-Size=50`,
    );
    const mc = body.MediaContainer ?? {};
    const raw = [...(mc.Metadata ?? []), ...(mc.Hub ?? []).flatMap((h) => h.Metadata ?? [])];
    const wanted = type === "Movie" ? "Movie" : "Series";
    const seen = new Set<string>();
    const items: JfItem[] = [];
    for (const m of raw) {
      if (itemType(m.type) !== wanted || !m.ratingKey) continue;
      const id = String(m.ratingKey);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(this.toJf(m));
    }
    return { items, total: items.length };
  }

  async item(id: string): Promise<JfItem> {
    const body = await this.get<PlexContainer>(`/library/metadata/${encodeURIComponent(id)}`);
    const item = body.MediaContainer?.Metadata?.[0];
    if (!item) throw new Error("Plex has no such item");
    return this.toJf(item);
  }

  /**
   * The provider-id index, built from its own copy of the libraries (cached for ten minutes) — the
   * same approach Jellyfin needs, because neither server can be asked "which item has this TMDB id".
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
      for (const section of (await this.sections()).filter((s) => s.type === "movie" || s.type === "show")) {
        const type = section.type === "movie" ? "Movie" : "Series";
        const body = await this.get<PlexContainer>(
          `/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1&X-Plex-Container-Start=0&X-Plex-Container-Size=10000`,
        );
        for (const m of body.MediaContainer?.Metadata ?? []) {
          if (!m.ratingKey) continue;
          for (const [key, value] of Object.entries(providerIdsOf(m))) index.set(`${type}|${key.toLowerCase()}|${value.toLowerCase()}`, String(m.ratingKey));
        }
      }
      return index;
    })();
    this.providerIndex = { at: Date.now(), map };
    map.catch(() => (this.providerIndex = null));
    return map;
  }

  async seasons(seriesId: string): Promise<JfItem[]> {
    const body = await this.get<PlexContainer>(`/library/metadata/${encodeURIComponent(seriesId)}/children`);
    return (body.MediaContainer?.Metadata ?? []).map((m) => ({ ...this.toJf({ ...m, type: "season" }), SeriesId: seriesId }));
  }

  async episodes(seriesId: string): Promise<JfItem[]> {
    const body = await this.get<PlexContainer>(`/library/metadata/${encodeURIComponent(seriesId)}/allLeaves`);
    return (body.MediaContainer?.Metadata ?? []).map((m) => this.toJf({ ...m, grandparentRatingKey: m.grandparentRatingKey ?? seriesId }));
  }

  /** Plex has no preview sheets the Hub can use. */
  trickplay(): undefined {
    return undefined;
  }

  /** Plex's `Marker[]` (intro and credits) as the Hub's segments, in Jellyfin's ticks. */
  async segments(itemId: string): Promise<MediaSegment[]> {
    try {
      const body = await this.get<PlexContainer>(`/library/metadata/${encodeURIComponent(itemId)}`);
      const markers = body.MediaContainer?.Metadata?.[0]?.Marker ?? [];
      const out: MediaSegment[] = [];
      for (const m of markers) {
        const kind = m.type === "intro" ? "Intro" : m.type === "credits" ? "Credits" : undefined;
        if (!kind) continue;
        const start = Number(m.startTimeOffset ?? 0);
        const end = Number(m.endTimeOffset ?? 0);
        if (!(end > start)) continue;
        out.push({ Type: kind, StartTicks: Math.round(start * TICKS_PER_MS), EndTicks: Math.round(end * TICKS_PER_MS) });
      }
      return out;
    } catch {
      return []; // No markers, or an older server.
    }
  }

  // Playback -------------------------------------------------------------

  /**
   * The original file, untouched: Plex serves a Part's file with `download=1`, which returns the
   * file itself rather than a redirect to a transcoder. The Part for a media source is remembered
   * from the item() that preceded this call.
   */
  streamUrl(itemId: string, mediaSourceId?: string): string {
    const path = (mediaSourceId ? this.parts.get(`${itemId}|${mediaSourceId}`) : undefined) ?? this.parts.get(`${itemId}|*`);
    if (!path) {
      // Nothing remembered (an item fetched by another Hub process, say): Plex's own file endpoint
      // still serves the item's first part.
      return withToken(`${this.base}/library/metadata/${encodeURIComponent(itemId)}/file?download=1`, this.auth.token);
    }
    return withToken(`${this.base}${path}${path.includes("?") ? "&" : "?"}download=1`, this.auth.token);
  }

  /**
   * Not implemented on purpose. Plex's universal transcoder needs a transcode session, a profile
   * and XML-ish query parameters the Hub has no use for; the Hub's "smaller copy" option falls back
   * to direct play for Plex instead (playback.ts), which every Plex item supports.
   */
  hlsUrl(_itemId: string, _mediaSourceId?: string, _session?: string, _maxHeight?: number, _videoBitrate?: number): string {
    throw new Error("Plex doesn't offer the smaller copy here: this Hub plays Plex files directly.");
  }

  /** An external subtitle file, by the stream key Plex gave it (remembered from item()). */
  /**
   * The external subtitle's own stream. Plex converts it on the way out (`encoding=utf-8`), so the
   * codec only picks the extension the player sees, exactly as Jellyfin's does.
   */
  subtitleUrl(itemId: string, mediaSourceId: string, index: number, _codec = "srt"): string {
    const key = this.parts.get(`${itemId}|${mediaSourceId}|${index}`);
    if (key) return withToken(`${this.base}${key}${key.includes("?") ? "&" : "?"}encoding=utf-8`, this.auth.token);
    return withToken(`${this.base}/library/streams/${index}?encoding=utf-8`, this.auth.token);
  }

  /**
   * Plex's timeline: the same three events Jellyfin has, as Plex's playing/paused/stopped states.
   * Plex wants a duration with the place, so the run time last seen for the item is sent.
   */
  async reportProgress(itemId: string, positionMs: number, event: "start" | "progress" | "stop", paused = false): Promise<void> {
    const state = event === "stop" ? "stopped" : paused ? "paused" : "playing";
    const q = new URLSearchParams({
      ratingKey: itemId,
      key: `/library/metadata/${itemId}`,
      state,
      time: String(Math.max(0, Math.round(positionMs))),
      duration: String(this.durations.get(itemId) ?? 0),
      identifier: "com.plexapp.plugins.library",
    });
    await this.send(`/:/timeline?${q}`);
  }

  async markPlayed(itemId: string, played: boolean): Promise<void> {
    const action = played ? "scrobble" : "unscrobble";
    await this.send(`/:/${action}?key=${encodeURIComponent(itemId)}&identifier=com.plexapp.plugins.library`);
  }

  /**
   * Plex has no "this one file is new" endpoint: it can only be told to rescan a section, which
   * reads the whole folder again. The scan is asked for, and the note says plainly that the file
   * turns up when Plex gets to it.
   */
  async mediaUpdated(_paths: string[]): Promise<{ added: boolean; note: string }> {
    await this.refreshLibrary().catch(() => {});
    return { added: false, note: "Plex picks new files up in its next scan (Settings › Libraries › Scan Library Files)." };
  }

  /** Asks Plex to scan every section, so new files appear and deleted ones go. */
  async refreshLibrary(): Promise<void> {
    await this.send("/library/sections/all/refresh");
  }

  // Mapping --------------------------------------------------------------

  image(item: JfItem, kind: MediaImageKind, maxWidth: number): string | undefined {
    const paths = this.imagePaths.get(item.Id);
    if (kind === "Logo") {
      const logo = paths?.logo;
      return logo ? withToken(`${this.base}${logo}?width=${maxWidth}`, this.auth.token) : undefined;
    }
    if (kind === "Backdrop") {
      const art = paths?.art ?? (item.SeriesId ? this.imagePaths.get(item.SeriesId)?.art : undefined);
      const path = art ?? (item.Id ? `/library/metadata/${item.Id}/art` : undefined);
      return path ? withToken(`${this.base}${path}?width=${maxWidth}`, this.auth.token) : undefined;
    }
    const thumb = paths?.thumb ?? (item.SeriesId ? this.imagePaths.get(item.SeriesId)?.thumb : undefined);
    const path = thumb ?? (item.Id ? `/library/metadata/${item.Id}/thumb` : undefined);
    return path ? withToken(`${this.base}${path}?width=${maxWidth}`, this.auth.token) : undefined;
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
    const poster = this.image(isEpisode ? { ...item, Id: item.SeriesId ?? item.Id } : item, "Primary", 400);
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

  /** Plex JSON → the Hub's item shape, remembering the parts and images it will be asked for. */
  private toJf(md: PlexMetadata): JfItem {
    const id = String(md.ratingKey ?? "");
    const item: JfItem = { Id: id, Name: md.title ?? "", Type: itemType(md.type) };
    if (md.year) item.ProductionYear = md.year;
    if (md.summary) item.Overview = md.summary;
    const genres = (md.Genre ?? []).map((g) => g.tag).filter((g): g is string => Boolean(g));
    if (genres.length) item.Genres = genres;
    const rating = md.audienceRating ?? md.rating;
    if (rating !== undefined) item.CommunityRating = rating;
    if (md.contentRating) item.OfficialRating = md.contentRating;
    // Plex reports milliseconds; the Hub's shape is Jellyfin's 100 ns ticks.
    if (md.duration) item.RunTimeTicks = md.duration * TICKS_PER_MS;
    const providers = providerIdsOf(md);
    if (Object.keys(providers).length) item.ProviderIds = providers;
    if (md.grandparentRatingKey) item.SeriesId = String(md.grandparentRatingKey);
    if (md.grandparentTitle) item.SeriesName = md.grandparentTitle;
    if (md.parentRatingKey && item.Type === "Episode") item.SeasonId = String(md.parentRatingKey);
    if (md.index !== undefined) item.IndexNumber = md.index;
    if (md.parentIndex !== undefined) item.ParentIndexNumber = md.parentIndex;
    if (md.originallyAvailableAt) item.PremiereDate = md.originallyAvailableAt;
    const people = (md.Role ?? []).map((r) => r.tag).filter((t): t is string => Boolean(t));
    if (people.length) item.People = people.map((Name) => ({ Name, Type: "Actor" }));
    if (md.viewOffset || md.viewCount || md.lastViewedAt) {
      item.UserData = {};
      if (md.viewOffset) item.UserData.PlaybackPositionTicks = md.viewOffset * TICKS_PER_MS;
      if ((md.viewCount ?? 0) > 0) item.UserData.Played = true;
      if (md.viewOffset && md.duration) item.UserData.PlayedPercentage = Math.min(100, (md.viewOffset / md.duration) * 100);
      if (md.lastViewedAt) item.UserData.LastPlayedDate = new Date(md.lastViewedAt * 1000).toISOString();
    }

    const sources: JfMediaSource[] = [];
    for (const media of md.Media ?? []) {
      for (const part of media.Part ?? []) {
        const sourceId = String(part.id ?? media.id ?? sources.length);
        const streams: JfStream[] = (part.Stream ?? []).map((s) => {
          const index = Number(s.index ?? s.id ?? 0);
          const stream: JfStream = { Type: streamType(s.streamType), Index: index };
          if (s.codec) stream.Codec = s.codec;
          if (s.language) stream.Language = s.language;
          if (s.displayTitle) stream.DisplayTitle = s.displayTitle;
          if (s.title) stream.Title = s.title;
          if (s.height) stream.Height = s.height;
          if (s.width) stream.Width = s.width;
          if (s.channels) stream.Channels = s.channels;
          if (s.profile) stream.Profile = s.profile;
          if (s.streamType === 2 && (s.channels ?? 0) === 0 && s.audioChannelLayout) stream.Channels = channelsOf(s.audioChannelLayout);
          // Plex says "external subtitle" by giving the stream a /library/streams key.
          if (s.streamType === 3 && s.key && !s.key.startsWith("/library/metadata")) {
            stream.IsExternal = true;
            this.parts.set(`${id}|${sourceId}|${index}`, s.key);
          }
          // HDR/Dolby Vision, from what Plex does say, so the quality badges stay right.
          if (s.DOVIPresent) stream.VideoRangeType = s.colorTrc === "smpte2084" ? "DOVI HDR10" : "DOVI";
          else if (s.colorTrc === "smpte2084") stream.VideoRangeType = "HDR10";
          else if (s.colorTrc === "arib-std-b67") stream.VideoRangeType = "HLG";
          return stream;
        });
        const source: JfMediaSource = { Id: sourceId };
        if (part.file) source.Path = part.file;
        if (part.container ?? media.container) source.Container = part.container ?? media.container;
        if (part.size) source.Size = part.size;
        if (media.bitrate) source.Bitrate = media.bitrate * 1000;
        if (streams.length) source.MediaStreams = streams;
        sources.push(source);
        if (part.key) {
          this.parts.set(`${id}|${sourceId}`, part.key);
          if (!this.parts.has(`${id}|*`)) this.parts.set(`${id}|*`, part.key);
        }
      }
    }
    if (sources.length) {
      item.MediaSources = sources;
      const first = sources[0]?.Path;
      if (first) item.Path = first;
    }
    if (md.duration) this.durations.set(id, md.duration);

    const logo = (md.Image ?? []).find((i) => i.type === "clearLogo" && i.url)?.url;
    this.imagePaths.set(id, { ...(md.thumb ? { thumb: md.thumb } : md.grandparentThumb ? { thumb: md.grandparentThumb } : {}), ...(md.art ? { art: md.art } : md.grandparentArt ? { art: md.grandparentArt } : {}), ...(logo ? { logo } : {}) });
    if (this.parts.size > 5_000) this.parts.clear();
    if (this.imagePaths.size > 2_000) this.imagePaths.clear();
    return item;
  }

  /**
   * A Kids profile's certificate limit, applied here because Plex has no MaxOfficialRating query.
   * Anything Plex doesn't rate is kept, as Jellyfin's filter does.
   */
  private filterRating(items: JfItem[], maxRating: string | undefined): JfItem[] {
    const max = plexRatingRank(maxRating);
    if (max === null) return items;
    return items.filter((i) => {
      const rank = plexRatingRank(i.OfficialRating);
      return rank === null || rank <= max;
    });
  }
}

/** Plex's audioChannelLayout as a channel count ("5.1" → 6, "stereo" → 2). */
function channelsOf(layout: string): number | undefined {
  if (/stereo/i.test(layout)) return 2;
  const m = /^(\d)(?:\.(\d))?/i.exec(layout.trim());
  if (!m) return undefined;
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0) + 1;
}

/** TMDB, IMDb and TVDB ids from a Plex item's Guid[] (or an older agent's guid). */
function providerIdsOf(md: PlexMetadata): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (value: string): void => {
    const match = /^(imdb|tmdb|tvdb):\/\/([^?]+)/i.exec(value);
    if (!match) return;
    const key = match[1]!.toLowerCase();
    const name = key === "imdb" ? "Imdb" : key === "tmdb" ? "Tmdb" : "Tvdb";
    out[name] = match[2]!;
  };
  for (const guid of md.Guid ?? []) if (guid?.id) add(String(guid.id));
  if (!Object.keys(out).length && md.guid) {
    // Older agents: com.plexapp.agents.themoviedb://123?lang=en
    const legacy = /com\.plexapp\.agents\.(imdb|themoviedb|tvdb):\/\/([^?]+)/i.exec(String(md.guid));
    if (legacy) {
      const key = legacy[1]!.toLowerCase();
      const name = key === "imdb" ? "Imdb" : key === "themoviedb" ? "Tmdb" : "Tvdb";
      out[name] = legacy[2]!;
    } else {
      add(String(md.guid));
    }
  }
  return out;
}

/**
 * The seasons of a series, from its episodes, and which episode to carry on with: both live in
 * media.ts, beside the shape they work on, and are shared by the two clients.
 */
export { groupSeasons, resumeEpisode };
