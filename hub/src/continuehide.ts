import type { Id } from "@ultimatetv/shared";
import type { Db } from "./db.js";

/** Titles taken off Continue watching (issue #100).
 *
 *  Hiding is per profile and keeps the progress: the card disappears from that
 *  profile's row and comes back by itself once the title is played again after
 *  the hide. Marking watched is the other action: it writes `watched` through
 *  the progress store (and Jellyfin), so Jellyfin drops it too.
 */
export const MAX_HIDDEN = 500;
const STALE_MS = 90 * 86_400_000;

/** The subset of the event bus this store needs. */
export interface HideEvents {
  emit(event: { type: "progress.changed" }): void;
}

interface Stored {
  /** Title id -> when it was hidden (ms). */
  [titleId: string]: number;
}

export class ContinueHidden {
  constructor(private readonly db: Db, private readonly events: HideEvents) {}

  private key(profileId: string | null): string {
    return `continue-hidden:${profileId ?? "default"}`;
  }

  private stored(profileId: string | null): Stored {
    const raw = this.db.getKv<unknown>(this.key(profileId));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Stored = {};
    for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
    return out;
  }

  /** Every hidden title for a profile, id -> hidden at (ms). */
  list(profileId: string | null): Stored {
    return this.stored(profileId);
  }

  hiddenAt(profileId: string | null, titleId: Id): number | undefined {
    return this.stored(profileId)[titleId];
  }

  /** Hidden until it's played after the moment it was hidden. */
  isHidden(profileId: string | null, titleId: Id, playedAt: number): boolean {
    const at = this.hiddenAt(profileId, titleId);
    return at !== undefined && playedAt <= at;
  }

  hide(profileId: string | null, titleId: Id, now = Date.now()): void {
    const list = this.stored(profileId);
    list[titleId] = now;
    const ids = Object.keys(list);
    if (ids.length > MAX_HIDDEN) {
      ids
        .sort((a, b) => list[a]! - list[b]!)
        .slice(0, ids.length - MAX_HIDDEN)
        .forEach((id) => delete list[id]);
    }
    // Anything hidden months ago has been played (or forgotten) by now.
    for (const [id, at] of Object.entries(list)) if (now - at > STALE_MS) delete list[id];
    this.db.setKv(this.key(profileId), list);
    this.events.emit({ type: "progress.changed" });
  }

  /** Undo: put it back in the row. */
  show(profileId: string | null, titleId: Id): void {
    const list = this.stored(profileId);
    if (!(titleId in list)) return;
    delete list[titleId];
    this.db.setKv(this.key(profileId), list);
    this.events.emit({ type: "progress.changed" });
  }

  /** A profile was deleted: drop its list. */
  forget(profileId: string): void {
    this.db.setKv(this.key(profileId), null);
  }
}
