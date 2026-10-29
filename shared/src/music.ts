// Music on the box: Spotify through a Spotify Connect receiver (go-librespot) running beside the
// app, and Deezer through its own web player shown over the UI. The box shell talks to both; the
// UI sees only these shapes.

export interface MusicTrack {
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  cover?: string;
  durationMs: number;
}

export interface SpotifyState {
  /** The Spotify receiver is installed and answering on the box. */
  available: boolean;
  /** The receiver is on the box (undefined: the box shell is too old to say). */
  installed?: boolean;
  /** Installed but not answering for a while: why, from its log, when it says. */
  problem?: string;
  /** Signed in to a Spotify account (Premium). */
  signedIn: boolean;
  /**
   * How the box waits for someone to sign in: "phone" (pick the TV in the Spotify app on a
   * phone on the Wi-Fi) or "code" (a code to enter at spotify.com/pair).
   */
  signIn?: SpotifySignIn;
  /** While not signed in with "code": the code to enter at the address, on a phone or computer. */
  pair?: { url: string; code: string; expiresAt?: string };
  /** The name phones see in Spotify's device list. */
  deviceName?: string;
  username?: string;
  status: "stopped" | "playing" | "paused" | "buffering";
  track?: MusicTrack;
  /** Where the track was when `at` (ms since epoch) was measured; count on from there while playing. */
  positionMs: number;
  at: number;
  /** 0 to 100. */
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  /** The playlist, album or artist playing. */
  context?: { uri: string; name?: string };
}

/** A playlist, album, artist or song in a music list. */
export interface MusicItem {
  uri: string;
  kind: "playlist" | "album" | "artist" | "track" | "liked";
  name: string;
  subtitle?: string;
  image?: string;
  durationMs?: number;
}

export interface MusicPage {
  items: MusicItem[];
  total: number;
}

/** A playlist's or album's songs; `ready` is false while the box is still fetching them. */
export interface MusicTracks {
  ready: boolean;
  total: number;
  items: MusicItem[];
}

export type SpotifySignIn = "phone" | "code";

/** Setting Spotify up on the box: how to sign in, or start the receiver again. */
export type SpotifySetup = { signIn: SpotifySignIn } | { restart: true };

export type SpotifyCommand =
  | { cmd: "playPause" | "pause" | "resume" | "next" | "prev" }
  | { cmd: "seek"; ms: number }
  | { cmd: "volume"; delta: number }
  | { cmd: "shuffle"; on: boolean }
  | { cmd: "repeat"; mode: SpotifyState["repeat"] };

/** Music services the box opens as a web page over the UI. */
export type WebAppId = "deezer";

export interface WebAppState {
  /** Showing over the UI now (the remote drives it). */
  open: boolean;
  /** Loaded, open or not; music keeps playing while it's hidden. */
  app?: WebAppId;
  /** Deezer's sign-in cookie is there (undefined until the box has looked). */
  signedIn?: boolean;
  nowPlaying?: { title: string; artist?: string; album?: string; artwork?: string; playing: boolean };
}

export type WebAppCommand = "playPause" | "pause" | "next" | "prev";

/**
 * How a login typed on the phone went: "signed-in" (Deezer took it), "rejected" (Deezer said no,
 * with what it said in `message`), "check" (Deezer wants more on the TV: a tick box, a code or a
 * puzzle), "submitted" (sent, no answer yet), "partial" (only part of the form was there) or
 * "no-form" (no login form found).
 */
export type WebAppLoginResult = "signed-in" | "rejected" | "check" | "submitted" | "partial" | "no-form";

export interface WebAppLoginReport {
  result: WebAppLoginResult;
  message?: string;
}
