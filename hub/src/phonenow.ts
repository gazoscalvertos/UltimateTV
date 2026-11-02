// A phone's way to wait for the TV's playback state instead of asking over and over: the Hub
// answers at once when something has changed since the phone last asked, and otherwise holds the
// request open until it does (or a few seconds pass). See issue #109.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { HaState } from "@ultimatetv/shared";

/** The longest a request is held: the phone asks again after this, so the socket is never idle for long. */
export const MAX_WAIT_MS = 25_000;

export class PhoneNow {
  private seq = 0;
  private waiters = new Set<() => void>();

  /** Something changed: let every phone waiting hear it, and start a new number. */
  bump(): void {
    this.seq++;
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const wake of waiting) {
      try {
        wake();
      } catch {
        // A waiter that throws is one phone's problem: the others still hear it.
      }
    }
  }

  get current(): number {
    return this.seq;
  }

  /**
   * Resolves as soon as the TV's state is no longer the one `since` described, or after `ms`
   * (clamped to MAX_WAIT_MS), whichever comes first. The deadline is the event loop's timer, so a
   * caller's clock can't disagree with it.
   */
  waitFor(since: number, ms: number): Promise<void> {
    if (since !== this.seq) return Promise.resolve();
    const wait = Number.isFinite(ms) ? Math.min(Math.max(Math.trunc(ms), 0), MAX_WAIT_MS) : MAX_WAIT_MS;
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve();
      };
      // A wait of zero is answered on the next turn, as a phone that asked for no wait expects.
      const timer = setTimeout(finish, wait);
      this.waiters.add(finish);
    });
  }
}

type Req<Q = unknown> = FastifyRequest<{ Querystring: Q }>;

export function registerPhoneNow(app: FastifyInstance, deps: { now: PhoneNow; state: () => HaState }): void {
  /** What the TV is playing, held open until it changes (see PhoneNow above). */
  app.get("/api/remote/now", async (req: Req<{ since?: string; wait?: string }>, reply) => {
    const q = req.query ?? {};
    const since = Number.parseInt(String(q.since ?? "0"), 10) || 0;
    await deps.now.waitFor(since, Number.parseInt(String(q.wait ?? ""), 10));
    return reply.header("Cache-Control", "no-store").send({ seq: deps.now.current, state: deps.state() });
  });
}
