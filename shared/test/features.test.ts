import { describe, expect, it } from "vitest";
import { cleanFeatureList, featureOfPlayback, featureOfRoute, featuresFor, FEATURES, remoteFeatures } from "../src/features.js";

describe("features per screen", () => {
  it("keeps only known features, once each, in catalogue order", () => {
    expect(cleanFeatureList(["weather", "nonsense", "live", "weather", 3])).toEqual(["live", "weather"]);
    expect(cleanFeatureList("live")).toEqual([]);
    expect(cleanFeatureList(undefined)).toEqual([]);
  });

  it("knows which feature each TV screen belongs to", () => {
    expect(featureOfRoute({ name: "guide" })).toBe("live");
    expect(featureOfRoute({ name: "guide-edit" })).toBe("live");
    expect(featureOfRoute({ name: "browse", kind: "movie" })).toBe("films");
    expect(featureOfRoute({ name: "browse", kind: "series" })).toBe("shows");
    expect(featureOfRoute({ name: "planner" })).toBe("recordings");
    expect(featureOfRoute({ name: "music-list" })).toBe("music");
    expect(featureOfRoute({ name: "mix-channel" })).toBe("mix");
    // Home, Settings and the player are always there.
    for (const name of ["home", "settings", "player", "profiles", "details"]) expect(featureOfRoute({ name })).toBeUndefined();
  });

  it("knows which feature something played belongs to", () => {
    expect(featureOfPlayback({ kind: "channel", id: "bbc1" })).toBe("live");
    expect(featureOfPlayback({ kind: "channel", id: "mix:clubland" })).toBe("mix");
    expect(featureOfPlayback({ kind: "catchup" })).toBe("live");
    expect(featureOfPlayback({ kind: "recording" })).toBe("recordings");
    expect(featureOfPlayback({ kind: "title" }, { kind: "series" })).toBe("shows");
    expect(featureOfPlayback({ kind: "title" }, { kind: "movie" })).toBe("films");
    expect(featureOfPlayback({ kind: "stream" })).toBeUndefined();
  });

  it("offers each app only the features it has", () => {
    expect(featuresFor("box")).toHaveLength(FEATURES.length);
    const android = featuresFor("android").map((f) => f.id);
    expect(android).toContain("live");
    expect(android).not.toContain("music");
    expect(featuresFor(null)).toHaveLength(FEATURES.length);
  });

  it("hides on the phone remote only what every TV has switched off", () => {
    expect(remoteFeatures([])).toEqual([]);
    expect(remoteFeatures([["live", "music"]])).toEqual(["live", "music"]);
    expect(remoteFeatures([["live", "music"], ["music"]])).toEqual(["music"]);
  });
});
