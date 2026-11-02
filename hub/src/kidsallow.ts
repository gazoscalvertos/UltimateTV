// A parent's allow/block list for a Kids profile (issue #110). The rating limit is blunt: most
// IPTV VOD carries no certificate at all and the ones that do were picked for another country, so
// a parent saying "this one's fine" or "not this one" has to win over the certificate either way.
// One list per Kids profile, kept in the settings database, enforced in ContentFilter so every
// route that shows or plays a title goes through it.

import { cleanKidsAllowEntries, MAX_KIDS_ALLOW, type KidsAllowEntry, type KidsAllowKind, type KidsAllowList } from "@ultimatetv/shared";
import type { Db } from "./db.js";

interface AllowEvents {
  emit(event: { type: "kids.allow.changed"; profileId: string }): void;
}

export class KidsAllow {
  constructor(
    private readonly db: Db,
    private readonly events: AllowEvents,
  ) {}

  private key(profileId: string): string {
    return `kids-allow:${profileId}`;
  }

  /** What a Kids profile has been allowed and blocked, ignoring anything unexpected in the database. */
  list(profileId: string): KidsAllowList {
    const raw = this.db.getKv<unknown>(this.key(profileId));
    const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return {
      allow: cleanKidsAllowEntries(o.allow),
      block: cleanKidsAllowEntries(o.block),
    };
  }

  /** Adds a title or channel to one side, moving it off the other. */
  add(profileId: string, side: "allow" | "block", entry: { id: string; kind: KidsAllowKind; name: string }, now = Date.now()): KidsAllowList {
    const current = this.list(profileId);
    const others = side === "allow" ? "block" : "allow";
    const make = (e: KidsAllowEntry) => `${e.kind}:${e.id}`;
    const key = `${entry.kind}:${entry.id}`;
    // Saying yes to something that was blocked is a change of mind, not two entries.
    const kept = current[others].filter((e) => make(e) !== key);
    const mine = current[side].filter((e) => make(e) !== key);
    mine.unshift({ id: entry.id, kind: entry.kind, name: entry.name.slice(0, 200), addedAt: now });
    const next: KidsAllowList = {
      allow: side === "allow" ? mine.slice(0, MAX_KIDS_ALLOW) : kept.slice(0, MAX_KIDS_ALLOW),
      block: side === "block" ? mine.slice(0, MAX_KIDS_ALLOW) : kept.slice(0, MAX_KIDS_ALLOW),
    };
    this.save(profileId, next);
    return next;
  }

  /** Takes a title or channel off both lists, so it goes back to whatever its rating says. */
  remove(profileId: string, kind: KidsAllowKind, id: string): KidsAllowList {
    const current = this.list(profileId);
    const make = (e: KidsAllowEntry) => `${e.kind}:${e.id}`;
    const key = `${kind}:${id}`;
    const next: KidsAllowList = {
      allow: current.allow.filter((e) => make(e) !== key),
      block: current.block.filter((e) => make(e) !== key),
    };
    this.save(profileId, next);
    return next;
  }

  /** A deleted profile takes its lists with it. */
  forget(profileId: string): void {
    this.db.setKv(this.key(profileId), null);
    this.events.emit({ type: "kids.allow.changed", profileId });
  }

  private save(profileId: string, list: KidsAllowList): void {
    const empty = !list.allow.length && !list.block.length;
    this.db.setKv(this.key(profileId), empty ? null : list);
    this.events.emit({ type: "kids.allow.changed", profileId });
  }
}
