// "Ask a parent" (issue #224): a Kids or Guest profile asks for a title or channel it isn't
// allowed, and the first adult to answer decides. Allow once lasts an evening, Always allow adds
// the title to the Kids profile's existing allow list (kidsallow.ts), No tells the child "not now".
//
// The log lives in the settings database so a restart doesn't lose a pending request and the
// weekly summary can list what was asked. "Allow once" is not stored separately: an `once` answer
// that is less than KIDS_ASK_ONCE_MS old is the grant.

import { randomBytes } from "node:crypto";
import {
  KIDS_ASK_LIMIT,
  KIDS_ASK_ONCE_MS,
  KIDS_ASK_PENDING_MS,
  KIDS_ASK_WINDOW_MS,
  KIDS_VIEWING_KEEP_DAYS,
  type KidsAllowEntry,
  type KidsAllowKind,
  type KidsAsk,
  type KidsAskAnswer,
  isKidsAllowKind,
  kidsAllowName,
} from "@ultimatetv/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AlertSettings, Profile } from "@ultimatetv/shared";
import { deliver } from "./alerts.js";
import type { Db } from "./db.js";
import type { KidsAllow } from "./kidsallow.js";
import type { ProfileStore } from "./profiles.js";

const KEY = "kids-asks";
const MAX_ASKS = 300;

interface AskEvents {
  emit(event: { type: "kids.ask"; ask: KidsAsk }): void;
}

/** A refusal the route turns into an HTTP answer. */
export class AskError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    /** The request as it stands, for a 409 where somebody else answered first. */
    readonly ask?: KidsAsk,
  ) {
    super(message);
  }
}

const same = (a: { kind: string; titleId: string; name: string }, b: { kind: string; titleId: string; name: string }) => (a.kind === b.kind && a.titleId === b.titleId) || (a.kind !== "channel" && b.kind !== "channel" && kidsAllowName(a.name) === kidsAllowName(b.name));

export class KidsAsks {
  constructor(
    private readonly db: Db,
    private readonly events: AskEvents,
    private readonly allow: KidsAllow,
  ) {}

  private load(): KidsAsk[] {
    const raw = this.db.getKv<unknown>(KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter((a): a is KidsAsk => {
      const o = a as Partial<KidsAsk> | null;
      return Boolean(
        o &&
          typeof o.id === "string" &&
          typeof o.profileId === "string" &&
          typeof o.titleId === "string" &&
          typeof o.name === "string" &&
          typeof o.at === "number" &&
          isKidsAllowKind(o.kind) &&
          (o.profileKind === "kids" || o.profileKind === "guest") &&
          (o.status === "pending" || o.status === "once" || o.status === "always" || o.status === "no"),
      );
    });
  }

  private save(list: KidsAsk[], now: number): void {
    const oldest = now - KIDS_VIEWING_KEEP_DAYS * 86_400_000;
    const kept = list.filter((a) => a.at >= oldest).slice(-MAX_ASKS);
    this.db.setKv(KEY, kept.length ? kept : null);
  }

  /** A request that nobody answered in half an hour has lapsed: the child may ask again. */
  private lapsed(a: KidsAsk, now: number): boolean {
    return a.status === "pending" && now - a.at > KIDS_ASK_PENDING_MS;
  }

  get(id: string): KidsAsk | undefined {
    return this.load().find((a) => a.id === id);
  }

  /**
   * A profile asks for something. The same title asked for again while it waits (or within the
   * window after a No) hands back the first request, so tapping the button twice is harmless and
   * a child can't keep pestering by asking again. Otherwise at most KIDS_ASK_LIMIT in the window.
   */
  create(profile: Profile, title: { id: string; kind: KidsAllowKind; name: string }, now = Date.now()): { ask: KidsAsk; fresh: boolean } {
    if (profile.kind !== "kids" && profile.kind !== "guest") throw new AskError("Only a Kids or Guest profile can ask a parent", 403);
    const list = this.load();
    const mine = list.filter((a) => a.profileId === profile.id);
    const probe = { kind: title.kind, titleId: title.id, name: title.name };
    const again = [...mine].reverse().find((a) => same({ kind: a.kind, titleId: a.titleId, name: a.name }, probe) && ((a.status === "pending" && !this.lapsed(a, now)) || (a.status === "no" && now - (a.answeredAt ?? a.at) < KIDS_ASK_WINDOW_MS)));
    if (again) return { ask: again, fresh: false };
    const recent = mine.filter((a) => now - a.at < KIDS_ASK_WINDOW_MS).length;
    if (recent >= KIDS_ASK_LIMIT) throw new AskError("You've asked a few times already. Give your grown-ups a little while.", 429);
    const ask: KidsAsk = {
      id: randomBytes(6).toString("hex"),
      profileId: profile.id,
      profileName: profile.name,
      profileKind: profile.kind,
      titleId: title.id,
      kind: title.kind,
      name: title.name.replace(/\s+/g, " ").trim().slice(0, 200),
      at: now,
      status: "pending",
    };
    list.push(ask);
    this.save(list, now);
    this.events.emit({ type: "kids.ask", ask });
    return { ask, fresh: true };
  }

  /**
   * An adult's answer. The first one wins: a second gets the request back as it stands, so a
   * phone that was a moment too slow can say "Dad already said yes".
   */
  answer(id: string, answer: KidsAskAnswer, now = Date.now()): KidsAsk {
    if (answer !== "once" && answer !== "always" && answer !== "no") throw new AskError("Say Allow once, Always allow or No", 400);
    const list = this.load();
    const ask = list.find((a) => a.id === id);
    if (!ask) throw new AskError("That request has gone", 404);
    if (ask.status !== "pending") throw new AskError("Someone has already answered", 409, ask);
    if (this.lapsed(ask, now)) throw new AskError("That request has run out of time: ask the child to ask again", 410, ask);
    if (answer === "always" && ask.profileKind !== "kids") throw new AskError("Always allow is only for a Kids profile; use Allow once", 400, ask);
    ask.status = answer;
    ask.answeredAt = now;
    if (answer === "always") this.allow.add(ask.profileId, "allow", { id: ask.titleId, kind: ask.kind, name: ask.name }, now);
    this.save(list, now);
    this.events.emit({ type: "kids.ask", ask });
    return ask;
  }

  /** Waiting for an adult, newest first. */
  pending(now = Date.now()): KidsAsk[] {
    return this.load()
      .filter((a) => a.status === "pending" && !this.lapsed(a, now))
      .reverse();
  }

  /** A profile's own recent requests, so the child's screen can see "Yes" or "Not now". */
  mine(profileId: string, now = Date.now()): KidsAsk[] {
    return this.load()
      .filter((a) => a.profileId === profileId && now - a.at < KIDS_ASK_PENDING_MS * 2)
      .map((a) => (this.lapsed(a, now) ? { ...a, status: "no" as const } : a))
      .reverse();
  }

  /** What "Allow once" has let this profile have, for the content filter. */
  grants(profileId: string, now = Date.now()): KidsAllowEntry[] {
    return this.load()
      .filter((a) => a.profileId === profileId && a.status === "once" && now - (a.answeredAt ?? a.at) < KIDS_ASK_ONCE_MS)
      .map((a) => ({ id: a.titleId, kind: a.kind, name: a.name, addedAt: a.answeredAt ?? a.at }));
  }

  /** A profile's requests since `since`, newest first, for the weekly summary. */
  since(profileId: string, since: number): KidsAsk[] {
    return this.load()
      .filter((a) => a.profileId === profileId && a.at >= since)
      .map((a) => (this.lapsed(a, Date.now()) ? { ...a, status: "no" as const } : a))
      .reverse();
  }

  forget(profileId: string): void {
    const kept = this.load().filter((a) => a.profileId !== profileId);
    this.db.setKv(KEY, kept.length ? kept : null);
  }
}

// ---------------------------------------------------------------------------
// Routes

type Viewer = { profile: Profile | null; admin: boolean };

export interface KidsAskDeps {
  asks: KidsAsks;
  profiles: ProfileStore;
  viewer: (req: FastifyRequest) => Viewer;
  alertSettings: () => AlertSettings;
  appName: () => string;
  fetchImpl: typeof fetch;
  warn: (msg: string, err: unknown) => void;
}

const limited = (p: Profile | null): p is Profile => p?.kind === "kids" || p?.kind === "guest";

export function registerKidsAsks(app: FastifyInstance, deps: KidsAskDeps): void {
  const { asks, profiles, viewer } = deps;
  const fail = (err: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) => {
    if (err instanceof AskError) return reply.code(err.statusCode).send({ error: err.message, ...(err.ask ? { ask: err.ask } : {}) });
    throw err;
  };

  /**
   * A Kids or Guest profile asks for something. Adults don't need to ask, and the answer to "who
   * is asking" is the profile the request names, never one in the body.
   */
  app.post("/api/kids-asks", async (req: FastifyRequest<{ Body: { id?: unknown; kind?: unknown; name?: unknown } }>, reply) => {
    const who = viewer(req);
    if (!limited(who.profile)) return reply.code(403).send({ error: "Only a Kids or Guest profile can ask a parent" });
    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.replace(/\s+/g, " ").trim() : "";
    const kind = isKidsAllowKind(req.body?.kind) ? req.body.kind : null;
    if (!id || !name || !kind) return reply.code(400).send({ error: "Which film, show or channel, and what's it called?" });
    try {
      const { ask, fresh } = asks.create(who.profile, { id, kind, name });
      if (fresh) tell(ask);
      return { ask };
    } catch (err) {
      return fail(err, reply);
    }
  });

  /**
   * Adults and phones see what is waiting; a Kids or Guest profile sees only its own requests, to
   * find out "Yes" or "Not now". No PIN or profile detail is ever in a request.
   */
  app.get("/api/kids-asks", async (req) => {
    const who = viewer(req);
    if (limited(who.profile)) return { asks: asks.mine(who.profile.id) };
    return { asks: asks.pending() };
  });

  /** An adult says Allow once, Always allow or No. The first answer wins. */
  app.post("/api/kids-asks/:id/answer", async (req: FastifyRequest<{ Params: { id: string }; Body: { answer?: unknown; pin?: unknown } }>, reply) => {
    const who = viewer(req);
    // A child can't approve their own request, whatever PIN they might have found.
    if (limited(who.profile)) return reply.code(403).send({ error: "Ask a grown-up: this needs the PIN", code: "pin" });
    const pin = typeof req.body?.pin === "string" ? req.body.pin : undefined;
    if (!who.admin && !profiles.adultPin(pin)) return reply.code(403).send({ error: "That PIN isn't right", code: "pin" });
    try {
      return { ask: asks.answer(req.params.id, req.body?.answer as KidsAskAnswer) };
    } catch (err) {
      return fail(err, reply);
    }
  });

  /** Tells Home Assistant or ntfy too, where Settings › Alerts points, so a parent out of the room hears. */
  function tell(ask: KidsAsk): void {
    const settings = deps.alertSettings();
    if (!settings.webhookUrl && !settings.ntfyUrl) return;
    void deliver({ key: `kids-ask:${ask.id}`, level: "info", title: `${ask.profileName} is asking to watch ${ask.name}`, message: "Open the phone remote or the TV to say Allow once, Always allow or No." }, settings, deps.appName(), deps.fetchImpl).catch((err) => deps.warn("Couldn't send the Ask a parent alert", err));
  }
}
