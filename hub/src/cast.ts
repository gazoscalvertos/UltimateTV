// Other screens on the TV, the Hub's part:
//
// - A laptop shares its screen from its browser at https://<hub>:8096/cast/ (no install): the
//   page sends a WebRTC offer here, the TV is told, asks the room whether to show it, and posts
//   its answer back; the laptop's page polls for it. Video then goes straight from the laptop to
//   the TV over the home network. Browsers only share a screen from a secure page, so the Hub
//   also listens on HTTPS with a certificate it makes for itself (the browser warns once).
// - A paired phone sends a link (a video, a stream, a YouTube page) or a photo to play now.
// - Who may do what (screen sharing, links, games on the Kids profile) is kept here too.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { cleanCastSettings, cleanCastUrl, DEFAULT_CAST_SETTINGS, linkTitle, type CastSettings, type ShareOffer, type ShareSession } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";

const run = promisify(execFile);

/** A laptop's offer waits this long for the TV to answer. */
const OFFER_MS = 2 * 60_000;
/** Sessions are forgotten this long after they end. */
const KEEP_MS = 10 * 60_000;
/** How long the laptop's page waits on one poll. */
const POLL_MS = 25_000;

interface Share {
  offer: ShareOffer;
  session: ShareSession;
  ip: string;
  updatedAt: number;
  waiters: Set<() => void>;
}

export class ScreenShares {
  private shares = new Map<string, Share>();
  private recent: number[] = [];

  constructor(private readonly ctx: HubContext) {}

  settings(): CastSettings {
    return cleanCastSettings(this.ctx.db.getKv<Partial<CastSettings>>("cast-settings") ?? {}, DEFAULT_CAST_SETTINGS);
  }

  saveSettings(patch: Partial<CastSettings>): CastSettings {
    const s = cleanCastSettings(patch, this.settings());
    this.ctx.db.setKv("cast-settings", s);
    this.ctx.events.emit({ type: "settings.changed" });
    return s;
  }

  private tidy(now: number): void {
    for (const [id, s] of this.shares) {
      if (s.session.status === "waiting" && now - s.offer.at > OFFER_MS) this.finish(id, "refused", "The TV didn't answer");
      if (s.session.status !== "waiting" && s.session.status !== "accepted" && now - s.updatedAt > KEEP_MS) this.shares.delete(id);
    }
    this.recent = this.recent.filter((t) => now - t < 60_000);
  }

  /** A laptop asks to share. Throws (with a status code) when sharing is off or it's asking too often. */
  offer(input: { name?: unknown; sdp?: unknown; surface?: unknown }, ip: string, now = Date.now()): ShareSession {
    this.tidy(now);
    if (!this.settings().screenShare) throw Object.assign(new Error("Screen sharing is turned off on the TV (Settings › Cast and games)"), { statusCode: 403 });
    const sdp = typeof input.sdp === "string" ? input.sdp : "";
    if (!sdp.startsWith("v=0") || sdp.length > 200_000) throw Object.assign(new Error("That isn't a screen share offer"), { statusCode: 400 });
    if (this.recent.length >= 6) throw Object.assign(new Error("Too many tries. Wait a minute and try again."), { statusCode: 429 });
    this.recent.push(now);
    // One laptop at a time waits for an answer; a new ask from the same address replaces its old one.
    for (const [id, s] of this.shares) if (s.session.status === "waiting" && s.ip === ip) this.finish(id, "ended", "Asked again");
    const name = (typeof input.name === "string" ? input.name : "").replace(/\s+/g, " ").trim().slice(0, 40) || "A laptop";
    const id = randomBytes(8).toString("hex");
    const offer: ShareOffer = { id, name, sdp, at: now };
    if (input.surface === "monitor" || input.surface === "window" || input.surface === "browser") offer.surface = input.surface;
    const share: Share = { offer, session: { id, status: "waiting" }, ip, updatedAt: now, waiters: new Set() };
    this.shares.set(id, share);
    this.ctx.events.emit({ type: "cast.share", offer });
    return share.session;
  }

  get(id: string): ShareSession | undefined {
    this.tidy(Date.now());
    return this.shares.get(id)?.session;
  }

  /** Waits until the session changes from what the caller last saw (or the poll times out). */
  async wait(id: string, seen: string | undefined, ms = POLL_MS): Promise<ShareSession | undefined> {
    const share = this.shares.get(id);
    if (!share || share.session.status !== seen) return this.get(id);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        share.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      share.waiters.add(done);
    });
    return this.get(id);
  }

  /** The TV's answer. */
  answer(id: string, sdp: unknown): ShareSession {
    const share = this.shares.get(id);
    if (!share || share.session.status !== "waiting") throw Object.assign(new Error("That screen share has gone"), { statusCode: 404 });
    if (typeof sdp !== "string" || !sdp.startsWith("v=0")) throw Object.assign(new Error("That isn't an answer"), { statusCode: 400 });
    share.session = { id, status: "accepted", answer: sdp };
    this.touch(share);
    return share.session;
  }

  finish(id: string, status: "refused" | "ended", reason?: string): ShareSession | undefined {
    const share = this.shares.get(id);
    if (!share) return undefined;
    const was = share.session.status;
    if (was === "refused" || was === "ended") return share.session;
    share.session = { id, status, ...(reason ? { reason } : {}) };
    this.touch(share);
    if (was === "accepted" || was === "waiting") this.ctx.events.emit({ type: "cast.share.end", id });
    return share.session;
  }

  private touch(share: Share): void {
    share.updatedAt = Date.now();
    for (const w of [...share.waiters]) w();
  }
}

/** The Hub's own HTTPS certificate, made once with openssl and kept in the data folder. */
export async function hubCertificate(dataDir: string, hosts: string[] = []): Promise<{ key: Buffer; cert: Buffer }> {
  const dir = path.join(dataDir, "tls");
  const keyFile = path.join(dir, "hub-key.pem");
  const certFile = path.join(dir, "hub-cert.pem");
  if (!existsSync(keyFile) || !existsSync(certFile)) {
    await mkdir(dir, { recursive: true });
    const san = ["DNS:localhost", "IP:127.0.0.1", ...hosts.map((h) => (/^[\d.]+$/.test(h) ? `IP:${h}` : `DNS:${h}`))];
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650", "-subj", "/CN=UltimateTV Hub", "-addext", `subjectAltName=${[...new Set(san)].join(",")}`, "-keyout", keyFile, "-out", certFile], { timeout: 30_000 });
  }
  return { key: await readFile(keyFile), cert: await readFile(certFile) };
}

/**
 * Serves the same Hub over HTTPS on another port, for the laptop's screen share page (a browser
 * only shares a screen from a secure page). Null when it couldn't start (no openssl, port taken).
 */
export async function startHttps(app: FastifyInstance, dataDir: string, port: number, hosts: string[] = []): Promise<Server | null> {
  try {
    const { key, cert } = await hubCertificate(dataDir, hosts);
    const server = createServer({ key, cert }, (req, res) => app.routing(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => resolve());
    });
    app.addHook("onClose", async () => void server.close());
    app.log.info({ port }, "Screen sharing page on HTTPS");
    return server;
  } catch (err) {
    app.log.warn({ err: String(err) }, "Couldn't start HTTPS, so laptops can't share their screen");
    return null;
  }
}

export function registerCast(app: FastifyInstance, ctx: HubContext, shares: ScreenShares, opts: { httpsPort?: number; castUrl: (req: FastifyRequest) => string | null }): void {
  type Req<B, P = { id: string }, Q = Record<string, string | undefined>> = FastifyRequest<{ Body: B; Params: P; Querystring: Q }>;
  const body = <T>(req: FastifyRequest) => (req.body && typeof req.body === "object" ? (req.body as T) : ({} as T));

  app.get("/api/cast/settings", async (req) => ({ settings: shares.settings(), shareUrl: opts.castUrl(req) }));
  app.put("/api/cast/settings", async (req) => ({ settings: shares.saveSettings(body<Partial<CastSettings>>(req)), shareUrl: opts.castUrl(req) }));

  // The laptop's page.
  app.post("/api/cast/share", async (req) => shares.offer(body(req), req.ip));
  app.get("/api/cast/share/:id", async (req: Req<unknown, { id: string }, { seen?: string }>, reply) => {
    const s = req.query.seen ? await shares.wait(req.params.id, req.query.seen) : shares.get(req.params.id);
    if (!s) return reply.code(404).send({ error: "That screen share has gone" });
    return s;
  });
  app.delete("/api/cast/share/:id", async (req: Req<unknown>) => ({ ok: Boolean(shares.finish(req.params.id, "ended", "The laptop stopped sharing")) }));

  // The TV's side.
  app.post("/api/cast/share/:id/answer", async (req: Req<{ sdp?: string }>) => shares.answer(req.params.id, req.body?.sdp));
  app.post("/api/cast/share/:id/refuse", async (req: Req<{ reason?: string }>, reply) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 120) : "The TV said no";
    const s = shares.finish(req.params.id, "refused", reason);
    return s ?? reply.code(404).send({ error: "That screen share has gone" });
  });
  app.post("/api/cast/share/:id/end", async (req: Req<unknown>) => ({ ok: Boolean(shares.finish(req.params.id, "ended", "Stopped on the TV")) }));

  /** A link from a phone: the TV plays it now. */
  app.post("/api/cast/link", async (req, reply) => {
    if (!shares.settings().links) return reply.code(403).send({ error: "Sending links is turned off on the TV (Settings › Cast and games)" });
    const b = body<{ url?: unknown; title?: unknown; from?: unknown }>(req);
    const url = cleanCastUrl(b.url);
    if (!url) return reply.code(400).send({ error: "Send a web address starting http:// or https://" });
    const title = (typeof b.title === "string" ? b.title.replace(/\s+/g, " ").trim().slice(0, 120) : "") || linkTitle(url);
    const from = typeof b.from === "string" ? b.from.slice(0, 40) : undefined;
    ctx.events.emit({ type: "cast.link", link: { url, title, ...(from ? { from } : {}) } });
    return { ok: true, url, title };
  });
}
