// Home Assistant both ways (see shared/src/homeassistant.ts): the TV app reports what it's doing,
// Home Assistant reads it as a media player and sends commands back, and each playback event
// (a film starting, a pause, the credits) goes to a webhook so automations can dim the lights.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cleanHaCommand, cleanHaSettings, cleanTvPlayState, DEFAULT_HA_SETTINGS, haEvents, haState, type HaEvent, type HaSettings, type HaState, type TvMethod, type TvPlayState } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";

/** How many recent events Settings shows, to check the webhook is getting them. */
const RECENT = 10;

export class HomeAssistant {
  private last: TvPlayState | null = null;
  private reportedAt: number | null = null;
  private recent: (HaEvent & { sent?: boolean; error?: string })[] = [];

  constructor(
    private readonly ctx: HubContext,
    private readonly tvConnected: () => boolean,
    private readonly now: () => number = Date.now,
  ) {}

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
  report(raw: unknown): HaEvent[] | null {
    const next = cleanTvPlayState(raw);
    if (!next) return null;
    const now = this.now();
    const events = haEvents(this.last, next, this.appName(), now);
    this.last = next;
    this.reportedAt = now;
    for (const e of events) void this.send(e);
    return events;
  }

  state(hubBase?: string): HaState {
    return haState(this.last, { reportedAt: this.reportedAt, connected: this.tvConnected(), appName: this.appName(), ...(hubBase ? { hubBase } : {}) });
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

export function registerHomeAssistant(app: FastifyInstance, ha: HomeAssistant, deps: { callTv: (method: TvMethod, args: unknown) => Promise<{ result?: unknown; error?: string }>; tvConnected: () => boolean; hubBase: (req: FastifyRequest) => string }): void {
  /** The TV app's report (paired screens only). */
  app.post("/api/ha/state", async (req: Req, reply: FastifyReply) => {
    const events = ha.report(req.body);
    if (!events) return reply.code(400).send({ error: "Not a playback state" });
    return { ok: true, events: events.map((e) => e.type) };
  });
  /** Home Assistant's media player reads this (X-Api-Key). */
  app.get("/api/ha/state", async (req) => ha.state(deps.hubBase(req)));
  /** Home Assistant asks the TV to do something (X-Api-Key). */
  app.post("/api/ha/command", async (req: Req, reply: FastifyReply) => {
    const cmd = cleanHaCommand(req.body);
    if ("error" in cmd) return reply.code(400).send({ error: cmd.error });
    if (!deps.tvConnected()) return reply.code(409).send({ error: "The TV app isn't connected. Is the box on?", code: "tv-off" });
    const answer = await deps.callTv("ha", cmd);
    if (answer.error !== undefined) return reply.code(502).send({ error: answer.error });
    return { ok: true, state: ha.state(deps.hubBase(req)) };
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
