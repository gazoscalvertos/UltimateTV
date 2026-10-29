import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Download } from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { EventBus } from "../src/events.js";
import { silentLogger } from "../src/log.js";
import { DownloadManager } from "../src/services/downloads.js";
import { JellyfinClient } from "../src/services/jellyfin.js";
import { defaultSettings, SettingsStore } from "../src/settings.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Save to NAS: telling Jellyfin", () => {
  it("adds a file inside one of Jellyfin's libraries", async () => {
    const posted: string[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/Library/VirtualFolders")) return json([{ Name: "Movies", Locations: ["/mnt/nas/Movies/"] }]);
      posted.push(`${init?.method} ${new URL(String(url)).pathname}`);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const jf = new JellyfinClient({ url: "http://jf:8096", userId: "u1", token: "tok" }, impl);
    expect(await jf.mediaUpdated(["/mnt/nas/Movies/Heat (1995)/Heat (1995).mkv"])).toEqual({ added: true, note: "Added to Jellyfin" });
    expect(posted).toEqual(["POST /Library/Media/Updated"]);
  });

  it("says where Jellyfin looks when the file is outside its libraries", async () => {
    const posted: string[] = [];
    const impl = (async (url: string) => {
      if (String(url).includes("/Library/VirtualFolders")) return json([{ Name: "Films", Locations: ["/media/films"] }]);
      posted.push(String(url));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const jf = new JellyfinClient({ url: "http://jf:8096", userId: "u1", token: "tok" }, impl);
    const r = await jf.mediaUpdated(["/mnt/nas/Movies/Heat (1995)/Heat (1995).mkv"]);
    expect(r.added).toBe(false);
    expect(r.note).toContain("/media/films");
    expect(posted).toEqual([]);
  });

  it("still sends the update when the account can't list the libraries", async () => {
    const posted: string[] = [];
    const impl = (async (url: string) => {
      if (String(url).includes("/Library/VirtualFolders")) return new Response("forbidden", { status: 403 });
      posted.push(new URL(String(url)).pathname);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const jf = new JellyfinClient({ url: "http://jf:8096", userId: "u1", token: "tok" }, impl);
    expect((await jf.mediaUpdated(["/x/y.mkv"])).added).toBe(true);
    expect(posted).toEqual(["/Library/Media/Updated"]);
  });
});

describe("Save to NAS: downloading", () => {
  let dir = "";
  let manager: DownloadManager | null = null;
  afterEach(async () => {
    manager?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("saves a stream with Jellyfin naming, keeps one copy and records what Jellyfin said", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "utv-save-"));
    const db = new Db(":memory:");
    const settings = new SettingsStore(db, defaultSettings(dir));
    const events = new EventBus();
    const seen: Download[] = [];
    events.on((e) => {
      if (e.type === "downloads.changed") seen.push(e.download);
    });
    const told: string[][] = [];
    const impl = (async () => new Response("video bytes", { status: 200, headers: { "content-length": "11" } })) as unknown as typeof fetch;
    manager = new DownloadManager(db, settings, events, silentLogger, () => null, async (paths) => {
      told.push(paths);
      return { added: true, note: "Added to Jellyfin" };
    }, impl);

    const first = manager.add({ title: "Slow Horses", kind: "series", year: 2022, season: 1, episode: 2, url: "https://aio.example/play/7", fileName: "Slow.Horses.S01E02.mkv" });
    // Pressed again on the phone: the same download comes back.
    expect(manager.add({ title: "Slow Horses", kind: "series", year: 2022, season: 1, episode: 2, url: "https://aio.example/play/8" }).id).toBe(first.id);

    for (let i = 0; i < 100 && !manager.get(first.id)?.jellyfin; i++) await new Promise((r) => setTimeout(r, 20));
    const done = manager.get(first.id)!;
    const target = path.join(dir, "TV", "Slow Horses (2022)", "Season 01", "Slow Horses - S01E02.mkv");
    expect(done).toMatchObject({ status: "completed", path: target, jellyfin: { added: true } });
    expect(await readFile(target, "utf8")).toBe("video bytes");
    expect(told).toEqual([[target]]);
    expect(manager.list()).toHaveLength(1);
    expect(seen.at(-1)?.jellyfin?.added).toBe(true);
  });
});
