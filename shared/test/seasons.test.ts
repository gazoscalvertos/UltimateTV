import { describe, expect, it } from "vitest";
import { cleanCastUrl, easterSunday, parseCommunityIndex, parseEdl, projectionFrom, seasonOn, DEFAULT_PROJECTION_SETTINGS } from "../src/index.js";

describe("seasons", () => {
  it("knows when Easter is", () => {
    expect(easterSunday(2024)).toEqual([3, 31]);
    expect(easterSunday(2025)).toEqual([4, 20]);
    expect(easterSunday(2026)).toEqual([4, 5]);
    expect(easterSunday(2027)).toEqual([3, 28]);
  });

  it("finds the season for a date", () => {
    expect(seasonOn(new Date(2026, 11, 20))).toBe("christmas");
    expect(seasonOn(new Date(2026, 11, 27))).toBe(null);
    expect(seasonOn(new Date(2026, 11, 31))).toBe("newyear");
    expect(seasonOn(new Date(2027, 0, 1))).toBe("newyear");
    expect(seasonOn(new Date(2027, 1, 14))).toBe("valentines");
    expect(seasonOn(new Date(2026, 3, 3))).toBe("easter");
    expect(seasonOn(new Date(2026, 3, 6))).toBe("easter");
    expect(seasonOn(new Date(2026, 3, 7))).toBe(null);
    expect(seasonOn(new Date(2026, 9, 29))).toBe("halloween");
    expect(seasonOn(new Date(2026, 10, 5))).toBe("bonfire");
    expect(seasonOn(new Date(2026, 6, 1))).toBe(null);
  });

  it("picks a clip for the season or draws one", () => {
    const clips = [
      { id: "a", name: "Sleigh", kind: "image" as const, url: "/a", season: "christmas" as const, motion: "across-top" as const },
      { id: "b", name: "Bunny", kind: "image" as const, url: "/b", season: "easter" as const, motion: "across-bottom" as const },
    ];
    const state = { settings: { ...DEFAULT_PROJECTION_SETTINGS, drawn: false }, season: "christmas" as const, clips };
    expect(projectionFrom(state, {}, false, () => 0)?.clip?.id).toBe("a");
    expect(projectionFrom({ ...state, season: "newyear" }, {}, false, () => 0)?.drawn).toBe("fireworks");
    expect(projectionFrom({ ...state, season: null }, {}, false)).toBeUndefined();
    expect(projectionFrom(state, { clipId: "b" }, true)?.clip?.name).toBe("Bunny");
  });

  it("reads a community index, dropping bad entries", () => {
    const clips = parseCommunityIndex({ clips: [{ id: "x-1", name: "Snow", file: "files/snow.webp", type: "image/webp", season: "christmas", licence: "CC0" }, { id: "y", name: "Bad", file: "javascript:alert(1)", type: "image/png" }, { id: "z", name: "Odd", file: "z.exe", type: "application/x-msdownload" }] }, "https://example.org/c/index.json");
    expect(clips).toEqual([{ id: "x-1", name: "Snow", use: "projection", season: "christmas", url: "https://example.org/c/files/snow.webp", type: "image/webp", licence: "CC0" }]);
  });
});

describe("advert breaks", () => {
  it("reads comskip's EDL, merging close breaks and dropping blips", () => {
    expect(parseEdl("0.00\t1.20\t0\n610.5\t790\t0\n792\t800.25\t0\n1500\t1680\t0\n")).toEqual([
      { startMs: 610_500, endMs: 800_250 },
      { startMs: 1_500_000, endMs: 1_680_000 },
    ]);
    expect(parseEdl("")).toEqual([]);
  });
});

describe("links", () => {
  it("keeps web addresses only", () => {
    expect(cleanCastUrl("look https://example.org/a.mp4 now")).toBe("https://example.org/a.mp4");
    expect(cleanCastUrl("javascript:alert(1)")).toBeNull();
    expect(cleanCastUrl(42)).toBeNull();
  });
});
