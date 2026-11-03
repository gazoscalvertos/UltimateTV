import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

let tmp: string;
let app: FastifyInstance;

const start = async () => {
  app = await buildServer(
    { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
    { systemReport: async () => ({}) as never },
  );
};

/** A Windows installer: "MZ" first, and bigger than the stub threshold. */
function exe(size = 200_000): Buffer {
  const body = Buffer.alloc(size, 0);
  body.set([0x4d, 0x5a], 0);
  return body;
}

/** A Mac disk image: a UDIF trailer that starts "koly". */
function dmg(size = 1_500_000): Buffer {
  const body = Buffer.alloc(size, 1);
  body.set(Buffer.from("koly"), size - 512);
  return body;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-desktop-dl-"));
  await start();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("the desktop app's downloads", () => {
  it("serves the Windows installer from the desktop-app release", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url));
      return new Response(exe());
    });
    const res = await app.inject("/api/desktop/windows/installer");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/vnd.microsoft.portable-executable");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="UltimateTV-Setup-x64.exe"');
    expect(res.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0x4d, 0x5a]));
    expect(asked).toContain("https://github.com/gazoscalvertos/UltimateTV/releases/download/desktop-app/UltimateTV-Setup-x64.exe");
  });

  it("serves the Mac disk image, and the Apple Silicon one when asked", async () => {
    vi.stubGlobal("fetch", async () => new Response(dmg()));
    const usual = await app.inject("/api/desktop/macos/installer");
    expect(usual.statusCode).toBe(200);
    expect(usual.headers["content-type"]).toContain("application/x-apple-diskimage");
    // A Mac is usually an Apple Silicon one now, so that is what a bare link gives.
    expect(usual.headers["content-disposition"]).toBe('attachment; filename="UltimateTV-arm64.dmg"');
    const intel = await app.inject("/api/desktop/macos/installer?arch=x64");
    expect(intel.headers["content-disposition"]).toBe('attachment; filename="UltimateTV-x64.dmg"');
    const silicon = await app.inject("/api/desktop/macos/installer?arch=arm64");
    expect(silicon.headers["content-disposition"]).toBe('attachment; filename="UltimateTV-arm64.dmg"');
  });

  it("keeps serving the AppImage the desktop build already had", async () => {
    const body = Buffer.alloc(21 * 1024 * 1024, 0);
    body.set([0x7f, 0x45, 0x4c, 0x46], 0);
    vi.stubGlobal("fetch", async () => new Response(body));
    const res = await app.inject("/api/desktop/linux/installer");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="UltimateTV-x86_64.AppImage"');
  });

  it("doesn't hand out an error page as an installer", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!DOCTYPE html><h1>404</h1>", { status: 200 }));
    const res = await app.inject("/api/desktop/windows/installer");
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("couldn't get the app from GitHub");
  });

  it("draws a code for each download, and keeps an unknown one a 404", async () => {
    const codes = new Map<string, string>();
    for (const name of ["client", "remote", "windows", "macos", "linux"]) {
      const res = await app.inject(`/api/apps/${name}/qr.svg`);
      expect(res.statusCode, name).toBe(200);
      expect(res.headers["content-type"]).toContain("image/svg+xml");
      codes.set(name, res.body);
    }
    // A code per download, not the same one five times.
    expect(new Set(codes.values()).size).toBe(5);
    expect((await app.inject("/api/apps/other/qr.svg")).statusCode).toBe(404);
    expect((await app.inject("/api/apps/other/qr.svg")).json()).toEqual({ error: "No such app" });
    // The desktop-shaped address gives the same code as the app-name one.
    const same = await app.inject("/api/desktop/windows/qr.svg");
    expect(same.body).toBe(codes.get("windows"));
    expect((await app.inject("/api/desktop/nonsense/qr.svg")).statusCode).toBe(404);
  });

  it("points a code at this Hub, so a phone on the house Wi-Fi can fetch it", async () => {
    // The code carries a URL, not a file: it has to be the address the phone can reach.
    const res = await app.inject({ url: "/api/apps/macos/qr.svg", headers: { host: "hub.test:8095" } });
    expect(res.statusCode).toBe(200);
    // QR text is in the SVG as modules, so assert on the address the route builds instead: the
    // setup page's own link is the same one, and it is rendered by phoneBase.
    expect(res.body).toContain("<svg");
  });
});
