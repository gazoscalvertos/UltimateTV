import { describe, expect, it } from "vitest";
import { JellyfinClient, type JfItem } from "../src/services/jellyfin.js";
import { addonBase, streamToCandidate } from "../src/services/stremio.js";
import { extensionFrom, libraryPath, parseReleaseName } from "../src/services/downloads.js";
import { fillCatchupTemplate } from "../src/catchup.js";
import { jellyfinQuality } from "../src/library.js";
import { redactUrl } from "../src/http.js";

function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("Jellyfin", () => {
  it("signs in with Quick Connect and sends the MediaBrowser header", async () => {
    const f = fakeFetch({
      "/QuickConnect/Initiate": { Code: "123456", Secret: "s3cret" },
      "/QuickConnect/Connect": { Authenticated: true },
      "/Users/AuthenticateWithQuickConnect": { AccessToken: "tok", User: { Id: "u1" } },
      "/System/Info/Public": { ServerName: "Jelly", Version: "10.10", Id: "x" },
    });
    const jf = new JellyfinClient({ url: "http://jf:8096/" }, f.impl);
    expect(await jf.quickConnectInitiate()).toEqual({ code: "123456", secret: "s3cret" });
    expect(await jf.quickConnectStatus("s3cret")).toBe(true);
    expect(await jf.quickConnectAuthenticate("s3cret")).toEqual({ url: "http://jf:8096", userId: "u1", token: "tok", serverName: "Jelly" });
    expect((f.calls[0]!.init!.headers as Record<string, string>).Authorization).toContain('Client="UltimateTV"');
  });

  it("finds library items by TMDB id itself, since newer Jellyfin ignores the filter", async () => {
    const f = fakeFetch({
      "/Items/m2": { Id: "m2", Name: "Heat", Type: "Movie" },
      "IncludeItemTypes=Movie,Series&Fields=ProviderIds": {
        Items: [
          { Id: "m1", Name: "28 Days Later", Type: "Movie", ProviderIds: { Tmdb: "170" } },
          { Id: "m2", Name: "Heat", Type: "Movie", ProviderIds: { Tmdb: "949", Imdb: "tt0113277" } },
        ],
      },
    });
    const jf = new JellyfinClient({ url: "http://jf:8096", userId: "u1", token: "tok" }, f.impl);
    expect((await jf.byProviderId("tmdb", "949", "Movie"))?.Id).toBe("m2");
    expect(await jf.byProviderId("tmdb", "1054867", "Movie")).toBeUndefined();
    expect(await jf.byProviderId("tmdb", "949", "Series")).toBeUndefined();
    expect(f.calls.filter((c) => c.url.includes("Fields=ProviderIds"))).toHaveLength(1);
  });

  it("maps items to titles with TMDB ids and direct-play URLs", () => {
    const jf = new JellyfinClient({ url: "http://jf:8096", userId: "u1", token: "tok" });
    const item: JfItem = { Id: "abc", Name: "Heat", Type: "Movie", ProductionYear: 1995, ProviderIds: { Tmdb: "949" }, ImageTags: { Primary: "t1" }, BackdropImageTags: ["b1"], UserData: { PlayedPercentage: 40 } };
    expect(jf.toTitleRef(item)).toMatchObject({ id: "tmdb:movie:949", kind: "movie", name: "Heat", year: 1995, progress: 0.4, poster: "http://jf:8096/Items/abc/Images/Primary?maxWidth=400&tag=t1&quality=90" });
    expect(jf.streamUrl("abc", "ms1")).toBe("http://jf:8096/Videos/abc/stream?static=true&api_key=tok&mediaSourceId=ms1");
  });

  it("reads quality from media streams", () => {
    const q = jellyfinQuality({ Id: "1", Size: 50e9, MediaStreams: [
      { Type: "Video", Index: 0, Codec: "hevc", Height: 2160, VideoRangeType: "DOVIWithHDR10", DisplayTitle: "4K HEVC Dolby Vision" },
      { Type: "Audio", Index: 1, Codec: "truehd", Channels: 8, DisplayTitle: "English - Dolby TrueHD + Dolby Atmos 7.1", IsDefault: true },
    ] });
    expect(q).toMatchObject({ height: 2160, hdr: "dv", dvProfile: 8, audio: "truehd", channels: 8, sizeBytes: 50e9 });
  });
});

describe("Stremio addons", () => {
  it("normalises addon URLs and turns AIOStreams results into candidates", () => {
    expect(addonBase("https://aio.example/stremio/abc/manifest.json")).toBe("https://aio.example/stremio/abc");
    expect(addonBase("https://aio.example/stremio/abc/eyJp/configure")).toBe("https://aio.example/stremio/abc/eyJp");
    expect(addonBase("stremio://aio.example/stremio/abc/manifest.json")).toBe("https://aio.example/stremio/abc");
    const cached = streamToCandidate({ name: "[TB⚡] AIOStreams 4K", description: "Movie 2160p WEB-DL DV HDR10 DDP5.1 Atmos\n💾 18.2 GB", url: "https://aio.example/play/1" }, "AIOStreams", 0)!;
    expect(cached).toMatchObject({ kind: "torbox", ready: true, label: "TorBox", quality: { height: 2160, hdr: "dv", dvProfile: 8, audio: "atmos" } });
    const uncached = streamToCandidate({ name: "[TB⏳] AIOStreams 1080p", title: "Movie 1080p", url: "https://aio.example/play/2" }, "AIOStreams", 1)!;
    expect(uncached.ready).toBe(false);
    expect(streamToCandidate({ name: "Torrent", infoHash: "abc" }, "X", 2)).toBeNull();
  });
});

describe("downloads and naming", () => {
  const roots = { moviesPath: "/mnt/nas/Movies", tvPath: "/mnt/nas/TV" };
  it("uses Jellyfin naming", () => {
    expect(libraryPath(roots, { title: "Heat", kind: "movie", year: 1995 }, "mkv")).toBe("/mnt/nas/Movies/Heat (1995)/Heat (1995).mkv");
    expect(libraryPath(roots, { title: "Slow Horses", kind: "series", year: 2022, season: 2, episode: 3, episodeName: "Cuckoo" }, "mkv")).toBe("/mnt/nas/TV/Slow Horses (2022)/Season 02/Slow Horses - S02E03 - Cuckoo.mkv");
    expect(libraryPath(roots, { title: "What: Now?", kind: "movie" }, "mp4")).toBe("/mnt/nas/Movies/What Now/What Now.mp4");
  });

  it("parses release names", () => {
    expect(parseReleaseName("Slow.Horses.2022.S02E03.1080p.WEB.h264.mkv")).toEqual({ title: "Slow Horses", year: 2022, season: 2, episode: 3, kind: "series" });
    expect(parseReleaseName("Heat.1995.2160p.UHD.BluRay.x265.mkv")).toEqual({ title: "Heat", year: 1995, kind: "movie" });
    expect(parseReleaseName("Some Film 1080p WEB.mp4")).toEqual({ title: "Some Film", kind: "movie" });
    expect(extensionFrom(undefined, "https://cdn/x/file.mp4?token=1")).toBe("mp4");
  });
});

describe("catch-up templates and redaction", () => {
  it("fills catch-up placeholders", () => {
    const start = Date.UTC(2026, 9, 24, 19, 0);
    expect(fillCatchupTemplate("http://x/{utc}/{duration}/{Y}-{m}-{d}", start, start + 3_600_000)).toBe(`http://x/${start / 1000}/3600/2026-10-24`);
  });

  it("removes credentials from URLs", () => {
    expect(redactUrl("http://p.tv/player_api.php?username=gary&password=hunter2")).toBe("http://p.tv/player_api.php?username=***&password=***");
    expect(redactUrl("http://p.tv/live/gary/hunter2/123.ts")).toBe("http://p.tv/live/***/***/123.ts");
  });
});
