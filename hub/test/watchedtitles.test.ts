// Watched titles in suggestions: what is noted per profile, how titles match across catalogues, and
// how the setting (put last, hide, off) changes a list.

import { describe, expect, it } from "vitest";
import type { TitleRef } from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { ContentFilter } from "../src/profiles.js";
import { cleanSeenMode, deprioritise, WatchedTitles } from "../src/watchedtitles.js";

const film = (id: string, name: string, year?: number): TitleRef => ({ id, kind: "movie", name, ...(year ? { year } : {}) });

describe("WatchedTitles", () => {
  const store = () => new WatchedTitles(new Db(":memory:"));

  it("keeps each profile's watching to itself", () => {
    const w = store();
    w.mark("dad", film("tmdb:movie:1", "Heat", 1995));
    expect(w.lookup("dad")(film("tmdb:movie:1", "Heat"))).toBe(true);
    expect(w.lookup("kid")(film("tmdb:movie:1", "Heat"))).toBe(false);
  });

  it("recognises a title under another id by its name and year", () => {
    const w = store();
    w.mark(null, film("jellyfin:abc", "The Matrix", 1999));
    const seen = w.lookup(null);
    expect(seen(film("tmdb:movie:603", "The Matrix", 1999))).toBe(true);
    expect(seen(film("xtream:vod:9", "Matrix", 2000))).toBe(true);
    expect(seen(film("tmdb:movie:604", "The Matrix Reloaded", 2003))).toBe(false);
    expect(seen(film("tmdb:movie:1", "The Matrix", 2021))).toBe(false);
  });

  it("does not mistake a series for a film of the same name", () => {
    const w = store();
    w.mark(null, { id: "tmdb:series:1", kind: "series", name: "Luther" });
    expect(w.lookup(null)(film("tmdb:movie:2", "Luther"))).toBe(false);
  });

  it("counts what the media servers played, on any device, for every profile", () => {
    const w = store();
    w.setServerPlayed([{ id: "jellyfin:x", kind: "movie", name: "Dune", year: 2021 }]);
    expect(w.lookup("kid")(film("tmdb:movie:438631", "Dune", 2021))).toBe(true);
    // A fresh answer replaces the old one, so a title marked unplayed there drops out.
    w.setServerPlayed([]);
    expect(w.lookup("kid")(film("tmdb:movie:438631", "Dune", 2021))).toBe(false);
  });

  it("forgets a title marked not watched", () => {
    const w = store();
    w.mark("dad", film("tmdb:movie:1", "Heat", 1995));
    w.unmark("dad", film("tmdb:movie:1", "Heat", 1995));
    expect(w.lookup("dad")(film("tmdb:movie:1", "Heat"))).toBe(false);
  });
});

describe("deprioritise", () => {
  const list = ["a", "b", "c", "d"];
  const seen = (x: string) => x === "a" || x === "c";

  it("puts watched ones last, in their order", () => expect(deprioritise(list, seen, "end")).toEqual(["b", "d", "a", "c"]));
  it("hides them", () => expect(deprioritise(list, seen, "hide")).toEqual(["b", "d"]));
  it("does nothing when off", () => expect(deprioritise(list, seen, "off")).toBe(list));
  it("reads an unknown setting as put last", () => expect(cleanSeenMode("nonsense")).toBe("end"));
});

describe("ContentFilter.unseen", () => {
  const w = new WatchedTitles(new Db(":memory:"));
  w.mark("dad", film("tmdb:movie:1", "Heat", 1995));
  const items = [film("tmdb:movie:1", "Heat", 1995), film("tmdb:movie:2", "Ronin", 1998)];
  const filter = (mode: "end" | "hide" | "off") => new ContentFilter(null, undefined, undefined, { lookup: w.lookup("dad"), mode });

  it("moves watched titles back", () => expect(filter("end").unseen(items).map((t) => t.name)).toEqual(["Ronin", "Heat"]));
  it("drops them when hiding", () => expect(filter("hide").unseen(items).map((t) => t.name)).toEqual(["Ronin"]));
  it("keeps everything when off", () => expect(filter("off").unseen(items)).toEqual(items));
  it("never drops a title the viewer searched for", () => expect(filter("hide").unseen(items, true).map((t) => t.name)).toEqual(["Ronin", "Heat"]));
  it("leaves a filter with nothing tracked alone", () => expect(new ContentFilter(null).unseen(items)).toEqual(items));
});
