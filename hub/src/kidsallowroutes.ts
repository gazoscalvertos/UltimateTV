// The routes behind a parent's allow/block list and the weekly viewing summary (issue #110). The
// phone setup page and the TV both use them; the writing side is adult-only, enforced here as well
// as in ADMIN_ROUTES so a Kids profile can't edit its own list even if it finds the route.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { KidsAllowKind, KidsSummary, KidsViewingTitle, Profile } from "@ultimatetv/shared";
import { isKidsAllowKind, KIDS_SUMMARY_DAYS, MAX_KIDS_LOCKOUTS } from "@ultimatetv/shared";
import type { KidsAllow } from "./kidsallow.js";
import type { KidsAsks } from "./kidsasks.js";
import type { KidsViewing } from "./kidsviewing.js";
import type { KidsTime } from "./kidstime.js";
import type { ProfileStore } from "./profiles.js";

type Viewer = { profile: Profile | null; admin: boolean };

/** Lockouts kept for the summary, so "any PIN lockouts" has something to show. */
export interface KidsLockoutLog {
  add(profileId: string, minutes: number, now?: number): void;
  list(): { at: number; profileId: string; minutes: number }[];
  forget(profileId: string): void;
}

/** What a title's allowance entry should say for a given kind. */
function kindOf(raw: unknown): KidsAllowKind | null {
  return isKidsAllowKind(raw) ? raw : null;
}

export function registerKidsAllow(app: FastifyInstance, deps: { allow: KidsAllow; asks?: KidsAsks; viewing: KidsViewing; time: KidsTime; lockouts: KidsLockoutLog; profiles: ProfileStore; viewer: (req: FastifyRequest) => Viewer }): void {
  type Req<P, Q, B> = FastifyRequest<{ Params: P; Querystring: Q; Body: B }>;
  const { allow, asks, viewing, time, lockouts, profiles, viewer } = deps;

  /** The week's "Ask a parent" requests, with when each was asked and what the answer was (#224). */
  const withAsks = (s: KidsSummary): KidsSummary => {
    if (!asks) return s;
    const from = new Date(`${s.from}T00:00:00`).getTime();
    return { ...s, asks: asks.since(s.profileId, from) };
  };

  /** Every Kids profile's lists for an adult; a Kids profile only ever sees its own. */
  app.get("/api/kids-allow", async (req) => {
    const who = viewer(req);
    if (who.profile?.kind === "kids") return { profiles: [{ profileId: who.profile.id, profileName: who.profile.name, list: allow.list(who.profile.id) }] };
    if (!who.admin) return { profiles: [] };
    return { profiles: profiles.list().filter((p) => p.kind === "kids").map((p) => ({ profileId: p.id, profileName: p.name, list: allow.list(p.id) })) };
  });

  /** Allow or block one title or channel on a Kids profile. */
  app.patch("/api/kids-allow/:id", async (req: Req<{ id: string }, Record<string, string>, { side?: unknown; id?: unknown; kind?: unknown; name?: unknown }>) => {
    const who = viewer(req);
    if (!who.admin) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    const kids = profiles.get(req.params.id);
    if (!kids) throw Object.assign(new Error("No such profile"), { statusCode: 404 });
    if (kids.kind !== "kids") throw Object.assign(new Error("Only a Kids profile has these lists"), { statusCode: 400 });
    const side = req.body?.side;
    if (side !== "allow" && side !== "block") throw Object.assign(new Error("Say whether to allow it or block it"), { statusCode: 400 });
    const kind = kindOf(req.body?.kind);
    const titleId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.replace(/\s+/g, " ").trim() : "";
    if (!kind) throw Object.assign(new Error("That isn't a film, series or channel"), { statusCode: 400 });
    if (!titleId || !name) throw Object.assign(new Error("Which title, and what's it called?"), { statusCode: 400 });
    return { list: allow.add(kids.id, side, { id: titleId, kind, name }) };
  });

  /** Take one back off the lists, so its rating decides again. */
  app.delete("/api/kids-allow/:id/:kind/:titleId", async (req: Req<{ id: string; kind: string; titleId: string }, Record<string, string>, Record<string, string>>) => {
    const who = viewer(req);
    if (!who.admin) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    const kids = profiles.get(req.params.id);
    if (!kids) throw Object.assign(new Error("No such profile"), { statusCode: 404 });
    const kind = kindOf(req.params.kind);
    if (!kind) throw Object.assign(new Error("That isn't a film, series or channel"), { statusCode: 400 });
    return { list: allow.remove(kids.id, kind, decodeURIComponent(req.params.titleId)) };
  });

  /**
   * The week's viewing for one Kids profile: what it played, how long per day, and any PIN
   * lockouts. An adult sees every profile's; a Kids profile only its own.
   */
  app.get("/api/kids-summary", async (req: Req<Record<string, string>, { profile?: string }, Record<string, string>>) => {
    const who = viewer(req);
    const asked = typeof req.query?.profile === "string" ? profiles.get(req.query.profile) : undefined;
    const mine = who.profile?.kind === "kids" ? who.profile : undefined;
    if (mine && asked && asked.id !== mine.id) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    if (!mine && !who.admin) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    const target = mine ?? (asked?.kind === "kids" ? asked : undefined) ?? profiles.list().find((p) => p.kind === "kids");
    if (!target) return { summaries: [] };
    const summary = (p: Profile): KidsSummary => withAsks(viewing.summary(p.id, p.name, time.usedByDay(p.id), lockouts.list(), Date.now(), KIDS_SUMMARY_DAYS));
    const wanted = mine || asked ? [target] : profiles.list().filter((p) => p.kind === "kids");
    return { summaries: wanted.map(summary) };
  });

  /** Titles a Kids profile played today, for the phone to show alongside the day's total. */
  app.get("/api/kids-summary/:id", async (req: Req<{ id: string }, Record<string, string>, Record<string, string>>) => {
    const who = viewer(req);
    const kids = profiles.get(req.params.id);
    if (!kids || kids.kind !== "kids") throw Object.assign(new Error("No such Kids profile"), { statusCode: 404 });
    if (who.profile?.kind === "kids" && who.profile.id !== kids.id) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    if (!who.admin && who.profile?.kind !== "kids") throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    return withAsks(viewing.summary(kids.id, kids.name, time.usedByDay(kids.id), lockouts.list(), Date.now(), KIDS_SUMMARY_DAYS));
  });
}

/** The lockout log lives in the settings database so a restart doesn't wipe the week's record. */
export const MAX_KIDS_LOCKOUTS_EXPORT = MAX_KIDS_LOCKOUTS;
export type { KidsViewingTitle };
