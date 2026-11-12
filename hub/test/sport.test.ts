// Sport tonight (issue #231): what counts as sport, matching favourites, the day's list and the
// automatic reminders.

import { describe, expect, it } from "vitest";
import type { Channel, Programme } from "@ultimatetv/shared";
import { cleanSportTeams, isSportProgramme, matchFavourite, teamsIn } from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { EventBus } from "../src/events.js";
import { Sport, type SportDeps } from "../src/sport.js";
import { ContentFilter, NO_FILTER } from "../src/profiles.js";

const NOW = Date.parse("2026-11-12T14:00:00");
const H = 3_600_000;

const channel = (id: string, category: Channel["category"], extra: Partial<Channel> = {}): Channel => ({ id, number: 400, name: id, category, feeds: [], favourite: false, hidden: false, maxHeight: 1080, catchupDays: 0, ...extra }) as Channel;
const prog = (channelId: string, title: string, startH: number, durH = 2, extra: Partial<Programme> = {}): Programme => ({
  id: `${channelId}:${NOW + startH * H}`,
  channelId,
  start: NOW + startH * H,
  end: NOW + (startH + durH) * H,
  title,
  categories: ["Sport"],
  isNew: false,
  isRepeat: false,
  isFilm: false,
  ...extra,
});

describe("what counts as sport", () => {
  it("goes by the guide category, or a sport channel", () => {
    expect(isSportProgramme({ title: "Match of the Day", categories: ["Football"] })).toBe(true);
    expect(isSportProgramme({ title: "Soap", categories: ["Drama"] }, channel("a", "entertainment"))).toBe(false);
    expect(isSportProgramme({ title: "Anything", categories: [] }, channel("s", "sport"))).toBe(true);
    expect(isSportProgramme({ title: "Close", categories: [] }, channel("s", "sport"))).toBe(false);
    // A channel moved by hand to another category isn't sport any more.
    expect(isSportProgramme({ title: "Anything", categories: [] }, channel("s", "sport", { userCategory: "other" }))).toBe(false);
  });
});

describe("favourites", () => {
  it("matches whole words in the title, subtitle and description", () => {
    expect(matchFavourite({ title: "Premier League: Arsenal v Spurs" }, ["Arsenal"])).toBe("Arsenal");
    expect(matchFavourite({ title: "Highlights", description: "Formula 1 qualifying from Brazil." }, ["formula 1"])).toBe("formula 1");
    expect(matchFavourite({ title: "Arsenals of the world" }, ["Arsenal"])).toBeUndefined();
    expect(matchFavourite({ title: "Café Sport" }, ["cafe"])).toBe("cafe");
  });

  it("offers the two sides of a fixture, or the competition", () => {
    expect(teamsIn("Premier League: Arsenal v Tottenham")).toEqual(["Arsenal", "Tottenham"]);
    expect(teamsIn("Live: Chelsea vs Liverpool (Live)")).toEqual(["Chelsea", "Liverpool"]);
    expect(teamsIn("Formula 1: Qualifying")).toEqual(["Formula 1"]);
    expect(teamsIn("Goals Express")).toEqual([]);
  });

  it("keeps a clean list", () => {
    expect(cleanSportTeams([" Arsenal ", "arsenal", "x", 3, "Formula 1"])).toEqual(["Arsenal", "Formula 1"]);
  });
});

function setup(programmes: Programme[], channels: Channel[], over: Partial<SportDeps> = {}) {
  const db = new Db(":memory:");
  const events = new EventBus();
  const reminders: string[] = [];
  const recorded: string[] = [];
  const deps: SportDeps = {
    db,
    events,
    guide: { between: (from: number, to: number) => programmes.filter((p) => p.start >= from && p.start < to).sort((a, b) => a.start - b.start) },
    channels: { get: (id: string) => channels.find((c) => c.id === id) } as never,
    reminders: () => reminders.map((id) => ({ id })),
    recording: (id) => (recorded.includes(id) ? ({ id } as never) : undefined),
    addReminder: (id) => void reminders.push(id),
    record: (id) => void recorded.push(id),
    profileIds: () => ["kid"],
    isKids: (id) => id === "kid",
    ...over,
  };
  return { sport: new Sport(deps), reminders, recorded, db };
}

describe("Sport today", () => {
  const sky = channel("sky", "sport", { number: 401 });
  const bbc = channel("bbc", "entertainment", { number: 101 });
  const music = channel("mix", "music", { mix: true } as never);

  it("lists today's sport soonest first, live games first, and leaves out the rest", () => {
    const { sport } = setup(
      [prog("sky", "Later game", 5), prog("sky", "Live now", -1), prog("bbc", "Soap", 1, 1, { categories: ["Drama"] }), prog("bbc", "Match of the Day", 3, 1, { categories: ["Football"] }), prog("sky", "Tomorrow", 20), prog("mix", "Video", 1)],
      [sky, bbc, music],
    );
    const v = sport.view(null, NO_FILTER, NOW);
    expect(v.matches.map((m) => m.programme.title)).toEqual(["Live now", "Match of the Day", "Later game"]);
    expect(v.matches[0]).toMatchObject({ live: true, when: "Live now", channelName: "sky" });
    expect(v.matches[1]!.when).toBe("17:00");
  });

  it("marks favourites, puts them first on the Home row and lists their week", () => {
    const { sport } = setup([prog("sky", "Chelsea v Liverpool", 1), prog("sky", "Premier League: Arsenal v Spurs", 3), prog("sky", "Arsenal v Everton", 30)], [sky]);
    sport.addTeam(null, "Arsenal");
    const v = sport.view(null, NO_FILTER, NOW);
    expect(v.matches.find((m) => m.favourite)?.programme.title).toContain("Spurs");
    expect(sport.row(null, NO_FILTER, NOW)[0]!.programme.title).toContain("Spurs");
    expect(v.mine.map((m) => m.programme.title)).toEqual(["Premier League: Arsenal v Spurs", "Arsenal v Everton"]);
  });

  it("shows a simulcast once", () => {
    const { sport } = setup([prog("sky", "Final", 2), prog("bbc", "Final", 2)], [sky, bbc]);
    expect(sport.view(null, NO_FILTER, NOW).matches).toHaveLength(1);
  });

  it("hides sport from a Kids profile unless the category is allowed", () => {
    const kids = (cats: Channel["category"][]) =>
      new ContentFilter({ id: "kid", name: "Kid", kind: "kids", colour: "#fff", maxCertification: "PG", channelCategories: cats, allowedChannels: [] } as never, undefined, undefined as never, undefined as never);
    const { sport } = setup([prog("sky", "Final", 2)], [sky]);
    expect(sport.view("kid", kids(["kids"]), NOW)).toMatchObject({ matches: [], available: false });
    expect(sport.view("kid", kids(["kids", "sport"]), NOW).matches).toHaveLength(1);
  });
});

describe("automatic reminders", () => {
  const sky = channel("sky", "sport");
  const filterFor = () => NO_FILTER;

  it("sets a reminder once for each favourite game, not for others", () => {
    const { sport, reminders, recorded } = setup([prog("sky", "Arsenal v Spurs", 5), prog("sky", "Chelsea v Villa", 6)], [sky]);
    sport.addTeam(null, "Arsenal");
    expect(sport.check(filterFor, NOW)).toEqual({ reminders: 1, recordings: 0 });
    expect(reminders).toEqual([`sky:${NOW + 5 * H}`]);
    expect(recorded).toEqual([]);
    // A reminder taken off by hand isn't made again.
    expect(sport.check(filterFor, NOW + H)).toEqual({ reminders: 0, recordings: 0 });
  });

  it("records too when asked, but never for a Kids profile", () => {
    const { sport, recorded } = setup([prog("sky", "Arsenal v Spurs", 5)], [sky]);
    sport.set(null, { teams: ["Arsenal"], record: true });
    sport.set("kid", { teams: ["Arsenal"], record: true });
    expect(sport.check(filterFor, NOW)).toEqual({ reminders: 2, recordings: 1 });
    expect(recorded).toHaveLength(1);
  });

  it("does nothing with no teams or both switches off, and skips what is already on", () => {
    const { sport, reminders } = setup([prog("sky", "Arsenal v Spurs", -1), prog("sky", "Arsenal v Villa", 5)], [sky]);
    expect(sport.check(filterFor, NOW)).toEqual({ reminders: 0, recordings: 0 });
    sport.set(null, { teams: ["Arsenal"], remind: false, record: false });
    expect(sport.check(filterFor, NOW)).toEqual({ reminders: 0, recordings: 0 });
    sport.set(null, { remind: true });
    sport.check(filterFor, NOW);
    expect(reminders).toEqual([`sky:${NOW + 5 * H}`]);
  });
});
