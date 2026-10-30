// Warnings before things break, so nobody finds out from a blank screen: the IPTV subscription
// or TorBox running out, the guide not refreshing, a channel load failing, a recording failing,
// the NAS filling up, live TV not starting, the nightly backup failing. The Hub checks every half hour and sends each new
// problem once to a Home Assistant webhook and/or an ntfy topic (both reach a phone), lists them
// in Settings › Alerts, and (when asked) pops them up on the TV for adult profiles.

import { statfs } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { cleanAlertSettings, daysFromNow, DEFAULT_ALERT_SETTINGS, type Alert, type AlertLevel, type AlertSettings, type AlertState } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";

const CHECK_MS = 30 * 60_000;
/** Problems that come from a single event (a failed recording) stay listed this long. */
const EVENT_ALERT_MS = 24 * 3600_000;
const PLAYBACK_ALERT_MS = 2 * 3600_000;
/** The guide is stale once it's this old. */
const EPG_STALE_MS = 26 * 3600_000;
const TORBOX_CHECK_MS = 12 * 3600_000;
const RANK: Record<AlertLevel, number> = { info: 0, warn: 1, bad: 2 };

export interface AlertInputs {
  now: number;
  settings: AlertSettings;
  iptv: { id: string; name: string; expires?: number; ok?: boolean; error?: string }[];
  torboxExpires?: number;
  epgUpdatedAt?: number;
  /** Free space where recordings go, when the NAS could be read. */
  diskFreeBytes?: number;
  /** The nightly backup (backup.ts): when the last good one was, and why the latest failed. */
  backup?: { enabled: boolean; lastOkAt?: number; error?: string; since: number };
  /** Problems reported by events, still in force. */
  events: Alert[];
}

/** Two missed nights before a quiet backup is worth a word. */
const BACKUP_STALE_MS = 50 * 3600_000;

/** What's wrong right now, worst first. Pure, for the tests. */
export function currentAlerts(input: AlertInputs): Omit<Alert, "since">[] {
  const out: Omit<Alert, "since">[] = [];
  const { now, settings } = input;
  const expiry = (key: string, what: string, at: number) => {
    const left = at - now;
    if (left > settings.expiryDays * 86_400_000) return;
    const when = new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    out.push({
      key,
      level: left < 3 * 86_400_000 ? "bad" : "warn",
      title: left <= 0 ? `${what} has run out` : `${what} runs out ${daysFromNow(at, now)}`,
      message: left <= 0 ? `It ended on ${when}. Renew it to get it back.` : `It ends on ${when}. Renew it before then so nothing stops working.`,
    });
  };
  for (const s of input.iptv) {
    if (s.expires) expiry(`iptv-expiry:${s.id}`, `The ${s.name} IPTV subscription`, s.expires);
    if (s.ok === false) out.push({ key: `iptv-load:${s.id}`, level: "bad", title: `${s.name} isn't loading`, message: s.error ?? "The last channel load failed, so live TV may not work." });
  }
  if (input.torboxExpires) expiry("torbox-expiry", "TorBox", input.torboxExpires);
  if (input.iptv.length && input.epgUpdatedAt && now - input.epgUpdatedAt > EPG_STALE_MS) {
    const hours = Math.round((now - input.epgUpdatedAt) / 3600_000);
    out.push({ key: "epg-stale", level: "warn", title: "The TV guide hasn't updated", message: `It last updated ${hours} hours ago, so the guide will run out and recordings may be missed.` });
  }
  if (input.diskFreeBytes !== undefined && input.diskFreeBytes < settings.diskFreeGb * 1024 ** 3) {
    const gb = Math.round(input.diskFreeBytes / 1024 ** 3);
    out.push({ key: "disk-full", level: gb < 10 ? "bad" : "warn", title: "The NAS is nearly full", message: `${gb} GB left where recordings go. Recordings stop when it fills up.` });
  }
  const b = input.backup;
  if (b?.enabled) {
    if (b.error) out.push({ key: "backup-failed", level: "warn", title: "The Hub's backup failed", message: `${b.error}. The Hub tries again tonight; Settings › About shows how it went.` });
    else if (now - (b.lastOkAt ?? b.since) > BACKUP_STALE_MS && b.since) {
      const days = Math.floor((now - (b.lastOkAt ?? b.since)) / 86_400_000);
      out.push({ key: "backup-stale", level: "warn", title: "The Hub hasn't backed up", message: b.lastOkAt ? `The last backup was ${days} days ago.` : `There's been no backup in ${days} days of running.` });
    }
  }
  out.push(...input.events.map((e) => ({ key: e.key, level: e.level, title: e.title, message: e.message })));
  return out.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

/** Sends one alert to the webhook and/or ntfy. Rejects with the first failure. */
export async function deliver(alert: Pick<Alert, "key" | "level" | "title" | "message">, settings: AlertSettings, appName: string, fetchImpl: typeof fetch): Promise<void> {
  const jobs: Promise<void>[] = [];
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what} answered ${res.status}`);
  };
  if (settings.webhookUrl) {
    jobs.push(
      fetchImpl(settings.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: appName, key: alert.key, level: alert.level, title: alert.title, message: alert.message }),
        signal: AbortSignal.timeout(10_000),
      }).then((r) => check(r, "The webhook")),
    );
  }
  if (settings.ntfyUrl) {
    jobs.push(
      fetchImpl(settings.ntfyUrl, {
        method: "POST",
        // Header values must be plain ASCII.
        headers: { Title: `${appName}: ${alert.title}`.replace(/[^\x20-\x7e]/g, "'"), Priority: alert.level === "bad" ? "high" : alert.level === "warn" ? "default" : "low", Tags: alert.level === "bad" ? "rotating_light,tv" : "warning,tv" },
        body: alert.message,
        signal: AbortSignal.timeout(10_000),
      }).then((r) => check(r, "ntfy")),
    );
  }
  await Promise.all(jobs);
}

export class Alerts {
  private timer: NodeJS.Timeout | undefined;
  private first: NodeJS.Timeout | undefined;
  private checkedAt: number | undefined;
  private torbox: { at: number; expires?: number } | null = null;
  /** The nightly backup's health, set by the server once backups exist. */
  backups?: () => NonNullable<AlertInputs["backup"]>;

  constructor(private readonly ctx: HubContext) {}

  settings(): AlertSettings {
    return cleanAlertSettings(this.ctx.db.getKv<Partial<AlertSettings>>("alerts-settings") ?? {}, DEFAULT_ALERT_SETTINGS);
  }

  saveSettings(patch: Partial<AlertSettings>): AlertSettings {
    const s = cleanAlertSettings(patch, this.settings());
    this.ctx.db.setKv("alerts-settings", s);
    return s;
  }

  list(): Alert[] {
    return this.ctx.db.getKv<Alert[]>("alerts") ?? [];
  }

  private events(now: number): (Alert & { until: number })[] {
    return (this.ctx.db.getKv<(Alert & { until: number })[]>("alerts-events") ?? []).filter((a) => a.until > now);
  }

  /** A problem from a single event; it stays listed for a while and clears by itself. */
  async raise(alert: Omit<Alert, "since">, forMs = EVENT_ALERT_MS, now = Date.now()): Promise<void> {
    const list = this.events(now).filter((a) => a.key !== alert.key);
    list.push({ ...alert, since: now, until: now + forMs });
    this.ctx.db.setKv("alerts-events", list);
    await this.check(now);
  }

  async state(): Promise<AlertState> {
    const s = this.settings();
    return {
      settings: s,
      alerts: this.list(),
      configured: Boolean(s.webhookUrl || s.ntfyUrl),
      ...(this.checkedAt ? { checkedAt: this.checkedAt } : {}),
      expiries: await this.expiries(),
    };
  }

  private async expiries(): Promise<{ name: string; at: number }[]> {
    const out: { name: string; at: number }[] = [];
    for (const src of this.ctx.settings.get().iptv) {
      const at = this.ctx.ingest.sourceMeta(src.id)?.expires;
      if (at) out.push({ name: src.name, at });
    }
    const tb = await this.torboxExpires(Date.now());
    if (tb) out.push({ name: "TorBox", at: tb });
    return out;
  }

  private async torboxExpires(now: number): Promise<number | undefined> {
    const client = this.ctx.torbox();
    if (!client) return undefined;
    if (this.torbox && now - this.torbox.at < TORBOX_CHECK_MS) return this.torbox.expires;
    const user = await client.user().catch(() => null);
    const at = user?.premium_expires_at ? Date.parse(user.premium_expires_at) : NaN;
    this.torbox = { at: now, ...(Number.isFinite(at) ? { expires: at } : {}) };
    return this.torbox.expires;
  }

  /** Works out what's wrong now, keeps the list and sends anything new (or worse than before). */
  async check(now = Date.now()): Promise<Alert[]> {
    const s = this.ctx.settings.get();
    const settings = this.settings();
    let diskFreeBytes: number | undefined;
    try {
      const fs = await statfs(s.library.recordingsPath);
      diskFreeBytes = fs.bavail * fs.bsize;
    } catch {
      // The NAS isn't mounted (development) or is away: nothing to say about space.
    }
    const torboxExpires = await this.torboxExpires(now);
    const epg = this.ctx.db.getKv<number>("epgUpdatedAt");
    const inputs: AlertInputs = {
      now,
      settings,
      iptv: s.iptv.map((src) => {
        const meta = this.ctx.ingest.sourceMeta(src.id);
        const status = this.ctx.ingest.sourceStatus(src.id);
        return { id: src.id, name: src.name, ...(meta?.expires ? { expires: meta.expires } : {}), ...(status ? { ok: status.ok, ...(status.error ? { error: status.error } : {}) } : {}) };
      }),
      ...(torboxExpires ? { torboxExpires } : {}),
      ...(epg ? { epgUpdatedAt: epg } : {}),
      ...(diskFreeBytes !== undefined ? { diskFreeBytes } : {}),
      ...(this.backups ? { backup: this.backups() } : {}),
      events: this.events(now),
    };
    const before = new Map(this.list().map((a) => [a.key, a]));
    const next: Alert[] = currentAlerts(inputs).map((a) => {
      const old = before.get(a.key);
      return { ...a, since: old?.since ?? now, ...(old?.sentAt && RANK[old.level] >= RANK[a.level] ? { sentAt: old.sentAt } : {}) };
    });
    this.checkedAt = now;
    const appName = s.appName || "UltimateTV";
    const configured = Boolean(settings.webhookUrl || settings.ntfyUrl);
    for (const a of next) {
      const isNew = !before.has(a.key) || RANK[before.get(a.key)!.level] < RANK[a.level];
      if (isNew) this.ctx.events.emit({ type: "alerts.changed", alert: a });
      if (a.sentAt || a.level === "info" || !configured) continue;
      try {
        await deliver(a, settings, appName, this.ctx.fetchImpl);
        a.sentAt = now;
      } catch (err) {
        this.ctx.log.warn({ err: String(err), alert: a.key }, "Couldn't send an alert");
      }
    }
    if (next.length !== before.size || next.some((a) => !before.has(a.key))) this.ctx.events.emit({ type: "alerts.changed" });
    this.ctx.db.setKv("alerts", next);
    return next;
  }

  start(): void {
    this.first = setTimeout(() => void this.check().catch((err) => this.ctx.log.warn({ err: String(err) }, "Alert check failed")), 60_000);
    this.timer = setInterval(() => void this.check().catch((err) => this.ctx.log.warn({ err: String(err) }, "Alert check failed")), CHECK_MS);
    // A failed recording is worth knowing about straight away.
    this.ctx.events.on((e) => {
      if (e.type === "recording.finished" && e.recording.status === "failed") {
        const r = e.recording;
        void this.raise({ key: `recording-failed:${r.id}`, level: "warn", title: `${r.programme.title} didn't record`, message: `On ${r.channelName}: ${r.error ?? "nothing was recorded"}.` });
      }
    });
  }

  stop(): void {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }
}

export function registerAlerts(app: FastifyInstance, ctx: HubContext, alerts: Alerts): void {
  type Req<B> = FastifyRequest<{ Body: B }>;
  app.get("/api/alerts", async () => alerts.state());
  app.put("/api/alerts/settings", async (req: Req<Partial<AlertSettings>>) => {
    alerts.saveSettings(req.body ?? {});
    return alerts.state();
  });
  app.post("/api/alerts/check", async () => {
    await alerts.check();
    return alerts.state();
  });
  /** Sends a test message to wherever alerts go. */
  app.post("/api/alerts/test", async (_req, reply) => {
    const s = alerts.settings();
    if (!s.webhookUrl && !s.ntfyUrl) return reply.code(400).send({ error: "Set a Home Assistant webhook or an ntfy address first" });
    try {
      await deliver({ key: "test", level: "warn", title: "Test alert", message: "Alerts from the TV reach you here." }, s, ctx.settings.get().appName || "UltimateTV", ctx.fetchImpl);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return { ok: true };
  });
  /** The TV couldn't play live TV: tell whoever looks after it (once per channel every couple of hours). */
  app.post("/api/alerts/playback", async (req: Req<{ what?: string; error?: string }>) => {
    const what = String(req.body?.what ?? "live TV").replace(/\s+/g, " ").slice(0, 80) || "live TV";
    const error = String(req.body?.error ?? "").replace(/\s+/g, " ").slice(0, 200);
    await alerts.raise({ key: `playback:${what.toLowerCase()}`, level: "warn", title: `${what} didn't play on the TV`, message: error || "The stream didn't start." }, PLAYBACK_ALERT_MS);
    const s = alerts.settings();
    return { told: Boolean(s.webhookUrl || s.ntfyUrl) };
  });
}
