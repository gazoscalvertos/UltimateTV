// The Hub's half of Limited mode (#78): GET /api/box/offline, the one answer that hands the box its
// cache. It is deliberately only for the paired TV, since it carries the channels' own feed URLs and
// the Jellyfin sign-in; everything else here is what buildLimitedSnapshot does with the Hub's data.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LimitedSnapshot } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-boxoffline-"));
  const config: HubConfig = {
    port: 8095,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    uiDir: path.join(tmp, "ui"),
    setupDir: path.join(tmp, "setup"),
    remoteDir: new URL("../public/remote", import.meta.url).pathname,
    mediaRoot: path.join(tmp, "media"),
    demo: true,
  };
  app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
});

afterAll(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("the box's Limited-mode snapshot", () => {
  it("refuses a caller that isn't the paired TV", async () => {
    const res = await app.inject({ method: "GET", url: "/api/box/offline" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "pair" });
  });

  it("hands the paired TV the channels' own addresses, a week of guide and every profile", async () => {
    await pairAsTv(app);
    const res = await app.inject({ method: "GET", url: "/api/box/offline" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const snap = res.json<LimitedSnapshot>();
    const now = Date.now();
    // The demo's channels all have a feed, whose URL is the clip the demo serves: a real address the
    // box can play with no Hub, which /api/channels never gives out.
    const bbc = snap.channels.find((c) => c.id === "bbc-one");
    expect(bbc).toMatchObject({ number: 101, category: "entertainment" });
    expect(bbc!.url).toMatch(/^http:\/\/127\.0\.0\.1:8095\/clips\//);
    expect(bbc!.headers).toEqual({ "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" });
    // A week ahead, from an hour ago: the demo's own guide stops 36 hours out, so the window is
    // right even though there is less in it.
    expect(snap.guide.from).toBeLessThanOrEqual(now);
    expect(snap.guide.to).toBeGreaterThan(now + 6 * 86_400_000);
    expect(Object.keys(snap.guide.programmes).length).toBeGreaterThan(0);
    // Every profile, with the fields the box needs to apply the same rules on its own.
    const kids = snap.profiles.find((p) => p.id === "kids");
    expect(kids).toMatchObject({ kind: "kids", maxCertification: "PG", channelCategories: ["kids"] });
    expect(snap.profiles.find((p) => p.id === "family")?.kind).toBe("adult");
    expect(snap.at).toBeGreaterThan(0);
  });
});
