// Restarts are counted, and raise an alert when they repeat (#96's third criterion).
// A Hub that Docker (or autoheal) keeps restarting is a Hub nobody notices is broken: the count
// lives in the database, so it survives the restart that made it.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { DEFAULT_ALERT_SETTINGS } from "@ultimatetv/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentAlerts } from "../src/alerts.js";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { BOOTS_KEY, REPEAT_RESTARTS, RESTART_WINDOW_MS, recentBoots, recordBoot, restartAlert, restartCount } from "../src/restarts.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

const now = Date.parse("2026-11-20T12:00:00Z");
const hour = 3_600_000;

let tmp: string;
let app: FastifyInstance & { hub: HubContext };
let contexts: HubContext[];
let requests: { url: string; init?: RequestInit }[];

const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(url), ...(init ? { init } : {}) });
  return new Response("", { status: 200 });
}) as typeof fetch;

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-restarts-"));
  contexts = [];
  requests = [];
});

afterEach(async () => {
  await app?.close();
  for (const ctx of contexts) ctx.close();
  await rm(tmp, { recursive: true, force: true });
});

/** A real Hub in a temporary folder, with its own database. */
function realContext(): HubContext {
  const ctx = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, ytdlp: null });
  contexts.push(ctx);
  return ctx;
}

describe("counting restarts", () => {
  it("counts the boots inside the window and forgets the older ones", () => {
    const boots = [now - 9 * hour, now - 2 * hour, now - hour, now];
    expect(recentBoots(boots, now)).toEqual([now - 2 * hour, now - hour, now]);
    // Three boots in the window is two restarts: the last one is the Hub that's running now.
    expect(restartCount(boots, now)).toBe(2);
    expect(restartCount([], now)).toBe(0);
  });

  it("records this boot in the database, where it survives the next restart", () => {
    const ctx = realContext();
    expect(recordBoot(ctx.db, now)).toEqual([now]);
    expect(ctx.db.getKv(BOOTS_KEY)).toEqual([now]);
    expect(recordBoot(ctx.db, now + hour)).toEqual([now, now + hour]);
    // Boots that fell out of the window go when the next one is written.
    const later = now + RESTART_WINDOW_MS + 2 * hour;
    expect(recordBoot(ctx.db, later)).toEqual([later]);
  });
});

describe("the restart alert", () => {
  it("says nothing about a one-off restart", () => {
    expect(restartAlert([], now)).toBeNull();
    expect(restartAlert([now], now)).toBeNull();
    expect(restartAlert([now - hour, now], now)).toBeNull();
  });

  it("warns once restarts repeat, and goes bad when they're a loop", () => {
    const repeating = [now - 3 * hour, now - 2 * hour, now - hour, now];
    expect(restartCount(repeating, now)).toBe(REPEAT_RESTARTS);
    const warn = restartAlert(repeating, now);
    expect(warn).toMatchObject({ key: "hub-restarts", level: "warn", title: "The Hub keeps restarting" });
    expect(warn!.message).toContain(`restarted ${REPEAT_RESTARTS} times`);
    expect(warn!.message).toContain("6 hours");

    // Two restarts an hour, every hour: well inside the window and well past the threshold.
    const looping = Array.from({ length: REPEAT_RESTARTS * 2 + 1 }, (_, i) => now - i * (hour / 2));
    expect(restartAlert(looping, now)!.level).toBe("bad");
  });

  it("clears by itself once the restarts are long enough ago", () => {
    const boots = [now - 3 * hour, now - 2 * hour, now - hour, now];
    expect(restartAlert(boots, now + RESTART_WINDOW_MS + hour)).toBeNull();
  });

  it("is listed with the other alerts, and only when there have been restarts", () => {
    const base = { now, settings: { ...DEFAULT_ALERT_SETTINGS }, iptv: [], events: [] };
    expect(currentAlerts(base).map((a) => a.key)).not.toContain("hub-restarts");
    const boots = [now - 3 * hour, now - 2 * hour, now - hour, now];
    expect(currentAlerts({ ...base, boots }).map((a) => a.key)).toContain("hub-restarts");
  });
});

describe("on a real Hub", () => {
  it("raises the alert once and sends it, then keeps it listed", async () => {
    const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
    app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
    await pairAsTv(app);
    await app.inject({ method: "PUT", url: "/api/alerts/settings", payload: { ntfyUrl: "https://ntfy.sh/our-tv" } });
    // The alert is checked against the real clock, so these are real times: four boots, three restarts.
    const live = Date.now();
    app.hub.db.setKv(BOOTS_KEY, [live - 3 * hour, live - 2 * hour, live - hour, live]);

    const state = (await app.inject({ method: "POST", url: "/api/alerts/check" })).json();
    const alert = state.alerts.find((a: { key: string }) => a.key === "hub-restarts");
    expect(alert).toMatchObject({ level: "warn" });
    expect(requests.filter((r) => r.url.includes("ntfy"))).toHaveLength(1);

    // It's the same problem next time round: listed, not sent again.
    await app.inject({ method: "POST", url: "/api/alerts/check" });
    expect(requests.filter((r) => r.url.includes("ntfy"))).toHaveLength(1);
  });
});
