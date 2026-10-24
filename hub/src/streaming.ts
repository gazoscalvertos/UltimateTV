// Serving media to the box: local files (recordings, NAS) with range requests, and a proxy for
// IPTV catch-up and VOD that holds a connection lease while the box is reading.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConnectionBusyError, type ConnectionGuard } from "./connections.js";
import { IPTV_USER_AGENT, type Fetch } from "./http.js";

const TYPES: Record<string, string> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".srt": "application/x-subrip",
};

export async function sendFile(request: FastifyRequest, reply: FastifyReply, file: string): Promise<FastifyReply> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return reply.code(404).send({ error: "File not found" });
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  reply.header("Accept-Ranges", "bytes").header("Content-Type", type);
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || start > end) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
    reply.code(206).header("Content-Range", `bytes ${start}-${end}/${info.size}`).header("Content-Length", end - start + 1);
    return reply.send(createReadStream(file, { start, end }));
  }
  reply.header("Content-Length", info.size);
  return reply.send(createReadStream(file));
}

interface ProxyTarget {
  url: string;
  headers?: Record<string, string>;
  label: string;
  /** Uses an IPTV connection (catch-up, Xtream VOD) and must hold a lease. */
  iptv: boolean;
  force: boolean;
  created: number;
}

/** Short-lived tokens that map to upstream URLs, so credentials never reach the box. */
export class StreamProxy {
  private targets = new Map<string, ProxyTarget>();

  constructor(
    private guard: ConnectionGuard,
    private fetchImpl: Fetch = fetch,
  ) {}

  register(target: Omit<ProxyTarget, "created">): string {
    const token = randomBytes(12).toString("base64url");
    this.targets.set(token, { ...target, created: Date.now() });
    // Tokens live for a day: long enough for a paused film.
    for (const [t, v] of this.targets) if (Date.now() - v.created > 86_400_000) this.targets.delete(t);
    return token;
  }

  async handle(request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply): Promise<FastifyReply> {
    const target = this.targets.get(request.params.token);
    if (!target) return reply.code(404).send({ error: "This stream has expired. Start it again." });
    const leaseKey = `stream:${request.params.token}`;
    if (target.iptv) {
      try {
        this.guard.acquire({ key: leaseKey, holder: "box", kind: "view", label: target.label, idleMs: 90_000, force: target.force });
      } catch (err) {
        if (err instanceof ConnectionBusyError) return reply.code(409).send({ error: err.message, recordings: err.blockingRecordings });
        throw err;
      }
    }
    const headers: Record<string, string> = { "User-Agent": IPTV_USER_AGENT, ...target.headers };
    if (request.headers.range) headers.Range = request.headers.range;
    const abort = new AbortController();
    request.raw.on("close", () => abort.abort());
    const upstream = await this.fetchImpl(target.url, { headers, signal: abort.signal, redirect: "follow" });
    reply.code(upstream.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) reply.header(h, v);
    }
    if (!upstream.body) return reply.send();
    const body = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>);
    if (target.iptv) body.on("data", () => this.guard.touch(leaseKey));
    return reply.send(body);
  }
}
