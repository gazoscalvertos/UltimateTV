import { describe, expect, it } from "vitest";
import { advertMarks } from "../src/seekMarks.js";

// The advert breaks comskip found, as the seek bar shows them: where each one starts and how wide
// it is, in percent of the bar.
describe("advert marks on the seek bar", () => {
  it("places each advert break by its start and length", () => {
    const marks = advertMarks(
      [
        { kind: "adverts", startMs: 10_000, endMs: 20_000 },
        { kind: "adverts", startMs: 60_000, endMs: 80_000 },
      ],
      100_000,
    );
    expect(marks).toEqual([
      { left: 10, width: 10 },
      { left: 60, width: 20 },
    ]);
  });

  it("leaves out the intro, recap and credits markers", () => {
    const marks = advertMarks(
      [
        { kind: "intro", startMs: 0, endMs: 30_000 },
        { kind: "credits", startMs: 30_000, endMs: 60_000 },
        { kind: "adverts", startMs: 60_000, endMs: 70_000 },
      ],
      100_000,
    );
    expect(marks).toEqual([{ left: 60, width: 10 }]);
  });

  it("clamps a break that runs off either end of the recording", () => {
    const marks = advertMarks(
      [
        { kind: "adverts", startMs: -5_000, endMs: 5_000 },
        { kind: "adverts", startMs: 90_000, endMs: 150_000 },
      ],
      100_000,
    );
    expect(marks).toEqual([
      { left: 0, width: 5 },
      { left: 90, width: 10 },
    ]);
  });

  it("draws nothing for a break that is entirely outside the recording, or has no length", () => {
    expect(
      advertMarks(
        [
          { kind: "adverts", startMs: 120_000, endMs: 130_000 },
          { kind: "adverts", startMs: -9_000, endMs: -1_000 },
          { kind: "adverts", startMs: 5_000, endMs: 5_000 },
        ],
        100_000,
      ),
    ).toEqual([]);
  });

  it("draws nothing without comskip data, or before the length is known", () => {
    expect(advertMarks(undefined, 100_000)).toEqual([]);
    expect(advertMarks([], 100_000)).toEqual([]);
    expect(advertMarks([{ kind: "adverts", startMs: 10_000, endMs: 20_000 }], 0)).toEqual([]);
    expect(advertMarks([{ kind: "adverts", startMs: 10_000, endMs: 20_000 }], Number.NaN)).toEqual([]);
  });
});
