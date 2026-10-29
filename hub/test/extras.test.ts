// The everyday extras: watchlist, sleep and save-for-later by voice, alerts, advert skipping,
// screen sharing and links, and seasonal projections with the community clip library.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS, type HubEvent, type Recording, type WatchItem } from "@ultimatetv/shared";
import { AdSkipper } from "../src/adskip.js";
import { currentAlerts, deliver } from "../src/alerts.js";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { parseVoice } from "../src/voice.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };
let requests: { url: string; init?: RequestInit }[];
/** Answers for the fake fetch, by URL. */
let answers: Record<string, () => Response>;

const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: String(url), ...(init ? { init } : {}) });
  const answer = answers[String(url)];
  return answer ? answer() : new Response("not here", { status: 404 });
}) as typeof fetch;

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-extras-"));
  requests = [];
  answers = {};
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const events = () => {
  const seen: HubEvent[] = [];
  app.hub.events.on((e) => seen.push(e));
  return seen;
};

describe("the watchlist", () => {
  const film = { id: "tmdb:movie:438631", kind: "movie", name: "Dune", year: 2021, poster: "/p.jpg", progress: 0.4 };

  it("saves titles and names, moves a repeat to the front and shows them on Home", async () => {
    const seen = events();
    expect((await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: film, from: "phone" } })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { name: "The Bear" } });
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: film } });
    const items = (await app.inject("/api/watchlist")).json().items as WatchItem[];
    expect(items.map((i) => i.name)).toEqual(["Dune", "The Bear"]);
    expect(items[0]!.title).toEqual({ id: film.id, kind: "movie", name: "Dune", year: 2021, poster: "/p.jpg" });
    expect(seen.filter((e) => e.type === "watchlist.changed")).toHaveLength(3);
    const home = (await app.inject("/api/home")).json();
    const rail = home.rails.find((r: { id: string }) => r.id === "watchlist");
    // Only things with a title to open are on Home; the name waits until a source has it.
    expect(rail.items.map((t: { name: string }) => t.name)).toEqual(["Dune"]);
  });

  it("removes by its own id or the title's", async () => {
    const { item } = (await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: film } })).json();
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { name: "Severance" } });
    expect((await app.inject({ method: "DELETE", url: `/api/watchlist/${encodeURIComponent(film.id)}` })).json().items).toHaveLength(1);
    expect(item.id).toMatch(/^w/);
    expect((await app.inject({ method: "POST", url: "/api/watchlist", payload: {} })).statusCode).toBe(400);
  });

  it("shows what a phone saved (no profile) on every profile's list", async () => {
    const family = { "x-profile": "family" };
    await app.inject({ method: "POST", url: "/api/watchlist", payload: { title: film, from: "phone" } });
    await app.inject({ method: "POST", url: "/api/watchlist", headers: family, payload: { name: "Severance" } });
    const names = (await app.inject({ url: "/api/watchlist", headers: family })).json().items.map((i: WatchItem) => i.name);
    expect(names.sort()).toEqual(["Dune", "Severance"]);
    expect((await app.inject("/api/watchlist")).json().items.map((i: WatchItem) => i.name)).toEqual(["Dune"]);
    // Taking it off one profile's list takes it off the household's too.
    await app.inject({ method: "DELETE", url: `/api/watchlist/${encodeURIComponent(film.id)}`, headers: family });
    expect((await app.inject("/api/watchlist")).json().items).toEqual([]);
  });
});

describe("voice", () => {
  it("saves for later and sets the sleep timer", () => {
    expect(parseVoice("save Dune for later", [])).toMatchObject({ kind: "save", name: "dune" });
    expect(parseVoice("add The Bear to my watchlist", [])).toMatchObject({ kind: "save", name: "the bear" });
    expect(parseVoice("sleep in 30 minutes", [])).toMatchObject({ kind: "sleep", minutes: 30 });
    expect(parseVoice("turn off in an hour", [])).toMatchObject({ kind: "sleep", minutes: 60 });
    expect(parseVoice("sleep timer half an hour", [])).toMatchObject({ kind: "sleep", minutes: 30 });
    expect(parseVoice("turn off at the end of this", [])).toMatchObject({ kind: "sleep", minutes: "end" });
    expect(parseVoice("cancel the sleep timer", [])).toMatchObject({ kind: "sleep", minutes: "off" });
  });

  it("tells the TV to sleep, from a phone or a script", async () => {
    const seen = events();
    expect((await app.inject({ method: "POST", url: "/api/tv/sleep", payload: { minutes: 45 } })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/api/remote/voice", payload: { text: "sleep at the end of this" } });
    expect(seen.filter((e) => e.type === "sleep").map((e) => (e as { choice: unknown }).choice)).toEqual([{ minutes: 45 }, { end: true }]);
    expect((await app.inject({ method: "POST", url: "/api/tv/sleep", payload: { minutes: -1 } })).statusCode).toBe(400);
  });
});

describe("alerts", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const day = 86_400_000;

  it("warns before subscriptions run out, and when the guide or NAS is in trouble", () => {
    const alerts = currentAlerts({
      now,
      settings: DEFAULT_ALERT_SETTINGS,
      iptv: [
        { id: "a", name: "Main", expires: now + 10 * day, ok: true },
        { id: "b", name: "Spare", expires: now + 60 * day, ok: false, error: "Login refused" },
      ],
      torboxExpires: now + 2 * day,
      epgUpdatedAt: now - 30 * 3600_000,
      diskFreeBytes: 20 * 1024 ** 3,
      events: [],
    });
    expect(alerts.map((a) => [a.key, a.level])).toEqual([
      ["iptv-load:b", "bad"],
      ["torbox-expiry", "bad"],
      ["iptv-expiry:a", "warn"],
      ["epg-stale", "warn"],
      ["disk-full", "warn"],
    ]);
    expect(alerts.find((a) => a.key === "iptv-expiry:a")!.title).toBe("The Main IPTV subscription runs out in 10 days");
  });

  it("sends to Home Assistant and ntfy", async () => {
    answers["http://ha.local/api/webhook/tv"] = () => new Response("", { status: 200 });
    answers["https://ntfy.sh/our-tv"] = () => new Response("", { status: 200 });
    await deliver({ key: "k", level: "bad", title: "The NAS is nearly full", message: "5 GB left." }, { ...DEFAULT_ALERT_SETTINGS, webhookUrl: "http://ha.local/api/webhook/tv", ntfyUrl: "https://ntfy.sh/our-tv" }, "GazosTV", fakeFetch);
    const ha = requests.find((r) => r.url.includes("webhook"))!;
    expect(JSON.parse(String(ha.init!.body))).toMatchObject({ app: "GazosTV", level: "bad", title: "The NAS is nearly full" });
    const ntfy = requests.find((r) => r.url.includes("ntfy"))!;
    expect((ntfy.init!.headers as Record<string, string>).Priority).toBe("high");
    expect(ntfy.init!.body).toBe("5 GB left.");
  });

  it("raises live TV failures from the TV once, and sends them", async () => {
    answers["https://ntfy.sh/our-tv"] = () => new Response("", { status: 200 });
    await app.inject({ method: "PUT", url: "/api/alerts/settings", payload: { ntfyUrl: "https://ntfy.sh/our-tv", expiryDays: 7 } });
    const res = (await app.inject({ method: "POST", url: "/api/alerts/playback", payload: { what: "BBC One", error: "No signal" } })).json();
    expect(res.told).toBe(true);
    await app.inject({ method: "POST", url: "/api/alerts/playback", payload: { what: "BBC One", error: "No signal" } });
    const state = (await app.inject("/api/alerts")).json();
    expect(state.settings.expiryDays).toBe(7);
    expect(state.alerts.map((a: { key: string }) => a.key)).toContain("playback:bbc one");
    expect(requests.filter((r) => r.url.includes("ntfy"))).toHaveLength(1);
  });

  it("needs somewhere to send a test to", async () => {
    expect((await app.inject({ method: "POST", url: "/api/alerts/test" })).statusCode).toBe(400);
  });
});

describe("advert skipping", () => {
  const recording = (extra: Partial<Recording> = {}): Recording => ({
    id: "r1",
    programme: { id: "p1", channelId: "itv", start: 0, end: 3600_000, title: "Quiz Night", categories: [], isNew: false, isRepeat: false, isFilm: false },
    channelId: "itv",
    channelName: "ITV1",
    status: "completed",
    method: "live",
    start: 0,
    end: 3600_000,
    incomplete: false,
    path: path.join(tmp, "Quiz Night.mkv"),
    watched: false,
    positionMs: 0,
    createdAt: 0,
    ...extra,
  });

  it("keeps the breaks comskip finds and offers them to the player", async () => {
    app.hub.recordings.save(recording());
    const skipper = new AdSkipper(app.hub, path.join(tmp, "data"), async (args) => {
      const out = args.find((a) => a.startsWith("--output="))!.slice(9);
      await writeFile(path.join(out, "Quiz Night.edl"), "0.00\t2.00\t0\n600.00\t780.50\t0\n783.00\t800.00\t0\n");
      return { code: 0, stdout: "", stderr: "" };
    });
    const r = await skipper.scan("r1");
    expect(r?.adScan).toBe("done");
    expect(r?.adBreaks).toEqual([{ startMs: 600_000, endMs: 800_000 }]);
    const info = (await app.inject({ method: "POST", url: "/api/play", payload: { kind: "recording", id: "r1" } })).json();
    expect(info.skip).toEqual([{ kind: "adverts", startMs: 600_000, endMs: 800_000 }]);
    expect(info.autoSkipAdverts).toBeUndefined();
    await app.inject({ method: "PUT", url: "/api/adskip", payload: { mode: "auto" } });
    expect((await app.inject({ method: "POST", url: "/api/play", payload: { kind: "recording", id: "r1" } })).json().autoSkipAdverts).toBe(true);
  });

  it("says so when comskip isn't installed", async () => {
    app.hub.recordings.save(recording());
    const skipper = new AdSkipper(app.hub, path.join(tmp, "data"), async () => {
      throw Object.assign(new Error("spawn comskip ENOENT"), { code: "ENOENT" });
    });
    expect((await skipper.scan("r1"))?.adScan).toBe("unavailable");
    expect(skipper.installed()).toBe(false);
  });
});

describe("screen sharing and links", () => {
  const offer = { name: "Gary's laptop", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" };

  it("asks the TV, passes its answer back and ends when either side stops", async () => {
    const seen = events();
    const s = (await app.inject({ method: "POST", url: "/api/cast/share", payload: offer })).json();
    expect(s.status).toBe("waiting");
    const told = seen.find((e) => e.type === "cast.share") as Extract<HubEvent, { type: "cast.share" }>;
    expect(told.offer).toMatchObject({ id: s.id, name: "Gary's laptop" });
    const polling = app.inject(`/api/cast/share/${s.id}?seen=waiting`);
    await app.inject({ method: "POST", url: `/api/cast/share/${s.id}/answer`, payload: { sdp: "v=0\r\nanswer" } });
    expect((await polling).json()).toMatchObject({ status: "accepted", answer: "v=0\r\nanswer" });
    await app.inject({ method: "DELETE", url: `/api/cast/share/${s.id}` });
    expect((await app.inject(`/api/cast/share/${s.id}`)).json().status).toBe("ended");
    expect(seen.some((e) => e.type === "cast.share.end")).toBe(true);
  });

  it("can be turned off, and the TV can say no", async () => {
    const s = (await app.inject({ method: "POST", url: "/api/cast/share", payload: offer })).json();
    await app.inject({ method: "POST", url: `/api/cast/share/${s.id}/refuse`, payload: { reason: "Not now" } });
    expect((await app.inject(`/api/cast/share/${s.id}`)).json()).toMatchObject({ status: "refused", reason: "Not now" });
    await app.inject({ method: "PUT", url: "/api/cast/settings", payload: { screenShare: false } });
    expect((await app.inject({ method: "POST", url: "/api/cast/share", payload: offer })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/cast/share", payload: { sdp: "nope" } })).statusCode).toBe(403);
  });

  it("sends links from a phone to the TV, digging them out of shared text", async () => {
    const seen = events();
    const res = (await app.inject({ method: "POST", url: "/api/cast/link", payload: { url: "Watch this! https://youtu.be/dQw4w9WgXcQ" } })).json();
    expect(res).toMatchObject({ url: "https://youtu.be/dQw4w9WgXcQ", title: "YouTube" });
    expect(seen.find((e) => e.type === "cast.link")).toMatchObject({ link: { url: "https://youtu.be/dQw4w9WgXcQ" } });
    expect((await app.inject({ method: "POST", url: "/api/cast/link", payload: { url: "file:///etc/passwd" } })).statusCode).toBe(400);
  });
});

describe("seasonal projections and the community library", () => {
  const index = "https://example.org/clips/index.json";

  it("sends a drawn one when nothing is uploaded, and one asked for by hand", async () => {
    const seen = events();
    await app.inject({ method: "PUT", url: "/api/projections", payload: { season: "christmas" } });
    const state = (await app.inject("/api/projections")).json();
    expect(state.season).toBe("christmas");
    expect((await app.inject({ method: "POST", url: "/api/projections/now", payload: {} })).statusCode).toBe(200);
    const sent = seen.find((e) => e.type === "projection") as Extract<HubEvent, { type: "projection" }>;
    expect(["sleigh", "snow", "presents"]).toContain(sent.projection.drawn);
    await app.inject({ method: "POST", url: "/api/projections/now", payload: { drawn: "bunny" } });
    expect((seen.filter((e) => e.type === "projection").pop() as Extract<HubEvent, { type: "projection" }>).projection.drawn).toBe("bunny");
  });

  it("downloads community clips into the library as projections, kept out of the jump scares", async () => {
    const gif = Buffer.from("GIF89a" + "\0".repeat(20), "latin1");
    answers[index] = () => Response.json({ clips: [{ id: "sleigh-1", name: "Sleigh", season: "christmas", use: "projection", motion: "across-top", file: "files/sleigh.gif", type: "image/gif", author: "Gary" }, { id: "bad id!", name: "x", file: "x", type: "image/gif" }] });
    answers["https://example.org/clips/files/sleigh.gif"] = () => new Response(gif, { headers: { "content-type": "image/gif" } });
    await app.inject({ method: "PUT", url: "/api/projections", payload: { communityUrl: index } });
    const lib = (await app.inject("/api/community/clips")).json();
    expect(lib.clips).toEqual([expect.objectContaining({ id: "sleigh-1", url: "https://example.org/clips/files/sleigh.gif", downloaded: false })]);
    const dl = (await app.inject({ method: "POST", url: "/api/community/clips/sleigh-1/download" })).json();
    expect(dl.library.clips[0].downloaded).toBe(true);
    const state = (await app.inject("/api/projections")).json();
    expect(state.clips).toEqual([expect.objectContaining({ name: "Sleigh", season: "christmas", motion: "across-top", communityId: "sleigh-1" })]);
    expect((await app.inject("/api/scares")).json().clips).toEqual([]);
    // Turning it into a jump scare moves it across.
    await app.inject({ method: "PATCH", url: `/api/scares/clips/${dl.clip.id}`, payload: { projection: false } });
    expect((await app.inject("/api/scares")).json().clips).toHaveLength(1);
    expect((await app.inject("/api/projections")).json().clips).toEqual([]);
  });

  it("says why when the library can't be read", async () => {
    await app.inject({ method: "PUT", url: "/api/projections", payload: { communityUrl: index } });
    expect((await app.inject("/api/community/clips")).json()).toMatchObject({ clips: [], error: "The library answered 404" });
    expect((await app.inject({ method: "PUT", url: "/api/projections", payload: { communityUrl: "ftp://x" } })).statusCode).toBe(400);
  });

  it("tags uploads as projections", async () => {
    await mkdir(path.join(tmp, "x"), { recursive: true });
    const res = await app.inject({ method: "POST", url: "/api/scares/clips?name=Bunny&projection=1&season=easter&motion=across-bottom", headers: { "content-type": "image/png" }, payload: Buffer.from("89504e470d0a1a0a0000", "hex") });
    expect(res.statusCode).toBe(200);
    expect((await app.inject("/api/projections")).json().clips).toEqual([expect.objectContaining({ name: "Bunny", season: "easter", motion: "across-bottom" })]);
  });
});
