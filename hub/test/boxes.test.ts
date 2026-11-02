// More than one TV box (#103). A box is a paired screen of kind "tv". Before this the Hub kept one
// of everything, so a bedroom phone's key press went to whichever TV happened to hear it. What these
// tests hold down: the list of boxes and which are on, that a targeted key press reaches that box and
// no other, that the last box still works exactly as before when nobody says which, and that what the
// TV reports per box (Home Assistant's view, the phone's now-playing) stays apart.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HaState, HubEvent, TvBox } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance;
let living: string;
let bedroom: string;
let phone: string;
const sockets: { close(): void }[] = [];

const as = (token: string) => ({ "x-device-token": token });

/** Pairs the first TV: it is let in at once, being the first screen. */
const pairFirstTv = async (name: string): Promise<string> =>
  (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name } })).json().token as string;

/**
 * Pairs a further box the way a second room does it: the screen asks, waits holding a secret, an
 * already paired device lets it in, then it collects its key.
 */
const pairAnotherTv = async (by: string, name: string): Promise<string> => {
  const asked = await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name } });
  expect(asked.statusCode).toBe(202);
  const { pending, secret } = asked.json();
  // It keeps being told to wait until someone says yes.
  const waiting = await app.inject({ method: "POST", url: `/api/pair/screen/${pending.id}`, payload: { secret } });
  expect(waiting.statusCode).toBe(202);
  expect((await app.inject({ method: "POST", url: `/api/devices/pending/${pending.id}`, headers: as(by) })).statusCode).toBe(200);
  const got = await app.inject({ method: "POST", url: `/api/pair/screen/${pending.id}`, payload: { secret } });
  expect(got.statusCode).toBe(200);
  return got.json().token as string;
};

const pairPhone = async (tv: string, name = "Gary's phone"): Promise<string> => {
  const { code } = (await app.inject({ url: "/api/pair/code", headers: as(tv) })).json();
  return (await app.inject({ method: "POST", url: "/api/pair", payload: { code, name } })).json().token as string;
};

/** Opens a TV app's event socket and collects everything it hears. */
const watch = async (token: string): Promise<HubEvent[]> => {
  const heard: HubEvent[] = [];
  let socket!: { close(): void };
  socket = await (
    app as unknown as { injectWS(p: string, o: object, h: object): Promise<{ close(): void }> }
  ).injectWS("/api/events", { headers: as(token) }, { onInit: (s: { on(e: string, f: (m: unknown) => void): void }) => {
    s.on("message", (m) => heard.push(JSON.parse(String(m)) as HubEvent));
  } });
  sockets.push(socket);
  // A socket isn't counted until its handler has run.
  await settle();
  return heard;
};

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const boxes = async (): Promise<{ boxes: TvBox[]; main: string | null; me: string | null }> =>
  (await app.inject({ url: "/api/boxes", headers: as(phone) })).json();

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-boxes-"));
  app = await buildServer(
    { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
    { systemReport: async () => ({}) as never },
  );
  living = await pairFirstTv("Living room");
  bedroom = await pairAnotherTv(living, "Bedroom");
  phone = await pairPhone(living);
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("more than one TV box", () => {
  it("lists every box with its name and whether it's on", async () => {
    const off = await boxes();
    expect(off.boxes.map((b) => b.name).sort()).toEqual(["Bedroom", "Living room"]);
    expect(off.boxes.every((b) => !b.online)).toBe(true);
    // The main box is the one set up first, so adding a box never moves everything to the new one.
    const livingId = off.boxes.find((b) => b.name === "Living room")!.id;
    expect(off.main).toBe(livingId);
    // A phone is never a box of its own.
    expect(off.me).toBe(null);

    const livingHeard = await watch(living);
    const after = await boxes();
    expect(after.boxes.find((b) => b.name === "Living room")!.online).toBe(true);
    expect(after.boxes.find((b) => b.name === "Bedroom")!.online).toBe(false);
    // Online boxes come first in the list, so the picker shows the usable one at the top.
    expect(after.boxes[0]!.name).toBe("Living room");
    expect(after.main).toBe(livingId);
    expect(livingHeard.map((e) => e.type)).toContain("hello");
  });

  it("tells the phone which box names it, since a phone never is one", async () => {
    const res = await app.inject({ url: "/api/boxes", headers: as(bedroom) });
    const me = res.json() as { me: string | null; boxes: TvBox[] };
    expect(me.me).toBe(me.boxes.find((b) => b.name === "Bedroom")!.id);
  });

  it("puts a key press on the box that was asked for, and only that one", async () => {
    const livingHeard = await watch(living);
    const bedroomHeard = await watch(bedroom);
    const bedroomId = (await boxes()).boxes.find((b) => b.name === "Bedroom")!.id;

    expect((await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "ok", box: bedroomId } })).statusCode).toBe(200);
    await settle();
    const keys = (heard: HubEvent[]) => heard.filter((e) => e.type === "remote.key").map((e) => (e as { action: string }).action);
    expect(keys(bedroomHeard)).toEqual(["ok"]);
    expect(keys(livingHeard)).toEqual([]);

    // A box named the way people say it works too: the phone's picker used to send names.
    await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "back", box: "living room" } });
    await settle();
    expect(keys(livingHeard)).toEqual(["back"]);
    expect(keys(bedroomHeard)).toEqual(["ok"]);
  });

  it("sends a press with nothing said to the main box, as it always did", async () => {
    const livingHeard = await watch(living);
    const bedroomHeard = await watch(bedroom);
    await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "guide" } });
    await settle();
    expect(livingHeard.filter((e) => e.type === "remote.key")).toHaveLength(1);
    expect(bedroomHeard.filter((e) => e.type === "remote.key")).toHaveLength(0);
  });

  it("can reach every box at once when it means to", async () => {
    const livingHeard = await watch(living);
    const bedroomHeard = await watch(bedroom);
    await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "home", box: "all" } });
    await settle();
    for (const heard of [livingHeard, bedroomHeard]) {
      expect(heard.filter((e) => e.type === "remote.key").map((e) => (e as { action: string }).action)).toEqual(["home"]);
    }
  });

  it("takes a pop-up, a news flash and a sleep timer to one room", async () => {
    const livingHeard = await watch(living);
    const bedroomHeard = await watch(bedroom);
    const bedroomId = (await boxes()).boxes.find((b) => b.name === "Bedroom")!.id;
    await app.inject({ method: "POST", url: "/api/notify", headers: as(phone), payload: { kind: "info", text: "Tea's ready", box: bedroomId } });
    await app.inject({ method: "POST", url: "/api/flash", headers: as(phone), payload: { text: "Train delayed", box: bedroomId } });
    await app.inject({ method: "POST", url: "/api/tv/sleep", headers: as(phone), payload: { minutes: 30, box: bedroomId } });
    await settle();
    const types = (heard: HubEvent[]) => heard.map((e) => e.type).filter((t) => t !== "hello" && t !== "boxes.changed");
    expect(types(bedroomHeard)).toEqual(["notice", "flash", "sleep"]);
    expect(types(livingHeard)).toEqual([]);
    // The notice carries the box, so the TV can say which room it was meant for.
    expect((bedroomHeard.find((e) => e.type === "notice") as { box?: string }).box).toBe(bedroomId);
  });

  it("keeps each box's now-playing apart for the phone", async () => {
    await watch(living);
    await watch(bedroom);
    const bedroomId = (await boxes()).boxes.find((b) => b.name === "Bedroom")!.id;
    const film = { key: "jellyfin:abc", kind: "film", title: "Dune", subtitle: "2021", positionMs: 61_000, durationMs: 9_360_000, credits: false };
    await app.inject({ method: "POST", url: "/api/ha/state", headers: as(bedroom), payload: { status: "playing", playing: film, profile: null } });
    await app.inject({ method: "POST", url: "/api/ha/state", headers: as(living), payload: { status: "idle", playing: null, profile: null } });
    const forBedroom = (await app.inject({ url: `/api/remote/now?box=${bedroomId}&wait=0`, headers: as(phone) })).json() as { state: HaState };
    const forLiving = (await app.inject({ url: "/api/remote/now?wait=0", headers: as(phone) })).json() as { state: HaState };
    expect(forBedroom.state).toMatchObject({ state: "playing", media_title: "Dune" });
    expect(forLiving.state.state).toBe("idle");
    expect(forBedroom.state.connected).toBe(true);
  });

  it("remembers a renamed box, since the name is what people pick", async () => {
    const bedroomId = (await boxes()).boxes.find((b) => b.name === "Bedroom")!.id;
    expect((await app.inject({ method: "PATCH", url: `/api/devices/${bedroomId}`, headers: as(phone), payload: { name: "Spare room" } })).statusCode).toBe(200);
    const heard = await watch(bedroom);
    await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "left", box: "spare room" } });
    await settle();
    expect(heard.filter((e) => e.type === "remote.key")).toHaveLength(1);
  });

  it("still lets the second box go when it is unpaired", async () => {
    const bedroomId = (await boxes()).boxes.find((b) => b.name === "Bedroom")!.id;
    const heard = await watch(bedroom);
    await settle();
    expect((await app.inject({ method: "DELETE", url: `/api/devices/${bedroomId}`, headers: as(phone) })).statusCode).toBe(200);
    await settle(60);
    expect((await boxes()).boxes.map((b) => b.name)).toEqual(["Living room"]);
    // Its socket was cut off, so nothing more reaches it.
    await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "ok", box: "Bedroom" } });
    await settle();
    expect(heard.filter((e) => e.type === "remote.key")).toHaveLength(0);
  });
});
