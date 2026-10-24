// Records live channels (from the relay) and catch-up programmes (downloaded after they air) to
// the NAS, then remuxes to MKV, writes an NFO and asks Jellyfin to rescan.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Recording } from "@ultimatetv/shared";
import { catchupUrl, type CatchupContext } from "./catchup.js";
import type { ChannelStore } from "./channels.js";
import { ConnectionBusyError, type ConnectionGuard } from "./connections.js";
import type { EventBus } from "./events.js";
import { fetchOk, IPTV_USER_AGENT, redactUrl, type Fetch } from "./http.js";
import type { Logger } from "./log.js";
import { nfoFor, recordingPath, type RecordingStore } from "./recordings.js";
import type { LiveRelay } from "./relay.js";
import type { SettingsStore } from "./settings.js";

export type Remux = (input: string, output: string) => Promise<void>;

/** TS → MKV without re-encoding. Teletext and data streams are dropped (MKV can't hold them). */
export const ffmpegRemux: Remux = (input, output) =>
  new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts+discardcorrupt", "-i", input, "-map", "0:v?", "-map", "0:a?", "-map", "0:s?", "-c", "copy", "-dn", "-ignore_unknown", output], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => (err += String(d)));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))));
  });

export interface RecorderDeps {
  store: RecordingStore;
  channels: ChannelStore;
  relay: LiveRelay;
  guard: ConnectionGuard;
  settings: SettingsStore;
  events: EventBus;
  log: Logger;
  catchup: CatchupContext;
  tmpDir: string;
  remux?: Remux;
  fetchImpl?: Fetch;
  onLibraryChanged?: (path: string) => void;
  now?: () => number;
}

const MIN_BYTES = 256 * 1024;

export class Recorder {
  private active = new Map<string, { stop: (reason: string) => void }>();

  constructor(private d: RecorderDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  activeIds(): string[] {
    return [...this.active.keys()];
  }

  stop(id: string, reason = "stopped"): void {
    this.active.get(id)?.stop(reason);
  }

  private update(r: Recording, patch: Partial<Recording>): Recording {
    const next = { ...r, ...patch };
    this.d.store.save(next);
    this.d.events.emit({ type: "recordings.changed" });
    return next;
  }

  /** Records a channel live until the recording window ends, reconnecting if the stream drops. */
  async recordLive(rec: Recording): Promise<void> {
    if (this.active.has(rec.id)) return;
    const tmp = path.join(this.d.tmpDir, `${rec.id}.ts`);
    await mkdir(this.d.tmpDir, { recursive: true });
    let r = this.update(rec, { status: "recording", error: undefined });
    this.d.events.emit({ type: "recording.started", recording: r });

    let stopped: string | null = null;
    let current: { close(): void } | null = null;
    this.active.set(rec.id, {
      stop: (reason) => {
        stopped = reason;
        current?.close();
      },
    });

    const out = createWriteStream(tmp, { flags: "a" });
    let gaps = 0;
    try {
      while (!stopped && this.now() < r.end) {
        let consumer;
        try {
          consumer = this.d.relay.subscribe(r.channelId, `recording:${r.id}`, "record");
        } catch (err) {
          if (err instanceof ConnectionBusyError) {
            r = this.update(r, { error: err.message });
          }
          gaps++;
          await sleep(10_000);
          continue;
        }
        current = consumer;
        const timer = setTimeout(() => consumer.close(), Math.max(0, r.end - this.now()));
        consumer.stream.on("data", (chunk: Buffer) => out.write(chunk));
        const reason = await consumer.ended;
        clearTimeout(timer);
        current = null;
        if (reason?.startsWith("switched")) {
          stopped = "The recording was stopped when the TV changed channel";
        } else if (reason) {
          gaps++;
          await sleep(5_000);
        }
      }
    } finally {
      this.active.delete(rec.id);
      await new Promise<void>((res) => out.end(res));
    }
    const incomplete = gaps > 0 || Boolean(stopped && stopped !== "stopped") || this.now() < r.end - 60_000;
    await this.finish(this.update(r, { incomplete, ...(stopped && stopped !== "stopped" ? { error: stopped } : {}) }), tmp);
  }

  /** Downloads a programme from catch-up. Returns false if the connection was needed elsewhere (retry later). */
  async recordCatchup(rec: Recording): Promise<boolean> {
    if (this.active.has(rec.id)) return true;
    const feeds = this.d.channels.feeds(rec.channelId);
    const url = catchupUrl(feeds, rec.start, rec.end, this.d.catchup, this.now());
    if (!url) {
      this.update(rec, { status: "failed", error: "Catch-up isn't available for this channel any more" });
      return true;
    }
    const key = `catchup-rec:${rec.id}`;
    const abort = new AbortController();
    try {
      this.d.guard.acquire({ key, holder: `recording:${rec.id}`, kind: "background", label: `Fetching ${rec.programme.title} from catch-up`, onRevoke: () => abort.abort() });
    } catch {
      return false;
    }
    const tmp = path.join(this.d.tmpDir, `${rec.id}.ts`);
    await mkdir(this.d.tmpDir, { recursive: true });
    let r = this.update(rec, { status: "recording", error: undefined });
    this.active.set(rec.id, { stop: () => abort.abort() });
    try {
      const res = await fetchOk(url, this.d.fetchImpl ?? fetch, { signal: abort.signal, headers: { "User-Agent": IPTV_USER_AGENT } }, 6 * 3_600_000);
      if (!res.body) throw new Error("empty response");
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(tmp));
    } catch (err) {
      this.active.delete(rec.id);
      this.d.guard.release(key, `recording:${rec.id}`);
      await rm(tmp, { force: true });
      if (abort.signal.aborted) {
        // Someone started watching; try again when the connection is free.
        this.update(r, { status: "waiting-catchup" });
        return false;
      }
      this.d.log.warn({ id: rec.id, url: redactUrl(url), err: String(err) }, "Catch-up download failed");
      this.update(r, { status: "failed", error: "Catch-up download failed" });
      return true;
    }
    this.active.delete(rec.id);
    this.d.guard.release(key, `recording:${rec.id}`);
    r = this.update(r, { incomplete: false });
    await this.finish(r, tmp);
    return true;
  }

  private async finish(rec: Recording, tmp: string): Promise<void> {
    let r = this.update(rec, { status: "processing" });
    const size = await stat(tmp).then((s) => s.size).catch(() => 0);
    if (size < MIN_BYTES) {
      await rm(tmp, { force: true });
      this.update(r, { status: "failed", error: r.error ?? "Nothing was recorded" });
      this.d.events.emit({ type: "recording.finished", recording: { ...r, status: "failed" } });
      return;
    }
    const settings = this.d.settings.get();
    const target = recordingPath(settings.library.recordingsPath, r.programme);
    try {
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await (this.d.remux ?? ffmpegRemux)(tmp, target);
        await rm(tmp, { force: true });
      } catch (err) {
        // Keep the TS if remuxing fails: Jellyfin and mpv play it fine.
        this.d.log.warn({ id: r.id, err: String(err) }, "Remux failed, keeping the TS file");
        const tsTarget = target.replace(/\.mkv$/, ".ts");
        await moveFile(tmp, tsTarget);
        r = { ...r, path: tsTarget };
      }
      const finalPath = r.path ?? target;
      await writeFile(finalPath.replace(/\.(mkv|ts)$/, ".nfo"), nfoFor(r.programme, r.channelName));
      const sizeBytes = await stat(finalPath).then((s) => s.size).catch(() => size);
      r = this.update(r, { status: "completed", path: finalPath, sizeBytes });
      this.d.events.emit({ type: "recording.finished", recording: r });
      this.d.onLibraryChanged?.(finalPath);
    } catch (err) {
      this.d.log.error({ id: r.id, err: String(err) }, "Saving the recording failed");
      this.update(r, { status: "failed", error: `Couldn't save to the NAS: ${String(err)}` });
    }
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch {
    // Different file systems (local temp → NAS): copy then delete.
    const { copyFile } = await import("node:fs/promises");
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

