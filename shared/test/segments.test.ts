import { describe, expect, it } from "vitest";
import { creditsHandover, skipMarkersFrom } from "../src/index.js";

const T = 10_000; // ticks per millisecond

describe("skip markers from Jellyfin's media segments", () => {
  it("names Intro Skipper's segments the way the player shows them", () => {
    expect(
      skipMarkersFrom([
        { Type: "Outro", StartTicks: 2_500_000 * T, EndTicks: 2_580_000 * T },
        { Type: "Intro", StartTicks: 30_000 * T, EndTicks: 90_000 * T },
        { Type: "Recap", StartTicks: 0, EndTicks: 25_000 * T },
        { Type: "Preview", StartTicks: 2_580_000 * T, EndTicks: 2_600_000 * T },
        { Type: "Commercial", StartTicks: 900_000 * T, EndTicks: 1_080_000 * T },
        { Type: "Unknown", StartTicks: 10 * T, EndTicks: 20 * T },
      ]),
    ).toEqual([
      { kind: "recap", startMs: 0, endMs: 25_000 },
      { kind: "intro", startMs: 30_000, endMs: 90_000 },
      { kind: "adverts", startMs: 900_000, endMs: 1_080_000 },
      { kind: "credits", startMs: 2_500_000, endMs: 2_580_000 },
    ]);
  });

  it("leaves out empty and back-to-front segments", () => {
    expect(skipMarkersFrom([{ Type: "Intro", StartTicks: 50 * T, EndTicks: 50 * T }, { Type: "Outro", StartTicks: 90 * T, EndTicks: 10 * T }])).toEqual([]);
  });
});

describe("Up Next during marked credits", () => {
  it("hands over 15 seconds into the credits", () => {
    expect(creditsHandover([{ kind: "credits", startMs: 2_500_000, endMs: 2_580_000 }], 2_600_000)).toEqual({ startMs: 2_500_000, atMs: 2_515_000 });
  });

  it("never waits past the end of short credits, so a scene after them still plays", () => {
    expect(creditsHandover([{ kind: "credits", startMs: 2_500_000, endMs: 2_510_000 }], 2_600_000)?.atMs).toBe(2_508_000);
  });

  it("ignores credits in the first half and works without them", () => {
    expect(creditsHandover([{ kind: "credits", startMs: 60_000, endMs: 120_000 }], 2_600_000)).toBeUndefined();
    expect(creditsHandover([{ kind: "intro", startMs: 0, endMs: 60_000 }], 2_600_000)).toBeUndefined();
  });
});
