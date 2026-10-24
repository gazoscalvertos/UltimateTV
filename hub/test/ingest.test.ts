import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildChannels, categorise, displayName, type RawFeed } from "../src/channels.js";
import { parseM3u } from "../src/ingest/m3u.js";
import { episodeIdentity, parseXmltv, parseXmltvTime, type XmltvProgramme } from "../src/ingest/xmltv.js";
import { xtreamTime } from "../src/ingest/xtream.js";
import { cleanVodName, splitYear } from "../src/ingest/index.js";

describe("M3U", () => {
  it("parses attributes, titles with commas, EPG urls and kinds", () => {
    const text = `#EXTM3U url-tvg="http://epg/a.xml,http://epg/b.xml.gz"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="UK: BBC One FHD" tvg-logo="http://l/1.png" group-title="UK | Entertainment" catchup="xc" catchup-days="7",UK: BBC One FHD
http://host/live/u/p/1.ts
#EXTINF:-1 group-title="Films",Heat, the remaster (1995)
http://host/movie/u/p/99.mkv
#EXTINF:-1,No Group
#EXTVLCOPT:http-user-agent=x
http://host/live/u/p/2.ts`;
    const p = parseM3u(text);
    expect(p.epgUrls).toEqual(["http://epg/a.xml", "http://epg/b.xml.gz"]);
    expect(p.entries).toHaveLength(3);
    expect(p.entries[0]).toMatchObject({ name: "UK: BBC One FHD", tvgId: "bbc1.uk", group: "UK | Entertainment", catchupDays: 7, kind: "live" });
    expect(p.entries[1]).toMatchObject({ name: "Heat, the remaster (1995)", kind: "movie" });
    expect(p.entries[2]).toMatchObject({ name: "No Group", url: "http://host/live/u/p/2.ts" });
  });
});

describe("XMLTV", () => {
  it("converts times with offsets to UTC", () => {
    expect(parseXmltvTime("20261024200000 +0100")).toBe(Date.UTC(2026, 9, 24, 19, 0, 0));
    expect(parseXmltvTime("20261024200000")).toBe(Date.UTC(2026, 9, 24, 20, 0, 0));
    expect(parseXmltvTime("20261024200000 -0500")).toBe(Date.UTC(2026, 9, 25, 1, 0, 0));
  });

  it("streams channels and programmes", async () => {
    const channels: string[] = [];
    const progs: XmltvProgramme[] = [];
    const result = await parseXmltv(readFileSync(new URL("./fixtures/guide.xml", import.meta.url), "utf8"), {
      channel: (c) => channels.push(`${c.id}=${c.names.join("/")}`),
      programme: (p) => progs.push(p),
    });
    expect(result).toEqual({ channels: 3, programmes: 4 });
    expect(channels[0]).toBe("bbc1.uk=BBC One");
    const sw = progs[0]!;
    expect(sw).toMatchObject({ title: "Silent Witness", subtitle: "The Lost & Found: Part 1", isNew: true, categories: ["Drama"] });
    const film = progs[2]!;
    expect(film).toMatchObject({ year: 1998, previouslyShown: true, rating: "15" });
  });

  it("derives series and episode identity", () => {
    const base = { title: "Silent Witness", episodeNums: [] as { system: string; value: string }[] };
    expect(episodeIdentity({ ...base, episodeNums: [{ system: "xmltv_ns", value: "27.2.0/2" }] })).toEqual({
      seriesKey: "t:silent witness",
      season: 28,
      episode: 3,
      episodeKey: "t:silent witness|s28e3",
    });
    expect(episodeIdentity({ ...base, episodeNums: [{ system: "dd_progid", value: "EP01234567.0012" }] })).toMatchObject({
      seriesKey: "dd:EP01234567",
      episodeKey: "dd:EP01234567.0012",
    });
    expect(episodeIdentity({ ...base, episodeNums: [{ system: "onscreen", value: "S2 E7" }] })).toMatchObject({ season: 2, episode: 7 });
    expect(episodeIdentity({ ...base, subtitle: "Part One" }).episodeKey).toBe("t:silent witness|part one");
    expect(episodeIdentity(base).episodeKey).toBeUndefined();
  });
});

describe("channel building", () => {
  const feed = (name: string, extra: Partial<RawFeed> = {}): RawFeed => ({ sourceId: "x", upstreamId: name, name, url: `http://h/${encodeURIComponent(name)}`, catchupDays: 0, group: "UK | General", ...extra });

  it("merges feeds of one channel and numbers the Sky way", () => {
    const raw = [
      feed("UK: Channel 4 HD"),
      feed("UK: BBC Two FHD"),
      feed("UK: BBC One SD"),
      feed("UK: BBC One FHD", { catchupDays: 7, epgId: "bbc1.uk" }),
      feed("UK: Sky Sports Main Event FHD", { group: "UK | Sports" }),
      feed("UK: Random Shopping"),
      feed("DE: Das Erste", { group: "Germany" }),
    ];
    const { channels, feeds } = buildChannels(raw, { numbering: "uk", filter: /\bUK\b/, existing: new Map() });
    const byName = Object.fromEntries(channels.map((c) => [c.name, c]));
    expect(byName["BBC One"]).toMatchObject({ number: 101, catchupDays: 7, epgId: "bbc1.uk", maxHeight: 1080 });
    expect(byName["BBC One"]!.feeds.map((f) => f.height)).toEqual([1080, 576]);
    expect(byName["BBC Two"]!.number).toBe(102);
    expect(byName["Channel 4"]!.number).toBe(104);
    expect(byName["Sky Sports Main Event"]).toMatchObject({ number: 401, category: "sport" });
    expect(byName["Random Shopping"]!.number).toBeGreaterThan(104);
    expect(byName["Das Erste"]).toMatchObject({ hidden: true });
    expect(byName["Das Erste"]!.number).toBeGreaterThan(1000);
    expect(feeds.filter((f) => f.channelId === "bbc-one")).toHaveLength(2);
  });

  it("keeps existing numbers and flags", () => {
    const existing = new Map([["bbc-one", { number: 1, favourite: true, hidden: false }]]);
    const { channels } = buildChannels([feed("UK: BBC One HD"), feed("UK: BBC Two HD")], { numbering: "uk", filter: null, existing });
    expect(channels[0]).toMatchObject({ name: "BBC One", number: 1, favourite: true });
    expect(channels[1]).toMatchObject({ name: "BBC Two", number: 102 });
  });

  it("cleans names and categorises", () => {
    expect(displayName("UK: BBC One FHD")).toBe("BBC One");
    expect(displayName("UK | ITV1 HD")).toBe("ITV1");
    expect(categorise("CBeebies")).toBe("kids");
    expect(categorise("Sky News")).toBe("news");
    expect(categorise("Something", "UK | Movies")).toBe("films");
  });
});

describe("VOD names and Xtream times", () => {
  it("splits years and provider prefixes", () => {
    expect(splitYear("Heat (1995)")).toEqual({ name: "Heat", year: 1995 });
    expect(splitYear("Dune Part Two - 2024")).toEqual({ name: "Dune Part Two", year: 2024 });
    expect(splitYear("1917")).toEqual({ name: "1917" });
    expect(cleanVodName("EN - The Matrix")).toBe("The Matrix");
    expect(cleanVodName("|UK| Gladiator")).toBe("Gladiator");
  });

  it("formats catch-up start times in the panel's time zone", () => {
    expect(xtreamTime(Date.UTC(2026, 9, 24, 19, 0), "Europe/London")).toBe("2026-10-24:20-00");
    expect(xtreamTime(Date.UTC(2026, 11, 24, 19, 0), "Europe/London")).toBe("2026-12-24:19-00");
  });
});
