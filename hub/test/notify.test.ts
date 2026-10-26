import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent } from "@ultimatetv/shared";
import { buildServer } from "../src/server.js";

// The smallest PNG: one transparent pixel.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let tmp: string;
let app: FastifyInstance & { hub: { events: { on(fn: (e: HubEvent) => void): () => void } } };
let camera: Server | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-notify-"));
  app = await buildServer({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false }, { systemReport: async () => ({}) as never });
});

afterEach(async () => {
  await app.close();
  camera?.close();
  camera = undefined;
  await rm(tmp, { recursive: true, force: true });
});

describe("notices on the TV", () => {
  it("needs something to show", async () => {
    expect((await app.inject({ method: "POST", url: "/api/notify", payload: { title: "  " } })).statusCode).toBe(400);
  });

  it("fills in each kind's look and tells the TV", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    const res = await app.inject({ method: "POST", url: "/api/notify", payload: { kind: "doorbell", title: "Someone's at the door", position: "Bottom Right" } });
    expect(res.statusCode).toBe(200);
    const { notice } = res.json();
    expect(notice).toMatchObject({ kind: "doorbell", title: "Someone's at the door", position: "bottom-right", size: "large", sound: "chime", pause: false, muted: false });
    expect(notice.until - notice.at).toBe(30_000);
    expect(events).toContainEqual({ type: "notice", notice });
    const alarm = (await app.inject({ method: "POST", url: "/api/notify", payload: { kind: "alarm", text: "Wake up", position: "centre" } })).json().notice;
    expect(alarm).toMatchObject({ position: "center", sound: "alarm", wake: true, until: null, leftMs: null });
    expect((await app.inject("/api/notify")).json().notices.map((n: { kind: string }) => n.kind)).toEqual(["doorbell", "alarm"]);
  });

  it("replaces a notice with the same id and takes them down", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    await app.inject({ method: "POST", url: "/api/notify", payload: { id: "door", title: "Ring 1" } });
    await app.inject({ method: "POST", url: "/api/notify", payload: { id: "door", title: "Ring 2", seconds: 5 } });
    await app.inject({ method: "POST", url: "/api/notify", payload: { title: "Other" } });
    const list = (await app.inject("/api/notify")).json().notices;
    expect(list.map((n: { title: string }) => n.title)).toEqual(["Ring 2", "Other"]);
    await app.inject({ method: "DELETE", url: "/api/notify/door" });
    expect(events.at(-1)).toEqual({ type: "notice.clear", id: "door" });
    expect((await app.inject("/api/notify")).json().notices).toHaveLength(1);
    await app.inject({ method: "DELETE", url: "/api/notify" });
    expect((await app.inject("/api/notify")).json().notices).toEqual([]);
  });

  it("takes a picture as the body with the rest in the query string", async () => {
    const res = await app.inject({ method: "POST", url: "/api/notify?kind=doorbell&title=Front%20door&seconds=10&pause=1", headers: { "content-type": "image/png" }, payload: PNG });
    expect(res.statusCode).toBe(200);
    const { notice } = res.json();
    expect(notice).toMatchObject({ title: "Front door", pause: true });
    expect(notice.until - notice.at).toBe(10_000);
    const pic = await app.inject(notice.image);
    expect(pic.headers["content-type"]).toBe("image/png");
    expect(pic.rawPayload.equals(PNG)).toBe(true);
  });

  it("keeps data: pictures and works out an unlabelled upload", async () => {
    const { notice } = (await app.inject({ method: "POST", url: "/api/notify", payload: { title: "Hi", image: `data:image/png;base64,${PNG.toString("base64")}` } })).json();
    expect(notice.image).toMatch(/^\/api\/notify\/media\//);
    const up = (await app.inject({ method: "POST", url: "/api/notify/media", headers: { "content-type": "application/octet-stream" }, payload: PNG })).json();
    expect(up.kind).toBe("image");
    expect((await app.inject(up.url)).headers["content-type"]).toBe("image/png");
    expect((await app.inject({ method: "POST", url: "/api/notify/media", headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("hello") })).statusCode).toBe(400);
  });

  it("fetches a camera snapshot at once, with its headers, and falls back to the address", async () => {
    let auth: string | undefined;
    camera = createServer((req, res) => {
      auth = req.headers.authorization;
      if (req.url === "/missing") return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
    });
    await new Promise<void>((r) => camera!.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(camera.address() as AddressInfo).port}`;
    const ok = (await app.inject({ method: "POST", url: "/api/notify", payload: { title: "Door", image: `${base}/snap.png`, headers: { Authorization: "Bearer abc" } } })).json();
    expect(auth).toBe("Bearer abc");
    expect(ok.notice.image).toMatch(/^\/api\/notify\/media\//);
    expect(ok.warnings).toBeUndefined();
    const missing = (await app.inject({ method: "POST", url: "/api/notify", payload: { title: "Door", image: `${base}/missing` } })).json();
    expect(missing.notice.image).toBe(`${base}/missing`);
    expect(missing.warnings[0]).toContain("HTTP 404");
    expect((await app.inject({ method: "POST", url: "/api/notify", payload: { image: "file:///etc/passwd" } })).statusCode).toBe(400);
  });
});
