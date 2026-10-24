import { describe, expect, it } from "vitest";
import { ConnectionBusyError, ConnectionGuard } from "../src/connections.js";

describe("ConnectionGuard (one connection)", () => {
  const guard = () => new ConnectionGuard(() => 1);

  it("shares one lease between holders of the same key", () => {
    const g = guard();
    g.acquire({ key: "live:bbc1", holder: "box", kind: "view", label: "Watching BBC One" });
    g.acquire({ key: "live:bbc1", holder: "recording:1", kind: "record", label: "Recording BBC One" });
    expect(g.status().used).toBe(1);
    g.release("live:bbc1", "box");
    expect(g.status().used).toBe(1);
    g.release("live:bbc1", "recording:1");
    expect(g.status().used).toBe(0);
  });

  it("lets a viewer change channel by pre-empting its own old stream", () => {
    const g = guard();
    const revoked: string[] = [];
    g.acquire({ key: "live:bbc1", holder: "box", kind: "view", label: "a", onRevoke: (r) => revoked.push(r) });
    g.acquire({ key: "live:bbc2", holder: "box", kind: "view", label: "b" });
    expect(revoked).toHaveLength(1);
    expect(g.status().holders).toEqual(["b"]);
  });

  it("refuses to stop a recording unless forced", () => {
    const g = guard();
    let stopped = false;
    g.acquire({ key: "live:bbc1", holder: "recording:7", kind: "record", label: "Recording", onRevoke: () => (stopped = true) });
    expect(() => g.acquire({ key: "live:bbc2", holder: "box", kind: "view", label: "Watching" })).toThrow(ConnectionBusyError);
    try {
      g.acquire({ key: "live:bbc2", holder: "box", kind: "view", label: "Watching" });
    } catch (e) {
      expect((e as ConnectionBusyError).blockingRecordings).toEqual(["7"]);
    }
    g.acquire({ key: "live:bbc2", holder: "box", kind: "view", label: "Watching", force: true });
    expect(stopped).toBe(true);
  });

  it("lets a recording take the viewer's connection", () => {
    const g = guard();
    let viewerEnded = "";
    g.acquire({ key: "live:bbc1", holder: "box", kind: "view", label: "Watching", onRevoke: (r) => (viewerEnded = r) });
    g.acquire({ key: "live:bbc2", holder: "recording:1", kind: "record", label: "BBC Two" });
    expect(viewerEnded).toMatch(/^recording:/);
  });

  it("background downloads give way and only start when idle", () => {
    const g = guard();
    let aborted = false;
    expect(g.idle()).toBe(true);
    g.acquire({ key: "catchup", holder: "recording:2", kind: "background", label: "Fetching", onRevoke: () => (aborted = true) });
    g.acquire({ key: "live:bbc1", holder: "box", kind: "view", label: "Watching" });
    expect(aborted).toBe(true);
    expect(g.idle()).toBe(false);
    expect(() => g.acquire({ key: "catchup2", holder: "recording:3", kind: "background", label: "x" })).toThrow(ConnectionBusyError);
  });

  it("expires idle short-lived leases", () => {
    let t = 0;
    const g = new ConnectionGuard(() => 1, () => t);
    g.acquire({ key: "vod:1", holder: "box", kind: "view", label: "Film", idleMs: 1000 });
    t = 5000;
    expect(g.status().used).toBe(0);
  });
});
