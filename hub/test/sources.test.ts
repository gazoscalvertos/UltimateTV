import { describe, expect, it } from "vitest";
import type { IptvSource } from "@ultimatetv/shared";
import { ChannelStore } from "../src/channels.js";
import { Db } from "../src/db.js";
import { GuideStore } from "../src/epg.js";
import { describeError, Ingestor } from "../src/ingest/index.js";
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
