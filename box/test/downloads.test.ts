import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BoxDownloads } from "@ultimatetv/shared";
import { Downloads, expiryOf, extensionOf, keyOf, subtitleExtension } from "../src/downloads.js";

const DAY = 86_400_000;
const HUB = "http://hub.test";
const FILM = Buffer.alloc(64 * 1024, 7);

/** A Hub and a source that serve one film (with Range), a poster and a subtitle file. */
function fakeNet(opts: { offline?: (body: unknown) => Response } = {}) {
  const calls: { url: string; range?: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, ...(headers.get("range") ? { range: headers.get("range")! } : {}) });
    if (url === `${HUB}/api/offline`) {
      if (opts.offline) return opts.offline(JSON.parse(String(init?.body)));
      return Response.json({ url: "/api/recordings/r1/file", title: "Film", live: false, startMs: 0, durationMs: 6_000_000, externalSubtitles: [{ url: "http://jf.test/Subtitles/1/Stream.srt", lang: "eng", label: "English" }], progressKey: "title:x", skip: [] });
    }
    if (url === `${HUB}/api/recordings/r1/file`) {
      const m = /^bytes=(\d+)-$/.exec(headers.get("range") ?? "");
      const from = m ? Number(m[1]) : 0;
      const body = FILM.subarray(from);
      return new Response(body, { status: m ? 206 : 200, headers: { "content-length": String(body.length), "content-type": "video/x-matroska" } });
    }
    if (url === "http://img.test/poster.jpg") return new Response(Buffer.from("jpeg"), { headers: { "content-type": "image/jpeg" } });
    if (url.endsWith("Stream.srt")) return new Response("1\n00:00:01,000 --> 00:00:02,000\nHi\n");
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), "utv-dl-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** Waits until the list matches. */
async function until(dl: Downloads, ok: (d: BoxDownloads) => boolean): Promise<BoxDownloads> {
  for (let i = 0; i < 200; i++) {
    const d = await dl.list();
    if (ok(d)) return d;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out: ${JSON.stringify((await dl.list()).items.map((i) => [i.status, i.error]))}`);
}

describe("download helpers", () => {
  it("treats every version of a film or episode as one download", () => {
    expect(keyOf({ kind: "title", id: "jellyfin:1", streamId: "a" })).toBe(keyOf({ kind: "title", id: "jellyfin:1" }));
    expect(keyOf({ kind: "title", id: "t", episodeId: "s1e2" })).not.toBe(keyOf({ kind: "title", id: "t", episodeId: "s1e3" }));
  });

  it("works out when a download goes", () => {
    const doneAt = 1_000 * DAY;
    expect(expiryOf({ doneAt }, { keepDays: 14, deleteWatched: true })).toBe(doneAt + 14 * DAY);
    expect(expiryOf({ doneAt, watchedAt: doneAt + DAY }, { keepDays: 14, deleteWatched: true })).toBe(doneAt + 2 * DAY);
    expect(expiryOf({ doneAt, watchedAt: doneAt + DAY }, { keepDays: 14, deleteWatched: false })).toBe(doneAt + 14 * DAY);
    expect(expiryOf({ doneAt }, { keepDays: 0, deleteWatched: true })).toBeUndefined();
    expect(expiryOf({}, { keepDays: 3, deleteWatched: true })).toBeUndefined();
  });

  it("names files sensibly", () => {
    expect(extensionOf("http://x/a/Film.mp4?api_key=1", null, null)).toBe("mp4");
    expect(extensionOf("http://x/stream", 'attachment; filename="Dune (2021).mkv"', null)).toBe("mkv");
    expect(extensionOf("http://x/stream", null, "video/mp2t")).toBe("ts");
    expect(extensionOf("http://x/stream", null, null)).toBe("mkv");
    expect(subtitleExtension("http://jf/Videos/1/Subtitles/3/0/Stream.vtt?api_key=x")).toBe("vtt");
    expect(subtitleExtension("http://jf/sub")).toBe("srt");
  });
});

describe("downloads on the box", () => {
  it("downloads a film with its poster and subtitles, then plays it from the disk", async () => {
    const dir = await tmp();
    const net = fakeNet();
    const dl = new Downloads(HUB, () => undefined, dir, net.impl);
    await dl.start();
    await dl.add([{ req: { kind: "title", id: "jellyfin:1" }, name: "Film", image: "http://img.test/poster.jpg", title: { id: "jellyfin:1", kind: "movie", name: "Film", certification: "12" } }]);
    const d = await until(dl, (x) => x.items[0]?.status === "done");
    expect(d.items[0]).toMatchObject({ bytesDone: FILM.length, bytesTotal: FILM.length });
    expect(d.items[0]!.artwork).toMatch(/^data:image\/jpeg;base64,/);
    expect(d.items[0]!.expiresAt).toBeGreaterThan(Date.now() + 13 * DAY);

    const local = await dl.localCopy({ kind: "title", id: "jellyfin:1", streamId: "other" });
    expect(local?.url).toBe(path.join(dir, `${d.items[0]!.id}.mkv`));
    expect(local?.externalSubtitles[0]?.url).toMatch(/\.sub0\.srt$/);
    expect(local?.source?.label).toBe("Downloaded");
    expect(await readFile(local!.url)).toEqual(FILM);
    expect(await dl.localCopy({ kind: "title", id: "jellyfin:2" })).toBeNull();

    // Asking again doesn't download it twice.
    await dl.add([{ req: { kind: "title", id: "jellyfin:1" }, name: "Film" }]);
    expect((await dl.list()).items).toHaveLength(1);
    dl.stop();
  });

  it("picks up where an interrupted download stopped", async () => {
    const dir = await tmp();
    const net = fakeNet();
    // A first try that got 1000 bytes in before the box restarted.
    await writeFile(path.join(dir, "downloads.json"), JSON.stringify({ items: [{ id: "d1", req: { kind: "recording", id: "r1" }, name: "News", status: "downloading", bytesDone: 1000, addedAt: 1 }] }));
    await writeFile(path.join(dir, "d1.part"), FILM.subarray(0, 1000));
    const dl = new Downloads(HUB, () => undefined, dir, net.impl);
    await dl.start();
    await until(dl, (x) => x.items[0]?.status === "done");
    expect(net.calls.find((c) => c.url.endsWith("/file"))?.range).toBe("bytes=1000-");
    expect(await readFile(path.join(dir, "d1.mkv"))).toEqual(FILM);
    dl.stop();
  });

  it("waits for the IPTV connection rather than failing", async () => {
    const dir = await tmp();
    const net = fakeNet({ offline: () => Response.json({ error: "Your IPTV connection is busy", code: "busy" }, { status: 409 }) });
    const dl = new Downloads(HUB, () => undefined, dir, net.impl);
    await dl.start();
    await dl.add([{ req: { kind: "title", id: "xtream:vod:1" }, name: "IPTV film" }]);
    const d = await until(dl, (x) => Boolean(x.items[0]?.error));
    expect(d.items[0]).toMatchObject({ status: "queued", error: "Your IPTV connection is busy" });
    dl.stop();
  });

  it("deletes downloads when asked, and when their time is up", async () => {
    const dir = await tmp();
    const dl = new Downloads(HUB, () => undefined, dir, fakeNet().impl);
    await dl.start();
    await dl.add([{ req: { kind: "recording", id: "r1" }, name: "One" }]);
    const first = (await until(dl, (x) => x.items[0]?.status === "done")).items[0]!;
    await dl.add([{ req: { kind: "recording", id: "r2" }, name: "Two" }]);
    await until(dl, (x) => x.items.every((i) => i.status === "done"));

    await dl.remove(first.id);
    expect((await readdir(dir)).filter((f) => f.startsWith(first.id))).toEqual([]);

    // Watched: it goes a day later.
    const second = (await dl.list()).items[0]!;
    await dl.position(second.id, 5_900_000, 6_000_000);
    const watched = (await dl.list()).items[0]!;
    expect(watched.watchedAt).toBeDefined();
    expect(watched.positionMs).toBe(0);
    expect(watched.expiresAt).toBeLessThanOrEqual(Date.now() + DAY);
    await dl.expire();
    expect((await dl.list()).items).toHaveLength(1);
    await dl.expire(Date.now() + 2 * DAY);
    expect((await dl.list()).items).toHaveLength(0);
    expect((await readdir(dir)).filter((f) => f.startsWith(second.id))).toEqual([]);
    dl.stop();
  });
});
