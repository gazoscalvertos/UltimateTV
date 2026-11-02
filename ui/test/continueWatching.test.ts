import { describe, expect, it } from "vitest";
import type { TitleRef } from "@ultimatetv/shared";
import { continueOptions, undoLabel } from "../src/continueWatching.js";

/** The Options menu on a Continue watching card (issue #100). */

const film: TitleRef = { id: "tmdb:movie:438631", kind: "movie", name: "Dune", progress: 0.4 };
const episode: TitleRef = { id: "tmdb:series:1", kind: "series", name: "The Show", episodeId: "s2e5", subtitle: "S2 E5" };

describe("continueOptions", () => {
  it("offers Resume, Mark as watched and Remove, in that order", () => {
    const labels = continueOptions(film).map((o) => o.label);
    expect(labels).toEqual(["Resume (40%)", "Mark as watched", "Remove from Continue watching"]);
  });

  it("plays the episode a series card is carrying on with", () => {
    const play = continueOptions(episode)[0]!;
    expect(play.value).toBe("play");
    expect(play.detail).toBe("S2 E5");
  });

  it("says Next when the card is the episode after a finished one", () => {
    const next = { ...episode, subtitle: "Next: S2 E6" };
    expect(continueOptions(next)[0]!.label).toBe("Play next episode");
  });

  it("never offers to remove something that isn't in the row", () => {
    expect(continueOptions(film).some((o) => o.value === "hide")).toBe(true);
    expect(undoLabel(film)).toBe("Dune won't show in Continue watching again until it's played.");
  });
});
