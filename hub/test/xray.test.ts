// X-Ray: the cast of a title with photos and characters, an episode's guest stars, and a person's bio.

import { describe, expect, it } from "vitest";
import { Db } from "../src/db.js";
import { TmdbClient } from "../src/services/tmdb.js";

function client(routes: Record<string, unknown>) {
  const impl = (async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  return new TmdbClient("k", new Db(":memory:"), impl);
}

describe("X-Ray cast", () => {
  it("lists a film's cast with photos and characters, dropping the bracketed notes", async () => {
    const t = client({ "/movie/949/credits": { cast: [{ id: 1, name: "Al Pacino", character: "Vincent Hanna (voice)", profile_path: "/a.jpg" }, { id: 2, name: "No Photo" }] } });
    const cast = await t.castOf("movie", 949);
    expect(cast[0]).toEqual({ id: 1, name: "Al Pacino", character: "Vincent Hanna", photo: "https://image.tmdb.org/t/p/w300/a.jpg" });
    expect(cast[1]).toEqual({ id: 2, name: "No Photo" });
  });

  it("keeps a series' regulars who are in the episode and adds its guest stars", async () => {
    const t = client({
      "/tv/10/aggregate_credits": { cast: [{ id: 1, name: "Lead", roles: [{ character: "Boss" }] }, { id: 2, name: "Absent", roles: [{ character: "Away" }] }] },
      "/tv/10/season/1/episode/3/credits": { cast: [{ id: 1, name: "Lead" }], guest_stars: [{ id: 9, name: "Guest", character: "Visitor" }] },
    });
    const cast = await t.castOf("series", 10, { season: 1, episode: 3 });
    expect(cast.map((c) => c.name)).toEqual(["Lead", "Guest"]);
    expect(cast[0]?.character).toBe("Boss");
    expect(cast[1]?.guest).toBe(true);
  });

  it("falls back to the series list when the episode has no credits", async () => {
    const t = client({ "/tv/10/aggregate_credits": { cast: [{ id: 1, name: "Lead", roles: [] }] } });
    expect((await t.castOf("series", 10, { season: 1, episode: 3 })).map((c) => c.name)).toEqual(["Lead"]);
  });

  it("builds a person's page with a trimmed bio and known-for titles by popularity", async () => {
    const t = client({ "/person/1": { id: 1, name: "Al", biography: "word ".repeat(300), birthday: "1940-04-25", place_of_birth: "New York", combined_credits: { cast: [{ title: "Small", vote_count: 1 }, { title: "Big", vote_count: 99 }, { name: "Big", vote_count: 5 }] } } });
    const p = await t.person(1);
    expect(p.bio!.length).toBeLessThan(710);
    expect(p.bio!.endsWith("…")).toBe(true);
    expect(p.knownFor).toEqual(["Big", "Small"]);
    expect(p.born).toBe("1940-04-25");
  });
});
