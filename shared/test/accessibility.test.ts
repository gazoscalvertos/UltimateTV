import { describe, expect, it } from "vitest";
import { audioTrackFor, cleanAccessibility, DEFAULT_ACCESSIBILITY, isAudioDescription, isDefaultAccessibility } from "../src/index.js";

describe("accessibility settings", () => {
  it("fills in what's missing and drops what's wrong", () => {
    expect(cleanAccessibility(undefined)).toEqual(DEFAULT_ACCESSIBILITY);
    expect(cleanAccessibility({ textScale: 125, reducedMotion: true })).toEqual({ ...DEFAULT_ACCESSIBILITY, textScale: 125, reducedMotion: true });
    expect(cleanAccessibility({ textScale: 300, highContrast: "yes" })).toEqual(DEFAULT_ACCESSIBILITY);
    // A phone changing one toggle keeps the others.
    expect(cleanAccessibility({ highContrast: true }, { ...DEFAULT_ACCESSIBILITY, textScale: 150 })).toEqual({ ...DEFAULT_ACCESSIBILITY, highContrast: true, textScale: 150 });
    expect(isDefaultAccessibility(DEFAULT_ACCESSIBILITY)).toBe(true);
    expect(isDefaultAccessibility({ ...DEFAULT_ACCESSIBILITY, textScale: 125 })).toBe(false);
  });
});

describe("audio description", () => {
  it("knows a described track by its flag or its name", () => {
    expect(isAudioDescription({ visualImpaired: true })).toBe(true);
    for (const title of ["English (Audio Description)", "Audio described", "AD", "English - AD", "Descriptive Video Service (DVS)", "Visually impaired"]) expect(isAudioDescription({ title })).toBe(true);
    for (const title of ["English", "Commentary with the director", "Dolby Atmos", "Head of the Class", "Stereo"]) expect(isAudioDescription({ title })).toBe(false);
  });

  const tracks = [
    { id: 1, lang: "eng", selected: true },
    { id: 2, lang: "fre", selected: false, audioDescription: true },
    { id: 3, lang: "eng", selected: false, audioDescription: true },
  ];

  it("switches to the described track in the preferred language", () => {
    expect(audioTrackFor(tracks, true, "eng")).toBe(3);
    expect(audioTrackFor(tracks.map((t) => ({ ...t, selected: t.id === 3 })), true, "eng")).toBeUndefined();
    expect(audioTrackFor([{ id: 1, lang: "eng", selected: true }], true, "eng")).toBeUndefined();
  });

  it("switches away from a described track the file chose by itself", () => {
    expect(audioTrackFor(tracks.map((t) => ({ ...t, selected: t.id === 3 })), false, "eng")).toBe(1);
    expect(audioTrackFor(tracks, false, "eng")).toBeUndefined();
  });
});
