import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientFeatureState, DeviceFeatures } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance;

const start = async () => {
  app = await buildServer(
    { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
    { systemReport: async () => ({}) as never },
  );
};
const as = (token: string) => ({ "x-device-token": token });
const pairTv = async () => (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Living room" } })).json().token as string;
/** A second screen asks, the first lets it in, and it collects its token. */
const pairSecondTv = async (first: string, name = "Desktop") => {
  const asked = (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name } })).json();
  await app.inject({ method: "POST", url: `/api/devices/pending/${asked.pending.id}`, headers: as(first) });
  return (await app.inject({ method: "POST", url: `/api/pair/screen/${asked.pending.id}`, payload: { secret: asked.secret } })).json().token as string;
};
const pairPhone = async (tv: string) => {
  const { code } = (await app.inject({ url: "/api/pair/code", headers: as(tv) })).json();
  return (await app.inject({ method: "POST", url: "/api/pair", payload: { code, name: "Phone" } })).json().token as string;
};
const features = async (token: string, client: string) => (await app.inject({ url: `/api/features?client=${client}`, headers: as(token) })).json() as ClientFeatureState;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-features-"));
  await start();
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("features per screen", () => {
  it("has everything on until something is switched off", async () => {
    const tv = await pairTv();
    const st = await features(tv, "box");
    expect(st.off).toEqual([]);
    expect(st.client).toBe("box");
    expect(st.device).toBeTruthy();
    expect(st.features.length).toBeGreaterThan(5);
  });

  it("switches a feature off on one screen and nowhere else, and keeps it over a restart", async () => {
    const box = await pairTv();
    const desktop = await pairSecondTv(box);
    const desk = await features(desktop, "desktop");
    const put = await app.inject({ method: "PUT", url: `/api/features/${desk.device}`, headers: as(box), payload: { off: ["live", "weather", "rubbish"] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().off).toEqual(["live", "weather"]);
    expect((await features(desktop, "desktop")).off).toEqual(["live", "weather"]);
    expect((await features(box, "box")).off).toEqual([]);

    await app.close();
    await start();
    expect((await features(desktop, "desktop")).off).toEqual(["live", "weather"]);
    const list = (await app.inject({ url: "/api/features/devices", headers: as(box) })).json().devices as DeviceFeatures[];
    expect(list.find((d) => d.id === desk.device)).toMatchObject({ client: "desktop", off: ["live", "weather"] });
  });

  it("lets the phone remote follow the TV box, not the desktop app", async () => {
    const box = await pairTv();
    const desktop = await pairSecondTv(box);
    const phone = await pairPhone(box);
    const boxId = (await features(box, "box")).device!;
    const deskId = (await features(desktop, "desktop")).device!;
    await app.inject({ method: "PUT", url: `/api/features/${deskId}`, headers: as(box), payload: { off: ["music", "cast"] } });
    expect((await features(phone, "remote")).off).toEqual([]);
    await app.inject({ method: "PUT", url: `/api/features/${boxId}`, headers: as(phone), payload: { off: ["cast"] } });
    expect((await features(phone, "remote")).off).toEqual(["cast"]);
  });

  it("needs a paired device to change, refuses unknown devices and forgets removed ones", async () => {
    const box = await pairTv();
    const boxId = (await features(box, "box")).device!;
    expect((await app.inject({ method: "PUT", url: `/api/features/${boxId}`, payload: { off: ["live"] } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/api/features/nope", headers: as(box), payload: { off: ["live"] } })).statusCode).toBe(404);
    const desktop = await pairSecondTv(box);
    const deskId = (await features(desktop, "desktop")).device!;
    await app.inject({ method: "PUT", url: `/api/features/${deskId}`, headers: as(box), payload: { off: ["live"] } });
    await app.inject({ method: "DELETE", url: `/api/devices/${deskId}`, headers: as(box) });
    const list = (await app.inject({ url: "/api/features/devices", headers: as(box) })).json().devices as DeviceFeatures[];
    expect(list.map((d) => d.id)).toEqual([boxId]);
  });

  it("asks for the settings PIN once one is set", async () => {
    const box = await pairTv();
    const boxId = (await features(box, "box")).device!;
    const adult = (await app.inject({ method: "POST", url: "/api/profiles", headers: as(box), payload: { name: "Gary", kind: "adult" } })).json();
    await app.inject({ method: "PATCH", url: `/api/profiles/${adult.id}`, headers: as(box), payload: { pin: "1234" } });
    const r = await app.inject({ method: "PUT", url: `/api/features/${boxId}`, headers: as(box), payload: { off: ["live"] } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("pin");
  });
});
