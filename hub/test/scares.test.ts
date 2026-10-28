import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanScareSettings, DEFAULT_SCARE_SETTINGS, isHalloweenWeek, resolveTheme, type HubEvent, type ScareState } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

/** The smallest MP4-ish body: enough of an ftyp box for the Hub to tell it's a video. */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(16)]);

let tmp: string;
let app: FastifyInstance & { hub: { events: { on(fn: (e: HubEvent) => void): () => void } } };

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-scares-"));
  app = await buildServer({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false }, { systemReport: async () => ({}) as never });
  await pairAsTv(app);
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("jump scares", () => {
  it("starts off, with nothing uploaded", async () => {
    const state = (await app.inject({ url: "/api/scares" })).json() as ScareState;
    expect(state.settings).toEqual(DEFAULT_SCARE_SETTINGS);
    expect(state.clips).toEqual([]);
  });

  it("keeps the settings the phone sends, within reason", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    const res = await app.inject({ method: "PUT", url: "/api/scares", payload: { enabled: true, minGapMinutes: 0, chancePercent: 500, seconds: 6, volume: 2 } });
    const state = res.json() as ScareState;
    expect(state.settings.enabled).toBe(true);
    expect(state.settings.minGapMinutes).toBe(1);
    expect(state.settings.chancePercent).toBe(100);
    expect(state.settings.seconds).toBe(6);
    expect(state.settings.volume).toBe(1);
    // What wasn't sent is left as it was.
    expect(state.settings.duringLive).toBe(true);
    expect(events.some((e) => e.type === "scares.changed")).toBe(true);
    // And it's still there on the next read.
    expect(((await app.inject({ url: "/api/scares" })).json() as ScareState).settings.seconds).toBe(6);
  });

  it("takes a clip, serves it back and tells the TV to show it", async () => {
    const up = await app.inject({ method: "POST", url: "/api/scares/clips?name=Doorway", headers: { "content-type": "video/mp4" }, payload: MP4 });
    expect(up.statusCode).toBe(200);
    const clip = (up.json() as { clip: { id: string; name: string; kind: string; url: string } }).clip;
    expect(clip).toMatchObject({ name: "Doorway", kind: "video" });
    expect((await app.inject({ url: clip.url })).statusCode).toBe(200);

    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    await app.inject({ method: "POST", url: "/api/scares/now", payload: {} });
    const scare = events.find((e) => e.type === "scare");
    expect(scare).toBeDefined();
    if (scare?.type === "scare") {
      expect(scare.scare.clip?.id).toBe(clip.id);
      expect(scare.scare.byHand).toBe(true);
      expect(scare.scare.seconds).toBe(DEFAULT_SCARE_SETTINGS.seconds);
    }

    const gone = await app.inject({ method: "DELETE", url: `/api/scares/clips/${clip.id}` });
    expect(gone.statusCode).toBe(200);
    expect((gone.json() as { clips: unknown[] }).clips).toEqual([]);
    expect((await app.inject({ url: clip.url })).statusCode).toBe(404);
  });

  it("scares with no clip at all, and says no to a clip that has gone", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    expect((await app.inject({ method: "POST", url: "/api/scares/now", payload: {} })).statusCode).toBe(200);
    const scare = events.find((e) => e.type === "scare");
    expect(scare?.type === "scare" && scare.scare.clip).toBeUndefined();
    expect((await app.inject({ method: "POST", url: "/api/scares/now", payload: { clipId: "nope" } })).statusCode).toBe(404);
  });

  it("only takes videos and pictures", async () => {
    const res = await app.inject({ method: "POST", url: "/api/scares/clips", headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("not a video") });
    expect(res.statusCode).toBe(400);
  });
});

describe("scare settings on their own", () => {
  it("falls back to what was there before for anything odd", () => {
    const base = { ...DEFAULT_SCARE_SETTINGS, seconds: 8 };
    expect(cleanScareSettings({ seconds: Number.NaN }, base).seconds).toBe(8);
    expect(cleanScareSettings({}, base)).toEqual(base);
  });
});

describe("the theme", () => {
  const on = (iso: string) => isHalloweenWeek(new Date(`${iso}T12:00:00`));

  it("wears Halloween over Halloween week on auto", () => {
    expect(on("2026-10-25")).toBe(true);
    expect(on("2026-10-31")).toBe(true);
    expect(on("2026-11-01")).toBe(true);
    expect(on("2026-10-24")).toBe(false);
    expect(on("2026-11-02")).toBe(false);
    expect(resolveTheme("auto", new Date("2026-10-31T20:00:00"))).toBe("halloween");
    expect(resolveTheme("auto", new Date("2026-06-01T20:00:00"))).toBe("default");
  });

  it("does as it's told the rest of the time", () => {
    expect(resolveTheme("halloween", new Date("2026-06-01T20:00:00"))).toBe("halloween");
    expect(resolveTheme("default", new Date("2026-10-31T20:00:00"))).toBe("default");
    expect(resolveTheme(undefined, new Date("2026-06-01T20:00:00"))).toBe("default");
  });
});
