// Podcasts (#86): reading somebody else's RSS, following a show, the new-episode badge, and
// carrying on where you were.
//
// Feeds are fixtures, never fetched: a test that reaches out to a podcast host is a test that
// fails when that host is down, and it says nothing about the parser anyway.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlaybackInfo, PodcastShow, PodcastShowWithEpisodes } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { feedDate, feedDuration, parseFeed } from "../src/podcastfeed.js";
import { Podcasts } from "../src/podcasts.js";
import { buildServer } from "../src/server.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>The Arguing Professors</title>
    <itunes:author>Two Professors</itunes:author>
    <description>Two academics argue about things.</description>
    <itunes:image href="https://example.com/show.jpg" />
    <item>
      <title>The one about trains</title>
      <pubDate>Tue, 03 Nov 2026 09:00:00 +0000</pubDate>
      <itunes:duration>1:02:03</itunes:duration>
      <description><![CDATA[<p>Trains, and why they are <b>good</b>.</p>]]></description>
      <itunes:image href="https://example.com/ep1.jpg" />
      <enclosure url="https://example.com/ep1.mp3" length="12345" type="audio/mpeg" />
      <guid>ep-1</guid>
    </item>
    <item>
      <title>The one about bridges</title>
      <pubDate>Tue, 27 Oct 2026 09:00:00 +0000</pubDate>
      <itunes:duration>3723</itunes:duration>
      <enclosure url="https://example.com/ep2.mp3" length="12345" type="audio/mpeg" />
      <guid>ep-2</guid>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>A Small Atom Show</title>
  <author><name>Someone</name></author>
  <entry>
    <title>Episode one</title>
    <published>2026-10-20T08:00:00Z</published>
    <link rel="enclosure" type="audio/mpeg" href="https://example.com/a1.mp3" />
    <summary>Hello.</summary>
  </entry>
</feed>`;

/** A fetch that serves feeds and the iTunes search, and nothing else. */
const serving = (feeds: Record<string, string>, extra: Record<string, unknown> = {}): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://itunes.apple.com/search")) {
      return Response.json({
        resultCount: 2,
        results: [
          { collectionName: "A Search Result", feedUrl: "https://example.com/found.rss", artistName: "Somebody", artworkUrl600: "https://example.com/found.jpg", trackCount: 42 },
          { collectionName: "Not a podcast" },
          { collectionName: "Another", feedUrl: "https://example.com/another.rss", artistName: "Else" },
        ],
        ...extra,
      });
    }
    const body = feeds[url];
    if (body === undefined) return new Response("not here", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } });
  }) as typeof fetch;

async function start(fetchImpl: typeof fetch) {
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl, ytdlp: null });
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-podcasts-"));
});

afterEach(async () => {
  // The feed-reading tests never start a server.
  if (app) await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const family = { "x-profile": "family" };
const kids = { "x-profile": "kids" };
const shows = async () => (await app.inject({ url: "/api/podcasts", headers: family })).json().shows as PodcastShow[];

describe("reading a feed", () => {
  it("takes the show's name, author, picture and its episodes", () => {
    const feed = parseFeed(FEED);
    expect(feed.title).toBe("The Arguing Professors");
    expect(feed.author).toBe("Two Professors");
    expect(feed.image).toBe("https://example.com/show.jpg");
    expect(feed.episodes).toHaveLength(2);
    const [newest] = feed.episodes;
    expect(newest!.title).toBe("The one about trains");
    expect(newest!.url).toBe("https://example.com/ep1.mp3");
    expect(newest!.durationMs).toBe(3_723_000);
    expect(newest!.description).toContain("Trains");
    expect(newest!.image).toBe("https://example.com/ep1.jpg");
  });

  it("puts the newest episode first, whatever order the feed wrote them", () => {
    const feed = parseFeed(FEED);
    expect(feed.episodes.map((e) => e.title)).toEqual(["The one about trains", "The one about bridges"]);
  });

  it("reads an Atom feed too", () => {
    const feed = parseFeed(ATOM);
    expect(feed.title).toBe("A Small Atom Show");
    expect(feed.episodes).toHaveLength(1);
    expect(feed.episodes[0]!.url).toBe("https://example.com/a1.mp3");
  });

  it("skips an episode with no audio, and survives a broken feed", () => {
    const noAudio = parseFeed(FEED.replace('url="https://example.com/ep1.mp3"', 'url=""'));
    expect(noAudio.episodes).toHaveLength(1);
    expect(noAudio.episodes[0]!.title).toBe("The one about bridges");
    // A feed cut off mid-element loses that element but keeps the rest of itself.
    const truncated = parseFeed(`${FEED.split("<item>")[0]}`);
    expect(truncated.title).toBe("The Arguing Professors");
    expect(truncated.episodes).toEqual([]);
    expect(parseFeed("not xml at all").episodes).toEqual([]);
  });

  it("understands the several ways a feed writes a date", () => {
    expect(feedDate("Tue, 03 Nov 2026 09:00:00 +0000")).toBe(Date.parse("2026-11-03T09:00:00Z"));
    expect(feedDate("2026-11-03T09:00:00Z")).toBe(Date.parse("2026-11-03T09:00:00Z"));
    expect(feedDate("03 Nov 2026 09:00:00 +0000")).toBe(Date.parse("2026-11-03T09:00:00Z"));
    expect(feedDate("nonsense")).toBe(0);
    expect(feedDate(undefined)).toBe(0);
  });

  it("understands the several ways a feed writes a length", () => {
    expect(feedDuration("1:02:03")).toBe(3_723_000);
    expect(feedDuration("62:03")).toBe(3_723_000);
    expect(feedDuration("3723")).toBe(3_723_000);
    expect(feedDuration("3723.6")).toBe(3_723_600);
    expect(feedDuration("")).toBeUndefined();
  });
});

describe("following a show", () => {
  it("adds it from a feed address and lists it", async () => {
    await start(serving({ "https://example.com/show.rss": FEED }));
    const res = await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } });
    expect(res.statusCode).toBe(200);
    const show = res.json().show as PodcastShow;
    expect(show.title).toBe("The Arguing Professors");
    expect(show.episodeCount).toBe(2);
    expect((await shows()).map((s) => s.id)).toEqual([show.id]);
  });

  it("reads a show's episodes when it's opened", async () => {
    await start(serving({ "https://example.com/show.rss": FEED }));
    const show = (await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } })).json().show as PodcastShow;
    const open = await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family });
    expect(open.statusCode).toBe(200);
    const body = open.json() as PodcastShowWithEpisodes;
    expect(body.episodes).toHaveLength(2);
    expect(body.episodes[0]!.title).toBe("The one about trains");
  });

  it("doesn't add the same feed twice", async () => {
    await start(serving({ "https://example.com/show.rss": FEED }));
    await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } });
    const again = await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } });
    expect(again.statusCode).toBe(200);
    expect(await shows()).toHaveLength(1);
  });

  it("lets only a grown-up follow or stop following a show", async () => {
    // Following is a household change, like adding a station, so the PIN rule applies; listening
    // isn't, so a Kids profile still gets the list and its episodes.
    await start(serving({ "https://example.com/show.rss": FEED }));
    const nope = await app.inject({ method: "POST", url: "/api/podcasts", headers: kids, payload: { feedUrl: "https://example.com/show.rss" } });
    expect(nope.statusCode).toBe(403);
    expect(nope.json().code).toBe("pin");
    expect(await shows()).toEqual([]);
    const show = (await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } })).json().show as PodcastShow;
    const heard = await app.inject({ url: "/api/podcasts", headers: kids });
    expect(heard.statusCode).toBe(200);
    expect((heard.json().shows as PodcastShow[]).map((s) => s.id)).toEqual([show.id]);
    const drop = await app.inject({ method: "DELETE", url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: kids });
    expect(drop.statusCode).toBe(403);
    expect(await shows()).toHaveLength(1);
  });

  it("says why a feed couldn't be added, rather than storing a broken show", async () => {
    await start(serving({}));
    const missing = await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/nothing.rss" } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toMatch(/404/);
    const notFeed = await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/page.html" } });
    expect(notFeed.statusCode).toBe(400);
    expect(await shows()).toEqual([]);
  });

  it("won't take an address that isn't one", async () => {
    await start(serving({}));
    const res = await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "nonsense" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/http/i);
  });

  it("unsubscribes, and the show is gone", async () => {
    await start(serving({ "https://example.com/show.rss": FEED }));
    const show = (await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } })).json().show as PodcastShow;
    const gone = await app.inject({ method: "DELETE", url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family });
    expect(gone.statusCode).toBe(200);
    expect(await shows()).toEqual([]);
  });

  it("finds shows by search and hands back addresses to subscribe to", async () => {
    await start(serving({}));
    const res = await app.inject({ url: "/api/podcasts/search?q=professors", headers: family });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as { title: string; feedUrl: string }[];
    // Anything without a feed address is no use: it can't be subscribed to.
    expect(results.map((r) => r.title)).toEqual(["A Search Result", "Another"]);
    expect(results[0]!.feedUrl).toBe("https://example.com/found.rss");
  });

  it("says so when the search doesn't answer", async () => {
    const dead = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await start(dead);
    const res = await app.inject({ url: "/api/podcasts/search?q=anything", headers: family });
    expect(res.statusCode).toBe(502);
  });
});

describe("new episodes", () => {
  it("counts what arrived since the house last looked, and opening it clears the badge", async () => {
    // The feed the fake server serves, swappable mid-test so an episode can "turn up".
    let feed = FEED;
    const swappable = (async (input: RequestInfo | URL) => new Response(feed, { status: 200, headers: { "content-type": "application/rss+xml" } })) as typeof fetch;
    await start(swappable);
    const show = (await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } })).json().show as PodcastShow;
    // Subscribing shows everything already there as seen: a badge on day one is noise.
    expect(show.freshCount).toBe(0);

    feed = FEED.replace("</channel>", `<item><title>Fresh one</title><pubDate>Tue, 10 Nov 2026 09:00:00 +0000</pubDate><enclosure url="https://example.com/ep3.mp3" type="audio/mpeg" /></item></channel>`);
    // The Hub reads at most every half hour, so say the last read was a while ago.
    const stored = app.hub.db.getKv<unknown>("podcasts") as { id: string; checkedAt?: number }[];
    app.hub.db.setKv("podcasts", stored.map((s) => ({ ...s, checkedAt: 1 })));

    // Asking the list again is what picks the new episode up.
    const listed = (await shows())[0]!;
    expect(listed.episodeCount).toBe(3);
    expect(listed.freshCount).toBe(1);

    const opened = await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family });
    expect((opened.json() as PodcastShowWithEpisodes).episodes).toHaveLength(3);
    // Opening it is what marks it seen, so the row is flat again afterwards.
    const after = (await shows())[0]!;
    expect(after.freshCount).toBe(0);
  });
});

describe("carrying on where you were", () => {
  it("remembers a place worth going back to, and forgets a few seconds or the end", async () => {
    await start(serving({ "https://example.com/show.rss": FEED }));
    const show = (await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } })).json().show as PodcastShow;
    const open = (await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family })).json() as PodcastShowWithEpisodes;
    const ep = open.episodes[0]!;

    const save = (positionMs: number, durationMs?: number) => app.inject({ method: "POST", url: `/api/podcasts/${encodeURIComponent(ep.id)}/position`, headers: family, payload: { positionMs, ...(durationMs ? { durationMs } : {}) } });

    // Ten seconds in isn't a place.
    await save(10_000, 600_000);
    expect((await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family })).json().episodes[0].positionMs).toBeUndefined();

    // Ten minutes in is.
    await save(600_000, 3_723_000);
    expect((await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family })).json().episodes[0].positionMs).toBe(600_000);

    // Playing it to the end isn't.
    await save(3_700_000, 3_723_000);
    expect((await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family })).json().episodes[0].positionMs).toBeUndefined();
  });

  it("starts an episode where it was left, unless asked for the beginning", async () => {
    await start(serving({ "https://example.com/show.rss": FEED }));
    const show = (await app.inject({ method: "POST", url: "/api/podcasts", headers: family, payload: { feedUrl: "https://example.com/show.rss" } })).json().show as PodcastShow;
    const open = (await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}`, headers: family })).json() as PodcastShowWithEpisodes;
    const ep = open.episodes[0]!;
    await app.inject({ method: "POST", url: `/api/podcasts/${encodeURIComponent(ep.id)}/position`, headers: family, payload: { positionMs: 600_000, durationMs: 3_723_000 } });

    const resumed = await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}/${encodeURIComponent(ep.id)}/play`, headers: family });
    expect(resumed.statusCode).toBe(200);
    const info = resumed.json() as PlaybackInfo;
    expect(info.url).toBe("https://example.com/ep1.mp3");
    expect(info.startMs).toBe(600_000);
    expect(info.title).toBe("The one about trains");
    expect(info.subtitle).toBe("The Arguing Professors");
    // Not a "podcast:" key: an episode mustn't turn up in Continue watching.
    expect(info.progressKey.startsWith("link:")).toBe(true);

    const fromStart = await app.inject({ url: `/api/podcasts/${encodeURIComponent(show.id)}/${encodeURIComponent(ep.id)}/play?from=start`, headers: family });
    expect((fromStart.json() as PlaybackInfo).startMs).toBe(0);
  });
});

describe("podcast junk tolerance", () => {
  it("ignores rubbish left in the database", () => {
    const store = new Podcasts({ getKv: () => [{ id: "a", title: "Real", feedUrl: "https://example.com/a.rss", episodeCount: 3 }, { id: "", title: "No id" }, "junk"], setKv: () => undefined } as never, serving({}));
    expect(store.list().map((s) => s.title)).toEqual(["Real"]);
    const broken = new Podcasts({ getKv: () => "not an object", setKv: () => undefined } as never, serving({}));
    expect(broken.list()).toEqual([]);
  });
});
