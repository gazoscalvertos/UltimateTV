import { describe, expect, it } from "vitest";
import type { Channel } from "@ultimatetv/shared";
import { normaliseName, parseVoice } from "../src/voice.js";

const ch = (number: number, name: string): Channel => ({ id: `c${number}`, number, name, category: "entertainment", feeds: [], favourite: false, hidden: false, maxHeight: 1080, catchupDays: 0 });
const channels = [ch(101, "BBC One"), ch(102, "BBC Two"), ch(105, "Channel 5"), ch(401, "Sky Sports Main Event"), ch(402, "Sky Sports"), ch(403, "Sky Sports News"), ch(501, "Sky News")];

describe("voice control", () => {
  it("normalises spoken and listed names the same way", () => {
    expect(normaliseName("BBC One HD")).toBe(normaliseName("bbc 1"));
    expect(normaliseName("Channel Five")).toBe(normaliseName("Channel 5"));
  });

  it("maps simple commands to keys", () => {
    expect(parseVoice("Pause", channels)).toMatchObject({ kind: "keys", actions: ["pause"] });
    expect(parseVoice("go home please", channels)).toMatchObject({ kind: "keys", actions: ["home"] });
    expect(parseVoice("open the guide", channels)).toMatchObject({ kind: "keys", actions: ["guide"] });
    expect(parseVoice("next channel", channels)).toMatchObject({ kind: "keys", actions: ["channelUp"] });
    expect(parseVoice("okay", channels)).toMatchObject({ kind: "keys", actions: ["ok"] });
    expect(parseVoice("red button", channels)).toMatchObject({ kind: "keys", actions: ["red"] });
  });

  it("repeats arrows", () => {
    expect(parseVoice("down three times", channels)).toMatchObject({ kind: "keys", actions: ["down", "down", "down"] });
    expect(parseVoice("right", channels)).toMatchObject({ kind: "keys", actions: ["right"] });
  });

  it("switches channel by name or number", () => {
    expect(parseVoice("watch BBC One", channels)).toMatchObject({ kind: "channel", channelId: "c101" });
    expect(parseVoice("put on bbc 2", channels)).toMatchObject({ kind: "channel", channelId: "c102" });
    expect(parseVoice("Sky Sports", channels)).toMatchObject({ kind: "channel", channelId: "c402" });
    expect(parseVoice("channel 105", channels)).toMatchObject({ kind: "channel", channelId: "c105" });
    expect(parseVoice("channel one oh one", channels)).toMatchObject({ kind: "channel", channelId: "c101" });
    expect(parseVoice("channel five", channels)).toMatchObject({ kind: "channel", channelId: "c105" });
    expect(parseVoice("channel 999", channels)).toMatchObject({ kind: "keys", actions: ["digit9", "digit9", "digit9"] });
  });

  it("searches for anything else", () => {
    expect(parseVoice("search for 28 Days Later", channels)).toMatchObject({ kind: "search", text: "28 days later" });
    expect(parseVoice("play Dune", channels)).toMatchObject({ kind: "search", text: "dune" });
    expect(parseVoice("the office", channels)).toMatchObject({ kind: "search", text: "the office" });
  });

  it("controls the stats overlay", () => {
    expect(parseVoice("show stats", channels)).toMatchObject({ kind: "stats", on: true });
    expect(parseVoice("stats off", channels)).toMatchObject({ kind: "stats", on: false });
  });
});
