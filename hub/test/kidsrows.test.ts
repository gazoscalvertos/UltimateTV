import { describe, expect, it } from "vitest";
import { buildKidsRails, type KidsCandidate } from "../src/kidsrows.js";

const film = (name: string, year: number, rating: number, genres: string[], extra: Partial<KidsCandidate> = {}, cert = "U"): KidsCandidate => ({
  ref: { id: name, kind: "movie", name, certification: cert },
  year,
  rating,
  genres,
  watched: false,
  ...extra,
});

const lib: KidsCandidate[] = [
  film("A", 2026, 8, ["Animation", "Comedy"]),
  film("B", 2026, 7, ["Animation", "Family"]),
  film("C", 2026, 9, ["Adventure", "Animation"]),
  film("D", 2025, 6, ["Family"], {}, "PG"),
  film("E", 2025, 7.5, ["Fantasy"], {}, "PG"),
  film("F", 2025, 8.5, ["Music"], {}, "PG"),
  film("G", 2024, 5, ["Comedy"]),
];

describe("buildKidsRails", () => {
  const rails = buildKidsRails("movie", lib, { thisYear: 2026 });
  const ids = rails.map((r) => r.id);

  it("makes Best of rows newest year first, best rated first, skipping years with too few titles", () => {
    expect(ids.filter((i) => i.startsWith("bestof-"))).toEqual(["bestof-2026", "bestof-2025"]);
    expect(rails.find((r) => r.id === "bestof-2026")!.items.map((t) => t.name)).toEqual(["C", "A", "B"]);
    expect(rails.find((r) => r.id === "bestof-2025")!.title).toBe("Best of 2025");
  });

  it("builds genre and age-band rows only when they have enough titles", () => {
    expect(ids).toContain("kids-genre-animation");
    expect(ids).toContain("kids-little");
    expect(ids).toContain("kids-middle");
    expect(ids).not.toContain("kids-genre-mystery");
  });

  it("never shows a title that wasn't passed in", () => {
    const allowed = new Set(lib.map((c) => c.ref.name));
    for (const r of rails) for (const t of r.items) expect(allowed.has(t.name)).toBe(true);
  });

  it("puts watched titles in Watch again, most recent first, and out of New additions", () => {
    const seen = [
      film("X", 2020, 7, [], { watched: true, lastPlayed: "2026-01-01" }),
      film("Y", 2020, 7, [], { watched: true, lastPlayed: "2026-03-01" }),
      film("Z", 2020, 7, [], { watched: true, lastPlayed: "2026-02-01" }),
      ...lib,
    ];
    const r = buildKidsRails("movie", seen, { thisYear: 2026 });
    expect(r.find((x) => x.id === "kids-again")!.items.map((t) => t.name)).toEqual(["Y", "Z", "X"]);
    expect(r.find((x) => x.id === "kids-new")!.items.map((t) => t.name)).not.toContain("X");
  });
});
