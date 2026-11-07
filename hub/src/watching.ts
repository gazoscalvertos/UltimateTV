// What every screen in the house is playing (so another can carry on from there), and Sync play
// groups (the same thing in two rooms, kept in step). See shared/src/watching.ts for the idea.
//
// Everything here lives in memory: a Hub restart forgets who was watching what, and every player
// tells it again within a few seconds.

import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Channel, SyncAction, SyncGroup, SyncMember, WatchClient, WatchCommand, WatchReport, WatchSession } from "@ultimatetv/shared";
import { cleanWatchReport, positionAt, WATCH_KEEP_STOPPED_MS, WATCH_STALE_MS, watchFinished } from "@ultimatetv/shared";
import type { ContentFilter } from "./profiles.js";

/** The screen asking, as the server worked it out from its pairing token or its own id. */
export interface Asker {
  device: string;
  deviceName: string;
  /** Its box id when it is a paired TV. */
  box?: string;
  profile: { id: string; name: string } | null;
}

/** A member that hasn't reported for this long has gone (switched off, or the app closed). */
export const SYNC_MEMBER_GONE_MS = 60_000;
/** The longest a sync long poll is held open. */
export const SYNC_MAX_WAIT_MS = 25_000;
/** An ended group is kept this long, so its last members hear that it ended. */
const ENDED_KEEP_MS = 2 * 60_000;

export class SyncError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

interface Group extends SyncGroup {
  seen: Map<string, number>;
  endedAt?: number;
}

/** The session without its group. */
const withoutSync = ({ sync: _sync, ...s }: WatchSession): WatchSession => s;

const sameRequest = (a: WatchSession["req"], b: WatchSession["req"]) => a.kind === b.kind && a.id === b.id && (a.episodeId ?? "") === (b.episodeId ?? "");

export class Watching {
  private sessions = new Map<string, WatchSession>();
  private commands = new Map<string, WatchCommand[]>();
  private groups = new Map<string, Group>();
  private waiters = new Map<string, Set<() => void>>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * A player saying what it's doing. Answers with anything another screen asked of it, and the
   * Sync play group it is in (when it said one), so it needs no second request to keep in step.
   */
  report(who: Asker, raw: unknown, client?: WatchClient): { commands: WatchCommand[]; sync: SyncGroup | null } | null {
    const r = cleanWatchReport(raw);
    if (!r) return null;
    const now = this.now();
    const was = this.sessions.get(who.device);
    const fresh = !was || !sameRequest(was.req, r.req) || was.stopped;
    const s: WatchSession = {
      device: who.device,
      deviceName: who.deviceName || r.deviceName || "Another screen",
      client: client ?? r.client,
      ...(who.box ? { box: who.box } : {}),
      req: r.req,
      name: r.name,
      ...(r.subtitle ? { subtitle: r.subtitle } : {}),
      ...(r.artwork ? { artwork: r.artwork } : {}),
      ...(r.title ? { title: r.title } : {}),
      live: r.live,
      positionMs: r.positionMs,
      ...(r.durationMs ? { durationMs: r.durationMs } : {}),
      paused: r.paused,
      at: now,
      startedAt: fresh ? now : was!.startedAt,
      stopped: r.event === "stop",
      profile: who.profile,
    };
    // A member that moved on to something else (the next episode, another channel) or stopped has left.
    const g = r.sync ? this.groups.get(r.sync) : undefined;
    if (g && !g.ended && g.members.some((m) => m.device === who.device)) {
      if (r.event === "stop" || !sameRequest(g.req, r.req)) this.leave(g.id, who.device);
      else {
        g.seen.set(who.device, now);
        s.sync = g.id;
      }
    }
    this.sessions.set(who.device, s);
    const commands = this.commands.get(who.device) ?? [];
    this.commands.delete(who.device);
    return { commands, sync: g ? this.view(g) : null };
  }

  /** Every screen's playback, newest first, with stale ones marked stopped and old ones gone. */
  list(): WatchSession[] {
    const now = this.now();
    for (const [device, s] of this.sessions) {
      if (!s.stopped && now - s.at > WATCH_STALE_MS) {
        // Not heard from: say it stopped where it was last known to be.
        this.sessions.set(device, { ...s, stopped: true });
      }
      const cur = this.sessions.get(device)!;
      if (cur.stopped && (now - cur.at > WATCH_KEEP_STOPPED_MS || watchFinished(cur))) this.sessions.delete(device);
    }
    return [...this.sessions.values()].sort((a, b) => Number(a.stopped) - Number(b.stopped) || b.at - a.at);
  }

  /** A screen's playback as it stands now (its position moved on by the time since it reported). */
  session(device: string): WatchSession | undefined {
    this.list();
    return this.sessions.get(device);
  }

  /** Asks a screen to pause or stop; it hears on its next report (every few seconds). */
  command(device: string, cmd: WatchCommand): boolean {
    const s = this.session(device);
    if (!s || s.stopped) return false;
    const list = (this.commands.get(device) ?? []).filter((c) => c.type !== cmd.type);
    this.commands.set(device, [...list, cmd]);
    return true;
  }

  forget(device: string): void {
    this.sessions.delete(device);
    this.commands.delete(device);
  }

  // ---------------------------------------------------------------------------------------------
  // Sync play

  /**
   * The asker joins whatever `other` is playing. When `other` is already in a group the asker joins
   * that; otherwise a new group starts from where `other` has got to, and `other` is told to join.
   */
  startSync(who: Asker & { client: WatchClient }, other: string): SyncGroup {
    if (other === who.device) throw new SyncError("That's this screen", 400);
    const g = this.hostGroup(other);
    return this.join(g.id, { device: who.device, deviceName: who.deviceName, client: who.client });
  }

  /**
   * The Sync play group `other` is in, or a new one started from where it has got to (and `other`
   * told to follow it). Share Play (shareplay.ts) uses this to put a link holder alongside a TV.
   */
  hostGroup(other: string): SyncGroup {
    const s = this.session(other);
    if (!s || s.stopped) throw new SyncError("That has stopped playing. Use Resume here instead.", 409);
    const existing = s.sync ? this.groups.get(s.sync) : undefined;
    if (existing && !existing.ended) return this.view(existing);
    const now = this.now();
    const g: Group = {
      id: randomBytes(6).toString("hex"),
      req: s.req,
      name: s.name,
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      ...(s.artwork ? { artwork: s.artwork } : {}),
      ...(s.title ? { title: s.title } : {}),
      live: s.live,
      ...(s.durationMs ? { durationMs: s.durationMs } : {}),
      positionMs: Math.round(positionAt(s, now)),
      paused: s.paused,
      at: now,
      seq: 1,
      members: [{ device: s.device, deviceName: s.deviceName, client: s.client }],
      ended: false,
      seen: new Map([[s.device, now]]),
    };
    this.groups.set(g.id, g);
    this.sessions.set(s.device, { ...s, sync: g.id });
    this.command(s.device, { type: "sync", group: g.id });
    return this.view(g);
  }

  /** Adds a screen to a group (taking it out of any other group first). */
  join(id: string, member: SyncMember): SyncGroup {
    const g = this.groups.get(id);
    if (!g || g.ended) throw new SyncError("Sync play has ended", 404);
    // Out of any group it was in before: a screen follows one thing at a time.
    for (const old of this.groups.values()) if (old.id !== g.id && old.members.some((m) => m.device === member.device)) this.leave(old.id, member.device);
    if (!g.members.some((m) => m.device === member.device)) g.members.push({ ...member });
    g.seen.set(member.device, this.now());
    this.changed(g, { device: member.device, deviceName: member.deviceName, action: "join" });
    return this.view(g);
  }

  /** A member that doesn't send playback reports (a Share Play browser) saying it is still there. */
  touch(id: string, device: string): void {
    const g = this.groups.get(id);
    if (g && !g.ended && g.members.some((m) => m.device === device)) g.seen.set(device, this.now());
  }

  /** The group as members see it, with anyone who has gone quiet taken out. */
  group(id: string): SyncGroup | undefined {
    const g = this.groups.get(id);
    if (!g) return undefined;
    this.prune(g);
    return this.view(g);
  }

  /** A member paused, played or seeked: everyone follows. */
  act(id: string, who: Asker, action: SyncAction, positionMs: unknown): SyncGroup {
    const g = this.groups.get(id);
    if (!g || g.ended) throw new SyncError("Sync play has ended", 404);
    if (!g.members.some((m) => m.device === who.device)) throw new SyncError("This screen isn't in that Sync play", 403);
    const now = this.now();
    const pos = typeof positionMs === "number" && Number.isFinite(positionMs) && positionMs >= 0 ? Math.round(positionMs) : Math.round(positionAt(g, now));
    g.positionMs = g.durationMs ? Math.min(pos, g.durationMs) : pos;
    g.at = now;
    if (action === "pause") g.paused = true;
    if (action === "play") g.paused = false;
    g.seen.set(who.device, now);
    this.changed(g, { device: who.device, deviceName: who.deviceName, action });
    return this.view(g);
  }

  /** A member leaves; with one screen left there's nothing to keep in step, so the group ends. */
  leave(id: string, device: string): SyncGroup | undefined {
    const g = this.groups.get(id);
    if (!g) return undefined;
    const m = g.members.find((x) => x.device === device);
    if (!m) return this.view(g);
    g.members = g.members.filter((x) => x.device !== device);
    g.seen.delete(device);
    const s = this.sessions.get(device);
    if (s?.sync === id) this.sessions.set(device, withoutSync(s));
    if (g.members.length < 2 && !g.ended) {
      // Freeze the clock where it is, for anyone reading it one last time.
      const now = this.now();
      g.positionMs = Math.round(positionAt(g, now));
      g.at = now;
      g.ended = true;
      g.endedAt = now;
      for (const left of g.members) {
        const ls = this.sessions.get(left.device);
        if (ls?.sync === id) this.sessions.set(left.device, withoutSync(ls));
      }
    }
    this.changed(g, { device, deviceName: m.deviceName, action: "leave" });
    return this.view(g);
  }

  /** Resolves when the group has moved on from `since`, or after `ms` (at most SYNC_MAX_WAIT_MS). */
  wait(id: string, since: number, ms: number): Promise<void> {
    const g = this.groups.get(id);
    if (!g || g.seq !== since) return Promise.resolve();
    const wait = Number.isFinite(ms) ? Math.min(Math.max(Math.trunc(ms), 0), SYNC_MAX_WAIT_MS) : SYNC_MAX_WAIT_MS;
    return new Promise<void>((resolve) => {
      let set = this.waiters.get(id);
      if (!set) this.waiters.set(id, (set = new Set()));
      const waiters = set;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, wait);
      waiters.add(finish);
    });
  }

  private prune(g: Group): void {
    const now = this.now();
    if (g.ended) {
      if (g.endedAt && now - g.endedAt > ENDED_KEEP_MS) this.groups.delete(g.id);
      return;
    }
    for (const m of [...g.members]) if (now - (g.seen.get(m.device) ?? 0) > SYNC_MEMBER_GONE_MS) this.leave(g.id, m.device);
  }

  private changed(g: Group, last: SyncGroup["last"]): void {
    g.seq++;
    if (last) g.last = last;
    const set = this.waiters.get(g.id);
    if (!set) return;
    this.waiters.delete(g.id);
    for (const wake of [...set]) wake();
  }

  private view(g: Group): SyncGroup {
    const { seen: _seen, endedAt: _endedAt, ...out } = g;
    return { ...out, members: out.members.map((m) => ({ ...m })) };
  }
}

type Req<P = Record<string, string>, Q = Record<string, string>, B = unknown> = FastifyRequest<{ Params: P; Querystring: Q; Body: B }>;

/** Whether a profile may see this: Kids and Guests only see channels and titles they're allowed. */
function visibleTo(s: Pick<WatchSession, "req" | "title">, f: ContentFilter, channel: (id: string) => Channel | undefined): boolean {
  if (!f.limited) return true;
  if (s.req.kind === "channel") {
    const c = channel(s.req.id);
    return Boolean(c && f.channel(c));
  }
  return s.title ? f.ref(s.title) : false;
}

export function registerWatching(
  app: FastifyInstance,
  deps: {
    watching: Watching;
    /** Who's asking, or null when the Hub can't tell one screen from another. */
    asker: (req: FastifyRequest, deviceName?: string) => Asker | null;
    filter: (req: FastifyRequest) => ContentFilter;
    channel: (id: string) => Channel | undefined;
  },
): void {
  const { watching } = deps;
  const who = (req: FastifyRequest, reply: FastifyReply, name?: string): Asker | null => {
    const a = deps.asker(req, name);
    if (!a) void reply.code(400).send({ error: "This screen didn't say who it is" });
    return a;
  };

  /** A player's report, every few seconds while it plays and once when it stops. */
  app.post("/api/watching", async (req: Req<Record<string, string>, Record<string, string>, WatchReport>, reply) => {
    const body = (req.body ?? {}) as Partial<WatchReport>;
    const a = who(req, reply, typeof body.deviceName === "string" ? body.deviceName : undefined);
    if (!a) return reply;
    const out = watching.report(a, body);
    if (!out) return reply.code(400).send({ error: "That isn't something that can be carried on elsewhere" });
    return reply.header("Cache-Control", "no-store").send({ ok: true, now: Date.now(), me: a.device, ...out });
  });

  /** Every other screen's playback, for "Watching elsewhere" on the TV, the phone and the Android app. */
  app.get("/api/watching", async (req, reply) => {
    const a = deps.asker(req);
    const f = deps.filter(req);
    const sessions = watching
      .list()
      .filter((s) => s.device !== a?.device)
      .filter((s) => visibleTo(s, f, deps.channel))
      .map((s) => ({ ...s, positionMs: s.stopped ? s.positionMs : Math.round(positionAt(s, Date.now())), at: Date.now() }));
    return reply.header("Cache-Control", "no-store").send({ now: Date.now(), me: a?.device ?? null, sessions });
  });

  /** Pause or stop another screen ("Move here" stops it on the TV you left). */
  app.post("/api/watching/:device/command", async (req: Req<{ device: string }, Record<string, string>, { type?: string }>, reply) => {
    const type = req.body?.type;
    if (type !== "pause" && type !== "stop") return reply.code(400).send({ error: "Pause or stop" });
    const ok = watching.command(req.params.device, { type });
    if (!ok) return reply.code(404).send({ error: "That screen isn't playing anything now" });
    return { ok: true };
  });

  /** Joins what another screen is playing, in step with it. */
  app.post("/api/sync", async (req: Req<Record<string, string>, Record<string, string>, { with?: string; client?: string; deviceName?: string }>, reply) => {
    const a = who(req, reply, req.body?.deviceName);
    if (!a) return reply;
    const other = typeof req.body?.with === "string" ? req.body.with : "";
    const s = watching.session(other);
    if (s && !visibleTo(s, deps.filter(req), deps.channel)) return reply.code(403).send({ error: "That isn't available on this profile" });
    const client = (["tv", "desktop", "android", "browser"] as const).find((c) => c === req.body?.client) ?? "browser";
    try {
      return { now: Date.now(), group: watching.startSync({ ...a, client }, other) };
    } catch (err) {
      if (err instanceof SyncError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  /** The shared clock, held open until it changes (or `wait` ms pass) so members hear at once. */
  app.get("/api/sync/:id", async (req: Req<{ id: string }, { since?: string; wait?: string }>, reply) => {
    const since = Number.parseInt(String(req.query.since ?? "0"), 10) || 0;
    await watching.wait(req.params.id, since, Number.parseInt(String(req.query.wait ?? "0"), 10) || 0);
    const group = watching.group(req.params.id);
    if (!group) return reply.code(404).send({ error: "Sync play has ended" });
    return reply.header("Cache-Control", "no-store").send({ now: Date.now(), group });
  });

  app.post("/api/sync/:id/action", async (req: Req<{ id: string }, Record<string, string>, { action?: string; positionMs?: number }>, reply) => {
    const a = who(req, reply);
    if (!a) return reply;
    const action = req.body?.action;
    if (action !== "play" && action !== "pause" && action !== "seek") return reply.code(400).send({ error: "Play, pause or seek" });
    try {
      return { now: Date.now(), group: watching.act(req.params.id, a, action, req.body?.positionMs) };
    } catch (err) {
      if (err instanceof SyncError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/sync/:id/leave", async (req: Req<{ id: string }>, reply) => {
    const a = who(req, reply);
    if (!a) return reply;
    const group = watching.leave(req.params.id, a.device);
    return { now: Date.now(), group: group ?? null };
  });
}

