// Share Play (issue #210). What these hold down: a link works in the first browser that opens it
// and no other; it runs out, can be cancelled, and finishes once the TV moves on; the browser joins
// the TV's Sync play and its pause reaches the TV; and the browser never sees Jellyfin's key.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShareLinkView, SyncGroup, WatchSession } from "@ultimatetv/shared";
import { onlyShareThroughTunnel, registerSharePlay, ShareLinks, shareable, stripKey, upstreamUrl, viaShareTunnel, viewerDevice } from "../src/shareplay.js";
import { type Asker, Watching } from "../src/watching.js";

const MASTER = "http://jf.lan:8096/jellyfin/Videos/abc123/master.m3u8?api_key=SECRETKEY&MediaSourceId=abc123&VideoCodec=h264";

const film = (over: Record<string, unknown> = {}) => ({
  req: { kind: "title", id: "tmdb:movie:603" },
  name: "The Matrix",
  artwork: "http://jf.lan:8096/jellyfin/Items/abc123/Images/Backdrop/0?tag=x",
  live: false,
  positionMs: 600_000,
  durationMs: 8_160_000,
  paused: false,
  event: "progress",
  client: "tv",
  ...over,
});
const tv: Asker = { device: "tv1", deviceName: "Living room", box: "tv1", profile: null };

describe("ShareLinks", () => {
  let clock = 1_000_000;
  let links: ShareLinks;
  let session: WatchSession;
  beforeEach(() => {
    clock = 1_000_000;
    links = new ShareLinks(() => clock);
    const w = new Watching(() => clock);
    w.report(tv, film());
    session = w.session("tv1")!;
  });

  it("lets in the first browser, the same one again, and nobody else", () => {
    const link = links.create(session, "phone", MASTER);
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const first = links.claim(link.id, undefined, "Sam");
    if (typeof first === "string") throw new Error(first);
    expect(first.secret).toBeTruthy();
    expect(links.claim(link.id, first.secret)).toMatchObject({ link: { viewerName: "Sam" } });
    expect(links.claim(link.id, undefined)).toBe("taken");
    expect(links.claim(link.id, "a guess")).toBe("taken");
    expect(links.check(link.id, first.secret)).toBe(link);
    expect(links.check(link.id, "a guess")).toBe("taken");
  });

  it("runs out, and keeps no more than ten", () => {
    const link = links.create(session, "phone", MASTER, 60 * 60_000);
    clock += 61 * 60_000;
    expect(links.claim(link.id, undefined)).toBe("expired");
    for (let i = 0; i < 12; i++) links.create(session, "phone", MASTER);
    expect(links.list()).toHaveLength(10);
  });

  it("only shares films and episodes", () => {
    expect(shareable(session)).toBe(true);
    expect(shareable({ req: { kind: "channel", id: "bbc1" }, live: true })).toBe(false);
    expect(shareable({ req: { kind: "recording", id: "r1" }, live: false })).toBe(false);
  });
});

describe("the HLS copy through the Hub", () => {
  it("takes Jellyfin's key out of every playlist", () => {
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nmain.m3u8?DeviceId=x&api_key=SECRETKEY&PlaySessionId=y\n";
    expect(stripKey(master)).toBe("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nmain.m3u8?DeviceId=x&PlaySessionId=y\n");
    expect(stripKey("hls1/main/0.ts?api_key=SECRETKEY")).toBe("hls1/main/0.ts");
    expect(stripKey("a.ts?ApiKey=K&x=1")).toBe("a.ts?x=1");
    expect(stripKey('#EXT-X-MAP:URI="init.mp4?x=1&api_key=K"')).toBe('#EXT-X-MAP:URI="init.mp4?x=1"');
  });

  it("puts the key back on the way to Jellyfin, inside the film's own folder only", () => {
    expect(upstreamUrl(MASTER, "master.m3u8", {})!.toString()).toBe(MASTER);
    const seg = upstreamUrl(MASTER, "hls1/main/3.ts", { runtimeTicks: "0", api_key: "theirs" })!;
    expect(seg.pathname).toBe("/jellyfin/Videos/abc123/hls1/main/3.ts");
    expect(seg.searchParams.get("api_key")).toBe("SECRETKEY");
    expect(seg.searchParams.get("runtimeTicks")).toBe("0");
    expect(upstreamUrl(MASTER, "../../Users", {})).toBeNull();
    expect(upstreamUrl(MASTER, "/etc/passwd", {})).toBeNull();
    expect(upstreamUrl(MASTER, "a//b", {})).toBeNull();
  });
});

describe("the routes", () => {
  let tmp: string;
  let app: FastifyInstance;
  let clock: number;
  let watching: Watching;
  let mayShare: boolean;
  let fetched: string[];
  const sharer: Asker = { device: "phone:1", deviceName: "Gary's phone", profile: null };

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-share-"));
    await writeFile(path.join(tmp, "index.html"), "<!doctype html><title>Watch together</title>");
    clock = 1_000_000;
    watching = new Watching(() => clock);
    mayShare = true;
    fetched = [];
    const fakeFetch = (async (input: string | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url.includes("master.m3u8")) return new Response("#EXTM3U\nmain.m3u8?DeviceId=d&api_key=SECRETKEY\n", { headers: { "content-type": "application/x-mpegURL" } });
      if (url.includes("main.m3u8")) return new Response("#EXTM3U\n#EXTINF:6,\nhls1/main/0.ts?api_key=SECRETKEY&runtimeTicks=0\n", { headers: { "content-type": "application/x-mpegURL" } });
      if (url.includes(".ts")) return new Response(new Uint8Array([71, 0, 0]), { headers: { "content-type": "video/mp2t" } });
      if (url.includes("/Images/")) return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } });
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    app = Fastify();
    registerSharePlay(app, {
      links: new ShareLinks(() => clock),
      watching,
      asker: () => sharer,
      mayShare: () => mayShare,
      defaultHost: () => "tv1",
      hlsFor: async (req) => (req.kind === "title" ? MASTER : null),
      linkBase: () => "http://192.168.0.19:8095",
      appName: () => "GazosTV",
      pageFile: path.join(tmp, "index.html"),
      fetchImpl: fakeFetch,
      now: () => clock,
    });
    watching.report(tv, film());
  });
  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const share = async () => (await app.inject({ method: "POST", url: "/api/share", payload: {} })).json() as ShareLinkView;
  const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0]!;

  it("makes a link to what the TV is playing, for the phone to send", async () => {
    const link = await share();
    expect(link.url).toBe(`http://192.168.0.19:8095/share/${link.id}`);
    expect(link).toMatchObject({ name: "The Matrix", hostName: "Living room", opened: false, watching: false });
    const page = await app.inject({ url: `/share/${link.id}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    const info = (await app.inject({ url: `/share/${link.id}/info` })).json();
    expect(info).toMatchObject({ name: "The Matrix", hostName: "Living room", appName: "GazosTV", artwork: `/share/${link.id}/art` });
    expect(JSON.stringify(info)).not.toContain("jf.lan");
  });

  it("won't share for Kids, live TV, or a TV that isn't playing", async () => {
    mayShare = false;
    expect((await app.inject({ method: "POST", url: "/api/share", payload: {} })).statusCode).toBe(403);
    mayShare = true;
    watching.report(tv, film({ req: { kind: "channel", id: "bbc1" }, name: "BBC One", live: true }));
    expect((await app.inject({ method: "POST", url: "/api/share", payload: {} })).json().problem).toBe("not-shareable");
    watching.report(tv, film({ event: "stop" }));
    expect((await app.inject({ method: "POST", url: "/api/share", payload: {} })).json().problem).toBe("stopped");
  });

  it("puts the browser in Sync play with the TV, and its pause reaches the TV", async () => {
    const link = await share();
    const joined = await app.inject({ method: "POST", url: `/share/${link.id}/join`, payload: { name: "Sam" } });
    expect(joined.statusCode).toBe(200);
    const cookie = cookieFrom(joined);
    expect(String(joined.headers["set-cookie"])).toContain(`Path=/share/${link.id}`);
    expect(String(joined.headers["set-cookie"])).toContain("HttpOnly");
    const { group } = joined.json() as { group: SyncGroup };
    expect(group.members.map((m) => m.deviceName)).toEqual(["Living room", "Sam"]);
    // The TV is told to follow the group on its next report.
    const tvNext = watching.report(tv, film({ sync: group.id }))!;
    expect(tvNext.commands).toEqual([{ type: "sync", group: group.id }]);
    const paused = await app.inject({ method: "POST", url: `/share/${link.id}/action`, headers: { cookie }, payload: { action: "pause", positionMs: 610_000 } });
    expect(paused.json().group).toMatchObject({ paused: true, positionMs: 610_000, last: { deviceName: "Sam", action: "pause" } });
    expect(((await app.inject({ url: "/api/share" })).json().links as ShareLinkView[])[0]).toMatchObject({ opened: true, viewerName: "Sam", watching: true });
    // Somebody else with the same link gets nowhere.
    expect((await app.inject({ method: "POST", url: `/share/${link.id}/join`, payload: {} })).json().problem).toBe("taken");
    expect((await app.inject({ url: `/share/${link.id}/info` })).json().problem).toBe("taken");
    expect((await app.inject({ method: "POST", url: `/share/${link.id}/action`, payload: { action: "play" } })).statusCode).toBe(403);
    // Leaving ends Sync play (only the TV is left).
    await app.inject({ method: "POST", url: `/share/${link.id}/leave`, headers: { cookie } });
    expect(watching.group(group.id)!.ended).toBe(true);
  });

  it("plays the 720p copy through the Hub without showing the key", async () => {
    const link = await share();
    const cookie = cookieFrom(await app.inject({ method: "POST", url: `/share/${link.id}/join`, payload: {} }));
    expect((await app.inject({ url: `/share/${link.id}/hls/master.m3u8` })).statusCode).toBe(403);
    const master = await app.inject({ url: `/share/${link.id}/hls/master.m3u8`, headers: { cookie } });
    expect(master.body).toBe("#EXTM3U\nmain.m3u8?DeviceId=d\n");
    const main = await app.inject({ url: `/share/${link.id}/hls/main.m3u8?DeviceId=d`, headers: { cookie } });
    expect(main.body).not.toContain("SECRETKEY");
    const seg = await app.inject({ url: `/share/${link.id}/hls/hls1/main/0.ts?runtimeTicks=0`, headers: { cookie } });
    expect(seg.statusCode).toBe(200);
    expect(seg.headers["content-type"]).toContain("video/mp2t");
    expect(fetched.at(-1)).toBe("http://jf.lan:8096/jellyfin/Videos/abc123/hls1/main/0.ts?runtimeTicks=0&api_key=SECRETKEY");
    expect((await app.inject({ url: `/share/${link.id}/art` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/share/${link.id}/art`, headers: { cookie } })).statusCode).toBe(200);
  });

  it("finishes the link once the TV moves on, and can be cancelled", async () => {
    const link = await share();
    const cookie = cookieFrom(await app.inject({ method: "POST", url: `/share/${link.id}/join`, payload: {} }));
    watching.report(tv, film({ req: { kind: "title", id: "tmdb:movie:604" }, name: "The Matrix Reloaded" }));
    const sync = await app.inject({ url: `/share/${link.id}/sync?since=0`, headers: { cookie } });
    expect(sync.json().problem).toBe("moved-on");
    expect((await app.inject({ url: `/share/${link.id}/info` })).json().problem).toBe("moved-on");

    watching.report(tv, film());
    const second = await share();
    await app.inject({ method: "POST", url: `/share/${second.id}/join`, payload: {} });
    expect((await app.inject({ method: "DELETE", url: `/api/share/${second.id}` })).statusCode).toBe(200);
    expect((await app.inject({ url: `/share/${second.id}/info` })).json().problem).toBe("expired");
    expect(watching.session("tv1")!.sync).toBeUndefined();
    expect(viewerDevice(second)).not.toContain(second.id);
  });
});

describe("the share tunnel", () => {
  it("knows a request that came through it", () => {
    expect(viaShareTunnel({ "cf-connecting-ip": "203.0.113.9", host: "hub:8080" }, undefined)).toBe(true);
    expect(viaShareTunnel({ host: "watch.example.com" }, "https://watch.example.com")).toBe(true);
    expect(viaShareTunnel({ host: "192.168.0.19:8095" }, "https://watch.example.com")).toBe(false);
  });

  it("lets only /share/ through it, and everything at home as before", async () => {
    const app = Fastify();
    onlyShareThroughTunnel(app, "https://watch.example.com");
    app.get("/api/health", async () => ({ ok: true }));
    app.get("/share/:token/info", async () => ({ name: "x" }));
    const tunnel = { "cf-connecting-ip": "203.0.113.9" };
    expect((await app.inject({ url: "/api/health", headers: tunnel })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/health", headers: { host: "watch.example.com" } })).statusCode).toBe(404);
    expect((await app.inject({ url: "/share/abcdefghijklmnopqrstuv/info", headers: tunnel })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
    await app.close();
  });
});
