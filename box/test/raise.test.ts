// Pop-ups not showing on films: the UI window is put back above mpv's after the screen changes.
import { describe, expect, it } from "vitest";
import { RAISE_DELAYS_MS, raiseSoon, raiseUi } from "../src/raise.js";

const fake = (destroyed = false) => {
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    setAlwaysOnTop: (f: boolean, l?: string) => void calls.push(`top ${f} ${l}`),
    moveTop: () => void calls.push("moveTop"),
  };
};

describe("raising the UI above the video", () => {
  it("pins the window on top and moves it to the front", () => {
    const w = fake();
    expect(raiseUi(w)).toBe(true);
    expect(w.calls).toEqual(["top true screen-saver", "moveTop"]);
  });
  it("leaves a missing or closed window alone", () => {
    expect(raiseUi(null)).toBe(false);
    const w = fake(true);
    expect(raiseUi(w)).toBe(false);
    expect(w.calls).toEqual([]);
  });
  it("raises again once the screen has settled, not just straight away", () => {
    const w = fake();
    const timers: number[] = [];
    raiseSoon(() => w, (fn, ms) => { timers.push(ms); fn(); });
    expect(timers).toEqual(RAISE_DELAYS_MS);
    expect(w.calls.filter((c) => c === "moveTop")).toHaveLength(RAISE_DELAYS_MS.length);
  });
});
