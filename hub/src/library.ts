// The unified Films & TV library: one title however many places it lives (Jellyfin, IPTV VOD,
// AIOStreams/TorBox), home rails, search, and the ranked list of ways to play each title.

import type {
  Channel,
  HomeScreen,
  NowNext,
  Rail,
  SearchResult,
  Season,
  StreamCandidate,
  StreamQuality,
  TitleDetails,
  TitleKind,
  TitleRef,
} from "@ultimatetv/shared";
import { episodeLabel, normaliseTitle, parseQuality, qualityBadges, rankStreams, startOfDay } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import { demoSeasons } from "./demo.js";
import type { VodEntry } from "./ingest/index.js";
import { type ContentFilter, NO_FILTER } from "./profiles.js";
import { XtreamClient } from "./ingest/xtream.js";
import { groupSeasons, type JfItem, type JfMediaSource } from "./services/jellyfin.js";
import { streamToCandidate } from "./services/stremio.js";
import { GENRES } from "./services/tmdb.js";

export interface EpisodeRef {
  season: number;
  episode: number;
}

/** Quality of a Jellyfin file from its media streams. */
export function jellyfinQuality(source: JfMediaSource | undefined): StreamQuality {
  const streams = source?.MediaStreams ?? [];
  const video = streams.find((s) => s.Type === "Video");
  const audio = streams.find((s) => s.Type === "Audio" && s.IsDefault) ?? streams.find((s) => s.Type === "Audio");
  const text = [video?.DisplayTitle, video?.VideoRangeType, video?.Codec, audio?.DisplayTitle, audio?.Codec, audio?.Profile, source?.Path?.split("/").pop()].filter(Boolean).join(" ");
  const q = parseQuality(text);
  if (video?.Height) q.height = video.Height >= 2000 ? 2160 : video.Height >= 1000 ? 1080 : video.Height >= 700 ? 720 : 576;
  const range = video?.VideoRangeType ?? "";
  if (/DOVI/i.test(range)) {
    q.hdr = "dv";
    q.dvProfile = /HDR10|HLG|SDR/i.test(range.replace("DOVI", "")) ? 8 : (q.dvProfile ?? 5);
  } else if (/HDR10Plus/i.test(range)) q.hdr = "hdr10plus";
  else if (/HDR10/i.test(range)) q.hdr = "hdr10";
  else if (/HLG/i.test(range)) q.hdr = "hlg";
  if (audio?.Channels) q.channels = audio.Channels;
  if (source?.Size) q.sizeBytes = source.Size;
  return q;
}

export class NotAllowedError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("That isn't available on this profile");
  }
}

export class Library {
  constructor(private ctx: HubContext) {}

  private prefs() {
    const p = this.ctx.settings.get().playback;
    return { maxSizeGb: p.maxSizeGb, avoidDvProfile5: p.avoidDvProfile5, preferredLang: p.preferredAudioLang };
  }

  // -------------------------------------------------------------------------
  // Home

  nowNextFor(channels: Channel[], at = Date.now()): NowNext[] {
    return channels.map((channel) => ({ channel, ...this.ctx.guide.nowNext(channel.id, at) }));
  }

  /**
   * TMDB for the discovery rails (popular, trending, genres), only when an addon such as
   * AIOStreams can find a stream for any title. Without one, those titles mostly can't play, so
   * Films and TV show just the library and IPTV.
   */
  private discovery() {
    return this.ctx.addons().length ? this.ctx.tmdb() : null;
  }

  async home(now = Date.now(), f: ContentFilter = NO_FILTER): Promise<HomeScreen> {
    const jf = this.ctx.jellyfin();
    const tmdb = this.discovery();
    const channels = f.channels(this.ctx.channels.list());
    const favourites = channels.filter((c) => c.favourite);
    const liveChannels = (favourites.length >= 6 ? favourites : [...favourites, ...channels.filter((c) => !c.favourite)]).slice(0, 16);

    const max = f.profile?.maxCertification;
    const [resume, nextUp, latestRaw, trendingRaw, kidsFilms, kidsSeries] = await Promise.all([
      jf ? jf.resume(12).catch(() => []) : [],
      jf ? jf.nextUp(12).catch(() => []) : [],
      jf ? jf.latest("Movie", 16).catch(() => []) : [],
      tmdb ? tmdb.trending(20).catch(() => []) : [],
      tmdb && f.kids ? tmdb.discover("movie", "Family", 20, max).catch(() => []) : [],
      tmdb && f.kids ? tmdb.discover("series", "Kids", 20).catch(() => []) : [],
    ]);
    const latestMovies = latestRaw.filter((i) => f.ref(jf!.toTitleRef(i)));
    const trending = trendingRaw.filter((t) => f.ref(t));

    const continueItems: TitleRef[] = [
      ...resume.map((i) => ({ ...jf!.toTitleRef(i), id: `jellyfin:${i.Type === "Episode" ? i.SeriesId : i.Id}` })),
      ...this.ctx.progress.continueWatching(12).map((p) => ({ ...p.title!, progress: p.durationMs ? p.positionMs / p.durationMs : 0 })),
    ]
      .filter((t) => f.ref(t))
      .slice(0, 16);

    const rails: Rail[] = [];
    if (liveChannels.length) rails.push({ id: "live", title: "Live now", kind: "channels", items: [], channels: this.nowNextFor(liveChannels, now) });
    if (continueItems.length) rails.push({ id: "continue", title: "Continue watching", kind: "titles", items: continueItems });
    const allowed = new Set(channels.map((c) => c.id));
    const recent = this.ctx.recordings.withStatus("completed").filter((r) => !r.watched && allowed.has(r.channelId)).sort((a, b) => b.programme.start - a.programme.start).slice(0, 16);
    if (recent.length) rails.push({ id: "recordings", title: "Recently recorded", kind: "recordings", items: [], recordings: recent });
    const nextUpRefs = nextUp.map((i) => ({ ...jf!.toTitleRef(i), id: `jellyfin:${i.SeriesId}` })).filter((t) => f.ref(t));
    if (nextUpRefs.length) rails.push({ id: "nextup", title: "Next up", kind: "titles", items: nextUpRefs });
    if (kidsFilms.length) rails.push({ id: "kids-films", title: "Family films", kind: "titles", items: kidsFilms.filter((t) => f.ref(t)) });
    if (kidsSeries.length) rails.push({ id: "kids-series", title: "Cartoons and kids' shows", kind: "titles", items: kidsSeries.filter((t) => f.ref(t)) });

    const evening = startOfDay(now) + 18 * 3_600_000;
    const films = this.ctx.guide.films(Math.max(now - 30 * 60_000, evening - 6 * 3_600_000), startOfDay(now) + 24 * 3_600_000, 16).filter((p) => allowed.has(p.channelId));
    if (films.length) {
      rails.push({
        id: "films-tonight",
        title: "Films on TV today",
        kind: "titles",
        items: films.map((p) => {
          const ref: TitleRef = { id: `programme:${p.id}`, kind: "movie", name: p.title.replace(/^film\s*:\s*/i, ""), subtitle: `${new Date(p.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · ${this.ctx.channels.get(p.channelId)?.name ?? ""}` };
          if (p.year) ref.year = p.year;
          if (p.image) ref.poster = p.image;
          return ref;
        }),
      });
    }
    if (latestMovies.length) rails.push({ id: "latest", title: "Recently added", kind: "titles", items: latestMovies.map((i) => jf!.toTitleRef(i)) });
    if (trending.length) rails.push({ id: "trending", title: "Trending this week", kind: "titles", items: trending });
    const iptvRecent = this.vodRecent(16).filter((t) => f.ref(t));
    if (iptvRecent.length) rails.push({ id: "iptv-vod", title: "New films from your IPTV", kind: "titles", items: iptvRecent });

    const heroSource = continueItems.find((t) => t.backdrop) ?? trending.find((t) => t.backdrop) ?? latestMovies.map((i) => jf!.toTitleRef(i)).find((t) => t.backdrop);
    const home: HomeScreen = { rails };
    if (heroSource) {
      home.hero = { ...heroSource, action: continueItems.includes(heroSource) ? "resume" : "watch" };
      const d = await this.details(heroSource.id, f).catch(() => null);
      if (d?.overview) home.hero.overview = d.overview;
      if (d?.logo && !home.hero.logo) home.hero.logo = d.logo;
      const meta = [d?.year, d?.certification, d?.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
      if (meta) home.hero.subtitle = meta;
    }
    return home;
  }

  /** Films or TV landing page: library first, then discovery by genre. */
  async browse(kind: TitleKind, f: ContentFilter = NO_FILTER): Promise<Rail[]> {
    const jf = this.ctx.jellyfin();
    const tmdb = this.discovery();
    const rails: Rail[] = [];
    const max = f.jellyfinMaxRating();
    if (jf) {
      const lib = await jf.items({ type: kind === "movie" ? "Movie" : "Series", sortBy: "DateCreated", limit: 30, ...(max ? { maxRating: max } : {}) }).catch(() => ({ items: [] as JfItem[], total: 0 }));
      const items = lib.items.map((i) => jf.toTitleRef(i)).filter((t) => f.ref(t));
      if (items.length) rails.push({ id: "library", title: "In your library", kind: "titles", items });
    }
    if (tmdb) {
      const popular = f.kids ? [] : await tmdb.popular(kind).catch(() => []);
      if (popular.length) rails.push({ id: "popular", title: kind === "movie" ? "Popular films" : "Popular series", kind: "titles", items: popular });
      const genres = f.kids ? ["Kids", "Animation", "Comedy"] : Object.keys(GENRES).filter((g) => g !== "Kids");
      const lists = await Promise.all(genres.map((g) => tmdb.discover(kind, g, 20, max).catch(() => [])));
      genres.forEach((g, i) => {
        const items = lists[i]!.filter((t) => f.ref(t));
        if (items.length) rails.push({ id: `genre-${g}`, title: g, kind: "titles", items });
      });
    }
    const vod = this.ctx.db
      .json<VodEntry>("SELECT data FROM vod WHERE kind = ? ORDER BY json_extract(data, '$.added') DESC LIMIT 40", kind)
      .map((e) => this.vodRef(e))
      .filter((t) => f.ref(t));
    if (vod.length) rails.push({ id: "iptv", title: "From your IPTV", kind: "titles", items: vod });
    return rails;
  }

  private vodRecent(limit: number): TitleRef[] {
    return this.ctx.db.json<VodEntry>("SELECT data FROM vod WHERE kind = 'movie' ORDER BY json_extract(data, '$.added') DESC LIMIT ?", limit).map((e) => this.vodRef(e));
  }

  private vodRef(e: VodEntry): TitleRef {
    const ref: TitleRef = { id: e.tmdbId && this.ctx.tmdb() ? `tmdb:${e.kind}:${e.tmdbId}` : e.id, kind: e.kind, name: e.name };
    if (e.year) ref.year = e.year;
    if (e.poster) ref.poster = e.poster;
    if (e.backdrop) ref.backdrop = e.backdrop;
    if (e.genres?.length) ref.genres = e.genres;
    else if (e.category) ref.genres = [e.category];
    return ref;
  }

  // -------------------------------------------------------------------------
  // Details

  private vodById(id: string): VodEntry | undefined {
    return this.ctx.db.jsonOne<VodEntry>("SELECT data FROM vod WHERE id = ?", id);
  }

  private vodMatches(kind: TitleKind, name: string, year?: number, tmdbId?: number): VodEntry[] {
    const byTmdb = tmdbId ? this.ctx.db.json<VodEntry>("SELECT data FROM vod WHERE kind = ? AND json_extract(data, '$.tmdbId') = ?", kind, tmdbId) : [];
    if (byTmdb.length) return byTmdb;
    const rows = this.ctx.db.json<VodEntry>("SELECT data FROM vod WHERE kind = ? AND name_norm = ?", kind, normaliseTitle(name));
    return rows.filter((r) => !year || !r.year || Math.abs(r.year - year) <= 1);
  }

  /** Details, refused when the profile isn't allowed to see the title. */
  async details(id: string, f: ContentFilter = NO_FILTER): Promise<TitleDetails> {
    if (f.kids && id.startsWith("programme:")) {
      const p = this.ctx.guide.get(id.slice("programme:".length));
      if (p && !f.programme(p, this.ctx.channels.get(p.channelId))) throw new NotAllowedError();
    }
    const d = await this.lookup(id);
    if (!f.title(d) && !(id.startsWith("programme:") && f.kids)) throw new NotAllowedError();
    return d;
  }

  private async lookup(id: string): Promise<TitleDetails> {
    const [source, ...rest] = id.split(":");
    const jf = this.ctx.jellyfin();
    const tmdb = this.ctx.tmdb();

    if (source === "programme") {
      const p = this.ctx.guide.get(rest.join(":"));
      if (!p) throw new Error("That programme has finished");
      if (tmdb) {
        const match = await tmdb.match(p.isFilm ? "movie" : "series", p.title.replace(/^film\s*:\s*/i, ""), p.year).catch(() => null);
        if (match) return this.details(match.id);
      }
      return { id, kind: p.isFilm ? "movie" : "series", name: p.title, genres: p.categories, cast: [], availability: [], inLibrary: false, ...(p.description ? { overview: p.description } : {}), ...(p.image ? { poster: p.image } : {}) };
    }

    if (source === "jellyfin") {
      if (!jf) throw new Error("Jellyfin isn't connected");
      const item = await jf.item(rest[0]!);
      const episodes = item.Type === "Series" ? await jf.episodes(item.Id) : [];
      const d = jf.toDetails(item, episodes);
      await this.addAvailability(d);
      return d;
    }

    if (source === "tmdb") {
      const kind = rest[0] as TitleKind;
      const tmdbId = Number(rest[1]);
      let d: TitleDetails;
      if (tmdb) d = await tmdb.details(kind, tmdbId);
      else d = { id, kind, name: "Unknown", genres: [], cast: [], availability: [], inLibrary: false, tmdbId };
      if (jf) {
        const item = await jf.byProviderId("tmdb", String(tmdbId), kind === "movie" ? "Movie" : "Series").catch(() => undefined);
        if (item) {
          const episodes = item.Type === "Series" ? await jf.episodes(item.Id).catch(() => []) : [];
          const local = jf.toDetails(item, episodes);
          d = { ...d, inLibrary: true, ...(local.resumeMs ? { resumeMs: local.resumeMs } : {}) };
          if (local.seasons?.length) d.seasons = mergeSeasons(d.seasons ?? [], local.seasons);
          if (!d.poster && local.poster) d.poster = local.poster;
          if (!d.backdrop && local.backdrop) d.backdrop = local.backdrop;
        }
      }
      await this.addAvailability(d);
      return d;
    }

    if (source === "xtream" || source === "m3u" || source === "demo") {
      const e = this.vodById(id);
      if (!e) throw new Error("That title is no longer in your IPTV catalogue");
      if (tmdb && e.tmdbId) return this.details(`tmdb:${e.kind}:${e.tmdbId}`);
      if (tmdb) {
        const match = await tmdb.match(e.kind, e.name, e.year).catch(() => null);
        if (match) return this.details(match.id);
      }
      const demo = e.sourceId === "demo";
      const d: TitleDetails = { id, kind: e.kind, name: e.name, genres: e.genres ?? (e.category ? [e.category] : []), cast: [], availability: [demo ? "nas" : "xtream"], inLibrary: demo };
      if (e.year) d.year = e.year;
      if (e.poster) d.poster = e.poster;
      if (e.backdrop) d.backdrop = e.backdrop;
      if (e.overview) d.overview = e.overview;
      if (e.rating) d.rating = e.rating;
      const p = this.ctx.progress.get(`title:${id}`);
      if (p && !p.watched) d.resumeMs = p.positionMs;
      if (e.kind === "series") d.seasons = demo ? demoSeasons(e.upstreamId) : await this.xtreamSeasons(e);
      return d;
    }
    throw new Error(`Unknown title ${id}`);
  }

  private async addAvailability(d: TitleDetails): Promise<void> {
    const kinds = new Set(d.availability);
    if (d.inLibrary) kinds.add("jellyfin");
    if (this.vodMatches(d.kind, d.name, d.year, d.tmdbId).length) kinds.add("xtream");
    if (d.imdbId && this.ctx.addons().length) kinds.add("addon");
    d.availability = [...kinds];
    const p = this.ctx.progress.get(`title:${d.id}`);
    if (p && !p.watched && !d.resumeMs) d.resumeMs = p.positionMs;
  }

  async season(id: string, season: number, f: ContentFilter = NO_FILTER): Promise<Season | undefined> {
    const d = await this.details(id, f);
    const existing = d.seasons?.find((s) => s.season === season);
    if (existing?.episodes.length) return existing;
    const tmdb = this.ctx.tmdb();
    if (tmdb && d.tmdbId) return tmdb.season(d.tmdbId, season);
    return existing;
  }

  private async xtreamSeasons(e: VodEntry): Promise<Season[]> {
    const client = this.xtreamClient(e.sourceId);
    if (!client) return [];
    const info = await client.seriesInfo(e.upstreamId).catch(() => null);
    const eps = Object.entries(info?.episodes ?? {}).flatMap(([season, list]) => list.map((ep) => ({ ...ep, season: Number(season) })));
    return groupSeasons(eps, (ep) => ({
      id: `${e.id}:episode:${ep.id}:${ep.container_extension ?? "mkv"}`,
      season: ep.season,
      episode: Number(ep.episode_num),
      name: ep.title ?? `Episode ${ep.episode_num}`,
      ...(ep.info?.plot ? { overview: ep.info.plot } : {}),
      ...(ep.info?.movie_image ? { still: ep.info.movie_image } : {}),
    }));
  }

  private xtreamClient(sourceId: string): XtreamClient | null {
    const source = this.ctx.settings.get().iptv.find((s) => s.id === sourceId);
    return source?.kind === "xtream" ? new XtreamClient(source, this.ctx.fetchImpl) : null;
  }

  // -------------------------------------------------------------------------
  // Streams

  /** Every way to play a title (or one episode of it), best first. */
  async streams(id: string, ep?: EpisodeRef, f: ContentFilter = NO_FILTER): Promise<StreamCandidate[]> {
    const d = await this.details(id, f);
    const candidates: StreamCandidate[] = [];
    const jf = this.ctx.jellyfin();

    // Jellyfin: the file on the NAS.
    if (jf && d.inLibrary) {
      try {
        let item: JfItem | undefined;
        if (id.startsWith("jellyfin:")) item = await jf.item(id.slice(9));
        else if (d.tmdbId) item = await jf.byProviderId("tmdb", String(d.tmdbId), d.kind === "movie" ? "Movie" : "Series");
        if (item && item.Type === "Series" && ep) {
          const episodes = await jf.episodes(item.Id);
          item = episodes.find((e) => e.ParentIndexNumber === ep.season && e.IndexNumber === ep.episode);
          if (item) item = await jf.item(item.Id);
        }
        if (item && item.Type !== "Series") {
          for (const src of item.MediaSources ?? []) {
            candidates.push({ id: `jellyfin:${item.Id}:${src.Id}`, kind: "jellyfin", label: "Jellyfin", detail: src.Path?.split("/").pop() ?? src.Container ?? "", quality: jellyfinQuality(src), ready: true, url: jf.streamUrl(item.Id, src.Id), downloadable: false });
          }
        }
      } catch (err) {
        this.ctx.log.warn({ id, err: String(err) }, "Jellyfin streams failed");
      }
    }

    // IPTV VOD.
    for (const e of this.vodMatches(d.kind, d.name, d.year, d.tmdbId)) {
      const client = this.xtreamClient(e.sourceId);
      if (d.kind === "movie") {
        const url = e.url ?? client?.movieUrl(e.upstreamId, e.ext);
        const demo = e.sourceId === "demo";
        if (url) candidates.push({ id: `xtream:${e.id}`, kind: demo ? "nas" : "xtream", label: demo ? "Your library" : "IPTV", detail: e.name, quality: vodQuality(e), ready: true, url, downloadable: !demo, ...(e.lang ? { lang: e.lang } : {}) });
      } else if (ep && e.sourceId === "demo" && e.url) {
        candidates.push({ id: `xtream:${e.id}:s${ep.season}e${ep.episode}`, kind: "nas", label: "Your library", detail: `${e.name} ${episodeLabel(ep.season, ep.episode)}`, quality: vodQuality(e), ready: true, url: e.url, downloadable: false });
      } else if (ep && client) {
        const seasons = await this.xtreamSeasons(e);
        const found = seasons.find((s) => s.season === ep.season)?.episodes.find((x) => x.episode === ep.episode);
        if (found) {
          const parts = found.id.split(":");
          const epId = parts[5];
          const ext = parts[6];
          candidates.push({ id: `xtream:${found.id}`, kind: "xtream", label: "IPTV", detail: found.name, quality: { height: 1080, hdr: "sdr", codec: "unknown", audio: "unknown" }, ready: true, url: client.episodeUrl(epId!, ext), downloadable: true, ...(e.lang ? { lang: e.lang } : {}) });
        }
      }
    }

    // Stremio addons (AIOStreams → TorBox).
    if (d.imdbId) {
      const addonId = d.kind === "movie" ? d.imdbId : ep ? `${d.imdbId}:${ep.season}:${ep.episode}` : null;
      if (addonId) {
        const results = await Promise.all(
          this.ctx.addons().map(async (a) => {
            try {
              const [manifest, streams] = await Promise.all([a.manifest().catch(() => ({ name: "Addon" })), a.streams(d.kind, addonId)]);
              return streams.map((s, i) => streamToCandidate(s, manifest.name, i)).filter((c): c is StreamCandidate => c !== null);
            } catch (err) {
              this.ctx.log.warn({ err: String(err) }, "Addon streams failed");
              return [];
            }
          }),
        );
        let n = 0;
        for (const list of results) for (const c of list) candidates.push({ ...c, id: `addon:${n++}` });
      }
    }
    return rankStreams(candidates, this.prefs());
  }

  // -------------------------------------------------------------------------
  // Search

  async search(query: string, now = Date.now(), f: ContentFilter = NO_FILTER): Promise<SearchResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const norm = normaliseTitle(q);
    const results: SearchResult[] = [];

    const channels = f.channels(this.ctx.channels.list());
    const allowed = new Set(channels.map((c) => c.id));
    for (const c of channels) {
      if (normaliseTitle(c.name).includes(norm) || String(c.number) === q) {
        results.push({ kind: "channel", id: c.id, name: c.name, subtitle: `Channel ${c.number}`, channel: c, ...(c.logo ? { image: c.logo } : {}) });
      }
    }
    for (const p of this.ctx.guide.search(q, now, now + 7 * 86_400_000, 30)) {
      if (!allowed.has(p.channelId)) continue;
      const channel = this.ctx.channels.get(p.channelId);
      const onNow = p.start <= now && p.end > now;
      results.push({
        kind: onNow ? "on-now" : "upcoming",
        id: p.id,
        name: p.title,
        subtitle: `${onNow ? "On now" : new Date(p.start).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${channel?.name ?? ""}`,
        programme: p,
        ...(channel ? { channel } : {}),
      });
    }
    for (const r of this.ctx.recordings.withStatus("completed")) {
      if (allowed.has(r.channelId) && normaliseTitle(r.programme.title).includes(norm)) results.push({ kind: "recording", id: r.id, name: r.programme.title, subtitle: `Recorded · ${r.channelName}`, recording: r });
    }

    const titles = new Map<string, TitleRef>();
    const max = f.jellyfinMaxRating();
    const tmdb = this.ctx.tmdb();
    const jf = this.ctx.jellyfin();
    const [tm, local] = await Promise.all([
      tmdb ? tmdb.search(q, 20).catch((): TitleRef[] => []) : ([] as TitleRef[]),
      jf ? Promise.all([jf.items({ type: "Movie", search: q, limit: 10, ...(max ? { maxRating: max } : {}) }), jf.items({ type: "Series", search: q, limit: 10, ...(max ? { maxRating: max } : {}) })]).then(([a, b]) => [...a.items, ...b.items].map((i) => jf.toTitleRef(i))).catch((): TitleRef[] => []) : ([] as TitleRef[]),
    ]);
    for (const t of [...local, ...tm]) if (!titles.has(t.id)) titles.set(t.id, local.includes(t) ? { ...t, badges: ["In your library"] } : t);
    for (const e of this.ctx.db.json<VodEntry>("SELECT data FROM vod WHERE name_norm LIKE ? LIMIT 20", `%${norm}%`)) {
      const ref = this.vodRef(e);
      if (!titles.has(ref.id)) titles.set(ref.id, ref);
    }
    for (const t of titles.values()) if (f.ref(t)) results.push({ kind: "title", id: t.id, name: t.name, ...(t.year ? { subtitle: String(t.year) } : {}), ...(t.poster ? { image: t.poster } : {}), title: t });
    return results;
  }

  badgesFor(c: StreamCandidate): string[] {
    return qualityBadges(c.quality);
  }
}

function vodQuality(e: VodEntry): StreamQuality {
  const q = parseQuality(`${e.name} ${e.category ?? ""}`);
  if (!q.height) q.height = 1080;
  return q;
}

function mergeSeasons(remote: Season[], local: Season[]): Season[] {
  const map = new Map(remote.map((s) => [s.season, s]));
  for (const s of local) {
    const r = map.get(s.season);
    map.set(s.season, r && r.episodes.length > s.episodes.length ? r : { ...s, name: r?.name ?? s.name });
  }
  return [...map.values()].sort((a, b) => (a.season === 0 ? 1 : b.season === 0 ? -1 : a.season - b.season));
}
