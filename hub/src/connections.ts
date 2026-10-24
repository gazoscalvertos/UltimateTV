// The IPTV connection guard. The provider allows a fixed number of simultaneous streams (one on
// Gary's plan), counted across live viewing, recording, catch-up and Xtream VOD. Every upstream
// IPTV request goes through here, so the Hub never opens more than the plan allows.

/** view = someone watching, record = a live recording, background = a catch-up download that can wait. */
export type LeaseKind = "view" | "record" | "background";

export interface Lease {
  key: string;
  /** Who is using it: "box", "recording:<id>", … */
  holders: Map<string, LeaseKind>;
  label: string;
  since: number;
  lastActive: number;
  /** Called when the lease is taken away (a recording takes the connection, or "switch anyway"). */
  onRevoke: Set<(reason: string) => void>;
  /** Short-lived leases (VOD range requests) expire when idle; live streams release explicitly. */
  idleMs?: number;
}

export class ConnectionBusyError extends Error {
  constructor(
    message: string,
    readonly blockingRecordings: string[],
  ) {
    super(message);
  }
}

export interface AcquireOptions {
  key: string;
  holder: string;
  kind: LeaseKind;
  label: string;
  /** Stop recordings in the way (the user chose "Switch anyway"). */
  force?: boolean;
  idleMs?: number;
  onRevoke?: (reason: string) => void;
}

export class ConnectionGuard {
  private leases = new Map<string, Lease>();

  constructor(
    private limit: () => number,
    private now: () => number = Date.now,
  ) {}

  private expire(): void {
    const t = this.now();
    for (const [key, lease] of this.leases) {
      if (lease.idleMs !== undefined && t - lease.lastActive > lease.idleMs) this.leases.delete(key);
    }
  }

  /** True when nobody is watching or recording, so a background download may start. */
  idle(): boolean {
    this.expire();
    return this.leases.size < this.limit() && ![...this.leases.values()].some((l) => [...l.holders.values()].includes("view"));
  }

  status(): { used: number; limit: number; holders: string[] } {
    this.expire();
    return { used: this.leases.size, limit: this.limit(), holders: [...this.leases.values()].map((l) => l.label) };
  }

  /** What would happen if `kind` asked for `key` now, without changing anything. */
  check(key: string, kind: LeaseKind): { ok: true } | { ok: false; preempts: Lease[]; blockedBy: Lease[] } {
    this.expire();
    if (this.leases.has(key) || this.leases.size < this.limit()) return { ok: true };
    const others = [...this.leases.values()];
    const kinds = (l: Lease) => [...l.holders.values()];
    // Background downloads give way to anything; they are retried later.
    const background = others.filter((l) => kinds(l).every((k) => k === "background"));
    if (background.length > 0) return { ok: false, preempts: [oldest(background)], blockedBy: [] };
    if (kind === "background") return { ok: false, preempts: [], blockedBy: others };
    // A viewer changing channel frees its old stream; a recording may take a viewer's stream.
    const viewerOnly = others.filter((l) => kinds(l).every((k) => k !== "record"));
    if (viewerOnly.length > 0) return { ok: false, preempts: [oldest(viewerOnly)], blockedBy: [] };
    return { ok: false, preempts: [], blockedBy: others };
  }

  acquire(opts: AcquireOptions): Lease {
    this.expire();
    const t = this.now();
    let lease = this.leases.get(opts.key);
    if (!lease) {
      while (this.leases.size >= this.limit()) {
        const verdict = this.check(opts.key, opts.kind);
        if (verdict.ok) break;
        const victim = verdict.preempts[0] ?? (opts.force && opts.kind === "view" ? oldest(verdict.blockedBy) : undefined);
        if (!victim) {
          const recordings = verdict.blockedBy.flatMap((l) => [...l.holders.keys()].filter((h) => h.startsWith("recording:")).map((h) => h.slice(10)));
          throw new ConnectionBusyError(`All ${this.limit()} IPTV connection(s) in use: ${verdict.blockedBy.map((l) => l.label).join(", ")}`, recordings);
        }
        // The reason names the key that took over, e.g. "recording:live:bbc-one".
        this.revoke(victim.key, opts.kind === "record" ? `recording:${opts.key}` : `switched:${opts.key}`);
      }
      lease = { key: opts.key, holders: new Map(), label: opts.label, since: t, lastActive: t, onRevoke: new Set() };
      if (opts.idleMs !== undefined) lease.idleMs = opts.idleMs;
      this.leases.set(opts.key, lease);
    }
    lease.holders.set(opts.holder, opts.kind);
    lease.lastActive = t;
    if (opts.onRevoke) lease.onRevoke.add(opts.onRevoke);
    return lease;
  }

  touch(key: string): void {
    const lease = this.leases.get(key);
    if (lease) lease.lastActive = this.now();
  }

  release(key: string, holder: string): void {
    const lease = this.leases.get(key);
    if (!lease) return;
    lease.holders.delete(holder);
    if (lease.holders.size === 0) this.leases.delete(key);
  }

  revoke(key: string, reason: string): void {
    const lease = this.leases.get(key);
    if (!lease) return;
    this.leases.delete(key);
    for (const cb of lease.onRevoke) cb(reason);
  }

  holdersOf(key: string): Map<string, LeaseKind> | undefined {
    return this.leases.get(key)?.holders;
  }
}

function oldest(leases: Lease[]): Lease {
  return leases.reduce((a, b) => (a.lastActive <= b.lastActive ? a : b));
}
