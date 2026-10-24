// The contract between the TV UI and whatever plays video: the Electron box shell (mpv) on the
// mini PC, or an HTML <video> fallback when the UI runs in a normal browser for development.

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
}

declare global {
  interface Window {
    /** Present when the UI runs inside the box shell. */
    ultimatetv?: BoxAgent;
  }
}
