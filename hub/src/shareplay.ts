// Share Play (issue #210): a one-off link to what a TV is playing. Whoever opens it watches along
// in an ordinary web browser, with nothing to install, kept in step with the TV by Sync play
// (watching.ts): pause on either and both pause, skip on either and both skip.
//
// How it holds together:
// - The link's token is the only key. The first browser to open it is given a secret of its own
//   (a cookie scoped to that link), and from then on no other browser can use the link.
// - The browser never talks to Jellyfin. It plays a 720p H.264/AAC copy that Jellyfin makes on the
//   fly (the same one the Android app downloads), fetched through the Hub here with the Jellyfin
//   key added on the way out and taken out of every playlist on the way back.
// - Every guest route lives under /share/, so a household that wants a friend in another house to
//   use the link can put just that path on the internet (SHARE_URL, see docs/share-play.md) and
//   nothing else of the Hub.
// - Links are kept in memory: a Hub restart ends them all, which suits something meant to be thrown away.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PlaybackRequest, ShareLinkView, SharePageInfo, ShareProblem, SyncGroup, WatchSession } from "@ultimatetv/shared";
import { SHARE_DEFAULT_MS, SHARE_MAX_MS, SHARE_PROBLEMS } from "@ultimatetv/shared";
import { type Asker, SyncError, type Watching } from "./watching.js";

/** At most this many links at once; making another drops the oldest. */
export const SHARE_MAX_LINKS = 10;

export interface ShareLink {
  id: string;
  host: string;
  hostName: string;
  req: PlaybackRequest;
  name: string;
  subtitle?: string;
  artwork?: string;
  durationMs?: number;
  createdAt: number;
  expiresAt: number;
  /** Who made it (the phone or TV that asked). */
  createdBy: string;
  /** The Jellyfin HLS master playlist, with its key; never sent to the browser. */
  master: string;
  /** sha256 of the secret the first browser was given. */
  viewer?: string;
  viewerName?: string;
  /** The Sync play group the browser is in. */
  group?: string;
  /** The TV moved on to something else: the link has finished for good. */
  finished?: boolean;
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const sameSecret = (secret: string | undefined, hash: string | undefined) => {
  if (!secret || !hash) return false;
  const a = sha(secret);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};
const sameRequest = (a: PlaybackRequest, b: PlaybackRequest) => a.kind === b.kind && a.id === b.id && (a.episodeId ?? "") === (b.episodeId ?? "");

/** Only films and episodes can be shared: live TV and IPTV can't be passed on to another house. */
export function shareable(s: Pick<WatchSession, "req" | "live">): boolean {
  return s.req.kind === "title" && !s.live;
}

/** The share links, in memory. */
export class ShareLinks {
  private links = new Map<string, ShareLink>();

  constructor(private readonly now: () => number = Date.now) {}

  create(s: WatchSession, by: string, master: string, ttlMs = SHARE_DEFAULT_MS): ShareLink {
    const now = this.now();
    const ttl = Number.isFinite(ttlMs) ? Math.min(Math.max(ttlMs, 5 * 60_000), SHARE_MAX_MS) : SHARE_DEFAULT_MS;
    const link: ShareLink = {
      id: randomBytes(16).toString("base64url"),
      host: s.device,
      hostName: s.deviceName,
      req: { ...s.req },
      name: s.name,
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      ...(s.artwork ? { artwork: s.artwork } : {}),
      ...(s.durationMs ? { durationMs: s.durationMs } : {}),
      createdAt: now,
      expiresAt: now + ttl,
      createdBy: by,
      master,
    };
    this.links.set(link.id, link);
    const live = this.list();
    for (const old of live.slice(SHARE_MAX_LINKS)) this.links.delete(old.id);
    return link;
  }

  /** A link that hasn't run out, or undefined. Ones that have run out are forgotten here. */
  get(id: string): ShareLink | undefined {
    const link = this.links.get(id);
    if (link && link.expiresAt <= this.now()) {
      this.links.delete(id);
      return undefined;
    }
    return link;
  }

  /** Newest first. */
  list(): ShareLink[] {
    for (const id of [...this.links.keys()]) this.get(id);
    return [...this.links.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * The browser opening the link. The first one is given a secret (returned so it can be set as a
   * cookie); the same browser coming back is let in again; any other is turned away.
   */
  claim(id: string, secret: string | undefined, name?: string): { link: ShareLink; secret?: string } | ShareProblem {
    const link = this.get(id);
    if (!link) return "expired";
    if (link.finished) return "moved-on";
    if (link.viewer) {
      if (!sameSecret(secret, link.viewer)) return "taken";
      if (name) link.viewerName = name;
      return { link };
    }
    const fresh = randomBytes(24).toString("base64url");
    link.viewer = sha(fresh).toString("hex");
    if (name) link.viewerName = name;
    return { link, secret: fresh };
  }

  /** The link, when this browser holds it. */
  check(id: string, secret: string | undefined): ShareLink | ShareProblem {
    const link = this.get(id);
    if (!link) return "expired";
    if (link.finished) return "moved-on";
    if (!sameSecret(secret, link.viewer)) return "taken";
    return link;
  }

  revoke(id: string): ShareLink | undefined {
    const link = this.links.get(id);
    this.links.delete(id);
    return link;
  }
}

/** The device id a link's browser has in Sync play. Not the token: other screens see member ids. */
export const viewerDevice = (link: Pick<ShareLink, "id">) => `share:${createHash("sha256").update(link.id).digest("hex").slice(0, 12)}`;

/** Takes Jellyfin's key out of a playlist, wherever it appears in a URL. */
export function stripKey(playlist: string): string {
  return playlist.replace(/([?&])(?:api_key|apikey)=[^&"\s#]*(&?)/gi, (_m, sep: string, amp: string) => (amp ? sep : ""));
}

/** The Jellyfin URL for one file of the HLS copy, or null when `rest` isn't one. */
export function upstreamUrl(master: string, rest: string, query: Record<string, unknown>): URL | null {
  if (!/^[A-Za-z0-9_\-.][A-Za-z0-9_\-./]*$/.test(rest) || rest.includes("..") || rest.includes("//")) return null;
  const m = new URL(master);
  const dir = m.pathname.replace(/[^/]*$/, "");
  const url = new URL(dir + rest, m.origin);
  if (rest === "master.m3u8") {
    url.search = m.search;
    return url;
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (typeof v === "string" && !/^(api_key|apikey)$/i.test(k)) q.set(k, v);
  const key = m.searchParams.get("api_key");
  if (key) q.set("api_key", key);
  url.search = q.toString();
  return url;
}

/**
 * Whether a request came in through the Share Play tunnel (docs/share-play.md): cloudflared adds
 * Cf-Connecting-IP, and the tunnel's own hostname is SHARE_URL's.
 */
export function viaShareTunnel(headers: Record<string, unknown>, shareUrl: string | undefined): boolean {
  if (typeof headers["cf-connecting-ip"] === "string") return true;
  if (!shareUrl) return false;
  const host = typeof headers.host === "string" ? headers.host.toLowerCase() : "";
  return host !== "" && host === new URL(shareUrl).host.toLowerCase();
}

/**
 * The tunnel publishes only /share/, and the Hub holds to that as well: anything else that comes
 * through it is a 404, so a slip in the tunnel's config can't put the rest of the Hub on the internet.
 */
export function onlyShareThroughTunnel(app: FastifyInstance, shareUrl: string | undefined): void {
  app.addHook("onRequest", async (req, reply) => {
    if (viaShareTunnel(req.headers, shareUrl) && !req.url.startsWith("/share/")) return reply.code(404).type("text/plain").send("Not found");
  });
}

const COOKIE = "utv_share";
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

type Req<P = Record<string, string>, Q = Record<string, string>, B = unknown> = FastifyRequest<{ Params: P; Querystring: Q; Body: B }>;

export interface ShareDeps {
  links: ShareLinks;
  watching: Watching;
  /** Who is asking for a link (a paired phone or TV). */
  asker: (req: FastifyRequest) => Asker | null;
  /** Kids and Guest profiles can't hand out links. */
  mayShare: (req: FastifyRequest) => boolean;
  /** The TV this phone works, when it doesn't say which. */
  defaultHost: (req: FastifyRequest) => string | undefined;
  /** The HLS master playlist for a film or episode, or null when the media server can't make one. */
  hlsFor: (req: PlaybackRequest) => Promise<string | null>;
  /** Where links point: SHARE_URL when set, else the Hub's own address on the home network. */
  linkBase: (req: FastifyRequest) => string;
  appName: () => string;
  /** The watch page. */
  pageFile: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function registerSharePlay(app: FastifyInstance, deps: ShareDeps): void {
  const { links, watching } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const problem = (reply: FastifyReply, p: ShareProblem) => reply.code(p === "taken" ? 403 : p === "not-shareable" ? 422 : p === "stopped" ? 409 : 410).header("Cache-Control", "no-store").send({ problem: p, error: SHARE_PROBLEMS[p] });

  const cookieOf = (req: FastifyRequest) => {
    const raw = req.headers.cookie;
    const c = (typeof raw === "string" ? raw : "").split(/;\s*/).find((x) => x.startsWith(`${COOKIE}=`));
    return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : undefined;
  };
  const secure = (req: FastifyRequest) => req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";

  /** Whether the browser is still in the group, as other screens see it. */
  const watchingNow = (link: ShareLink) => {
    if (!link.group) return false;
    const g = watching.group(link.group);
    return Boolean(g && !g.ended && g.members.some((m) => m.device === viewerDevice(link)));
  };
  const view = (req: FastifyRequest, link: ShareLink): ShareLinkView => ({
    id: link.id,
    url: `${deps.linkBase(req)}/share/${link.id}`,
    host: link.host,
    hostName: link.hostName,
    name: link.name,
    ...(link.subtitle ? { subtitle: link.subtitle } : {}),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    opened: Boolean(link.viewer),
    ...(link.viewerName ? { viewerName: link.viewerName } : {}),
    watching: watchingNow(link),
  });
  const dropViewer = (link: ShareLink) => {
    if (link.group) watching.leave(link.group, viewerDevice(link));
    delete link.group;
  };

  /** Whether the TV is still on the shared thing; a TV on something else finishes the link. */
  const hostState = (link: ShareLink): "ok" | "stopped" | "moved-on" => {
    const s = watching.session(link.host);
    if (s && !sameRequest(s.req, link.req)) {
      link.finished = true;
      dropViewer(link);
      return "moved-on";
    }
    if (!s || s.stopped) return "stopped";
    return "ok";
  };

  // ---------------------------------------------------------------------------------------------
  // The sharer (a paired phone or TV)

  app.post("/api/share", async (req: Req<Record<string, string>, Record<string, string>, { device?: string; hours?: number }>, reply) => {
    if (!deps.mayShare(req)) return reply.code(403).send({ error: "Ask a grown-up: Kids and Guest profiles can't share" });
    const a = deps.asker(req);
    const asked = typeof req.body?.device === "string" && req.body.device ? req.body.device : undefined;
    const mine = a ? watching.session(a.device) : undefined;
    const host = asked ?? (mine && !mine.stopped ? a?.device : deps.defaultHost(req));
    const s = host ? watching.session(host) : undefined;
    if (!s || s.stopped) return problem(reply, "stopped");
    if (!shareable(s)) return problem(reply, "not-shareable");
    const master = await deps.hlsFor(s.req).catch(() => null);
    if (!master) return reply.code(422).send({ problem: "not-shareable", error: "Only films and TV episodes from Jellyfin can be shared (not Plex, recordings or live TV)." });
    const hours = Number(req.body?.hours);
    const link = links.create(s, a?.device ?? "unknown", master, Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : SHARE_DEFAULT_MS);
    return view(req, link);
  });

  app.get("/api/share", async (req, reply) => reply.header("Cache-Control", "no-store").send({ links: links.list().map((l) => view(req, l)) }));

  app.delete("/api/share/:id", async (req: Req<{ id: string }>, reply) => {
    const link = links.revoke(req.params.id);
    if (!link) return reply.code(404).send({ error: "That link has already gone" });
    dropViewer(link);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------------------------
  // The person watching (any browser with the link)

  let hlsJs: string | undefined;
  app.get("/share/hls.js", async (_req, reply) => {
    hlsJs ??= readFileSync(createRequire(import.meta.url).resolve("hls.js/dist/hls.light.min.js"), "utf8");
    return reply.type("text/javascript").header("Cache-Control", "public, max-age=86400").send(hlsJs);
  });

  app.get("/share/:token", async (req: Req<{ token: string }>, reply) => {
    if (!TOKEN.test(req.params.token)) return reply.code(404).send("Not found");
    // No referrer: the link is the key, so it mustn't leak to anything the page loads.
    return reply.type("text/html").header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex").send(readFileSync(deps.pageFile, "utf8"));
  });

  app.get("/share/:token/info", async (req: Req<{ token: string }>, reply) => {
    const link = links.get(req.params.token);
    if (!link) return problem(reply, "expired");
    if (link.finished) return problem(reply, "moved-on");
    if (link.viewer && !sameSecret(cookieOf(req), link.viewer)) return problem(reply, "taken");
    const info: SharePageInfo = {
      name: link.name,
      ...(link.subtitle ? { subtitle: link.subtitle } : {}),
      ...(link.artwork ? { artwork: `/share/${link.id}/art` } : {}),
      hostName: link.hostName,
      expiresAt: link.expiresAt,
      ...(link.durationMs ? { durationMs: link.durationMs } : {}),
      appName: deps.appName(),
    };
    return reply.header("Cache-Control", "no-store").send(info);
  });

  /** The picture, fetched by the Hub so the browser needn't reach the media server. */
  app.get("/share/:token/art", async (req: Req<{ token: string }>, reply) => {
    const link = links.get(req.params.token);
    if (!link?.artwork || (link.viewer && !sameSecret(cookieOf(req), link.viewer))) return reply.code(404).send();
    // Only pictures from the same media server as the film itself.
    let art: URL;
    try {
      art = new URL(link.artwork);
    } catch {
      return reply.code(404).send();
    }
    if (art.origin !== new URL(link.master).origin || !art.pathname.includes("/Items/")) return reply.code(404).send();
    const res = await doFetch(art).catch(() => null);
    if (!res?.ok || !res.body) return reply.code(502).send();
    return reply
      .type(res.headers.get("content-type") ?? "image/jpeg")
      .header("Cache-Control", "private, max-age=3600")
      .send(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
  });

  app.post("/share/:token/join", async (req: Req<{ token: string }, Record<string, string>, { name?: string }>, reply) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ").slice(0, 40) : "";
    const claimed = links.claim(req.params.token, cookieOf(req), name || undefined);
    if (typeof claimed === "string") return problem(reply, claimed);
    const { link, secret } = claimed;
    if (secret) {
      reply.header("Set-Cookie", `${COOKIE}=${encodeURIComponent(secret)}; Path=/share/${link.id}; Max-Age=${Math.ceil((link.expiresAt - now()) / 1000)}; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`);
    }
    const state = hostState(link);
    if (state !== "ok") return problem(reply, state);
    try {
      const hosted = watching.hostGroup(link.host);
      const group = watching.join(hosted.id, { device: viewerDevice(link), deviceName: link.viewerName ?? "Someone with a link", client: "browser" });
      link.group = group.id;
      return reply.header("Cache-Control", "no-store").send({ now: now(), me: viewerDevice(link), group, stream: `/share/${link.id}/hls/master.m3u8` });
    } catch (err) {
      if (err instanceof SyncError) return problem(reply, "stopped");
      throw err;
    }
  });

  /** The link's browser, as a Sync play member, or a reply already sent. */
  const member = (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply): { link: ShareLink; who: Asker } | null => {
    const link = links.check(req.params.token, cookieOf(req));
    if (typeof link === "string") {
      void problem(reply, link);
      return null;
    }
    return { link, who: { device: viewerDevice(link), deviceName: link.viewerName ?? "Someone with a link", profile: null } };
  };

  /** The shared clock, held open until it changes, like GET /api/sync/:id. */
  app.get("/share/:token/sync", async (req: Req<{ token: string }, { since?: string; wait?: string }>, reply) => {
    const m = member(req, reply);
    if (!m) return reply;
    const { link, who } = m;
    if (hostState(link) === "moved-on") return problem(reply, "moved-on");
    if (!link.group) return problem(reply, "stopped");
    const id = link.group;
    watching.touch(id, who.device);
    await watching.wait(id, Number.parseInt(String(req.query.since ?? "0"), 10) || 0, Number.parseInt(String(req.query.wait ?? "0"), 10) || 0);
    watching.touch(id, who.device);
    const group: SyncGroup | undefined = watching.group(id);
    if (!group || group.ended || !group.members.some((x) => x.device === who.device)) {
      const state = hostState(link);
      return problem(reply, state === "ok" ? "stopped" : state);
    }
    return reply.header("Cache-Control", "no-store").send({ now: now(), group });
  });

  app.post("/share/:token/action", async (req: Req<{ token: string }, Record<string, string>, { action?: string; positionMs?: number }>, reply) => {
    const m = member(req, reply);
    if (!m) return reply;
    const action = req.body?.action;
    if (action !== "play" && action !== "pause" && action !== "seek") return reply.code(400).send({ error: "Play, pause or seek" });
    if (!m.link.group) return problem(reply, "stopped");
    try {
      return { now: now(), group: watching.act(m.link.group, m.who, action, req.body?.positionMs) };
    } catch (err) {
      if (err instanceof SyncError) return problem(reply, "stopped");
      throw err;
    }
  });

  app.post("/share/:token/leave", async (req: Req<{ token: string }>, reply) => {
    const m = member(req, reply);
    if (!m) return reply;
    dropViewer(m.link);
    return { ok: true };
  });

  /** The 720p copy, through the Hub: the browser never sees the media server or its key. */
  app.get("/share/:token/hls/*", async (req: Req<{ token: string; "*": string }, Record<string, string>>, reply) => {
    const m = member(req, reply);
    if (!m) return reply;
    const url = upstreamUrl(m.link.master, req.params["*"], req.query);
    if (!url) return reply.code(404).send();
    const res = await doFetch(url).catch(() => null);
    if (!res) return reply.code(502).send({ error: "The media server didn't answer" });
    reply.code(res.status);
    const type = res.headers.get("content-type") ?? "";
    if (/mpegurl/i.test(type) || url.pathname.endsWith(".m3u8")) {
      return reply.type(type || "application/vnd.apple.mpegurl").header("Cache-Control", "no-store").send(stripKey(await res.text()));
    }
    if (type) reply.type(type);
    const len = res.headers.get("content-length");
    if (len) reply.header("Content-Length", len);
    if (!res.body) return reply.send();
    return reply.send(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
  });
}
