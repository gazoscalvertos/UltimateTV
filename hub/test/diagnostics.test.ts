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
