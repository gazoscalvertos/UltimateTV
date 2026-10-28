// Downloads on the box: films, episodes and recordings copied onto the box's own disk, so they play
// with the NAS and Jellyfin out of reach (a hotel, with the Hub on the box) and start at once at
// home. The box asks the Hub for each one as the Android app does (POST /api/offline), then fetches
// the file itself, one at a time, picking up where it stopped after a dropped connection or a
// restart. It keeps the disk's last 10 GB free, the same margin travel.sh keeps for music videos,
// and deletes downloads by itself after the days set in Settings, or a day after they're watched.
//
//   DOWNLOADS_DIR  where they go (default ~/.local/share/ultimatetv/downloads)

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BoxDownload, BoxDownloadRequest, BoxDownloads, BoxDownloadSettings, PlaybackInfo, PlaybackRequest } from "@ultimatetv/shared";

const DAY = 86_400_000;
export const RESERVE_BYTES = 10 * 1024 ** 3;
const DEFAULT_SETTINGS: BoxDownloadSettings = { keepDays: 14, deleteWatched: true };
/** Tries before a download shows as failed (a dropped connection picks up where it stopped). */
const RETRIES = 3;

/** What's kept for each download beside what the list shows. */
interface Stored extends BoxDownload {
  /** How it plays (the Hub's answer), with the URL swapped for the file once it's here. */
  info?: Omit<PlaybackInfo, "url" | "headers">;
  file?: string;
  subtitles?: { file: string; lang: string; label: string }[];
  art?: { file: string; type: string };
  /** Tried and failed this many times in a row; it waits until `retryAt`. */
  tries?: number;
  retryAt?: number;
}

interface Index {
  items: Stored[];
  settings: BoxDownloadSettings;
}

/** One download per film, episode or recording, whichever version it came from. */
export function keyOf(req: PlaybackRequest): string {
  return `${req.kind}:${req.id}|${req.episodeId ?? ""}`;
}

/** When a finished download goes: days after it finished, or a day after it was watched (whichever is first). */
export function expiryOf(item: Pick<BoxDownload, "doneAt" | "watchedAt">, s: BoxDownloadSettings): number | undefined {
  if (!item.doneAt) return undefined;
  const times: number[] = [];
  if (s.keepDays > 0) times.push(item.doneAt + s.keepDays * DAY);
  if (s.deleteWatched && item.watchedAt) times.push(item.watchedAt + DAY);
  return times.length ? Math.min(...times) : undefined;
}

/** A sensible extension for the saved file, from the link, its file name or its type. */
export function extensionOf(url: string, disposition: string | null, type: string | null): string {
  const named = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(disposition)?.[1] : undefined;
  for (const n of [named, (() => { try { return new URL(url).pathname; } catch { return url; } })()]) {
    const m = n ? /\.(mkv|mp4|m4v|avi|ts|m2ts|webm|mov)$/i.exec(decodeURIComponent(n)) : null;
    if (m?.[1]) return m[1].toLowerCase();
  }
  if (type?.includes("mp4")) return "mp4";
  if (type?.includes("mp2t")) return "ts";
  if (type?.includes("webm")) return "webm";
  return "mkv";
}

export function subtitleExtension(url: string): string {
  const m = /\.(srt|vtt|ass|ssa|sub)(?:$|[?#])/i.exec(url);
  return m?.[1]?.toLowerCase() ?? "srt";
}

/** The IPTV connection is busy: wait and try again, however long it takes. */
class Waiting extends Error {}
/** No room: trying again won't help until something is deleted. */
class Full extends Error {}

export class Downloads {
  private items: Stored[] = [];
  private settings: BoxDownloadSettings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<(d: BoxDownloads) => void>();
  private current: { id: string; abort: AbortController } | null = null;
  private wake: NodeJS.Timeout | undefined;
  private expireTimer: NodeJS.Timeout | undefined;
  private emitTimer: NodeJS.Timeout | undefined;
  private artCache = new Map<string, string>();
  private lastPlayed = new Map<string, number>();
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly hubUrl: string,
    private readonly log: (line: string) => void,
    readonly dir = process.env.DOWNLOADS_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "ultimatetv", "downloads"),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get indexFile(): string {
    return path.join(this.dir, "downloads.json");
  }

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const index = JSON.parse(await readFile(this.indexFile, "utf8")) as Partial<Index>;
      this.items = (index.items ?? []).map((i) => (i.status === "downloading" ? { ...i, status: "queued" as const } : i));
      this.settings = { ...DEFAULT_SETTINGS, ...index.settings };
    } catch {
      // No downloads yet.
    }
    await this.expire();
    this.expireTimer = setInterval(() => void this.expire(), 60 * 60_000);
    this.kick();
  }

  stop(): void {
    clearInterval(this.expireTimer);
    clearTimeout(this.wake);
    this.current?.abort.abort();
  }

  onChange(listener: (d: BoxDownloads) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(): Promise<BoxDownloads> {
    let used = 0;
    for (const i of this.items) used += i.status === "done" ? (i.bytesTotal ?? i.bytesDone) : i.bytesDone;
    const fs = await statfs(this.dir).catch(() => null);
    const items: BoxDownload[] = [];
    for (const i of this.items) {
      const { info: _info, file: _file, subtitles: _subs, art, tries: _tries, retryAt: _retry, ...shown } = i;
      const artwork = art ? await this.artwork(i.id, art) : undefined;
      items.push({ ...shown, ...(artwork ? { artwork } : {}) });
    }
    return { items, settings: { ...this.settings }, usedBytes: used, freeBytes: fs ? fs.bavail * fs.bsize : 0, reserveBytes: RESERVE_BYTES };
  }

  private async artwork(id: string, art: { file: string; type: string }): Promise<string | undefined> {
    const cached = this.artCache.get(id);
    if (cached) return cached;
    const data = await readFile(path.join(this.dir, art.file)).catch(() => null);
    if (!data) return undefined;
    const url = `data:${art.type};base64,${data.toString("base64")}`;
    this.artCache.set(id, url);
    return url;
  }

  async add(requests: BoxDownloadRequest[]): Promise<BoxDownloads> {
    const now = Date.now();
    let n = 0;
    for (const r of requests) {
      if (!r?.req?.id || r.req.kind === "channel") continue;
      const existing = this.items.find((i) => keyOf(i.req) === keyOf(r.req));
      if (existing) {
        // Asked again for one that failed: try it again.
        if (existing.status === "failed") Object.assign(existing, { status: "queued", tries: 0, retryAt: undefined, error: undefined });
        continue;
      }
      const item: Stored = { ...r, id: `d${now.toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`, status: "queued", bytesDone: 0, addedAt: now };
      this.items.push(item);
    }
    await this.save();
    this.kick();
    return this.list();
  }

  async remove(id: string): Promise<BoxDownloads> {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      if (this.current?.id === id) this.current.abort.abort();
      this.items = this.items.filter((i) => i !== item);
      await this.deleteFiles(item);
      await this.save();
      this.log(`Deleted the download of ${item.name}`);
    }
    return this.list();
  }

  async retry(id: string): Promise<BoxDownloads> {
    const item = this.items.find((i) => i.id === id);
    if (item && item.status === "failed") {
      Object.assign(item, { status: "queued", tries: 0 });
      delete item.retryAt;
      delete item.error;
      await this.save();
      this.kick();
    }
    return this.list();
  }

  async setSettings(patch: Partial<BoxDownloadSettings>): Promise<BoxDownloads> {
    if (typeof patch.keepDays === "number" && patch.keepDays >= 0) this.settings.keepDays = Math.round(patch.keepDays);
    if (typeof patch.deleteWatched === "boolean") this.settings.deleteWatched = patch.deleteWatched;
    for (const i of this.items) {
      const at = expiryOf(i, this.settings);
      if (at) i.expiresAt = at;
      else delete i.expiresAt;
    }
    await this.save();
    return this.list();
  }

  /** How to play a finished download from the disk, with where it got to. */
  async localCopy(req: PlaybackRequest): Promise<(PlaybackInfo & { downloadId: string }) | null> {
    const item = this.items.find((i) => i.status === "done" && keyOf(i.req) === keyOf(req));
    if (!item?.file || !item.info) return null;
    const file = path.join(this.dir, item.file);
    if (!(await stat(file).catch(() => null))) {
      this.log(`The download of ${item.name} has gone from the disk`);
      this.items = this.items.filter((i) => i !== item);
      await this.save();
      return null;
    }
    this.lastPlayed.set(item.id, Date.now());
    const art = item.art ? await this.artwork(item.id, item.art) : undefined;
    return {
      ...item.info,
      url: file,
      startMs: item.positionMs ?? item.info.startMs ?? 0,
      externalSubtitles: (item.subtitles ?? []).map((s) => ({ url: path.join(this.dir, s.file), lang: s.lang, label: s.label })),
      source: { kind: item.info.source?.kind ?? "nas", label: "Downloaded" },
      ...(art ? { artwork: art } : {}),
      downloadId: item.id,
    };
  }

  async position(id: string, positionMs: number, durationMs?: number): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.lastPlayed.set(id, Date.now());
    const duration = durationMs ?? item.durationMs ?? item.info?.durationMs;
    if (duration) item.durationMs = duration;
    const finished = duration ? positionMs / duration > 0.92 : false;
    item.positionMs = finished ? 0 : Math.max(0, Math.round(positionMs));
    if (finished && !item.watchedAt) {
      item.watchedAt = Date.now();
      const at = expiryOf(item, this.settings);
      if (at) item.expiresAt = at;
      this.log(`Watched the download of ${item.name}${this.settings.deleteWatched ? ": it goes in a day" : ""}`);
    }
    await this.save();
  }

  /** Deletes what's past its time, unless it's playing (or was a few minutes ago). */
  async expire(now = Date.now()): Promise<void> {
    const gone = this.items.filter((i) => i.status === "done" && i.expiresAt && i.expiresAt <= now && now - (this.lastPlayed.get(i.id) ?? 0) > 10 * 60_000);
    if (!gone.length) return;
    this.items = this.items.filter((i) => !gone.includes(i));
    for (const i of gone) {
      await this.deleteFiles(i);
      this.log(`Deleted the download of ${i.name}: its time was up`);
    }
    await this.save();
  }

  private async deleteFiles(item: Stored): Promise<void> {
    this.artCache.delete(item.id);
    const files = [item.file, `${item.id}.part`, item.art?.file, ...(item.subtitles ?? []).map((s) => s.file)].filter((f): f is string => Boolean(f));
    for (const f of files) await rm(path.join(this.dir, f), { force: true }).catch(() => undefined);
  }

  private save(): Promise<void> {
    const index: Index = { items: this.items, settings: this.settings };
    this.saving = this.saving.then(async () => {
      const tmp = `${this.indexFile}.tmp`;
      await writeFile(tmp, JSON.stringify(index));
      await rename(tmp, this.indexFile);
    }).catch((e: Error) => this.log(`Couldn't save the download list: ${e.message}`));
    this.changed();
    return this.saving;
  }

  /** Tells the TV, at most twice a second while a download runs. */
  private changed(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      void this.list().then((d) => {
        for (const l of this.listeners) l(d);
      });
    }, 500);
  }

  /** Starts the next download when nothing is downloading. */
  private kick(): void {
    if (this.current) return;
    clearTimeout(this.wake);
    const now = Date.now();
    const next = this.items.find((i) => i.status === "queued" && (!i.retryAt || i.retryAt <= now));
    if (!next) {
      const later = this.items.filter((i) => i.status === "queued" && i.retryAt).map((i) => i.retryAt!);
      if (later.length) this.wake = setTimeout(() => this.kick(), Math.max(1000, Math.min(...later) - now));
      return;
    }
    const abort = new AbortController();
    this.current = { id: next.id, abort };
    void this.run(next, abort.signal)
      .catch(async (e: Error) => {
        if (abort.signal.aborted || !this.items.includes(next)) return;
        if (e instanceof Waiting) {
          // The IPTV connection is busy (someone's watching, or a recording): try again shortly.
          next.status = "queued";
          next.error = e.message;
          next.retryAt = Date.now() + 2 * 60_000;
        } else {
          next.tries = (next.tries ?? 0) + 1;
          next.error = e.message;
          if (next.tries < RETRIES && !(e instanceof Full)) {
            next.status = "queued";
            next.retryAt = Date.now() + next.tries * 60_000;
          } else {
            next.status = "failed";
          }
          this.log(`Download of ${next.name} failed (${next.tries}): ${e.message}`);
        }
        delete next.speedBps;
        await this.save();
      })
      .finally(() => {
        this.current = null;
        this.kick();
      });
  }

  private async free(): Promise<number> {
    const fs = await statfs(this.dir);
    return fs.bavail * fs.bsize;
  }

  private async hub(pathname: string, body: unknown): Promise<PlaybackInfo> {
    const r = await this.fetchImpl(`${this.hubUrl}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    const d = (await r.json().catch(() => ({}))) as PlaybackInfo & { error?: string; code?: string };
    if (r.status === 409 || d.code === "busy") throw new Waiting(d.error ?? "Waiting for the IPTV connection");
    if (!r.ok) throw new Error(d.error ?? `The Hub answered ${r.status}`);
    return d;
  }

  private async run(item: Stored, signal: AbortSignal): Promise<void> {
    item.status = "downloading";
    delete item.error;
    await this.save();
    const info = await this.hub("/api/offline", item.req);
    if (info.hls) throw new Error("Only a streamed copy is on offer for this one");
    if (signal.aborted) return;
    const { url, headers, ...rest } = info;
    item.info = rest;
    if (info.durationMs) item.durationMs = info.durationMs;
    if (item.positionMs === undefined && info.startMs) item.positionMs = info.startMs;
    const abs = (u: string) => (u.startsWith("/") ? this.hubUrl + u : u);

    // The picture and subtitles first: small, and the list shows the picture straight away.
    const image = item.image ?? item.title?.poster ?? info.artwork;
    if (image && !item.art && !image.startsWith("data:")) {
      try {
        const r = await this.fetchImpl(abs(image), { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
        const data = Buffer.from(await r.arrayBuffer());
        if (r.ok && data.length < 3 * 1024 * 1024) {
          await writeFile(path.join(this.dir, `${item.id}.art`), data);
          item.art = { file: `${item.id}.art`, type: r.headers.get("content-type")?.split(";")[0] || "image/jpeg" };
        }
      } catch {
        // No picture; it still plays.
      }
    }
    item.subtitles = [];
    for (const [n, s] of info.externalSubtitles.entries()) {
      try {
        const r = await this.fetchImpl(abs(s.url), { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
        if (!r.ok) continue;
        const file = `${item.id}.sub${n}.${subtitleExtension(s.url)}`;
        await writeFile(path.join(this.dir, file), Buffer.from(await r.arrayBuffer()));
        item.subtitles.push({ file, lang: s.lang, label: s.label });
      } catch {
        // Subtitles are a nice-to-have.
      }
    }

    // The video, from where an earlier try got to.
    const part = path.join(this.dir, `${item.id}.part`);
    const have = (await stat(part).catch(() => null))?.size ?? 0;
    const res = await this.fetchImpl(abs(url), { headers: { ...headers, ...(have ? { Range: `bytes=${have}-` } : {}) }, signal, redirect: "follow" });
    if (res.status === 409) throw new Waiting("Waiting for the IPTV connection");
    if (res.status === 416 && have) {
      // Already all here.
    } else if (!res.ok || !res.body) {
      throw new Error(`The source answered ${res.status}`);
    }
    const resumed = res.status === 206;
    const start = resumed ? have : 0;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (res.status !== 416) {
      item.bytesDone = start;
      if (length) item.bytesTotal = start + length;
      const free = await this.free();
      if (length && length > free - RESERVE_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        throw new Full(`Not enough room on the box: it needs ${gb(length)} and ${gb(Math.max(0, free - RESERVE_BYTES))} is free`);
      }
      await this.save();
      let lastAt = Date.now();
      let lastBytes = item.bytesDone;
      let checkAt = item.bytesDone + 512 * 1024 ** 2;
      const count = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          item.bytesDone += chunk.length;
          const now = Date.now();
          if (now - lastAt >= 1000) {
            item.speedBps = Math.round(((item.bytesDone - lastBytes) * 1000) / (now - lastAt));
            lastAt = now;
            lastBytes = item.bytesDone;
            this.changed();
          }
          if (item.bytesDone < checkAt) return cb(null, chunk);
          // Size unknown up front (or the disk filling from elsewhere): stop before it's full.
          checkAt = item.bytesDone + 512 * 1024 ** 2;
          void this.free().then(
            (free) => cb(free < RESERVE_BYTES ? new Full(`The box's disk is nearly full: ${gb(free)} left`) : null, chunk),
            () => cb(null, chunk),
          );
        },
      });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, createWriteStream(part, { flags: resumed ? "a" : "w" }), { signal });
    }
    const size = (await stat(part)).size;
    if (item.bytesTotal && size < item.bytesTotal) throw new Error(`Stopped at ${Math.round((size / item.bytesTotal) * 100)}%`);
    const file = `${item.id}.${extensionOf(res.url || url, res.headers.get("content-disposition"), res.headers.get("content-type"))}`;
    await rename(part, path.join(this.dir, file));
    Object.assign(item, { file, status: "done", bytesDone: size, bytesTotal: size, doneAt: Date.now(), tries: 0 });
    delete item.speedBps;
    delete item.retryAt;
    const at = expiryOf(item, this.settings);
    if (at) item.expiresAt = at;
    this.log(`Downloaded ${item.name} (${gb(size)})`);
    await this.save();
  }
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
