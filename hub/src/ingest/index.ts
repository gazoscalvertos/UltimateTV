// Refreshes channels, guide data and the IPTV VOD catalogue from every configured source.

import type { IptvSource, IptvSourceStatus, Programme, TitleKind } from "@ultimatetv/shared";
import { languageTag, normaliseTitle } from "@ultimatetv/shared";
import { buildChannels, ChannelStore, type RawFeed } from "../channels.js";
import type { Db } from "../db.js";
import { EpgMatcher, GuideStore, toProgramme } from "../epg.js";
import { fetchOk, fetchStream, redactUrl, withUserAgent, type Fetch } from "../http.js";
import type { Logger } from "../log.js";
import { dedupeSources, type SettingsStore } from "../settings.js";
import { parseM3u } from "./m3u.js";
import { parseXmltv } from "./xmltv.js";
import { XtreamClient } from "./xtream.js";

export interface VodEntry {
  id: string;
  kind: TitleKind;
  sourceId: string;
  name: string;
  year?: number;
  poster?: string;
  rating?: number;
  tmdbId?: number;
  category?: string;
  /** Xtream stream or series id, or the URL for M3U entries. */
  upstreamId: string;
  ext?: string;
  url?: string;
  added?: number;
  backdrop?: string;
  overview?: string;
  genres?: string[];
  /** Language from the provider's tag on the name or category ("FR - …", "|DE| Films"). */
  lang?: string;
}

export interface SourceMeta {
  timeZone?: string;
  epgUrls: string[];
  expires?: number;
  maxConnections?: number;
}

const YEAR = /\((\d{4})\)|\b(19\d{2}|20\d{2})\b/;

export function splitYear(name: string): { name: string; year?: number } {
  const m = YEAR.exec(name);
  const yearText = m?.[1] ?? m?.[2];
  if (!yearText) return { name: name.trim() };
  const cleaned = name.replace(m![0], "").replace(/\s*[-|:]\s*$/, "").replace(/\s+/g, " ").trim();
  return cleaned ? { name: cleaned, year: Number(yearText) } : { name: name.trim() };
}

/**
 * Drops provider prefixes like "EN - ", "|UK| ", "[DE] " or "4K-FR-HDR - " from VOD names, so the
 * copies of a film in every language match it. Each part of a dashed prefix is two or three
 * capitals or contains a digit, so a title such as "TRON: Legacy" stays whole.
 */
export function cleanVodName(name: string): string {
  return name.replace(/^\s*(\|[A-Z0-9-]{2,12}\||\[[A-Z0-9-]{2,12}\]|(?:[A-Z]{2,3}|(?=[A-Z]*\d)[A-Z0-9]{2,4})(?:-(?:[A-Z]{2,3}|(?=[A-Z]*\d)[A-Z0-9]{2,4}))*\s*[-:|])\s*/, "").trim();
}

/** A readable reason, including what undici hides in `cause` ("fetch failed" alone says nothing). */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === "TimeoutError") return "The provider took too long to answer";
  const cause = (err as Error & { cause?: unknown }).cause;
  const detail = cause instanceof Error ? ((cause as Error & { code?: string }).code ?? cause.message) : cause ? String(cause) : "";
  return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message;
}

/** Logs each provider and guide request at debug level: host and path only, never the query (it holds logins). */
function logRequests(fetchImpl: Fetch, log: Logger): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const where = `${url.host}${redactUrl(url.pathname)}`;
    const action = url.searchParams.get("action") ?? undefined;
    const started = Date.now();
    try {
      const res = await fetchImpl(input, init);
      log.debug({ url: where, action, status: res.status, bytes: Number(res.headers.get("content-length")) || undefined, ms: Date.now() - started }, "IPTV/guide request");
      return res;
    } catch (err) {
      log.debug({ url: where, action, err: describeError(err), ms: Date.now() - started }, "IPTV/guide request failed");
      throw err;
    }
  }) as Fetch;
}

export class Ingestor {
  private running: Promise<unknown> | null = null;
  /** A refresh asked for while one was running; the running one may have read old settings. */
  private again = false;

  constructor(
    private db: Db,
    private settings: SettingsStore,
    private channels: ChannelStore,
    private guide: GuideStore,
    private log: Logger,
    fetchImpl: Fetch = fetch,
  ) {
    this.fetchImpl = logRequests(withUserAgent(fetchImpl), log);
  }

  private fetchImpl: Fetch;

  sourceMeta(sourceId: string): SourceMeta | undefined {
    return this.db.getKv<SourceMeta>(`source:${sourceId}`);
  }

  sourceStatus(sourceId: string): IptvSourceStatus | undefined {
    return this.db.getKv<IptvSourceStatus>(`sourceStatus:${sourceId}`);
  }

  /**
   * Refreshes everything. A call during a run waits for it and then runs once more, because a source
   * added mid-run (say an M3U right after an Xtream) wasn't in the settings that run read.
   */
  refreshAll(): Promise<unknown> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.refreshSources();
          await this.refreshGuide();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  async refreshSources(): Promise<{ channels: number; vod: number }> {
    const s = this.settings.get();
    const raw: RawFeed[] = [];
    const vod: VodEntry[] = [];
    const loaded = new Map<string, number>();
    for (const source of dedupeSources(s.iptv)) {
      try {
        const result = source.kind === "xtream" ? await this.loadXtream(source) : await this.loadM3u(source);
        // Not push(...list): a big VOD catalogue has more entries than a call can take as arguments.
        for (const f of result.feeds) raw.push(f);
        for (const v of result.vod) vod.push(v);
        loaded.set(source.id, result.feeds.length);
        this.log.info({ source: source.name, kind: source.kind, streams: result.feeds.length, vod: result.vod.length }, "IPTV source loaded");
        if (result.feeds.length === 0) this.setStatus(source.id, { at: Date.now(), ok: false, streams: 0, error: "The provider sent no live channels" });
      } catch (err) {
        this.log.warn({ source: source.name, kind: source.kind, err: describeError(err) }, "IPTV source failed to load");
        this.setStatus(source.id, { at: Date.now(), ok: false, error: describeError(err) });
      }
    }
    if (raw.length === 0 && s.iptv.length > 0) {
      this.log.warn("No channels loaded; keeping the previous channel list");
      return { channels: this.channels.count(), vod: 0 };
    }
    let filter: RegExp | null = null;
    if (s.channelFilter) {
      try {
        filter = new RegExp(s.channelFilter, "i");
      } catch {
        this.log.warn({ filter: s.channelFilter }, "Channel filter is not a valid regular expression; showing everything");
      }
    }
    let built = buildChannels(raw, { numbering: s.numbering, filter, existing: this.channels.existingFlags() });
    if (filter && !built.channels.some((c) => !c.hidden)) {
      // A filter that hides every channel would leave Live TV empty, which looks like the source is broken.
      this.log.warn({ filter: s.channelFilter, channels: built.channels.length }, "Channel filter matched no channels; showing them all");
      built = buildChannels(raw, { numbering: s.numbering, filter: null, existing: new Map() });
    }
    this.channels.replace(built.channels, built.feeds);
    for (const [sourceId, streams] of loaded) {
      if (streams === 0) continue;
      const ids = new Set(built.feeds.filter((f) => f.sourceId === sourceId).map((f) => f.channelId));
      const visible = built.channels.filter((c) => !c.hidden && ids.has(c.id)).length;
      this.setStatus(sourceId, { at: Date.now(), ok: true, streams, visible });
    }
    this.replaceVod(vod);
    this.db.setKv("sourcesUpdatedAt", Date.now());
    this.log.info({ channels: built.channels.filter((c) => !c.hidden).length, all: built.channels.length, vod: vod.length }, "Sources refreshed");
    return { channels: built.channels.length, vod: vod.length };
  }

  private setStatus(sourceId: string, status: IptvSourceStatus): void {
    this.db.setKv(`sourceStatus:${sourceId}`, status);
  }

  private async loadXtream(source: Extract<IptvSource, { kind: "xtream" }>): Promise<{ feeds: RawFeed[]; vod: VodEntry[] }> {
    const client = new XtreamClient(source, this.fetchImpl);
    const auth = await client.auth();
    if (auth.user_info && auth.user_info.auth === 0) throw new Error("Xtream login was rejected");
    const meta: SourceMeta = { epgUrls: [client.xmltvUrl()] };
    if (auth.server_info?.timezone) meta.timeZone = auth.server_info.timezone;
    if (auth.user_info?.exp_date) meta.expires = Number(auth.user_info.exp_date) * 1000;
    if (auth.user_info?.max_connections) meta.maxConnections = Number(auth.user_info.max_connections);
    this.db.setKv(`source:${source.id}`, meta);

    const [cats, streams] = await Promise.all([client.liveCategories(), client.liveStreams()]);
    const catName = new Map(cats.map((c) => [String(c.category_id), c.category_name]));
    const feeds: RawFeed[] = streams.map((st, i) => {
      const feed: RawFeed = {
        sourceId: source.id,
        upstreamId: String(st.stream_id),
        name: st.name,
        url: client.liveUrl(st.stream_id),
        catchupDays: Number(st.tv_archive) === 1 ? Number(st.tv_archive_duration) || 0 : 0,
        providerNumber: st.num ?? i + 1,
      };
      const group = catName.get(String(st.category_id));
      if (group) feed.group = group;
      if (st.stream_icon) feed.logo = st.stream_icon;
      if (st.epg_channel_id) feed.epgId = st.epg_channel_id;
      return feed;
    });

    const vod: VodEntry[] = [];
    try {
      const [vodCats, movies, series] = await Promise.all([client.vodCategories(), client.vodStreams(), client.series()]);
      const vodCat = new Map(vodCats.map((c) => [String(c.category_id), c.category_name]));
      for (const m of movies) {
        const { name, year } = splitYear(cleanVodName(m.name));
        const entry: VodEntry = { id: `xtream:${source.id}:movie:${m.stream_id}`, kind: "movie", sourceId: source.id, name, upstreamId: String(m.stream_id), ext: m.container_extension ?? "mkv" };
        const y = year ?? (Number(m.year) || undefined);
        if (y) entry.year = y;
        if (m.stream_icon) entry.poster = m.stream_icon;
        if (Number(m.rating)) entry.rating = Number(m.rating);
        if (Number(m.tmdb)) entry.tmdbId = Number(m.tmdb);
        const cat = vodCat.get(String(m.category_id));
        if (cat) entry.category = cat;
        const lang = languageTag(m.name) ?? (cat ? languageTag(cat) : undefined);
        if (lang) entry.lang = lang;
        if (m.added) entry.added = Number(m.added) * 1000;
        vod.push(entry);
      }
      for (const sr of series) {
        const { name, year } = splitYear(cleanVodName(sr.name));
        const entry: VodEntry = { id: `xtream:${source.id}:series:${sr.series_id}`, kind: "series", sourceId: source.id, name, upstreamId: String(sr.series_id) };
        const y = year ?? (Number(sr.releaseDate?.slice(0, 4)) || undefined);
        if (y) entry.year = y;
        if (sr.cover) entry.poster = sr.cover;
        if (Number(sr.rating)) entry.rating = Number(sr.rating);
        if (Number(sr.tmdb)) entry.tmdbId = Number(sr.tmdb);
        const lang = languageTag(sr.name);
        if (lang) entry.lang = lang;
        vod.push(entry);
      }
    } catch (err) {
      this.log.warn({ source: source.name, err: String(err) }, "Xtream VOD catalogue failed to load");
    }
    return { feeds, vod };
  }

  private async loadM3u(source: Extract<IptvSource, { kind: "m3u" }>): Promise<{ feeds: RawFeed[]; vod: VodEntry[] }> {
    const res = await fetchOk(source.url, this.fetchImpl, {}, 120_000);
    const playlist = parseM3u(await res.text());
    this.db.setKv(`source:${source.id}`, { epgUrls: playlist.epgUrls } satisfies SourceMeta);
    const feeds: RawFeed[] = [];
    const vod: VodEntry[] = [];
    playlist.entries.forEach((e, i) => {
      if (e.kind !== "live") {
        const { name, year } = splitYear(cleanVodName(e.name));
        const entry: VodEntry = { id: `m3u:${source.id}:${e.kind}:${i}`, kind: e.kind === "movie" ? "movie" : "series", sourceId: source.id, name, upstreamId: String(i), url: e.url };
        if (year) entry.year = year;
        if (e.logo) entry.poster = e.logo;
        if (e.group) entry.category = e.group;
        const lang = languageTag(e.name) ?? (e.group ? languageTag(e.group) : undefined);
        if (lang) entry.lang = lang;
        if (e.kind === "movie") vod.push(entry);
        return;
      }
      const feed: RawFeed = { sourceId: source.id, upstreamId: e.tvgId ? `${e.tvgId}#${i}` : String(i), name: e.name, url: e.url, catchupDays: e.catchupDays, providerNumber: i + 1 };
      if (e.group) feed.group = e.group;
      if (e.logo) feed.logo = e.logo;
      if (e.tvgId) feed.epgId = e.tvgId;
      if (e.catchupSource) feed.catchupSource = e.catchupSource;
      feeds.push(feed);
    });
    return { feeds, vod };
  }

  private replaceVod(entries: VodEntry[]): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM vod");
      for (const e of entries) {
        this.db.run("INSERT OR REPLACE INTO vod (id, kind, source_id, name_norm, year, data) VALUES (?, ?, ?, ?, ?, ?)", e.id, e.kind, e.sourceId, normaliseTitle(e.name), e.year ?? null, JSON.stringify(e));
      }
    });
  }

  guideUrls(): string[] {
    const s = this.settings.get();
    const urls = [...s.xmltvUrls];
    for (const source of s.iptv) urls.push(...(this.sourceMeta(source.id)?.epgUrls ?? []));
    return [...new Set(urls)];
  }

  /**
   * Imports every guide source. Earlier sources win: once a channel has programmes from one source,
   * later sources don't add overlapping ones for it in the same run.
   */
  async refreshGuide(now = Date.now()): Promise<{ programmes: number }> {
    const channels = this.channels.list(true);
    if (channels.length === 0) {
      this.log.warn("No channels yet, so the guide wasn't loaded; it loads once an IPTV source gives channels");
      return { programmes: 0 };
    }
    const run = now;
    const claimed = new Map<string, string>(); // channel id → guide URL that supplied it
    let total = 0;

    for (const url of this.guideUrls()) {
      const matcher = new EpgMatcher(channels);
      let batch: Programme[] = [];
      let fromUrl = 0;
      try {
        const stream = await fetchStream(url, this.fetchImpl);
        await parseXmltv(stream, {
          channel: (c) => matcher.addXmltvChannel(c),
          programme: (p) => {
            if (p.end < now - 8 * 86_400_000) return;
            for (const channelId of matcher.channelsFor(p.channel)) {
              const owner = claimed.get(channelId);
              if (owner && owner !== url) continue;
              claimed.set(channelId, url);
              batch.push(toProgramme(channelId, p));
              total++;
              fromUrl++;
            }
            if (batch.length >= 2000) {
              this.guide.upsert(batch, run);
              batch = [];
            }
          },
        });
        this.guide.upsert(batch, run);
        this.log.info({ url: redactUrl(url), programmes: fromUrl }, fromUrl ? "Guide source loaded" : "Guide source loaded but matched none of our channels");
      } catch (err) {
        this.log.warn({ url: redactUrl(url), err: describeError(err) }, "Guide source failed to load");
      }
    }
    this.guide.dropStale(claimed.keys(), run, now);
    this.guide.prune(now - 8 * 86_400_000);
    this.db.setKv("epgUpdatedAt", Date.now());
    this.log.info({ programmes: total, channels: claimed.size }, "Guide refreshed");
    return { programmes: total };
  }
}
