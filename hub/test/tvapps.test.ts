// The Samsung and LG apps' screens on the Hub (docs/tv-updates.md): what the shell on the TV asks for.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { TV_APP_FILES, tvAppManifest } from "../src/tvapps.js";

let tmp: string;
let app: Awaited<ReturnType<typeof buildServer>>;
const repo = (p: string) => new URL(`../../${p}`, import.meta.url).pathname;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-tvapps-"));
  const config: HubConfig = {
    port: 8095,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    uiDir: path.join(tmp, "ui"),
    setupDir: path.join(tmp, "setup"),
    remoteDir: path.join(tmp, "remote"),
    samsungDir: repo("samsung"),
    lgDir: repo("lg"),
    mediaRoot: path.join(tmp, "media"),
    demo: true,
  };
  app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
});

afterAll(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("TV app files on the Hub", () => {
  it("lists every file in load order with a version that follows their content", async () => {
    const res = await app.inject({ method: "GET", url: "/tv/samsung/manifest.json" });
    expect(res.statusCode).toBe(200);
    const m = res.json() as { version: string; scripts: string[]; styles: string[] };
    expect(m.scripts).toEqual(TV_APP_FILES.scripts);
    expect(m.styles).toEqual(TV_APP_FILES.styles);
    expect(m.version).toMatch(/^[0-9a-f]{12}$/);
    expect(tvAppManifest(repo("samsung"))?.version).toBe(m.version);
    expect(tvAppManifest(repo("lg"))?.version).not.toBe(m.version);
    expect(tvAppManifest(path.join(tmp, "nothing"))).toBeUndefined();
  });

  it("serves the files the manifest names", async () => {
    for (const name of ["samsung", "lg"]) {
      for (const f of [...TV_APP_FILES.styles, ...TV_APP_FILES.scripts]) {
        const res = await app.inject({ method: "GET", url: `/tv/${name}/${f}` });
        expect(res.statusCode, `${name}/${f}`).toBe(200);
      }
    }
  });

  it("lets a packaged TV app (no web origin) call the Hub, and nobody else", async () => {
    const pre = await app.inject({ method: "OPTIONS", url: "/api/home", headers: { origin: "file://", "access-control-request-method": "GET", "access-control-request-headers": "x-device-token" } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("*");
    expect(String(pre.headers["access-control-allow-headers"])).toContain("X-Device-Token");
    const get = await app.inject({ method: "GET", url: "/tv/lg/manifest.json", headers: { origin: "null" } });
    expect(get.headers["access-control-allow-origin"]).toBe("*");
    const web = await app.inject({ method: "GET", url: "/tv/lg/manifest.json", headers: { origin: "https://example.com" } });
    expect(web.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
