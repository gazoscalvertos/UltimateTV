import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "../src/db.js";
import { applyPendingRestore, movedAway } from "../src/move.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let restarts = 0;
const dataDir = () => path.join(tmp, "data");
const start = async () => {
  const app = await buildServer(
    { port: 0, host: "127.0.0.1", dataDir: dataDir(), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false },
    { systemReport: async () => ({}) as never, restart: () => restarts++ },
  );
  await pairAsTv(app);
  return app;
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-move-"));
  restarts = 0;
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("moving the Hub", () => {
  it("hands over its data with the scare clips, then stands by until the trip's data comes back", async () => {
    const app = await start();
    app.hub.db.setKv("marker", "home");
    await mkdir(path.join(dataDir(), "scare-clips"), { recursive: true });
    await writeFile(path.join(dataDir(), "scare-clips", "boo.mp4"), "boo");

    const out = await app.inject({ url: "/api/hub/move-out" });
    expect(out.statusCode).toBe(200);
    const key = String(out.headers["x-move-key"]);
    expect(key.length).toBeGreaterThan(20);
    const archive = path.join(tmp, "out.tar.gz");
    await writeFile(archive, out.rawPayload);
    const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
    expect(files).toContain("hub.db");
    expect(files).toContain("scare-clips/boo.mp4");
    expect(movedAway(app.hub.db)).toBeTruthy();
    expect((await app.inject({ url: "/api/health" })).json().movedAway).toBe(true);
    expect(restarts).toBe(1);
    // The copy that left hasn't got the "moved away" mark.
    const box = path.join(tmp, "box");
    await mkdir(box);
    execFileSync("tar", ["-xzf", archive, "-C", box]);
    const copy = new Db(path.join(box, "hub.db"));
    expect(copy.getKv("hub-moved")).toBeUndefined();
    expect(copy.getKv("marker")).toBe("home");
    copy.setKv("marker", "hotel");
    copy.close();
    // Only once.
    expect((await app.inject({ url: "/api/hub/move-out" })).statusCode).toBe(409);

    // Coming home: the wrong key is refused, the right one is kept for the next start.
    const back = path.join(tmp, "back.tar.gz");
    execFileSync("tar", ["-czf", back, "-C", box, "hub.db", "scare-clips"]);
    const body = await readFile(back);
    expect((await app.inject({ method: "POST", url: "/api/hub/move-in", headers: { "content-type": "application/gzip", "x-move-key": "nope" }, payload: body })).statusCode).toBe(403);
    const res = await app.inject({ method: "POST", url: "/api/hub/move-in", headers: { "content-type": "application/gzip", "x-move-key": key }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(restarts).toBe(2);
    await app.close();

    expect(applyPendingRestore(dataDir(), { info: () => undefined, error: () => undefined })).toBe(true);
    expect(readdirSync(dataDir()).some((f) => f.startsWith("before-restore-"))).toBe(true);
    const again = await start();
    expect(again.hub.db.getKv("marker")).toBe("hotel");
    expect(movedAway(again.hub.db)).toBeUndefined();
    await again.close();
  });

  it("calls the move off with the key", async () => {
    const app = await start();
    const key = String((await app.inject({ url: "/api/hub/move-out" })).headers["x-move-key"]);
    expect((await app.inject({ method: "DELETE", url: "/api/hub/move", headers: { "x-move-key": "wrong" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/hub/move", headers: { "x-move-key": key } })).statusCode).toBe(200);
    expect(movedAway(app.hub.db)).toBeUndefined();
    await app.close();
  });

  it("lends the music video files with the key, and takes back new files from the trip", async () => {
    const app = await start();
    const video = path.join(tmp, "Music Videos", "song.mp4");
    await mkdir(path.dirname(video), { recursive: true });
    await writeFile(video, "music");
    (app.hub.mix as { travelFiles(): string[] }).travelFiles = () => [video, path.join(tmp, "gone.jpg")];
    const key = String((await app.inject({ url: "/api/hub/move-out" })).headers["x-move-key"]);
    const h = { "x-move-key": key };

    expect((await app.inject({ url: "/api/hub/move-files", headers: { "x-move-key": "nope" } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/hub/move-files", headers: h })).json()).toEqual({ files: [{ path: video, size: 5 }] });
    const got = await app.inject({ url: `/api/hub/move-file?path=${encodeURIComponent(video)}`, headers: h });
    expect(got.body).toBe("music");
    expect((await app.inject({ url: `/api/hub/move-file?path=${encodeURIComponent(path.join(dataDir(), "hub.db"))}`, headers: h })).statusCode).toBe(404);

    const recording = path.join(tmp, "Recordings", "Show", "ep.ts");
    const put = (file: string, headers: Record<string, string> = h) =>
      app.inject({ method: "PUT", url: `/api/hub/move-file?path=${encodeURIComponent(file)}`, headers: { ...headers, "content-type": "application/octet-stream" }, payload: Buffer.from("recorded") });
    expect((await put(recording, { "x-move-key": "nope" })).statusCode).toBe(403);
    expect((await put(recording)).statusCode).toBe(200);
    expect(await readFile(recording, "utf8")).toBe("recorded");
    expect((await put(video)).json()).toEqual({ ok: true, kept: true });
    expect(await readFile(video, "utf8")).toBe("music");
    expect((await put(path.join(tmp, "..", "outside.ts"))).statusCode).toBe(400);
    await app.close();
  });

  it("only hands the data to something paired in the last 15 minutes", async () => {
    const app = await start();
    const old = Date.now() - 20 * 60_000;
    app.hub.db.setKv("paired-devices", (app.hub.db.getKv<{ pairedAt: number }[]>("paired-devices") ?? []).map((d) => ({ ...d, pairedAt: old })));
    const res = await app.inject({ url: "/api/hub/move-out" });
    expect(res.statusCode).toBe(403);
    expect(movedAway(app.hub.db)).toBeUndefined();
    await app.close();
  });

  it("sets a bad archive aside and keeps the data it had", async () => {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(path.join(dataDir(), "restore.tar.gz"), "not a tarball");
    expect(applyPendingRestore(dataDir(), { info: () => undefined, error: () => undefined })).toBe(false);
    expect(existsSync(path.join(dataDir(), "restore.tar.gz"))).toBe(false);
  });
});
