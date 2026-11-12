// Following series (issue #226): who follows what, what is new, what is coming up and the pop-up.

import { describe, expect, it } from "vitest";
import type { TitleRef } from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { EventBus } from "../src/events.js";
import { Following, type FollowingDeps } from "../src/following.js";
import { ProgressStore } from "../src/progress.js";
import { ContentFilter, NO_FILTER } from "../src/profiles.js";
import type { SeriesSchedule } from "../src/services/tmdb.js";

const NOW = Date.parse("2026-11-12T10:00:00");
const day = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const show = (n: number, name: string, extra: Partial<TitleRef> = {}): TitleRef => ({ id: `tmdb:series:${n}`, kind: "series", name, ...extra });

function setup(schedules: Record<number, SeriesSchedule>, over: Partial<FollowingDeps> = {}) {
  const db = new Db(":memory:");
  const events = new EventBus();
  const sent: unknown[] = [];
  events.on((e) => sent.push(e));
  const tmdb = {
    schedule: async (id: number) => schedules[id] ?? {},
    season: async (_id: number, season: number) => ({ season, name: `Series ${season}`, episodes: [] }),
    match: async (_k: string, name: string) => (name === "Taskmaster" ? show(99, "Taskmaster") : null),
  };
  const deps: FollowingDeps = {
    db,
    events,
    progress: new ProgressStore(db),
    nextAirings: { find: () => new Map() } as never,
    tmdb: () => tmdb as never,
    media: () => null,
    watchlist: () => [],
    links: () => [],
    queue: () => [],
    profileIds: () => ["dad"],
    ...over,
  };
  return { f: new Following(deps), db, sent, deps };
}

describe("Following", () => {
  it("follows on purpose and keeps an unfollowed series off, even when it is added by itself", async () => {
    const { f } = setup({}, { watchlist: () => [{ id: "w1", name: "Severance", kind: "series", title: show(1, "Severance"), addedAt: 1, from: "tv" }] });
    expect((await f.followed(null, NO_FILTER)).map((x) => [x.title.name, x.reason])).toEqual([["Severance", "saved"]]);
    f.follow(null, show(2, "Slow Horses"));
    expect((await f.followed(null, NO_FILTER)).map((x) => x.title.name)).toEqual(["Slow Horses", "Severance"]);
    f.unfollow(null, show(1, "Severance"));
    expect((await f.followed(null, NO_FILTER)).map((x) => x.title.name)).toEqual(["Slow Horses"]);
    // Following again turns it back on.
    f.follow(null, show(1, "Severance"));
    expect((await f.followed(null, NO_FILTER)).map((x) => x.title.name)).toContain("Severance");
  });

  it("keeps each profile's list its own", async () => {
    const { f } = setup({});
    f.follow("dad", show(2, "Slow Horses"));
    expect(await f.followed("mum", NO_FILTER)).toEqual([]);
    expect(await f.followed("dad", NO_FILTER)).toHaveLength(1);
  });

  it("follows a series link by looking the show up", async () => {
    const { f } = setup({}, { links: () => [{ title: "Taskmaster", seriesKey: "k" } as never] });
    expect((await f.followed(null, NO_FILTER)).map((x) => [x.title.id, x.reason])).toEqual([["tmdb:series:99", "link"]]);
  });

  it("gives a Guest only what it follows itself", async () => {
    const guest = new ContentFilter({ id: "g", name: "Guest", kind: "guest" } as never);
    const { f } = setup({}, { watchlist: () => [{ id: "w1", name: "Severance", kind: "series", title: show(1, "Severance"), addedAt: 1, from: "tv" }] });
    expect(await f.followed("g", guest)).toEqual([]);
  });

  it("lists an episode that aired this week as new, newest first, until it is watched", async () => {
    const { f, deps } = setup({
      1: { last: { season: 2, episode: 3, airDate: day(-2), name: "Three" } },
      2: { last: { season: 1, episode: 8, airDate: day(-1) } },
      3: { last: { season: 1, episode: 1, airDate: day(-40) } },
    });
    for (const [n, name] of [[1, "A"], [2, "B"], [3, "C"]] as const) f.follow(null, show(n, name));
    const v = await f.view(null, NO_FILTER, NOW);
    expect(v.newEpisodes.map((e) => [e.title.name, e.episodeId])).toEqual([["B", "s1e8"], ["A", "s2e3"]]);
    expect(f.asRow(v.newEpisodes, NOW)[0]).toMatchObject({ badges: ["New"], episodeId: "s1e8" });
    deps.progress.save({ key: "tmdb:series:2|s1e8", episodeId: "s1e8", positionMs: 0, durationMs: 1000, watched: true, title: show(2, "B") } as never);
    const again = await f.view(null, NO_FILTER, NOW);
    expect(again.newEpisodes.map((e) => e.title.name)).toEqual(["A"]);
  });

  it("lists the next seven days of air dates, with a label for the day", async () => {
    const { f } = setup({
      1: { next: { season: 2, episode: 4, airDate: day(1), name: "Four" } },
      2: { next: { season: 1, episode: 1, airDate: day(10) } },
      3: { next: { season: 1, episode: 2, airDate: day(0) } },
    });
    for (const [n, name] of [[1, "A"], [2, "B"], [3, "C"]] as const) f.follow(null, show(n, name));
    const v = await f.view(null, NO_FILTER, NOW);
    expect(v.comingUp.map((c) => [c.title.name, c.when, c.episode])).toEqual([["C", "Today", 2], ["A", "Tomorrow", 4]]);
  });

  it("attaches the guide's airing only when it is near the air date", async () => {
    const airing = (start: number) => ({ programmeId: "p", channelId: "c", channelName: "Dave", channelNumber: 1, start, end: start + 3_600_000, when: "x" });
    const near = new Date(NOW);
    near.setDate(near.getDate() + 1);
    near.setHours(21, 0, 0, 0);
    const { f } = setup({ 1: { next: { season: 2, episode: 4, airDate: day(1) } }, 2: { next: { season: 1, episode: 1, airDate: day(1) } } }, {
      nextAirings: { find: (items: { id: string }[]) => new Map(items.map((i) => [i.id, airing(i.id === "tmdb:series:1" ? near.getTime() : NOW)])) } as never,
    });
    f.follow(null, show(1, "A"));
    f.follow(null, show(2, "B"));
    const v = await f.view(null, NO_FILTER, NOW);
    expect(v.comingUp.find((c) => c.title.name === "A")?.next?.channelName).toBe("Dave");
    expect(v.comingUp.find((c) => c.title.name === "B")?.next).toBeUndefined();
  });

  it("counts an episode a media server has just added, whatever TMDB says", async () => {
    const media = { key: (id: string) => `jellyfin:${id}`, latest: async () => [{ Id: "e1", Name: "Pilot", Type: "Episode", SeriesName: "Severance", SeriesId: "s1", ParentIndexNumber: 1, IndexNumber: 2, PremiereDate: new Date(NOW - 86_400_000).toISOString() }] };
    const { f } = setup({}, { media: () => media as never });
    f.follow(null, show(1, "Severance"));
    const v = await f.view(null, NO_FILTER, NOW);
    expect(v.newEpisodes[0]).toMatchObject({ episodeId: "s1e2", inLibrary: true });
  });

  it("pops an arrival up once, and not for the first look at a series", async () => {
    const schedules: Record<number, SeriesSchedule> = { 1: { last: { season: 1, episode: 1, airDate: day(-1) } } };
    const { f, sent } = setup(schedules);
    f.follow("dad", show(1, "A"));
    expect(await f.checkArrivals(() => NO_FILTER, NOW)).toBe(0);
    schedules[1] = { last: { season: 1, episode: 2, airDate: day(0) } };
    expect(await f.checkArrivals(() => NO_FILTER, NOW)).toBe(1);
    expect(await f.checkArrivals(() => NO_FILTER, NOW)).toBe(0);
    expect(sent).toContainEqual(expect.objectContaining({ type: "episode.new", profileId: "dad", message: "New episode of A: S1 E2" }));
    f.setPopups("dad", false);
    schedules[1] = { last: { season: 1, episode: 3, airDate: day(0) } };
    expect(await f.checkArrivals(() => NO_FILTER, NOW)).toBe(0);
  });
});
