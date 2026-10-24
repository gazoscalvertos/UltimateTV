import { describe, expect, it } from "vitest";
import type { Recording, SeriesLink } from "@ultimatetv/shared";
import { findConflicts, planSeriesLinks } from "../src/serieslink.js";
import { channel, programme } from "./helpers.js";

const H = 3_600_000;
const now = Date.UTC(2026, 9, 24, 12);
const link = (extra: Partial<SeriesLink> = {}): SeriesLink => ({
  id: "l1", seriesKey: "t:show", title: "Show", channelId: "bbc1", channelName: "BBC One", scope: "any", newOnly: false,
  keepLatest: 0, paddingBeforeMin: 2, paddingAfterMin: 5, createdAt: 0, ...extra,
});

describe("series link planner", () => {
  const channels = new Map([
    ["bbc1", channel("bbc1")],
    ["bbc1p1", channel("bbc1p1", { name: "BBC One +1" })],
    ["itv", channel("itv")],
    ["c4", channel("c4", { catchupDays: 7 })],
  ]);

  it("records each episode once, preferring the link's channel over +1", () => {
    const airings = [
      programme("bbc1p1", now + 3 * H, 60, { episodeKey: "e1" }),
      programme("bbc1", now + 2 * H, 60, { episodeKey: "e1" }),
      programme("bbc1", now + 26 * H, 60, { episodeKey: "e2" }),
    ];
    const plan = planSeriesLinks({ links: [link()], airings, recordings: [], channels, connectionLimit: 1, preferCatchup: true, now });
    expect(plan.add.map((a) => a.programme.id)).toEqual([`bbc1:${now + 2 * H}`, `bbc1:${now + 26 * H}`]);
    expect(plan.add[0]).toMatchObject({ method: "live", start: now + 2 * H - 2 * 60_000, end: now + 3 * H + 5 * 60_000 });
  });

  it("skips repeats for new-only links and already-recorded episodes", () => {
    const airings = [
      programme("bbc1", now + H, 60, { episodeKey: "e1", isRepeat: true }),
      programme("bbc1", now + 2 * H, 60, { episodeKey: "e2", isNew: true }),
      programme("bbc1", now + 3 * H, 60, { episodeKey: "e3" }),
    ];
    const done = { programme: programme("bbc1", now - 48 * H, 60, { episodeKey: "e3" }), status: "completed", method: "live", start: 0, end: 0 } as unknown as Recording;
    const plan = planSeriesLinks({ links: [link({ newOnly: true })], airings, recordings: [done], channels, connectionLimit: 1, preferCatchup: true, now });
    expect(plan.add.map((a) => a.programme.episodeKey)).toEqual(["e2"]);
  });

  it("uses catch-up so clashes don't need a second connection", () => {
    const busy = { id: "x", programme: programme("itv", now + H, 120, { seriesKey: "t:other", episodeKey: "o1" }), status: "scheduled", method: "live", start: now + H, end: now + 3 * H, channelId: "itv" } as unknown as Recording;
    const airings = [programme("c4", now + H, 60, { episodeKey: "e1" })];
    const plan = planSeriesLinks({ links: [link({ channelId: "c4" })], airings, recordings: [busy], channels, connectionLimit: 1, preferCatchup: true, now });
    expect(plan.add[0]).toMatchObject({ method: "catchup" });
  });

  it("moves to a repeat that fits when the first airing clashes", () => {
    const busy = { id: "x", programme: programme("itv", now + H, 120, { seriesKey: "t:other", episodeKey: "o1" }), status: "scheduled", method: "live", start: now + H, end: now + 3 * H, channelId: "itv" } as unknown as Recording;
    const airings = [programme("bbc1", now + H, 60, { episodeKey: "e1" }), programme("bbc1p1", now + 5 * H, 60, { episodeKey: "e1" })];
    const plan = planSeriesLinks({ links: [link()], airings, recordings: [busy], channels, connectionLimit: 1, preferCatchup: true, now });
    expect(plan.add[0]?.programme.channelId).toBe("bbc1p1");
  });

  it("still schedules an unavoidable clash and reports it", () => {
    const busy = { id: "x", programme: programme("itv", now + H, 120, { title: "Vera", seriesKey: "t:vera" }), status: "scheduled", method: "live", start: now + H, end: now + 3 * H, channelId: "itv" } as unknown as Recording;
    const airings = [programme("bbc1", now + H, 60, { episodeKey: "e1" })];
    const plan = planSeriesLinks({ links: [link()], airings, recordings: [busy], channels, connectionLimit: 1, preferCatchup: true, now });
    expect(plan.add).toHaveLength(1);
    const asRecording = { id: "y", programme: plan.add[0]!.programme, status: "scheduled", method: "live", start: plan.add[0]!.start, end: plan.add[0]!.end, channelId: "bbc1" } as unknown as Recording;
    const conflicts = findConflicts([busy, asRecording], 1, now, (id) => id.toUpperCase());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.message).toContain("one connection");
    expect(findConflicts([busy, asRecording], 2, now, (id) => id)).toHaveLength(0);
  });
});
