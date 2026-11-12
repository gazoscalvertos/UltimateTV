import { beforeEach, describe, expect, it } from "vitest";
import { reportTrailerHealth, resetTrailerHealth, trailerGivenUp, trailerSrc } from "../src/trailerHealth";

describe("hero trailer (#240)", () => {
  beforeEach(resetTrailerHealth);
  it("plays a YouTube trailer through the Hub and anything else as it is", () => {
    expect(trailerSrc({ name: "T", url: "https://www.youtube.com/watch?v=abcDEF12345" })).toBe("/api/trailers/abcDEF12345");
    expect(trailerSrc({ name: "T", url: "/demo/clip.mp4" })).toBe("/demo/clip.mp4");
  });
  it("gives up for the session when a quarter of the frames drop", () => {
    reportTrailerHealth(0.1);
    expect(trailerGivenUp()).toBe(false);
    reportTrailerHealth(0.3);
    expect(trailerGivenUp()).toBe(true);
  });
});
