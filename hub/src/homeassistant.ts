// Home Assistant both ways (see shared/src/homeassistant.ts): the TV app reports what it's doing,
// Home Assistant reads it as a media player and sends commands back, and each playback event
// (a film starting, a pause, the credits) goes to a webhook so automations can dim the lights.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cleanHaCommand, cleanHaSettings, cleanTvPlayState, DEFAULT_HA_SETTINGS, haEvents, haState, type BoxTarget, type HaEvent, type HaSettings, type HaState, type TvMethod, type TvPlayState } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";

/** How many recent events Settings shows, to check the webhook is getting them. */
const RECENT = 10;

export class HomeAssistant {
  /** Called whenever the TV reports: a phone waiting on `/api/remote/now` hears it (see phonenow.ts). */
  onState: ((state: HaState) => void) | null = null;
  /**
   * What each box is doing, by paired-device id (issue #103). A Hub with one box keys everything
   * under "" (the box before it had an id); a second box gets its own entry, so the bedroom's film
   * doesn't overwrite the living room's.
   */
  private last = new Map<string, TvPlayState>();
  private reportedAt = new Map<string, number>();
  private recent: (HaEvent & { sent?: boolean; error?: string })[] = [];

  constructor(
    private readonly ctx: HubContext,
    /** Whether a box is connected: all of them, or the one named (issue #103). */
    private readonly connected: (box?: string) => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  private tvConnected(box?: string): boolean {
    return this.connected(box);
  }

  settings(): HaSettings {
    return cleanHaSettings(this.ctx.db.getKv<Partial<HaSettings>>("ha-settings") ?? {}, DEFAULT_HA_SETTINGS);
  }

  saveSettings(patch: Partial<HaSettings>): HaSettings {
    const s = cleanHaSettings(patch, this.settings());
    this.ctx.db.setKv("ha-settings", s);
    return s;
  }

  appName(): string {
    return this.ctx.settings.get().appName || "UltimateTV";
  }

  /** The TV said what it's doing: keep it and send whatever changed to the webhook. */
  report(raw: unknown, box = ""): HaEvent[] | null {
    const next = cleanTvPlayState(raw);
    if (!next) return null;
    const now = this.now();
    const events = haEvents(this.last.get(box) ?? null, next, this.appName(), now);
    this.last.set(box, next);
    this.reportedAt.set(box, now);
    for (const e of events) void this.send(e);
    // Phones waiting for the TV's state hear it now. A broken listener must never 500 the TV's report.
    try {
      this.onState?.(this.state(undefined, box));
    } catch {
      // Nothing to do: the report itself succeeded, which is what the TV app asked about.
    }
    return events;
  }

  /** The profile on the TV now, as it last reported (null with none, or the box off). */
  tvProfileId(box = ""): string | null {
    return this.tvConnected(box) ? (this.last.get(box)?.profile?.id ?? null) : null;
  }

  /** One box's state. With none named, the Hub's first box (what a one-box Hub always meant). */
  state(hubBase?: string, box = ""): HaState {
    return haState(this.last.get(box) ?? null, { reportedAt: this.reportedAt.get(box) ?? null, connected: this.tvConnected(box), appName: this.appName(), ...(hubBase ? { hubBase } : {}) });
  }

  /** What every box is doing, for the phone's picker and Stats. */
  states(hubBase?: string, boxes: string[] = []): { box: string; state: HaState }[] {
    return boxes.map((b) => ({ box: b, state: this.state(hubBase, b) }));
  }

  /** Forgets a box that was unpaired, so a new one with no films doesn't inherit them. */
  forget(box: string): void {
    this.last.delete(box);
    this.reportedAt.delete(box);
  }

  /** Recent events, newest first, with how sending each one went. */
  events(): (HaEvent & { sent?: boolean; error?: string })[] {
    return [...this.recent].reverse();
  }

  /** Posts one event to the webhook (when one is set). Rejects with why it didn't arrive. */
  async deliver(e: HaEvent): Promise<boolean> {
    const url = this.settings().webhookUrl;
    if (!url) return false;
    const res = await this.ctx.fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e), signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`The webhook answered ${res.status}`);
    return true;
  }

  private async send(e: HaEvent): Promise<void> {
    const entry: HaEvent & { sent?: boolean; error?: string } = { ...e };
    this.recent.push(entry);
    if (this.recent.length > RECENT) this.recent.shift();
    try {
      entry.sent = await this.deliver(e);
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      this.ctx.log.warn({ err: entry.error, event: e.type }, "Couldn't tell Home Assistant");
    }
  }
}

type Req<B = unknown> = FastifyRequest<{ Body: B }>;

export function registerHomeAssistant(
  app: FastifyInstance,
  ha: HomeAssistant,
  deps: {
    callTv: (method: TvMethod, args: unknown, box?: BoxTarget) => Promise<{ result?: unknown; error?: string }>;
    /** Whether a box is connected, or any box when none is named (issue #103). */
    tvConnected: (box?: string) => boolean;
    hubBase: (req: FastifyRequest) => string;
    /** Which box an action is for, as a key into the per-box state ("" for a one-box Hub). */
    boxKey: (raw: unknown) => string;
    /** The box a request came from, for the TV's own reports. */
    boxOf: (req: FastifyRequest) => string;
  },
): void {
  /** The TV app's report (paired screens only). */
  app.post("/api/ha/state", async (req: Req, reply: FastifyReply) => {
    const events = ha.report(req.body, deps.boxOf(req));
    if (!events) return reply.code(400).send({ error: "Not a playback state" });
    return { ok: true, events: events.map((e) => e.type) };
  });
  /** Home Assistant's media player reads this (X-Api-Key). */
  app.get("/api/ha/state", async (req) => ha.state(deps.hubBase(req), deps.boxKey((req.query as { box?: unknown }).box)));
  /** Home Assistant asks the TV to do something (X-Api-Key). */
  app.post("/api/ha/command", async (req: Req, reply: FastifyReply) => {
    const cmd = cleanHaCommand(req.body);
    if ("error" in cmd) return reply.code(400).send({ error: cmd.error });
    const asked = deps.boxKey((req.body as { box?: unknown } | null)?.box);
    if (!deps.tvConnected(asked || undefined)) return reply.code(409).send({ error: "The TV app isn't connected. Is the box on?", code: "tv-off" });
    const answer = await deps.callTv("ha", cmd, asked || null);
    if (answer.error !== undefined) return reply.code(502).send({ error: answer.error });
    return { ok: true, state: ha.state(deps.hubBase(req), asked) };
  });
  app.get("/api/ha/settings", async () => ({ settings: ha.settings(), events: ha.events() }));
  app.put("/api/ha/settings", async (req: Req<Partial<HaSettings>>) => {
    ha.saveSettings(req.body ?? {});
    return { settings: ha.settings(), events: ha.events() };
  });
  /** Sends a made-up "started" event so the automation can be checked without playing anything. */
  app.post("/api/ha/test", async (_req, reply: FastifyReply) => {
    if (!ha.settings().webhookUrl) return reply.code(400).send({ error: "Set the Home Assistant webhook first" });
    const test: HaEvent = { app: ha.appName(), type: "started", kind: "film", title: "Test film", subtitle: null, channel: null, profile: null, kids: false, position: 0, duration: 7200, at: new Date().toISOString(), test: true };
    try {
      await ha.deliver(test);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return { ok: true };
  });
}
