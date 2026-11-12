// Requesting a film or series that isn't in the library (issue #225). See docs/requests.md.
//
// A Request goes to Jellyseerr/Overseerr, or straight to Radarr (films) and Sonarr (series). The
// Hub keeps a list of what each profile asked for, looks at how each is getting on every few
// minutes and pops up "X is ready" on the TV and the phone when it arrives. A Kids or Guest
// profile can only ask: the request waits for a grown-up (the TV, or the phone remote) to say yes,
// and nothing leaves the Hub until then.

import { randomBytes } from "node:crypto";
import {
  REQUEST_AWAITING_LIMIT,
  REQUEST_KEEP_DAYS,
  REQUEST_STATUS_LABEL,
  requestActive,
  tmdbOfTitleId,
  type Profile,
  type RequestSettings,
  type RequestsView,
  type RequestTestResult,
  type TitleDetails,
  type TitleRef,
  type TitleRequest,
  type TitleRequestState,
} from "@ultimatetv/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";
import type { ProfileStore } from "./profiles.js";
import { backendsFrom, explain, testRequestApp, type Backends } from "./services/requests.js";
import type { Fetch } from "./http.js";

const KEY = "title-requests";
const MAX_KEPT = 300;
const DAY = 86_400_000;
/** A program may take a moment to know a request it was just given. */
const SETTLE_MS = 10 * 60_000;

interface Stored extends TitleRequest {
  /** What the program calls it, to ask how it is getting on. */
  ref?: string;
}

/** A refusal the route turns into an HTTP answer. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface RequestsDeps {
  db: Db;
  events: EventBus;
  settings: () => RequestSettings | undefined;
  /** TheTVDB id of a TMDB series, for Sonarr. */
  tvdbOf: (tmdbId: number) => Promise<number | undefined>;
  fetchImpl: Fetch;
  /** Also tells Home Assistant or ntfy (Settings › Alerts), so someone out of the room hears. */
  tell?: (title: string, message: string, key: string) => void;
  log?: { warn(obj: object, msg: string): void };
}

const stripRef = ({ ref: _ref, ...r }: Stored): TitleRequest => r;
const kindOf = (p: Profile | null): TitleRequest["profileKind"] => (p ? p.kind : "phone");

export class TitleRequests {
  constructor(private readonly deps: RequestsDeps) {}

  private backends(): Backends {
    return backendsFrom(this.deps.settings(), this.deps.tvdbOf, this.deps.fetchImpl);
  }

  /** Whether Request is on at all, and for films, series or both. */
  enabled(kind?: "movie" | "series"): boolean {
    const b = this.backends();
    return kind ? Boolean(b[kind]) : Boolean(b.movie || b.series);
  }

  private load(): Stored[] {
    const raw = this.deps.db.getKv<unknown>(KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is Stored => {
      const o = r as Partial<Stored> | null;
      return Boolean(o && typeof o.id === "string" && typeof o.titleId === "string" && typeof o.name === "string" && typeof o.at === "number" && typeof o.status === "string");
    });
  }

  private save(list: Stored[], now: number): void {
    const oldest = now - REQUEST_KEEP_DAYS * DAY;
    const kept = list.filter((r) => requestActive(r.status) || r.updatedAt >= oldest).slice(-MAX_KEPT);
    this.deps.db.setKv(KEY, kept.length ? kept : null);
    this.deps.events.emit({ type: "requests.changed" });
  }

  get(id: string): TitleRequest | undefined {
    const r = this.load().find((x) => x.id === id);
    return r && stripRef(r);
  }

  /** The latest request for a title, whoever asked. */
  latestFor(titleId: string): TitleRequest | undefined {
    const r = [...this.load()].reverse().find((x) => x.titleId === titleId);
    return r && stripRef(r);
  }

  /** What the details page shows: whether to offer Request, and where an earlier one got to. */
  stateFor(d: Pick<TitleDetails, "id" | "kind" | "inLibrary" | "availability" | "tmdbId">): TitleRequestState | undefined {
    if (d.kind !== "movie" && d.kind !== "series") return undefined;
    if (!this.enabled(d.kind)) return undefined;
    const last = this.latestFor(d.id);
    // Already somewhere to play it from: nothing to ask for. A pending request is still shown.
    const there = d.inLibrary || d.availability.includes("xtream");
    const requestable = !there && Boolean(tmdbOfTitleId(d.id) || d.tmdbId) && !(last && requestActive(last.status));
    if (there && !(last && requestActive(last.status))) return { requestable: false };
    return { requestable, ...(last ? { request: { id: last.id, status: last.status, profileName: last.profileName, at: last.at } } : {}) };
  }

  /** A profile asks. An adult's goes straight to the program; a Kids or Guest request waits for a grown-up. */
  async create(profile: Profile | null, title: Pick<TitleRef, "id" | "kind" | "name" | "year" | "poster">, now = Date.now()): Promise<{ request: TitleRequest; fresh: boolean }> {
    const ids = tmdbOfTitleId(title.id);
    if (!ids) throw new RequestError("That title can't be requested (it has no TMDB listing)", 400);
    if (!this.enabled(ids.kind)) throw new RequestError(ids.kind === "movie" ? "Requesting films isn't set up yet" : "Requesting series isn't set up yet", 409);
    const list = this.load();
    const active = list.find((r) => r.titleId === title.id && requestActive(r.status));
    if (active) return { request: stripRef(active), fresh: false };
    const limited = profile?.kind === "kids" || profile?.kind === "guest";
    if (limited && list.filter((r) => r.profileId === profile!.id && r.status === "awaiting").length >= REQUEST_AWAITING_LIMIT) throw new RequestError("You've asked for a few things already. Give your grown-ups a little while.", 429);
    const r: Stored = {
      id: randomBytes(6).toString("hex"),
      titleId: title.id,
      kind: ids.kind,
      name: title.name.replace(/\s+/g, " ").trim().slice(0, 200),
      ...(title.year ? { year: title.year } : {}),
      ...(title.poster ? { poster: title.poster } : {}),
      profileId: profile?.id ?? null,
      profileName: profile?.name ?? "The phone",
      profileKind: kindOf(profile),
      at: now,
      updatedAt: now,
      status: "awaiting",
    };
    if (limited) {
      list.push(r);
      this.save(list, now);
      const message = `${r.profileName} would like ${r.name}. Home › Your requests, or the phone remote, has Approve and Not now.`;
      this.deps.events.emit({ type: "request.awaiting", request: stripRef(r), message });
      this.deps.tell?.(`${r.profileName} is asking for ${r.name}`, "Open the phone remote or the TV to approve or decline the request.", `request-awaiting:${r.id}`);
      return { request: stripRef(r), fresh: true };
    }
    await this.send(r);
    list.push(r);
    this.save(list, now);
    return { request: stripRef(r), fresh: true };
  }

  /** Hands a request to its program; the request becomes "requested". Throws, leaving it as it was, if the program says no. */
  private async send(r: Stored): Promise<void> {
    const ids = tmdbOfTitleId(r.titleId)!;
    const backend = this.backends()[ids.kind];
    if (!backend) throw new RequestError("Requests aren't set up for that any more", 409);
    try {
      r.ref = await backend.submit(ids.kind, ids.tmdbId, r.name);
    } catch (err) {
      this.deps.log?.warn({ err: String(err) }, `Couldn't send "${r.name}" to ${backend.name}`);
      throw new RequestError(`${backend.name}: ${explain(err)}`, 502);
    }
    r.status = "requested";
    r.updatedAt = Date.now();
  }

  /** An adult says yes (it goes to the program now) or no. The first answer wins. */
  async answer(id: string, answer: "approve" | "decline", now = Date.now()): Promise<TitleRequest> {
    if (answer !== "approve" && answer !== "decline") throw new RequestError("Say approve or decline", 400);
    const list = this.load();
    const r = list.find((x) => x.id === id);
    if (!r) throw new RequestError("That request has gone", 404);
    if (r.status !== "awaiting") throw new RequestError("Someone has already answered", 409);
    if (answer === "decline") {
      r.status = "declined";
      r.note = "Not this time";
      r.updatedAt = now;
    } else {
      await this.send(r);
      r.updatedAt = now;
    }
    this.save(list, now);
    return stripRef(r);
  }

  /** What a profile sees: its own requests. An adult sees everyone's, and the ones waiting for an answer. */
  view(profile: Profile | null, now = Date.now()): RequestsView {
    const b = this.backends();
    const limited = profile?.kind === "kids" || profile?.kind === "guest";
    const all = [...this.load()].reverse().map(stripRef);
    const mine = limited ? all.filter((r) => r.profileId === profile!.id) : all;
    const recent = (r: TitleRequest) => requestActive(r.status) || now - r.updatedAt < REQUEST_KEEP_DAYS * DAY;
    return { configured: Boolean(b.via), ...(b.via ? { via: b.via } : {}), requests: mine.filter(recent), awaiting: limited ? [] : all.filter((r) => r.status === "awaiting") };
  }

  /** The row on Home: this profile's requests that are on their way or have just arrived. */
  homeItems(profile: Profile | null, now = Date.now()): TitleRef[] {
    const limited = profile?.kind === "kids" || profile?.kind === "guest";
    return [...this.load()]
      .reverse()
      .filter((r) => (limited || profile ? r.profileId === (profile?.id ?? null) : true))
      .filter((r) => r.status !== "declined" && r.status !== "failed" && (requestActive(r.status) || now - r.updatedAt < 14 * DAY))
      .map((r) => ({ id: r.titleId, kind: r.kind, name: r.name, ...(r.year ? { year: r.year } : {}), ...(r.poster ? { poster: r.poster } : {}), badges: [REQUEST_STATUS_LABEL[r.status]] }));
  }

  /** The label a search result or a card carries for this title, when it was asked for. */
  badgeFor(titleId: string): string | undefined {
    const last = this.latestFor(titleId);
    return last && last.status !== "declined" && last.status !== "failed" ? REQUEST_STATUS_LABEL[last.status] : undefined;
  }

  /**
   * Asks each program how the requests in progress are getting on; a request that arrived is
   * announced once. Returns how many arrived this time.
   */
  async refresh(now = Date.now()): Promise<number> {
    const list = this.load();
    const waiting = list.filter((r) => (r.status === "requested" || r.status === "downloading") && r.ref);
    if (!waiting.length) return 0;
    const b = this.backends();
    let arrived = 0;
    let changed = false;
    for (const r of waiting) {
      const backend = b[r.kind as "movie" | "series"];
      if (!backend) continue;
      let now_: Awaited<ReturnType<typeof backend.status>>;
      try {
        now_ = await backend.status(r.kind as "movie" | "series", r.ref!);
      } catch (err) {
        this.deps.log?.warn({ err: String(err) }, `Couldn't check "${r.name}" with ${backend.name}`);
        continue;
      }
      if (now_ === "gone") {
        if (now - r.updatedAt < SETTLE_MS) continue;
        r.status = "failed";
        r.note = `${backend.name} no longer has it`;
      } else if (now_ === "declined") {
        r.status = "declined";
        r.note = `${backend.name}: not approved`;
      } else if (now_ === r.status) continue;
      else r.status = now_;
      r.updatedAt = now;
      changed = true;
      if (r.status === "ready") {
        arrived++;
        const message = `${r.name} is ready`;
        this.deps.events.emit({ type: "request.ready", profileId: r.profileId, request: stripRef(r), message });
        this.deps.tell?.(message, `${r.profileName} asked for it. Find it on the TV under Home › Your requests.`, `request-ready:${r.id}`);
      }
    }
    if (changed) this.save(list, now);
    return arrived;
  }

  async test(app: RequestTestResult["app"], cfg: { url: string; apiKey: string }): Promise<RequestTestResult> {
    return testRequestApp(app, cfg, this.deps.fetchImpl);
  }
}

/** Settings from the setup page: a blank key keeps the saved one, a blank address removes the program. */
export function mergeRequestSettings(saved: RequestSettings | undefined, body: unknown): RequestSettings {
  const out: RequestSettings = {};
  const b = (body ?? {}) as Record<string, Record<string, unknown> | null | undefined>;
  for (const app of ["jellyseerr", "radarr", "sonarr"] as const) {
    const given = b[app];
    const old = saved?.[app];
    if (given === undefined) {
      if (old) (out as Record<string, unknown>)[app] = old;
      continue;
    }
    const url = String(given?.url ?? "").trim().replace(/\/+$/, "");
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) throw new RequestError(`The ${app} address must start with http:// or https://`, 400);
    const apiKey = String(given?.apiKey ?? "").trim() || old?.apiKey || "";
    if (!apiKey) throw new RequestError(`The ${app} API key is missing`, 400);
    const extra = app === "jellyseerr" ? {} : { ...(old && "qualityProfileId" in old && old.qualityProfileId ? { qualityProfileId: old.qualityProfileId } : {}), ...(old && "rootFolder" in old && old.rootFolder ? { rootFolder: old.rootFolder } : {}) };
    (out as Record<string, unknown>)[app] = { url, apiKey, ...extra };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes

type Viewer = { profile: Profile | null; admin: boolean };

export function registerRequests(app: FastifyInstance, deps: { requests: TitleRequests; profiles: ProfileStore; viewer: (req: FastifyRequest) => Viewer; settings: () => RequestSettings | undefined }): void {
  const { requests, profiles, viewer } = deps;
  const limited = (p: Profile | null): p is Profile => p?.kind === "kids" || p?.kind === "guest";
  const fail = (err: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) => {
    if (err instanceof RequestError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  };

  app.get("/api/requests", async (req) => requests.view(viewer(req).profile));

  app.post("/api/requests", async (req: FastifyRequest<{ Body: { title?: Partial<TitleRef> } }>, reply) => {
    const t = req.body?.title;
    if (!t || typeof t.id !== "string" || typeof t.name !== "string" || (t.kind !== "movie" && t.kind !== "series")) return reply.code(400).send({ error: "Say which film or series" });
    try {
      return await requests.create(viewer(req).profile, { id: t.id, kind: t.kind, name: t.name, ...(typeof t.year === "number" ? { year: t.year } : {}), ...(typeof t.poster === "string" ? { poster: t.poster } : {}) });
    } catch (err) {
      return fail(err, reply);
    }
  });

  /** A grown-up approves or declines a Kids or Guest request: a child never does, whatever PIN it found. */
  app.post("/api/requests/:id/answer", async (req: FastifyRequest<{ Params: { id: string }; Body: { answer?: unknown; pin?: unknown } }>, reply) => {
    const who = viewer(req);
    if (limited(who.profile)) return reply.code(403).send({ error: "Ask a grown-up: this needs the PIN", code: "pin" });
    const pin = typeof req.body?.pin === "string" ? req.body.pin : undefined;
    if (!who.admin && !profiles.adultPin(pin)) return reply.code(403).send({ error: "That PIN isn't right", code: "pin" });
    try {
      return { request: await requests.answer(req.params.id, req.body?.answer as "approve" | "decline") };
    } catch (err) {
      return fail(err, reply);
    }
  });

  /** The setup page's Test button. A blank key tests the saved one. */
  app.post("/api/requests/test", async (req: FastifyRequest<{ Body: { app?: unknown; url?: unknown; apiKey?: unknown } }>, reply) => {
    const which = req.body?.app;
    if (which !== "jellyseerr" && which !== "radarr" && which !== "sonarr") return reply.code(400).send({ error: "Say which program to test" });
    const saved = deps.settings()?.[which];
    const url = String(req.body?.url ?? "").trim() || saved?.url || "";
    const apiKey = String(req.body?.apiKey ?? "").trim() || saved?.apiKey || "";
    return requests.test(which, { url, apiKey });
  });
}
