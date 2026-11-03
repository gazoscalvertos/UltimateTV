import { describe, expect, it } from "vitest";
import type { LimitedSnapshot } from "@ultimatetv/shared";
import { jellyfinPoster, jellyfinReportFor, jellyfinStreamUrl, reportJellyfinProgress, resolveLimitedPlay } from "../src/limitedplay.js";

const NOW = 1_760_000_000_000;

function snapshot(over: Partial<LimitedSnapshot> = {}): LimitedSnapshot {
  return {
    at: NOW,
    channels: [
      { id: "bbc-one", number: 101, name: "BBC One", category: "entertainment", url: "http://iptv.lan/live/1.ts", headers: { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" } },
      { id: "cbeebies", number: 601, name: "CBeebies", category: "kids", url: "http://iptv.lan/live/2.ts" },
      { id: "film-four", number: 103, name: "Film4", category: "films" },
    ],
    guide: {
      from: NOW - 3_600_000,
      to: NOW + 7 * 86_400_000,
      programmes: {
        "bbc-one": [{ id: "p1", channelId: "bbc-one", start: NOW - 600_000, end: NOW + 600_000, title: "The News", categories: [], isNew: false, isRepeat: false, isFilm: false }],
      },
    },
    profiles: [
      { id: "family", name: "Family", kind: "adult", maxCertification: "18", channelCategories: [], allowedChannels: [] },
      { id: "kids", name: "Robin", kind: "kids", maxCertification: "PG", channelCategories: ["kids"], allowedChannels: [] },
    ],
    jellyfin: {
      url: "http://jellyfin.lan:8096/",
      serverName: "Home",
      userId: "u1",
      token: "tok",
      items: [
        { id: "film1", refId: "jellyfin:film1", kind: "movie", name: "Copper Sky", certification: "PG", genres: ["Family"], positionMs: 48 * 60_000, runtimeMs: 90 * 60_000 },
        { id: "film2", refId: "jellyfin:film2", kind: "movie", name: "Scary Film", certification: "18", genres: ["Horror"] },
      ],
    },
    ...over,
  };
}

const adult = { name: "Family", kids: false };
const kid = { name: "Robin", kids: true };

describe("playing a channel with no Hub", () => {
  it("uses the cached URL, its headers, and what's on now as the title", () => {
    const r = resolveLimitedPlay(snapshot(), adult, { kind: "channel", id: "bbc-one" }, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(r.options).toMatchObject({ url: "http://iptv.lan/live/1.ts", headers: { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" }, live: true, startMs: 0, title: "BBC One" });
    expect(r.options.subtitle).toBe("The News");
    expect(r.jellyfin).toBeUndefined();
  });

  it("says why a channel can't be tuned rather than failing silently", () => {
    const noUrl = resolveLimitedPlay(snapshot(), adult, { kind: "channel", id: "film-four" }, NOW);
    expect(noUrl).toEqual({ ok: false, reason: "Film4 has no stream the box can play with the Hub off" });
    const missing = resolveLimitedPlay(snapshot(), adult, { kind: "channel", id: "nope" }, NOW);
    expect(missing.ok).toBe(false);
  });

  it("keeps a Kids profile to its own channels, from the cached profile", () => {
    const blocked = resolveLimitedPlay(snapshot(), kid, { kind: "channel", id: "bbc-one" }, NOW);
    expect(blocked).toMatchObject({ ok: false });
    const allowed = resolveLimitedPlay(snapshot(), kid, { kind: "channel", id: "cbeebies" }, NOW);
    expect(allowed.ok).toBe(true);
  });

  it("plays nothing at all when the cache is empty", () => {
    expect(resolveLimitedPlay(null, adult, { kind: "channel", id: "bbc-one" }, NOW).ok).toBe(false);
  });
});

describe("playing a Jellyfin film with no Hub", () => {
  it("plays straight from the server, at the place the cache remembered", () => {
    const r = resolveLimitedPlay(snapshot(), adult, { kind: "jellyfin", id: "film1" }, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(r.options).toMatchObject({ url: "http://jellyfin.lan:8096/Videos/film1/stream?static=true&api_key=tok", live: false, startMs: 48 * 60_000, title: "Copper Sky" });
    // The box reports progress itself, so it needs to know which item it is playing.
    expect(r.jellyfin).toEqual({ itemId: "film1", durationMs: 90 * 60_000 });
  });

  it("adds the media source when the cache names one", () => {
    const snap = snapshot();
    snap.jellyfin!.items[0]!.sourceId = "src1";
    const r = resolveLimitedPlay(snap, adult, { kind: "jellyfin", id: "film1" }, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(r.options.url).toContain("mediaSourceId=src1");
  });

  it("keeps a Kids profile to films it may watch", () => {
    expect(resolveLimitedPlay(snapshot(), kid, { kind: "jellyfin", id: "film1" }, NOW).ok).toBe(true);
    const blocked = resolveLimitedPlay(snapshot(), kid, { kind: "jellyfin", id: "film2" }, NOW);
    expect(blocked).toMatchObject({ ok: false });
  });

  it("starts from the beginning when the cache has no place", () => {
    const r = resolveLimitedPlay(snapshot(), adult, { kind: "jellyfin", id: "film2" }, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(r.options.startMs).toBe(0);
  });

  it("says so when the Hub has no Jellyfin at all", () => {
    const snap = { ...snapshot(), jellyfin: undefined };
    expect(resolveLimitedPlay(snap, adult, { kind: "jellyfin", id: "film1" }, NOW)).toEqual({ ok: false, reason: "Jellyfin isn't set up on this box" });
  });
});

describe("the Jellyfin bits a film needs", () => {
  it("builds a stream URL from the cached connection", () => {
    expect(jellyfinStreamUrl({ url: "http://jellyfin.lan:8096/", token: "tok" }, "a b")).toBe("http://jellyfin.lan:8096/Videos/a%20b/stream?static=true&api_key=tok");
  });

  it("adds the token to a poster URL so the TV can fetch it", () => {
    expect(jellyfinPoster("http://jellyfin.lan:8096/Items/x/Images/Primary?maxWidth=400", "tok")).toBe("http://jellyfin.lan:8096/Items/x/Images/Primary?maxWidth=400&api_key=tok");
    expect(jellyfinPoster("http://jellyfin.lan:8096/Items/x/Images/Primary?tag=1", "tok")).toBe("http://jellyfin.lan:8096/Items/x/Images/Primary?tag=1&api_key=tok");
  });

  it("reports where a film got to, in Jellyfin's own units", async () => {
    const calls: { url: string; body: unknown; auth: string | undefined }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as unknown, auth: (init.headers as Record<string, string>).Authorization });
      // Jellyfin answers 204 with no body, and a 204 can carry none.
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const ok = await reportJellyfinProgress(fake, { url: "http://jellyfin.lan:8096/", token: "tok" }, { itemId: "film1", positionMs: 61_000, event: "progress", paused: true });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://jellyfin.lan:8096/Sessions/Playing/Progress");
    expect(calls[0]!.body).toEqual({ ItemId: "film1", PositionTicks: 610_000_000, IsPaused: true, PlayMethod: "DirectPlay" });
    expect(calls[0]!.auth).toContain('Token="tok"');
  });

  it("uses the stopping path for the end of a film", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await reportJellyfinProgress(fake, { url: "http://jellyfin.lan:8096", token: "tok" }, { itemId: "film1", positionMs: 5_000, event: "stop", paused: false });
    expect(urls[0]).toBe("http://jellyfin.lan:8096/Sessions/Playing/Stopped");
  });

  it("is quiet when Jellyfin can't be reached: the film keeps playing", async () => {
    const fake = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(reportJellyfinProgress(fake, { url: "http://jellyfin.lan:8096/", token: "tok" }, { itemId: "film1", positionMs: 1_000, event: "progress", paused: false })).resolves.toBe(false);
  });
});

describe("reporting a film's progress while it plays", () => {
  it("says start the first time it plays, then progress every ten seconds", () => {
    const first = jellyfinReportFor(null, { status: "playing", positionMs: 1_000 }, 1_000);
    expect(first).toEqual({ event: "start", positionMs: 1_000 });
    const soon = jellyfinReportFor({ at: 1_000, status: "playing" }, { status: "playing", positionMs: 3_000 }, 3_000);
    expect(soon).toBeNull();
    const later = jellyfinReportFor({ at: 1_000, status: "playing" }, { status: "playing", positionMs: 12_000 }, 12_000);
    expect(later).toEqual({ event: "progress", positionMs: 12_000 });
  });

  it("doesn't report a film that is paused, or nothing at all", () => {
    expect(jellyfinReportFor({ at: 1_000, status: "playing" }, { status: "paused", positionMs: 30_000 }, 30_000)).toBeNull();
    // Stopped by the viewer: Jellyfin should hear about it, at the place it reached.
    expect(jellyfinReportFor({ at: 1_000, status: "playing" }, { status: "idle", positionMs: 20_000 }, 30_000)).toEqual({ event: "stop", positionMs: 20_000 });
    expect(jellyfinReportFor(null, { status: "idle", positionMs: 0 }, 0)).toBeNull();
  });

  it("says stop when the film ends or the box is told to stop", () => {
    expect(jellyfinReportFor({ at: 1_000, status: "playing" }, { status: "ended", positionMs: 5_400_000 }, 5_400_000)).toEqual({ event: "stop", positionMs: 5_400_000 });
    expect(jellyfinReportFor({ at: 1_000, status: "playing" }, { status: "error", positionMs: 2_000 }, 2_000)).toEqual({ event: "stop", positionMs: 2_000 });
  });

  it("carries on after a pause rather than starting again", () => {
    expect(jellyfinReportFor({ at: 1_000, status: "paused" }, { status: "playing", positionMs: 31_000 }, 40_000)).toEqual({ event: "progress", positionMs: 31_000 });
  });

  it("reports a pause at once, so Jellyfin knows the film is held", () => {
    expect(jellyfinReportFor({ at: 1_000, status: "playing" }, { status: "paused", positionMs: 30_000 }, 30_000, true)).toEqual({ event: "progress", positionMs: 30_000, paused: true });
  });
});
