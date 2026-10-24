import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { renderMatrix, validateReport, type ProbeReport } from "@ultimatetv/shared";
import { listClips } from "./clips.js";
import type { HubConfig } from "./config.js";
import { ReportStore } from "./reports.js";
import { systemReport, type SystemReport } from "./system.js";

export interface ServerDeps {
  /** Overridable in tests so they don't shell out to ffmpeg/vainfo. */
  systemReport?: () => Promise<SystemReport>;
  logger?: boolean;
}

export const HUB_VERSION = "0.1.0";

export async function buildServer(config: HubConfig, deps: ServerDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const reports = new ReportStore(path.join(config.dataDir, "probe-reports"));
  const getSystem = deps.systemReport ?? systemReport;

  app.get("/api/health", async () => ({ ok: true, version: HUB_VERSION }));

  app.get("/api/system", async () => getSystem());

  app.get("/api/clips", async () => ({ clips: await listClips(config.clipsDir) }));

  app.get("/api/probe-reports", async () => ({ reports: await reports.list() }));

  app.post("/api/probe-reports", async (request, reply) => {
    const problems = validateReport(request.body);
    if (problems.length > 0) return reply.code(400).send({ error: "Invalid probe report", problems });
    const id = await reports.save(request.body as ProbeReport);
    return reply.code(201).send({ id, matrix: `/api/probe-reports/${id}/matrix.md` });
  });

  app.get<{ Params: { id: string } }>("/api/probe-reports/:id", async (request, reply) => {
    const report = await reports.get(request.params.id);
    if (!report) return reply.code(404).send({ error: "Report not found" });
    return report;
  });

  app.get<{ Params: { id: string } }>("/api/probe-reports/:id/matrix.md", async (request, reply) => {
    const report = await reports.get(request.params.id);
    if (!report) return reply.code(404).send({ error: "Report not found" });
    return reply.type("text/markdown; charset=utf-8").send(renderMatrix(report));
  });

  // The probe page is what the TV bookmarks for Phase 0, so the root goes straight to it.
  app.get("/", async (_request, reply) => reply.redirect("/probe/"));

  if (existsSync(config.probeDir)) {
    await app.register(fastifyStatic, { root: config.probeDir, prefix: "/probe/" });
  } else {
    app.get("/probe/", async (_request, reply) =>
      reply.code(503).type("text/plain").send("Probe page not built. Run `npm run build` first."),
    );
  }

  // Test clips are served with range requests so the TV can seek.
  if (existsSync(config.clipsDir)) {
    await app.register(fastifyStatic, {
      root: config.clipsDir,
      prefix: "/clips/",
      decorateReply: false,
      acceptRanges: true,
      cacheControl: false,
    });
  }

  return app;
}
