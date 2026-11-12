// The routes the PlayStation 5 app asks (docs/ps5-architecture.md). Each one runs the Hub's own
// route for the same thing as the same viewer, so profiles, Kids rules and pairing apply exactly
// as they do on the TV, and reshapes the answer (ps5.ts).

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { HomeScreen, PlaybackInfo, PlaybackRequest, SearchResult, TitleDetails } from "@ultimatetv/shared";
import { resolveTheme } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import { bundle, homeRows, parseRowId, resolved, searchRows, seriesRows, type Ps5Page } from "./ps5.js";

const originOf = (req: FastifyRequest): string => `${req.protocol}://${req.headers.host ?? "hub.lan:8095"}`;

/** What a progress report needs, remembered from the resolve that started the playback. */
interface Playing {
  key: string;
  title?: { id: string; kind: "movie" | "series"; name: string };
}

export function registerPs5(app: FastifyInstance, ctx: HubContext): void {
  const playing = new Map<string, Playing>();

  /** The Hub's own route, as the same caller: same token, same profile. */
  const ask = async <T>(req: FastifyRequest, method: "GET" | "POST", url: string, payload?: unknown): Promise<{ status: number; body: T }> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "content-length" && k !== "content-type") headers[k] = v;
    const res = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: res.statusCode, body: (res.body ? res.json() : {}) as T };
  };

  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, body: unknown) => reply.code(status).send(body);

  app.get("/api/ps5/catalog", async (req: FastifyRequest<{ Querystring: { parent?: string } }>, reply): Promise<Ps5Page | unknown> => {
    const parent = req.query.parent ?? "";
    const origin = originOf(req);
    const target = parent ? parseRowId(parent) : null;
    if (!parent || parent === "home") {
      const r = await ask<HomeScreen>(req, "GET", "/api/home");
      return r.status === 200 ? homeRows(r.body, origin) : fail(reply, r.status, r.body);
    }
    if (target?.what === "series") {
      const r = await ask<TitleDetails>(req, "GET", `/api/titles/${encodeURIComponent(target.id)}`);
      return r.status === 200 ? seriesRows(r.body, origin) : fail(reply, r.status, r.body);
    }
    return { items: [], has_more: false } satisfies Ps5Page;
  });

  app.get("/api/ps5/search", async (req: FastifyRequest<{ Querystring: { q?: string } }>, reply): Promise<Ps5Page | unknown> => {
    const q = (req.query.q ?? "").trim();
    if (!q) return { items: [], has_more: false } satisfies Ps5Page;
    const r = await ask<SearchResult[] | { results: SearchResult[] }>(req, "GET", `/api/search?q=${encodeURIComponent(q)}`);
    if (r.status !== 200) return fail(reply, r.status, r.body);
    return searchRows(Array.isArray(r.body) ? r.body : r.body.results ?? [], originOf(req));
  });

  app.post("/api/ps5/resolve", async (req: FastifyRequest<{ Body: { id?: string } }>, reply) => {
    const target = parseRowId(req.body?.id ?? "");
    if (!target || target.what === "rail" || target.what === "series") return reply.code(400).send({ error: "That isn't something that plays" });
    const request: PlaybackRequest =
      target.what === "channel" ? { kind: "channel", id: target.id }
      : target.what === "recording" ? { kind: "recording", id: target.id }
      : target.what === "episode" ? { kind: "title", id: target.id, episodeId: target.episodeId }
      : { kind: "title", id: target.id };
    const r = await ask<PlaybackInfo>(req, "POST", "/api/play", request);
    if (r.status !== 200) return fail(reply, r.status, r.body);
    playing.set(req.body!.id!, { key: r.body.progressKey });
    if (playing.size > 50) playing.delete(playing.keys().next().value as string);
    return resolved(r.body, originOf(req));
  });

  app.post("/api/ps5/progress", async (req: FastifyRequest<{ Body: { id?: string; pos_sec?: number; dur_sec?: number; state?: "start" | "update" | "stop"; paused?: boolean } }>) => {
    const b = req.body ?? {};
    const p = b.id ? playing.get(b.id) : undefined;
    if (!p) return { ok: false };
    const event = b.state === "start" ? "start" : b.state === "stop" ? "stop" : "progress";
    await ask(req, "POST", "/api/progress", { key: p.key, positionMs: Math.max(0, Math.round((b.pos_sec ?? 0) * 1000)), durationMs: Math.round((b.dur_sec ?? 0) * 1000), event, paused: b.paused === true });
    if (event === "stop") playing.delete(b.id!);
    return { ok: true };
  });

  // The look. Public, like the app's own pages: it is markup and colours, nothing of the household's.
  const current = () => bundle(resolveTheme(ctx.settings.get()));
  app.get("/ps5/bundle/manifest.json", async () => current().manifest);
  app.get("/ps5/bundle/:file", async (req: FastifyRequest<{ Params: { file: string } }>, reply) => {
    const f = current().files.find((x) => x.path === req.params.file);
    if (!f) return reply.code(404).send({ error: "No such file" });
    return reply.type(f.path.endsWith(".rml") ? "text/xml" : "text/css").send(f.body);
  });
}
