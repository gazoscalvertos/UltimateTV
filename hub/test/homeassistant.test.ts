import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };
let requests: { url: string; body: unknown }[];
let webhookStatus: number;

const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response("", { status: webhookStatus });
}) as typeof fetch;

const WEBHOOK = "http://ha.local:8123/api/webhook/ultimatetv";
const as = (token: string) => ({ "x-device-token": token });
let tv: string;
let key: string;
const film = { key: "jellyfin:abc", kind: "film", title: "Dune", subtitle: "2021", positionMs: 61_000, durationMs: 9_360_000, credits: false };
const report = (body: unknown) => app.inject({ method: "POST", url: "/api/ha/state", headers: as(tv), payload: body as object });
/** Lets the webhook posts (sent without waiting) land. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-ha-"));
  requests = [];
  webhookStatus = 200;
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
  app = (await buildServer({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false }, { systemReport: async () => ({}) as never, context })) as never;
  tv = (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Living room" } })).json().token;
  key = (await app.inject({ url: "/api/pair/api-key", headers: as(tv) })).json().key;
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("Home Assistant both ways", () => {
  it("needs the API key to read the TV or control it, and only the TV may report", async () => {
    expect((await app.inject("/api/ha/state")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/ha/state", headers: { "x-api-key": "utv_wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/ha/command", payload: { command: "pause" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/ha/state", headers: { "x-api-key": key } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/ha/state", headers: { authorization: `Bearer ${key}` } })).statusCode).toBe(200);
    // The key can't pretend to be the TV, or change where events go.
    expect((await app.inject({ method: "POST", url: "/api/ha/state", headers: { "x-api-key": key }, payload: { status: "idle" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/api/ha/settings", headers: { "x-api-key": key }, payload: { webhookUrl: "http://evil/" } })).statusCode).toBe(401);
  });

  it("shows what the TV reported as a media player, off while the TV app isn't connected", async () => {
    expect((await report({ status: "playing", profile: { id: "p1", name: "Gary", kind: "adult" }, playing: film, volume: 80 })).statusCode).toBe(200);
    // No TV socket in this test: Home Assistant sees it as off.
    expect((await app.inject({ url: "/api/ha/state", headers: { "x-api-key": key } })).json()).toMatchObject({ state: "off", connected: false });
    type Socket = { close(): void };
    const socket = await (app as unknown as { injectWS(p: string, o: object): Promise<Socket> }).injectWS("/api/events", { headers: as(tv) });
    const s = (await app.inject({ url: "/api/ha/state", headers: { "x-api-key": key } })).json();
    expect(s).toMatchObject({ state: "playing", media_title: "Dune", media_content_type: "movie", media_position: 61, media_duration: 9360, volume_level: 0.8, profile: "Gary", connected: true });
    expect(Date.parse(s.media_position_updated_at)).toBeGreaterThan(Date.now() - 5000);
    socket.close();
    expect((await report({ status: "dancing" })).statusCode).toBe(400);
  });

  it("posts each playback event to the webhook", async () => {
    expect((await app.inject({ method: "PUT", url: "/api/ha/settings", headers: as(tv), payload: { webhookUrl: WEBHOOK } })).json().settings).toEqual({ webhookUrl: WEBHOOK });
    await report({ status: "idle", profile: { id: "p1", name: "Gary", kind: "adult" }, playing: null });
    expect((await report({ status: "playing", profile: { id: "p1", name: "Gary", kind: "adult" }, playing: film })).json()).toEqual({ ok: true, events: ["started"] });
    await report({ status: "paused", profile: { id: "p1", name: "Gary", kind: "adult" }, playing: { ...film, positionMs: 600_000 } });
    await settle();
    expect(requests.map((r) => r.url)).toEqual([WEBHOOK, WEBHOOK]);
    expect(requests[0]!.body).toMatchObject({ app: "UltimateTV", type: "started", kind: "film", title: "Dune", profile: "Gary", position: 61 });
    expect(requests[1]!.body).toMatchObject({ type: "paused", position: 600 });
    const listed = (await app.inject({ url: "/api/ha/settings", headers: as(tv) })).json().events;
    expect(listed.map((e: { type: string; sent: boolean }) => [e.type, e.sent])).toEqual([["paused", true], ["started", true]]);
  });

  it("keeps going when the webhook is down, and says so", async () => {
    await app.inject({ method: "PUT", url: "/api/ha/settings", headers: as(tv), payload: { webhookUrl: WEBHOOK } });
    webhookStatus = 404;
    expect((await report({ status: "playing", profile: null, playing: film })).statusCode).toBe(200);
    await settle();
    expect((await app.inject({ url: "/api/ha/settings", headers: as(tv) })).json().events[0]).toMatchObject({ type: "started", error: "The webhook answered 404" });
    expect((await app.inject({ method: "POST", url: "/api/ha/test", headers: as(tv) })).statusCode).toBe(502);
    webhookStatus = 200;
    expect((await app.inject({ method: "POST", url: "/api/ha/test", headers: as(tv) })).statusCode).toBe(200);
    expect(requests.at(-1)!.body).toMatchObject({ type: "started", title: "Test film", test: true });
  });

  it("hands commands to the TV app and answers with the new state", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/ha/command", headers: { "x-api-key": key }, payload: { command: "explode" } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/ha/command", headers: { "x-api-key": key }, payload: { command: "pause" } })).statusCode).toBe(409);

    type Socket = { close(): void };
    const socket = await (app as unknown as { injectWS(p: string, o: object): Promise<Socket> }).injectWS("/api/events", { headers: as(tv) });
    // Play the TV app's part: answer the "ha" call as phone.ts would.
    const calls: unknown[] = [];
    const off = app.hub.events.on((e: HubEvent) => {
      if (e.type !== "tv.call" || e.method !== "ha") return;
      calls.push(e.args);
      void report({ status: "paused", profile: null, playing: film }).then(() => app.inject({ method: "POST", url: `/api/tv/reply/${e.id}`, headers: as(tv), payload: { result: { ok: true } } }));
    });
    const res = await app.inject({ method: "POST", url: "/api/ha/command", headers: { "x-api-key": key }, payload: { command: "media_pause" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: { state: "paused", media_title: "Dune" } });
    await app.inject({ method: "POST", url: "/api/ha/command", headers: { "x-api-key": key }, payload: { command: "volume_set", value: 0.3 } });
    expect(calls).toEqual([{ command: "pause" }, { command: "volume_set", value: 0.3 }]);
    off();
    socket.close();
  });
});
