// Watchlists: films and shows each profile wants to watch some day, added on the TV (a film's or
// series' page, the guide's programme card) or the phone. Each item is listed with when it's next
// on TV and whether there's a recording of it, so the Home row can say "Sat 21:00 on Film4".

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Profile, Programme, TitleRef, Watchlist, WatchlistEntry, WatchlistItem } from "@ultimatetv/shared";
import { normaliseTitle, programmeName, watchlistMatches } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import type { Db } from "./db.js";
import { newId } from "./db.js";
import type { EventBus } from "./events.js";
import { ContentFilter } from "./profiles.js";

const MAX_ITEMS = 200;
const FORTNIGHT = 14 * 86_400_000;

export class WatchlistError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface WatchlistInput {
  title?: TitleRef;
  programmeId?: string;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Two items are the same when they're the same title, or the same series or name from the guide. */
function same(a: WatchlistItem, b: WatchlistItem): boolean {
  if (a.title?.id && b.title?.id) return a.title.id === b.title.id;
  if (a.seriesKey && b.seriesKey && a.seriesKey === b.seriesKey) return true;
  return normaliseTitle(a.name) === normaliseTitle(b.name) && a.film === b.film && (!a.year || !b.year || a.year === b.year);
}

export class WatchlistStore {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  private key(profileId: string): string {
    return `watchlist:${profileId}`;
  }

  items(profileId: string): WatchlistItem[] {
    return this.db.getKv<WatchlistItem[]>(this.key(profileId)) ?? [];
  }

  /** Adds to the front (newest first). Something already there stays where it is. */
  add(profileId: string, item: Omit<WatchlistItem, "id" | "addedAt">, now = Date.now()): { item: WatchlistItem; added: boolean } {
    const list = this.items(profileId);
    const full: WatchlistItem = { ...item, id: newId("w"), addedAt: now };
    const old = list.find((i) => same(i, full));
    if (old) {
      // A programme matched to its film or series later becomes the title (it gets a page and artwork).
      if (old.kind === "programme" && full.kind === "title") {
        const upgraded: WatchlistItem = { ...full, id: old.id, addedAt: old.addedAt, ...(old.seriesKey && !full.seriesKey ? { seriesKey: old.seriesKey } : {}) };
        this.save(profileId, list.map((i) => (i === old ? upgraded : i)));
        return { item: upgraded, added: false };
      }
      return { item: old, added: false };
    }
    if (list.length >= MAX_ITEMS) throw new WatchlistError(`A watchlist holds ${MAX_ITEMS} things. Remove some first.`);
    this.save(profileId, [full, ...list]);
    return { item: full, added: true };
  }

  remove(profileId: string, id: string): boolean {
    const list = this.items(profileId);
    const next = list.filter((i) => i.id !== id);
    if (next.length === list.length) return false;
    this.save(profileId, next);
    return true;
  }

  /** A profile was deleted: its watchlist goes with it. */
  drop(profileId: string): void {
    this.db.run("DELETE FROM kv WHERE key = ?", this.key(profileId));
  }

  private save(profileId: string, items: WatchlistItem[]): void {
    this.db.setKv(this.key(profileId), items);
    this.events.emit({ type: "watchlist.changed", profileId });
  }
}

/** The item for a title (a film or series page). */
export function itemForTitle(t: TitleRef): Omit<WatchlistItem, "id" | "addedAt"> {
  const name = text(t.name, 160);
  if (!name || typeof t.id !== "string" || !t.id) throw new WatchlistError("Say which film or series");
  const title: TitleRef = { id: t.id, kind: t.kind === "series" ? "series" : "movie", name };
  if (typeof t.year === "number") title.year = t.year;
  for (const k of ["poster", "backdrop", "logo", "certification"] as const) {
    const v = text(t[k], 1000);
    if (v) title[k] = v;
  }
  if (Array.isArray(t.genres)) title.genres = t.genres.filter((g): g is string => typeof g === "string").slice(0, 10);
  const item: Omit<WatchlistItem, "id" | "addedAt"> = { kind: "title", name, title, film: title.kind === "movie" };
  if (title.year) item.year = title.year;
  const image = title.poster ?? title.backdrop;
  if (image) item.image = image;
  return item;
}

/** The item for a programme in the guide: found again later by its series, or by its name. */
export function itemForProgramme(p: Programme): Omit<WatchlistItem, "id" | "addedAt"> {
  const item: Omit<WatchlistItem, "id" | "addedAt"> = { kind: "programme", name: programmeName(p.title) || p.title, film: p.isFilm };
  // A film's "series" is only its name; a show's is what finds every episode.
  if (p.seriesKey && !p.isFilm) item.seriesKey = p.seriesKey;
  if (p.year) item.year = p.year;
  if (p.image) item.image = p.image;
  return item;
}

/** Adds when it's next on, and any recordings, for a profile that can see `f`. */
export function describe(ctx: HubContext, items: WatchlistItem[], f: ContentFilter, now = Date.now()): WatchlistEntry[] {
  const channelOk = (id: string) => {
    const c = ctx.channels.get(id);
    return c !== undefined && !c.hidden && !c.mix && f.channel(c);
  };
  const recordings = ctx.recordings.withStatus("completed").filter((r) => {
    const c = ctx.channels.get(r.channelId);
    return !f.kids || (c !== undefined && f.channel(c));
  });
  return items
    .filter((i) => i.kind !== "title" || !i.title || f.ref(i.title))
    .map((i) => {
      const found = new Map<string, Programme>();
      if (i.seriesKey) for (const p of ctx.guide.airings(i.seriesKey, now - 6 * 3_600_000, now + FORTNIGHT)) found.set(p.id, p);
      for (const p of ctx.guide.byName(normaliseTitle(i.name), now, now + FORTNIGHT)) found.set(p.id, p);
      const showings = [...found.values()].filter((p) => p.end > now && watchlistMatches(i, p) && channelOk(p.channelId)).sort((a, b) => a.start - b.start);
      const recs = recordings.filter((r) => watchlistMatches(i, r.programme)).sort((a, b) => b.programme.start - a.programme.start);
      const entry: WatchlistEntry = { ...i, showings: showings.length, recordings: recs.length };
      const next = showings[0];
      if (next) {
        const c = ctx.channels.get(next.channelId)!;
        entry.onTv = { programme: next, channelName: c.name, channelNumber: c.number };
      }
      if (recs[0]) entry.recordingId = recs[0].id;
      return entry;
    });
}

export function registerWatchlist(app: FastifyInstance, ctx: HubContext, viewerOf: (req: FastifyRequest) => { profile: Profile | null }): void {
  const store = ctx.watchlist;
  type Req<B = unknown> = FastifyRequest<{ Body: B; Params: { id: string }; Querystring: { profile?: string } }>;

  /**
   * Whose watchlist: the TV's profile, or for the phone (which has no profile of its own) the one
   * it names, usually the profile the TV is on.
   */
  const whose = (req: Req): Profile => {
    const own = viewerOf(req).profile;
    if (own) return own;
    const body = req.body as { profile?: unknown } | undefined;
    const asked = req.query.profile ?? (typeof body?.profile === "string" ? body.profile : undefined);
    const p = asked ? ctx.profiles.get(asked) : undefined;
    if (!p) throw new WatchlistError("Say whose watchlist", 400);
    return p;
  };
  const list = (p: Profile): Watchlist => ({ profile: { id: p.id, name: p.name }, items: describe(ctx, store.items(p.id), new ContentFilter(p)) });
  const fail = (err: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) => {
    if (err instanceof WatchlistError) return reply.code(err.status).send({ error: err.message });
    throw err;
  };

  app.get("/api/watchlist", async (req: Req, reply) => {
    try {
      return list(whose(req));
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.post("/api/watchlist", async (req: Req<WatchlistInput & { profile?: string }>, reply) => {
    try {
      const p = whose(req as Req);
      const f = new ContentFilter(p);
      const body = req.body ?? {};
      let item: Omit<WatchlistItem, "id" | "addedAt">;
      if (body.title) {
        item = itemForTitle(body.title);
        if (!f.ref(item.title!)) throw new WatchlistError("That isn't available on this profile", 403);
      } else if (typeof body.programmeId === "string") {
        const prog = ctx.guide.get(body.programmeId);
        if (!prog) throw new WatchlistError("That programme isn't in the guide any more", 404);
        if (!f.programme(prog, ctx.channels.get(prog.channelId))) throw new WatchlistError("That isn't available on this profile", 403);
        item = itemForProgramme(prog);
      } else {
        throw new WatchlistError("Say what to add");
      }
      const { item: saved, added } = store.add(p.id, item);
      return { item: saved, added, ...list(p) };
    } catch (err) {
      return fail(err, reply);
    }
  });

  app.delete("/api/watchlist/:id", async (req: Req, reply) => {
    try {
      const p = whose(req);
      return { ok: store.remove(p.id, req.params.id), ...list(p) };
    } catch (err) {
      return fail(err, reply);
    }
  });
}
