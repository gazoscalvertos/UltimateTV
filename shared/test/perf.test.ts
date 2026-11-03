// The timings the TV app takes of itself (issue #108): the targets from the issue, and how a run is
// read back in plain words for the phone's Stats page and the Hub's diagnostics.

import { describe, expect, it } from "vitest";
import { PERF_TARGETS, perfMisses, perfSummary, perfVerdict, type PerfReport } from "../src/perf.js";

const at = "2026-11-03T18:00:00.000Z";

/** A run with every measurement taken, all inside their targets. */
function report(over: Partial<PerfReport> = {}): PerfReport {
  return {
    at,
    width: 3840,
    height: 2160,
    pixelRatio: 1,
    refreshHz: 60,
    appVersion: "0.10.0",
    device: "tvbox",
    samples: [
      { id: "boot", label: "Boot to \"Who's watching?\"", detail: "", ms: 2400, samples: 1, targetMs: PERF_TARGETS.boot },
      { id: "home", label: "Home, ready to take a key press", detail: "", ms: 420, samples: 1, targetMs: PERF_TARGETS.home },
      { id: "guide", label: "A guide step, key press to frame", detail: "", ms: 16, worstMs: 29, samples: 12, targetMs: PERF_TARGETS.guide },
      { id: "playback", label: "A frame while a film plays", detail: "", ms: 17, worstMs: 33, samples: 60, targetMs: PERF_TARGETS.playback },
    ],
    ...over,
  };
}

describe("the timing targets", () => {
  it("are the numbers the issue asked for", () => {
    expect(PERF_TARGETS).toEqual({ boot: 15_000, home: 1_500, guide: 20, playback: 17 });
  });

  it("says nothing is over when everything is inside its target", () => {
    const r = report();
    expect(perfMisses(r)).toEqual([]);
    expect(perfVerdict(r)).toBe("All 4 measurements are inside their targets.");
    expect(perfSummary(r)).toEqual([
      "ok: Boot to \"Who's watching?\" 2400 ms (target 15000 ms, 1 sample)",
      "ok: Home, ready to take a key press 420 ms (target 1500 ms, 1 sample)",
      "ok: A guide step, key press to frame 16 ms, worst 29 ms (target 20 ms, 12 samples)",
      "ok: A frame while a film plays 17 ms, worst 33 ms (target 17 ms, 60 samples)",
    ]);
  });

  it("names the measurements that are slower than their target, and only those", () => {
    const slow = report({
      samples: [
        { id: "boot", label: "Boot", detail: "", ms: 21_000, samples: 1, targetMs: PERF_TARGETS.boot },
        { id: "home", label: "Home", detail: "", ms: 300, samples: 1, targetMs: PERF_TARGETS.home },
        { id: "guide", label: "A guide step", detail: "", ms: 34, samples: 9, targetMs: PERF_TARGETS.guide },
      ],
    });
    expect(perfMisses(slow).map((s) => s.id)).toEqual(["boot", "guide"]);
    expect(perfVerdict(slow)).toBe("2 of 3 measurements are slower than their target: boot, a guide step.");
    expect(perfSummary(slow)[0]).toBe("over: Boot 21000 ms (target 15000 ms, 1 sample)");
  });

  it("handles a report with nothing measured", () => {
    expect(perfVerdict(report({ samples: [] }))).toBe("Nothing was measured.");
    expect(perfSummary(report({ samples: [] }))).toEqual([]);
  });
});


describe("a run with no measurements", () => {
  it("says nothing was measured rather than claiming everything is fine", () => {
    expect(perfVerdict(report({ samples: [] }))).toBe("Nothing was measured.");
    expect(perfMisses(report({ samples: [] }))).toEqual([]);
    expect(perfSummary(report({ samples: [] }))).toEqual([]);
  });
});

describe("the targets' round numbers", () => {
  it("keeps every target in milliseconds, so a figure never needs converting to be read", () => {
    for (const ms of Object.values(PERF_TARGETS)) expect(Number.isInteger(ms)).toBe(true);
  });

  it("sets the guide target at one 50 fps frame and playback at one 60 Hz frame", () => {
    expect(PERF_TARGETS.guide).toBe(1000 / 50);
    expect(PERF_TARGETS.playback).toBeGreaterThanOrEqual(1000 / 60);
    expect(PERF_TARGETS.playback).toBeLessThan(1000 / 50);
  });
});
