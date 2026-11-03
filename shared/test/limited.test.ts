import { describe, expect, it } from "vitest";
import type { Channel, GuideWindow, Programme, Profile } from "../src/index.js";
import { LIMITED_GUIDE_DAYS, LIMITED_MAX_PER_CHANNEL, allowsChannel, allowsTitle, certificationRank, limitedProfileFor, limitedView, parseLimitedSnapshot } from "../src/index.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_790_000_000_000;

function channel(id: string, extra: Partial<Channel> = {}): Channel {
  return { id, number: 101, name: id, category: "entertainment", feeds: [], favourite: false, hidden: false, maxHeight: 1080, catchupDays: 0, ...extra };
}

function programme(channelId: string, start: number, mins: number): Programme {
  return { id: `${channelId}:${start}`, channelId, start, end: start + mins * 60_000, title: `Show ${start}`, categories: [], isNew: false, isRepeat: false, isFilm: false };
}

function profile(extra: Partial<Profile> = {}): Profile {
  return { id: "p1", name: "Grown-up", kind: "adult", colour: "#fff", hasPin: false, maxCertification: "18", channelCategories: [], allowedChannels: [], ...extra };
}

describe("reading a Limited mode snapshot", () => {
  it("keeps the channels, their playable URLs and a week of guide", () => {
    const guide: GuideWindow = {
      from: NOW,
      to: NOW + 8 * DAY,
      channels: [channel("bbc-one")],
      programmes: { "bbc-one": [programme("bbc-one", NOW + 10 * DAY, 30), programme("bbc-one", NOW + HOUR, 30)] },
      marks: {},
    };
    const snap = parseLimitedSnapshot(
      JSON.stringify({ at: NOW, channels: [{ ...channel("bbc-one"), url: "http://nas/live/1.ts", headers: { "User-Agent": "VLC/3.0.21" } }], guide, profiles: [profile()] }),
      NOW,
    );
    expect(snap).not.toBeNull();
    expect(snap!.channels[0]).toMatchObject({ id: "bbc-one", url: "http://nas/live/1.ts", headers: { "User-Agent": "VLC/3.0.21" } });
    expect(snap!.profiles[0]).toMatchObject({ id: "p1", kind: "adult" });
    // The programme ten days out is beyond the week the box keeps.
    expect(snap!.guide.programmes["bbc-one"]).toHaveLength(1);
    expect(snap!.guide.to - snap!.guide.from).toBeLessThanOrEqual(LIMITED_GUIDE_DAYS * DAY + HOUR);
  });

  it("drops a channel whose rows leave nothing in the window, but keeps the channel", () => {
    const snap = parseLimitedSnapshot({ at: NOW, channels: [channel("a"), channel("b")], guide: { from: NOW, to: NOW + DAY, programmes: { a: [programme("a", NOW + HOUR, 30)] } }, profiles: [] }, NOW);
    expect(snap!.channels.map((c) => c.id)).toEqual(["a", "b"]);
    expect(snap!.guide.programmes["b"]).toBeUndefined();
  });

  it("keeps at most a bounded number of programmes per channel", () => {
    const many = Array.from({ length: 500 }, (_, i) => programme("a", NOW + i * 60_000, 1));
    const snap = parseLimitedSnapshot({ at: NOW, channels: [channel("a")], guide: { from: NOW, to: NOW + DAY, programmes: { a: many } }, profiles: [] }, NOW);
    expect(snap!.guide.programmes["a"]).toHaveLength(LIMITED_MAX_PER_CHANNEL);
  });

  it("falls back to nothing, without throwing, on a missing or corrupt cache", () => {
    expect(parseLimitedSnapshot(undefined, NOW)).toBeNull();
    expect(parseLimitedSnapshot("", NOW)).toBeNull();
    expect(parseLimitedSnapshot("{not json", NOW)).toBeNull();
    expect(parseLimitedSnapshot("null", NOW)).toBeNull();
    expect(parseLimitedSnapshot("[]", NOW)).toBeNull();
    expect(parseLimitedSnapshot({}, NOW)).toBeNull();
    expect(parseLimitedSnapshot({ channels: "nope" }, NOW)).toBeNull();
    expect(parseLimitedSnapshot({ channels: [] }, NOW)).toBeNull();
    // Rows of the wrong shape are left out rather than crashing the box.
    expect(parseLimitedSnapshot({ channels: [{ id: "a" }, null, { id: "b", name: "B" }], guide: "x", profiles: "y" }, NOW)!.channels.map((c) => c.id)).toEqual(["b"]);
  });

  it("reads a snapshot the Hub built as a fresh object, not a string", () => {
    const built = { at: NOW, channels: [{ ...channel("a"), url: "http://x/1.ts" }], guide: { from: NOW, to: NOW + DAY, programmes: {} }, profiles: [profile()] };
    expect(parseLimitedSnapshot(built, NOW)!.channels).toHaveLength(1);
  });
});

describe("the profile Limited mode uses", () => {
  const snap = parseLimitedSnapshot({ at: NOW, channels: [channel("a")], guide: { from: NOW, to: NOW + DAY, programmes: {} }, profiles: [profile(), profile({ id: "k", name: "Sam", kind: "kids", maxCertification: "PG" })] }, NOW)!;

  it("matches the profile by name, then falls back to the kids one for a kids viewer", () => {
    expect(limitedProfileFor(snap, { name: "Sam", kids: true })!.id).toBe("k");
    expect(limitedProfileFor(snap, { name: "Someone", kids: false })).toBeNull();
    expect(limitedProfileFor(snap, { name: "Someone", kids: true })!.id).toBe("k");
  });

  it("treats an unknown viewer as Kids, so nobody's rules are skipped by accident", () => {
    // The box only learns who is watching from the TV app; until then a child may be in front of it.
    expect(limitedProfileFor(snap, null)!.kind).toBe("kids");
    const none = parseLimitedSnapshot({ at: NOW, channels: [channel("a")], guide: { from: NOW, to: NOW + DAY, programmes: {} }, profiles: [] }, NOW)!;
    expect(limitedProfileFor(none, null)).toMatchObject({ kind: "kids", maxCertification: "U", channelCategories: ["kids"] });
    expect(limitedView(snap, null, NOW).kids).toBe(true);
  });

  it("gives a kids viewer the strictest rules when nothing is cached", () => {
    const none = parseLimitedSnapshot({ at: NOW, channels: [channel("a")], guide: { from: NOW, to: NOW + DAY, programmes: {} }, profiles: [] }, NOW)!;
    const p = limitedProfileFor(none, { name: "Sam", kids: true })!;
    expect(p).toMatchObject({ kind: "kids", maxCertification: "U", channelCategories: ["kids"] });
  });
});

describe("Kids rules from cached data", () => {
  it("shows a kids profile only its channel categories", () => {
    const kid = { ...profile({ id: "k", kind: "kids" as const }), kind: "kids" as const };
    expect(allowsChannel(kid, { id: "c", name: "CBBC", category: "kids" })).toBe(true);
    expect(allowsChannel(kid, { id: "x", name: "Sport", category: "sport" })).toBe(false);
  });

  it("lets a hand-picked channel through and blocks a blocked one first", () => {
    const kid = { ...profile({ id: "k", kind: "kids" as const, channelCategories: ["kids" as const], allowedChannels: ["sport-1"] }), kind: "kids" as const };
    expect(allowsChannel(kid, { id: "sport-1", name: "Sport 1", category: "sport" })).toBe(true);
    const blocked = { ...kid, allow: { allow: [], block: [{ id: "kids-1", kind: "channel" as const, name: "Kids 1", addedAt: NOW }] } };
    expect(allowsChannel(blocked, { id: "kids-1", name: "Kids 1", category: "kids" })).toBe(false);
    const allowed = { ...kid, allow: { allow: [{ id: "news-9", kind: "channel" as const, name: "News 9", addedAt: NOW }], block: [] } };
    expect(allowsChannel(allowed, { id: "news-9", name: "News 9", category: "news" })).toBe(true);
  });

  it("keeps films above the profile's certificate away, and lets unrated family films in", () => {
    const kid = { ...profile({ id: "k", kind: "kids" as const, maxCertification: "PG" as const }), kind: "kids" as const };
    expect(allowsTitle(kid, { refId: "jellyfin:1", name: "Toy Story", kind: "movie", certification: "U", genres: ["Family"] })).toBe(true);
    expect(allowsTitle(kid, { refId: "jellyfin:2", name: "Alien", kind: "movie", certification: "18", genres: ["Horror"] })).toBe(false);
    expect(allowsTitle(kid, { refId: "jellyfin:3", name: "Unrated", kind: "movie", genres: ["Family"] })).toBe(true);
    expect(allowsTitle(kid, { refId: "jellyfin:4", name: "Unrated Thriller", kind: "movie", genres: ["Thriller"] })).toBe(false);
    const blocking = { ...kid, allow: { allow: [], block: [{ id: "jellyfin:5", kind: "movie" as const, name: "Blocked", addedAt: NOW }] } };
    expect(allowsTitle(blocking, { refId: "jellyfin:5", name: "Blocked", kind: "movie", certification: "U", genres: ["Family"] })).toBe(false);
    expect(allowsTitle(null, { refId: "jellyfin:6", name: "Anything", kind: "movie", certification: "18" })).toBe(true);
  });

  it("filters the Limited mode screen for the viewer", () => {
    const snap = parseLimitedSnapshot(
      {
        at: NOW,
        channels: [
          { ...channel("cbbc", { number: 201, category: "kids" }), url: "http://x/1.ts" },
          { ...channel("bbc-one", { number: 101 }), url: "http://x/2.ts" },
        ],
        guide: { from: NOW - HOUR, to: NOW + DAY, programmes: { cbbc: [programme("cbbc", NOW - 10 * 60_000, 30)], "bbc-one": [programme("bbc-one", NOW - 10 * 60_000, 30)] } },
        profiles: [profile({ id: "k", name: "Sam", kind: "kids", maxCertification: "PG" })],
        jellyfin: { url: "http://jf", userId: "u", token: "t", items: [{ id: "1", refId: "jellyfin:1", kind: "movie", name: "Family Film", certification: "U", genres: ["Family"] }, { id: "2", refId: "jellyfin:2", kind: "movie", name: "Scary Film", certification: "18", genres: ["Horror"] }] },
      },
      NOW,
    );
    const view = limitedView(snap, { name: "Sam", kids: true }, NOW);
    expect(view.kids).toBe(true);
    expect(view.channels.map((c) => c.id)).toEqual(["cbbc"]);
    expect(view.channels[0]!.now).toMatchObject({ title: "Show " + (NOW - 10 * 60_000) });
    expect(view.jellyfin!.items.map((i) => i.name)).toEqual(["Family Film"]);
  });

  it("lists every channel for a grown-up, in number order, with what's on", () => {
    const snap = parseLimitedSnapshot(
      {
        at: NOW,
        channels: [{ ...channel("b", { number: 102 }), url: "http://x/1.ts" }, channel("a", { number: 101 })],
        guide: { from: NOW - HOUR, to: NOW + DAY, programmes: { a: [programme("a", NOW + 5 * 60_000, 30)] } },
        profiles: [profile()],
      },
      NOW,
    );
    const view = limitedView(snap, { name: "Grown-up", kids: false }, NOW);
    expect(view.channels.map((c) => c.id)).toEqual(["a", "b"]);
    expect(view.channels.map((c) => c.playable)).toEqual([false, true]);
    expect(view.channels[0]!.next).toMatchObject({ start: NOW + 5 * 60_000 });
  });

  it("shows an empty screen when there is no snapshot at all", () => {
    expect(limitedView(null, { name: "Sam", kids: true }, NOW)).toMatchObject({ channels: [], jellyfin: null, kids: true });
  });
});

describe("certification ranking", () => {
  it("maps the ratings a household sees onto its own ladder", () => {
    expect(certificationRank("U")).toBe(0);
    expect(certificationRank("PG")).toBe(1);
    expect(certificationRank("TV-14")).toBe(4);
    expect(certificationRank("gb-15")).toBe(4);
    expect(certificationRank("us-r")).toBe(5);
    expect(certificationRank(undefined)).toBeNull();
    expect(certificationRank("nonsense")).toBeNull();
  });
});
