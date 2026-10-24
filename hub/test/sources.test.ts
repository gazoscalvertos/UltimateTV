import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import type { IptvSource } from "@ultimatetv/shared";
import { buildChannels, ChannelStore, type RawFeed } from "../src/channels.js";
import { Db } from "../src/db.js";
import { GuideStore } from "../src/epg.js";
import { describeError, Ingestor } from "../src/ingest/index.js";
import { fetchStream } from "../src/http.js";
import { silentLogger } from "../src/log.js";
import { dedupeSources, defaultSettings, SettingsStore, sourceKey } from "../src/settings.js";

const xtream = (id: string, url = "http://iptv.example:8080", username = "gary"): IptvSource => ({ id, kind: "xtream", name: id, url, username, password: "pw", connections: 1 });
const m3u = (id: string, url: string): IptvSource => ({ id, kind: "m3u", name: id, url, connections: 1 });

describe("IPTV source duplicates", () => {
  it("treats the same account as one source, whatever the spelling", () => {
    expect(sourceKey(xtream("a", "http://IPTV.example:8080/"))).toBe(sourceKey(xtream("b", "http://iptv.example:8080", " Gary ")));
    expect(sourceKey(xtream("a"))).not.toBe(sourceKey(xtream("b", undefined, "other")));
    expect(sourceKey(m3u("a", "http://p/get.php?u=1"))).not.toBe(sourceKey(m3u("b", "http://p/get.php?u=2")));
    expect(dedupeSources([xtream("a"), xtream("b"), m3u("c", "http://p/x.m3u"), m3u("d", "http://p/x.m3u/")]).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("drops saved duplicates when the Hub starts", () => {
    const db = new Db(":memory:");
    db.setKv("settings", { iptv: [xtream("a"), xtream("b"), xtream("c")] });
    const store = new SettingsStore(db, defaultSettings());
    expect(store.get().iptv.map((s) => s.id)).toEqual(["a"]);
    expect(db.getKv<{ iptv: IptvSource[] }>("settings")!.iptv).toHaveLength(1);
  });
});

/** A fake M3U provider; each playlist URL serves its own channel list. */
function playlists(lists: Record<string, string[]>) {
  return (async (url: string | URL | Request) => {
    const names = lists[String(url)];
    if (!names) return new Response("not found", { status: 404 });
    const body = ["#EXTM3U", ...names.flatMap((n, i) => [`#EXTINF:-1 group-title="Live",${n}`, `http://stream/${i}.ts`])].join("\n");
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

function setup(lists: Record<string, string[]>, sources: IptvSource[], channelFilter = "") {
  const db = new Db(":memory:");
  const settings = new SettingsStore(db, { ...defaultSettings(), iptv: sources, channelFilter });
  const channels = new ChannelStore(db);
  const ingest = new Ingestor(db, settings, channels, new GuideStore(db), silentLogger, playlists(lists));
  return { settings, channels, ingest };
}

describe("loading IPTV sources", () => {
  it("shows every channel when the filter would hide them all, and says so per source", async () => {
    const { channels, ingest } = setup({ "http://p/a.m3u": ["BBC One", "ITV1", "Channel 4"] }, [m3u("a", "http://p/a.m3u")], "^(UK|GB)\\b");
    await ingest.refreshSources();
    expect(channels.list().map((c) => c.name)).toEqual(["BBC One", "ITV1", "Channel 4"]);
    expect(ingest.sourceStatus("a")).toMatchObject({ ok: true, streams: 3, visible: 3 });
  });

  it("records why a source failed", async () => {
    const { ingest } = setup({}, [m3u("a", "http://p/missing.m3u")]);
    await ingest.refreshSources();
    expect(ingest.sourceStatus("a")).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 404") });
  });

  it("loads a source added while a refresh is already running", async () => {
    const { settings, channels, ingest } = setup({ "http://p/a.m3u": ["BBC One"], "http://p/b.m3u": ["Sky News"] }, [m3u("a", "http://p/a.m3u")]);
    const first = ingest.refreshAll();
    settings.update({ iptv: [...settings.get().iptv, m3u("b", "http://p/b.m3u")] });
    const second = ingest.refreshAll();
    await Promise.all([first, second]);
    expect(channels.list().map((c) => c.name).sort()).toEqual(["BBC One", "Sky News"]);
  });

  it("explains network errors instead of a bare 'fetch failed'", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND iptv.example"), { code: "ENOTFOUND" }) });
    expect(describeError(err)).toBe("fetch failed (ENOTFOUND)");
  });
});

describe("big and awkward provider lists", () => {
  it("merges names that only differ in punctuation into one channel", () => {
    const raw: RawFeed[] = [
      { sourceId: "a", upstreamId: "1", name: "E4+1", url: "http://s/1", catchupDays: 0 },
      { sourceId: "a", upstreamId: "2", name: "E4 1", url: "http://s/2", catchupDays: 0 },
    ];
    const built = buildChannels(raw, { numbering: "uk", filter: null, existing: new Map() });
    expect(new Set(built.channels.map((c) => c.id)).size).toBe(built.channels.length);
  });

  it("loads a source with a catalogue bigger than a function call's argument limit", async () => {
    const movies = Array.from({ length: 200_000 }, (_, i) => `#EXTINF:-1,Film ${i}\nhttp://p/movie/u/p/${i}.mkv`).join("\n");
    const fetchImpl = (async () => new Response(`#EXTM3U\n#EXTINF:-1,BBC One\nhttp://p/live/u/p/1.ts\n${movies}`)) as typeof fetch;
    const db = new Db(":memory:");
    const settings = new SettingsStore(db, { ...defaultSettings(), iptv: [m3u("a", "http://p/big.m3u")], channelFilter: "" });
    const channels = new ChannelStore(db);
    const ingest = new Ingestor(db, settings, channels, new GuideStore(db), silentLogger, fetchImpl);
    expect(await ingest.refreshSources()).toEqual({ channels: 1, vod: 200_000 });
  }, 30_000);

  it("asks providers as a common player, not as node", async () => {
    let agent: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      agent = new Headers(init?.headers).get("user-agent");
      return new Response("#EXTM3U\n#EXTINF:-1,BBC One\nhttp://p/1.ts");
    }) as unknown as typeof fetch;
    const db = new Db(":memory:");
    const settings = new SettingsStore(db, { ...defaultSettings(), iptv: [m3u("a", "http://p/a.m3u")] });
    await new Ingestor(db, settings, new ChannelStore(db), new GuideStore(db), silentLogger, fetchImpl).refreshSources();
    expect(agent).toMatch(/^VLC\//);
  });
});

describe("guide downloads", () => {
  const xml = '<?xml version="1.0"?><tv><channel id="a"><display-name>A</display-name></channel></tv>';
  const read = async (stream: NodeJS.ReadableStream) => {
    let text = "";
    for await (const chunk of stream) text += Buffer.from(chunk as Uint8Array).toString();
    return text;
  };

  it("unzips by content, whatever the URL or headers say", async () => {
    const zipped = gzipSync(xml);
    const serve = (body: Uint8Array | string) => (async () => new Response(body)) as unknown as typeof fetch;
    // A .gz URL the server already unpacked (Content-Encoding: gzip), and a gzipped file without .gz.
    expect(await read(await fetchStream("http://epg/uk.xml.gz", serve(xml)))).toBe(xml);
    expect(await read(await fetchStream("http://epg/uk.xml", serve(zipped)))).toBe(xml);
  });
});
