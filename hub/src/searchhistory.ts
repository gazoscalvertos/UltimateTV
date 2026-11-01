// Recent searches: one list per profile, kept on the Hub so they follow the profile from the TV
// to the desktop app and the phone remote. Typing with a remote is slow, so the Search screen
// offers them before anything is typed and as suggestions while typing.
//
// No profile (a Hub with no profiles yet) keeps the household's list. Each profile's list is its
// own: the Kids profile's searches never show on an adult's, nor the other way round.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RecentSearch } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";

export const MAX_SEARCHES = 20;
const MAX_LENGTH = 80;

/** Tidies what was typed: one space between words, at most 80 letters. */
export const cleanSearch = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH) : "");
/** "Dune ", "dune" and "DUNE" are the same search. */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class SearchHistory {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  private key(profileId: string | null) {
    return `search-history:${profileId ?? "default"}`;
  }

  /** Newest first. */
  list(profileId: string | null): RecentSearch[] {
    return this.db.getKv<RecentSearch[]>(this.key(profileId)) ?? [];
  }

  private save(profileId: string | null, items: RecentSearch[]): void {
    this.db.setKv(this.key(profileId), items);
    this.events.emit({ type: "search.history.changed", profileId });
  }

  /** Puts a search at the top; searching it again moves it up rather than adding it twice. */
  add(profileId: string | null, raw: unknown, now = Date.now()): RecentSearch | null {
    const q = cleanSearch(raw);
    if (q.length < 2) return null;
    const item = { q, at: now };
    this.save(profileId, [item, ...this.list(profileId).filter((i) => !same(i.q, q))].slice(0, MAX_SEARCHES));
    return item;
  }

  remove(profileId: string | null, raw: unknown): boolean {
    const q = cleanSearch(raw);
    const list = this.list(profileId);
    const next = list.filter((i) => !same(i.q, q));
    if (next.length === list.length) return false;
    this.save(profileId, next);
    return true;
  }

  clear(profileId: string | null): void {
    if (this.list(profileId).length) this.save(profileId, []);
  }
}

/**
 * `who` says whose list a request is about: the profile the TV or app sends, or (for the phone
 * remote, which asks with ?tv=1 and knows no profile) the one on the TV now.
 */
export function registerSearchHistory(app: FastifyInstance, history: SearchHistory, who: (req: FastifyRequest) => string | null): void {
  type Req<B = unknown> = FastifyRequest<{ Body: B; Querystring: { q?: string } }>;
  const list = (req: FastifyRequest) => ({ searches: history.list(who(req)) });
  app.get("/api/search/history", async (req) => list(req));
  app.post("/api/search/history", async (req: Req<{ q?: string }>, reply) => {
    const item = history.add(who(req), req.body?.q);
    if (!item) return reply.code(400).send({ error: "Type at least two letters" });
    return { item, ...list(req) };
  });
  /** With ?q= just that one; without, the lot (Clear all). */
  app.delete("/api/search/history", async (req: Req) => {
    const id = who(req);
    if (req.query.q !== undefined) return { ok: history.remove(id, req.query.q), ...list(req) };
    history.clear(id);
    return { ok: true, ...list(req) };
  });
}
