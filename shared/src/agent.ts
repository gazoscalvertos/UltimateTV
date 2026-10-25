// The contract between the TV UI and whatever plays video: the Electron box shell (mpv) on the
// mini PC, or an HTML <video> fallback when the UI runs in a normal browser for development.

import type { HostStats } from "./domain.js";
import type { Action } from "./keys.js";
import type { MusicPage, MusicTracks, SpotifyCommand, SpotifyState, WebAppCommand, WebAppId, WebAppLoginResult, WebAppState } from "./music.js";

export interface AudioTrack {
  id: number;
  lang?: string;
  title?: string;
  codec?: string;
  channels?: number;
  selected: boolean;
}

export interface SubTrack {
  id: number;
  lang?: string;
  title?: string;
  external: boolean;
  selected: boolean;
}

export interface PlayerState {
  status: "idle" | "loading" | "playing" | "paused" | "buffering" | "ended" | "error";
  positionMs: number;
  durationMs?: number;
  /** For live TV: how far behind live the player is (pause live). */
  behindLiveMs?: number;
  /** Seconds of buffer the player holds ahead/behind, for the pause-live bar. */
  bufferedMs?: number;
  /** How fast the stream is arriving, while it starts. */
  downloadKbps?: number;
  audioTracks: AudioTrack[];
  subtitleTracks: SubTrack[];
  video?: { width: number; height: number; fps?: number; hdr?: string; codec?: string; hwdec?: string };
  audio?: { codec?: string; passthrough: boolean; channels?: number };
  error?: string;
}

export interface PlayOptions {
  url: string;
  headers?: Record<string, string>;
  live: boolean;
  startMs?: number;
  fps?: number;
  title?: string;
  /** Shown while the stream starts (and by the browser stand-in when it can't decode the stream). */
  artwork?: string;
  subtitles?: { url: string; lang: string; label: string }[];
  preferredAudioLang?: string;
  preferredSubtitleLang?: string;
  subtitlesByDefault?: boolean;
  /** Night mode: decode audio and compress its dynamic range. */
  nightMode?: boolean;
  /** More to play after `url`, in order (music video channels). The state is "ended" once the last one ends. */
  queue?: string[];
}

/** Where video is drawn: full screen, or the guide's preview window (in CSS pixels of the UI). */
export type VideoLayout = { mode: "fullscreen" } | { mode: "window"; x: number; y: number; width: number; height: number } | { mode: "hidden" };

export interface BoxInfo {
  kind: "box" | "browser";
  version: string;
  hostname?: string;
  display?: { name: string; width: number; height: number; refreshHz: number; hdr: boolean };
  cec?: { connected: boolean; tvOn?: boolean };
  audioDevice?: string;
}

/** Technical details of what's playing, for the stats overlay: labelled values in sections. */
export interface PlaybackStats {
  sections: { title: string; rows: [label: string, value: string][] }[];
}

/** One playback measurement, taken every 10 seconds while something plays (counters are mpv's running totals). */
export interface PlaybackSample {
  at: string;
  /** The stream's host only. */
  source?: string;
  status?: string;
  positionS?: number;
  video?: { codec?: string; width?: number; height?: number; fps?: number; measuredFps?: number; hwdec?: string; bitrate?: number; hdr?: string };
  /** What the box did to match the screen to the video: a fitting mode, variable refresh, or nothing. */
  match?: "mode" | "vrr" | null;
  display?: { mode?: string; refreshHz?: number; sync?: string; displayFps?: number };
  frames?: { dropped?: number; decoderDropped?: number; delayed?: number; mistimed?: number };
  avsyncMs?: number;
  bufferS?: number;
  inputKbps?: number;
}

/** What the box sends the Hub for diagnosis (GET /api/diagnostics on the Hub shows it). */
export interface BoxDiagnostics {
  at: string;
  hostname: string;
  uptimeS: number;
  load: number[];
  memory: { totalMb: number; freeMb: number };
  software: unknown;
  info: unknown;
  /** kscreen-doctor's view of the screens: JSON (modes cut down) and the text listing. */
  kscreen: { json: unknown; text: string };
  /** A sample taken as the report was made, or null when nothing plays. */
  now: PlaybackSample | null;
  samples: PlaybackSample[];
  /** The box's recent log lines, addresses cut to their host. */
  log: string[];
  /** CPU, GPU, memory, temperatures, disk and network (boxes from before 2026-10-25 don't send it). */
  host?: HostStats;
}

/** The box's own software, for Settings › About: what it runs and whether there's an update. */
export interface BoxSoftware {
  /** The app commit the box runs. */
  commit?: string;
  /** When that commit was made (ISO). */
  date?: string;
  branch?: string;
  /** The newest commit on the branch, when the box could check. */
  latest?: string;
  /** An update is running now; the TV app restarts when it finishes. */
  updating: boolean;
  lastUpdate?: { at: string; ok: boolean };
}

export interface BoxAgent {
  info(): Promise<BoxInfo>;
  play(options: PlayOptions): Promise<void>;
  stop(): Promise<void>;
  pause(paused: boolean): Promise<void>;
  seek(ms: number, mode: "absolute" | "relative"): Promise<void>;
  /** Jump back to the live edge (pause live). */
  goLive(): Promise<void>;
  setAudioTrack(id: number): Promise<void>;
  setSubtitleTrack(id: number | null): Promise<void>;
  setNightMode(on: boolean): Promise<void>;
  setLayout(layout: VideoLayout): Promise<void>;
  /** Stats for the overlay; null when nothing is playing. */
  stats(): Promise<PlaybackStats | null>;
  onState(listener: (state: PlayerState) => void): () => void;
  /** Called with true when the TV switches to the box's input, false when it goes to standby. */
  onPower(listener: (active: boolean) => void): () => void;
  /** Tells the TV (over CEC) to switch on and show the box. */
  wakeTv(): Promise<void>;
  reload(): Promise<void>;
  /** The box's software; `check` also asks GitHub for the newest version. Null outside the box. */
  software(check: boolean): Promise<BoxSoftware | null>;
  /** Installs the latest app and OS updates, then restarts the TV app. */
  update(): Promise<void>;

  // Music (see music.ts). Older box shells lack these: check with agentHas first.
  spotify(): Promise<SpotifyState>;
  spotifyLibrary(kind: "playlists" | "albums" | "artists", offset: number): Promise<MusicPage>;
  spotifyTracks(uri: string): Promise<MusicTracks>;
  /** Plays a playlist, album or artist, from `skipTo` (a track in it) or shuffled. */
  spotifyPlay(uri: string, options?: { skipTo?: string; shuffle?: boolean }): Promise<void>;
  spotifyControl(command: SpotifyCommand): Promise<void>;
  onSpotify(listener: (state: SpotifyState) => void): () => void;
  /** Shows a music service's web player over the UI; Back on the remote hides it again. */
  openWebApp(id: WebAppId): Promise<void>;
  closeWebApp(): Promise<void>;
  /** A key from the phone remote, for the web player while it shows. */
  webAppKey(action: Action): Promise<void>;
  webAppText(text: string): Promise<void>;
  webAppControl(command: WebAppCommand): Promise<void>;
  /** Opens the service and fills in its login form with what was typed on the phone. */
  webAppLogin(id: WebAppId, login: { email: string; password: string }): Promise<WebAppLoginResult>;
  webApp(): Promise<WebAppState>;
  onWebApp(listener: (state: WebAppState) => void): () => void;
}

declare global {
  interface Window {
    /** Present when the UI runs inside the box shell. */
    ultimatetv?: BoxAgent;
  }
}
