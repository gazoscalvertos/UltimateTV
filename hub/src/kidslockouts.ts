// PIN lockouts kept for the weekly summary (issue #110): the limiter itself only holds live counts
// and forgets them an hour after the last wrong try, so "any PIN lockouts this week" needs its own
// record. One line per lockout, trimmed to MAX_KIDS_LOCKOUTS.

import { MAX_KIDS_LOCKOUTS, type KidsLockout } from "@ultimatetv/shared";
import type { Db } from "./db.js";

const KEY = "kids-lockouts";

export class KidsLockoutLog {
  constructor(private readonly db: Db) {}

  /** A wrong PIN that triggered a lockout: how long it lasted, in whole minutes. */
  add(profileId: string, minutes: number, now = Date.now()): void {
    if (!(minutes > 0)) return;
    const list = this.list();
    list.push({ at: now, profileId, minutes: Math.ceil(minutes) });
    this.db.setKv(KEY, list.slice(-MAX_KIDS_LOCKOUTS));
  }

  list(): KidsLockout[] {
    const raw = this.db.getKv<unknown>(KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l): l is KidsLockout => {
        const o = l as Partial<KidsLockout> | null;
        return Boolean(o && typeof o.at === "number" && typeof o.profileId === "string" && typeof o.minutes === "number" && o.minutes > 0);
      })
      .slice(-MAX_KIDS_LOCKOUTS);
  }

  forget(profileId: string): void {
    const kept = this.list().filter((l) => l.profileId !== profileId);
    this.db.setKv(KEY, kept.length ? kept : null);
  }
}
