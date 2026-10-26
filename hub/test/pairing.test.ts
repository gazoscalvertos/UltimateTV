import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeviceList } from "@ultimatetv/shared";
import { cleanCode } from "../src/pairing.js";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance;

const start = async (pairing?: boolean) => {
  app = await buildServer(
    { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false, ...(pairing === undefined ? {} : { pairing }) },
    { systemReport: async () => ({}) as never },
  );
};
const as = (token: string) => ({ "x-device-token": token });
const pairTv = async () => (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Living room" } })).json().token as string;
const pairPhone = async (tv: string, name = "Gary's phone") => {
  const { code } = (await app.inject({ url: "/api/pair/code", headers: as(tv) })).json();
  return (await app.inject({ method: "POST", url: "/api/pair", payload: { code, name } })).json().token as string;
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-pair-"));
  await start();
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("pairing phones and screens", () => {
  it("turns away control from anything unpaired, but leaves browsing open", async () => {
    const key = await app.inject({ method: "POST", url: "/api/remote/key", payload: { action: "ok" } });
    expect(key.statusCode).toBe(401);
    expect(key.json()).toMatchObject({ code: "pair" });
    for (const [method, url] of [["POST", "/api/tv/call/now"], ["POST", "/api/flash"], ["POST", "/api/notify"], ["PUT", "/api/settings"], ["POST", "/api/software/hub/update"], ["POST", "/api/box/update"], ["GET", "/api/devices"]] as const) {
      expect((await app.inject({ method, url, payload: {} })).statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect((await app.inject("/api/channels")).statusCode).toBe(200);
    expect((await app.inject("/api/pair")).json()).toMatchObject({ paired: false, enforced: true });
  });

  it("trusts the first screen and makes the next one wait to be let in", async () => {
    const first = await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Living room" } });
    expect(first.statusCode).toBe(200);
    const tv = first.json().token as string;
    expect(first.headers["set-cookie"]).toMatch(/^utv_device=.+HttpOnly; SameSite=Strict/);
    expect((await app.inject({ url: "/api/pair", headers: as(tv) })).json()).toMatchObject({ paired: true, device: { name: "Living room", kind: "tv" } });

    const second = await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Laptop" } });
    expect(second.statusCode).toBe(202);
    const { pending, secret } = second.json();
    expect(pending.code).toMatch(/^[A-Z2-9]{4}$/);
    expect((await app.inject({ method: "POST", url: `/api/pair/screen/${pending.id}`, payload: { secret } })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: `/api/pair/screen/${pending.id}`, payload: { secret: "guess" } })).statusCode).toBe(404);

    const list = (await app.inject({ url: "/api/devices", headers: as(tv) })).json<DeviceList>();
    expect(list.pending).toEqual([expect.objectContaining({ id: pending.id, name: "Laptop", code: pending.code })]);
    expect(JSON.stringify(list)).not.toContain(secret);
    expect((await app.inject({ method: "POST", url: `/api/devices/pending/${pending.id}`, headers: as(tv) })).statusCode).toBe(200);

    const collected = await app.inject({ method: "POST", url: `/api/pair/screen/${pending.id}`, payload: { secret } });
    expect(collected.statusCode).toBe(200);
    const laptop = collected.json().token as string;
    expect((await app.inject({ method: "POST", url: "/api/tv/reply/x", headers: as(laptop), payload: {} })).statusCode).toBe(200);
    // Collected once only.
    expect((await app.inject({ method: "POST", url: `/api/pair/screen/${pending.id}`, payload: { secret } })).statusCode).toBe(404);
  });

  it("can turn a waiting screen away", async () => {
    const tv = await pairTv();
    const { pending, secret } = (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Stranger" } })).json();
    await app.inject({ method: "DELETE", url: `/api/devices/pending/${pending.id}`, headers: as(tv) });
    expect((await app.inject({ method: "POST", url: `/api/pair/screen/${pending.id}`, payload: { secret } })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/devices", headers: as(tv) })).json<DeviceList>().devices).toHaveLength(1);
  });

  it("pairs a phone with the TV's code, once, and lets it control the TV but not act as it", async () => {
    const tv = await pairTv();
    const code = (await app.inject({ url: "/api/pair/code", headers: as(tv) })).json();
    expect(code.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(code.url).toContain(`/remote/?pair=${code.code}`);
    // The QR code is the TV's alone: it carries the code.
    expect((await app.inject("/api/remote/qr.svg")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/remote/qr.svg", headers: as(tv) })).body).toContain("<svg");

    // Typed with a dash and in lower case, as people do.
    const typed = `${code.code.slice(0, 4).toLowerCase()}-${code.code.slice(4)}`;
    const res = await app.inject({ method: "POST", url: "/api/pair", payload: { code: typed, name: "Gary's phone" } });
    expect(res.statusCode).toBe(200);
    const phone = res.json().token as string;
    expect((await app.inject({ method: "POST", url: "/api/pair", payload: { code: code.code, name: "Again" } })).statusCode).toBe(403);

    expect((await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "ok" } })).statusCode).toBe(200);
    // The cookie works as well as the header (the phone's browser).
    expect((await app.inject({ method: "POST", url: "/api/remote/key", headers: { cookie: `other=1; utv_device=${phone}` }, payload: { action: "ok" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/tv/reply/x", headers: as(phone), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/pair/code", headers: as(phone) })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/devices", headers: as(phone) })).json<DeviceList>()).toMatchObject({ devices: [{ kind: "tv" }, { kind: "phone", name: "Gary's phone" }] });
  });

  it("throws the code away after too many wrong guesses", async () => {
    const tv = await pairTv();
    const { code } = (await app.inject({ url: "/api/pair/code", headers: as(tv) })).json();
    for (let i = 0; i < 8; i++) expect((await app.inject({ method: "POST", url: "/api/pair", payload: { code: "AAAAAAAA" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/pair", payload: { code } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/pair/code", headers: as(tv) })).json().code).not.toBe(code);
  });

  it("cuts a device off when it's removed", async () => {
    const tv = await pairTv();
    const phone = await pairPhone(tv);
    const { devices } = (await app.inject({ url: "/api/devices", headers: as(tv) })).json<DeviceList>();
    const id = devices.find((d) => d.kind === "phone")!.id;
    expect((await app.inject({ method: "PATCH", url: `/api/devices/${id}`, headers: as(tv), payload: { name: "Kitchen tablet" } })).json()).toMatchObject({ name: "Kitchen tablet" });
    expect((await app.inject({ method: "DELETE", url: `/api/devices/${id}`, headers: as(tv) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/remote/key", headers: as(phone), payload: { action: "ok" } })).statusCode).toBe(401);
  });

  it("gives scripts a key for pop-ups, flashes and keys, and nothing else", async () => {
    const tv = await pairTv();
    const { key } = (await app.inject({ url: "/api/pair/api-key", headers: as(tv) })).json();
    expect(key).toMatch(/^utv_/);
    expect((await app.inject({ method: "POST", url: "/api/notify", headers: { authorization: `Bearer ${key}` }, payload: { title: "Doorbell" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/flash", headers: { "x-api-key": key }, payload: { text: "Tea's ready" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/remote/key", headers: { "x-api-key": key }, payload: { action: "pause" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/settings", headers: { "x-api-key": key }, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/tv/call/now", headers: { "x-api-key": key }, payload: {} })).statusCode).toBe(401);
    // A new key retires the old one.
    const { key: next } = (await app.inject({ method: "POST", url: "/api/pair/api-key", headers: as(tv) })).json();
    expect(next).not.toBe(key);
    expect((await app.inject({ method: "POST", url: "/api/notify", headers: { "x-api-key": key }, payload: { title: "Old" } })).statusCode).toBe(401);
  });

  it("lets only a paired screen listen to the TV's events", async () => {
    const tv = await pairTv();
    const phone = await pairPhone(tv);
    type Socket = { close(): void; once(e: string, f: (d: unknown) => void): void; on(e: string, f: (d: unknown) => void): void };
    const ws = app as unknown as { injectWS(path: string, opts?: { headers?: Record<string, string> }, hooks?: { onInit(s: Socket): void }): Promise<Socket> };
    // Anything else only hears "reload" (an old TV app picks up the one that pairs), then is cut off.
    for (const headers of [{}, as(phone)]) {
      const heard: string[] = [];
      let closed: Promise<unknown> = Promise.resolve();
      await ws.injectWS("/api/events", { headers }, {
        onInit: (other) => {
          other.on("message", (m) => heard.push(String(m)));
          closed = new Promise((r) => other.once("close", r));
        },
      });
      expect(await closed).toBe(4401);
      expect(heard.map((m) => JSON.parse(m))).toEqual([{ type: "box.command", command: "reload" }]);
    }
    const socket = await ws.injectWS("/api/events", { headers: as(tv) });
    const closed = new Promise((r) => socket.once("close", r));
    // Removing the TV closes its socket.
    const { devices } = (await app.inject({ url: "/api/devices", headers: as(phone) })).json<DeviceList>();
    await app.inject({ method: "DELETE", url: `/api/devices/${devices.find((d) => d.kind === "tv")!.id}`, headers: as(phone) });
    expect(await closed).toBe(4401);
  });

  it("can be turned off with PAIRING=off", async () => {
    await app.close();
    await start(false);
    expect((await app.inject({ method: "POST", url: "/api/remote/key", payload: { action: "ok" } })).statusCode).toBe(200);
    expect((await app.inject("/api/pair")).json()).toMatchObject({ paired: true, enforced: false });
  });

  it("reads codes however they're written", () => {
    expect(cleanCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(cleanCode(" AbCd EfGh ")).toBe("ABCDEFGH");
    expect(cleanCode("http://192.168.0.19:8095/remote/?pair=ABCDEFGH")).toBe("ABCDEFGH");
  });
});
