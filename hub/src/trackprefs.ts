// Audio and subtitle choice per series (issue #228): pick Japanese with English subtitles once and
// the next episode, Up Next and Resume all start that way. One list per profile, kept by series
// (or film) id, as a language and kind rather than a track number so it fits every source.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { cleanTrackPref, MAX_TRACK_PREFS, type TrackPref } from "@ultimatetv/shared";
import type { Db } from "./db.js";

export class TrackPrefs {
  constructor(private readonly db: Db) {}

  private key(profileId: string | null) {
    return `track-prefs:${profileId ?? "default"}`;
  }

  private all(profileId: string | null): Record<string, TrackPref> {
    return this.db.getKv<Record<string, TrackPref>>(this.key(profileId)) ?? {};
  }

  get(profileId: string | null, titleId: string): TrackPref | null {
    return this.all(profileId)[titleId] ?? null;
  }

  /** Merges into what was saved: picking only subtitles keeps the sound choice. */
  set(profileId: string | null, titleId: string, raw: unknown, now = Date.now()): TrackPref | null {
    const next = cleanTrackPref(raw, now);
    if (!next) return null;
    const all = this.all(profileId);
    const merged: TrackPref = { ...all[titleId], ...next, at: now };
    all[titleId] = merged;
    // The oldest go first once there are too many.
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_TRACK_PREFS);
    this.db.setKv(this.key(profileId), Object.fromEntries(keep));
    return merged;
  }

  /** "Default": back to the profile's own settings. */
  clear(profileId: string | null, titleId: string): boolean {
    const all = this.all(profileId);
    if (!(titleId in all)) return false;
    delete all[titleId];
    this.db.setKv(this.key(profileId), all);
    return true;
  }
}

export function registerTrackPrefs(app: FastifyInstance, prefs: TrackPrefs, who: (req: FastifyRequest) => string | null): void {
  type Req<B = unknown> = FastifyRequest<{ Body: B; Querystring: { title?: string } }>;
  app.get("/api/track-prefs", async (req: Req) => ({ pref: req.query.title ? prefs.get(who(req), req.query.title) : null }));
  app.put("/api/track-prefs", async (req: Req<{ title?: string }>, reply) => {
    const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 200) : "";
    const pref = title ? prefs.set(who(req), title, req.body) : null;
    if (!pref) return reply.code(400).send({ error: "Nothing to remember" });
    return { pref };
  });
  app.delete("/api/track-prefs", async (req: Req) => ({ ok: req.query.title ? prefs.clear(who(req), req.query.title) : false }));
}
