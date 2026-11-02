// Podcasts: the shows the household follows, their episodes, and where they got to.
//
// A show is identified by its feed address, so pasting the same feed twice doesn't
// make two shows. Episodes are fetched when someone opens the show rather than on a
// timer: a feed is cheap to read but nobody wants the Hub hammering two hundred of
// them, and a stale list is a smaller problem than a Hub that never settles.
//
// "New" means "arrived since this household last opened the show", which is what a
// person means by a badge. It isn't a count of unplayed episodes — that would be a
// badge that never goes away.

import type {
  ParsedFeed,
  PodcastEpisode,
  PodcastSearchResult,
  PodcastShow,
  PodcastShowWithEpisodes,
} from "@ultimatetv/shared";
import { MAX_PODCAST_SEARCH, MAX_PODCAST_SHOWS, PODCAST_RESUME_MS } from "@ultimatetv/shared";
import { newId } from "./db.js";
import type { Db } from "./db.js";
import { MAX_FEED_BYTES, parseFeed } from "./podcastfeed.js";

const SHOWS_KEY = "podcasts";
const EPISODES_KEY = "podcast-episodes";
const PROGRESS_KEY = "podcast-progress";
/** A feed is re-read at most this often, so opening a show twice is free. */
const REFRESH_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;

/** A feed that couldn't be read or a show that isn't there, said in words a person can act on. */
export class PodcastError extends Error {
  readonly statusCode = 400;
}

interface StoredShow {
  id: string;
  title: string;
  feedUrl: string;
  author?: string;
  description?: string;
  image?: string;
  episodeCount: number;
  /** How many of the current episodes were already there when they were last seen. */
  seenCount?: number;
  checkedAt?: number;
  problem?: string;
}

interface StoredEpisode {
  id: string;
  showId: string;
  title: string;
  url: string;
  publishedAt: number;
  durationMs?: number;
  description?: string;
  image?: string;
}

const cleanUrl = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const asText = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/** Read the feed, following one redirect, and refuse anything enormous. */
async function readFeed(fetchImpl: typeof fetch, url: string): Promise<ParsedFeed> {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "UltimateTV", Accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new PodcastError(`The feed answered ${res.status}.`);
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_FEED_BYTES) throw new PodcastError("That feed is too big to read.");
  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) throw new PodcastError("That feed is too big to read.");
  if (!/<(rss|feed|rdf)/i.test(body)) throw new PodcastError("That address isn't a podcast feed.");
  const feed = parseFeed(body);
  if (!feed.episodes.length) throw new PodcastError("That feed has no episodes in it.");
  return feed;
}

export class Podcasts {
  constructor(
    private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private shows(): StoredShow[] {
    const stored = this.db.getKv<unknown>(SHOWS_KEY);
    if (!Array.isArray(stored)) return [];
    const out: StoredShow[] = [];
    for (const raw of stored) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Partial<StoredShow>;
      const feedUrl = cleanUrl(row.feedUrl);
      const title = asText(row.title, 200);
      if (!feedUrl || !title || typeof row.id !== "string" || !row.id) continue;
      out.push({
        id: row.id,
        title,
        feedUrl,
        ...(asText(row.author, 200) ? { author: asText(row.author, 200)! } : {}),
        ...(asText(row.description, 2000) ? { description: asText(row.description, 2000)! } : {}),
        ...(cleanUrl(row.image) ? { image: cleanUrl(row.image)! } : {}),
        episodeCount: Number.isFinite(row.episodeCount) ? Math.max(0, Math.trunc(row.episodeCount!)) : 0,
        ...(Number.isFinite(row.seenCount) ? { seenCount: Math.max(0, Math.trunc(row.seenCount!)) } : {}),
        ...(Number.isFinite(row.checkedAt) ? { checkedAt: Math.trunc(row.checkedAt!) } : {}),
        ...(asText(row.problem, 200) ? { problem: asText(row.problem, 200)! } : {}),
      });
    }
    return out;
  }

  private saveShows(list: StoredShow[]): void {
    this.db.setKv(SHOWS_KEY, list.length ? list : null);
  }

  private allEpisodes(): Record<string, StoredEpisode[]> {
    const stored = this.db.getKv<unknown>(EPISODES_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const out: Record<string, StoredEpisode[]> = {};
    for (const [showId, rows] of Object.entries(stored as Record<string, unknown>)) {
      if (!Array.isArray(rows)) continue;
      const kept: StoredEpisode[] = [];
      for (const raw of rows) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Partial<StoredEpisode>;
        const url = cleanUrl(row.url);
        const title = asText(row.title, 300);
        if (!url || !title || typeof row.id !== "string" || !row.id) continue;
        kept.push({
          id: row.id,
          showId,
          title,
          url,
          publishedAt: Number.isFinite(row.publishedAt) ? Math.trunc(row.publishedAt!) : 0,
          ...(Number.isFinite(row.durationMs) ? { durationMs: Math.trunc(row.durationMs!) } : {}),
          ...(asText(row.description, 4000) ? { description: asText(row.description, 4000)! } : {}),
          ...(cleanUrl(row.image) ? { image: cleanUrl(row.image)! } : {}),
        });
      }
      if (kept.length) out[showId] = kept;
    }
    return out;
  }

  private saveEpisodes(all: Record<string, StoredEpisode[]>): void {
    this.db.setKv(EPISODES_KEY, Object.keys(all).length ? all : null);
  }

  private progress(): Record<string, { positionMs: number; durationMs?: number; updatedAt: number }> {
    const stored = this.db.getKv<unknown>(PROGRESS_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const out: Record<string, { positionMs: number; durationMs?: number; updatedAt: number }> = {};
    for (const [id, raw] of Object.entries(stored as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { positionMs?: unknown; durationMs?: unknown; updatedAt?: unknown };
      if (!Number.isFinite(row.positionMs) || (row.positionMs as number) < 0) continue;
      out[id] = {
        positionMs: Math.trunc(row.positionMs as number),
        ...(Number.isFinite(row.durationMs) ? { durationMs: Math.trunc(row.durationMs as number) } : {}),
        updatedAt: Number.isFinite(row.updatedAt) ? Math.trunc(row.updatedAt as number) : 0,
      };
    }
    return out;
  }

  private saveProgress(all: Record<string, { positionMs: number; durationMs?: number; updatedAt: number }>): void {
    this.db.setKv(PROGRESS_KEY, Object.keys(all).length ? all : null);
  }

  /** A show as a client sees it, with everything the client needs to draw a badge. */
  private shape(show: StoredShow): PodcastShow {
    const seen = show.seenCount;
    const fresh = seen === undefined ? 0 : Math.max(0, show.episodeCount - seen);
    return {
      id: show.id,
      title: show.title,
      feedUrl: show.feedUrl,
      ...(show.author ? { author: show.author } : {}),
      ...(show.description ? { description: show.description } : {}),
      ...(show.image ? { image: show.image } : {}),
      episodeCount: show.episodeCount,
      freshCount: fresh,
      ...(show.checkedAt ? { checkedAt: show.checkedAt } : {}),
      ...(show.problem ? { problem: show.problem } : {}),
    };
  }

  list(): PodcastShow[] {
    return this.shows().map((s) => this.shape(s));
  }

  /**
   * The list, with any feed that hasn't been read for half an hour read first, so a new episode
   * shows its badge without anyone having to open the show. Each read is bounded by
   * FETCH_TIMEOUT_MS and a failure only marks that one show, so this can't hang the Music tab.
   */
  async listFresh(now = Date.now()): Promise<PodcastShow[]> {
    const shows = this.shows();
    const stale = shows.filter((s) => !s.checkedAt || now - s.checkedAt >= REFRESH_MS);
    if (!stale.length) return shows.map((s) => this.shape(s));
    await Promise.all(stale.map((s) => this.refresh(s, now).catch(() => null)));
    return this.shows().map((s) => this.shape(s));
  }

  get(id: string): PodcastShow | undefined {
    const show = this.shows().find((s) => s.id === id);
    return show ? this.shape(show) : undefined;
  }

  /** Follow a feed: read it first so an address that isn't one isn't stored. */
  async add(feedUrlRaw: unknown, now = Date.now()): Promise<PodcastShow> {
    const feedUrl = cleanUrl(feedUrlRaw);
    if (!feedUrl) throw new PodcastError("Paste the show's feed address: it should start with http:// or https://.");
    const existing = this.shows().find((s) => s.feedUrl === feedUrl);
    if (existing) return this.shape(existing);
    if (this.shows().length >= MAX_PODCAST_SHOWS) {
      throw new PodcastError(`That's as many shows as will fit (${MAX_PODCAST_SHOWS}). Unsubscribe from one first.`);
    }
    const feed = await readFeed(this.fetchImpl, feedUrl);
    const show: StoredShow = {
      id: newId("pod"),
      title: feed.title || feedUrl,
      feedUrl,
      ...(feed.author ? { author: feed.author } : {}),
      ...(feed.description ? { description: feed.description } : {}),
      ...(feed.image ? { image: feed.image } : {}),
      episodeCount: feed.episodes.length,
      // Everything that was already there when they subscribed isn't "new".
      seenCount: feed.episodes.length,
      checkedAt: now,
    };
    this.saveShows([...this.shows(), show]);
    const all = this.allEpisodes();
    all[show.id] = feed.episodes.map((e) => ({
      id: newId("ep"),
      showId: show.id,
      title: e.title,
      url: e.url,
      publishedAt: e.publishedAt,
      ...(e.durationMs ? { durationMs: e.durationMs } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(e.image ? { image: e.image } : {}),
    }));
    this.saveEpisodes(all);
    return this.shape(show);
  }

  /** Search the iTunes podcast directory — the widest free one that needs no key. */
  async search(queryRaw: unknown): Promise<PodcastSearchResult[]> {
    const query = asText(queryRaw, 200);
    if (!query) return [];
    const address = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=${MAX_PODCAST_SEARCH}&term=${encodeURIComponent(query)}`;
    const res = await this.fetchImpl(address, {
      headers: { "User-Agent": "UltimateTV", Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new PodcastError(`The podcast search answered ${res.status}.`);
    const body = (await res.json()) as { results?: unknown };
    if (!Array.isArray(body.results)) return [];
    const out: PodcastSearchResult[] = [];
    for (const raw of body.results) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { collectionName?: unknown; feedUrl?: unknown; artistName?: unknown; artworkUrl600?: unknown; artworkUrl100?: unknown; trackCount?: unknown };
      const feedUrl = cleanUrl(row.feedUrl);
      const title = asText(row.collectionName, 200);
      if (!feedUrl || !title) continue;
      out.push({
        title,
        feedUrl,
        ...(asText(row.artistName, 200) ? { author: asText(row.artistName, 200)! } : {}),
        ...(cleanUrl(row.artworkUrl600) ?? cleanUrl(row.artworkUrl100)
          ? { image: (cleanUrl(row.artworkUrl600) ?? cleanUrl(row.artworkUrl100))! }
          : {}),
        ...(Number.isFinite(row.trackCount) ? { episodeCount: Math.trunc(row.trackCount as number) } : {}),
      });
    }
    return out;
  }

  remove(id: string): boolean {
    const shows = this.shows();
    const left = shows.filter((s) => s.id !== id);
    if (left.length === shows.length) return false;
    this.saveShows(left);
    const all = this.allEpisodes();
    if (all[id]) {
      delete all[id];
      this.saveEpisodes(all);
    }
    return true;
  }

  /** The episodes of a show, with where this person got to on each one. */
  async open(id: string, now = Date.now()): Promise<PodcastShowWithEpisodes> {
    const shows = this.shows();
    const show = shows.find((s) => s.id === id);
    if (!show) throw new PodcastError("No such show");
    const current = await this.refresh(show, now).catch(() => show);
    const progress = this.progress();
    const episodes = (this.allEpisodes()[id] ?? []).map((e): PodcastEpisode => {
      const at = progress[e.id];
      const resumeAt = at && at.positionMs >= PODCAST_RESUME_MS ? at.positionMs : undefined;
      return {
        id: e.id,
        showId: e.showId,
        title: e.title,
        url: e.url,
        publishedAt: e.publishedAt,
        ...(e.durationMs ? { durationMs: e.durationMs } : {}),
        ...(e.description ? { description: e.description } : {}),
        ...(e.image ? { image: e.image } : {}),
        ...(resumeAt !== undefined ? { positionMs: resumeAt } : {}),
      };
    });
    // Opening the show is what clears the badge: everything on screen has been seen.
    const { problem: _problem, ...withoutProblem } = current;
    const seen: StoredShow = { ...withoutProblem, seenCount: current.episodeCount };
    this.saveShows(shows.map((s) => (s.id === id ? seen : s)));
    return { show: this.shape(seen), episodes };
  }

  /** Re-read a feed when it hasn't been read for a while. Throws for the caller to swallow. */
  private async refresh(show: StoredShow, now: number): Promise<StoredShow> {
    if (show.checkedAt && now - show.checkedAt < REFRESH_MS) return show;
    let feed: ParsedFeed;
    try {
      feed = await readFeed(this.fetchImpl, show.feedUrl);
    } catch (err) {
      const failed: StoredShow = { ...show, checkedAt: now, problem: err instanceof Error ? err.message : "The feed couldn't be read." };
      this.saveShows(this.shows().map((s) => (s.id === show.id ? failed : s)));
      return failed;
    }
    const before = new Set((this.allEpisodes()[show.id] ?? []).map((e) => e.url));
    const known = this.allEpisodes()[show.id] ?? [];
    const added: StoredEpisode[] = [];
    for (const e of feed.episodes) {
      if (before.has(e.url)) continue;
      added.push({
        id: newId("ep"),
        showId: show.id,
        title: e.title,
        url: e.url,
        publishedAt: e.publishedAt,
        ...(e.durationMs ? { durationMs: e.durationMs } : {}),
        ...(e.description ? { description: e.description } : {}),
        ...(e.image ? { image: e.image } : {}),
      });
    }
    const merged = [...known, ...added].sort((a, b) => b.publishedAt - a.publishedAt);
    const kept = merged.slice(0, 200);
    const all = this.allEpisodes();
    all[show.id] = kept;
    this.saveEpisodes(all);
    const updated: StoredShow = {
      ...show,
      ...(feed.title ? { title: feed.title } : {}),
      ...(feed.author ? { author: feed.author } : {}),
      ...(feed.description ? { description: feed.description } : {}),
      ...(feed.image ? { image: feed.image } : {}),
      episodeCount: kept.length,
      checkedAt: now,
    };
    delete updated.problem;
    // "New" counts what the feed had that we hadn't stored. seenCount is left where it was:
    // opening the show is what marks those seen, so the badge survives until somebody looks.
    this.saveShows(this.shows().map((s) => (s.id === show.id ? updated : s)));
    return updated;
  }

  /** Remember where someone got to in an episode. */
  savePosition(episodeId: string, positionMs: number, durationMs?: number, now = Date.now()): void {
    const all = this.progress();
    if (!Number.isFinite(positionMs) || positionMs < 0) return;
    const key = episodeId;
    const short = positionMs < PODCAST_RESUME_MS;
    const finished = durationMs && durationMs > 0 && positionMs / durationMs >= 0.95;
    if (short || finished) {
      // Nothing to carry on with: a few seconds in isn't a place, and the end isn't one.
      if (all[key]) {
        delete all[key];
        this.saveProgress(all);
      }
      return;
    }
    all[key] = {
      positionMs: Math.trunc(positionMs),
      ...(durationMs && durationMs > 0 ? { durationMs: Math.trunc(durationMs) } : {}),
      updatedAt: now,
    };
    this.saveProgress(all);
  }
}
