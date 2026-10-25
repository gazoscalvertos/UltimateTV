// Music: Spotify (the box's Spotify Connect receiver) and Deezer (its web player, over the UI).
// On the box this is the box shell; in a browser against a demo Hub, a stand-in with made-up
// playlists so the screens can be seen; otherwise Spotify shows as not set up.

import { createSignal } from "solid-js";
import type { Action, MusicItem, MusicPage, MusicTracks, SpotifyCommand, SpotifyState, WebAppCommand, WebAppId, WebAppState } from "@ultimatetv/shared";
import { agent, agentHas, onBox } from "./agent";
import { hub } from "./api";

type Source = Pick<
  typeof agent,
  "spotify" | "spotifyLibrary" | "spotifyTracks" | "spotifyPlay" | "spotifyControl" | "onSpotify" | "openWebApp" | "closeWebApp" | "webAppKey" | "webAppText" | "webAppControl" | "webApp" | "onWebApp"
>;

const OFF: SpotifyState = { available: false, signedIn: false, status: "stopped", positionMs: 0, at: 0, volume: 0, shuffle: false, repeat: "off" };

/** No box, or a box shell from before music: nothing plays. */
class NoMusic implements Source {
  async spotify() {
    return OFF;
  }
  async spotifyLibrary(_kind: "playlists" | "albums" | "artists", _offset = 0): Promise<MusicPage> {
    return { items: [], total: 0 };
  }
  async spotifyTracks(_uri: string): Promise<MusicTracks> {
    return { ready: true, total: 0, items: [] };
  }
  async spotifyPlay(_uri: string, _options?: { skipTo?: string; shuffle?: boolean }): Promise<void> {
    throw new Error(onBox ? "Update the box to play music (Settings › About)" : "Music plays on the TV box");
  }
  async spotifyControl(_c: SpotifyCommand): Promise<void> {}
  onSpotify(_listener: (s: SpotifyState) => void): () => void {
    return () => undefined;
  }
  async openWebApp(): Promise<void> {
    throw new Error(onBox ? "Update the box to open Deezer (Settings › About)" : "Deezer opens on the TV box");
  }
  async closeWebApp() {}
  async webAppKey() {}
  async webAppText() {}
  async webAppControl() {}
  async webApp(): Promise<WebAppState> {
    return { open: false };
  }
  onWebApp() {
    return () => undefined;
  }
}

const cover = (seed: string) => `/api/art/cover/${seed}.svg`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const DEMO_PLAYLISTS: [string, number][] = [
  ["Friday Night House", 64],
  ["Clubland Classics", 120],
  ["Sunday Morning", 38],
  ["Halloween Party", 45],
  ["Road Trip", 87],
  ["Kitchen Disco", 52],
  ["Chill Evenings", 71],
];
const DEMO_ALBUMS: [string, string, number][] = [
  ["Northern Lights", "The Harbour Band", 2024],
  ["Neon Avenue", "Kira Vale", 2023],
  ["Copper Sky", "Atlas Grove", 2022],
  ["Lowlands", "Maple & Rye", 2025],
  ["After Hours", "Sundown Club", 2021],
];
const DEMO_ARTISTS = ["Kira Vale", "Atlas Grove", "Sundown Club", "Maple & Rye", "The Harbour Band", "Lumen"];
const DEMO_SONGS = ["Golden Hour", "Midnight Drive", "Fall Into You", "Electric Hearts", "Paper Planes", "Run to the Light", "Satellites", "Hold On Tonight", "Waves", "Never Let Go", "Starlight", "Tidal"];

function demoTracks(uri: string): MusicItem[] {
  const seed = [...uri].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: 12 }, (_, i) => {
    const name = DEMO_SONGS[(seed + i * 5) % DEMO_SONGS.length]!;
    const artist = DEMO_ARTISTS[(seed + i) % DEMO_ARTISTS.length]!;
    return { uri: `spotify:track:demo${slug(name)}${i}`, kind: "track", name, subtitle: artist, image: cover(slug(`${name} ${artist}`)), durationMs: 150_000 + ((seed + i * 37) % 120) * 1000 };
  });
}

/** Made-up Spotify for the demo Hub (development and screenshots). */
class DemoMusic extends NoMusic {
  private state: SpotifyState;
  private listeners = new Set<(s: SpotifyState) => void>();
  private queue: MusicItem[] = [];

  constructor() {
    super();
    // ?demo-music=pair shows Spotify waiting for someone to sign in.
    if (new URLSearchParams(location.search).get("demo-music") === "pair") {
      this.state = { ...OFF, available: true, deviceName: "UltimateTV", at: Date.now(), pair: { url: "https://www.spotify.com/pair", code: "KQ4F7T" } };
      return;
    }
    this.queue = demoTracks("spotify:playlist:friday-night-house");
    const t = this.queue[1]!;
    this.state = {
      available: true,
      signedIn: true,
      username: "demo",
      deviceName: "UltimateTV",
      status: "playing",
      positionMs: 72_000,
      at: Date.now(),
      volume: 70,
      shuffle: false,
      repeat: "off",
      context: { uri: "spotify:playlist:friday-night-house", name: "Friday Night House" },
      track: { uri: t.uri, name: t.name, artists: [t.subtitle!], album: "Friday Night House", cover: t.image!, durationMs: t.durationMs! },
    };
  }

  private set(patch: Partial<SpotifyState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private position(): number {
    const s = this.state;
    return s.status === "playing" ? s.positionMs + (Date.now() - s.at) : s.positionMs;
  }

  override async spotify() {
    return this.state;
  }

  override async spotifyLibrary(kind: "playlists" | "albums" | "artists"): Promise<MusicPage> {
    const items: MusicItem[] =
      kind === "playlists"
        ? DEMO_PLAYLISTS.map(([name, n]) => ({ uri: `spotify:playlist:${slug(name)}`, kind: "playlist", name, subtitle: `${n} songs`, image: cover(slug(name)) }))
        : kind === "albums"
          ? DEMO_ALBUMS.map(([name, artist, year]) => ({ uri: `spotify:album:${slug(name)}`, kind: "album", name, subtitle: `${artist} · ${year}`, image: cover(slug(`${name} album`)) }))
          : DEMO_ARTISTS.map((name) => ({ uri: `spotify:artist:${slug(name)}`, kind: "artist", name, image: cover(slug(`${name} artist`)) }));
    return { items, total: items.length };
  }

  override async spotifyTracks(uri: string): Promise<MusicTracks> {
    const items = demoTracks(uri);
    return { ready: true, total: items.length, items };
  }

  private playItem(t: MusicItem, context: SpotifyState["context"]): void {
    this.set({ status: "playing", positionMs: 0, at: Date.now(), ...(context ? { context } : {}), track: { uri: t.uri, name: t.name, artists: t.subtitle ? [t.subtitle] : [], cover: t.image ?? "", durationMs: t.durationMs ?? 200_000 } });
  }

  override async spotifyPlay(uri: string, options: { skipTo?: string; shuffle?: boolean } = {}): Promise<void> {
    this.queue = demoTracks(uri);
    if (options.shuffle !== undefined) this.set({ shuffle: options.shuffle });
    const start = options.skipTo ? this.queue.find((t) => t.uri === options.skipTo) : options.shuffle ? this.queue[Math.floor(Math.random() * this.queue.length)] : this.queue[0];
    const name = [...DEMO_PLAYLISTS.map(([n]) => n), ...DEMO_ALBUMS.map(([n]) => n), ...DEMO_ARTISTS].find((n) => uri.endsWith(slug(n)));
    if (start) this.playItem(start, { uri, ...(name ? { name } : {}) });
  }

  override async spotifyControl(c: SpotifyCommand): Promise<void> {
    const s = this.state;
    const step = (by: number) => {
      const i = this.queue.findIndex((t) => t.uri === s.track?.uri);
      const next = this.queue[(i + by + this.queue.length) % this.queue.length];
      if (next) this.playItem(next, s.context);
    };
    switch (c.cmd) {
      case "playPause":
        this.set({ status: s.status === "playing" ? "paused" : "playing", positionMs: this.position(), at: Date.now() });
        break;
      case "pause":
        if (s.status === "playing") this.set({ status: "paused", positionMs: this.position(), at: Date.now() });
        break;
      case "resume":
        if (s.status === "paused") this.set({ status: "playing", at: Date.now() });
        break;
      case "next":
        step(1);
        break;
      case "prev":
        if (this.position() > 3000) this.set({ positionMs: 0, at: Date.now() });
        else step(-1);
        break;
      case "seek":
        this.set({ positionMs: c.ms, at: Date.now() });
        break;
      case "volume":
        this.set({ volume: Math.max(0, Math.min(100, s.volume + c.delta)) });
        break;
      case "shuffle":
        this.set({ shuffle: c.on });
        break;
      case "repeat":
        this.set({ repeat: c.mode });
        break;
    }
  }

  override onSpotify(listener: (s: SpotifyState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

let chosen: Source = new NoMusic();
export const music = (): Source => chosen;

export const [spotify, setSpotify] = createSignal<SpotifyState>(OFF);
export const [webApp, setWebApp] = createSignal<WebAppState>({ open: false });

/** Picks where music comes from and follows its state; once, at start. */
export async function startMusic(): Promise<void> {
  if (onBox && agentHas("spotify")) chosen = agent;
  else if (!onBox && (await hub.status().catch(() => null))?.demo) chosen = new DemoMusic();
  const src = chosen;
  src.onSpotify(setSpotify);
  src.onWebApp(setWebApp);
  setSpotify(await src.spotify().catch(() => OFF));
  setWebApp(await src.webApp().catch(() => ({ open: false })));
}

/** Where the Spotify song is now, counting on from the last report while it plays. */
export function spotifyPosition(s: SpotifyState, now: number): number {
  const pos = s.status === "playing" ? s.positionMs + (now - s.at) : s.positionMs;
  return Math.max(0, Math.min(pos, s.track?.durationMs ?? pos));
}

/** Which service is playing (or was last), for the Now Playing panel and the remote's play key. */
export function activeMusic(): "spotify" | "deezer" | null {
  const s = spotify();
  const w = webApp();
  if (s.track && (s.status === "playing" || s.status === "buffering")) return "spotify";
  if (w.nowPlaying?.playing) return "deezer";
  if (s.track && s.status === "paused") return "spotify";
  if (w.nowPlaying) return "deezer";
  return null;
}

export async function musicPlayPause(): Promise<boolean> {
  const which = activeMusic();
  if (which === "spotify") await music().spotifyControl({ cmd: "playPause" });
  else if (which === "deezer") await music().webAppControl("playPause");
  return which !== null;
}

export async function musicSkip(by: 1 | -1): Promise<boolean> {
  const which = activeMusic();
  if (which === "spotify") await music().spotifyControl({ cmd: by > 0 ? "next" : "prev" });
  else if (which === "deezer") await music().webAppControl(by > 0 ? "next" : "prev");
  return which !== null;
}

export async function pauseAllMusic(): Promise<void> {
  await music().spotifyControl({ cmd: "pause" }).catch(() => undefined);
  await music().webAppControl("pause").catch(() => undefined);
}

/** The phone remote while a web player shows: keys and text go to it. */
export function webAppTakesRemote(): boolean {
  return webApp().open;
}
export const sendWebAppKey = (a: Action) => void music().webAppKey(a).catch(() => undefined);
export const sendWebAppText = (t: string) => void music().webAppText(t).catch(() => undefined);
export const openWebApp = (id: WebAppId) => music().openWebApp(id);
export const webAppControl = (c: WebAppCommand) => music().webAppControl(c);

export function likedSongs(s: SpotifyState): MusicItem | null {
  return s.signedIn && s.username ? { uri: `spotify:user:${s.username}:collection`, kind: "liked", name: "Liked Songs", subtitle: "Your saved songs" } : null;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
