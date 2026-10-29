// Downloads to the NAS: TorBox/AIOStreams links or magnets, saved with Jellyfin naming, resumable,
// then announced to Jellyfin. Also tidies the Inbox share (files dropped in over SMB/SFTP).

import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Download, TitleKind } from "@ultimatetv/shared";
import { safeFileName } from "@ultimatetv/shared";
import type { Db } from "../db.js";
import { newId } from "../db.js";
import type { EventBus } from "../events.js";
import { HttpError, redactUrl, type Fetch } from "../http.js";
import type { Logger } from "../log.js";
import type { SettingsStore } from "../settings.js";
import { magnetFor, type TorboxClient } from "./torbox.js";

export interface DownloadRequest {
  title: string;
  kind: TitleKind;
  year?: number;
  season?: number;
  episode?: number;
  episodeName?: string;
  /** A direct link (AIOStreams/TorBox playback URL) … */
  url?: string;
  headers?: Record<string, string>;
  /** … or a torrent to add to TorBox first. */
  infoHash?: string;
  fileName?: string;
}

interface StoredDownload extends Download {
  request: DownloadRequest;
  torboxId?: number;
}

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|ts|m2ts|webm)$/i;

/** Jellyfin's expected layout for films and episodes. */
export function libraryPath(roots: { moviesPath: string; tvPath: string }, r: Pick<DownloadRequest, "title" | "kind" | "year" | "season" | "episode" | "episodeName">, ext: string): string {
  const title = safeFileName(r.title) || "Untitled";
  const named = r.year ? `${title} (${r.year})` : title;
  if (r.kind === "movie") return path.join(roots.moviesPath, named, `${named}.${ext}`);
  const s = String(r.season ?? 1).padStart(2, "0");
  const e = String(r.episode ?? 1).padStart(2, "0");
  const ep = r.episodeName ? ` - ${safeFileName(r.episodeName)}` : "";
  return path.join(roots.tvPath, named, `Season ${s}`, `${title} - S${s}E${e}${ep}.${ext}`);
}

export function extensionFrom(...names: (string | undefined | null)[]): string {
  for (const n of names) {
    const m = n ? /\.(mkv|mp4|m4v|avi|ts|m2ts|webm)(?:$|[?#"])/i.exec(n) : null;
    if (m?.[1]) return m[1].toLowerCase();
  }
  return "mkv";
}

/** Reads title, year and episode numbers from a release file name. */
export function parseReleaseName(fileName: string): { title: string; year?: number; season?: number; episode?: number; kind: TitleKind } {
  const base = fileName.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[._]+/g, " ");
  const se = /\bS(\d{1,2}) ?E(\d{1,3})\b/i.exec(base) ?? /\b(\d{1,2})x(\d{2})\b/.exec(base);
  if (se) {
    const title = base.slice(0, se.index).replace(/[\s\-([]+$/, "").trim();
    const yearM = /\b(19\d{2}|20\d{2})\b\s*$/.exec(title);
    const result: ReturnType<typeof parseReleaseName> = { title: yearM ? title.slice(0, yearM.index).trim() : title, season: Number(se[1]), episode: Number(se[2]), kind: "series" };
    if (yearM?.[1]) result.year = Number(yearM[1]);
    return result;
  }
  const year = /[\s(\[]((?:19|20)\d{2})[\s)\]]/.exec(` ${base} `);
  if (year?.[1]) {
    const title = ` ${base} `.slice(0, year.index).trim();
    return { title: title || base.trim(), year: Number(year[1]), kind: "movie" };
  }
  const cut = /\b(2160p|1080p|720p|480p|bluray|web-?dl|webrip|hdtv|remux|x264|x265|hevc)\b/i.exec(base);
  return { title: (cut ? base.slice(0, cut.index) : base).trim(), kind: "movie" };
}

export class DownloadManager {
  private running = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private settings: SettingsStore,
    private events: EventBus,
    private log: Logger,
    private torbox: () => TorboxClient | null,
    /** Tells Jellyfin, and says what it made of the files. */
    private onLibraryChanged: (paths: string[]) => Promise<Download["jellyfin"]> | void,
    private fetchImpl: Fetch = fetch,
    private maxParallel = 2,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.pump(), 5_000);
    // Downloads interrupted by a restart carry on where they stopped.
    for (const d of this.all()) if (d.status === "downloading" || d.status === "moving") this.save({ ...d, status: "queued" });
    void this.pump();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const a of this.running.values()) a.abort();
  }

  all(): StoredDownload[] {
    return this.db.json<StoredDownload>("SELECT data FROM downloads ORDER BY created_at DESC");
  }

  list(): Download[] {
    return this.all().map(({ request: _r, torboxId: _t, ...d }) => d);
  }

  get(id: string): StoredDownload | undefined {
    return this.db.jsonOne<StoredDownload>("SELECT data FROM downloads WHERE id = ?", id);
  }

  private save(d: StoredDownload): StoredDownload {
    this.db.run("INSERT INTO downloads (id, status, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data", d.id, d.status, d.createdAt, JSON.stringify(d));
    const { request: _r, torboxId: _t, ...pub } = d;
    this.events.emit({ type: "downloads.changed", download: pub });
    return d;
  }

  add(request: DownloadRequest): Download {
    if (!request.url && !request.infoHash) throw new Error("Nothing to download");
    // Pressing Save twice (on the TV and then the phone, say) keeps one copy.
    const same = this.all().find(
      (d) => d.status !== "failed" && d.status !== "cancelled" && d.kind === request.kind && d.title === request.title && d.year === request.year && d.season === request.season && d.episode === request.episode,
    );
    if (same) {
      const { request: _r, torboxId: _t, ...pub } = same;
      return pub;
    }
    const d: StoredDownload = {
      id: newId("d"),
      title: request.title,
      kind: request.kind,
      status: "queued",
      progress: 0,
      bytesDone: 0,
      createdAt: Date.now(),
      request,
    };
    if (request.year) d.year = request.year;
    if (request.season !== undefined) d.season = request.season;
    if (request.episode !== undefined) d.episode = request.episode;
    this.save(d);
    void this.pump();
    const { request: _r, ...pub } = d;
    return pub;
  }

  cancel(id: string): void {
    const d = this.get(id);
    if (!d) return;
    this.running.get(id)?.abort();
    this.save({ ...d, status: "cancelled" });
  }

  remove(id: string): void {
    this.cancel(id);
    this.db.run("DELETE FROM downloads WHERE id = ?", id);
  }

  private async pump(): Promise<void> {
    if (this.running.size >= this.maxParallel) return;
    const next = this.all()
      .reverse()
      .find((d) => (d.status === "queued" || d.status === "waiting-debrid") && !this.running.has(d.id));
    if (!next) return;
    const abort = new AbortController();
    this.running.set(next.id, abort);
    try {
      await this.run(next, abort.signal);
    } catch (err) {
      if (!abort.signal.aborted) {
        this.log.warn({ id: next.id, err: String(err) }, "Download failed");
        const d = this.get(next.id);
        if (d) this.save({ ...d, status: "failed", error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      this.running.delete(next.id);
    }
    void this.pump();
  }

  private async run(d: StoredDownload, signal: AbortSignal): Promise<void> {
    let url = d.request.url;
    let fileName = d.request.fileName;
    if (!url && d.request.infoHash) {
      const tb = this.torbox();
      if (!tb) throw new Error("Add a TorBox API key to download torrents");
      let id = d.torboxId;
      if (id === undefined) {
        id = await tb.addMagnet(magnetFor(d.request.infoHash, d.title));
        d = this.save({ ...d, torboxId: id, status: "waiting-debrid" });
      }
      const t = await tb.torrent(id);
      if (!t.download_finished) {
        // TorBox is still fetching it; check again on the next pump.
        this.save({ ...d, status: "waiting-debrid", progress: Math.min(0.99, t.progress) * 0.5 });
        return;
      }
      const link = await tb.downloadLink(t);
      url = link.url;
      fileName ??= link.name;
    }
    if (!url) throw new Error("No download link");

    const s = this.settings.get().library;
    const target = libraryPath(s, d.request, extensionFrom(fileName, url));
    const part = `${target}.part`;
    await mkdir(path.dirname(target), { recursive: true });
    const have = await stat(part).then((x) => x.size).catch(() => 0);

    const headers: Record<string, string> = { "User-Agent": "UltimateTV/1.0", ...d.request.headers };
    if (have > 0) headers.Range = `bytes=${have}-`;
    const res = await this.fetchImpl(url, { headers, signal, redirect: "follow" });
    if (!res.ok || !res.body) throw new HttpError(res.status, redactUrl(url));
    const resumed = res.status === 206;
    const length = Number(res.headers.get("content-length") ?? 0);
    const total = length ? length + (resumed ? have : 0) : undefined;
    let done = resumed ? have : 0;
    let last = 0;
    let lastBytes = done;
    d = this.save({ ...d, status: "downloading", bytesDone: done, ...(total ? { bytesTotal: total } : {}), path: target });

    const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (chunk: Buffer) => {
      done += chunk.length;
      const t = Date.now();
      if (t - last > 1000) {
        const speed = ((done - lastBytes) * 1000) / Math.max(1, t - last);
        last = t;
        lastBytes = done;
        d = this.save({ ...d, bytesDone: done, progress: total ? done / total : 0, speedBps: Math.round(speed) });
      }
    });
    await pipeline(body, createWriteStream(part, { flags: resumed ? "a" : "w" }), { signal });

    d = this.save({ ...d, status: "moving", bytesDone: done, progress: 1 });
    await rename(part, target);
    d = this.save({ ...d, status: "completed", path: target, progress: 1 });
    const jellyfin = await Promise.resolve(this.onLibraryChanged([target])).catch((err: unknown) => ({ added: false, note: `Jellyfin didn't take it: ${err instanceof Error ? err.message : String(err)}` }));
    if (jellyfin) this.save({ ...d, jellyfin });
  }

  /** Moves finished files from the Inbox share into the library with Jellyfin naming. */
  async tidyInbox(now = Date.now()): Promise<string[]> {
    const s = this.settings.get().library;
    const moved: string[] = [];
    let entries: string[];
    try {
      entries = await readdir(s.inboxPath, { recursive: true });
    } catch {
      return moved;
    }
    for (const rel of entries) {
      if (!VIDEO_EXT.test(rel) || /sample/i.test(rel)) continue;
      const full = path.join(s.inboxPath, rel);
      const info = await stat(full).catch(() => null);
      // Skip files still being copied in.
      if (!info?.isFile() || now - info.mtimeMs < 2 * 60_000) continue;
      const parsed = parseReleaseName(path.basename(rel));
      const target = libraryPath(s, parsed, extensionFrom(rel));
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await rename(full, target).catch(async () => {
          const { copyFile } = await import("node:fs/promises");
          await copyFile(full, target);
          await rm(full);
        });
        moved.push(target);
      } catch (err) {
        this.log.warn({ file: rel, err: String(err) }, "Couldn't move an Inbox file");
      }
    }
    if (moved.length) void Promise.resolve(this.onLibraryChanged(moved)).catch(() => undefined);
    return moved;
  }
}
