// Collections and franchises (issue #238): the media server's BoxSets / Plex collections and, for
// films that only exist as online copies, TMDB's own collections, shown as a Collections row on
// Home, a list in Films and a "Part of the Bond collection" block on a film's page.
//
// Kids rules apply per film, never per collection: a collection shows only the films the profile
// may see, a collection with fewer than two of them is left out, and the count says how many that
// profile can see. A parent's allow and block list wins over the rating here as everywhere.

import type { CollectionFilmRef, CollectionView, TitleCollection, TitleRef } from "@ultimatetv/shared";
import { collectionCard, collectionIdOf, COLLECTION_PREFIX, firstToWatch, nextInCollection, releaseOrder } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import type { VodEntry } from "./ingest/index.js";
import type { ContentFilter } from "./profiles.js";
import type { JfItem } from "./services/media.js";

const TTL = 10 * 60_000;
const MAX_COLLECTIONS = 300;

/** One library collection with its films, as read from the media server. */
interface LibraryCollection {
  id: string; // collection:jellyfin:abc
  name: string;
  overview?: string;
  poster?: string;
  backdrop?: string;
  films: { ref: TitleRef; item: JfItem }[];
}

interface Index {
  at: number;
  list: LibraryCollection[];
  /** A film's Hub key or `tmdb:movie:<id>` → the collection it is in. */
  byTitle: Map<string, LibraryCollection>;
}

export class Collections {
  private index: Promise<Index> | null = null;
  private indexAt = 0;

  constructor(private readonly ctx: HubContext) {}

  /** Forget what was read (a library scan, or the media server changed). */
  reset(): void {
    this.index = null;
  }

  // Library ---------------------------------------------------------------

  private library(): Promise<Index> {
    if (this.index && Date.now() - this.indexAt < TTL) return this.index;
    const built = this.build();
    this.index = built;
    this.indexAt = Date.now();
    built.catch(() => {
      if (this.index === built) this.index = null;
    });
    return built;
  }

  private async build(): Promise<Index> {
    const media = this.ctx.media();
    const out: Index = { at: Date.now(), list: [], byTitle: new Map() };
    this.addDemo(out);
    if (!media?.collections || !media.collectionItems) return out;
    const sets = (await media.collections().catch((): JfItem[] => [])).slice(0, MAX_COLLECTIONS);
    const lists = await Promise.all(sets.map((s) => media.collectionItems!(s.Id).catch((): JfItem[] => [])));
    sets.forEach((set, i) => {
      const items = lists[i]!;
      if (!items.length) return;
      const c: LibraryCollection = {
        id: collectionIdOf(media.key(set.Id)),
        name: set.Name,
        films: releaseOrder(items.map((item) => ({ item, ref: media.toTitleRef(item), name: item.Name, ...(item.ProductionYear ? { year: item.ProductionYear } : {}), ...(item.PremiereDate ? { released: item.PremiereDate } : {}) }))).map(({ item, ref }) => ({ item, ref })),
      };
      if (set.Overview) c.overview = set.Overview;
      const poster = media.image(set, "Primary", 400);
      if (poster) c.poster = poster;
      const backdrop = media.image(set, "Backdrop", 1280);
      if (backdrop) c.backdrop = backdrop;
      out.list.push(c);
      for (const { item, ref } of c.films) {
        out.byTitle.set(media.key(item.Id), c);
        out.byTitle.set(ref.id, c);
        const tmdb = item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb;
        if (tmdb) out.byTitle.set(`tmdb:movie:${tmdb}`, c);
      }
    });
    return out;
  }

  /** The demo Hub's made-up franchises, from its demo library (no media server there). */
  private addDemo(out: Index): void {
    for (const d of this.ctx.demoCollections ?? []) {
      const entries = d.films.map((id) => this.ctx.db.jsonOne<VodEntry>("SELECT data FROM vod WHERE id = ?", id)).filter((e): e is VodEntry => Boolean(e));
      if (!entries.length) continue;
      const films = releaseOrder(entries.map((e) => ({ e, name: e.name, ...(e.year ? { year: e.year } : {}) }))).map(({ e }) => {
        const ref: TitleRef = { id: e.id, kind: "movie", name: e.name, genres: e.genres ?? [] };
        if (e.year) ref.year = e.year;
        if (e.poster) ref.poster = e.poster;
        if (e.backdrop) ref.backdrop = e.backdrop;
        return { ref, item: { Id: e.id, Name: e.name, Type: "Movie" } as JfItem };
      });
      const c: LibraryCollection = { id: collectionIdOf(`demo:${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`), name: d.name, films };
      if (d.overview) c.overview = d.overview;
      if (films[0]?.ref.poster) c.poster = films[0].ref.poster;
      if (films[0]?.ref.backdrop) c.backdrop = films[0].ref.backdrop;
      out.list.push(c);
      for (const { ref } of films) out.byTitle.set(ref.id, c);
    }
  }

  private visibleFilms(c: LibraryCollection, f: ContentFilter): CollectionFilmRef[] {
    return c.films
      .filter(({ ref }) => f.ref(ref))
      .map(({ ref, item }) => {
        const out: CollectionFilmRef = { ...ref };
        if (item.UserData?.Played || f.watched(ref)) out.watched = true;
        return out;
      });
  }

  // Lists -----------------------------------------------------------------

  /** The collections this profile can see, as cards: at least two films it may watch. */
  async cards(f: ContentFilter, limit = 60): Promise<TitleRef[]> {
    const lib = await this.library();
    const out: TitleRef[] = [];
    for (const c of lib.list) {
      const visible = this.visibleFilms(c, f);
      if (visible.length < 2) continue;
      // The card's picture: the collection's own, else the first visible film's.
      out.push(collectionCard({ id: c.id, name: c.name, ...(c.poster ?? visible[0]?.poster ? { poster: c.poster ?? visible[0]!.poster! } : {}), ...(c.backdrop ?? visible[0]?.backdrop ? { backdrop: c.backdrop ?? visible[0]!.backdrop! } : {}) }, visible.length));
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // One collection ----------------------------------------------------------

  /** A collection opened: its films in release order, with the one to play next. Undefined when unknown or nothing is visible. */
  async view(id: string, f: ContentFilter): Promise<CollectionView | undefined> {
    if (!id.startsWith(COLLECTION_PREFIX)) return undefined;
    const lib = (await this.library()).list.find((c) => c.id === id);
    if (lib) {
      const films = this.visibleFilms(lib, f);
      if (!films.length) return undefined;
      return this.shape({ id, name: lib.name, source: "library", films, ...(lib.overview ? { overview: lib.overview } : {}), ...(lib.poster ? { poster: lib.poster } : {}), ...(lib.backdrop ? { backdrop: lib.backdrop } : {}) });
    }
    const tmdbId = /^collection:tmdb:(\d+)$/.exec(id)?.[1];
    const tmdb = this.ctx.tmdb();
    if (!tmdbId || !tmdb) return undefined;
    const c = await tmdb.collection(Number(tmdbId)).catch(() => null);
    if (!c) return undefined;
    const media = this.ctx.media();
    const ordered = releaseOrder(c.films.map((x) => ({ ...x, name: x.ref.name, ...(x.ref.year ? { year: x.ref.year } : {}), ...(x.released ? { released: x.released } : {}) })));
    const films: CollectionFilmRef[] = [];
    for (const { ref } of ordered) {
      if (!f.ref(ref)) continue;
      const tmdbFilm = Number(/^tmdb:movie:(\d+)$/.exec(ref.id)?.[1]);
      const have = media && tmdbFilm ? await media.hasProviderId("tmdb", String(tmdbFilm), "Movie").catch(() => false) : false;
      const out: CollectionFilmRef = have ? { ...ref, badges: ["In your library"] } : { ...ref };
      if (f.watched(ref)) out.watched = true;
      films.push(out);
    }
    if (!films.length) return undefined;
    return this.shape({ id, name: c.name, source: "tmdb", films, ...(c.overview ? { overview: c.overview } : {}), ...(c.poster ? { poster: c.poster } : {}), ...(c.backdrop ? { backdrop: c.backdrop } : {}) });
  }

  private shape(c: Omit<CollectionView, "next">): CollectionView {
    const next = firstToWatch(c.films);
    return next ? { ...c, next } : c;
  }

  // A film's collection -----------------------------------------------------

  /**
   * The collection a film belongs to, for its page: the media server's collection when the film is
   * in one, else TMDB's franchise. Undefined when it is in none, or the profile can see no other
   * film in it. `ids` are the film's own ids: its Hub id and `tmdb:movie:<id>`.
   */
  async of(ids: { id: string; tmdbId?: number | undefined }, f: ContentFilter): Promise<TitleCollection | undefined> {
    const keys = [ids.id, ...(ids.tmdbId ? [`tmdb:movie:${ids.tmdbId}`] : [])];
    const lib = await this.library();
    const hit = keys.map((k) => lib.byTitle.get(k)).find(Boolean);
    let view: CollectionView | undefined;
    if (hit) view = await this.view(hit.id, f);
    if (!view && ids.tmdbId) {
      const tmdb = this.ctx.tmdb();
      const cid = tmdb ? await tmdb.collectionOf(ids.tmdbId).catch(() => undefined) : undefined;
      if (cid) view = await this.view(collectionIdOf(`tmdb:${cid}`), f);
    }
    if (!view || view.films.length < 2) return undefined;
    // The film as the collection lists it: by its own id, or, for a library film, by its server key or TMDB id.
    const own = hit?.films.find(({ item, ref }) => keys.includes(ref.id) || keys.includes(this.ctx.media()?.key(item.Id) ?? "") || (ids.tmdbId !== undefined && (item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb) === String(ids.tmdbId)))?.ref.id;
    const mine = view.films.findIndex((x) => keys.includes(x.id) || x.id === own);
    if (mine < 0) return undefined;
    const next = nextInCollection(view.films, view.films[mine]!.id);
    return { id: view.id, name: view.name, position: mine, total: view.films.length, films: view.films, ...(next ? { next } : {}) };
  }
}
