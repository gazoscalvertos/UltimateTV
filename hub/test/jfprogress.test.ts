// Jellyfin progress made away from home (issue #80). While the Hub can't reach Jellyfin — on a
// trip, or with the Hub's Jellyfin settings just filled in — what was watched is kept in the
// database and sent on when Jellyfin answers again. If Jellyfin was played somewhere else in the
// meantime, its newer place wins.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent, PlaybackInfo } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { Db } from "../src/db.js";
import { recordBoot } from "../src/restarts.js";
import {
  JellyfinProgressQueue,
  MAX_QUEUED,
  QUEUE_KEY,
  drainQueue,
  newestWins,
  type QueuedProgress,
} from "../src/jfprogress.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

const now = Date.parse("2026-11-20T20:00:00Z");
const minute = 60_000;

const at = (positionMs: number, event: QueuedProgress["event"] = "stop"): Omit<QueuedProgress, "at"> => ({ itemId: "abc123", positionMs, durationMs: 100 * minute, event });

describe("the Jellyfin progress queue", () => {
  const store = () => new Db(":memory:");
  const queue = () => new JellyfinProgressQueue(store());

  it("keeps the place each title was left at, oldest first so they go out in order", () => {
    const q = queue();
    q.queue({ ...at(10 * minute), itemId: "a" }, now);
    q.queue({ ...at(20 * minute), itemId: "b" }, now + 1000);
    q.queue({ ...at(5 * minute), itemId: "c" }, now - 5000);
    expect(q.list().map((p) => p.itemId)).toEqual(["c", "a", "b"]);
    expect(q.size()).toBe(3);
  });

  it("keeps only the newest place for one title", () => {
    const q = queue();
    q.queue({ ...at(10 * minute), itemId: "a" }, now);
    q.queue({ ...at(40 * minute), itemId: "a" }, now + minute);
    expect(q.list()).toEqual([{ itemId: "a", positionMs: 40 * minute, durationMs: 100 * minute, event: "stop", at: now + minute }]);
  });

  it("keeps a film that was finished as watched", () => {
    const q = queue();
    q.queue({ itemId: "a", positionMs: 0, event: "stop", played: true }, now);
    expect(q.list()[0]!.played).toBe(true);
  });

  it("forgets the oldest titles past the limit", () => {
    const q = queue();
    for (let i = 0; i < MAX_QUEUED + 5; i++) q.queue({ itemId: `i${i}`, positionMs: i, event: "stop" }, now + i);
    expect(q.size()).toBe(MAX_QUEUED);
    expect(q.list()[0]!.itemId).toBe("i5");
  });

  it("remembers the queue across a restart", () => {
    const file = path.join(process.env.TMPDIR ?? os.tmpdir(), `utv-jfq-${Date.now()}-${Math.random()}.db`);
    const db = new Db(file);
    new JellyfinProgressQueue(db).queue({ ...at(7 * minute), itemId: "a" }, now);
    db.close();
    const again = new Db(file);
    expect(new JellyfinProgressQueue(again).list()[0]!.positionMs).toBe(7 * minute);
    again.close();
  });

  it("starts empty, and shrugs off junk in the database", () => {
    const db = store();
    expect(new JellyfinProgressQueue(db).list()).toEqual([]);
    db.setKv(QUEUE_KEY, "not a list");
    expect(new JellyfinProgressQueue(db).list()).toEqual([]);
  });
});

describe("sending it when Jellyfin answers again", () => {
  const one = (positionMs: number, atMs: number, itemId = "abc123"): QueuedProgress => ({ itemId, positionMs, durationMs: 100 * minute, event: "stop", at: atMs });

  it("sends the oldest first, then forgets it", async () => {
    const sent: string[] = [];
    const left = new Map<string, QueuedProgress>([
      ["a", one(1, now, "a")],
      ["b", one(2, now + 1000, "b")],
    ]);
    const out = await drainQueue({
      list: () => [...left.values()].sort((x, y) => x.at - y.at),
      remove: (id) => void left.delete(id),
      send: async (p) => void sent.push(p.itemId),
    });
    expect(sent).toEqual(["a", "b"]);
    expect(out).toEqual({ sent: 2, skipped: 0, left: 0 });
    expect(left.size).toBe(0);
  });

  it("stops at the first failure and keeps the rest for later", async () => {
    const left = new Map<string, QueuedProgress>([
      ["a", one(1, now, "a")],
      ["b", one(2, now + 1000, "b")],
      ["c", one(3, now + 2000, "c")],
    ]);
    const out = await drainQueue({
      list: () => [...left.values()].sort((x, y) => x.at - y.at),
      remove: (id) => void left.delete(id),
      send: async (p) => {
        if (p.itemId === "b") throw new Error("no route to host");
      },
    });
    expect(out).toEqual({ sent: 1, skipped: 0, left: 2 });
    expect([...left.keys()]).toEqual(["b", "c"]);
  });

  it("lets Jellyfin win when it was played somewhere else more recently", async () => {
    const left = new Map<string, QueuedProgress>([
      ["old", one(10 * minute, now, "old")],
      ["new", one(90 * minute, now + 30 * minute, "new")],
    ]);
    const sent: string[] = [];
    const out = await drainQueue({
      list: () => [...left.values()].sort((x, y) => x.at - y.at),
      remove: (id) => void left.delete(id),
      send: async (p) => void sent.push(p.itemId),
      // Jellyfin says both were played at now + 20 minutes: that beats "old", not "new".
      lookup: async () => ({ lastPlayedAt: now + 20 * minute, played: true }),
    });
    expect(sent).toEqual(["new"]);
    expect(out).toEqual({ sent: 1, skipped: 1, left: 0 });
  });

  it("sends anyway when Jellyfin can't be asked, or has never played it", async () => {
    const left = new Map<string, QueuedProgress>([["a", one(10 * minute, now)]]);
    const send = async () => undefined;
    const out = await drainQueue({
      list: () => [...left.values()],
      remove: (id) => void left.delete(id),
      send,
      lookup: async () => {
        throw new Error("timed out");
      },
    });
    expect(out).toEqual({ sent: 1, skipped: 0, left: 0 });

    const none = new Map<string, QueuedProgress>([["a", one(10 * minute, now)]]);
    const out2 = await drainQueue({
      list: () => [...none.values()],
      remove: (id) => void none.delete(id),
      send,
      lookup: async () => null,
    });
    expect(out2).toEqual({ sent: 1, skipped: 0, left: 0 });
  });

  it("knows when the Hub's place is the newer one", () => {
    const queued = one(10 * minute, now);
    expect(newestWins(queued, { lastPlayedAt: now - 1, played: false })).toBe(true);
    expect(newestWins(queued, { lastPlayedAt: now + 1, played: false })).toBe(false);
    expect(newestWins(queued, { lastPlayedAt: now, played: false })).toBe(true);
    expect(newestWins(queued, null)).toBe(true);
  });
});

describe("what the Hub does with Jellyfin progress it can't deliver", () => {
  let tmp: string;
  let app: FastifyInstance & { hub: HubContext };
  let requests: { url: string; init?: RequestInit }[];
  let answers: Record<string, () => Response>;
  let events: HubEvent[];

  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), ...(init ? { init } : {}) });
    const answer = answers[String(url).split("?")[0]!];
    return answer ? answer() : new Response("not here", { status: 404 });
  }) as typeof fetch;

  const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-jfprogress-"));
    requests = [];
    answers = {};
    events = [];
    const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
    app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
    app.hub.events.on((e) => events.push(e));
    await pairAsTv(app);
  });

  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const report = (body: object) => app.inject({ method: "POST", url: "/api/progress", payload: body });

  it("keeps the place for Jellyfin while it isn't set up", async () => {
    expect(app.hub.jellyfin()).toBeNull();
    const res = await report({ key: "jellyfin:abc123", positionMs: 25 * minute, durationMs: 100 * minute, event: "stop" });
    expect(res.statusCode).toBe(200);
    const queued = app.hub.jellyfinProgress.list();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ itemId: "abc123", positionMs: 25 * minute, event: "stop" });
  });

  it("keeps it when Jellyfin is set up but doesn't answer", async () => {
    app.hub.settings.update({ jellyfin: { url: "http://jf:8096", userId: "u1", token: "t0k" } });
    answers["http://jf:8096/Sessions/Playing/Stopped"] = () => new Response("down", { status: 503 });
    await report({ key: "jellyfin:abc123", positionMs: 50 * minute, durationMs: 100 * minute, event: "stop" });
    expect(app.hub.jellyfinProgress.list()[0]!.positionMs).toBe(50 * minute);
  });

  it("sends the backlog once Jellyfin answers, and empties the queue", async () => {
    // Jellyfin is reachable again, and two places were saved while it wasn't.
    answers["http://jf:8096/Sessions/Playing/Stopped"] = () => new Response(null, { status: 204 });
    answers["http://jf:8096/Users/u1/Items/abc123"] = () => Response.json({ Id: "abc123", Name: "A", Type: "Movie", UserData: { Played: false } });
    answers["http://jf:8096/Users/u1/Items/def456"] = () => Response.json({ Id: "def456", Name: "B", Type: "Movie", UserData: { Played: false } });
    app.hub.settings.update({ jellyfin: { url: "http://jf:8096", userId: "u1", token: "t0k" } });
    app.hub.jellyfinProgress.queue({ itemId: "abc123", positionMs: 25 * minute, durationMs: 100 * minute, event: "stop" }, Date.now() - 4000);
    app.hub.jellyfinProgress.queue({ itemId: "def456", positionMs: 60 * minute, durationMs: 100 * minute, event: "stop" }, Date.now() - 3000);

    const out = await app.hub.flushJellyfinProgress();

    expect(out).toEqual({ sent: 2, skipped: 0, left: 0 });
    expect(app.hub.jellyfinProgress.size()).toBe(0);
    const stops = requests.filter((r) => r.url === "http://jf:8096/Sessions/Playing/Stopped");
    expect(stops).toHaveLength(2);
    expect(events.some((e) => e.type === "progress.changed")).toBe(true);
  });

  it("leaves the queue alone when there is nothing to send", async () => {
    expect(await app.hub.flushJellyfinProgress()).toEqual({ sent: 0, skipped: 0, left: 0 });
    expect(requests.filter((r) => r.url.includes("jf")).length).toBe(0);
  });

  it("takes the time a phone says it watched it, for the newest-wins rule", async () => {
    const watchedAt = Date.now() - 60 * minute;
    await report({ key: "jellyfin:abc123", positionMs: 30 * minute, durationMs: 100 * minute, event: "stop", at: watchedAt });
    expect(app.hub.jellyfinProgress.list()[0]).toMatchObject({ itemId: "abc123", positionMs: 30 * minute, at: watchedAt });
  });

  it("still records the place in the Hub's own Continue watching", async () => {
    await report({ key: "jellyfin:abc123", positionMs: 25 * minute, durationMs: 100 * minute, event: "stop", title: { id: "jellyfin:abc123", kind: "movie", name: "Away Film" } });
    expect(app.hub.progress.get("jellyfin:abc123")?.positionMs).toBe(25 * minute);
    expect(app.hub.jellyfinProgress.size()).toBe(1);
  });

  it("counts the boots it has queued for, so the queue is not forgotten on a restart", async () => {
    app.hub.jellyfinProgress.queue({ itemId: "abc123", positionMs: 25 * minute, event: "stop" }, now);
    recordBoot(app.hub.db, now);
    expect(app.hub.jellyfinProgress.size()).toBe(1);
  });
});

describe("a box playing a download while the Hub is away", () => {
  it("keeps the place under the same key the box reports", async () => {
    // The box plays from its own disk and reports to its own Hub, which can't reach Jellyfin from a
    // hotel: the key is the Jellyfin item id, so the queue picks it up the same way.
    const db = new Db(":memory:");
    const q = new JellyfinProgressQueue(db);
    q.queue({ itemId: "abc123", positionMs: 42 * minute, durationMs: 100 * minute, event: "stop" }, now);
    const info = { progressKey: "jellyfin:abc123" } as Pick<PlaybackInfo, "progressKey">;
    expect(q.list()[0]!.itemId).toBe(info.progressKey.slice(9));
  });
});
