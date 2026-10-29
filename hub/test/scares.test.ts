import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanScareSettings, DEFAULT_SCARE_SETTINGS, scareFrom, type HubEvent, type ScareState } from "@ultimatetv/shared";
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
    expect(state.mixes).toEqual([]);
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

describe("built scares", () => {
  /** A GIF's first bytes and an MP3's ID3 tag: enough for the Hub to tell what they are. */
  const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);
  const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]);
  const upload = async (body: Buffer, type: string, name: string) =>
    ((await app.inject({ method: "POST", url: `/api/scares/clips?name=${name}`, headers: { "content-type": type }, payload: body })).json() as { clip: { id: string; kind: string } }).clip;

  it("takes sounds as clips", async () => {
    const sound = await upload(MP3, "application/octet-stream", "Scream");
    expect(sound.kind).toBe("audio");
  });

  it("puts a picture and a sound together in a spot, and sends both to the TV", async () => {
    const gif = await upload(GIF, "image/gif", "Ghost");
    const sound = await upload(MP3, "audio/mpeg", "Scream");
    const res = await app.inject({ method: "POST", url: "/api/scares/mixes", payload: { visualId: gif.id, audioId: sound.id, spot: "bottom-right", size: "small", seconds: 3 } });
    expect(res.statusCode).toBe(200);
    const mix = (res.json() as { mix: { id: string; name: string; spot: string } }).mix;
    expect(mix).toMatchObject({ name: "Ghost + Scream", spot: "bottom-right" });

    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    await app.inject({ method: "POST", url: "/api/scares/now", payload: { mixId: mix.id } });
    const scare = events.find((e) => e.type === "scare");
    expect(scare?.type === "scare" && scare.scare).toMatchObject({ clip: { id: gif.id, kind: "image" }, audio: { id: sound.id }, spot: "bottom-right", size: "small", seconds: 3, mixId: mix.id });

    // Deleting the picture leaves the sound; deleting that too takes the scare with it.
    await app.inject({ method: "DELETE", url: `/api/scares/clips/${gif.id}` });
    expect(((await app.inject({ url: "/api/scares" })).json() as ScareState).mixes).toHaveLength(1);
    await app.inject({ method: "DELETE", url: `/api/scares/clips/${sound.id}` });
    expect(((await app.inject({ url: "/api/scares" })).json() as ScareState).mixes).toHaveLength(0);
  });

  it("won't build a scare from nothing, or from the wrong kind of clip", async () => {
    const gif = await upload(GIF, "image/gif", "Ghost");
    expect((await app.inject({ method: "POST", url: "/api/scares/mixes", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/scares/mixes", payload: { audioId: gif.id } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/scares/now", payload: { mixId: "gone" } })).statusCode).toBe(404);
  });
});

describe("picking a scare", () => {
  const settings = DEFAULT_SCARE_SETTINGS;
  const clip = (id: string, kind: "video" | "image" | "audio") => ({ id, name: id, kind, url: `/api/scares/clips/${id}`, sizeBytes: 1, addedAt: 0 });

  it("never picks a bare sound at random, but does pick built scares", () => {
    const state = { settings, clips: [clip("s", "audio")], mixes: [{ id: "m", name: "m", audioId: "s", spot: "full" as const, size: "medium" as const, muteVideo: false, seconds: 0, createdAt: 0 }] };
    for (const r of [0, 0.5, 0.99]) expect(scareFrom(state, {}, false, () => r)?.mixId).toBe("m");
    expect(scareFrom({ ...state, mixes: [] }, {}, false)?.clip).toBeUndefined();
    expect(scareFrom({ ...state, mixes: [] }, {}, false)?.audio).toBeUndefined();
  });
});

describe("scare settings on their own", () => {
  it("falls back to what was there before for anything odd", () => {
    const base = { ...DEFAULT_SCARE_SETTINGS, seconds: 8 };
    expect(cleanScareSettings({ seconds: Number.NaN }, base).seconds).toBe(8);
    expect(cleanScareSettings({}, base)).toEqual(base);
  });
});
