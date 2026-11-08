import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: { events: { on(fn: (e: HubEvent) => void): () => void } } };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

let token = "";
async function start() {
  app = await buildServer(options(), { systemReport: async () => ({}) as never });
  const fresh = await pairAsTv(app);
  if (fresh) token = fresh;
  else {
    // Restarted on the same data: the TV's token from last time still works.
    const inject = app.inject.bind(app) as (o: object) => unknown;
    (app as { inject: unknown }).inject = (o: string | { headers?: Record<string, string> }) => {
      const opts = typeof o === "string" ? { url: o } : o;
      return inject({ ...opts, headers: { "x-device-token": token, ...opts.headers } });
    };
  }
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-trackprefs-"));
  await start();
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const as = (profile?: string) => (profile ? { "x-profile": profile } : {});
const put = (payload: object, profile?: string) => app.inject({ method: "PUT", url: "/api/track-prefs", payload, headers: as(profile) });
const get = async (title: string, profile?: string) => (await app.inject({ url: `/api/track-prefs?title=${title}`, headers: as(profile) })).json().pref;
const profile = async (name: string, kind: "adult" | "kids") => (await app.inject({ method: "POST", url: "/api/profiles", payload: { name, kind } })).json().id as string;

describe("remembered tracks per series", () => {
  it("keeps the language, merges later picks, and Default clears it", async () => {
    expect(await get("t1")).toBeNull();
    await put({ title: "t1", audio: { lang: "jpn" } });
    await put({ title: "t1", subtitle: { lang: "en" } });
    const pref = await get("t1");
    expect(pref.audio).toEqual({ lang: "ja" });
    expect(pref.subtitle).toEqual({ lang: "en" });
    expect((await app.inject({ method: "DELETE", url: "/api/track-prefs?title=t1" })).json().ok).toBe(true);
    expect(await get("t1")).toBeNull();
  });

  it("refuses an empty choice", async () => {
    expect((await put({ title: "t1" })).statusCode).toBe(400);
    expect((await put({ audio: { lang: "en" } })).statusCode).toBe(400);
  });

  it("is per profile and survives a restart", async () => {
    const dad = await profile("Dad", "adult");
    const kids = await profile("Kids", "kids");
    await put({ title: "t1", subtitle: "off" }, dad);
    expect(await get("t1", dad)).toMatchObject({ subtitle: "off" });
    expect(await get("t1", kids)).toBeNull();
    await app.close();
    await start();
    expect(await get("t1", dad)).toMatchObject({ subtitle: "off" });
  });
});
