import { describe, expect, it } from "vitest";
import { LimitedCache } from "../src/limited.js";
import type { LimitedSnapshot } from "@ultimatetv/shared";

const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;

function snapshot(over: Partial<LimitedSnapshot> = {}): LimitedSnapshot {
  return {
    at: NOW,
    channels: [
      { id: "bbc-one", number: 101, name: "BBC One", category: "entertainment", url: "http://iptv.lan/live/bbc1.ts", headers: { "User-Agent": "VLC/3.0.21 LibVLC/3.0.21" } },
      { id: "cbeebies", number: 102, name: "CBeebies", category: "kids", url: "http://iptv.lan/live/cbeebies.ts" },
      { id: "film-four", number: 103, name: "Film4", category: "films", url: "http://iptv.lan/live/film4.ts" },
    ],
    guide: {
      from: NOW - HOUR,
      to: NOW + 24 * HOUR,
      programmes: {
        "bbc-one": [{ id: "p1", channelId: "bbc-one", start: NOW - 600_000, end: NOW + 600_000, title: "News", categories: [], isNew: true, isRepeat: false, isFilm: false }],
        cbeebies: [{ id: "p2", channelId: "cbeebies", start: NOW, end: NOW + 600_000, title: "Bluey", categories: [], isNew: false, isRepeat: false, isFilm: false }],
        "film-four": [{ id: "p3", channelId: "film-four", start: NOW, end: NOW + 7_200_000, title: "Big Film", categories: [], isNew: false, isRepeat: false, isFilm: true }],
      },
    },
    profiles: [
      { id: "adult-1", name: "Sam", kind: "adult", maxCertification: "18", channelCategories: [], allowedChannels: [] },
      { id: "kid-1", name: "Robin", kind: "kids", maxCertification: "PG", channelCategories: ["kids"], allowedChannels: [] },
    ],
    ...over,
  };
}

function setup(opts: { disk?: string | null; fromHub?: unknown; fail?: boolean } = {}) {
  const files = new Map<string, string>();
  if (opts.disk !== undefined && opts.disk !== null) files.set("cache/limited.json", opts.disk);
  const calls: string[] = [];
  const cache = new LimitedCache({
    file: "cache/limited.json",
    fetchSnapshot: async () => {
      calls.push("fetch");
      if (opts.fail) throw new Error("no route to host");
      return opts.fromHub;
    },
    readFile: (file) => {
      const text = files.get(file);
      if (text === undefined) throw new Error(`ENOENT: ${file}`);
      return text;
    },
    writeFile: (file, text) => {
      calls.push(`write ${file}`);
      files.set(file, text);
    },
    rename: (from, to) => {
      calls.push(`rename ${from} -> ${to}`);
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, text);
    },
    now: () => NOW,
    log: () => undefined,
  });
  return { cache, files, calls };
}

describe("LimitedCache: reading what is on disk", () => {
  it("reads a saved snapshot and offers it to the screen", () => {
    const { cache, files } = setup({ disk: JSON.stringify(snapshot()) });
    const loaded = cache.load();
    expect(loaded?.channels).toHaveLength(3);
    expect(files.get("cache/limited.json")).toBeTruthy();
    expect(cache.view({ name: "Sam", kids: false }).channels).toHaveLength(3);
  });

  it("falls back to nothing when there is no file yet, without throwing", () => {
    const { cache } = setup();
    expect(cache.load()).toBeNull();
    expect(cache.view({ name: "Sam", kids: false }).channels).toEqual([]);
  });

  it("falls back to nothing when the file is corrupt, without throwing", () => {
    const { cache } = setup({ disk: "{ this is not json" });
    expect(cache.load()).toBeNull();
  });

  it("falls back to nothing when the file holds the wrong shape", () => {
    const { cache } = setup({ disk: JSON.stringify({ hello: "world" }) });
    expect(cache.load()).toBeNull();
  });

  it("only reads the file once", () => {
    let reads = 0;
    const cache = new LimitedCache({
      file: "cache/limited.json",
      fetchSnapshot: async () => snapshot(),
      readFile: () => {
        reads += 1;
        return JSON.stringify(snapshot());
      },
      writeFile: () => undefined,
      rename: () => undefined,
      now: () => NOW,
    });
    cache.load();
    cache.load();
    expect(reads).toBe(1);
  });
});

describe("LimitedCache: refreshing from the Hub", () => {
  it("writes the Hub's snapshot through a temp file and a rename", () => {
    const { cache, files, calls } = setup({ fromHub: snapshot() });
    const saved = cache.load();
    expect(saved).toBeNull();
    return cache.refresh().then((next) => {
      expect(next?.channels).toHaveLength(3);
      expect(calls).toEqual(["fetch", "write cache/limited.json.tmp", "rename cache/limited.json.tmp -> cache/limited.json"]);
      expect(files.has("cache/limited.json.tmp")).toBe(false);
      expect(JSON.parse(files.get("cache/limited.json")!).channels).toHaveLength(3);
      expect(cache.view({ name: "Sam", kids: false }).channels).toHaveLength(3);
    });
  });

  it("keeps the old snapshot when the Hub sends nonsense", async () => {
    const { cache, files } = setup({ disk: JSON.stringify(snapshot()) });
    cache.load();
    const before = files.get("cache/limited.json");
    const fresh = new LimitedCache({
      file: "cache/limited.json",
      fetchSnapshot: async () => ({ nope: true }),
      readFile: (f) => files.get(f) ?? "",
      writeFile: (f, t) => void files.set(f, t),
      rename: () => undefined,
      now: () => NOW,
    });
    fresh.load();
    expect(await fresh.refresh()).toBeNull();
    expect(files.get("cache/limited.json")).toBe(before);
    expect(cache.view({ name: "Sam", kids: false }).channels).toHaveLength(3);
  });

  it("keeps the old snapshot and stays quiet when the Hub cannot be reached", async () => {
    const { cache } = setup({ disk: JSON.stringify(snapshot()), fail: true });
    cache.load();
    expect(await cache.refresh()).toBeNull();
    expect(cache.view({ name: "Sam", kids: false }).channels).toHaveLength(3);
  });

  it("does not write again when the Hub sends the same thing", async () => {
    const { cache, calls } = setup({ fromHub: snapshot() });
    await cache.refresh();
    const writes = calls.filter((c) => c.startsWith("write")).length;
    await cache.refresh();
    expect(calls.filter((c) => c.startsWith("write"))).toHaveLength(writes);
  });

  it("never runs two refreshes at once", async () => {
    let running = 0;
    let most = 0;
    const cache = new LimitedCache({
      file: "cache/limited.json",
      fetchSnapshot: async () => {
        running += 1;
        most = Math.max(most, running);
        await Promise.resolve();
        running -= 1;
        return snapshot();
      },
      readFile: () => {
        throw new Error("none");
      },
      writeFile: () => undefined,
      rename: () => undefined,
      now: () => NOW,
    });
    await Promise.all([cache.refresh(), cache.refresh(), cache.refresh()]);
    expect(most).toBe(1);
  });
});

describe("LimitedCache: Kids rules from the cached profile", () => {
  it("shows a Kids profile only its channels, from the cache alone", () => {
    const { cache } = setup({ disk: JSON.stringify(snapshot()) });
    cache.load();
    const view = cache.view({ name: "Robin", kids: true });
    expect(view.kids).toBe(true);
    expect(view.channels.map((c) => c.name)).toEqual(["CBeebies"]);
  });

  it("shows an adult every channel", () => {
    const { cache } = setup({ disk: JSON.stringify(snapshot()) });
    cache.load();
    expect(cache.view({ name: "Sam", kids: false }).channels.map((c) => c.name)).toEqual(["BBC One", "CBeebies", "Film4"]);
  });

  it("offers a Kids profile nothing at all when there is no cache", () => {
    const { cache } = setup();
    cache.load();
    expect(cache.view({ name: "Robin", kids: true }).channels).toEqual([]);
  });

  it("still enforces the rules after a refresh", async () => {
    const { cache } = setup({ fromHub: snapshot() });
    await cache.refresh();
    expect(cache.view({ name: "Robin", kids: true }).channels.map((c) => c.id)).toEqual(["cbeebies"]);
  });
});
