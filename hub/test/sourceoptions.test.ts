import { describe, expect, it } from "vitest";
import type { Settings, StreamCandidate } from "@ultimatetv/shared";
import { defaultSettings, publicSettings, SettingsStore } from "../src/settings.js";
import { activeIptv, addonKey, isPaused, listProviders, orderPatch, orderedKeys, orderStreams, pausePatch, pausedKeys, testSource, UnknownSourceError } from "../src/sourceoptions.js";

function settings(): Settings {
  return {
    ...defaultSettings(),
    iptv: [
      { id: "a", kind: "xtream", name: "Alpha", url: "http://alpha.example", username: "u", password: "p", connections: 2 },
      { id: "b", kind: "m3u", name: "Beta", url: "http://beta.example/list.m3u", connections: 1 },
    ],
    jellyfin: { url: "http://jf:8096", userId: "uid", token: "tok" },
    torboxApiKey: "key",
    addonUrls: ["https://addon.example/abc/manifest.json"],
  };
}

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown; throws?: Error };
function fakeFetch(handler: Handler): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(input), init);
    if (r.throws) throw r.throws;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status ?? 200 });
  }) as typeof fetch;
}

describe("source keys and order", () => {
  it("lists every provider with stable keys", () => {
    const keys = listProviders(settings()).map((p) => p.key);
    expect(keys).toEqual(["iptv:a", "iptv:b", "jellyfin", "torbox", addonKey("https://addon.example/abc/manifest.json")]);
    expect(addonKey("https://addon.example/abc/manifest.json")).toMatch(/^addon:[0-9a-f]{8}$/);
  });

  it("applies a saved order, dropping unknown keys and putting new sources last", () => {
    const s = { ...settings(), providerOrder: ["torbox", "gone", "iptv:b"] };
    expect(orderedKeys(s)).toEqual(["torbox", "iptv:b", "iptv:a", "jellyfin", addonKey(s.addonUrls[0]!)]);
  });

  it("saves an order, refusing keys it doesn't know", () => {
    const s = settings();
    expect(orderPatch(s, ["jellyfin", "iptv:a"]).providerOrder).toEqual(["jellyfin", "iptv:a", "iptv:b", "torbox", addonKey(s.addonUrls[0]!)]);
    expect(() => orderPatch(s, ["nope"])).toThrow(UnknownSourceError);
    expect(() => orderPatch(s, "iptv:a")).toThrow();
  });
});

describe("pause", () => {
  it("pauses an IPTV source on the source itself and keeps its login", () => {
    const s = settings();
    const paused = { ...s, ...pausePatch(s, "iptv:a", true) } as Settings;
    expect(isPaused(paused, "iptv:a")).toBe(true);
    expect(paused.iptv[0]).toMatchObject({ username: "u", password: "p", paused: true });
    expect(activeIptv(paused).map((x) => x.id)).toEqual(["b"]);
    const resumed = { ...paused, ...pausePatch(paused, "iptv:a", false) } as Settings;
    expect(isPaused(resumed, "iptv:a")).toBe(false);
    expect(resumed.iptv[0]!.paused).toBeUndefined();
  });

  it("pauses the media server, TorBox and add-ons in pausedProviders", () => {
    let s = settings();
    for (const k of ["jellyfin", "torbox", addonKey(s.addonUrls[0]!)]) s = { ...s, ...pausePatch(s, k, true) } as Settings;
    expect(s.pausedProviders).toHaveLength(3);
    expect(s.jellyfin?.token).toBe("tok");
    s = { ...s, ...pausePatch(s, "torbox", false) } as Settings;
    expect(pausedKeys(s)).not.toContain("torbox");
  });

  it("refuses a source that isn't set up", () => {
    expect(() => pausePatch(settings(), "plex", true)).toThrow(UnknownSourceError);
  });

  it("leaves paused IPTV out of the connection limit and shows it all in public settings", () => {
    const s = settings();
    expect(SettingsStore.prototype.connectionLimit.call({ cache: s })).toBe(1);
    const p = { ...s, ...pausePatch(s, "iptv:b", true) } as Settings;
    expect(SettingsStore.prototype.connectionLimit.call({ cache: p })).toBe(2);
    const pub = publicSettings({ ...p, providerOrder: ["torbox"] }, "http://hub");
    expect(pub.iptv.find((x) => x.id === "b")?.paused).toBe(true);
    expect(pub.pausedProviders).toEqual(["iptv:b"]);
    expect(pub.providerOrder[0]).toBe("torbox");
    expect(pub.addons[0]!.id).toBe(addonKey(s.addonUrls[0]!));
  });
});

describe("orderStreams", () => {
  const cand = (provider: string, score: number): StreamCandidate => ({
    id: provider,
    kind: "xtream",
    provider,
    label: provider,
    quality: { height: 1080, hdr: "sdr", codec: "unknown", audio: "unknown" },
    ready: true,
    url: "x",
    downloadable: false,
    score,
  });

  it("breaks ties and small gaps by the order, but quality still wins big", () => {
    const ranked = [cand("iptv:a", 100), cand("jellyfin", 100), cand("torbox", 85), cand("iptv:b", 40)];
    const out = orderStreams(ranked, ["jellyfin", "torbox", "iptv:a", "iptv:b"]);
    expect(out[0]!.provider).toBe("jellyfin");
    expect(out[out.length - 1]!.provider).toBe("iptv:b");
    // a far better copy from a lower source still wins
    const far = orderStreams([cand("iptv:a", 200), cand("jellyfin", 40)], ["jellyfin", "iptv:a"]);
    expect(far[0]!.provider).toBe("iptv:a");
  });

  it("moving a source up changes which is tried first", () => {
    const ranked = [cand("iptv:a", 100), cand("iptv:b", 100)];
    expect(orderStreams(ranked, ["iptv:a", "iptv:b"])[0]!.provider).toBe("iptv:a");
    expect(orderStreams(ranked, ["iptv:b", "iptv:a"])[0]!.provider).toBe("iptv:b");
  });

  it("drops copies from paused providers", () => {
    expect(orderStreams([cand("iptv:a", 100), cand("iptv:b", 90)], ["iptv:a", "iptv:b"], ["iptv:a"]).map((c) => c.provider)).toEqual(["iptv:b"]);
  });
});

describe("testSource", () => {
  it("reads Xtream account expiry and connections", async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
    const f = fakeFetch((url) => {
      expect(url).toContain("player_api.php");
      return { body: { user_info: { auth: 1, status: "Active", exp_date: String(exp), max_connections: "2", active_cons: "1" } } };
    });
    const r = await testSource(settings(), "iptv:a", f);
    expect(r).toMatchObject({ id: "iptv:a", name: "Alpha", reachable: true, signedIn: true, activeConnections: 1, maxConnections: 2, detail: "Active", expiresAt: exp * 1000 });
    expect(r.error).toBeUndefined();
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("says when the Xtream login is refused or the account has expired", async () => {
    const refused = await testSource(settings(), "iptv:a", fakeFetch(() => ({ body: { user_info: { auth: 0 } } })));
    expect(refused).toMatchObject({ reachable: true, signedIn: false });
    expect(refused.error).toMatch(/username and password/);
    const old = await testSource(settings(), "iptv:a", fakeFetch(() => ({ body: { user_info: { auth: 1, status: "Active", exp_date: "1000" } } })));
    expect(old.error).toMatch(/expired/);
  });

  it("fetches an M3U playlist and counts entries", async () => {
    const r = await testSource(settings(), "iptv:b", fakeFetch(() => ({ body: "#EXTM3U\n#EXTINF:-1,One\nhttp://x/1\n#EXTINF:-1,Two\nhttp://x/2\n" })));
    expect(r).toMatchObject({ reachable: true });
    expect(r.signedIn).toBeUndefined();
    expect(r.detail).toContain("2 entries");
    const bad = await testSource(settings(), "iptv:b", fakeFetch(() => ({ body: "<html>" })));
    expect(bad.error).toMatch(/playlist/);
  });

  it("reports an unreachable source instead of throwing", async () => {
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const r = await testSource(settings(), "iptv:a", fakeFetch(() => ({ throws: err })));
    expect(r).toMatchObject({ reachable: false, error: "The connection was refused" });
  });

  it("tests Jellyfin, TorBox and add-ons", async () => {
    const f = fakeFetch((url) => {
      if (url.includes("/System/Info/Public")) return { body: { ServerName: "Home" } };
      if (url.includes("/Users/uid")) return { status: 401 };
      if (url.includes("torbox")) return { body: { data: { premium_expires_at: "2027-01-01T00:00:00Z" } } };
      if (url.endsWith("/manifest.json")) return { body: { name: "AIOStreams" } };
      return { status: 404 };
    });
    const s = settings();
    expect(await testSource(s, "jellyfin", f)).toMatchObject({ reachable: true, signedIn: false, detail: "Home" });
    expect(await testSource(s, "torbox", f)).toMatchObject({ signedIn: true, expiresAt: Date.parse("2027-01-01T00:00:00Z") });
    expect(await testSource(s, addonKey(s.addonUrls[0]!), f)).toMatchObject({ reachable: true, detail: "AIOStreams" });
  });

  it("refuses an unknown source", async () => {
    await expect(testSource(settings(), "plex", fakeFetch(() => ({})))).rejects.toThrow(UnknownSourceError);
  });
});
