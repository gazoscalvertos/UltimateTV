import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent, QueueItem } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: { events: { on(fn: (e: HubEvent) => void): () => void } } };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-queue-"));
  app = await buildServer(options(), { systemReport: async () => ({}) as never });
  await pairAsTv(app);
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const add = (payload: object) => app.inject({ method: "POST", url: "/api/queue", payload });
const names = async () => ((await app.inject("/api/queue")).json().queue as QueueItem[]).map((i) => i.name);

describe("the play queue", () => {
  it("queues films and episodes in order and tells the TV", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    expect((await add({ req: { kind: "title", id: "tmdb:movie:603" }, name: "The Matrix" })).statusCode).toBe(200);
    const ep = (await add({ req: { kind: "title", id: "tmdb:tv:1396", episodeId: "s1e2" }, name: "Breaking Bad", subtitle: "S1 E2" })).json();
    expect(ep.item).toMatchObject({ name: "Breaking Bad", subtitle: "S1 E2", req: { kind: "title", id: "tmdb:tv:1396", episodeId: "s1e2" } });
    expect(await names()).toEqual(["The Matrix", "Breaking Bad"]);
    expect(events.filter((e) => e.type === "queue.changed")).toHaveLength(2);
  });

  it("won't queue live channels or nameless things", async () => {
    expect((await add({ req: { kind: "channel", id: "bbc1" }, name: "BBC One" })).statusCode).toBe(400);
    expect((await add({ req: { kind: "title", id: "x" } })).statusCode).toBe(400);
  });

  it("moves something queued twice rather than repeating it, and Play next puts it first", async () => {
    await add({ req: { kind: "title", id: "a" }, name: "A" });
    await add({ req: { kind: "title", id: "b" }, name: "B" });
    await add({ req: { kind: "title", id: "a" }, name: "A" });
    expect(await names()).toEqual(["A", "B"]);
    await add({ req: { kind: "title", id: "b" }, name: "B", next: true });
    expect(await names()).toEqual(["B", "A"]);
  });

  it("reorders, removes and clears", async () => {
    for (const n of ["A", "B", "C"]) await add({ req: { kind: "title", id: n }, name: n });
    const queue = (await app.inject("/api/queue")).json().queue as QueueItem[];
    await app.inject({ method: "POST", url: `/api/queue/${queue[2]!.id}/move`, payload: { to: 0 } });
    expect(await names()).toEqual(["C", "A", "B"]);
    await app.inject({ method: "DELETE", url: `/api/queue/${queue[0]!.id}` });
    expect(await names()).toEqual(["C", "B"]);
    await app.inject({ method: "DELETE", url: "/api/queue" });
    expect(await names()).toEqual([]);
  });

  it("shows a Kids profile only what it may watch", async () => {
    await add({ req: { kind: "title", id: "a" }, name: "Toy Tales", title: { id: "a", kind: "movie", name: "Toy Tales", certification: "U" } });
    await add({ req: { kind: "title", id: "b" }, name: "Night Terror", title: { id: "b", kind: "movie", name: "Night Terror", certification: "18" } });
    await add({ req: { kind: "recording", id: "gone" }, name: "Newsnight" });
    const kids = ((await app.inject({ url: "/api/queue", headers: { "x-profile": "kids" } })).json().queue as QueueItem[]).map((i) => i.name);
    expect(kids).toEqual(["Toy Tales"]);
    expect(await names()).toEqual(["Toy Tales", "Night Terror", "Newsnight"]);
  });

  it("is still there after the Hub restarts", async () => {
    await add({ req: { kind: "recording", id: "r1" }, name: "Gardeners' World" });
    await app.close();
    app = await buildServer(options(), { systemReport: async () => ({}) as never });
    await pairAsTv(app);
    expect(await names()).toEqual(["Gardeners' World"]);
  });
});
