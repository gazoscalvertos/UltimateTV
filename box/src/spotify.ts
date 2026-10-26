// Spotify on the box: go-librespot runs as a Spotify Connect receiver for the tv user (see
// tools/box/install.sh) and plays through PipeWire to the TV. Phones see it by the app's name in
// Spotify's device list; the Music tab drives it through its local API
// (https://github.com/devgianlu/go-librespot/blob/master/api-spec.yml).

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MusicItem, MusicPage, MusicTracks, SpotifyCommand, SpotifyState } from "@ultimatetv/shared";

const run = promisify(execFile);

type Log = (line: string) => void;

interface ApiTrack {
  uri: string;
  name: string;
  artist_names: string[];
  album_name: string;
  album_cover_url: string | null;
  position: number;
  duration: number;
}

interface ApiStatus {
  username: string;
  device_name: string;
  context_uri?: string;
  context_name?: string;
  stopped: boolean;
  paused: boolean;
  buffering: boolean;
  volume: number;
  volume_steps: number;
  repeat_context: boolean;
  repeat_track: boolean;
  shuffle_context: boolean;
  track: ApiTrack | null;
}

const OFFLINE: SpotifyState = { available: false, signedIn: false, status: "stopped", positionMs: 0, at: 0, volume: 0, shuffle: false, repeat: "off" };

export function toState(s: ApiStatus, at: number): SpotifyState {
  const state: SpotifyState = {
    available: true,
    signedIn: true,
    deviceName: s.device_name,
    username: s.username,
    status: s.stopped || !s.track ? "stopped" : s.buffering ? "buffering" : s.paused ? "paused" : "playing",
    positionMs: s.track?.position ?? 0,
    at,
    volume: s.volume_steps > 0 ? Math.round((s.volume / s.volume_steps) * 100) : 0,
    shuffle: s.shuffle_context,
    repeat: s.repeat_track ? "one" : s.repeat_context ? "all" : "off",
  };
  if (s.track) {
    state.track = { uri: s.track.uri, name: s.track.name, artists: s.track.artist_names ?? [], durationMs: s.track.duration };
    if (s.track.album_name) state.track.album = s.track.album_name;
    if (s.track.album_cover_url) state.track.cover = s.track.album_cover_url;
  }
  if (s.context_uri) state.context = { uri: s.context_uri, ...(s.context_name ? { name: s.context_name } : {}) };
  return state;
}

export class Spotify {
  private state: SpotifyState = OFFLINE;
  private listeners = new Set<(s: SpotifyState) => void>();
  private socket: WebSocket | null = null;
  private timer: NodeJS.Timeout | undefined;
  private refreshQueued: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly base: string,
    private readonly log: Log,
  ) {}

  start(): void {
    void this.refresh();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }

  current(): SpotifyState {
    return this.state;
  }

  onState(listener: (s: SpotifyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method,
      signal: AbortSignal.timeout(8000),
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
    });
  }

  private async json<T>(path: string): Promise<T | null> {
    const res = await this.request("GET", path);
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`Spotify answered ${res.status}`);
    return (await res.json()) as T;
  }

  /** Reads the receiver's status and keeps the event socket open; again every few seconds. */
  async refresh(): Promise<SpotifyState> {
    clearTimeout(this.timer);
    let next: SpotifyState;
    try {
      const status = await this.json<ApiStatus>("/status");
      if (status) next = toState(status, Date.now());
      else {
        // No session yet: the receiver waits for someone to sign in with the code it shows.
        const code = await this.json<{ url: string; code: string; expires_at?: string }>("/auth/code").catch(() => null);
        next = { ...OFFLINE, available: true, at: Date.now(), ...(code ? { pair: { url: code.url, code: code.code, ...(code.expires_at ? { expiresAt: code.expires_at } : {}) } } : {}) };
      }
      this.connect();
    } catch {
      next = OFFLINE;
    }
    this.emit(next);
    if (!this.stopped) this.timer = setTimeout(() => void this.refresh(), next.signedIn && this.socket ? 15_000 : 5_000);
    return next;
  }

  private emit(next: SpotifyState): void {
    if (next.available !== this.state.available) this.log(next.available ? "Spotify receiver is up" : "Spotify receiver isn't answering");
    if (next.signedIn && !this.state.signedIn) this.log("Spotify is signed in");
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /** Every player event means the status changed: read it again (once per burst). */
  private connect(): void {
    if (this.socket || this.stopped || typeof WebSocket !== "function") return;
    const ws = new WebSocket(`${this.base.replace(/^http/, "ws")}/events`);
    this.socket = ws;
    ws.addEventListener("message", () => {
      clearTimeout(this.refreshQueued);
      this.refreshQueued = setTimeout(() => void this.refresh(), 150);
    });
    // A failed socket also closes (closing it here again would only fail again).
    const gone = () => {
      if (this.socket === ws) this.socket = null;
    };
    ws.addEventListener("close", gone);
    ws.addEventListener("error", gone);
  }

  async library(kind: "playlists" | "albums" | "artists", offset: number): Promise<MusicPage> {
    const res = await this.request("GET", `/library/${kind}?offset=${Math.max(0, Math.floor(offset))}&limit=50`);
    // 404: a receiver from before the library API. 204: not signed in.
    if (res.status === 404 || res.status === 204) return { items: [], total: 0 };
    if (!res.ok) throw new Error(`Spotify answered ${res.status}`);
    const page = (await res.json()) as { total: number; items: Record<string, unknown>[] };
    return { total: page.total, items: page.items.map((i) => libraryItem(kind, i)) };
  }

  async tracks(uri: string): Promise<MusicTracks> {
    const res = await this.request("GET", `/context/tracks?uri=${encodeURIComponent(uri)}`);
    if (res.status === 404 || res.status === 204) return { ready: true, total: 0, items: [] };
    if (!res.ok) throw new Error(`Spotify answered ${res.status}`);
    const list = (await res.json()) as { ready: boolean; length: number; tracks: { uri: string; track: ApiTrack | null }[] | null };
    const items = (list.tracks ?? []).map(({ uri: trackUri, track }): MusicItem => {
      const item: MusicItem = { uri: trackUri, kind: "track", name: track?.name ?? "…" };
      if (track?.artist_names?.length) item.subtitle = track.artist_names.join(", ");
      if (track?.album_cover_url) item.image = track.album_cover_url;
      if (track?.duration) item.durationMs = track.duration;
      return item;
    });
    return { ready: list.ready, total: list.length, items };
  }

  private async post(path: string, body?: unknown): Promise<void> {
    const res = await this.request("POST", path, body ?? {});
    if (res.status === 204 && path.startsWith("/player/") && !this.state.signedIn) throw new Error("Spotify isn't signed in on the box yet");
    if (!res.ok && res.status !== 204) throw new Error(`Spotify answered ${res.status}`);
  }

  async play(uri: string, options: { skipTo?: string; shuffle?: boolean } = {}): Promise<void> {
    // Shuffle has to be set before play to start on a random song.
    if (options.shuffle !== undefined) await this.post("/player/shuffle_context", { shuffle_context: options.shuffle });
    await this.post("/player/play", { uri, ...(options.skipTo ? { skip_to_uri: options.skipTo } : {}) });
    void this.refresh();
  }

  async control(c: SpotifyCommand): Promise<void> {
    switch (c.cmd) {
      case "playPause":
        await this.post("/player/playpause");
        break;
      case "pause":
        if (this.state.status === "playing" || this.state.status === "buffering") await this.post("/player/pause");
        break;
      case "resume":
        await this.post("/player/resume");
        break;
      case "next":
        await this.post("/player/next");
        break;
      case "prev":
        await this.post("/player/prev");
        break;
      case "seek":
        await this.post("/player/seek", { position: Math.max(0, Math.round(c.ms)), relative: false });
        break;
      case "volume":
        // volume_steps is 100 in the box's config, so steps are percent.
        await this.post("/player/volume", { volume: Math.round(c.delta), relative: true });
        break;
      case "shuffle":
        await this.post("/player/shuffle_context", { shuffle_context: c.on });
        break;
      case "repeat":
        await this.post("/player/repeat_track", { repeat_track: c.mode === "one" });
        await this.post("/player/repeat_context", { repeat_context: c.mode !== "off" });
        break;
    }
    void this.refresh();
  }
}

export function libraryItem(kind: "playlists" | "albums" | "artists", i: Record<string, unknown>): MusicItem {
  const str = (k: string) => (typeof i[k] === "string" && i[k] ? (i[k] as string) : undefined);
  const item: MusicItem = { uri: String(i.uri), kind: kind === "playlists" ? "playlist" : kind === "albums" ? "album" : "artist", name: str("name") ?? "Untitled" };
  const image = str("image_url");
  if (image) item.image = image;
  if (kind === "playlists") {
    const n = typeof i.length === "number" ? i.length : undefined;
    const sub = [n !== undefined ? `${n} song${n === 1 ? "" : "s"}` : "", str("owner_username") === "spotify" ? "Spotify" : ""].filter(Boolean).join(" · ");
    if (sub) item.subtitle = sub;
  }
  if (kind === "albums") {
    const artists = Array.isArray(i.artist_names) ? (i.artist_names as string[]).join(", ") : "";
    const sub = [artists, typeof i.year === "number" && i.year ? String(i.year) : ""].filter(Boolean).join(" · ");
    if (sub) item.subtitle = sub;
  }
  return item;
}

/**
 * Renames the box in Spotify's device list by rewriting device_name in go-librespot's config and
 * restarting it (it reads the name only at start). Does nothing when the name is already right.
 */
export async function renameSpotifyDevice(name: string, log: Log, configFile = path.join(os.homedir(), ".config/go-librespot/config.yml")): Promise<boolean> {
  const text = await readFile(configFile, "utf8").catch(() => null);
  if (text === null) return false;
  const line = `device_name: ${JSON.stringify(name)}`;
  const current = /^device_name:.*$/m.exec(text)?.[0];
  if (current === line || current === `device_name: ${name}`) return false;
  await writeFile(configFile, current ? text.replace(/^device_name:.*$/m, line) : `${line}\n${text}`);
  await run("systemctl", ["--user", "restart", "ultimatetv-spotify.service"]).catch((e: Error) => log(`Couldn't restart Spotify after renaming it: ${e.message}`));
  log(`Spotify now shows the box as ${name}`);
  return true;
}
