import { describe, expect, it } from "vitest";
import type { Channel, KidsAllowList, Programme, Profile } from "@ultimatetv/shared";
import { JellyfinClient, type JfItem } from "../src/services/jellyfin.js";
import { buildLimitedSnapshot, jellyfinOfflineItems, OFFLINE_GUIDE_BACK_MS, OFFLINE_GUIDE_DAYS } from "../src/boxoffline.js";

const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function channel(id: string, extra: Partial<Channel> = {}): Channel {
  return { id, number: 101, name: id.toUpperCase(), category: "entertainment", feeds: [], favourite: false, hidden: false, maxHeight: 1080, catchupDays: 0, ...extra };
}

function programme(channelId: string, start: number, mins: number, extra: Partial<Programme> = {}): Programme {
  return { id: `${channelId}:${start}`, channelId, start, end: start + mins * 60_000, title: "Show", categories: [], isNew: false, isRepeat: false, isFilm: false, ...extra };
}

const adult: Profile = { id: "family", name: "Family", kind: "adult", colour: "#fff", hasPin: false, maxCertification: "18", channelCategories: [], allowedChannels: [] };
const kid: Profile = { id: "kids", name: "Kids", kind: "kids", colour: "#fff", hasPin: false, maxCertification: "PG", channelCategories: ["kids"], allowedChannels: ["film-four"] };

function film(over: Partial<JfItem> = {}): JfItem {
  return { Id: "abc", Name: "Copper Sky", Type: "Movie", Genres: ["Drama"], OfficialRating: "12", RunTimeTicks: 6_000 * 10_000_000, UserData: { PlaybackPositionTicks: 60_000 * 10_000 }, ...over } as JfItem;
}

function build(over: { channels?: Channel[]; programmes?: Record<string, Programme[]>; allow?: KidsAllowList; jellyfin?: Parameters<typeof buildLimitedSnapshot>[0]["jellyfin"] } = {}) {
  const channels = over.channels ?? [channel("bbc-one"), channel("cbeebies", { number: 601, category: "kids" })];
  return buildLimitedSnapshot({
    now: NOW,
    channels,
    feedsFor: (id) => (id === "bbc-one" ? [{ id: "f1", sourceId: "iptv", name: "1080", height: 1080, priority: 0, catchupDays: 7, channelId: id, upstreamId: "1", url: "http://iptv.lan/live/user/pass/1.ts" }] : []),
    guideWindow: (ids, from, to) => {
      const all = over.programmes ?? { "bbc-one": [programme("bbc-one", NOW, 60)] };
      return Object.fromEntries(ids.filter((id) => all[id]).map((id) => [id, all[id]!.filter((p) => p.end > from && p.start < to)]));
    },
    profiles: [{ profile: adult }, { profile: kid, allow: over.allow ?? { allow: [], block: [] } }],
    ...(over.jellyfin ? { jellyfin: over.jellyfin } : {}),
  });
}

describe("building the box's snapshot", () => {
  it("gives each channel the first feed's URL and the relay's own User-Agent", () => {
    const snapshot = build();
    const bbc = snapshot.channels.find((c) => c.id === "bbc-one")!;
    expect(bbc).toMatchObject({ number: 101, name: "BBC-ONE", url: "http://iptv.lan/live/user/pass/1.ts", headers: { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" } });
    // A channel with no source is still listed, just not playable: the guide still knows about it.
    expect(snapshot.channels.find((c) => c.id === "cbeebies")!.url).toBeUndefined();
  });

  it("leaves hidden channels out", () => {
    const snapshot = build({ channels: [channel("bbc-one"), channel("adult-channel", { hidden: true })] });
    expect(snapshot.channels.map((c) => c.id)).toEqual(["bbc-one"]);
  });

  it("keeps only the week of guide ahead, and only what a grid needs", () => {
    const programmes = {
      "bbc-one": [
        programme("bbc-one", NOW - 3 * HOUR, 60, { title: "Long gone" }),
        programme("bbc-one", NOW + HOUR, 60, { title: "Tonight" }),
        programme("bbc-one", NOW + 6 * DAY, 60, { title: "Next week" }),
        programme("bbc-one", NOW + 9 * DAY, 60, { title: "Too far" }),
      ],
    };
    const snapshot = build({ programmes });
    expect(snapshot.guide.from).toBe(NOW - OFFLINE_GUIDE_BACK_MS);
    expect(snapshot.guide.to).toBe(NOW + OFFLINE_GUIDE_DAYS * DAY);
    expect(snapshot.guide.programmes["bbc-one"]!.map((p) => p.title)).toEqual(["Tonight", "Next week"]);
    // The snapshot's programmes carry the grid's fields and nothing from the database.
    expect(Object.keys(snapshot.guide.programmes["bbc-one"]![0]!).sort()).toEqual(["categories", "channelId", "end", "id", "isFilm", "isNew", "isRepeat", "start", "title"]);
  });

  it("leaves out a channel with no programmes rather than an empty list", () => {
    const snapshot = build({ programmes: { "bbc-one": [programme("bbc-one", NOW, 30)] } });
    expect(Object.keys(snapshot.guide.programmes)).toEqual(["bbc-one"]);
  });

  it("carries each profile's Kids rules, including the household's own lists", () => {
    const allow: KidsAllowList = { allow: [{ id: "film-four", kind: "channel", name: "Film4", addedAt: NOW }], block: [] };
    const snapshot = build({ allow });
    const kids = snapshot.profiles.find((p) => p.name === "Kids")!;
    expect(kids).toMatchObject({ kind: "kids", maxCertification: "PG", channelCategories: ["kids"], allowedChannels: ["film-four"], allow });
    expect(snapshot.profiles.find((p) => p.name === "Family")!.kind).toBe("adult");
  });

  it("stamps the snapshot with when it was made", () => {
    expect(build().at).toBe(NOW);
  });

  it("says nothing about Jellyfin when the Hub has none", () => {
    expect(build().jellyfin).toBeUndefined();
  });

  it("carries the Jellyfin connection when there is one, so a film plays with the Hub off", () => {
    const jf = new JellyfinClient({ url: "http://jellyfin.lan:8096/", userId: "u1", token: "secret", serverName: "Home" });
    const snapshot = build({ jellyfin: { url: jf.auth.url, serverName: "Home", userId: "u1", token: "secret", items: jellyfinOfflineItems(jf, [film()]) } });
    expect(snapshot.jellyfin).toMatchObject({ url: "http://jellyfin.lan:8096/", serverName: "Home", userId: "u1", token: "secret" });
    expect(snapshot.jellyfin!.items.map((i) => i.id)).toEqual(["abc"]);
  });
});

describe("the Jellyfin films the box keeps", () => {
  const jf = new JellyfinClient({ url: "http://jellyfin.lan:8096/", userId: "u1", token: "secret", serverName: "Home" });

  function item(over: Partial<JfItem> = {}): JfItem {
    return { Id: "abc", Name: "Copper Sky", Type: "Movie", Genres: ["Drama"], OfficialRating: "12", RunTimeTicks: 6_000 * 10_000_000, UserData: { PlaybackPositionTicks: 60_000 * 10_000 }, ...over } as JfItem;
  }

  it("only includes Jellyfin when it is signed in", () => {
    const signedOut = new JellyfinClient({ url: "http://jellyfin.lan:8096/" });
    const items = jellyfinOfflineItems(signedOut, [item()]);
    expect(items).toHaveLength(1);
    // Nothing to report progress with, so the snapshot leaves Jellyfin out rather than half of it.
    expect(build({ jellyfin: undefined }).jellyfin).toBeUndefined();
  });

  it("maps a film to what the box plays and reports", () => {
    const [film] = jellyfinOfflineItems(jf, [item()]);
    expect(film).toMatchObject({ id: "abc", refId: "jellyfin:abc", kind: "movie", name: "Copper Sky", positionMs: 60_000, runtimeMs: 6_000_000, genres: ["Drama"], certification: "12" });
    expect(film!.poster).toBeUndefined();
  });

  it("skips items it has no id for", () => {
    expect(jellyfinOfflineItems(jf, [{ Name: "No id" } as JfItem])).toEqual([]);
  });
});
