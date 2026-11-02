// A paired phone can wait for the TV's playback state instead of asking over and over: issue #109's
// lock-screen controls must not poll. These tests cover the wait itself (it ends when the Hub has
// news, or after the few seconds the phone asked for) and the route around it: who may ask, what
// it answers with, the bump when the TV reports, and that a junk report changes nothing.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_WAIT_MS, PhoneNow } from "../src/phonenow.js";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance;
let tv: string;
let phone: string;

const as = (token: string) => ({ "x-device-token": token });
const pairTv = async () => (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Living room" } })).json().token as string;
const pairPhone = async (token: string, name = "Gary's phone") => {
  const { code } = (await app.inject({ url: "/api/pair/code", headers: as(token) })).json();
  return (await app.inject({ method: "POST", url: "/api/pair", payload: { code, name } })).json().token as string;
};
/** The phone asking: `wait=0` is "tell me now", as tests about the answer rather than the wait want. */
const now = (token: string, query = "?wait=0") => app.inject({ url: `/api/remote/now${query}`, headers: as(token) });
const report = (body: unknown) => app.inject({ method: "POST", url: "/api/ha/state", headers: as(tv), payload: body as object });
const film = { key: "jellyfin:abc", kind: "film", title: "Dune", subtitle: "2021", positionMs: 61_000, durationMs: 9_360_000, artwork: "/art/dune.svg", credits: false };
const playing = () => report({ status: "playing", profile: { id: "p1", name: "Gary", kind: "adult" }, playing: film, volume: 80 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-phonenow-"));
  app = await buildServer(
    { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
    { systemReport: async () => ({}) as never },
  );
  tv = await pairTv();
  phone = await pairPhone(tv);
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("waiting for the TV's playback state", () => {
  it("turns away a phone that hasn't paired", async () => {
    expect((await app.inject("/api/remote/now")).statusCode).toBe(401);
    // The API key is for scripts, not for a phone waiting on the TV.
    expect((await app.inject({ url: "/api/remote/now", headers: { "x-api-key": "utv_wrong" } })).statusCode).toBe(401);
  });

  it("answers a paired phone at once, with the sequence to ask from next time", async () => {
    const res = await now(phone);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toMatchObject({ seq: 0, state: { state: "off", connected: false } });
    expect(typeof res.json().seq).toBe("number");
  });

  it("bumps the sequence when the TV reports, and carries what it's playing", async () => {
    expect((await now(phone)).json().seq).toBe(0);
    // The TV app's event socket: without it the Hub reports the TV as off, whatever it last said.
    const socket = await (app as unknown as { injectWS(p: string, o: object): Promise<{ close(): void }> }).injectWS("/api/events", { headers: as(tv) });
    expect((await playing()).statusCode).toBe(200);
    const res = await now(phone);
    expect(res.json().seq).toBe(1);
    expect(res.json().state).toMatchObject({ state: "playing", media_title: "Dune", entity_picture: "/art/dune.svg", connected: true });
    socket.close();
  });

  it("holds the phone's request until the TV reports, then answers", async () => {
    const since = (await now(phone)).json().seq;
    const started = Date.now();
    const waiting = now(phone, `?since=${since}&wait=5000`);
    await sleep(100);
    await playing();
    const res = await waiting;
    const took = Date.now() - started;
    expect(res.statusCode).toBe(200);
    expect(res.json().seq).toBeGreaterThan(since);
    // Woken by the report, not by the 5 seconds running out, and not before it was asked for.
    expect(took).toBeGreaterThanOrEqual(20);
    expect(took).toBeLessThan(2000);
  });

  it("answers at once when the phone is already behind", async () => {
    await playing();
    const started = Date.now();
    const res = await now(phone, "?since=0&wait=5000");
    expect(res.statusCode).toBe(200);
    expect(res.json().seq).toBeGreaterThan(0);
    // No waiting: the state moved on since the phone last asked.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("holds an idle Hub's request for about as long as the phone asked, then answers anyway", async () => {
    const since = (await now(phone)).json().seq;
    const started = Date.now();
    const res = await now(phone, `?since=${since}&wait=300`);
    const took = Date.now() - started;
    expect(res.statusCode).toBe(200);
    // The phone's next question is not answered before it asked for it, and not after 5 seconds either.
    expect(took).toBeGreaterThanOrEqual(100);
    expect(took).toBeLessThan(2000);
    expect(res.json()).toMatchObject({ seq: since, state: { state: "off" } });
  });

  it("answers 400 to a junk report and leaves the sequence alone", async () => {
    await playing();
    const seq = (await now(phone)).json().seq;
    expect((await report({ status: "dancing" })).statusCode).toBe(400);
    expect((await now(phone)).json().seq).toBe(seq);
  });

  it("keeps the sequence going up, once per report", async () => {
    const first = (await now(phone)).json().seq;
    await playing();
    const second = (await now(phone)).json().seq;
    await report({ status: "paused", profile: null, playing: { ...film, positionMs: 600_000 } });
    const third = (await now(phone)).json().seq;
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });
});

describe("the wait itself", () => {
  it("gives up after about the time it was given", async () => {
    const p = new PhoneNow();
    const started = Date.now();
    await p.waitFor(p.current, 30);
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(20);
    expect(took).toBeLessThan(1000);
  });

  it("doesn't wait when the phone is already behind", async () => {
    const p = new PhoneNow();
    p.bump();
    const started = Date.now();
    await p.waitFor(p.current - 1, 30);
    expect(Date.now() - started).toBeLessThan(10);
  });

  it("wakes a waiter when the TV reports", async () => {
    const p = new PhoneNow();
    const started = Date.now();
    let woke = false;
    const waiting = p.waitFor(p.current, MAX_WAIT_MS).then(() => {
      woke = true;
    });
    await sleep(30);
    expect(woke).toBe(false);
    p.bump();
    await waiting;
    expect(woke).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("holds for the longest wait asked for, however silly the number, and not a moment longer than that", async () => {
    const p = new PhoneNow();
    let woke = false;
    const waiting = p.waitFor(p.current, Number.POSITIVE_INFINITY).then(() => {
      woke = true;
    });
    // A non-finite wait is the full MAX_WAIT_MS, never "no wait at all".
    await sleep(50);
    expect(woke).toBe(false);
    p.bump();
    await waiting;
    expect(woke).toBe(true);
    // A wait of below zero is no wait: it must not hang the phone's request.
    const started = Date.now();
    await p.waitFor(p.current, -5);
    expect(Date.now() - started).toBeLessThan(50);
  });
});
