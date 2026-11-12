// Collections and franchises (issue #238): library BoxSets and TMDB collections, release order,
// Kids rules per film, and the next film in a collection.

import { describe, expect, it } from "vitest";
import { collectionIdOf, firstToWatch, isCollectionId, nextInCollection, releaseOrder } from "@ultimatetv/shared";
import { Collections } from "../src/collections.js";
import { ContentFilter, NO_FILTER } from "../src/profiles.js";
import type { JfItem } from "../src/services/media.js";

const film = (id: string, name: string, year: number, rating: string, extra: Partial<JfItem> = {}): JfItem => ({ Id: id, Name: name, Type: "Movie", ProductionYear: year, OfficialRating: rating, ...extra });

const bond = [film("m3", "Goldfinger", 1964, "PG"), film("m1", "Dr. No", 1962, "PG", { UserData: { Played: true } }), film("m2", "From Russia with Love", 1963, "PG"), film("m4", "Casino Royale", 2006, "12A")];
const potter = [film("p1", "Philosopher's Stone", 2001, "PG"), film("p2", "Chamber of Secrets", 2002, "PG"), film("p7", "Deathly Hallows", 2010, "12A")];

function fakeMedia() {
  const sets: Record<string, JfItem[]> = { b1: bond, h1: potter };
  return {
    key: (id: string) => `jellyfin:${id}`,
    toTitleRef: (i: JfItem) => ({ id: `jellyfin:${i.Id}`, kind: "movie" as const, name: i.Name, ...(i.ProductionYear ? { year: i.ProductionYear } : {}), ...(i.OfficialRating ? { certification: i.OfficialRating } : {}), genres: [] }),
    image: () => undefined,
    collections: async (): Promise<JfItem[]> => [
      { Id: "b1", Name: "James Bond Collection", Type: "BoxSet", Overview: "007" },
      { Id: "h1", Name: "Harry Potter Collection", Type: "BoxSet" },
    ],
    collectionItems: async (id: string) => sets[id] ?? [],
    hasProviderId: async () => false,
  };
}

const make = (extra: Record<string, unknown> = {}) => new Collections({ media: () => fakeMedia(), tmdb: () => null, ...extra } as never);

const kids = new ContentFilter({ id: "k", name: "Kids", kind: "kids", maxCertification: "PG" } as never);

describe("shared helpers", () => {
  it("orders films by release date, then year, then name", () => {
    const ordered = releaseOrder([{ name: "C", year: 2010 }, { name: "A", year: 1999 }, { name: "B", year: 2005, released: "2004-12-31" }, { name: "No date" }]);
    expect(ordered.map((f) => f.name)).toEqual(["A", "B", "C", "No date"]);
  });
  it("finds the next film that has not been watched", () => {
    const films = [{ id: "a", kind: "movie" as const, name: "A", watched: true }, { id: "b", kind: "movie" as const, name: "B" }, { id: "c", kind: "movie" as const, name: "C", watched: true }, { id: "d", kind: "movie" as const, name: "D" }];
    expect(nextInCollection(films, "a")?.id).toBe("b");
    expect(nextInCollection(films, "b")?.id).toBe("d");
    expect(nextInCollection(films, "d")).toBeUndefined();
    expect(firstToWatch(films)?.id).toBe("b");
    expect(firstToWatch(films.map((f) => ({ ...f, watched: true })))?.id).toBe("a");
  });
  it("tells a collection id from a title id", () => {
    expect(isCollectionId(collectionIdOf("jellyfin:b1"))).toBe(true);
    expect(isCollectionId("jellyfin:b1")).toBe(false);
  });
});

describe("collections from the media server", () => {
  it("lists them as cards with how many films the profile can see", async () => {
    const cards = await make().cards(NO_FILTER);
    expect(cards.map((c) => [c.name, c.subtitle])).toEqual([["Harry Potter Collection", "3 films"], ["James Bond Collection", "4 films"]]);
    expect(cards[0]!.id).toBe("collection:jellyfin:h1");
  });

  it("opens one in release order with Play on the first unwatched film", async () => {
    const view = await make().view("collection:jellyfin:b1", NO_FILTER);
    expect(view?.films.map((f) => f.name)).toEqual(["Dr. No", "From Russia with Love", "Goldfinger", "Casino Royale"]);
    expect(view?.films[0]?.watched).toBe(true);
    expect(view?.next?.name).toBe("From Russia with Love");
  });

  it("applies Kids ratings per film, not per collection", async () => {
    const c = make();
    const view = await c.view("collection:jellyfin:b1", kids);
    expect(view?.films.map((f) => f.name)).toEqual(["Dr. No", "From Russia with Love", "Goldfinger"]);
    const cards = await c.cards(kids);
    expect(cards.find((x) => x.name.startsWith("James"))?.subtitle).toBe("3 films");
  });

  it("leaves a collection out when a profile can see fewer than two of its films", async () => {
    const strict = new ContentFilter({ id: "k", name: "Kids", kind: "kids", maxCertification: "U" } as never);
    expect(await make().cards(strict)).toEqual([]);
    expect(await make().view("collection:jellyfin:b1", strict)).toBeUndefined();
  });

  it("says which collection a film is in, where it sits and what follows", async () => {
    const c = await make().of({ id: "jellyfin:m2" }, NO_FILTER);
    expect(c?.name).toBe("James Bond Collection");
    expect([c?.position, c?.total]).toEqual([1, 4]);
    expect(c?.next?.name).toBe("Goldfinger");
  });

  it("skips what a Kids profile cannot see when picking the next film", async () => {
    const c = await make().of({ id: "jellyfin:m3" }, kids);
    expect(c?.total).toBe(3);
    expect(c?.next).toBeUndefined();
    const potterKid = await make().of({ id: "jellyfin:p1" }, kids);
    expect(potterKid?.next?.name).toBe("Chamber of Secrets");
  });

  it("finds a film by its TMDB id too, and knows nothing of a film outside any collection", async () => {
    const media = fakeMedia();
    const withIds = potter.map((f) => ({ ...f, ProviderIds: { Tmdb: f.Id === "p2" ? "777" : "1" } }));
    const c = new Collections({ media: () => ({ ...media, collectionItems: async (id: string) => (id === "h1" ? withIds : []) }), tmdb: () => null } as never);
    expect((await c.of({ id: "tmdb:movie:777", tmdbId: 777 }, NO_FILTER))?.name).toBe("Harry Potter Collection");
    expect(await c.of({ id: "jellyfin:nope" }, NO_FILTER)).toBeUndefined();
  });
});

describe("TMDB's collections", () => {
  const tmdb = {
    collectionOf: async (id: number) => (id === 100 ? 645 : undefined),
    collection: async (id: number) => ({
      id,
      name: "The James Bond Collection",
      films: [
        { ref: { id: "tmdb:movie:101", kind: "movie" as const, name: "Goldfinger", year: 1964, genres: [] }, released: "1964-09-17" },
        { ref: { id: "tmdb:movie:100", kind: "movie" as const, name: "Dr. No", year: 1962, genres: [] }, released: "1962-10-05" },
      ],
    }),
  };

  it("covers a film that only exists online, in release order, marking what the library has", async () => {
    const media = { ...fakeMedia(), collections: async () => [] as JfItem[], hasProviderId: async (_p: string, id: string) => id === "101" };
    const c = new Collections({ media: () => media, tmdb: () => tmdb } as never);
    const found = await c.of({ id: "tmdb:movie:100", tmdbId: 100 }, NO_FILTER);
    expect(found?.id).toBe("collection:tmdb:645");
    expect(found?.films.map((f) => f.name)).toEqual(["Dr. No", "Goldfinger"]);
    expect(found?.films[1]?.badges).toEqual(["In your library"]);
    expect([found?.position, found?.next?.name]).toEqual([0, "Goldfinger"]);
  });

  it("has nothing to say about a film in no collection", async () => {
    const c = new Collections({ media: () => null, tmdb: () => tmdb } as never);
    expect(await c.of({ id: "tmdb:movie:5", tmdbId: 5 }, NO_FILTER)).toBeUndefined();
  });
});
