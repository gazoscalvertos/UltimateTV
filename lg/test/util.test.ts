import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const U = createRequire(import.meta.url)("../js/util.js");

describe("LG TV app helpers", () => {
  it("makes a Hub address from what was typed", () => {
    expect(U.normaliseHub("192.168.0.19")).toBe("http://192.168.0.19:8095");
    expect(U.normaliseHub(" 192.168.0.19:8095/ ")).toBe("http://192.168.0.19:8095");
    expect(U.normaliseHub("https://hub.example.com")).toBe("https://hub.example.com");
    expect(U.normaliseHub("")).toBe("");
    expect(U.normaliseHub("http://bad host!")).toBe("");
  });

  it("turns Hub paths into addresses", () => {
    expect(U.absolute("http://h:8095", "/api/art/1")).toBe("http://h:8095/api/art/1");
    expect(U.absolute("http://h:8095", "https://x/y.jpg")).toBe("https://x/y.jpg");
    expect(U.absolute("http://h:8095", undefined)).toBe("");
  });

  it("formats times", () => {
    expect(U.duration(75)).toBe("1:15");
    expect(U.duration(3723)).toBe("1:02:03");
    expect(U.runtime(95)).toBe("1 h 35 min");
    expect(U.runtime(42)).toBe("42 min");
  });

  it("maps the LG remote's keys", () => {
    expect(U.keyAction(461)).toBe("back");
    expect(U.keyAction(13)).toBe("enter");
    expect(U.keyAction(412)).toBe("rw");
    expect(U.keyAction(9999)).toBeNull();
  });

  it("moves focus to the nearest thing in the direction pressed", () => {
    const box = (l: number, t: number) => ({ left: l, top: t, right: l + 100, bottom: t + 100 });
    const rects = [box(0, 0), box(120, 0), box(0, 120), box(240, 0)];
    expect(U.pickNext(rects, 0, "right")).toBe(1);
    expect(U.pickNext(rects, 0, "down")).toBe(2);
    expect(U.pickNext(rects, 1, "right")).toBe(3);
    expect(U.pickNext(rects, 0, "left")).toBe(-1);
    expect(U.pickNext(rects, 0, "up")).toBe(-1);
  });

  it("offers a skip button only inside a marker", () => {
    const markers = [{ kind: "intro", startMs: 5000, endMs: 60000 }];
    expect(U.skipAt(markers, 1000)).toBeNull();
    expect(U.skipAt(markers, 10000)).toBe(markers[0]);
    expect(U.skipAt(markers, 59500)).toBeNull();
  });

  it("tells the Hub what the TV can show", () => {
    expect(U.deviceHeaders(2160)["X-Codecs"]).toBe("h264,hevc,vp9");
    expect(U.deviceHeaders(1080)["X-Max-Height"]).toBe("1080");
  });

  it("writes file sizes for the Versions list", () => {
    expect(U.bytes(0)).toBe("");
    expect(U.bytes(700e6)).toBe("700 MB");
    expect(U.bytes(1.5e9)).toBe("1.5 GB");
    expect(U.bytes(42e9)).toBe("42 GB");
  });
});

describe("LG TV player helpers", () => {
  it("reads SRT and WebVTT captions", async () => {
    const g = globalThis as unknown as { window?: unknown };
    g.window = {};
    const w = g.window as { UTV?: { parseCues: (t: string) => { start: number; end: number; text: string }[] } };
    await import("../js/player.js");
    const cues = w.UTV!.parseCues("1\n00:00:01,500 --> 00:00:03,000\n<i>Hello</i>\n\n2\n00:01:00,000 --> 00:01:02,250\nBye\nnow\n");
    expect(cues).toEqual([{ start: 1.5, end: 3, text: "Hello" }, { start: 60, end: 62.25, text: "Bye\nnow" }]);
    const vtt = w.UTV!.parseCues("WEBVTT\n\n01:00.000 --> 01:02.500\nHi\n");
    expect(vtt[0]).toEqual({ start: 60, end: 62.5, text: "Hi" });
    delete g.window;
  });
});
