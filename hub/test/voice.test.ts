import { describe, expect, it } from "vitest";
import type { Channel, RadioStation } from "@ultimatetv/shared";
import { normaliseName, parseVoice } from "../src/voice.js";

const ch = (number: number, name: string): Channel => ({ id: `c${number}`, number, name, category: "entertainment", feeds: [], favourite: false, hidden: false, maxHeight: 1080, catchupDays: 0 });
const channels = [ch(101, "BBC One"), ch(102, "BBC Two"), ch(105, "Channel 5"), ch(401, "Sky Sports Main Event"), ch(402, "Sky Sports"), ch(403, "Sky Sports News"), ch(501, "Sky News")];
const station = (id: string, name: string): RadioStation => ({ id, name, url: `https://ice.example.com/${id}.mp3`, source: "preset" });
const stations = [station("radio:bbc-radio-1", "BBC Radio 1"), station("radio:bbc-radio-2", "BBC Radio 2"), station("radio:bbc-radio-4", "BBC Radio 4"), station("radio:classic-fm", "Classic FM")];

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

  it("starts a radio station by name", () => {
    expect(parseVoice("play Radio 2", channels, stations)).toMatchObject({ kind: "radio", stationId: "radio:bbc-radio-2" });
    expect(parseVoice("put on classic fm", channels, stations)).toMatchObject({ kind: "radio", stationId: "radio:classic-fm" });
    expect(parseVoice("tune to radio 4", channels, stations)).toMatchObject({ kind: "radio", stationId: "radio:bbc-radio-4" });
    // "radio 2" and "bbc radio 2" both land on the one the list calls "BBC Radio 2".
    expect(parseVoice("listen to bbc radio two", channels, stations)).toMatchObject({ kind: "radio", stationId: "radio:bbc-radio-2" });
  });

  it("still watches telly when a station has been asked for", () => {
    expect(parseVoice("watch BBC One", channels, stations)).toMatchObject({ kind: "channel", channelId: "c101" });
    // No station is called "Dune", so it is still a search.
    expect(parseVoice("play Dune", channels, stations)).toMatchObject({ kind: "search", text: "dune" });
  });
});
