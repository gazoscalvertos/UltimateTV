// Following series (issue #226): Coming up, the Home row "New episodes" and the pop-up when a
// followed episode arrives. See docs/coming-up.md.
//
// A profile's list is its own choices (Follow on a series page) plus the series the Hub can tell it
// cares about: Saved for later, Continue watching, series links (recording a series) and the play
// queue. Unfollowing a series that was added by itself is remembered, so it stays off.
//
// Air dates come from TMDB (`/tv/{id}`: the last and next episode; the next episode's season for
// a run of them). They are dates without a time of day, so "Today" means the episode is out some
// time today. A series in a media server's latest episodes also counts as new, whatever TMDB says.

import type { ComingUpEpisode, FollowedSeries, FollowingView, FollowReason, NewEpisode, SeriesLink, TitleRef, WatchItem, QueueItem } from "@ultimatetv/shared";
import { dayLabel, newEpisodeLabel, normaliseTitle, startOfDay } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";
import type { NextAirings } from "./nextairing.js";
import type { ProgressStore } from "./progress.js";
import type { ContentFilter } from "./profiles.js";
import type { MediaServer } from "./services/media.js";
import type { SeriesSchedule, TmdbClient } from "./services/tmdb.js";

const DAY = 86_400_000;
/** Series looked at per profile: air dates are cached, but this keeps a huge list from being slow. */
export const MAX_FOLLOWED = 40;
/** How many days ahead Coming up looks. */
export const COMING_UP_DAYS = 7;
/** How long an episode stays "new". */
export const NEW_FOR_DAYS = 14;
const FOUND_FOR_MS = 30 * DAY;
const MISSED_FOR_MS = 3 * DAY;

interface Stored {
  /** Series followed on purpose. */
  added?: TitleRef[];
  /** Series taken off, so the ones added by themselves stay off. */
  removed?: string[];
  popups?: boolean;
}

interface Found {
  ref: TitleRef | null;
  at: number;
}

export interface FollowingDeps {
  db: Db;
  events: EventBus;
  progress: ProgressStore;
  nextAirings: NextAirings;
  tmdb: () => TmdbClient | null;
  media: () => MediaServer | null;
  /** The profile's Saved for later (with the household's). */
  watchlist: (profileId: string | null) => WatchItem[];
  links: () => SeriesLink[];
  queue: () => QueueItem[];
  /** Air dates from somewhere other than TMDB (the demo Hub's made-up shows). */
  scheduleFor?: (title: TitleRef, now: number) => SeriesSchedule | undefined;
  /** Every profile id, for the arrival check. */
  profileIds: () => string[];
}

const keyOf = (t: { name: string; year?: number }) => normaliseTitle(t.name);
const isSeries = (t: TitleRef | undefined): t is TitleRef => Boolean(t && t.kind === "series");
const dateMs = (airDate: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(airDate);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
};
export const episodeKey = (season: number, episode: number) => `s${season}e${episode}`;

/** Whether `a` (`s2e5`) comes after `b`. */
function isLater(a: string, b: string): boolean {
  const n = (x: string) => /^s(\d+)e(\d+)$/.exec(x)?.slice(1).map(Number) ?? [0, 0];
  const [as, ae] = n(a);
  const [bs, be] = n(b);
  return as! > bs! || (as === bs && ae! > be!);
}

export class Following {
  constructor(private readonly d: FollowingDeps) {}

  private key(profileId: string | null) {
    return `following:${profileId ?? "default"}`;
  }

  private stored(profileId: string | null): Stored {
    const raw = this.d.db.getKv<unknown>(this.key(profileId));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const o = raw as Stored;
    return {
      added: Array.isArray(o.added) ? o.added.filter((t) => t && typeof t.id === "string" && t.kind === "series" && typeof t.name === "string") : [],
      removed: Array.isArray(o.removed) ? o.removed.filter((r): r is string => typeof r === "string") : [],
      ...(typeof o.popups === "boolean" ? { popups: o.popups } : {}),
    };
  }

  private save(profileId: string | null, s: Stored): void {
    this.d.db.setKv(this.key(profileId), s);
    this.d.events.emit({ type: "following.changed", profileId });
  }

  popups(profileId: string | null): boolean {
    return this.stored(profileId).popups ?? true;
  }

  setPopups(profileId: string | null, on: boolean): void {
    this.save(profileId, { ...this.stored(profileId), popups: on });
  }

  /** Follows a series on purpose. */
  follow(profileId: string | null, title: TitleRef): void {
    const s = this.stored(profileId);
    const kept: TitleRef = { id: title.id, kind: "series", name: title.name };
    for (const k of ["year", "poster", "backdrop", "logo", "certification", "genres"] as const) {
      if (title[k] !== undefined) (kept as unknown as Record<string, unknown>)[k] = title[k];
    }
    const k = keyOf(title);
    const added = (s.added ?? []).filter((t) => t.id !== title.id && keyOf(t) !== k);
    this.save(profileId, { ...s, added: [kept, ...added].slice(0, 200), removed: (s.removed ?? []).filter((r) => r !== title.id && r !== `name:${k}`) });
  }

  /** Takes a series off the list, however it got there. */
  unfollow(profileId: string | null, title: { id: string; name: string }): void {
    const s = this.stored(profileId);
    const k = keyOf(title);
    this.save(profileId, {
      ...s,
      added: (s.added ?? []).filter((t) => t.id !== title.id && keyOf(t) !== k),
      removed: [...new Set([...(s.removed ?? []), title.id, `name:${k}`])].slice(-400),
    });
  }

  /** TMDB's title for a name, remembered for a month (a miss for three days). */
  private async resolve(name: string, year?: number): Promise<TitleRef | null> {
    const tmdb = this.d.tmdb();
    if (!tmdb) return null;
    const cache = this.d.db.getKv<Record<string, Found>>("following-tmdb") ?? {};
    const k = `${normaliseTitle(name)}:${year ?? ""}`;
    const hit = cache[k];
    const now = Date.now();
    if (hit && now - hit.at < (hit.ref ? FOUND_FOR_MS : MISSED_FOR_MS)) return hit.ref;
    const ref = await tmdb.match("series", name, year).catch(() => undefined);
    if (ref === undefined) return hit?.ref ?? null; // TMDB was out of reach: try again next time
    cache[k] = { ref, at: now };
    const keys = Object.keys(cache);
    if (keys.length > 600) for (const old of keys.sort((a, b) => cache[a]!.at - cache[b]!.at).slice(0, keys.length - 600)) delete cache[old];
    this.d.db.setKv("following-tmdb", cache);
    return ref;
  }

  /** The series this profile follows, on purpose first, then the ones it follows by itself. */
  async followed(profileId: string | null, f: ContentFilter): Promise<FollowedSeries[]> {
    const s = this.stored(profileId);
    const removed = new Set(s.removed ?? []);
    const out: FollowedSeries[] = [];
    const seen = new Set<string>();
    const take = (raw: TitleRef, reason: FollowReason): void => {
      // The series itself: not the place Continue watching or a queue row has got to in it.
      const { progress: _p, episodeId: _e, subtitle: _s, badges: _b, ...title } = raw;
      const k = keyOf(title);
      if (!k || seen.has(k) || removed.has(title.id) || removed.has(`name:${k}`) || !f.ref(title)) return;
      seen.add(k);
      out.push({ title, reason });
    };
    for (const t of s.added ?? []) take(t, "followed");
    // A Guest is a visitor: none of the household's history is its business, so only what it follows itself.
    if (!f.guest) {
      for (const i of this.d.watchlist(profileId)) if (isSeries(i.title)) take(i.title, "saved");
      for (const c of this.d.progress.continueWatching(60)) if (isSeries(c.title)) take(c.title, "watching");
      for (const q of this.d.queue()) if (isSeries(q.title)) take(q.title, "queue");
      // A series link only has the guide's name: look the series up (a Kids profile needs the real rating).
      for (const l of this.d.links()) {
        if (seen.has(normaliseTitle(l.title))) continue;
        const ref = await this.resolve(l.title);
        if (ref) take(ref, "link");
      }
    }
    return out.slice(0, MAX_FOLLOWED);
  }

  private async scheduleOf(title: TitleRef): Promise<{ tmdbId: number; schedule: SeriesSchedule } | null> {
    const own = this.d.scheduleFor?.(title, Date.now());
    if (own) return { tmdbId: 0, schedule: own };
    const tmdb = this.d.tmdb();
    if (!tmdb) return null;
    let id = /^tmdb:series:(\d+)$/.exec(title.id)?.[1];
    if (!id) id = /^tmdb:series:(\d+)$/.exec((await this.resolve(title.name, title.year))?.id ?? "")?.[1];
    if (!id) return null;
    const schedule = await tmdb.schedule(Number(id)).catch(() => null);
    return schedule ? { tmdbId: Number(id), schedule } : null;
  }

  /** Episodes the media server has just added for the series being followed, by series name. */
  private async libraryNew(titles: FollowedSeries[], now: number): Promise<Map<string, NewEpisode>> {
    const out = new Map<string, NewEpisode>();
    const media = this.d.media();
    if (!media || !titles.length) return out;
    const items = await media.latest("Episode", 80).catch(() => []);
    const byName = new Map(titles.map((t) => [keyOf(t.title), t.title]));
    for (const i of items) {
      if (i.Type !== "Episode" || i.IndexNumber === undefined) continue;
      const title = (i.SeriesId && titles.find((t) => t.title.id === media.key(i.SeriesId!))?.title) || byName.get(normaliseTitle(i.SeriesName ?? ""));
      if (!title) continue;
      // Latest lists the newest additions; an old episode added late (a back catalogue) isn't news.
      const premiered = i.PremiereDate ? Date.parse(i.PremiereDate) : now;
      if (Number.isNaN(premiered) || now - premiered > NEW_FOR_DAYS * DAY) continue;
      const season = i.ParentIndexNumber ?? 0;
      const at = Math.min(premiered, now);
      const old = out.get(title.id);
      if (old && (old.at > at || (old.season === season && old.episode > i.IndexNumber))) continue;
      out.set(title.id, { title, episodeId: episodeKey(season, i.IndexNumber), season, episode: i.IndexNumber, ...(i.Name ? { name: i.Name } : {}), at, inLibrary: true });
    }
    return out;
  }

  /** What Home's New episodes row, Coming up and the Follow list show for a profile. */
  async view(profileId: string | null, f: ContentFilter, now = Date.now(), withComingUp = true): Promise<FollowingView> {
    const followed = await this.followed(profileId, f);
    const tmdb = this.d.tmdb();
    const today = startOfDay(now);
    const until = today + COMING_UP_DAYS * DAY;
    const comingUp: ComingUpEpisode[] = [];
    const fresh = new Map<string, NewEpisode>();

    const lib = await this.libraryNew(followed, now);
    const looked = await Promise.all(followed.map(async (fs) => ({ fs, found: await this.scheduleOf(fs.title) })));
    for (const { fs, found } of looked) {
      const { title } = fs;
      const watched = this.d.progress.episodes(title.id);
      const libraryEp = lib.get(title.id);
      if (libraryEp && !watched.get(libraryEp.episodeId)?.watched) fresh.set(title.id, libraryEp);
      const sch = found?.schedule;
      if (sch?.last) {
        const at = dateMs(sch.last.airDate);
        const id = episodeKey(sch.last.season, sch.last.episode);
        if (!Number.isNaN(at) && at <= now && now - at <= NEW_FOR_DAYS * DAY && !watched.get(id)?.watched && !fresh.has(title.id)) {
          fresh.set(title.id, { title, episodeId: id, season: sch.last.season, episode: sch.last.episode, ...(sch.last.name ? { name: sch.last.name } : {}), at, inLibrary: false });
        }
      }
      if (!withComingUp || !found || !sch?.next) continue;
      const nextAt = dateMs(sch.next.airDate);
      if (Number.isNaN(nextAt) || nextAt < today || nextAt >= until) continue;
      // The rest of that season that falls inside the week (a run of nightly episodes).
      const eps = tmdb && found.tmdbId ? await tmdb.season(found.tmdbId, sch.next.season).then((s) => s.episodes, () => []) : [];
      const inWeek = eps.filter((e) => e.airDate && (dateMs(e.airDate) >= today && dateMs(e.airDate) < until)).slice(0, 8);
      const list = inWeek.length && inWeek.some((e) => e.episode === sch.next!.episode) ? inWeek : [{ season: sch.next.season, episode: sch.next.episode, name: sch.next.name ?? "", airDate: sch.next.airDate }];
      for (const e of list) {
        const airsAt = dateMs(e.airDate!);
        comingUp.push({
          title,
          season: e.season,
          episode: e.episode,
          ...(e.name ? { name: e.name } : {}),
          airDate: e.airDate!,
          airsAt,
          when: dayLabel(airsAt, now),
        });
      }
    }
    comingUp.sort((a, b) => a.airsAt - b.airsAt || a.title.name.localeCompare(b.title.name) || a.episode - b.episode);

    // When one is on the household's channels: Remind and Record. Only an airing close to the air
    // date counts, so a repeat of an old episode is not offered as the new one.
    if (comingUp.length) {
      const items: WatchItem[] = [...new Map(comingUp.map((c) => [c.title.id, c.title])).values()].map((t) => ({ id: t.id, name: t.name, kind: "series", title: t, addedAt: now, from: "tv" }));
      const airs = this.d.nextAirings.find(items, f, now);
      for (const c of comingUp) {
        const a = airs.get(c.title.id);
        if (a && a.start >= c.airsAt - 6 * 3_600_000 && a.start < c.airsAt + 2 * DAY) c.next = a;
      }
    }
    const newEpisodes = [...fresh.values()].sort((a, b) => b.at - a.at);
    return { followed, comingUp, newEpisodes, popups: this.popups(profileId), schedule: Boolean(tmdb) || Boolean(this.d.scheduleFor) };
  }

  /** Home's New episodes row: a card per series, opening on the new episode. */
  asRow(items: NewEpisode[], now = Date.now()): TitleRef[] {
    return items.map((e) => ({
      ...e.title,
      episodeId: e.episodeId,
      badges: ["New"],
      subtitle: `${newEpisodeLabel(e)} · ${e.inLibrary ? "In your library" : dayLabel(e.at, now)}`,
    }));
  }

  /**
   * Looks for episodes that arrived since the last look and pops each up once, for the profiles
   * that follow the series and left pop-ups on. The first look at a series only learns where it is
   * up to, so following a show with a back catalogue doesn't flood the TV.
   */
  async checkArrivals(filterFor: (profileId: string | null) => ContentFilter, now = Date.now()): Promise<number> {
    const told = this.d.db.getKv<Record<string, string>>("following-told") ?? {};
    let sent = 0;
    for (const profileId of [null, ...this.d.profileIds()]) {
      if (!this.popups(profileId)) continue;
      const f = filterFor(profileId);
      if (f.guest) continue;
      const view = await this.view(profileId, f, now, false).catch(() => null);
      for (const e of view?.newEpisodes ?? []) {
        const k = `${profileId ?? "default"}:${keyOf(e.title)}`;
        const id = episodeKey(e.season, e.episode);
        const first = told[k] === undefined;
        const newer = !first && isLater(id, told[k]!);
        if (first || newer) told[k] = id;
        if (!newer) continue;
        sent++;
        this.d.events.emit({ type: "episode.new", profileId, title: { ...e.title, episodeId: e.episodeId }, message: `New episode of ${e.title.name}: ${newEpisodeLabel(e)}` });
      }
    }
    this.d.db.setKv("following-told", told);
    return sent;
  }
}
