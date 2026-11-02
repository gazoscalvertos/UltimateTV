// What's new is remembered per profile: each profile gets the pop-up once (issue #111).

import { describe, expect, it } from "vitest";
import { LEGACY_SEEN_KEY, readSeen, seenKey, writeSeen } from "../src/whatsnewSeen.js";

/** localStorage in a Map, so the logic can be tested without a browser. */
function store(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("what's new, per profile", () => {
  it("keeps one seen change for each profile", () => {
    expect(seenKey("p1")).not.toBe(seenKey("p2"));
    expect(seenKey("p1")).toContain("p1");
  });

  it("remembers what a profile has seen", () => {
    const s = store();
    writeSeen(s, "p1", "2026-11-02/alerts");
    expect(readSeen(s, "p1")).toBe("2026-11-02/alerts");
    // Another profile hasn't seen it, so it gets its own pop-up.
    expect(readSeen(s, "p2")).toBeNull();
  });

  it("carries the old household-wide record over to each profile that has never looked", () => {
    const s = store({ [LEGACY_SEEN_KEY]: "2026-11-01/old" });
    expect(readSeen(s, "p1")).toBe("2026-11-01/old");
    // Copied to the profile, so what comes after that is counted from there, per profile.
    expect(s.map.get(seenKey("p1"))).toBe("2026-11-01/old");
    // A second profile hasn't looked either, and this TV has already shown up to the same point.
    expect(readSeen(s, "p2")).toBe("2026-11-01/old");
    // From here they part ways: p1 sees something new, p2 has not.
    writeSeen(s, "p1", "2026-11-02/alerts");
    expect(readSeen(s, "p1")).toBe("2026-11-02/alerts");
    expect(readSeen(s, "p2")).toBe("2026-11-01/old");
  });

  it("does not copy a legacy record over one the profile already has", () => {
    const s = store({ [LEGACY_SEEN_KEY]: "2026-11-01/old", [seenKey("p1")]: "2026-11-02/new" });
    expect(readSeen(s, "p1")).toBe("2026-11-02/new");
  });

  it("copes with storage that throws", () => {
    const bad = {
      getItem: () => {
        throw new Error("no storage");
      },
      setItem: () => {
        throw new Error("no storage");
      },
    };
    expect(readSeen(bad, "p1")).toBeNull();
    expect(() => writeSeen(bad, "p1", "2026-11-02/alerts")).not.toThrow();
  });
});
