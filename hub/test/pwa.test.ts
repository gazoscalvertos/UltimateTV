// Installing the remote on an iPhone (#129). iOS Safari has no install prompt: it reads a manifest,
// an apple-touch-icon and a set of apple-* meta tags, and "Add to Home Screen" takes what it finds.
// None of that is checkable in a browser here, but most of what can silently go wrong is in the
// files themselves — a manifest with a start_url the Hub doesn't serve, an icon that is not really a
// PNG, a page that never links the manifest — so this asks the running Hub for each of them and looks
// at the bytes. What it can't cover: that Safari's own Add to Home Screen actually works, and that
// the service worker's cache behaves over a bad connection. Those need a phone.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

const root = new URL("../../", import.meta.url).pathname;

let tmp: string;
let app: FastifyInstance;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-pwa-"));
  const config: HubConfig = {
    port: 0,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    uiDir: path.join(tmp, "ui"),
    setupDir: path.join(tmp, "setup"),
    // The real remote directory, so this reads what the Hub actually ships and serves.
    remoteDir: path.join(root, "hub/public/remote"),
    mediaRoot: tmp,
    demo: false,
  };
  app = await buildServer(config, { systemReport: async () => ({}) as never });
});

afterAll(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

/** Reads a PNG's width and height out of its IHDR, and fails if the file isn't a PNG at all. */
const pngSize = (body: Buffer): { width: number; height: number } => {
  // The 8-byte signature: high bit set, then "PNG" and a CRLF/LF pair. Getting this wrong is what a
  // truncated or text file does, so the rest of the numbers would be meaningless.
  expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(body.toString("ascii", 12, 16)).toBe("IHDR"); // the first chunk after the signature
  // A 512×512 truecolour image is ~13KB; anything tiny is a placeholder rather than a drawing.
  expect(body.length).toBeGreaterThan(1000);
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
};

const get = async (url: string) => {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, `${url} answered ${res.statusCode}`).toBe(200);
  return res;
};

describe("the remote as an app you can install", () => {
  it("serves a manifest that points at where the remote really lives", async () => {
    const res = await get("/remote/manifest.webmanifest");
    expect(res.headers["content-type"]).toContain("manifest+json");
    const manifest = res.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    // Without an absolute start_url and a scope that contains it, Safari opens the remote at the
    // wrong address (or refuses to install it at all), so these have to match what the Hub serves.
    expect(manifest.start_url).toBe("/remote/");
    expect(manifest.scope).toBe("/remote/");
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    // The remote's own dark blue, so the splash screen doesn't flash white.
    expect(manifest.background_color.toLowerCase()).toBe("#070b14");
    expect(manifest.theme_color.toLowerCase()).toBe("#070b14");
  });

  it("declares an icon for every size a phone asks for, and serves each as a real PNG", async () => {
    const manifest = (await get("/remote/manifest.webmanifest")).json();
    const icons: { src: string; sizes: string; type: string }[] = manifest.icons;
    expect(icons.length).toBeGreaterThan(0);
    // 180 is the apple-touch-icon, which is what iOS puts on the Home Screen; 192 and 512 are what
    // Android and Chrome want. All three, or one of the two phones gets a blank tile.
    for (const size of [180, 192, 512]) {
      expect(icons.map((i) => i.sizes), `no ${size}x${size} icon in the manifest`).toContain(`${size}x${size}`);
    }
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      const res = await get(`/remote/${icon.src}`);
      expect(res.headers["content-type"]).toContain("image/png");
      const { width, height } = pngSize(res.rawPayload);
      const [wantW, wantH] = icon.sizes.split("x").map(Number);
      expect({ width, height }, `${icon.src} is the wrong size`).toEqual({ width: wantW, height: wantH });
    }
  });

  it("serves the service worker, and it leaves the Hub's state alone", async () => {
    const res = await get("/remote/sw.js");
    const worker = res.body;
    // A service worker is only allowed to be a script from the Hub's own address, and the remote
    // registers it as "sw.js" from /remote/, so it has to be served there.
    expect(res.headers["content-type"]).toContain("javascript");
    expect(worker).toContain("addEventListener(\"install\"");
    expect(worker).toContain("addEventListener(\"activate\"");
    expect(worker).toContain("addEventListener(\"fetch\"");
    // The Hub's state changes every second: a cached answer would be a lie about what's on the TV.
    expect(worker).toMatch(/pathname\.startsWith\("\/api\/"\)/);
    // A new Hub deploy must not leave the old page on the phone: the cache is named per version and
    // every other cache is deleted when the new worker takes over.
    expect(worker).toMatch(/const SHELL = "[^"]+"/);
    expect(worker).toContain("caches.delete");
  });

  it("tells iOS where the manifest and the Home Screen icon are", async () => {
    const html = (await get("/remote/")).body;
    // Safari reads these and nothing else: without the manifest link there is no install at all,
    // and without the apple-touch-icon the tile is a screenshot of the page.
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain("icon-180.png");
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(html).toContain('name="apple-mobile-web-app-title"');
    expect(html).toContain('name="theme-color"');
    // And the page it is served from is the one the manifest claims.
    expect(html).toContain("sw.js");
  });

  it("shows the iPhone its Add to Home Screen hint, and only there", async () => {
    const html = (await get("/remote/")).body;
    expect(html).toContain('id="ios-hint"');
    // Hidden until the script has decided this is iOS Safari and the remote is not already installed.
    expect(html).toMatch(/id="ios-hint"[^>]*hidden/);
    expect(html).toContain("Add to Home Screen");
    // The three conditions that decide it, and the dismissal being remembered.
    expect(html).toContain("navigator.standalone");
    expect(html).toMatch(/display-mode: standalone/);
    expect(html).toContain("utv-ios-hint");
  });
});
