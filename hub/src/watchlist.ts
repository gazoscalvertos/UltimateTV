// The watchlist ("Save for later"): one list per profile, across every source. Saved from a
// title's page on the TV, the phone remote, the Android app or by voice ("save Dune for later").
// A name saved before any source has it waits as a name, and turns into the title once a search
// finds it, so the film heard about at work is there on Friday.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SearchResult, TitleRef, WatchItem, WatchlistInput } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import { newId } from "./db.js";
import type { EventBus } from "./events.js";
import type { ContentFilter } from "./profiles.js";

const MAX_ITEMS = 200;
/** How often a name with no title is looked for again. */
const LOOK_AGAIN_MS = 6 * 3600_000;

export class WatchlistError extends Error {}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const FROM = new Set<WatchItem["from"]>(["tv", "phone", "voice", "app"]);

/** The parts of a title worth keeping (no progress bars or badges). */
function keepRef(t: Partial<TitleRef>): TitleRef | null {
  const id = text(t.id, 300);
  const name = text(t.name, 160);
  if (!id || !name || (t.kind !== "movie" && t.kind !== "series")) return null;
  const ref: TitleRef = { id, kind: t.kind, name };
  if (typeof t.year === "number") ref.year = t.year;
  for (const k of ["poster", "backdrop", "logo", "certification"] as const) {
    const v = text(t[k], 1000);
    if (v) ref[k] = v;
  }
  if (Array.isArray(t.genres)) ref.genres = t.genres.filter((g): g is string => typeof g === "string").slice(0, 8);
  return ref;
}

export class Watchlist {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  private key(profileId: string | null) {
    return `watchlist:${profileId ?? "default"}`;
  }

  list(profileId: string | null): WatchItem[] {
    return this.db.getKv<WatchItem[]>(this.key(profileId)) ?? [];
  }

  private save(profileId: string | null, items: WatchItem[]): void {
    this.db.setKv(this.key(profileId), items);
    this.events.emit({ type: "watchlist.changed", profileId });
  }

  /** Saves a title (or a name). Saving it again moves it to the front rather than adding it twice. */
  add(profileId: string | null, input: WatchlistInput, now = Date.now()): WatchItem {
    const title = input.title ? keepRef(input.title) : null;
    const name = title?.name ?? text(input.name, 160);
    if (!name) throw new WatchlistError("Say what to save");
    const year = title?.year ?? (typeof input.year === "number" && input.year > 1880 && input.year < 2100 ? input.year : undefined);
    const list = this.list(profileId);
    const same = (i: WatchItem) => (title && i.title?.id === title.id) || (norm(i.name) === norm(name) && (!year || !i.year || i.year === year));
    const old = list.find(same);
    const item: WatchItem = {
      id: old?.id ?? newId("w"),
      name,
      kind: title?.kind ?? old?.kind ?? "unknown",
      addedAt: now,
      from: FROM.has(input.from as WatchItem["from"]) ? input.from! : "tv",
    };
    if (year) item.year = year;
    const keptTitle = title ?? old?.title;
    if (keptTitle) item.title = keptTitle;
    const rest = list.filter((i) => i !== old);
    if (!old && rest.length >= MAX_ITEMS) throw new WatchlistError(`The list holds ${MAX_ITEMS} things. Remove some first.`);
    this.save(profileId, [item, ...rest]);
    return item;
  }

  remove(profileId: string | null, idOrTitleId: string): boolean {
    const list = this.list(profileId);
    const next = list.filter((i) => i.id !== idOrTitleId && i.title?.id !== idOrTitleId);
    if (next.length === list.length) return false;
    this.save(profileId, next);
    return true;
  }

  has(profileId: string | null, titleId: string): boolean {
    return this.list(profileId).some((i) => i.title?.id === titleId);
  }

  /**
   * Looks for a title for each saved name that has none yet, at most every few hours each. `search`
   * is the library's search; the best film or series result with the same name (and year, if
   * given) wins.
   */
  async resolveNames(profileId: string | null, search: (q: string) => Promise<SearchResult[]>, now = Date.now()): Promise<number> {
    const list = this.list(profileId);
    const looked = this.db.getKv<Record<string, number>>("watchlist-looked") ?? {};
    let found = 0;
    for (const item of list) {
      if (item.title || (looked[item.id] ?? 0) > now - LOOK_AGAIN_MS) continue;
      looked[item.id] = now;
      const results = await search(item.name).catch(() => [] as SearchResult[]);
      const match = results.find((r) => r.kind === "title" && r.title && norm(r.title.name) === norm(item.name) && (!item.year || !r.title.year || r.title.year === item.year));
      if (match?.title) {
        const ref = keepRef(match.title);
        if (ref) {
          item.title = ref;
          item.kind = ref.kind;
          if (ref.year && !item.year) item.year = ref.year;
          found++;
        }
      }
    }
    this.db.setKv("watchlist-looked", looked);
    if (found) this.save(profileId, list);
    return found;
  }
}

/** Kids see only what their profile allows; names with no title yet are fine. */
const visible = (items: WatchItem[], f: ContentFilter) => (f.kids ? items.filter((i) => !i.title || f.ref(i.title)) : items);

export function registerWatchlist(
  app: FastifyInstance,
  watchlist: Watchlist,
  who: (req: FastifyRequest) => { profileId: string | null; filter: ContentFilter },
  search: (q: string, f: ContentFilter) => Promise<SearchResult[]>,
): void {
  type Req<B> = FastifyRequest<{ Body: B; Params: { id: string } }>;
  const list = (req: FastifyRequest) => {
    const { profileId, filter } = who(req);
    return { items: visible(watchlist.list(profileId), filter) };
  };
  app.get("/api/watchlist", async (req) => {
    const { profileId, filter } = who(req);
    // Names saved before a source had them: look again in the background.
    void watchlist.resolveNames(profileId, (q) => search(q, filter));
    return list(req);
  });
  app.post("/api/watchlist", async (req: Req<WatchlistInput>, reply) => {
    const { profileId, filter } = who(req);
    const body = req.body ?? {};
    if (body.title && filter.kids) {
      const ref = keepRef(body.title);
      if (ref && !filter.ref(ref)) return reply.code(403).send({ error: "That isn't available on this profile" });
    }
    try {
      const item = watchlist.add(profileId, body);
      if (!item.title) void watchlist.resolveNames(profileId, (q) => search(q, filter));
      return { item, ...list(req) };
    } catch (err) {
      if (err instanceof WatchlistError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
  app.delete("/api/watchlist/:id", async (req: Req<unknown>) => ({ ok: watchlist.remove(who(req).profileId, decodeURIComponent(req.params.id)), ...list(req) }));
}
