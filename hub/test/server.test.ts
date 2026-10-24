import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleReport } from "../../shared/test/fixtures.js";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
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
  it("reports health", async () => {
    await start();
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: "0.1.0" });
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
});
