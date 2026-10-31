// The contract between the TV UI and whatever plays video: the Electron box shell (mpv) on the
// mini PC, or an HTML <video> fallback when the UI runs in a normal browser for development.

import type { HostStats, PlaybackInfo, PlaybackRequest, TitleRef } from "./domain.js";
import type { Action } from "./keys.js";
import type { CastState, GameAppId } from "./cast.js";
import type { MusicPage, MusicTracks, SpotifyCommand, SpotifySetup, SpotifyState, WebAppCommand, WebAppId, WebAppLoginReport, WebAppState } from "./music.js";

export interface AudioTrack {
  id: number;
  lang?: string;
  title?: string;
  codec?: string;
  channels?: number;
  /** The audio description track: a narrator describing what's on screen. */
  audioDescription?: boolean;
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
  /** Which of a list (PlayOptions.queue) is playing: 0 is `url`, 1 the first of `queue`. */
  playlistPos?: number;
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
  /** Newer than subtitlesByDefault, which older shells read instead. */
  subtitleMode?: SubtitleMode;
  subtitleStyle?: SubtitleStyle;
  /** Night mode: decode audio and compress its dynamic range. */
  nightMode?: boolean;
  /** More to play after `url`, in order (music video channels). The state is "ended" once the last one ends. */
  queue?: string[];
  /** Zoom to fill the screen, cropping the edges rather than showing black bars. */
  fill?: boolean;
  /** Per file crop ("WxH+X+Y", "" for none): `url` first, then each of `queue`. */
  crops?: string[];
}

/**
 * How the box hands the screen back to the TV for its own apps (Netflix, Disney+, Prime): say over
 * CEC that it's no longer the source, press the TV's Home key for it, or both (the default).
 */
export type TvAppsMethod = "inactive" | "home" | "both";

/** How subtitles look on the TV (mpv's sub-scale, sub-color, sub-border-style and sub-pos). */
export interface SubtitleStyle {
  size: "small" | "medium" | "large" | "huge";
  /** Outline and shadow (mpv's usual), or a dark box behind the words. */
  background: "outline" | "box";
  colour: "white" | "yellow";
  /** Raised clears the bottom of the picture (and a soundbar or TV frame in the way). */
  position: "bottom" | "raised";
}

/** Bigger than mpv's usual, as thin text is hard to read on an 85" screen across the room. */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = { size: "large", background: "outline", colour: "white", position: "bottom" };

const SUBTITLE_CHOICES: { [K in keyof SubtitleStyle]: SubtitleStyle[K][] } = {
  size: ["small", "medium", "large", "huge"],
  background: ["outline", "box"],
  colour: ["white", "yellow"],
  position: ["bottom", "raised"],
};

/** A style as sent from a TV or phone: anything unknown keeps what was there. */
export function cleanSubtitleStyle(input: unknown, base: SubtitleStyle = DEFAULT_SUBTITLE_STYLE): SubtitleStyle {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pick = <K extends keyof SubtitleStyle>(k: K): SubtitleStyle[K] => (SUBTITLE_CHOICES[k] as unknown[]).includes(o[k]) ? (o[k] as SubtitleStyle[K]) : base[k];
  return { size: pick("size"), background: pick("background"), colour: pick("colour"), position: pick("position") };
}

export const SUBTITLE_MODES: SubtitleMode[] = ["off", "on", "foreign"];
export const TV_APPS_METHODS: TvAppsMethod[] = ["both", "inactive", "home"];

/** When subtitles come on: never, always, or only for speech in another language (and forced ones). */
export type SubtitleMode = "off" | "on" | "foreign";

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
  /** The last lines from the box's update, its health check and roll backs (boxes from before 2026-10-30 don't send it). */
  updateLog?: string[];
}

/** The box's own software, for Settings › About: what it runs and whether there's an update. */
export interface BoxSoftware {
  /** The app commit the box runs. */
  commit?: string;
  /** When that commit was made (ISO). */
  date?: string;
  branch?: string;
  /** The newest commit on the branch, from the last check that worked (kept when a later one fails). */
  latest?: string;
  /** When that check worked (ISO). */
  checkedAt?: string;
  /** An update is running now; the TV app restarts when it finishes. */
  updating: boolean;
  lastUpdate?: { at: string; ok: boolean };
  /** The check after the last update: still running, passed, or failed (and then usually rolled back). */
  health?: BoxUpdateHealth;
  /** The last update can be undone (Settings › About › Roll back last update, and the phone). */
  canRollBack?: boolean;
  /** The commit a roll back goes back to. */
  rollbackTo?: string;
  /** A roll back is running now; the box reboots when it's done. */
  rollingBack?: boolean;
  /** The last roll back, automatic or asked for. */
  rollback?: BoxRollback;
}

/** One part of the check after an update: app, hub, mpv or cec. */
export interface BoxUpdateCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface BoxUpdateHealth {
  status: "checking" | "ok" | "failed";
  /** When the check finished (ISO). */
  at?: string;
  summary?: string;
  checks?: BoxUpdateCheck[];
}

export interface BoxRollback {
  at: string;
  reason: string;
  /** The commit that was rolled back (and won't install automatically again). */
  from?: string;
  /** The commit the box went back to. */
  to?: string;
  /** Asked for in Settings or on the phone, rather than after a failed health check. */
  manual: boolean;
  ok: boolean;
  /** The whole system from a snapshot, or only the app (no btrfs snapshots on this box). */
  how: "snapshot" | "app";
}

// ---------------------------------------------------------------------------
// Downloads on the box: films, episodes and recordings copied onto the box's own disk, so they
// play with the NAS and Jellyfin out of reach (a trip) and start at once at home.

/** What to download: the same request Play sends, and what the Downloads list shows. */
export interface BoxDownloadRequest {
  req: PlaybackRequest;
  title?: TitleRef;
  /** "The Matrix", or the show's name for an episode. */
  name: string;
  /** "S1 E3 · The One With…" for an episode, the channel and date for a recording. */
  subtitle?: string;
  /** Poster or still, saved with the file. */
  image?: string;
  /** A recording's channel, so Kids profiles only see recordings from their channels. */
  channelId?: string;
}

export type BoxDownloadStatus = "queued" | "downloading" | "done" | "failed";

export interface BoxDownload extends BoxDownloadRequest {
  id: string;
  status: BoxDownloadStatus;
  bytesDone: number;
  bytesTotal?: number;
  speedBps?: number;
  error?: string;
  addedAt: number;
  doneAt?: number;
  /** Where it got to, kept on the box so it resumes with the Hub's progress out of reach. */
  positionMs?: number;
  durationMs?: number;
  watchedAt?: number;
  /** When the box deletes it by itself (days kept, or a day after it was watched). */
  expiresAt?: number;
  /** The saved picture as a data: URL, so it shows with no network. */
  artwork?: string;
}

export interface BoxDownloadSettings {
  /** Delete downloads this many days after they finish; 0 keeps them until deleted. */
  keepDays: number;
  /** Delete a download a day after it's watched to the end. */
  deleteWatched: boolean;
}

export interface BoxDownloads {
  items: BoxDownload[];
  settings: BoxDownloadSettings;
  /** Space the downloads take, and what's free on the box's disk. */
  usedBytes: number;
  freeBytes: number;
  /** Kept free for the box itself: downloads stop before the disk gets this full. */
  reserveBytes: number;
}

export interface BoxAgent {
  /**
   * The app on someone's desktop (the AppImage, docs/desktop.md) rather than the TV box. It plays
   * and browses like the box, but phones, Home Assistant and the Hub's box reports leave it alone.
   */
  readonly desktop?: boolean;
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
  /** Undoes the last update, then reboots the box. Older box shells lack it: check with agentHas. */
  rollback(): Promise<void>;

  // Music (see music.ts). Older box shells lack these: check with agentHas first.
  spotify(): Promise<SpotifyState>;
  spotifyLibrary(kind: "playlists" | "albums" | "artists", offset: number): Promise<MusicPage>;
  spotifyTracks(uri: string): Promise<MusicTracks>;
  /** Plays a playlist, album or artist, from `skipTo` (a track in it) or shuffled. */
  spotifyPlay(uri: string, options?: { skipTo?: string; shuffle?: boolean }): Promise<void>;
  spotifyControl(command: SpotifyCommand): Promise<void>;
  /** Switches how Spotify signs in (phone or code), or starts the receiver again. Newer shells only. */
  spotifySetup(setup: SpotifySetup): Promise<SpotifyState>;
  onSpotify(listener: (state: SpotifyState) => void): () => void;
  /** Shows a music service's web player over the UI; Back on the remote hides it again. */
  openWebApp(id: WebAppId): Promise<void>;
  closeWebApp(): Promise<void>;
  /** A key from the phone remote, for the web player while it shows. */
  webAppKey(action: Action): Promise<void>;
  webAppText(text: string): Promise<void>;
  webAppControl(command: WebAppCommand): Promise<void>;
  /**
   * Opens the service and fills in its login form with what was typed on the phone. Shells from
   * before reports answer with just the result, as a string.
   */
  webAppLogin(id: WebAppId, login: { email: string; password: string }): Promise<WebAppLoginReport>;
  webApp(): Promise<WebAppState>;
  onWebApp(listener: (state: WebAppState) => void): () => void;

  // Downloads on the box. Older box shells lack these: check with agentHas first.
  downloads(): Promise<BoxDownloads>;
  /** Adds to the end of the download list; the box fetches one at a time. */
  download(items: BoxDownloadRequest[]): Promise<BoxDownloads>;
  removeDownload(id: string): Promise<BoxDownloads>;
  retryDownload(id: string): Promise<BoxDownloads>;
  downloadSettings(settings: Partial<BoxDownloadSettings>): Promise<BoxDownloads>;
  /** How to play a finished download of `req` from the box's disk, or null when there isn't one. */
  localCopy(req: PlaybackRequest): Promise<(PlaybackInfo & { downloadId: string }) | null>;
  /** Where a download got to as it plays, for resuming and for deleting once watched. */
  downloadPosition(id: string, positionMs: number, durationMs?: number): Promise<void>;
  onDownloads(listener: (downloads: BoxDownloads) => void): () => void;

  // Other screens and games (see cast.ts). Older box shells lack these: check with agentHas first.
  cast(): Promise<CastState>;
  /** Turns the AirPlay receiver on or off, and names it. */
  castSettings(settings: { airplay?: boolean; name?: string }): Promise<CastState>;
  /** Opens a game app full screen; the TV app steps aside until it closes. */
  launchApp(id: GameAppId): Promise<CastState>;
  /** Closes whatever has the screen (a game, or an AirPlay connection) and brings the TV app back. */
  stopApp(): Promise<CastState>;
  onCast(listener: (state: CastState) => void): () => void;

  // The sleep timer. Older box shells lack these.
  /** Puts the TV into standby over HDMI-CEC. */
  tvStandby(): Promise<void>;
  /** The player's volume, 0–100 (for fading out). */
  setVolume(percent: number): Promise<void>;

  // TV apps and subtitles. Older box shells lack these: check with agentHas first.
  /** Hands the screen back to the TV's own Home over CEC; false when there's no CEC adapter. */
  tvApps(method?: TvAppsMethod): Promise<boolean>;
  /** Adds a subtitle file (one fetched from OpenSubtitles) to what's playing, and shows it. */
  addSubtitle(sub: { url: string; lang: string; label: string }): Promise<void>;
  setSubtitleStyle(style: SubtitleStyle): Promise<void>;

  // The screen the box shows when the Hub is down (box/offline). Older box shells lack this.
  /** Who's watching, so that screen only offers what this profile may see. */
  offlineProfile(p: OfflineProfile): Promise<void>;
}

/** What the box's Hub-down screen may show: it follows the profile last used on the TV. */
export interface OfflineProfile {
  name: string;
  kids: boolean;
  /** For a Kids profile, the downloads it may watch. */
  allowedDownloads?: string[];
}

declare global {
  interface Window {
    /** Present when the UI runs inside the box shell. */
    ultimatetv?: BoxAgent;
  }
}
