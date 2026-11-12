import { describe, expect, it } from "vitest";
import type { Recording } from "@ultimatetv/shared";
import { extendedLabel, followsOverrun, isLiveOrSport } from "@ultimatetv/shared";
import { planOverrun } from "../src/overrun.js";
import { programme } from "./helpers.js";

const MIN = 60_000;
const T0 = 1_800_000_000_000;

function rec(id: string, channelId: string, start: number, end: number, extra: Partial<Recording> = {}): Recording {
  return { id, programme: programme(channelId, start, (end - start) / MIN), channelId, channelName: channelId, status: "scheduled", method: "live", start, end, incomplete: false, watched: false, positionMs: 0, createdAt: T0, ...extra };
}

describe("which recordings follow overruns", () => {
  it("auto follows sport and live programmes only", () => {
    const sport = rec("a", "c1", T0, T0 + 90 * MIN);
    sport.programme.categories = ["Sport", "Football"];
    expect(isLiveOrSport(sport.programme)).toBe(true);
    expect(followsOverrun(sport, "auto")).toBe(true);
    const drama = rec("b", "c1", T0, T0 + 60 * MIN);
    drama.programme.categories = ["Drama"];
    expect(followsOverrun(drama, "auto")).toBe(false);
    expect(followsOverrun(drama, "on")).toBe(true);
    expect(followsOverrun(sport, "off")).toBe(false);
    expect(followsOverrun({ ...drama, programme: { ...drama.programme, title: "Strictly Come Dancing Live" } }, "auto")).toBe(true);
  });

  it("the recording's own choice wins, and catch-up never follows", () => {
    const drama = rec("b", "c1", T0, T0 + 60 * MIN);
    expect(followsOverrun({ ...drama, followOverrun: true }, "off")).toBe(true);
    const sport = { ...rec("a", "c1", T0, T0 + 60 * MIN), followOverrun: false };
    sport.programme.categories = ["Sport"];
    expect(followsOverrun(sport, "on")).toBe(false);
    expect(followsOverrun({ ...drama, method: "catchup", followOverrun: true }, "on")).toBe(false);
  });

  it("words the extra time", () => {
    expect(extendedLabel({ extendedMs: 12 * MIN })).toBe("Extended by 12 minutes");
    expect(extendedLabel({ extendedMs: MIN })).toBe("Extended by 1 minute");
    expect(extendedLabel({})).toBeUndefined();
  });
});

describe("planOverrun", () => {
  const base = () => {
    const r = rec("a", "c1", T0, T0 + 95 * MIN); // programme ends at +90, 5 minutes of padding
    return { rec: r, plannedEnd: r.end, plannedProgrammeEnd: T0 + 90 * MIN, maxExtraMs: 60 * MIN, upcoming: [] as Recording[], limit: 1, now: T0 + 94 * MIN };
  };

  it("ends the guide's new end plus the same padding", () => {
    const plan = planOverrun({ ...base(), guideEnd: T0 + 102 * MIN });
    expect(plan?.end).toBe(T0 + 107 * MIN);
    expect(plan?.limited).toBeUndefined();
  });

  it("does nothing when the guide end hasn't moved past the recording", () => {
    expect(planOverrun({ ...base(), guideEnd: T0 + 90 * MIN })).toBeUndefined();
  });

  it("caps the extra time", () => {
    const plan = planOverrun({ ...base(), guideEnd: T0 + 300 * MIN });
    expect(plan).toMatchObject({ end: T0 + 155 * MIN, limited: "cap" });
  });

  it("stops short rather than take the only connection from a recording on another channel", () => {
    const next = rec("n", "c2", T0 + 100 * MIN, T0 + 130 * MIN);
    const plan = planOverrun({ ...base(), guideEnd: T0 + 120 * MIN, upcoming: [next] });
    expect(plan?.end).toBe(T0 + 100 * MIN);
    expect(plan?.limited).toBe("clash");
    expect(plan?.clashes.map((c) => c.id)).toEqual(["n"]);
  });

  it("doesn't mind a next recording on the same channel, which shares the stream", () => {
    const next = rec("n", "c1", T0 + 100 * MIN, T0 + 130 * MIN);
    const plan = planOverrun({ ...base(), guideEnd: T0 + 120 * MIN, upcoming: [next] });
    expect(plan?.end).toBe(T0 + 125 * MIN);
    expect(plan?.clashes).toEqual([]);
  });

  it("extends freely when the plan has a spare connection", () => {
    const next = rec("n", "c2", T0 + 100 * MIN, T0 + 130 * MIN);
    const plan = planOverrun({ ...base(), limit: 2, guideEnd: T0 + 120 * MIN, upcoming: [next] });
    expect(plan?.end).toBe(T0 + 125 * MIN);
  });
});
