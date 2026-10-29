// Spotify on the box: go-librespot runs as a Spotify Connect receiver for the tv user (see
// tools/box/install.sh) and plays through PipeWire to the TV. Phones see it by the app's name in
// Spotify's device list; the Music tab drives it through its local API
// (https://github.com/devgianlu/go-librespot/blob/master/api-spec.yml).
//
// Signing in: by default the receiver waits for a phone on the Wi-Fi to pick it in the Spotify
// app (Spotify Connect's own sign-in, "zeroconf"), and keeps that account for next time. Instead
// it can show a code to enter at spotify.com/pair ("device_auth"); then it can't be seen by phones
// until someone has signed in (go-librespot only advertises itself after a sign-in, and doesn't
// answer its API while it waits with both on), so the box turns phones back on straight after.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MusicItem, MusicPage, MusicTracks, SpotifyCommand, SpotifySetup, SpotifySignIn, SpotifyState } from "@ultimatetv/shared";

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

const SERVICE = "ultimatetv-spotify.service";
const CONFIG = path.join(os.homedir(), ".config/go-librespot/config.yml");

/** How the receiver's config has it sign in. */
export function signInOf(config: string): SpotifySignIn {
  return /^credentials:[^\n]*\n(?:[ \t]+[^\n]*\n)*?[ \t]+type:[ \t]*["']?device_auth/m.test(config) ? "code" : "phone";
}

/** The receiver's config with its sign-in set to `mode` (see the top of this file). */
export function withSignIn(config: string, mode: SpotifySignIn): string {
  const block = mode === "code" ? "credentials:\n  type: device_auth\n" : "credentials:\n  type: zeroconf\n  zeroconf:\n    persist_credentials: true\n";
  const zeroconf = `zeroconf_enabled: ${mode === "phone"}`;
  let out = /^credentials:/m.test(config) ? config.replace(/^credentials:[^\n]*\n?(?:[ \t]+[^\n]*(?:\n|$))*/m, block) : `${config.replace(/\n?$/, "\n")}${block}`;
  out = /^zeroconf_enabled:/m.test(out) ? out.replace(/^zeroconf_enabled:.*$/m, zeroconf) : `${zeroconf}\n${out}`;
  return out;
}

/** The last thing the receiver logged that says what's wrong, shortened for the TV. */
export function lastProblem(journal: string): string | undefined {
  const lines = journal.split("\n").map((l) => l.trim()).filter(Boolean);
  const bad = [...lines].reverse().find((l) => /level=(error|fatal)|error|failed|fatal|panic|could not/i.test(l)) ?? lines.at(-1);
  if (!bad) return undefined;
  const msg = /msg="((?:[^"\\]|\\.)*)"/.exec(bad)?.[1] ?? bad;
  const err = /error="((?:[^"\\]|\\.)*)"/.exec(bad)?.[1];
  const text = (err && !msg.includes(err) ? `${msg}: ${err}` : msg).replace(/\\"/g, '"');
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

interface SpotifyOptions {
  /** go-librespot's config file. */
  config?: string;
  /** The receiver's program: whether it's there says installed or not. */
  bin?: string;
  /** Runs systemctl and journalctl (tests replace it). */
  exec?: (cmd: string, args: string[]) => Promise<string>;
}

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
  private downSince = 0;
  private problemCheckedAt = 0;
  private problem: string | undefined;
  private readonly config: string;
  private readonly bin: string;
  private readonly exec: (cmd: string, args: string[]) => Promise<string>;

  constructor(
    private readonly base: string,
    private readonly log: Log,
    options: SpotifyOptions = {},
  ) {
    this.config = options.config ?? CONFIG;
    this.bin = options.bin ?? "/usr/local/bin/go-librespot";
    this.exec = options.exec ?? (async (cmd, args) => (await run(cmd, args, { timeout: 10_000 })).stdout);
  }

  start(): void {
    void this.repairConfig().finally(() => void this.refresh());
  }

  /**
   * Boxes set up before this had a code sign-in with phones on, which leaves the receiver unable
   * to answer until someone signs in, and showing no code: back to signing in from a phone.
   */
  private async repairConfig(): Promise<void> {
    const text = await readFile(this.config, "utf8").catch(() => null);
    if (text === null || signInOf(text) !== "code" || !/^zeroconf_enabled:[ \t]*true/m.test(text)) return;
    await writeFile(this.config, withSignIn(text, "phone"));
    await this.exec("systemctl", ["--user", "restart", SERVICE]).catch(() => undefined);
    this.log("Spotify now signs in from a phone (it was stuck waiting for a code)");
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

  private async request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 8000): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
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
    const signIn = await this.signIn();
    let next: SpotifyState;
    // Answering at all, even late or with "busy", means the receiver is running.
    let running = false;
    let status: ApiStatus | null = null;
    try {
      const res = await this.request("GET", "/status", undefined, 5000);
      running = true;
      if (res.ok && res.status !== 204) status = (await res.json()) as ApiStatus;
    } catch (e) {
      // A timeout is a receiver busy signing in (older configs), not a missing one.
      if ((e as Error).name === "TimeoutError") running = true;
    }
    if (status) next = { ...toState(status, Date.now()), installed: true, signIn };
    else {
      // Not signed in. /auth/code answers straight away even while /status can't.
      const code = await this.request("GET", "/auth/code", undefined, 3000)
        .then(async (res) => {
          running = true;
          return res.status === 200 ? ((await res.json()) as { url: string; code: string; expires_at?: string }) : null;
        })
        .catch(() => null);
      if (running) next = { ...OFFLINE, available: true, installed: true, signIn, at: Date.now(), ...(code ? { pair: { url: code.url, code: code.code, ...(code.expires_at ? { expiresAt: code.expires_at } : {}) } } : {}) };
      else next = await this.offline(signIn);
    }
    if (running) {
      this.downSince = 0;
      this.problem = undefined;
      this.connect();
    }
    this.emit(next);
    if (!this.stopped) this.timer = setTimeout(() => void this.refresh(), next.signedIn && this.socket ? 15_000 : 5_000);
    return next;
  }

  private async signIn(): Promise<SpotifySignIn> {
    const text = await readFile(this.config, "utf8").catch(() => "");
    return signInOf(text);
  }

  /** Not answering: not installed, starting (it restarts itself), or broken, with its log's say. */
  private async offline(signIn: SpotifySignIn): Promise<SpotifyState> {
    const installed = existsSync(this.bin);
    if (!installed) return { ...OFFLINE, installed: false };
    const now = Date.now();
    if (!this.downSince) this.downSince = now;
    // Give it time to start (systemd restarts it 10 s after it stops), then look at its log.
    if (now - this.downSince > 25_000 && now - this.problemCheckedAt > 30_000) {
      this.problemCheckedAt = now;
      const journal = await this.exec("journalctl", ["--user", "-u", SERVICE, "-n", "30", "--no-pager", "-o", "cat"]).catch(() => "");
      const active = (await this.exec("systemctl", ["--user", "is-active", SERVICE]).catch((e: { stdout?: string }) => e.stdout ?? "")).trim();
      const problem = lastProblem(journal) ?? (active && active !== "active" && active !== "activating" ? `The Spotify service is ${active}` : undefined);
      if (problem !== this.problem && problem) this.log(`Spotify receiver: ${problem}`);
      this.problem = problem;
    }
    return { ...OFFLINE, installed: true, signIn, ...(this.problem ? { problem: this.problem } : {}) };
  }

  /** Switches how Spotify signs in, or starts the receiver again; both restart it. */
  async setup(setup: SpotifySetup): Promise<SpotifyState> {
    if ("signIn" in setup) {
      const text = await readFile(this.config, "utf8").catch(() => null);
      if (text === null) throw new Error("Spotify isn't installed on this box. Update the box in Settings › About.");
      const next = withSignIn(text, setup.signIn);
      if (next !== text) await writeFile(this.config, next);
      this.log(`Spotify signs in ${setup.signIn === "code" ? "with a code" : "from a phone"} now`);
    }
    await this.exec("systemctl", ["--user", "restart", SERVICE]).catch((e: Error) => {
      throw new Error(`Couldn't restart Spotify: ${e.message}`);
    });
    this.downSince = Date.now();
    this.problem = undefined;
    this.problemCheckedAt = 0;
    this.socket?.close();
    this.socket = null;
    // It takes a moment to come back.
    await new Promise((r) => setTimeout(r, 1500));
    return this.refresh();
  }

  private emit(next: SpotifyState): void {
    if (next.available !== this.state.available) this.log(next.available ? "Spotify receiver is up" : next.installed === false ? "Spotify receiver isn't installed" : "Spotify receiver isn't answering");
    if (next.signedIn && !this.state.signedIn) {
      this.log("Spotify is signed in");
      // Signed in with a code: let phones see the TV again (the sign-in is kept).
      if (next.signIn === "code") void this.setup({ signIn: "phone" }).catch((e: Error) => this.log(e.message));
    }
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
export async function renameSpotifyDevice(name: string, log: Log, configFile = CONFIG): Promise<boolean> {
  const text = await readFile(configFile, "utf8").catch(() => null);
  if (text === null) return false;
  const line = `device_name: ${JSON.stringify(name)}`;
  const current = /^device_name:.*$/m.exec(text)?.[0];
  if (current === line || current === `device_name: ${name}`) return false;
  await writeFile(configFile, current ? text.replace(/^device_name:.*$/m, line) : `${line}\n${text}`);
  await run("systemctl", ["--user", "restart", SERVICE]).catch((e: Error) => log(`Couldn't restart Spotify after renaming it: ${e.message}`));
  log(`Spotify now shows the box as ${name}`);
  return true;
}
