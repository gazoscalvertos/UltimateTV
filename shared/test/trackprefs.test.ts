import { describe, expect, it } from "vitest";
import { cleanDelayMs, cleanTrackPref, delayLabel, rememberedAudio, rememberedSubtitle } from "../src/trackprefs.js";

const audio = [
  { id: 1, lang: "eng", selected: true },
  { id: 2, lang: "jpn", selected: false },
  { id: 3, lang: "jpn", selected: false, audioDescription: true },
];
const subs = [
  { id: 1, lang: "en", selected: false },
  { id: 2, lang: "fra", selected: false },
];

describe("track prefs", () => {
  it("keeps a language and kind, never a track number", () => {
    expect(cleanTrackPref({ audio: { lang: "jpn" }, subtitle: { lang: "English" }, id: 5 }, 1)).toEqual({ audio: { lang: "ja" }, subtitle: { lang: "en" }, at: 1 });
    expect(cleanTrackPref({ subtitle: "off" }, 1)).toEqual({ subtitle: "off", at: 1 });
    expect(cleanTrackPref({ audio: { lang: "" } })).toBeNull();
  });
  it("matches by language, so eng and en are the same on another source", () => {
    const pref = cleanTrackPref({ audio: { lang: "ja" }, subtitle: { lang: "eng" } })!;
    expect(rememberedAudio(audio, pref)).toBe(2);
    expect(rememberedSubtitle(subs, pref)).toBe(1);
  });
  it("picks the described track only when that was the choice", () => {
    expect(rememberedAudio(audio, cleanTrackPref({ audio: { lang: "ja", description: true } }))).toBe(3);
    expect(rememberedAudio([audio[0]!], cleanTrackPref({ audio: { lang: "ja", description: true } }))).toBeUndefined();
  });
  it("leaves things alone when nothing fits or it is already chosen", () => {
    expect(rememberedAudio(audio, cleanTrackPref({ audio: { lang: "en" } }))).toBeUndefined();
    expect(rememberedSubtitle(subs, cleanTrackPref({ subtitle: { lang: "de" } }))).toBeUndefined();
    expect(rememberedSubtitle(subs, cleanTrackPref({ subtitle: "off" }))).toBeUndefined();
  });
  it("turns subtitles off when they were chosen off and something is showing", () => {
    expect(rememberedSubtitle([{ id: 1, lang: "en", selected: true }], cleanTrackPref({ subtitle: "off" }))).toBeNull();
  });
});

describe("delays", () => {
  it("snaps to 50 ms and stays within 10 s", () => {
    expect(cleanDelayMs(74)).toBe(50);
    expect(cleanDelayMs(99999)).toBe(10_000);
    expect(cleanDelayMs(NaN)).toBe(0);
    expect(delayLabel(150)).toBe("+150 ms");
    expect(delayLabel(-50)).toBe("-50 ms");
    expect(delayLabel(0)).toBe("0 ms");
  });
});
