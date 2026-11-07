// Watching elsewhere and Sync play. What these hold down: every screen's report shows up on the
// others (but not on itself), a screen that goes quiet is shown as stopped where it was, "Move here"
// reaches the other screen on its next report, and a Sync play group keeps one clock that every
// member's pause, play and seek moves, ending once only one screen is left.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SyncGroup, WatchSession } from "@ultimatetv/shared";
import { positionAt, syncCorrection, watchLine } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";
import { type Asker, Watching } from "../src/watching.js";

const film = (over: Record<string, unknown> = {}) => ({
  req: { kind: "title", id: "tmdb:movie:603" },
  name: "The Matrix",
  title: { id: "tmdb:movie:603", kind: "movie", name: "The Matrix" },
  live: false,
  positionMs: 600_000,
  durationMs: 8_160_000,
  paused: false,
  event: "progress",
  client: "tv",
  ...over,
});

const tv: Asker = { device: "tv1", deviceName: "Living room", box: "tv1", profile: null };
const phone: Asker = { device: "phone:abc", deviceName: "Gary's phone", profile: null };
const kitchen: Asker = { device: "tv2", deviceName: "Kitchen", box: "tv2", profile: null };

describe("Watching", () => {
  let clock = 1_000_000;
  let w: Watching;
  beforeEach(() => {
    clock = 1_000_000;
    w = new Watching(() => clock);
  });

  it("keeps what each screen reports, moving the place on while it plays", () => {
    w.report(tv, film());
    clock += 4_000;
    const s = w.session("tv1")!;
    expect(s.deviceName).toBe("Living room");
    expect(s.box).toBe("tv1");
    expect(positionAt(s, clock)).toBe(604_000);
    expect(watchLine(s, positionAt(s, clock))).toBe("Living room · at 10:04 of 2:16:00");
  });

  it("shows a screen that went quiet as stopped, and forgets it once it's old", () => {
    w.report(tv, film());
    clock += 50_000;
    expect(w.list()[0]!.stopped).toBe(true);
    clock += 5 * 60 * 60_000;
    expect(w.list()).toEqual([]);
  });

  it("doesn't offer something that was watched to the end", () => {
    w.report(tv, film({ positionMs: 8_000_000, event: "stop" }));
    expect(w.list()).toEqual([]);
  });

  it("refuses things that can't be started elsewhere", () => {
    expect(w.report(tv, film({ req: { kind: "stream", id: "link:https://youtu.be/x" } }))).toBeNull();
    expect(w.report(tv, { name: "nothing" })).toBeNull();
  });

  it("hands a pause or stop to the other screen on its next report", () => {
    w.report(tv, film());
    expect(w.command("tv1", { type: "stop" })).toBe(true);
    const next = w.report(tv, film({ positionMs: 605_000 }))!;
    expect(next.commands).toEqual([{ type: "stop" }]);
    // Heard once.
    expect(w.report(tv, film())!.commands).toEqual([]);
    expect(w.command("nobody", { type: "pause" })).toBe(false);
  });

  it("starts Sync play from where the other screen is, and tells it to join", () => {
    w.report(tv, film());
    clock += 3_000;
    const g = w.startSync({ ...phone, client: "android" }, "tv1");
    expect(g.positionMs).toBe(603_000);
    expect(g.members.map((m) => m.deviceName)).toEqual(["Living room", "Gary's phone"]);
    expect(w.report(tv, film({ sync: g.id }))!.commands).toEqual([{ type: "sync", group: g.id }]);
    // A third room joins the same group rather than starting another.
    const again = w.startSync({ ...kitchen, client: "tv" }, "tv1");
    expect(again.id).toBe(g.id);
    expect(again.members).toHaveLength(3);
  });

  it("moves everyone's clock when one member pauses or seeks", async () => {
    w.report(tv, film());
    const g = w.startSync({ ...phone, client: "android" }, "tv1");
    const waiting = w.wait(g.id, g.seq + 0, 10_000);
    clock += 1_000;
    const paused = w.act(g.id, phone, "pause", 650_000);
    await waiting; // The long poll answered at once.
    expect(paused.paused).toBe(true);
    expect(paused.last).toMatchObject({ deviceName: "Gary's phone", action: "pause" });
    clock += 20_000;
    // Paused: the clock stands still.
    expect(positionAt(w.group(g.id)!, clock)).toBe(650_000);
    const playing = w.act(g.id, tv, "play", undefined);
    expect(playing.paused).toBe(false);
    expect(playing.positionMs).toBe(650_000);
  });

  it("ends when only one screen is left, and when a member moves on to something else", () => {
    w.report(tv, film());
    const g = w.startSync({ ...phone, client: "android" }, "tv1");
    w.report(tv, film({ sync: g.id, req: { kind: "title", id: "tmdb:movie:604" } }));
    const after = w.group(g.id)!;
    expect(after.ended).toBe(true);
    expect(w.session("tv1")!.sync).toBeUndefined();
  });

  it("drops a member that has gone quiet", () => {
    w.report(tv, film());
    const g = w.startSync({ ...phone, client: "android" }, "tv1");
    w.startSync({ ...kitchen, client: "tv" }, "tv1");
    clock += 30_000;
    w.report(tv, film({ sync: g.id }));
    w.report(kitchen, film({ sync: g.id }));
    clock += 40_000;
    // The phone hasn't reported for 70 seconds.
    const now = w.group(g.id)!;
    expect(now.members.map((m) => m.deviceName)).toEqual(["Living room", "Kitchen"]);
    expect(now.ended).toBe(false);
  });

  it("won't sync with something that has stopped", () => {
    w.report(tv, film({ event: "stop" }));
    expect(() => w.startSync({ ...phone, client: "android" }, "tv1")).toThrow(/Resume here/);
  });
});

describe("syncCorrection", () => {
  const group = { positionMs: 100_000, paused: false, at: 0, live: false } as Pick<SyncGroup, "positionMs" | "paused" | "at" | "live" | "durationMs">;
  it("leaves a member that is close enough alone", () => {
    expect(syncCorrection({ positionMs: 101_500, paused: false }, group, 0)).toEqual({});
  });
  it("seeks a member that has drifted, to where the shared clock is now", () => {
    expect(syncCorrection({ positionMs: 90_000, paused: false }, group, 5_000)).toEqual({ seekTo: 105_000 });
  });
  it("pauses a member that is still playing", () => {
    expect(syncCorrection({ positionMs: 100_000, paused: false }, { ...group, paused: true }, 0)).toEqual({ pause: true });
  });
  it("only matches play and pause on live TV", () => {
    expect(syncCorrection({ positionMs: 0, paused: true }, { ...group, live: true }, 0)).toEqual({ pause: false });
  });
});

describe("the routes", () => {
  let tmp: string;
  let app: FastifyInstance;
  let living: string;
  let mobile: string;
  const as = (token: string) => ({ "x-device-token": token });

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-watching-"));
    app = await buildServer(
      { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
      { systemReport: async () => ({}) as never },
    );
    living = (await app.inject({ method: "POST", url: "/api/pair/screen", payload: { name: "Living room" } })).json().token as string;
    const { code } = (await app.inject({ url: "/api/pair/code", headers: as(living) })).json();
    mobile = (await app.inject({ method: "POST", url: "/api/pair", payload: { code, name: "Gary's phone" } })).json().token as string;
  });
  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("shows the TV's film on the phone, not on the TV itself, and only to paired screens", async () => {
    const sent = await app.inject({ method: "POST", url: "/api/watching", headers: as(living), payload: film() });
    expect(sent.statusCode).toBe(200);
    const onPhone = (await app.inject({ url: "/api/watching", headers: as(mobile) })).json() as { sessions: WatchSession[] };
    expect(onPhone.sessions.map((s) => s.deviceName)).toEqual(["Living room"]);
    expect(onPhone.sessions[0]!.box).toBeTruthy();
    const onTv = (await app.inject({ url: "/api/watching", headers: as(living) })).json() as { sessions: WatchSession[] };
    expect(onTv.sessions).toEqual([]);
    expect((await app.inject({ url: "/api/watching" })).statusCode).toBe(401);
  });

  it("syncs the phone with the TV and passes a pause from one to the other", async () => {
    await app.inject({ method: "POST", url: "/api/watching", headers: as(living), payload: film() });
    const tvId = ((await app.inject({ url: "/api/watching", headers: as(mobile) })).json() as { sessions: WatchSession[] }).sessions[0]!.device;
    const started = await app.inject({ method: "POST", url: "/api/sync", headers: as(mobile), payload: { with: tvId, client: "android" } });
    expect(started.statusCode).toBe(200);
    const g = started.json().group as SyncGroup;
    // The TV hears it should join on its next report, and gets the group back from then on.
    const tvNext = (await app.inject({ method: "POST", url: "/api/watching", headers: as(living), payload: film({ sync: g.id }) })).json();
    expect(tvNext.commands).toEqual([{ type: "sync", group: g.id }]);
    expect(tvNext.sync.id).toBe(g.id);
    const paused = await app.inject({ method: "POST", url: `/api/sync/${g.id}/action`, headers: as(living), payload: { action: "pause", positionMs: 620_000 } });
    expect(paused.json().group.paused).toBe(true);
    const seen = (await app.inject({ url: `/api/sync/${g.id}?since=${g.seq}&wait=1000`, headers: as(mobile) })).json().group as SyncGroup;
    expect(seen.paused).toBe(true);
    expect(seen.last?.deviceName).toBe("Living room");
    const left = (await app.inject({ method: "POST", url: `/api/sync/${g.id}/leave`, headers: as(mobile) })).json().group as SyncGroup;
    expect(left.ended).toBe(true);
  });

  it("stops the TV when the phone takes over", async () => {
    await app.inject({ method: "POST", url: "/api/watching", headers: as(living), payload: film() });
    const tvId = ((await app.inject({ url: "/api/watching", headers: as(mobile) })).json() as { sessions: WatchSession[] }).sessions[0]!.device;
    expect((await app.inject({ method: "POST", url: `/api/watching/${tvId}/command`, headers: as(mobile), payload: { type: "stop" } })).statusCode).toBe(200);
    const next = (await app.inject({ method: "POST", url: "/api/watching", headers: as(living), payload: film() })).json();
    expect(next.commands).toEqual([{ type: "stop" }]);
  });
});
