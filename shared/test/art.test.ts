import { describe, expect, it } from "vitest";
import { ART_COLLECTIONS, cleanScreensaver, DEFAULT_SCREENSAVER, isNightHour, kidsFriendlyTitle, shuffleThemes } from "../src/index.js";

describe("art mode settings", () => {
  it("keeps every option in range and drops unknown collections", () => {
    const s = cleanScreensaver({ artSeconds: 5, artCount: 99999, artBrightness: 1, fadeSeconds: 99, nightFromHour: 30, artFrame: "nonsense" as never, night: "black", artCollections: ["impressionism", "impressionism", "bogus"] });
    expect(s).toMatchObject({ artSeconds: 30, artCount: 1000, artBrightness: 30, fadeSeconds: 10, nightFromHour: 23, artFrame: DEFAULT_SCREENSAVER.artFrame, night: "black", artCollections: ["impressionism"] });
    expect(cleanScreensaver({ artSeconds: 7200 }).artSeconds).toBe(3600);
  });

  it("has unique collections, each with search terms", () => {
    expect(new Set(ART_COLLECTIONS.map((c) => c.id)).size).toBe(ART_COLLECTIONS.length);
    for (const c of ART_COLLECTIONS) expect(c.terms.length).toBeGreaterThan(0);
  });

  it("keeps unsuitable titles out of kids mode", () => {
    expect(kidsFriendlyTitle("The Starry Night")).toBe(true);
    expect(kidsFriendlyTitle("Judith Slaying Holofernes")).toBe(false);
    expect(kidsFriendlyTitle("The Bathers")).toBe(false);
  });

  it("works out night hours across midnight", () => {
    expect(isNightHour(23, 22, 7)).toBe(true);
    expect(isNightHour(3, 22, 7)).toBe(true);
    expect(isNightHour(12, 22, 7)).toBe(false);
    expect(isNightHour(5, 1, 6)).toBe(true);
    expect(isNightHour(5, 6, 6)).toBe(false);
  });

  it("adds the gallery to Shuffle only when paintings exist", () => {
    expect(shuffleThemes(5, false)).not.toContain("gallery");
    expect(shuffleThemes(5, false, true)).toContain("gallery");
  });
});
