import { describe, expect, it } from "vitest";
import { LogRing } from "../src/diagnostics.js";

describe("the Hub's log ring", () => {
  it("keeps readable lines, skips routine requests and redacts addresses", () => {
    const ring = new LogRing();
    ring.add(`${JSON.stringify({ level: 30, time: 0, msg: "incoming request", req: {} })}\n`);
    ring.add(`${JSON.stringify({ level: 30, time: 0, msg: "request completed", res: { statusCode: 200 } })}\n`);
    ring.add(`${JSON.stringify({ level: 30, time: 0, msg: "request completed", res: { statusCode: 502 } })}\n`);
    ring.add(`${JSON.stringify({ level: 50, time: 0, msg: "Relay failed", url: "http://u:p@iptv.example/live/u/p/1.ts" })}\n`);
    expect(ring.list()).toEqual([
      '1970-01-01T00:00:00.000Z INFO request completed {"res":{"statusCode":502}}',
      '1970-01-01T00:00:00.000Z ERROR Relay failed {"url":"http://iptv.example/…"}',
    ]);
  });
});

describe("rolling log files", () => {
  it("roll over at their size limit, keep a fixed number of old files and tail across them", async () => {
    const { mkdtemp, readdir } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { RollingFile } = await import("../src/diagnostics.js");
    const dir = await mkdtemp(path.join(os.tmpdir(), "utv-logs-"));
    const file = new RollingFile(path.join(dir, "hub.log"), 100, 2);
    for (let i = 0; i < 40; i++) file.append(`line ${String(i).padStart(3, "0")}\n`);
    expect((await readdir(dir)).sort()).toEqual(["hub.log", "hub.log.1", "hub.log.2"]);
    const tail = await file.tail(15);
    expect(tail).toHaveLength(15);
    expect(tail.at(-1)).toBe("line 039");
    expect(tail[0]).toBe("line 025");
  });

  it("writes debug lines to the file but only info and up to the ring", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { RollingFile } = await import("../src/diagnostics.js");
    const dir = await mkdtemp(path.join(os.tmpdir(), "utv-logs-"));
    const ring = new LogRing({ file: new RollingFile(path.join(dir, "hub.log")), stdoutLevel: "fatal" });
    ring.stream.write(`${JSON.stringify({ level: 20, time: 0, msg: "Fetching guide", url: "http://u:p@epg.example/x.xml.gz" })}\n`);
    ring.stream.write(`${JSON.stringify({ level: 30, time: 0, msg: "Guide loaded" })}\n`);
    expect(ring.list()).toEqual(["1970-01-01T00:00:00.000Z INFO Guide loaded"]);
    const text = await readFile(path.join(dir, "hub.log"), "utf8");
    expect(text).toContain('DEBUG Fetching guide {"url":"http://epg.example/…"}');
    expect(text).toContain("INFO Guide loaded");
  });
});
