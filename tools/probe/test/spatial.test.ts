import { describe, expect, it } from "vitest";
import { directionForKey, nextIndex, type Box } from "../src/spatial";

const box = (left: number, top: number, width = 100, height = 50): Box => ({ left, top, width, height });

describe("nextIndex", () => {
  // A 3×2 grid of tiles, 120px apart horizontally and 70px vertically.
  const grid = [box(0, 0), box(120, 0), box(240, 0), box(0, 70), box(120, 70), box(240, 70)];

  it("moves along a row", () => {
    expect(nextIndex(grid[0]!, grid, "right")).toBe(1);
    expect(nextIndex(grid[1]!, grid, "left")).toBe(0);
  });

  it("moves down within the same column", () => {
    expect(nextIndex(grid[1]!, grid, "down")).toBe(4);
    expect(nextIndex(grid[5]!, grid, "up")).toBe(2);
  });

  it("returns -1 at an edge", () => {
    expect(nextIndex(grid[0]!, grid, "left")).toBe(-1);
    expect(nextIndex(grid[3]!, grid, "down")).toBe(-1);
  });

  it("prefers the aligned element over a closer diagonal one", () => {
    const from = box(0, 0);
    const candidates = [box(110, 200), box(0, 300)];
    expect(nextIndex(from, candidates, "down")).toBe(1);
  });
});

describe("directionForKey", () => {
  it("maps arrow keys", () => {
    expect(directionForKey(37)).toBe("left");
    expect(directionForKey(40)).toBe("down");
    expect(directionForKey(13)).toBeNull();
  });
});
