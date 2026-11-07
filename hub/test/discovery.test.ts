import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverJellyfin, discoverPlex, discoverServers, GDM_ADDRESS, GDM_PORT, JELLYFIN_PORT, parseJellyfinReply, parsePlexReply, type UdpFactory, type UdpSocketLike } from "../src/discovery.js";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

type Reply = { msg: string; from: string };

/** A fake socket: remembers what was sent and, when something is sent, "receives" the canned replies. */
function fakeNetwork(opts: { jellyfin?: Reply[]; plex?: Reply[]; failBind?: number[] } = {}) {
  const sent: { port: number; address: string; msg: string }[] = [];
  const bindAttempts: number[] = [];
  const closed: number[] = [];
  const factory: UdpFactory = () => {
    let onMessage: (msg: Buffer, rinfo: { address: string; port: number }) => void = () => undefined;
    let onError: (err: Error) => void = () => undefined;
    const id = closed.length + bindAttempts.length;
    const socket: UdpSocketLike = {
      on(event: string, cb: never) {
        if (event === "message") onMessage = cb;
        else onError = cb;
        return socket;
      },
      bind(port, cb) {
        bindAttempts.push(port);
        if (opts.failBind?.includes(port)) setTimeout(() => onError(new Error("EADDRINUSE")), 0);
        else setTimeout(() => cb?.(), 0);
      },
      setBroadcast() {},
      send(msg, port, address, cb) {
        sent.push({ port, address, msg: String(msg) });
        const replies = (port === JELLYFIN_PORT ? opts.jellyfin : opts.plex) ?? [];
        setTimeout(() => replies.forEach((r) => onMessage(Buffer.from(r.msg), { address: r.from, port: 1234 })), 0);
        cb?.(null);
      },
      close() {
        closed.push(id);
      },
    };
    return socket;
  };
  return { factory, sent, bindAttempts, closed };
}

const jf = (extra: Record<string, unknown> = {}) => JSON.stringify({ Address: "http://192.168.0.20:8096", Id: "abc123", Name: "Living room", ...extra });
const plexReply = (extra = "") => `HTTP/1.0 200 OK\r\nContent-Type: plex/media-server\r\nResource-Identifier: plex-1\r\nName: Den Plex\r\nPort: 32400\r\nVersion: 1.40\r\n${extra}\r\n`;

describe("parsing replies", () => {
  it("reads a Jellyfin reply and ignores junk", () => {
    expect(parseJellyfinReply(jf())).toEqual({ kind: "jellyfin", id: "abc123", name: "Living room", url: "http://192.168.0.20:8096" });
    expect(parseJellyfinReply(jf({ Address: "http://nas:8096/" }))?.url).toBe("http://nas:8096");
    expect(parseJellyfinReply("not json")).toBeNull();
    expect(parseJellyfinReply(jf({ Address: "ftp://x" }))).toBeNull();
    expect(parseJellyfinReply(JSON.stringify({ Name: "no address" }))).toBeNull();
  });

  it("reads a Plex GDM reply, using the sender's address", () => {
    expect(parsePlexReply(plexReply(), "192.168.0.30")).toEqual({ kind: "plex", id: "plex-1", name: "Den Plex", url: "http://192.168.0.30:32400" });
    expect(parsePlexReply("HTTP/1.0 200 OK\r\nContent-Type: plex/media-player\r\nPort: 32400\r\n", "10.0.0.2")).toBeNull();
    expect(parsePlexReply("HTTP/1.0 200 OK\r\nContent-Type: plex/media-server\r\nName: X\r\n", "10.0.0.2")).toBeNull();
    expect(parsePlexReply("", "10.0.0.2")).toBeNull();
  });
});

describe("discovery", () => {
  it("broadcasts the Jellyfin probe and lists each server once", async () => {
    const net = fakeNetwork({ jellyfin: [{ msg: jf(), from: "192.168.0.20" }, { msg: jf(), from: "192.168.0.21" }, { msg: "junk", from: "192.168.0.9" }] });
    const found = await discoverJellyfin(net.factory, 20);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "jellyfin", name: "Living room" });
    expect(net.sent).toEqual([{ port: 7359, address: "255.255.255.255", msg: "who is JellyfinServer?" }]);
    expect(net.closed).toHaveLength(1);
  });

  it("sends the GDM search to the multicast group and lists Plex servers", async () => {
    const net = fakeNetwork({ plex: [{ msg: plexReply(), from: "192.168.0.30" }] });
    const found = await discoverPlex(net.factory, 20);
    expect(found).toEqual([{ kind: "plex", id: "plex-1", name: "Den Plex", url: "http://192.168.0.30:32400" }]);
    expect(net.sent[0]).toMatchObject({ port: GDM_PORT, address: GDM_ADDRESS });
    expect(net.sent[0]!.msg).toMatch(/^M-SEARCH \* HTTP\/1\.0/);
    expect(net.bindAttempts).toEqual([32412]);
  });

  it("falls back to any port when 32412 is taken", async () => {
    const net = fakeNetwork({ failBind: [32412], plex: [{ msg: plexReply(), from: "192.168.0.30" }] });
    const found = await discoverPlex(net.factory, 20);
    expect(found).toHaveLength(1);
    expect(net.bindAttempts).toEqual([32412, 0]);
  });

  it("finds nothing, quietly, when the network is deaf or a socket can't bind", async () => {
    expect(await discoverServers(fakeNetwork().factory, 10)).toEqual([]);
    expect(await discoverPlex(fakeNetwork({ failBind: [32412, 0] }).factory, 10)).toEqual([]);
  });

  it("lists Jellyfin first, then Plex", async () => {
    const net = fakeNetwork({ jellyfin: [{ msg: jf(), from: "a" }], plex: [{ msg: plexReply(), from: "192.168.0.30" }] });
    expect((await discoverServers(net.factory, 20)).map((s) => s.kind)).toEqual(["jellyfin", "plex"]);
  });
});

describe("GET /api/discover", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-discover-"));
    const config: HubConfig = { port: 8095, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), remoteDir: new URL("../public/remote", import.meta.url).pathname, mediaRoot: path.join(tmp, "media"), demo: true };
    app = await buildServer(config, { discover: async () => [{ kind: "jellyfin", id: "x", name: "Den", url: "http://nas:8096" }] });
    await pairAsTv(app);
  });
  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns what was found", async () => {
    const res = await app.inject("/api/discover");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ servers: [{ kind: "jellyfin", id: "x", name: "Den", url: "http://nas:8096" }] });
  });
});
