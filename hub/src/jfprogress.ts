// Jellyfin progress made while Jellyfin can't be reached (issue #80).
//
// The Hub already keeps where everything got to in its own database (ProgressStore). For Jellyfin
// titles it also tells Jellyfin, so a film watches the same everywhere. On a trip the Hub runs on the
// box and Jellyfin (at home) is out of reach, so those reports were thrown away with a log line and
// the film showed as unwatched at home. Now the place is kept here and sent when Jellyfin answers
// again: when the Hub is back on the home network, when it starts with Jellyfin configured, or when
// Jellyfin is set up in Settings.
//
// The queue lives in the Hub's database, which is exactly what `tools/hub/travel.sh home` carries
// home, so anything watched on the box comes back with it. The Android app has its own copy of this
// idea on the phone (Offline.syncPositions) and posts to /api/progress, which lands here.
//
// One rule, because both sides may have moved on: if Jellyfin says the title was played somewhere
// else more recently than our saved place, Jellyfin's is the newer one and the queued place is
// dropped. Our place still counts as newer when the timestamps tie.

import type { Db } from "./db.js";

/** How many titles the queue holds; the oldest go first when it is full. */
export const MAX_QUEUED = 200;

/** The database key the queue lives under. */
export const QUEUE_KEY = "jellyfin-progress";

/** Jellyfin's own report shape; "progress" and "start" are kept too, so a report can be replayed as it was. */
export type QueuedEvent = "start" | "progress" | "stop";

export interface QueuedProgress {
  /** The Jellyfin item id, without the "jellyfin:" prefix the player uses. */
  itemId: string;
  positionMs: number;
  durationMs?: number;
  event: QueuedEvent;
  /** The title reached the end, so Jellyfin should mark it played too. */
  played?: boolean;
  /** When the Hub saved this. The newest place for a title replaces the one before it. */
  at: number;
}

/** What Jellyfin currently thinks, for the newest-wins rule. */
export interface JellyfinPlace {
  /** LastPlayedDate in milliseconds, or 0 when Jellyfin doesn't know. */
  lastPlayedAt: number;
  played: boolean;
}

/**
 * The queue itself. One row per title: a later report for the same item replaces the earlier one, so
 * watching straight through an unreachable Jellyfin never piles up entries.
 */
export class JellyfinProgressQueue {
  constructor(private readonly db: Db) {}

  /** Everything waiting, oldest first, so it goes out in the order it was watched. */
  list(): QueuedProgress[] {
    const stored = this.db.getKv<unknown>(QUEUE_KEY);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((p): p is QueuedProgress => Boolean(p) && typeof p === "object" && typeof (p as QueuedProgress).itemId === "string" && Number.isFinite((p as QueuedProgress).positionMs))
      .map((p) => p as QueuedProgress)
      .sort((a, b) => a.at - b.at);
  }

  size(): number {
    return this.list().length;
  }

  /** Adds (or updates) the place for one title. */
  queue(entry: Omit<QueuedProgress, "at"> & { at?: number }, now = Date.now()): QueuedProgress[] {
    const next = this.list().filter((p) => p.itemId !== entry.itemId);
    next.push({ ...entry, at: entry.at ?? now });
    next.sort((a, b) => a.at - b.at);
    const kept = next.slice(-MAX_QUEUED);
    this.db.setKv(QUEUE_KEY, kept);
    return kept;
  }

  /** Forgets a title once Jellyfin has it. */
  remove(itemId: string): void {
    const next = this.list().filter((p) => p.itemId !== itemId);
    this.db.setKv(QUEUE_KEY, next);
  }

  clear(): void {
    this.db.setKv(QUEUE_KEY, []);
  }
}

/**
 * True when the Hub's saved place is the newer one, so it should be sent. Jellyfin winning means it
 * was played somewhere else after we noted ours; a tie counts as ours, because our report is the one
 * that just happened as far as the viewer is concerned.
 */
export function newestWins(queued: Pick<QueuedProgress, "at">, remote: JellyfinPlace | null): boolean {
  if (!remote) return true;
  return remote.lastPlayedAt <= queued.at;
}

export interface DrainDeps {
  /** The queue, oldest first. */
  list: () => QueuedProgress[];
  /** Takes a title off the queue. */
  remove: (itemId: string) => void;
  /** Sends one place to Jellyfin. Throwing means "try again later". */
  send: (place: QueuedProgress) => Promise<void>;
  /**
   * Asks Jellyfin where it thinks the title got to. Missing means Jellyfin can't be asked (or has
   * never heard of it): the saved place is sent, because losing it is worse than sending it twice.
   */
  lookup?: (place: QueuedProgress) => Promise<JellyfinPlace | null>;
}

export interface DrainResult {
  sent: number;
  /** Dropped because Jellyfin's own place was newer. */
  skipped: number;
  /** Still waiting, because sending failed. */
  left: number;
}

/**
 * Sends what's waiting, oldest first. A failure stops the pass (the network is probably still down)
 * and leaves that title and everything after it queued.
 */
export async function drainQueue(deps: DrainDeps): Promise<DrainResult> {
  const waiting = deps.list();
  if (!waiting.length) return { sent: 0, skipped: 0, left: 0 };
  let sent = 0;
  let skipped = 0;
  for (const place of waiting) {
    let remote: JellyfinPlace | null = null;
    if (deps.lookup) {
      try {
        remote = await deps.lookup(place);
      } catch {
        remote = null;
      }
    }
    if (!newestWins(place, remote)) {
      deps.remove(place.itemId);
      skipped++;
      continue;
    }
    try {
      await deps.send(place);
    } catch {
      return { sent, skipped, left: waiting.length - sent - skipped };
    }
    deps.remove(place.itemId);
    sent++;
  }
  return { sent, skipped, left: 0 };
}
