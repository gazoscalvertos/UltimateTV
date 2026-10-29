// Alerts: things worth knowing before they bite. The IPTV or TorBox subscription running out (the
// Hub already reads both dates and showed neither), a recording that failed, the NAS filling up.
// They're listed on the TV (Settings › Alerts) and the phone, and each new one, or one that gets
// worse, pops up once on the TV through the same notices as /api/notify.

import { statfs } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AlertLevel, HubAlert, Recording, Settings, TvNotice } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";
import type { Logger } from "./log.js";
import type { NoticeInput } from "./notify.js";

const DAY = 86_400_000;
/** Failed recordings are mentioned for this long after they were on. */
const FAILED_FOR = 3 * DAY;
/** TorBox is asked at most this often. */
const TORBOX_EVERY = 6 * 3600_000;
const CHECK_EVERY = 30 * 60_000;

export interface Disk {
  label: string;
  freeBytes: number;
  totalBytes: number;
}

export interface AlertInput {
  now: number;
  expiryDays: number;
  /** Each IPTV source with the expiry date its provider gave (Xtream's exp_date). */
  iptv: { id: string; name: string; expires?: number }[];
  torboxExpires?: number;
  recordings: Recording[];
  disks: Disk[];
}

const GB = 1024 ** 3;
const rank = (l: AlertLevel) => (l === "bad" ? 2 : 1);

/** "today", "tomorrow", "in 5 days", or the date it ended. */
function whenEnds(expires: number, now: number): string {
  const days = Math.ceil((expires - now) / DAY);
  if (expires <= now) return `ended on ${new Date(expires).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
  if (days <= 1) return expires - now < 12 * 3600_000 ? "ends today" : "ends tomorrow";
  return `ends in ${days} days`;
}

function expiry(id: string, kind: HubAlert["kind"], name: string, expires: number | undefined, input: AlertInput, then: string): HubAlert | null {
  if (!expires || !Number.isFinite(expires)) return null;
  const left = expires - input.now;
  if (left > input.expiryDays * DAY) return null;
  const date = new Date(expires).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return {
    id,
    kind,
    level: left <= 3 * DAY ? "bad" : "warn",
    title: `${name} ${whenEnds(expires, input.now)}`,
    text: left <= 0 ? `It ran out on ${date}. ${then}` : `It runs out on ${date}. ${then}`,
    at: input.now,
    expiresAt: expires,
  };
}

/** Works out the alerts from what the Hub knows; no I/O, so the rules can be tested. */
export function findAlerts(input: AlertInput): HubAlert[] {
  const out: HubAlert[] = [];
  for (const src of input.iptv) {
    const a = expiry(`iptv-expiry-${src.id}`, "iptv-expiry", src.name, src.expires, input, "Renew it with the provider to keep live TV, catch-up and recordings working.");
    if (a) out.push(a);
  }
  const tb = expiry("torbox-expiry", "torbox-expiry", "TorBox", input.torboxExpires, input, "Renew it at torbox.app to keep playing films and series through it.");
  if (tb) out.push(tb);

  for (const r of input.recordings) {
    if (r.status !== "failed" || r.programme.end < input.now - FAILED_FOR) continue;
    const when = new Date(r.programme.start).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    out.push({
      id: `recording-failed-${r.id}`.replace(/[^\w.-]/g, "-").slice(0, 60),
      kind: "recording-failed",
      level: "warn",
      title: `${r.programme.title} didn't record`,
      text: `${r.channelName}, ${when}. ${r.error ?? "Nothing was recorded."}`,
      at: r.end,
    });
  }

  // The same NAS share often holds several folders: one alert per disk.
  const seen = new Set<string>();
  for (const d of input.disks) {
    const key = `${d.totalBytes}/${d.freeBytes}`;
    if (seen.has(key) || d.totalBytes <= 0) continue;
    seen.add(key);
    const share = d.freeBytes / d.totalBytes;
    const bad = share < 0.03 || d.freeBytes < 5 * GB;
    if (!bad && share >= 0.1 && d.freeBytes >= 20 * GB) continue;
    out.push({
      id: `disk-full-${d.label.toLowerCase().replace(/[^\w]+/g, "-")}`,
      kind: "disk-full",
      level: bad ? "bad" : "warn",
      title: bad ? "The NAS is almost full" : "The NAS is getting full",
      text: `${(d.freeBytes / GB).toFixed(d.freeBytes < 10 * GB ? 1 : 0)} GB free of ${Math.round(d.totalBytes / GB)} GB (${d.label}). Recordings and downloads stop when it's full: delete some, or turn on Delete watched recordings in Settings › Recording.`,
      at: input.now,
    });
  }
  return out;
}

/** What was dismissed or popped up: the level, and the expiry date (a renewal that runs out again is new). */
type Seen = Record<string, { level: AlertLevel; expiresAt?: number }>;
const covers = (seen: Seen[string] | undefined, a: HubAlert) => Boolean(seen && seen.expiresAt === a.expiresAt && rank(a.level) <= rank(seen.level));
const mark = (a: HubAlert): Seen[string] => ({ level: a.level, ...(a.expiresAt !== undefined ? { expiresAt: a.expiresAt } : {}) });

export interface AlertDeps {
  db: Db;
  events: EventBus;
  log: Logger;
  settings: () => Settings;
  expiresOf: (sourceId: string) => number | undefined;
  torboxExpires: () => Promise<string | undefined>;
  recordings: () => Recording[];
  /** Puts an alert up on the TV; tests pass a fake. */
  notify: (n: NoticeInput) => TvNotice | null;
  /** Whether a TV app is listening, so pop-ups wait for one rather than go unseen. */
  tvConnected: () => boolean;
  disks?: (s: Settings) => Promise<Disk[]>;
  now?: () => number;
  /** Demo mode's made-up subscriptions and disk, so the screenshots have something to show. */
  demo?: (now: number) => Pick<AlertInput, "iptv" | "torboxExpires" | "disks">;
}

async function nasDisks(s: Settings): Promise<Disk[]> {
  const folders: [string, string][] = [
    ["Recordings", s.library.recordingsPath],
    ["Films", s.library.moviesPath],
    ["TV", s.library.tvPath],
  ];
  const out: Disk[] = [];
  for (const [label, dir] of folders) {
    const fs = await statfs(dir).catch(() => statfs(path.dirname(dir)).catch(() => null));
    if (fs) out.push({ label, freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize });
  }
  return out;
}

export class Alerts {
  private list: HubAlert[] = [];
  private firstSeen = new Map<string, number>();
  private torbox: { at: number; expires?: number } | null = null;
  private timers: NodeJS.Timeout[] = [];
  private offEvents: (() => void) | undefined;
  private running: Promise<HubAlert[]> | null = null;
  private readonly now: () => number;

  constructor(private readonly d: AlertDeps) {
    this.now = d.now ?? Date.now;
  }

  start(): void {
    const run = () => void this.check().catch((err) => this.d.log.warn({ err: String(err) }, "Alert check failed"));
    this.timers = [setTimeout(run, 60_000), setInterval(run, CHECK_EVERY)];
    for (const t of this.timers) t.unref();
    this.offEvents = this.d.events.on((e) => {
      if (e.type === "recording.finished" && e.recording.status === "failed") run();
      if (e.type === "guide.updated") run();
    });
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.offEvents?.();
  }

  /** The alerts nobody has dismissed. */
  visible(): HubAlert[] {
    const dismissed = this.d.db.getKv<Seen>("alerts-dismissed") ?? {};
    return this.list.filter((a) => !covers(dismissed[a.id], a));
  }

  dismiss(id: string): boolean {
    const a = this.list.find((x) => x.id === id);
    if (!a) return false;
    const dismissed = this.d.db.getKv<Seen>("alerts-dismissed") ?? {};
    dismissed[id] = mark(a);
    this.d.db.setKv("alerts-dismissed", dismissed);
    this.d.events.emit({ type: "alerts.changed" });
    return true;
  }

  /** Looks again now; pop-ups go to the TV for anything new or worse. */
  check(): Promise<HubAlert[]> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async torboxExpiry(): Promise<number | undefined> {
    if (!this.d.settings().torboxApiKey) return undefined;
    if (this.torbox && this.now() - this.torbox.at < TORBOX_EVERY) return this.torbox.expires;
    const iso = await this.d.torboxExpires().catch((err) => {
      this.d.log.warn({ err: String(err) }, "Couldn't ask TorBox when the plan ends");
      return undefined;
    });
    const t = iso ? Date.parse(iso) : NaN;
    this.torbox = { at: this.now(), ...(Number.isFinite(t) ? { expires: t } : {}) };
    return this.torbox.expires;
  }

  private async run(): Promise<HubAlert[]> {
    const s = this.d.settings();
    const now = this.now();
    const torboxExpires = await this.torboxExpiry();
    const found = findAlerts({
      now,
      expiryDays: s.alerts.expiryDays,
      iptv: s.iptv.map((src) => {
        const expires = this.d.expiresOf(src.id);
        return { id: src.id, name: src.name, ...(expires ? { expires } : {}) };
      }),
      ...(torboxExpires !== undefined ? { torboxExpires } : {}),
      recordings: this.d.recordings(),
      disks: await (this.d.disks ?? nasDisks)(s),
      ...this.d.demo?.(now),
    });
    for (const a of found) {
      if (!this.firstSeen.has(a.id) && a.kind !== "recording-failed") this.firstSeen.set(a.id, now);
      if (a.kind !== "recording-failed") a.at = this.firstSeen.get(a.id)!;
    }
    for (const id of this.firstSeen.keys()) if (!found.some((a) => a.id === id)) this.firstSeen.delete(id);
    const before = JSON.stringify(this.list.map(mark));
    this.list = found;
    if (JSON.stringify(found.map(mark)) !== before) this.d.events.emit({ type: "alerts.changed" });
    if (s.alerts.onTv && this.d.tvConnected()) this.popUp();
    return found;
  }

  /** One pop-up per alert and level: a second only when it gets worse (or a renewed subscription runs out again). */
  private popUp(): void {
    const shown = this.d.db.getKv<Seen>("alerts-shown") ?? {};
    const dismissed = this.d.db.getKv<Seen>("alerts-dismissed") ?? {};
    let changed = false;
    for (const a of this.list) {
      if (covers(shown[a.id], a) || covers(dismissed[a.id], a)) continue;
      // Bad ones stay until OK or Back, so they aren't missed; the rest go after two minutes.
      this.d.notify({ id: `alert-${a.id}`.slice(0, 60), kind: "warning", title: a.title, text: a.text, position: "top", size: "medium", sound: a.level === "bad" ? "chime" : "ping", seconds: a.level === "bad" ? 0 : 120 });
      shown[a.id] = mark(a);
      changed = true;
    }
    // Forget ones that went away, so the same problem coming back pops up again.
    for (const id of Object.keys(shown)) {
      if (!this.list.some((a) => a.id === id)) {
        delete shown[id];
        changed = true;
      }
    }
    if (changed) this.d.db.setKv("alerts-shown", shown);
  }
}

export function registerAlerts(app: FastifyInstance, alerts: Alerts): void {
  app.get("/api/alerts", async () => ({ alerts: alerts.visible() }));
  app.post("/api/alerts/check", async () => {
    await alerts.check();
    return { alerts: alerts.visible() };
  });
  app.post("/api/alerts/:id/dismiss", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!alerts.dismiss(req.params.id)) return reply.code(404).send({ error: "That alert has gone" });
    return { alerts: alerts.visible() };
  });
}
