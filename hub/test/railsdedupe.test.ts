import { describe, expect, it } from "vitest";
import type { Rail, TitleRef } from "@ultimatetv/shared";
import { dedupeRails } from "../src/railsdedupe.js";

const t = (name: string, id = name): TitleRef => ({ id, kind: "series", name });
const row = (id: string, ...names: string[]): Rail => ({ id, title: id, kind: "titles", items: names.map((n) => t(n)) });

describe("dedupeRails", () => {
  it("keeps a title once per row, even from different sources", () => {
    const r = dedupeRails([{ id: "a", title: "a", kind: "titles", items: [t("Man vs Bee", "jf1"), t("Man Vs. Bee", "tmdb:2"), t("B"), t("C"), t("D")] }], { maxRows: 3 });
    expect(r[0]!.items).toHaveLength(4);
    expect(r[0]!.items![0]!.id).toBe("jf1");
  });
  it("caps how many rows show one title and drops thin rows", () => {
    const r = dedupeRails([row("a", "X", "Y", "Z"), row("b", "X", "Y", "Z"), row("c", "X", "Y", "Z", "W")], { maxRows: 2 });
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("leaves exempt rows alone", () => {
    const r = dedupeRails([row("a", "X", "Y", "Z"), row("again", "X", "Y", "Z")], { maxRows: 1, exempt: new Set(["again"]) });
    expect(r).toHaveLength(2);
  });
});
