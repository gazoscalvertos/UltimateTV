import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipSeasonFor, DEFAULT_SCARE_SETTINGS, easterSunday, scareFrom, type ClipLibrary, type ClipPackFile, type HubEvent, type ScareState } from "@ultimatetv/shared";
import { checkIndex, checkPack, svgProblem } from "../src/clippacks.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><circle cx="5" cy="5" r="4" fill="url(#g)"/></svg>');

/** A small, sound pack: a snowman with sleigh bells, walking along the bottom. */
const pack = (over: Partial<ClipPackFile> = {}): ClipPackFile => ({
  format: "ultimatetv.clips",
  version: 1,
  id: "test-christmas",
  name: "Test Christmas",
  theme: "christmas",
  clips: [
    { key: "snowman", name: "Snowman", type: "image/svg+xml", data: SVG.toString("base64") },
    { key: "bells", name: "Bells", type: "audio/mpeg", data: MP3.toString("base64") },
  ],
  mixes: [{ name: "Snowman walks by", visual: "snowman", audio: "bells", spot: "bottom", size: "medium", motion: "walk-left", seconds: 15 }],
  ...over,
});

let tmp: string;
let app: FastifyInstance & { hub: { events: { on(fn: (e: HubEvent) => void): () => void } } };

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-packs-"));
  app = await buildServer({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false }, { systemReport: async () => ({}) as never });
  await pairAsTv(app);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const state = async () => (await app.inject({ url: "/api/scares" })).json() as ScareState;

describe("occasions", () => {
  const on = (iso: string) => clipSeasonFor("auto", new Date(`${iso}T12:00:00`));

  it("goes by the date on auto", () => {
    expect(on("2026-10-31")).toBe("halloween");
    expect(on("2026-11-05")).toBe("bonfire");
    expect(on("2026-12-01")).toBe("christmas");
    expect(on("2026-12-25")).toBe("christmas");
    expect(on("2026-12-31")).toBe("newyear");
    expect(on("2027-01-01")).toBe("newyear");
    expect(on("2027-02-14")).toBe("valentines");
    expect(on("2027-03-28")).toBe("easter");
    expect(on("2027-03-21")).toBe("easter");
    expect(on("2027-03-29")).toBe("easter");
    expect(on("2027-03-31")).toBe("everyday");
    expect(on("2026-07-01")).toBe("everyday");
    expect(clipSeasonFor("birthday", new Date("2026-12-25T12:00:00"))).toBe("birthday");
  });

  it("knows when Easter is", () => {
    expect(easterSunday(2026).toDateString()).toBe(new Date(2026, 3, 5).toDateString());
    expect(easterSunday(2027).toDateString()).toBe(new Date(2027, 2, 28).toDateString());
    expect(easterSunday(2030).toDateString()).toBe(new Date(2030, 3, 21).toDateString());
  });

  it("only picks the occasion's clips at random, and draws a scare only at Halloween", () => {
    const settings = { ...DEFAULT_SCARE_SETTINGS, season: "christmas" as const };
    const mix = (id: string, theme?: "christmas" | "halloween") => ({ id, name: id, visualId: "v", spot: "bottom" as const, size: "small" as const, muteVideo: false, seconds: 0, createdAt: 0, ...(theme ? { theme } : {}) });
    const clips = [{ id: "v", name: "v", kind: "image" as const, url: "/v", sizeBytes: 1, addedAt: 0 }];
    const s = { settings, clips, mixes: [mix("snow", "christmas"), mix("old")] };
    for (const r of [0, 0.5, 0.99]) expect(scareFrom(s, {}, false, () => r)?.mixId).toBe("snow");
    // An old built scare (no occasion) is Halloween's.
    expect(scareFrom(s, { theme: "halloween" }, false, () => 0)?.mixId).toBe("old");
    expect(scareFrom({ ...s, mixes: [] }, {}, false)).toBeUndefined();
    const drawn = scareFrom({ settings: { ...settings, season: "halloween" }, clips: [], mixes: [] }, {}, false);
    expect(drawn).toMatchObject({ theme: "halloween" });
    expect(drawn?.clip).toBeUndefined();
  });
});

describe("checking packs", () => {
  it("takes a sound pack", () => {
    const checked = checkPack(Buffer.from(JSON.stringify(pack())));
    expect(checked).toMatchObject({ id: "test-christmas", theme: "christmas" });
    expect(checked.clips.map((c) => c.kind)).toEqual(["image", "audio"]);
    expect(checked.mixes[0]).toMatchObject({ motion: "walk-left", spot: "bottom", seconds: 15, theme: "christmas" });
  });

  it("refuses a pack that isn't right", () => {
    expect(() => checkPack(Buffer.from("not json"))).toThrow(/isn't a clip pack/);
    expect(() => checkPack(pack({ id: "../etc" }))).toThrow(/id/);
    expect(() => checkPack(pack({ theme: "summer" as never }))).toThrow(/theme/);
    expect(() => checkPack(pack({ version: 2 as never }))).toThrow(/newer/);
    expect(() => checkPack(pack({ mixes: [{ name: "x", visual: "missing" }] }))).toThrow(/doesn't have/);
    expect(() => checkPack(pack({ mixes: [{ name: "x", audio: "snowman" }] }))).toThrow(/sound/);
    expect(() => checkPack(pack({ clips: [{ key: "snowman", name: "x", type: "application/x-sh", data: Buffer.from("#!/bin/sh\nrm -rf /").toString("base64") }] }))).toThrow(/Send an MP4/);
    expect(() => checkPack(pack({ clips: [{ key: "big", name: "x", type: "image/gif", data: Buffer.concat([GIF, Buffer.alloc(16 * 1024 * 1024)]).toString("base64") }], mixes: [{ name: "x", visual: "big" }] }))).toThrow(/too big/);
  });

  it("won't keep an SVG that could run or load anything", () => {
    expect(svgProblem(SVG)).toBeUndefined();
    expect(svgProblem(Buffer.from('<svg><script>alert(1)</script></svg>'))).toMatch(/script/);
    expect(svgProblem(Buffer.from('<svg><rect onload="alert(1)"/></svg>'))).toMatch(/event/);
    expect(svgProblem(Buffer.from('<svg><image href="https://example.com/x.png"/></svg>'))).toMatch(/elsewhere/);
    expect(svgProblem(Buffer.from('<svg><foreignObject><div/></foreignObject></svg>'))).toMatch(/web page/);
    expect(svgProblem(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'))).toMatch(/entities/);
    const bad = pack({ clips: [{ key: "snowman", name: "x", type: "image/svg+xml", data: Buffer.from("<svg><script>1</script></svg>").toString("base64") }], mixes: [{ name: "x", visual: "snowman" }] });
    expect(() => checkPack(bad)).toThrow(/script/);
  });

  it("passes the starter packs that ship with the Hub", async () => {
    for (const id of ["christmas", "easter", "valentines", "birthday", "halloween", "fireworks"]) {
      const p = checkPack(await readFile(path.join(__dirname, `../packs/${id}-starter.utvpack`)));
      expect(p.mixes.length).toBeGreaterThan(0);
    }
  });

  it("reads a community list, skipping entries from anywhere but GitHub", () => {
    const entry = { id: "snow", name: "Snow", theme: "christmas", sha256: "a".repeat(64), sizeBytes: 100 };
    const list = checkIndex(
      {
        format: "ultimatetv.clip-index",
        version: 1,
        packs: [
          { ...entry, url: "packs/snow.utvpack" },
          { ...entry, id: "evil", url: "https://evil.example/x.utvpack" },
          { ...entry, id: "plain", url: "http://raw.githubusercontent.com/x" },
          { ...entry, id: "nosum", sha256: "nope", url: "packs/x.utvpack" },
        ],
      },
      "https://raw.githubusercontent.com/o/r/main/community/clips/index.json",
    );
    expect(list.map((p) => p.id)).toEqual(["snow"]);
    expect(list[0]!.url).toBe("https://raw.githubusercontent.com/o/r/main/community/clips/packs/snow.utvpack");
  });
});

describe("packs on the Hub", () => {
  it("brings a pack in, shows its clip, and takes it all away again", async () => {
    const res = await app.inject({ method: "POST", url: "/api/scares/packs", headers: { "content-type": "application/octet-stream" }, payload: Buffer.from(JSON.stringify(pack())) });
    expect(res.statusCode).toBe(200);
    let s = await state();
    expect(s.packs).toHaveLength(1);
    expect(s.clips).toHaveLength(2);
    expect(s.clips.every((c) => c.packId === "test-christmas")).toBe(true);
    expect(s.mixes[0]).toMatchObject({ name: "Snowman walks by", theme: "christmas", motion: "walk-left", packId: "test-christmas" });

    // The SVG comes back as a picture that can't run anything.
    const svg = await app.inject({ url: s.clips.find((c) => c.kind === "image")!.url });
    expect(svg.headers["content-type"]).toBe("image/svg+xml");
    expect(String(svg.headers["content-security-policy"])).toContain("sandbox");

    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    await app.inject({ method: "POST", url: "/api/scares/now", payload: { theme: "christmas" } });
    const scare = events.find((e) => e.type === "scare");
    expect(scare?.type === "scare" && scare.scare).toMatchObject({ motion: "walk-left", theme: "christmas", spot: "bottom", seconds: 15 });

    // The same pack again replaces it rather than doubling up.
    await app.inject({ method: "POST", url: "/api/scares/packs", payload: pack() });
    expect((await state()).clips).toHaveLength(2);

    expect((await app.inject({ method: "DELETE", url: "/api/scares/packs/test-christmas" })).statusCode).toBe(200);
    s = await state();
    expect(s.packs).toEqual([]);
    expect(s.clips).toEqual([]);
    expect(s.mixes).toEqual([]);
  });

  it("says when an occasion has nothing to show", async () => {
    const res = await app.inject({ method: "POST", url: "/api/scares/now", payload: { theme: "easter" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/Easter/);
  });

  it("exports built clips as a pack another Hub can bring in", async () => {
    const gif = (await app.inject({ method: "POST", url: "/api/scares/clips?name=Bunny", headers: { "content-type": "image/gif" }, payload: GIF })).json().clip;
    const { mix } = (await app.inject({ method: "POST", url: "/api/scares/mixes", payload: { visualId: gif.id, theme: "easter", motion: "hop-right", spot: "bottom", seconds: 12 } })).json();
    const out = await app.inject({ method: "POST", url: "/api/scares/packs/export", payload: { name: "Our Easter", mixIds: [mix.id] } });
    expect(out.statusCode).toBe(200);
    expect(out.headers["content-disposition"]).toMatch(/\.utvpack"/);
    const file = out.json() as ClipPackFile;
    expect(file).toMatchObject({ format: "ultimatetv.clips", name: "Our Easter", theme: "easter" });
    expect(file.mixes[0]).toMatchObject({ motion: "hop-right", theme: "easter" });

    // Brought back in, it's a pack of its own beside the original.
    await app.inject({ method: "POST", url: "/api/scares/packs", payload: file });
    const s = await state();
    expect(s.packs?.[0]?.name).toBe("Our Easter");
    expect(s.mixes.filter((m) => m.theme === "easter")).toHaveLength(2);
  });

  it("makes a share link with a page, a QR code and the pack", async () => {
    await app.inject({ method: "POST", url: "/api/scares/packs", payload: pack() });
    const mixId = (await state()).mixes[0]!.id;
    const { share } = (await app.inject({ method: "POST", url: "/api/scares/shares", payload: { name: "<Snow>", mixIds: [mixId] } })).json();
    expect(share.url).toMatch(/\/clips\/share\/[0-9a-f]+$/);
    const page = await app.inject({ url: `/clips/share/${share.id}` });
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.body).toContain("&#60;Snow&#62;");
    expect(page.body).toContain("Snowman walks by");
    expect((await app.inject({ url: share.qr })).headers["content-type"]).toBe("image/svg+xml");
    const file = (await app.inject({ url: `/api/scares/shares/${share.id}/pack` })).json() as ClipPackFile;
    expect(() => checkPack(file)).not.toThrow();
  });

  it("plays an occasion on a loop until told to stop", async () => {
    expect((await app.inject({ method: "POST", url: "/api/scares/loop", payload: { theme: "valentines" } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/api/scares/packs", payload: pack() });
    expect(((await app.inject({ method: "POST", url: "/api/scares/loop", payload: { theme: "christmas" } })).json() as ScareState).looping).toBe("christmas");
    expect((await state()).looping).toBe("christmas");
    expect(((await app.inject({ method: "POST", url: "/api/scares/loop", payload: { theme: null } })).json() as ScareState).looping).toBeNull();
  });

  it("lists and installs the starter packs", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404, statusText: "Not Found" }));
    const lib = (await app.inject({ url: "/api/scares/library" })).json() as ClipLibrary;
    expect(lib.starter.map((p) => p.id)).toEqual(expect.arrayContaining(["christmas-starter", "easter-starter", "halloween-starter"]));
    expect(lib.community.error).toMatch(/404/);
    const res = await app.inject({ method: "POST", url: "/api/scares/library/install", payload: { id: "christmas-starter", from: "starter" } });
    expect(res.statusCode).toBe(200);
    expect((await state()).mixes.some((m) => m.name === "Snowman walks by" && m.motion === "walk-left")).toBe(true);
    expect(((await app.inject({ url: "/api/scares/library" })).json() as ClipLibrary).starter.find((p) => p.id === "christmas-starter")?.installed).toBe(true);
  });

  it("installs a community pack only when its checksum matches", async () => {
    const body = Buffer.from(JSON.stringify(pack({ id: "community-snow" })));
    const sum = createHash("sha256").update(body).digest("hex");
    let served = body;
    const index = { format: "ultimatetv.clip-index", version: 1, packs: [{ id: "community-snow", name: "Snow", theme: "christmas", sizeBytes: body.length, sha256: sum, url: "packs/community-snow.utvpack" }] };
    vi.stubGlobal("fetch", async (url: URL | string) => (String(url).endsWith("index.json") ? new Response(JSON.stringify(index)) : new Response(served)));
    const lib = (await app.inject({ url: "/api/scares/library" })).json() as ClipLibrary;
    expect(lib.community.packs.map((p) => p.id)).toEqual(["community-snow"]);

    served = Buffer.from(JSON.stringify(pack({ id: "community-snow", name: "Tampered" })));
    const bad = await app.inject({ method: "POST", url: "/api/scares/library/install", payload: { id: "community-snow", from: "community" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/checksum/);

    served = body;
    const good = await app.inject({ method: "POST", url: "/api/scares/library/install", payload: { id: "community-snow", from: "community" } });
    expect(good.statusCode).toBe(200);
    expect((await state()).packs?.[0]).toMatchObject({ id: "community-snow", source: "community" });
  });
});
