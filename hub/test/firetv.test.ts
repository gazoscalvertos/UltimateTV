// The same app, built for a Fire TV or a Fire stick (#183). The Hub serves it the way it serves the
// phone's app — its own route, its own cache, its own QR code on the setup page — but it comes from a
// different Android flavour with no Google Play services in it, so the client app's tests say nothing
// about it. This asks the running Hub for the download, the code and the version file the setup page
// reads, and reads the page itself to be sure the download is actually offered there.
//
// What it can't cover: that the `firetv` flavour in android/client builds, that Fire OS will install
// the APK, and that a stick on the house Wi-Fi can reach the Hub. Those need a Fire stick.

import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

const root = new URL("../../", import.meta.url).pathname;

let tmp: string;
let app: FastifyInstance;
/** What GitHub answers this test, so no run of this file touches the network. */
let github: () => Response;

/** A stand-in for the APK: a zip that is big enough for the app's own check. */
function apk(size = 40_000): Buffer {
  const body = Buffer.alloc(size, 0);
  body.set([0x50, 0x4b, 0x03, 0x04], 0);
  return body;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-firetv-"));
  // An error page rather than an APK, which is what GitHub answers for a release that isn't there.
  github = () => new Response("<!DOCTYPE html><h1>404</h1>", { status: 200 });
  // The routes take `fetch` when the server is built, so the stub has to be in place first. It reads
  // `github` on every call, so a test can change what GitHub says without building another Hub.
  vi.stubGlobal("fetch", async () => github());
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

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("the Fire TV app's download", () => {
  it("says so plainly when it can't get the APK yet", async () => {
    // Nothing cached and nothing real to fetch: a stick that taps Download must see why it is empty
    // rather than a broken file or an error page saved as an app.
    const res = await app.inject("/api/firetv/app.apk");
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("couldn't get the app from GitHub");
    // Nothing half-downloaded is left behind for the next attempt to serve.
    expect(() => readFileSync(path.join(tmp, "data/firetv-app/ultimatetv-firetv.apk"))).toThrow();
  });

  it("hands over the APK as a download once it has a copy", async () => {
    github = () => new Response(apk());
    const res = await app.inject("/api/firetv/app.apk");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/vnd.android.package-archive");
    // The name the stick saves it under, which is what a sideload expects to find.
    expect(res.headers["content-disposition"]).toBe('attachment; filename="ultimatetv-firetv.apk"');
    expect(res.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0x50, 0x4b]));
    // Cached under its own tag, not in the phone app's folder: the two versions update separately.
    expect(readFileSync(path.join(tmp, "data/firetv-app/ultimatetv-firetv.apk")).length).toBe(40_000);
  });

  it("draws a code for it, from the same address the setup page links to", async () => {
    const res = await app.inject({ url: "/api/apps/firetv/qr.svg", headers: { host: "hub.test:8095" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.body).toContain("<svg");
    // The code's text is in the SVG as modules, not as a readable URL, so generate the code the
    // route should have made and compare the drawings: this is what pins it to /api/firetv/app.apk
    // rather than to the phone's app or to nothing at all.
    const expected = await QRCode.toString("http://hub.test:8095/api/firetv/app.apk", { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
    expect(res.body).toBe(expected);
  });

  it("gives the Fire TV its own code, and the desktop-shaped address the same one", async () => {
    const firetv = (await app.inject({ url: "/api/apps/firetv/qr.svg", headers: { host: "hub.test:8095" } })).body;
    const client = (await app.inject({ url: "/api/apps/client/qr.svg", headers: { host: "hub.test:8095" } })).body;
    // Two downloads, two codes: a code that scanned to the phone's app would be worse than none.
    expect(firetv).not.toBe(client);
    // /api/desktop/:kind/qr.svg goes through appDownloadPath too, so this is the route that fails if
    // the "firetv" name stops resolving there.
    const same = await app.inject({ url: "/api/desktop/firetv/qr.svg", headers: { host: "hub.test:8095" } });
    expect(same.statusCode).toBe(200);
    expect(same.body).toBe(firetv);
    // And an app that doesn't exist is still refused.
    expect((await app.inject("/api/apps/nonsense/qr.svg")).statusCode).toBe(404);
  });
});

describe("the version the Hub offers", () => {
  it("is the version this test expects, so the setup page can tell a stick to update", () => {
    const file = "hub/public/setup/firetv-app.json";
    const version = JSON.parse(readFileSync(path.join(root, file), "utf8")) as { versionCode: number; versionName: string; uninstallBelow?: number };
    expect(version.versionCode, `${file} isn't the version this test expects — update it`).toBe(17);
    // Android refuses to install over the old signing key, so the Hub has to be able to say which
    // builds are on it; a missing uninstallBelow leaves the household with "App not installed".
    expect(version.uninstallBelow, `${file} has no uninstallBelow — update it`).toBe(12);
    expect(version.versionName, `${file} has no versionName — update it`).toBe("0.7.4");
  });

  it("is offered on the setup page, with a code and a link of its own", () => {
    const page = readFileSync(path.join(root, "hub/public/setup/index.html"), "utf8");
    // The box the household taps, next to the Android one: its own code, link, download and version.
    expect(page).toContain('src="/api/apps/firetv/qr.svg"');
    expect(page).toContain('href="/api/firetv/app.apk" download');
    expect(page).toContain('id="firetv-app-link"');
    expect(page).toContain('id="firetv-app-version"');
    expect(page).toContain("UltimateTV</span> for Fire TV");
    // Both filling loops have to know about it, or the box shows a dead link and no version.
    expect(page).toMatch(/\["\/api\/firetv\/app\.apk", "#firetv-app-link"\]/);
    expect(page).toMatch(/\["\/setup\/firetv-app\.json", "#firetv-app-version"\]/);
  });
});
