// Radio (#86): the preset stations, the household's own, what a stream says it's playing, and the
// stream a station plays from. No network: every answer comes from a stand-in fetch.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlaybackInfo, RadioStation } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { icyNowPlaying, Radio, RadioError } from "../src/radio.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

/** A stream that answers with ICY metadata after an eight-byte audio block, as the real ones do. */
function streamWith(song: string | null): typeof fetch {
  const call = async () => {
    if (!song) return new Response(new Uint8Array(64), { status: 200, headers: { "content-type": "audio/mpeg" } });
    // Metadata is UTF-8: the names on these streams are full of en dashes and accents.
    const text = new TextEncoder().encode(`StreamTitle='${song}';`);
    const frames = Math.ceil(text.length / 16);
    const meta = new Uint8Array(frames * 16);
    meta.set(text);
    const body = new Uint8Array(8 + 1 + meta.length);
    body.set(meta, 9);
    body[8] = frames;
    return new Response(body, { status: 200, headers: { "content-type": "audio/mpeg", "icy-metaint": "8" } });
  };
  return call as unknown as typeof fetch;
}

const noFetch = (async () => new Response("not here", { status: 404 })) as typeof fetch;

async function start(fetchImpl: typeof fetch = noFetch) {
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl, ytdlp: null });
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-radio-"));
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const family = { "x-profile": "family" };
const kids = { "x-profile": "kids" };
const stations = async (headers: Record<string, string> = family) => (await app.inject({ url: "/api/radio", headers })).json().stations as RadioStation[];

describe("the stations the Hub knows about", () => {
  it("ships a list of UK stations, each with a name, a genre and a stream address", async () => {
    await start();
    const all = await stations();
    expect(all.length).toBeGreaterThan(20);
    for (const s of all) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.url).toMatch(/^https?:\/\//);
      expect(s.source).toBe("preset");
    }
    // Two big ones, to be sure the list isn't a handful of oddities.
    expect(all.some((s) => s.name === "BBC Radio 2")).toBe(true);
    expect(all.some((s) => s.name === "Classic FM")).toBe(true);
  });

  it("gives a Kids profile only the stations meant for children", async () => {
    await start();
    const grown = await stations(family);
    const little = await stations(kids);
    expect(little.length).toBeGreaterThan(0);
    expect(little.length).toBeLessThan(grown.length);
    expect(little.every((s) => s.kidsOnly === true)).toBe(true);
    expect(little.map((s) => s.name)).toContain("Fun Kids");
    // And a grown-up's list still has them, so a parent can find them on the TV.
    expect(grown.map((s) => s.name)).toContain("Fun Kids");
  });

  it("lets the household add one of its own, and take it away again", async () => {
    await start();
    const added = await app.inject({ method: "POST", url: "/api/radio", headers: family, payload: { name: "Radio Garden", url: "https://example.com/garden.mp3" } });
    expect(added.statusCode).toBe(200);
    const mine = added.json().station as RadioStation;
    expect(mine.source).toBe("custom");
    expect((await stations()).map((s) => s.id)).toContain(mine.id);

    const gone = await app.inject({ method: "DELETE", url: `/api/radio/${encodeURIComponent(mine.id)}`, headers: family });
    expect(gone.statusCode).toBe(200);
    expect((await stations()).map((s) => s.id)).not.toContain(mine.id);
  });

  it("keeps the household's stations across a restart", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/radio", headers: family, payload: { name: "Radio Garden", url: "https://example.com/garden.mp3" } });
    await app.close();
    await start();
    expect((await stations()).map((s) => s.name)).toContain("Radio Garden");
  });

  it("says no to an address that isn't a stream, a duplicate, and a second attempt at the same one", async () => {
    await start();
    const bad = await app.inject({ method: "POST", url: "/api/radio", headers: family, payload: { name: "Nothing", url: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/http/i);
    const nameless = await app.inject({ method: "POST", url: "/api/radio", headers: family, payload: { name: "  ", url: "https://example.com/a.mp3" } });
    expect(nameless.statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/radio", headers: family, payload: { name: "One", url: "https://example.com/a.mp3" } });
    const twice = await app.inject({ method: "POST", url: "/api/radio", headers: family, payload: { name: "Two", url: "https://example.com/a.mp3" } });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error).toMatch(/already/i);
  });

  it("won't let a Kids profile name a station it can't see by voice", async () => {
    await start();
    // A grown-up asking for Classic FM gets it; a Kids profile saying the same thing is a search,
    // so the TV isn't told to play a station it would then refuse.
    const grown = await app.inject({ method: "POST", url: "/api/remote/voice", headers: family, payload: { text: "play Classic FM" } });
    expect(grown.json()).toMatchObject({ kind: "radio", stationId: "radio:classic-fm" });
    const little = await app.inject({ method: "POST", url: "/api/remote/voice", headers: kids, payload: { text: "play Classic FM" } });
    expect(little.json().kind).toBe("search");
    const fun = await app.inject({ method: "POST", url: "/api/remote/voice", headers: kids, payload: { text: "play Fun Kids" } });
    expect(fun.json()).toMatchObject({ kind: "radio", stationId: "radio:fun-kids" });
  });

  it("won't let a Kids profile add or remove a station", async () => {
    await start();
    const add = await app.inject({ method: "POST", url: "/api/radio", headers: kids, payload: { name: "Nope", url: "https://example.com/a.mp3" } });
    expect(add.statusCode).toBe(403);
    expect(add.json().code).toBe("pin");
  });
});

describe("what a station is playing", () => {
  it("reads the song out of the stream's metadata", async () => {
    // The reader takes the audio block, the length byte and the metadata block, then stops.
    const now = await icyNowPlaying(streamWith("Northern Lights — The Harbour Band"), "https://example.com/a.mp3");
    expect(now).toBe("Northern Lights — The Harbour Band");
  });

  it("says nothing when the stream sends no metadata", async () => {
    expect(await icyNowPlaying(streamWith(null), "https://example.com/a.mp3")).toBeUndefined();
  });

  it("says nothing rather than failing when the stream is unreachable", async () => {
    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await icyNowPlaying(dead, "https://example.com/a.mp3")).toBeUndefined();
  });

  it("answers the route with the song, and reuses it rather than asking twice in a moment", async () => {
    let asked = 0;
    const counting = (async (...args: Parameters<typeof fetch>) => {
      asked++;
      return streamWith("Golden Hour — Kira Vale")(...args);
    }) as typeof fetch;
    await start(counting);
    const station = (await stations())[0]!;
    const first = await app.inject({ url: `/api/radio/${encodeURIComponent(station.id)}/now`, headers: family });
    expect(first.json().now).toBe("Golden Hour — Kira Vale");
    const again = await app.inject({ url: `/api/radio/${encodeURIComponent(station.id)}/now`, headers: family });
    expect(again.json().now).toBe("Golden Hour — Kira Vale");
    expect(asked).toBe(1);
  });

  it("404s for a station nobody has", async () => {
    await start();
    const res = await app.inject({ url: "/api/radio/radio%3Anope/now", headers: family });
    expect(res.statusCode).toBe(404);
  });
});

describe("playing a station", () => {
  it("answers with a live stream the TV can hand straight to the box", async () => {
    await start();
    const station = (await stations()).find((s) => s.name === "BBC Radio 2")!;
    const res = await app.inject({ url: `/api/radio/${encodeURIComponent(station.id)}/play`, headers: family });
    expect(res.statusCode).toBe(200);
    const info = res.json() as PlaybackInfo;
    expect(info.url).toBe(station.url);
    expect(info.title).toBe("BBC Radio 2");
    expect(info.live).toBe(true);
    expect(info.startMs).toBe(0);
    // Its own key: a station has no place to keep, so nothing lands in Continue watching.
    expect(info.progressKey).toBe(`radio:${station.id}`);
  });

  it("won't play a station a Kids profile can't see", async () => {
    await start();
    const station = (await stations(family)).find((s) => s.name === "Classic FM")!;
    const res = await app.inject({ url: `/api/radio/${encodeURIComponent(station.id)}/play`, headers: kids });
    expect(res.statusCode).toBe(404);
  });
});

describe("the radio store on its own", () => {
  it("tolerates junk left in the database", () => {
    const radio = new Radio({ getKv: () => "not a list", setKv: () => undefined } as never, noFetch);
    expect(radio.custom()).toEqual([]);
    const half = new Radio({ getKv: () => [{ id: "x", name: "Real", url: "https://example.com/a.mp3" }, { id: "", name: "No id", url: "https://example.com/b.mp3" }, { id: "y", name: "No url" }, 7], setKv: () => undefined } as never, noFetch);
    expect(half.custom().map((s) => s.name)).toEqual(["Real"]);
  });

  it("complains plainly when an address can't be used", () => {
    const radio = new Radio({ getKv: () => undefined, setKv: () => undefined } as never, noFetch);
    expect(() => radio.add({ name: "Bad", url: "not a url" })).toThrow(RadioError);
    expect(() => radio.add({ name: "", url: "https://example.com/a.mp3" })).toThrow(/name/i);
  });
});
