// The Hub's Bluetooth routes (#102): Bluetooth lives on the box, so these only carry the question
// to the TV app and the answer back. What matters is who may ask (grown-ups only, since it's a
// household change), what happens when the TV isn't on (a clear "is the box on?" rather than a
// broken screen), and that junk in and junk out never reach the phone as if they were real.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BtState, HubEvent, Profile } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance;
let tv: string;
let phone: string;
let socket: { close(): void } | null = null;

const as = (token: string) => ({ "x-device-token": token });
const pairTv = async () => (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Living room" } })).json().token as string;
const pairPhone = async (token: string, name = "Gary's phone") => {
  const { code } = (await app.inject({ url: "/api/pair/code", headers: as(token) })).json();
  return (await app.inject({ method: "POST", url: "/api/pair", payload: { code, name } })).json().token as string;
};

const headphones: BtState = {
  available: true,
  powered: true,
  scanning: false,
  devices: [
    { address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4", kind: "headphones", paired: true, connected: true, trusted: true },
    { address: "3C:2E:FF:11:22:33", name: "Xbox Wireless Controller", kind: "controller", paired: false, connected: false, trusted: false },
  ],
  output: { kind: "bluetooth", address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4" },
  delayMs: 40,
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-bluetooth-"));
  app = await buildServer(
    { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
    { systemReport: async () => ({}) as never },
  );
  tv = await pairTv();
  phone = await pairPhone(tv);
});

afterEach(async () => {
  socket?.close();
  socket = null;
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

/** Brings the TV app online: the box answers these calls, so nothing works without it. */
const connectTv = async (): Promise<void> => {
  socket = await (app as unknown as { injectWS(p: string, o: object): Promise<{ close(): void }> }).injectWS("/api/events", { headers: as(tv) });
  // The call route only needs a socket on the books; give it a turn to be counted.
  await new Promise((r) => setTimeout(r, 50));
};

/** Plays the TV app's part: answers the next `tv.call` with `result`, as ui/src/phone.ts does. */
const answerNext = (result: unknown) => {
  const off = app.hub.events.on((e: HubEvent) => {
    if (e.type !== "tv.call" || e.id === undefined) return;
    void app.inject({ method: "POST", url: `/api/tv/reply/${e.id}`, headers: as(tv), payload: { result } });
  });
  return off;
};

describe("Bluetooth routes", () => {
  it("turns away a screen that hasn't paired", async () => {
    expect((await app.inject("/api/bluetooth")).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/bluetooth", payload: { do: "scan", on: true } })).statusCode).toBe(401);
  });

  it("says the box is off rather than failing when no TV is connected", async () => {
    const res = await app.inject({ url: "/api/bluetooth", headers: as(tv) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, output: { kind: "tv" }, devices: [] });
    expect(res.json().reason).toMatch(/TV box/);
    // Changing something can't be pretended: it says why.
    const post = await app.inject({ method: "POST", url: "/api/bluetooth", headers: as(tv), payload: { do: "scan", on: true } });
    expect(post.statusCode).toBe(409);
    expect(post.json().code).toBe("tv-off");
  });

  it("asks the TV for the state and hands the answer back", async () => {
    await connectTv();
    const done = answerNext(headphones);
    const res = await app.inject({ url: "/api/bluetooth", headers: as(tv) });
    done();
    expect(res.statusCode).toBe(200);
    const got = res.json() as BtState;
    expect(got).toMatchObject({ scanning: false, delayMs: 40, output: { kind: "bluetooth", name: "WH-1000XM4" } });
    expect(got.devices.map((d) => d.name)).toEqual(["WH-1000XM4", "Xbox Wireless Controller"]);
  });

  it("passes an action through to the TV unchanged", async () => {
    await connectTv();
    let asked: unknown = null;
    const off = app.hub.events.on((e: HubEvent) => {
      if (e.type !== "tv.call" || e.id === undefined) return;
      asked = e.args;
      void app.inject({ method: "POST", url: `/api/tv/reply/${e.id}`, headers: as(tv), payload: { result: { ...headphones, scanning: true } } });
    });
    const res = await app.inject({ method: "POST", url: "/api/bluetooth", headers: as(tv), payload: { do: "scan", on: true } });
    off?.();
    expect(asked).toEqual({ do: "scan", on: true });
    expect(res.json().scanning).toBe(true);
  });

  it("refuses an action that isn't a Bluetooth action at all", async () => {
    const res = await app.inject({ method: "POST", url: "/api/bluetooth", headers: as(tv), payload: { do: "rm -rf /", address: "not a mac" } });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a pair without a real Bluetooth address", async () => {
    const res = await app.inject({ method: "POST", url: "/api/bluetooth", headers: as(tv), payload: { do: "pair", address: "Living room speaker" } });
    expect(res.statusCode).toBe(400);
  });

  it("carries an odd answer from the TV through as a 502, not as real state", async () => {
    await connectTv();
    const done = answerNext({ nonsense: true });
    const res = await app.inject({ url: "/api/bluetooth", headers: as(tv) });
    done();
    expect(res.statusCode).toBe(502);
  });

  it("keeps a Kids profile's hands off it", async () => {
    // A Kids profile is a paired screen too, but Bluetooth is a household change.
    const kid = (await app.inject({ method: "POST", url: "/api/profiles", headers: as(tv), payload: { name: "Sam", kind: "kids" } })).json() as Profile;
    const kidToken = (await app.inject({ method: "POST", url: `/api/profiles/${kid.id}/unlock`, headers: as(tv), payload: {} })).json().token as string;
    const res = await app.inject({ method: "POST", url: "/api/bluetooth", headers: { ...as(tv), "x-profile-token": kidToken }, payload: { do: "useTv" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("pin");
  });
});
