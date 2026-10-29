// The sleep timer. The Hub only keeps it, so the TV and the phone see the same one; the TV app does
// the work (a warning a minute before, then stop and standby over HDMI-CEC) because only it knows
// what's on and can reach the TV. Times travel as "left", not as clock times, so neither side has
// to trust the other's clock.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { SLEEP_MINUTES, type SleepTimer } from "@ultimatetv/shared";
import type { EventBus } from "./events.js";

/** The longest anyone can ask for, from the phone's own number box. */
const MAX_MINUTES = 12 * 60;

interface SleepBody {
  minutes?: unknown;
  /** "programme": at the end of what's on now. */
  mode?: unknown;
  /** The TV telling the Hub when the programme ends, or that it pushed the timer back. */
  leftMs?: unknown;
  programme?: unknown;
  by?: unknown;
}

export class SleepTimers {
  private mode: SleepTimer["mode"] = "off";
  private endsAt: number | null = null;
  private minutes: number | undefined;
  private programme: string | undefined;
  private by: SleepTimer["by"];

  constructor(
    private readonly events: EventBus,
    private readonly now: () => number = Date.now,
  ) {}

  current(): SleepTimer {
    const now = this.now();
    // Ran out with nobody to clear it (the TV was off): it's over.
    if (this.endsAt !== null && this.endsAt <= now - 60_000) this.reset();
    return {
      mode: this.mode,
      leftMs: this.endsAt === null ? null : Math.max(0, this.endsAt - now),
      ...(this.minutes !== undefined ? { minutes: this.minutes } : {}),
      ...(this.programme ? { programme: this.programme } : {}),
      ...(this.by ? { by: this.by } : {}),
    };
  }

  /** Sets, changes or (minutes 0) turns off the timer; throws a 400 for nonsense. */
  set(body: SleepBody): SleepTimer {
    const by = body.by === "tv" ? "tv" : "phone";
    if (body.mode === "programme") {
      this.mode = "programme";
      this.minutes = undefined;
      const left = Number(body.leftMs);
      // The phone can't know when the programme ends: the TV fills it in when it hears.
      this.endsAt = Number.isFinite(left) && left > 0 ? this.now() + left : null;
      this.programme = typeof body.programme === "string" ? body.programme.slice(0, 120) : undefined;
    } else if (body.leftMs !== undefined && body.minutes === undefined) {
      const left = Number(body.leftMs);
      if (!Number.isFinite(left) || left <= 0 || left > MAX_MINUTES * 60_000) throw badRequest("leftMs must be a time in the next 12 hours");
      if (this.mode === "off") this.mode = "minutes";
      this.endsAt = this.now() + left;
      if (typeof body.programme === "string") this.programme = body.programme.slice(0, 120);
    } else {
      const minutes = Number(body.minutes);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_MINUTES) throw badRequest(`Send minutes (${SLEEP_MINUTES.join(", ")}), mode "programme", or minutes 0 to turn it off`);
      if (minutes === 0) return this.clear(by);
      this.mode = "minutes";
      this.minutes = Math.round(minutes);
      this.endsAt = this.now() + this.minutes * 60_000;
      this.programme = undefined;
    }
    this.by = by;
    return this.changed();
  }

  clear(by?: SleepTimer["by"]): SleepTimer {
    this.reset();
    if (by) this.by = by;
    return this.changed();
  }

  private reset(): void {
    this.mode = "off";
    this.endsAt = null;
    this.minutes = undefined;
    this.programme = undefined;
    this.by = undefined;
  }

  private changed(): SleepTimer {
    const timer = this.current();
    this.events.emit({ type: "sleep", timer });
    return timer;
  }
}

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

type Req = FastifyRequest<{ Body: SleepBody | undefined }>;

export function registerSleep(app: FastifyInstance, timers: SleepTimers): void {
  app.get("/api/sleep", async () => ({ timer: timers.current() }));
  app.put("/api/sleep", async (req: Req) => ({ timer: timers.set(req.body ?? {}) }));
  app.delete("/api/sleep", async (req: FastifyRequest<{ Querystring: { by?: string } }>) => ({ timer: timers.clear(req.query.by === "tv" ? "tv" : "phone") }));
}
