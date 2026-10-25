import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleReport } from "../../shared/test/fixtures.js";
import type { HubConfig } from "../src/config.js";
import { buildServer, HUB_VERSION } from "../src/server.js";
import type { SystemReport } from "../src/system.js";

const fakeSystem: SystemReport = {
  ffmpeg: "ffmpeg version 5.1.6",
  hwaccels: ["vaapi", "qsv"],
  renderNode: "/dev/dri/renderD128",
  vaapi: { available: true, driver: "Intel iHD driver", profiles: [] },
  checks: { av1HardwareDecode: true, hevcHardwareEncode: true, hevc10HardwareEncode: true },
};

let tmp: string;
let app: FastifyInstance;

async function start(overrides: Partial<HubConfig> = {}) {
  const config: HubConfig = {
    port: 0,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    ...overrides,
  };
  app = await buildServer(config, { systemReport: async () => fakeSystem });
  return app;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-hub-"));
});

afterEach(async () => {
  await app?.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("hub API", () => {
  it("never caches the TV app's page, so the TV picks up a Hub update", async () => {
    const uiDir = path.join(tmp, "ui");
    await mkdir(path.join(uiDir, "assets"), { recursive: true });
    await writeFile(path.join(uiDir, "index.html"), "<!doctype html>");
    await writeFile(path.join(uiDir, "assets", "index-abc.js"), "");
    await start({ uiDir });
    expect((await app.inject({ url: "/app/" })).headers["cache-control"]).toBe("no-cache");
    expect((await app.inject({ url: "/app/assets/index-abc.js" })).headers["cache-control"]).toContain("immutable");
  });

  it("reports health", async () => {
    await start();
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: HUB_VERSION });
  });

  it("returns the system report", async () => {
    await start();
    const res = await app.inject("/api/system");
    expect(res.json().checks.av1HardwareDecode).toBe(true);
  });

  it("stores a probe report and renders its matrix", async () => {
    await start();
    const post = await app.inject({ method: "POST", url: "/api/probe-reports", payload: sampleReport() });
    expect(post.statusCode).toBe(201);
    const { id } = post.json();

    const list = await app.inject("/api/probe-reports");
    expect(list.json().reports).toEqual([
      expect.objectContaining({ id, label: "Living room 85U7", chromiumVersion: "108.0.5359.215" }),
    ]);

    const report = await app.inject(`/api/probe-reports/${id}`);
    expect(report.json().device.webgl.renderer).toBe("Mali-G57");

    const matrix = await app.inject(`/api/probe-reports/${id}/matrix.md`);
    expect(matrix.headers["content-type"]).toContain("text/markdown");
    expect(matrix.body).toContain("# Capability matrix: Living room 85U7");
  });

  it("rejects invalid reports", async () => {
    await start();
    const res = await app.inject({ method: "POST", url: "/api/probe-reports", payload: { schema: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().problems).toContain("codecs must be an array");
  });

  it("does not read files outside the report folder", async () => {
    await start();
    const res = await app.inject("/api/probe-reports/..%2F..%2Fetc%2Fpasswd");
    expect(res.statusCode).toBe(404);
  });

  it("lists clips in manifest order and serves byte ranges", async () => {
    const clipsDir = path.join(tmp, "clips");
    await mkdir(clipsDir);
    await writeFile(path.join(clipsDir, "a-hdr10.mp4"), "0123456789");
    await writeFile(path.join(clipsDir, "b-dv.mkv"), "abcdefghij");
    await writeFile(path.join(clipsDir, "notes.txt"), "ignored");
    await writeFile(
      path.join(clipsDir, "clips.json"),
      JSON.stringify([{ file: "b-dv.mkv", title: "Dolby Vision P8", tests: "DV in MKV" }]),
    );
    await start();

    const res = await app.inject("/api/clips");
    expect(res.json().clips).toEqual([
      { file: "b-dv.mkv", title: "Dolby Vision P8", tests: "DV in MKV", sizeBytes: 10 },
      { file: "a-hdr10.mp4", title: "a-hdr10.mp4", sizeBytes: 10 },
    ]);

    const range = await app.inject({ url: "/clips/b-dv.mkv", headers: { range: "bytes=2-4" } });
    expect(range.statusCode).toBe(206);
    expect(range.body).toBe("cde");
  });

  it("returns no clips when the folder is missing", async () => {
    await start();
    expect((await app.inject("/api/clips")).json()).toEqual({ clips: [] });
  });

  it("redirects the root to the probe page and serves it", async () => {
    const probeDir = path.join(tmp, "probe");
    await mkdir(probeDir);
    await writeFile(path.join(probeDir, "index.html"), "<title>Probe</title>");
    await start();

    const root = await app.inject("/");
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe("/probe/");
    expect((await app.inject("/probe/")).body).toContain("<title>Probe</title>");
  });

  it("takes key presses and text from the phone remote", async () => {
    await start();
    expect((await app.inject({ method: "POST", url: "/api/remote/key", payload: { action: "ok" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/remote/key", payload: { action: "digit7" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/remote/key", payload: { action: "rm -rf" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/remote/text", payload: { text: "harbour" } })).json()).toEqual({ ok: true });
    const qr = await app.inject("/api/remote/qr.svg");
    expect(qr.headers["content-type"]).toContain("image/svg+xml");
  });

  it("understands voice commands from the phone", async () => {
    await start();
    expect((await app.inject({ method: "POST", url: "/api/remote/voice", payload: { text: "pause" } })).json()).toMatchObject({ kind: "keys", actions: ["pause"], heard: "pause", tvConnected: false });
    expect((await app.inject({ method: "POST", url: "/api/remote/voice", payload: { text: "search for dune" } })).json()).toMatchObject({ kind: "search", text: "dune" });
  });

  it("updates the Hub through the helper, and the box through the TV app", async () => {
    await start();
    const sw = (await app.inject("/api/software")).json();
    expect(sw).toMatchObject({ hub: { canUpdate: false, updating: false }, box: null, tvConnected: false });
    expect((await app.inject({ method: "POST", url: "/api/software/hub/update" })).statusCode).toBe(409);
    await mkdir(path.join(tmp, "data", "update"), { recursive: true });
    await writeFile(path.join(tmp, "data", "update", "helper"), "2026-10-25T10:00:00+00:00\n");
    await writeFile(path.join(tmp, "data", "update", "result"), "ok 2026-10-25T10:05:00+00:00\n");
    expect((await app.inject({ method: "POST", url: "/api/software/hub/update" })).statusCode).toBe(202);
    expect((await app.inject("/api/software")).json().hub).toMatchObject({ canUpdate: true, updating: true, lastUpdate: { ok: true, at: "2026-10-25T10:05:00+00:00" } });
    // No TV app on the event socket: the box can't be asked.
    expect((await app.inject({ method: "POST", url: "/api/box/update" })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: "/api/box/state", payload: { software: { commit: "abc", updating: false }, stats: true } });
    expect((await app.inject("/api/software")).json().box).toMatchObject({ software: { commit: "abc" }, stats: true });
  });
});

describe("diagnostics", () => {
  const report = {
    at: "2026-10-24T21:00:00.000Z",
    hostname: "ultimatetv",
    uptimeS: 600,
    load: [0.5, 0.4, 0.3],
    memory: { totalMb: 64000, freeMb: 60000 },
    software: { commit: "abc1234" },
    info: {},
    kscreen: { json: { outputs: [] }, text: "Output: 1 HDMI-A-1" },
    now: null,
    samples: [
      { at: "2026-10-24T20:59:50.000Z", status: "playing", frames: { dropped: 10, delayed: 20, mistimed: 5 } },
      { at: "2026-10-24T21:00:00.000Z", status: "playing", frames: { dropped: 12, delayed: 26, mistimed: 5 } },
    ],
    log: ["2026-10-24T20:59:00Z Playing http://user:pw@iptv.example/live/user/pw/1.ts"],
  };

  it("keeps the box's latest report and shows it as JSON and text, without logins", async () => {
    await start();
    expect((await app.inject({ method: "GET", url: "/api/diagnostics" })).json()).toMatchObject({ hub: { version: HUB_VERSION }, box: null });
    expect((await app.inject({ method: "POST", url: "/api/diagnostics/box", payload: { nope: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/diagnostics/box", payload: report })).statusCode).toBe(200);
    const json = (await app.inject({ method: "GET", url: "/api/diagnostics" })).json();
    expect(json.box.report.hostname).toBe("ultimatetv");
    expect(json.box.report.log[0]).toBe("2026-10-24T20:59:00Z Playing http://iptv.example/…");
    const text = (await app.inject({ method: "GET", url: "/api/diagnostics?format=text" })).body;
    expect(text).toContain("Output: 1 HDMI-A-1");
    expect(text).toContain("drop 12+2");
    expect(text).toContain("late 26+6");
    expect(text).not.toContain("pw");
  });

  it("keeps every box log line and playback sample in rolling files", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/diagnostics/box", payload: report });
    await app.inject({ method: "POST", url: "/api/diagnostics/box", payload: { ...report, log: [...report.log, "2026-10-24T21:00:30Z Player idle"], samples: [...report.samples, { at: "2026-10-24T21:00:10.000Z", status: "playing" }] } });
    const box = (await app.inject({ method: "GET", url: "/api/diagnostics/logs/box" })).body.trim().split("\n");
    expect(box).toEqual(["2026-10-24T20:59:00Z Playing http://iptv.example/…", "2026-10-24T21:00:30Z Player idle"]);
    const playback = (await app.inject({ method: "GET", url: "/api/diagnostics/logs/playback?lines=2" })).body.trim().split("\n");
    expect(playback.map((l) => JSON.parse(l).at)).toEqual(["2026-10-24T21:00:00.000Z", "2026-10-24T21:00:10.000Z"]);
    expect((await app.inject({ method: "GET", url: "/api/diagnostics/logs/secrets" })).statusCode).toBe(404);
  });

  it("survives a Hub restart", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/diagnostics/box", payload: report });
    await app.close();
    await start();
    expect((await app.inject({ method: "GET", url: "/api/diagnostics" })).json().box.report.hostname).toBe("ultimatetv");
  });
});
