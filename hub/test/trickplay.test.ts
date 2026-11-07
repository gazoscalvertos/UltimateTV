import { describe, expect, it } from "vitest";
import { trickplayFrame, type Trickplay } from "@ultimatetv/shared";
import { JellyfinClient } from "../src/services/jellyfin.js";
import type { JfItem } from "../src/services/media.js";

const tp: Trickplay = { url: "http://jf/sheet/{n}.jpg", intervalMs: 10_000, width: 320, height: 180, tileWidth: 10, tileHeight: 10, count: 250 };

describe("trickplayFrame", () => {
  it("finds the frame in the first sheet", () => {
    expect(trickplayFrame(tp, 0)).toEqual({ url: "http://jf/sheet/0.jpg", x: 0, y: 0 });
    expect(trickplayFrame(tp, 25_000)).toEqual({ url: "http://jf/sheet/0.jpg", x: 640, y: 0 });
    expect(trickplayFrame(tp, 120_000)).toEqual({ url: "http://jf/sheet/0.jpg", x: 640, y: 180 });
  });
  it("moves on to the next sheet after 100 frames", () => {
    expect(trickplayFrame(tp, 1_000_000)).toEqual({ url: "http://jf/sheet/1.jpg", x: 0, y: 0 });
  });
  it("clamps to the last frame and the first", () => {
    expect(trickplayFrame(tp, 99_999_999)?.url).toBe("http://jf/sheet/2.jpg");
    expect(trickplayFrame(tp, -5)).toEqual({ url: "http://jf/sheet/0.jpg", x: 0, y: 0 });
  });
  it("gives nothing for a broken description", () => {
    expect(trickplayFrame({ ...tp, intervalMs: 0 }, 1000)).toBeNull();
    expect(trickplayFrame({ ...tp, count: 0 }, 1000)).toBeNull();
  });
});

describe("JellyfinClient.trickplay", () => {
  const client = new JellyfinClient({ url: "http://jf:8096", token: "tok", userId: "u" });
  const item = (t: JfItem["Trickplay"]): JfItem => ({ Id: "abc", Name: "x", Type: "Movie", ...(t ? { Trickplay: t } : {}) });
  const size = (w: number) => ({ Width: w, Height: w / 2, TileWidth: 10, TileHeight: 10, ThumbnailCount: 50, Interval: 10_000 });

  it("is undefined when Jellyfin made none", () => {
    expect(client.trickplay("abc", item(undefined), "src")).toBeUndefined();
    expect(client.trickplay("abc", item({}), "src")).toBeUndefined();
  });
  it("picks the biggest sheet up to 480 wide", () => {
    const t = client.trickplay("abc", item({ src: { "160": size(160), "320": size(320), "640": size(640) } }), "src");
    expect(t?.width).toBe(320);
    expect(t?.url).toBe("http://jf:8096/Videos/abc/Trickplay/320/{n}.jpg?mediaSourceId=src&api_key=tok");
    expect(t?.intervalMs).toBe(10_000);
  });
  it("falls back to the smallest when all are big, and to the only source", () => {
    const t = client.trickplay("abc", item({ other: { "640": size(640), "800": size(800) } }), "src");
    expect(t?.width).toBe(640);
  });
});
