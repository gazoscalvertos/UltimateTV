// Recording clashes: the planner says "choose which one to keep", so this is the choosing.
import { describe, expect, it } from "vitest";
import type { Conflict, Recording } from "@ultimatetv/shared";
import { clashCancel, clashOptions, KEEP_ALL } from "../src/clashes.js";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

const recording = (id: string, title: string, channel: string, start: number, mins: number): Recording =>
  ({
    id,
    channelId: `ch-${id}`,
    channelName: channel,
    status: "scheduled",
    method: "live",
    start,
    end: start + mins * 60_000,
    incomplete: false,
    watched: false,
    positionMs: 0,
    createdAt: at(2, 9),
    programme: { id: `p-${id}`, channelId: `ch-${id}`, start, end: start + mins * 60_000, title, categories: [], isNew: true, isRepeat: false, isFilm: false },
  }) as Recording;

const vera = recording("a", "Vera", "ITV1", at(2, 20), 120);
const quiz = recording("b", "Quiz Night", "BBC One", at(2, 21), 60);
const film = recording("c", "Late Film", "Channel 4", at(2, 21, 30), 120);

const clash = (recordings: Recording[], limit = 1): Conflict => ({
  start: Math.min(...recordings.map((r) => r.start)),
  end: Math.max(...recordings.map((r) => r.end)),
  recordings,
  limit,
  message: "Vera and Quiz Night are on at the same time, and your IPTV plan has one connection. Choose which one to keep.",
});

describe("clashOptions", () => {
  it("offers every recording in the clash, by when it starts, with the channel and time", () => {
    const options = clashOptions(clash([quiz, vera]));
    expect(options.map((o) => o.value)).toEqual(["a", "b", KEEP_ALL]);
    expect(options[0]).toMatchObject({ label: "Vera", detail: "ITV1 · 20:00" });
  });

  it("offers keeping them all as the last choice", () => {
    const options = clashOptions(clash([vera, quiz]));
    expect(options.at(-1)).toMatchObject({ value: KEEP_ALL, label: "Keep them all" });
  });
});

describe("clashCancel", () => {
  it("cancels the ones not kept when the plan has one connection", () => {
    expect(clashCancel(clash([vera, quiz, film]), ["b"])).toEqual(["a", "c"]);
  });

  it("honours a deliberate choice even when there are spare connections", () => {
    // Three overlap with two connections: picking one still means the other two go. The household
    // said which one it wants, so the spare connection is not quietly used for something else.
    expect(clashCancel(clash([vera, quiz, film], 2), ["b"])).toEqual(["a", "c"]);
  });

  it("cancels nothing when they choose to keep them all", () => {
    expect(clashCancel(clash([vera, quiz]), [KEEP_ALL])).toEqual([]);
  });

  it("cancels nothing when every recording is kept", () => {
    expect(clashCancel(clash([vera, quiz], 2), ["a", "b"])).toEqual([]);
  });

  it("shows which recordings fit when the plan has room for both", () => {
    expect(clash([vera, quiz], 2).limit).toBe(2);
  });
});
