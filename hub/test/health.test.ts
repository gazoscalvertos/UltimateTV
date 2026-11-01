// The Hub's health check (#96): what /api/health answers, and what makes it say "degraded".
// It judges the database, the recordings disk, the scheduler's tick and the data folder, answers
// in under a second, and never throws: a broken check becomes a reason.

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HubContext } from "../src/context.js";
import { hubHealth, type HealthContext } from "../src/health.js";
import { silentLogger } from "../src/log.js";
import { buildServer, HUB_VERSION } from "../src/server.js";

let tmp: string;
let apps: FastifyInstance[];
let contexts: HubContext[];

const dataDirPath = () => path.join(tmp, "data");

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-health-"));
  apps = [];
  contexts = [];
  // The real checks read and write it, so every test starts with a data folder there.
  await mkdir(dataDirPath(), { recursive: true });
});

afterEach(async () => {
  for (const app of apps) await app.close();
  for (const ctx of contexts) ctx.close();
  await rm(tmp, { recursive: true, force: true });
});

/** A Hub that answers every check, so a test can break one thing at a time. */
function fakeContext(over: Partial<HealthContext> = {}): HealthContext {
  return {
    db: { get: () => ({ n: 1 }) },
    scheduler: { running: true, lastTickAt: Date.now() },
    recorder: { activeIds: () => [] },
    ...over,
  };
}

/** A real Hub in a temporary folder (the scheduler isn't started unless the test starts it). */
function realContext(dataDir = dataDirPath()): HubContext {
  const ctx = new HubContext({ dataDir, mediaRoot: tmp, log: silentLogger, ytdlp: null });
  contexts.push(ctx);
  return ctx;
}

/** A real Hub for a `buildServer` test: the server closes it, so the test mustn't. */
function serverContext(dataDir: string): HubContext {
  return new HubContext({ dataDir, mediaRoot: tmp, log: silentLogger, ytdlp: null });
}

describe("hubHealth", () => {
  it("says ok when the database, the recordings loop, the disk and the data folder all answer", async () => {
    const ctx = realContext();
    ctx.scheduler.start(3_600_000);
    await ctx.scheduler.tick();
    const tickedAt = ctx.scheduler.lastTickAt as number;
    expect(tickedAt).toBeTypeOf("number");

    const health = await hubHealth(ctx, { dataDir: dataDirPath(), now: tickedAt });

    expect(health.ok).toBe(true);
    expect(health.status).toBe("ok");
    expect(health.reasons).toEqual([]);
    expect(health.checks.db).toEqual({ ok: true });
    expect(health.checks.scheduler.ok).toBe(true);
    expect(health.checks.scheduler.lastTickAgeMs).toBe(0);
    expect(health.checks.disk.ok).toBe(true);
    expect(health.checks.disk.freeGb).toBeGreaterThan(0);
    expect(health.checks.dataDir).toEqual({ ok: true, writable: true });
  });

  it("says degraded, with the age, when the recording loop hasn't ticked for minutes", async () => {
    const now = Date.now();
    const health = await hubHealth(fakeContext({ scheduler: { running: true, lastTickAt: now - 5 * 60_000 } }), { now, dataDir: dataDirPath() });

    expect(health.ok).toBe(false);
    expect(health.status).toBe("degraded");
    expect(health.checks.scheduler.ok).toBe(false);
    expect(health.checks.scheduler.lastTickAgeMs).toBe(5 * 60_000);
    expect(health.reasons.some((r) => r.includes("recording loop"))).toBe(true);
  });

  it("stays ok while a recording is in progress, even if the recording loop looks slow", async () => {
    const now = Date.now();
    const ctx = fakeContext({ scheduler: { running: true, lastTickAt: now - 5 * 60_000 }, recorder: { activeIds: () => ["r-live"] } });

    const health = await hubHealth(ctx, { now, dataDir: dataDirPath() });

    expect(health.ok).toBe(true);
    expect(health.checks.scheduler.ok).toBe(true);
    expect(health.checks.scheduler.lastTickAgeMs).toBe(5 * 60_000);
  });

  it("says ok when the scheduler has never been started (a Hub standing by on a trip)", async () => {
    const health = await hubHealth(fakeContext({ scheduler: { running: false, lastTickAt: undefined } }), { dataDir: dataDirPath() });

    expect(health.ok).toBe(true);
    expect(health.checks.scheduler).toEqual({ ok: true });
  });

  it("says degraded, and doesn't throw, when the database doesn't answer", async () => {
    const broken = fakeContext({
      db: {
        get: () => {
          throw new Error("database is locked");
        },
      },
    });

    const health = await hubHealth(broken, { dataDir: dataDirPath() });

    expect(health.ok).toBe(false);
    expect(health.checks.db.ok).toBe(false);
    expect(health.checks.db.detail).toContain("database is locked");
    expect(health.reasons.some((r) => r.includes("database"))).toBe(true);
  });

  it("says degraded when the recordings disk is nearly full", async () => {
    const health = await hubHealth(fakeContext(), {
      dataDir: dataDirPath(),
      statfs: async () => ({ bavail: 100, bsize: 4096 }),
    });

    expect(health.ok).toBe(false);
    expect(health.checks.disk.ok).toBe(false);
    expect(health.checks.disk.freeGb).toBe(0);
    expect(health.reasons.some((r) => r.includes("free"))).toBe(true);
  });

  it("says degraded, and doesn't throw, when the data folder can't be written", async () => {
    const ctx = realContext();

    const health = await hubHealth(ctx, { dataDir: path.join(tmp, "gone", "data") });

    expect(health.ok).toBe(false);
    expect(health.checks.dataDir.ok).toBe(false);
    expect(health.checks.dataDir.writable).toBe(false);
    expect(health.reasons.some((r) => r.includes("data folder"))).toBe(true);
  });

  it("answers in under a second", async () => {
    const ctx = realContext();
    ctx.scheduler.start(3_600_000);
    await ctx.scheduler.tick();

    const started = Date.now();
    const health = await hubHealth(ctx, { dataDir: dataDirPath(), now: ctx.scheduler.lastTickAt });
    expect(health.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("GET /api/health", () => {
  const options = () => ({ port: 0, host: "127.0.0.1", dataDir: dataDirPath(), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe") });

  it("answers ok with the checks beside the version and build", async () => {
    const ctx = serverContext(dataDirPath());
    ctx.scheduler.start(3_600_000);
    await ctx.scheduler.tick();
    const app = await buildServer(options(), { context: ctx, systemReport: async () => ({}) as never });
    apps.push(app);

    const res = await app.inject("/api/health");

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.version).toBe(HUB_VERSION);
    expect(body.reasons).toEqual([]);
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.scheduler.ok).toBe(true);
    expect(body.checks.disk.ok).toBe(true);
    expect(body.checks.dataDir).toEqual({ ok: true, writable: true });
  });

  it("still answers 200 when degraded, so the TV app and the update scripts keep working", async () => {
    // A stale recording loop (no recording in progress) is the one thing a restart really fixes:
    // it goes red while the Hub still serves everything else, and the version is still readable.
    const ctx = serverContext(dataDirPath());
    ctx.scheduler.start(3_600_000);
    await ctx.scheduler.tick();
    ctx.scheduler.lastTickAt = Date.now() - 5 * 60_000;
    const app = await buildServer(options(), { context: ctx, systemReport: async () => ({}) as never });
    apps.push(app);

    const res = await app.inject("/api/health");

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("degraded");
    expect(body.version).toBe(HUB_VERSION);
    expect(body.checks.scheduler.ok).toBe(false);
    expect(body.reasons.length).toBeGreaterThan(0);
  });
});

// #96 also asks for the Docker side: the image must ask /api/health without curl, and docker
// compose's HEALTHCHECK needs auto-clearing by whatever Docker restarts with. Read from the repo's
// files so a later edit can't quietly drop them.
const repoFile = (name: string) => readFile(new URL(`../../${name}`, import.meta.url), "utf8");

describe("Docker", () => {
  it("has a HEALTHCHECK in the runtime image that uses node, since the image has no curl", async () => {
    const dockerfile = await repoFile("Dockerfile");
    // The directive may be wrapped with trailing backslashes: join it into one line first.
    const joined = dockerfile.replace(/\\\r?\n\s*/g, " ");
    const line = /^HEALTHCHECK([^\n]*)$/m.exec(joined)?.[1];
    expect(line).toBeDefined();
    expect(line).toContain("node -e");
    expect(line).toContain("/api/health");
    expect(line).not.toContain("curl");
    // The slim image's node is the only thing that can make the request, and it must judge `ok`.
    expect(line).toContain("b.ok?0:1");
    expect(line).toContain("--retries=3");
    expect(line).toContain("--start-period=60s");
  });

  it("tells docker compose how often to check, and keeps the Hub restartable", async () => {
    const compose = await repoFile("docker-compose.yml");
    expect(compose).toMatch(/healthcheck:\s*\n\s*test:/);
    expect(compose).toContain("interval: 30s");
    expect(compose).toContain("timeout: 5s");
    expect(compose).toContain("retries: 3");
    expect(compose).toContain("start_period: 60s");
    // The process dying is already covered; the label is what the opt-in autoheal reads.
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("ultimatetv-autoheal");
    expect(compose).toMatch(/profiles:\s*\["?autoheal"?\]/);
  });
});
