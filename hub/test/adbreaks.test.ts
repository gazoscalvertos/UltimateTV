// Finding the advert breaks when comskip finds none (issue #73): ffmpeg's blackdetect and
// silencedetect, filtered down to the breaks that look like real advert breaks.
import { describe, expect, it } from "vitest";
import { breaksFromBlackAndSilence, parseBlackdetect, parseSilencedetect } from "../src/adbreaks.js";

/** A bit of ffmpeg's stderr, as -hide_banner -nostats prints it during a scan. */
const FFMPEG_STDERR = `
Input #0, matroska,webm, from 'Quiz Night.mkv':
  Duration: 00:58:00.00, start: 0.000000, bitrate: 4012 kb/s
[blackdetect @ 0x55d1c0] black_start:598.5 black_end:599.2 black_duration:0.7
[blackdetect @ 0x55d1c0] black_start:953.1 black_end:954 black_duration:0.9
[silencedetect @ 0x55d1c0] silence_start: 598.2
[silencedetect @ 0x55d1c0] silence_end: 954.8 | silence_duration: 356.6
[blackdetect @ 0x55d1c0] black_start:1900 black_end:1900.6 black_duration:0.6
[silencedetect @ 0x55d1c0] silence_start: 1900.1
[silencedetect @ 0x55d1c0] silence_end: 1955.4 | silence_duration: 55.3
`;

describe("reading ffmpeg's detection output", () => {
  it("pulls the black frames out of the log", () => {
    expect(parseBlackdetect(FFMPEG_STDERR)).toEqual([
      { startMs: 598_500, endMs: 599_200 },
      { startMs: 953_100, endMs: 954_000 },
      { startMs: 1_900_000, endMs: 1_900_600 },
    ]);
  });

  it("pulls the silent stretches out of the log", () => {
    expect(parseSilencedetect(FFMPEG_STDERR)).toEqual([
      { startMs: 598_200, endMs: 954_800 },
      { startMs: 1_900_100, endMs: 1_955_400 },
    ]);
  });

  it("says nothing when the log has neither", () => {
    expect(parseBlackdetect("")).toEqual([]);
    expect(parseSilencedetect("frame= 1 fps=1 q=-0.0 size=N/A time=00:00:01.00")).toEqual([]);
  });
});

/** Black frames at the in and out points of an advert break, with silence across it. */
const breakAround = (startS: number, endS: number) => [
  { startMs: startS * 1000, endMs: startS * 1000 + 700 },
  { startMs: endS * 1000 - 700, endMs: endS * 1000 },
];

describe("the breaks that look like real advert breaks", () => {
  it("keeps a gap between two black frames that is silent and one to six minutes long", () => {
    const black = [
      { startMs: 598_500, endMs: 599_200 },
      { startMs: 953_100, endMs: 954_000 },
    ];
    const silence = [{ startMs: 598_200, endMs: 954_800 }];
    expect(breaksFromBlackAndSilence(black, silence)).toEqual([{ startMs: 599_200, endMs: 953_100 }]);
  });

  it("drops a gap shorter than a minute, which is a scene change rather than adverts", () => {
    const black = breakAround(600, 620);
    expect(breaksFromBlackAndSilence(black, [{ startMs: 599_000, endMs: 621_000 }])).toEqual([]);
  });

  it("drops a gap longer than six minutes, which is part of the programme", () => {
    const black = breakAround(600, 1200);
    expect(breaksFromBlackAndSilence(black, [{ startMs: 595_000, endMs: 1_205_000 }])).toEqual([]);
  });

  it("drops a gap with no silence across it, which is a fade rather than a break", () => {
    const black = breakAround(600, 720);
    expect(breaksFromBlackAndSilence(black, [])).toEqual([]);
    // Silence only at the beginning, then the programme carries on.
    expect(breaksFromBlackAndSilence(black, [{ startMs: 599_000, endMs: 640_000 }])).toEqual([]);
  });

  it("finds several breaks, in order, and ignores a black frame with no partner", () => {
    const black = [
      { startMs: 600_000, endMs: 600_700 },
      { startMs: 900_000, endMs: 900_700 },
      { startMs: 1_800_000, endMs: 1_800_700 },
      { startMs: 2_100_000, endMs: 2_100_700 },
    ];
    const silence = [
      { startMs: 598_000, endMs: 902_000 },
      { startMs: 1_799_000, endMs: 2_102_000 },
    ];
    expect(breaksFromBlackAndSilence(black, silence)).toEqual([
      { startMs: 600_700, endMs: 900_000 },
      { startMs: 1_800_700, endMs: 2_100_000 },
    ]);
  });

  it("copes with the last black frame having no silence and no end", () => {
    const black = [{ startMs: 600_000, endMs: 600_700 }];
    expect(breaksFromBlackAndSilence(black, [{ startMs: 598_000, endMs: 900_000 }])).toEqual([]);
  });
});
