// Domain model shared by the Hub, the TV UI and the box shell.
// Times are epoch milliseconds (UTC) everywhere; the UI formats them in local time.

import type { BoxInfo, BoxSoftware, PlaybackStats, PlayerState, SubtitleMode, SubtitleStyle, TvAppsMethod } from "./agent.js";
import type { SpotifyState, WebAppState } from "./music.js";
import type { ScreensaverSettings } from "./screensaver.js";
import type { CastLink, ShareOffer } from "./cast.js";
import type { AdBreak, Alert, SleepChoice, SleepState } from "./household.js";
import type { Projection, ProjectionMotion, SeasonId } from "./seasons.js";
import { seasonOn } from "./seasons.js";
import type { ThemeChoice, ThemeName } from "./themes.js";
import type { AccessibilitySettings } from "./accessibility.js";

export type Id = string;

// ---------------------------------------------------------------------------
// Live TV

export type ChannelCategory = "entertainment" | "films" | "sport" | "news" | "kids" | "music" | "documentaries" | "other";
export const CHANNEL_CATEGORIES: ChannelCategory[] = ["entertainment", "films", "sport", "news", "documentaries", "kids", "music", "other"];

export interface ChannelFeed {
  /** Stable id: `${sourceId}:${upstreamId}`. */
  id: Id;
  sourceId: Id;
  name: string;
  /** Height of the feed (2160, 1080, 720, 576), parsed from the name when the provider doesn't say. */
  height: number;
  /** Lower is preferred. Feeds are tried in this order and the next one is used when one fails. */
  priority: number;
  /** Catch-up days the provider keeps for this feed (0 = none). */
  catchupDays: number;
}

export interface Channel {
  id: Id;
  /** Sky-style channel number (101 BBC One). */
  number: number;
  name: string;
  logo?: string;
  category: ChannelCategory;
  /** A category chosen by hand (phone settings); kept over the automatic one when the channel list refreshes. */
  userCategory?: ChannelCategory;
  /** XMLTV channel id used to join guide data. */
  epgId?: string;
  feeds: ChannelFeed[];
  favourite: boolean;
  hidden: boolean;
  /** Highest feed height, for the UHD tab and badges. */
  maxHeight: number;
  catchupDays: number;
  /** Set on the Hub's own music video channels (see MixChannel), which have no IPTV feeds. */
  mix?: { ready: number; target: number };
}

export interface Programme {
  id: Id;
  channelId: Id;
  start: number;
  end: number;
  title: string;
  subtitle?: string;
  description?: string;
  season?: number;
  episode?: number;
  /** Identifies the series across airings and channels (crid, dd_progid series part or normalised title). */
  seriesKey?: string;
  /** Identifies one episode across repeats, so series link records it once. */
  episodeKey?: string;
  categories: string[];
  image?: string;
  isNew: boolean;
  isRepeat: boolean;
  isFilm: boolean;
  year?: number;
  rating?: string;
  /** On a music video channel: the video this slot plays. */
  videoId?: Id;
}

export interface GuideWindow {
  from: number;
  to: number;
  channels: Channel[];
  /** Programmes keyed by channel id, sorted by start. */
  programmes: Record<Id, Programme[]>;
  /** Markers for the grid: recordings and series links keyed by programme id. */
  marks: Record<Id, ProgrammeMark>;
}

export type ProgrammeMark = "recording" | "scheduled" | "series" | "reminder";

/** A guide the household built by hand: its own choice and order of channels. */
export interface CustomGuide {
  id: Id;
  name: string;
  /** Channel ids in the order the guide shows them. */
  channels: Id[];
}

/**
 * One of the channel lists the guide can show: everything, favourites, a category or a custom
 * guide. `id` is what `/api/guide?category=` takes.
 */
export interface GuideChoice {
  id: string;
  label: string;
  kind: "all" | "favourites" | "category" | "custom";
  /** Channels in it that this profile can see. */
  count: number;
}

export interface GuideChoices {
  choices: GuideChoice[];
  custom: CustomGuide[];
  /** The list this profile's guide opens on ("" for all channels). */
  default: string;
}

export interface NowNext {
  channel: Channel;
  now?: Programme;
  next?: Programme;
}

// ---------------------------------------------------------------------------
// Recording

export type RecordingStatus = "scheduled" | "waiting-catchup" | "recording" | "processing" | "completed" | "failed" | "cancelled";
export type RecordingMethod = "live" | "catchup";

export interface Recording {
  id: Id;
  programme: Programme;
  channelId: Id;
  channelName: string;
  status: RecordingStatus;
  method: RecordingMethod;
  /** Recording window including padding. */
  start: number;
  end: number;
  seriesLinkId?: Id;
  /** Set when the recording finished early or had gaps. */
  incomplete: boolean;
  error?: string;
  path?: string;
  sizeBytes?: number;
  watched: boolean;
  positionMs: number;
  createdAt: number;
  /** The advert breaks comskip found, once it has looked. */
  adBreaks?: AdBreak[];
  /** Where the advert search got to: not run yet, done, failed, or comskip isn't installed. */
  adScan?: "pending" | "done" | "failed" | "unavailable";
}

export type ChannelScope = "this" | "any";

export interface SeriesLink {
  id: Id;
  seriesKey: string;
  title: string;
  channelId: Id;
  channelName: string;
  scope: ChannelScope;
  newOnly: boolean;
  /** Keep only the latest N recordings (0 = keep all). */
  keepLatest: number;
  paddingBeforeMin: number;
  paddingAfterMin: number;
  createdAt: number;
}

export interface Reminder {
  id: Id;
  programme: Programme;
  channelId: Id;
  channelName: string;
}

export interface Conflict {
  /** When the clash happens. */
  start: number;
  end: number;
  /** The recordings that want the connection at once; the last ones can't be recorded live. */
  recordings: Recording[];
  message: string;
}

// ---------------------------------------------------------------------------
// Films and TV (VOD)

export type TitleKind = "movie" | "series";
export type HdrFormat = "dv" | "hdr10plus" | "hdr10" | "hlg" | "sdr";
export type AudioFormat = "atmos" | "truehd" | "dtsx" | "dtshd" | "dts" | "eac3" | "ac3" | "aac" | "flac" | "opus" | "mp3" | "unknown";
export type VideoCodec = "hevc" | "h264" | "av1" | "vp9" | "mpeg2" | "unknown";
export type SourceKind = "nas" | "jellyfin" | "recording" | "torbox" | "addon" | "xtream";

export interface StreamQuality {
  height: number;
  hdr: HdrFormat;
  /** Dolby Vision profile (5, 7, 8) when known. */
  dvProfile?: number;
  codec: VideoCodec;
  audio: AudioFormat;
  channels?: number;
  sizeBytes?: number;
  remux?: boolean;
  cam?: boolean;
}

export interface StreamCandidate {
  id: Id;
  kind: SourceKind;
  /** Friendly label for the source list ("Your library", "TorBox", "Xtream"). */
  label: string;
  /** Raw description from the source, kept for the "More options" list. */
  detail?: string;
  quality: StreamQuality;
  /** Ready to play now (debrid cached, local file). */
  ready: boolean;
  /** URL the player can open, or a Hub path to resolve first. */
  url: string;
  headers?: Record<string, string>;
  /** Can be saved to the NAS. */
  downloadable: boolean;
  /** ISO 639-2 language the source tags this copy with (IPTV "FR", "DE" …), when it says. */
  lang?: string;
  score?: number;
}

export interface TitleRef {
  /** `tmdb:movie:603`, `jellyfin:<id>`, `xtream:vod:123`, … */
  id: Id;
  kind: TitleKind;
  name: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  logo?: string;
  /** 0–1 for Continue Watching. */
  progress?: number;
  badges?: string[];
  subtitle?: string;
  /** Used to filter titles for Kids profiles. */
  genres?: string[];
  certification?: string;
}

export interface Episode {
  id: Id;
  season: number;
  episode: number;
  name: string;
  overview?: string;
  still?: string;
  airDate?: string;
  runtimeMin?: number;
  progress?: number;
  watched?: boolean;
}

export interface Season {
  season: number;
  name: string;
  episodes: Episode[];
}

export interface TitleDetails extends TitleRef {
  overview?: string;
  genres: string[];
  runtimeMin?: number;
  rating?: number;
  certification?: string;
  cast: string[];
  tmdbId?: number;
  imdbId?: string;
  seasons?: Season[];
  /** Where it's available, before streams are resolved. */
  availability: SourceKind[];
  inLibrary: boolean;
  resumeMs?: number;
}

/** A review score for the details page: TMDB's own, and IMDb, Rotten Tomatoes and Metacritic from OMDb. */
export interface TitleScore {
  source: "tmdb" | "imdb" | "rotten-tomatoes" | "metacritic";
  /** "TMDB", "IMDb", "Rotten Tomatoes", "Metacritic". */
  label: string;
  /** As shown: "7.9", "87%", "76". */
  value: string;
  /** The score out of 100, for its colour. */
  pct: number;
}

/** A trailer to play (a YouTube page: mpv on the box plays it with yt-dlp), or the demo's own clip. */
export interface Trailer {
  name: string;
  url: string;
}

/** What the details page fetches after the title itself: slower lookups that may fail on their own. */
export interface TitleExtras {
  trailer?: Trailer;
  scores: TitleScore[];
  /** "More like this": TMDB's recommendations, kept to what a source can play (and the profile may see). */
  similar: TitleRef[];
}

/** A subtitle file OpenSubtitles has for a film or episode. */
export interface SubtitleResult {
  fileId: number;
  /** OpenSubtitles' language code ("en", "pt-PT"). */
  lang: string;
  /** The release it was timed to ("Heat.1995.2160p.UHD.BluRay…"). */
  release: string;
  downloads: number;
  /** Describes sounds as well as speech (SDH). */
  hearingImpaired: boolean;
  /** Machine or AI translated: listed last. */
  machine: boolean;
  /** From an uploader OpenSubtitles trusts. */
  trusted?: boolean;
}

export interface Rail {
  id: string;
  title: string;
  kind: "titles" | "channels" | "recordings";
  items: TitleRef[];
  channels?: NowNext[];
  recordings?: Recording[];
}

export interface HomeScreen {
  hero?: TitleRef & { overview?: string; action: "resume" | "watch" | "live" };
  rails: Rail[];
}

export type SearchResultKind = "channel" | "on-now" | "upcoming" | "title" | "recording";

export interface SearchResult {
  kind: SearchResultKind;
  id: Id;
  name: string;
  subtitle?: string;
  image?: string;
  title?: TitleRef;
  channel?: Channel;
  programme?: Programme;
  recording?: Recording;
}

// ---------------------------------------------------------------------------
// Playback

export interface PlaybackRequest {
  kind: "channel" | "catchup" | "recording" | "title" | "stream";
  id: Id;
  /** For series titles. */
  episodeId?: Id;
  /** For catch-up: programme start. */
  start?: number;
  /** A specific stream from the source list. */
  streamId?: Id;
}

export interface SubtitleTrack {
  url: string;
  lang: string;
  label: string;
}

export interface PlaybackInfo {
  url: string;
  headers?: Record<string, string>;
  title: string;
  subtitle?: string;
  live: boolean;
  startMs: number;
  durationMs?: number;
  /** Content frame rate when known, so the box can switch the TV's refresh rate before playing. */
  fps?: number;
  quality?: StreamQuality;
  /** Where it plays from, shown in the player ("Jellyfin", "TorBox", "IPTV"). */
  source?: { kind: SourceKind; label: string };
  /** The version playing, so Save to NAS keeps this exact copy. */
  streamId?: Id;
  /** This copy can be saved to the NAS (TorBox, online and IPTV films and episodes not already there). */
  savable?: boolean;
  externalSubtitles: SubtitleTrack[];
  /** Report progress to this key. */
  progressKey: string;
  /** Intro/credits markers from Jellyfin media segments. */
  skip: { kind: "intro" | "recap" | "credits" | "adverts"; startMs: number; endMs: number }[];
  /** Jump over the advert breaks without asking (Settings › Recording). */
  autoSkipAdverts?: boolean;
  /** The next episode, for autoplay. */
  /** What plays next (the next episode), with its still and summary for the Up Next card. */
  next?: PlaybackRequest & { name: string; image?: string; overview?: string };
  /** Shown before an interrupting action, e.g. a recording that would stop. */
  warning?: string;
  /** Still or backdrop shown while the stream starts. */
  artwork?: string;
  /** Channel logo for the live banner. */
  logo?: string;
  /** Music video channels: what plays after `url`, in order. The TV tunes in again when it runs out. */
  queue?: string[];
  /** `url` is an HLS playlist (Jellyfin's smaller copy for phones) rather than a file. */
  hls?: boolean;
  /** "Artist – Song" for `url` and then each of `queue`, for the music channel's caption. */
  titles?: string[];
  /** Fill the screen, cropping any black bars (music videos come in every shape). */
  fill?: boolean;
  /** Black bars baked into each video (mpv video-crop "WxH+X+Y", "" for none), in the order of `titles`. */
  crops?: string[];
}

// ---------------------------------------------------------------------------
// Play queue

/** Something lined up to play after what's on now: a film, an episode or a recording. */
export interface QueueItem {
  id: Id;
  req: PlaybackRequest;
  title?: TitleRef;
  /** "The Matrix", or the show's name for an episode. */
  name: string;
  /** "S1 E3 · The One With…" for an episode. */
  subtitle?: string;
  image?: string;
  addedAt: number;
}

// ---------------------------------------------------------------------------
// Downloads

export type DownloadStatus = "queued" | "waiting-debrid" | "downloading" | "moving" | "completed" | "failed" | "cancelled";

export interface Download {
  id: Id;
  title: string;
  kind: TitleKind;
  year?: number;
  season?: number;
  episode?: number;
  status: DownloadStatus;
  progress: number;
  bytesDone: number;
  bytesTotal?: number;
  speedBps?: number;
  path?: string;
  error?: string;
  /** What Jellyfin made of the saved file, once it's finished. */
  jellyfin?: { added: boolean; note: string };
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Profiles

export type ProfileKind = "adult" | "kids";

/** UK age ratings from youngest to oldest (BBFC for films; TV guidance maps onto the same scale). */
export const CERTIFICATIONS = ["U", "PG", "12", "12A", "15", "18"] as const;
export type Certification = (typeof CERTIFICATIONS)[number];

export interface Profile {
  id: Id;
  name: string;
  kind: ProfileKind;
  /** Accent colour for the avatar. */
  colour: string;
  /** A PIN protects this profile (always the case for switching out of a Kids profile into an adult one with a PIN). */
  hasPin: boolean;
  /** Kids: the oldest certificate allowed. */
  maxCertification: Certification;
  /** Kids: channel categories shown in the guide. */
  channelCategories: ChannelCategory[];
  /** Kids: extra channels allowed by hand. */
  allowedChannels: Id[];
  /** The channel list the guide opens on: a GuideChoice id ("" or missing = all channels). */
  defaultGuide?: string;
  /** When subtitles come on for this profile; missing follows Settings › Picture and sound. */
  subtitles?: SubtitleMode;
  /** Audio description, focus ring, text size and reduced motion; missing is all off. */
  accessibility?: AccessibilitySettings;
  /** Kids: a daily allowance and a bedtime (see hub/src/kidstime.ts). Missing = no limits. */
  limits?: KidsLimits;
}

/** A bedtime as "HH:MM" (24-hour), or null for none. */
export type Bedtime = string | null;

export interface KidsLimits {
  /** Minutes of watching a day, or null for no allowance. Resets at midnight. */
  dailyMinutes: number | null;
  /** Sunday to Thursday nights. */
  weekdayBedtime: Bedtime;
  /** Friday and Saturday nights. */
  weekendBedtime: Bedtime;
  /** Tell Home Assistant/ntfy (Settings › Alerts) when the time runs out. */
  alert: boolean;
}

export const NO_KIDS_LIMITS: KidsLimits = { dailyMinutes: null, weekdayBedtime: null, weekendBedtime: null, alert: false };
/** The allowances offered in Settings, in minutes (null = off). */
export const KIDS_ALLOWANCES: (number | null)[] = [null, 30, 45, 60, 90, 120, 150, 180, 240];
/** The bedtimes offered in Settings. */
export const KIDS_BEDTIMES: string[] = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];
/** What an adult PIN can give at the limit: minutes, or 0 for no limits until the morning. */
export const KIDS_EXTRA_TIME = [15, 30, 60, 0] as const;

/** Tidies limits from a request: unknown values fall back to off. */
export function cleanKidsLimits(input: Partial<KidsLimits> | undefined, base: KidsLimits = NO_KIDS_LIMITS): KidsLimits {
  const bed = (v: unknown, fallback: Bedtime): Bedtime => (v === undefined ? fallback : typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
  const mins = input?.dailyMinutes;
  return {
    dailyMinutes: mins === undefined ? base.dailyMinutes : typeof mins === "number" && Number.isFinite(mins) && mins >= 15 && mins <= 720 ? Math.round(mins) : null,
    weekdayBedtime: bed(input?.weekdayBedtime, base.weekdayBedtime),
    weekendBedtime: bed(input?.weekendBedtime, base.weekendBedtime),
    alert: input?.alert === undefined ? base.alert : Boolean(input.alert),
  };
}

/** "1 h a day · bed 19:30 / 20:30" for Settings, or "Off". */
export function kidsLimitsLabel(l: KidsLimits | undefined): string {
  if (!hasKidsLimits(l)) return "Off";
  const parts: string[] = [];
  if (l!.dailyMinutes !== null) parts.push(l!.dailyMinutes < 60 ? `${l!.dailyMinutes} min a day` : `${+(l!.dailyMinutes / 60).toFixed(1)} h a day`);
  if (l!.weekdayBedtime || l!.weekendBedtime) parts.push(`bed ${l!.weekdayBedtime ?? "none"} / ${l!.weekendBedtime ?? "none"}`);
  return parts.join(" · ");
}

/** True when any limit is set. */
export function hasKidsLimits(l: KidsLimits | undefined): boolean {
  return Boolean(l && (l.dailyMinutes !== null || l.weekdayBedtime || l.weekendBedtime));
}

/**
 * Where a Kids profile stands today. "warn" is the last five minutes; "finishing" means time is
 * up but what's on may finish (nothing new starts) until stopBy; "stopped" means back to the
 * profile picker until an adult gives more time.
 */
export interface KidsTimeStatus {
  profileId: Id;
  limited: boolean;
  state: "ok" | "warn" | "finishing" | "stopped";
  reason?: "allowance" | "bedtime";
  usedMinutes: number;
  /** Today's allowance including any extra time, or null for none. */
  allowanceMinutes: number | null;
  /** Tonight's bedtime ("HH:MM"), or null. */
  bedtime: Bedtime;
  /** Whole minutes left before the nearer limit, or null with no limits. */
  minutesLeft: number | null;
  /** When finishing ends and the TV goes back to the profile picker. */
  stopBy?: number;
  /** An adult lifted the limits until this time (the next morning). */
  unlockedUntil?: number;
}

// ---------------------------------------------------------------------------
// Settings and status

export interface XtreamSource {
  id: Id;
  kind: "xtream";
  name: string;
  url: string;
  username: string;
  password: string;
  connections: number;
}

export interface M3uSource {
  id: Id;
  kind: "m3u";
  name: string;
  url: string;
  connections: number;
}

export type IptvSource = XtreamSource | M3uSource;

/** How a source's last load went, shown next to it on the phone page. */
export interface IptvSourceStatus {
  at: number;
  ok: boolean;
  /** Live streams the provider listed, before the channel filter. */
  streams?: number;
  /** Of those, the channels the filter lets through. */
  visible?: number;
  error?: string;
}

/** What the app is called until it's renamed on the phone's settings page. */
export const DEFAULT_APP_NAME = "UltimateTV";

/** A name for the app as typed: trimmed, one line, at most 24 characters; blank gives the default. */
export function cleanAppName(name: string | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 24).trim();
  return clean || DEFAULT_APP_NAME;
}

export interface Settings {
  /** The app's name everywhere it's shown (the TV, the phone remote, the setup pages, Spotify). */
  appName: string;
  /** The everyday look of the app on the TV, the phone remote and the web pages ("auto" from older Hubs). */
  theme: ThemeChoice;
  /** The seasonal themes (Halloween, Christmas, Easter, Valentine's) take over on their days. */
  seasonal?: boolean;
  iptv: IptvSource[];
  xmltvUrls: string[];
  jellyfin?: { url: string; userId: string; token: string; serverName?: string };
  tmdbApiKey?: string;
  /** OMDb (omdbapi.com, free) for IMDb, Rotten Tomatoes and Metacritic scores. */
  omdbApiKey?: string;
  /** OpenSubtitles (opensubtitles.com) for subtitles a film doesn't come with. The login lifts the daily limit. */
  openSubtitles?: { apiKey: string; username?: string; password?: string };
  addonUrls: string[];
  torboxApiKey?: string;
  library: {
    moviesPath: string;
    tvPath: string;
    recordingsPath: string;
    inboxPath: string;
    /** Where the music video channels keep their videos (one file per video, shared between channels). */
    musicVideosPath: string;
  };
  recording: {
    paddingBeforeMin: number;
    paddingAfterMin: number;
    preferCatchup: boolean;
    autoDeleteWatchedDays: number;
  };
  playback: {
    preferredAudioLang: string;
    preferredSubtitleLang: string;
    subtitlesByDefault: boolean;
    maxSizeGb: number;
    avoidDvProfile5: boolean;
    autoplayNext: boolean;
    startOn: "home" | "live";
    /** How the TV apps button hands the screen back to the TV (see TvAppsMethod). */
    tvAppsMethod: TvAppsMethod;
    /** How subtitles look on the TV, for everyone. Whether they come on is per profile. */
    subtitleStyle: SubtitleStyle;
  };
  numbering: "uk" | "provider";
  /** Regular expression on the provider's group/category names; channels outside it are hidden. Empty = show all. */
  channelFilter: string;
  /** Dimming the screen and the screensaver when the TV is left with nothing playing. */
  screensaver: ScreensaverSettings;
}

/** Settings as the UI sees them: secrets replaced by a flag saying they're set. */
export interface PublicSettings {
  appName: string;
  theme: ThemeName;
  seasonal: boolean;
  /** The theme being worn today, once the seasons have had their say. */
  themeNow: ThemeName;
  iptv: { id: Id; kind: "xtream" | "m3u"; name: string; connections: number; host: string; status?: IptvSourceStatus }[];
  xmltvCount: number;
  jellyfin?: { url: string; serverName?: string };
  tmdb: boolean;
  omdb: boolean;
  /** OpenSubtitles is set up (and signed in, which allows more downloads a day). */
  openSubtitles: { configured: boolean; signedIn: boolean };
  addons: { url: string; name: string }[];
  torbox: boolean;
  recording: Settings["recording"];
  playback: Settings["playback"];
  numbering: Settings["numbering"];
  channelFilter: string;
  library: Settings["library"];
  screensaver: ScreensaverSettings;
  setupUrl: string;
}

export interface HubStatus {
  version: string;
  /** The commit the Hub was built from, when its build recorded it. */
  commit?: string;
  builtAt?: string;
  demo: boolean;
  channels: number;
  programmes: number;
  epgUpdatedAt?: number;
  sourcesUpdatedAt?: number;
  connections: { used: number; limit: number; holders: string[] };
  recordingNow: Recording[];
  diskFreeBytes?: number;
  diskTotalBytes?: number;
  configured: { iptv: boolean; jellyfin: boolean; tmdb: boolean; addons: boolean; torbox: boolean };
}

export type HubEvent =
  /** Sent on each (re)connect of the event socket. */
  | { type: "hello"; version: string }
  | { type: "recordings.changed" }
  | { type: "recording.started"; recording: Recording }
  | { type: "recording.finished"; recording: Recording }
  | { type: "downloads.changed"; download: Download }
  | { type: "guide.updated" }
  /** A music video channel changed: videos downloaded or removed, or the channel edited. */
  | { type: "mix.changed"; channelId?: Id }
  | { type: "reminder"; reminder: Reminder }
  | { type: "connection.conflict"; message: string; recording?: Recording }
  | { type: "settings.changed" }
  | { type: "profiles.changed" }
  | { type: "toast"; message: string }
  /** From the phone remote: a key press, or text typed on the phone. */
  | { type: "remote.key"; action: string }
  | { type: "remote.text"; text: string }
  /** From phone voice control: switch to a channel, or say what was understood. */
  | { type: "remote.channel"; channelId: string }
  | { type: "remote.said"; text: string }
  /** A news flash typed on the phone, shown along the bottom of the TV over anything; null takes it down. */
  | { type: "flash"; flash: NewsFlash | null }
  /** A pop-up sent to the TV through /api/notify (a doorbell, a meeting, an alarm); a notice with the same id replaces it. */
  | { type: "notice"; notice: TvNotice }
  /** Takes a pop-up down, or all of them without an id. */
  | { type: "notice.clear"; id?: string }
  /** A jump scare or projected clip: cut it in over whatever is on, now. */
  | { type: "scare"; scare: Scare }
  /** The clip settings, clips, packs or loop changed (the phone's Clips sheet, or the TV's settings). */
  | { type: "scares.changed" }
  /** From the phone's settings: things only the TV app can do. "report" asks it to post its software state. */
  | { type: "box.command"; command: "update" | "rollback" | "reload" | "report" | "stats"; on?: boolean }
  /** The phone asks the TV app something (what's playing, play this, seek); it answers at /api/tv/reply/:id. */
  | { type: "tv.call"; id: string; method: TvMethod; args: unknown }

  /** A music service login typed on the phone: the TV fetches it once from /api/music/login/:id. */
  | { type: "music.login"; app: "deezer"; id: string }
  /** A phone or screen paired or was removed, a screen is waiting to be let in, or the pairing code was used. */
  | { type: "devices.changed" }
  /** The play queue changed (added to on the TV or the phone, reordered, or an item started): fetch /api/queue again. */
  | { type: "queue.changed" }
  /** A profile's watchlist changed (saved from the phone, say): fetch /api/watchlist again. */
  | { type: "watchlist.changed"; profileId: string | null }
  /** A new alert, or one cleared (Settings › Alerts, and a pop-up for adults when that's on). */
  | { type: "alerts.changed"; alert?: Alert }
  /** A laptop asks to share its screen; the TV asks before it accepts. */
  | { type: "cast.share"; offer: ShareOffer }
  /** The laptop stopped sharing (or went away). */
  | { type: "cast.share.end"; id: string }
  /** A link from a phone to play now. */
  | { type: "cast.link"; link: CastLink }
  /** A seasonal clip to drift across the screen now. */
  | { type: "projection"; projection: Projection }
  /** The seasonal clip settings or clips changed. */
  | { type: "projections.changed" }
  /** Set or cancel the TV's sleep timer (voice, or the phone). */
  | { type: "sleep"; choice: SleepChoice }
  /** A new forecast, or the weather settings changed: fetch /api/weather again. */
  | { type: "weather.changed" }
  /** Open the forecast on the TV (asked for by voice, or from the phone). */
  | { type: "weather.show" };

/** The Hub's own software, for the phone's settings page. */
export interface HubSoftware {
  commit?: string;
  date?: string;
  /** The newest commit on main, from the last time GitHub answered (kept when a later check fails). */
  latest?: string;
  /** When GitHub last answered (ISO). */
  checkedAt?: string;
  /** How many commits main is ahead of the running Hub, and what they are (merged PRs by title). */
  behind?: number;
  changes?: SoftwareChange[];
  /** The update helper is installed on the Docker LXC (tools/hub/update.sh installs it). */
  canUpdate: boolean;
  /** An update has been asked for or is running. */
  updating: boolean;
  lastUpdate?: { at: string; ok: boolean };
}

/** Where a pop-up sits on the TV. "full" covers the whole screen. */
export type NoticePosition = "center" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "full";
export const NOTICE_POSITIONS: readonly NoticePosition[] = ["center", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right", "full"];
export type NoticeSize = "small" | "medium" | "large";
export const NOTICE_SIZES: readonly NoticeSize[] = ["small", "medium", "large"];
/** The look (icon and colour) and the sound it makes by default. */
export type NoticeKind = "info" | "doorbell" | "meeting" | "alarm" | "warning";
export const NOTICE_KINDS: readonly NoticeKind[] = ["info", "doorbell", "meeting", "alarm", "warning"];
export type NoticeSound = "none" | "ping" | "chime" | "alarm";
export const NOTICE_SOUNDS: readonly NoticeSound[] = ["none", "ping", "chime", "alarm"];

/** A pop-up on the TV with any mix of a title, text, a picture and a video, sent from the phone or any device on the home network. */
export interface TvNotice {
  id: string;
  kind: NoticeKind;
  title?: string;
  text?: string;
  /** Picture and video addresses the TV loads: the Hub's own copy (/api/notify/media/…) or a web address. */
  image?: string;
  video?: string;
  /** The video plays without sound. */
  muted: boolean;
  position: NoticePosition;
  size: NoticeSize;
  sound: NoticeSound;
  /** Pause what's playing while it shows, and carry on when it goes. */
  pause: boolean;
  /** Turn the TV on (HDMI-CEC) when it arrives. */
  wake: boolean;
  /** When it goes by itself (ms since 1970, the Hub's clock), or null to stay until dismissed. */
  until: number | null;
  /** How long it has left as the Hub sends it, so the TV needn't trust its clock to match the Hub's. */
  leftMs: number | null;
  at: number;
}

/** A "breaking news" ticker along the bottom of the TV, written on the phone. */
export interface NewsFlash {
  text: string;
  /** The channel name on the left of the bar ("BBC NEWS"). */
  label: string;
  /** When it goes by itself (ms since 1970, the Hub's clock), or null to stay until cleared. */
  until: number | null;
  /** How long it has left as the Hub sends it, so the TV needn't trust its clock to match the Hub's. */
  leftMs: number | null;
  at: number;
}

export interface SoftwareChange {
  sha: string;
  title: string;
  date?: string;
  /** The pull request it came from. */
  pr?: number;
}

/** What the TV app last told the Hub about the box. */
export interface BoxState {
  software: BoxSoftware | null;
  stats: boolean;
  reportedAt: string;
}

// ---------------------------------------------------------------------------
// The phone remote: what the TV is doing, and machine stats

/** What the phone can ask the TV app to do, through the Hub (POST /api/tv/call/:method). */
export type TvMethod = "now" | "play" | "seek" | "track" | "tvApps" | "musicLibrary" | "musicTracks" | "musicPlay" | "musicControl" | "downloads" | "download" | "downloadRemove" | "musicStatus" | "musicSetup" | "saveToNas" | "sleep" | "cast" | "castApp" | "castAirplay" | "ha";

/** What the TV shows and plays, for the phone's Now Playing card and Stats page. */
export interface TvNow {
  at: string;
  profile: { id: Id; name: string; kind: ProfileKind } | null;
  /** The screen the TV is on ("home", "guide", "player", …). */
  screen: string;
  playing: {
    kind: PlaybackRequest["kind"];
    id: Id;
    title: string;
    subtitle?: string;
    artwork?: string;
    live: boolean;
    /** Where it plays from ("Jellyfin", "TorBox", "IPTV"). */
    source?: string;
    channel?: { id: Id; number: number; name: string };
    /** Save to NAS can keep a copy of what's playing. */
    savable?: boolean;
  } | null;
  player: PlayerState;
  /** The stats overlay's sections, when something plays. */
  stats: PlaybackStats | null;
  info: BoxInfo | null;
  spotify: SpotifyState | null;
  webApp: WebAppState | null;
  /** The sleep timer, when one is set. */
  sleep?: SleepState;
}

/** A machine's health: the box or the Hub. Each part is missing when it couldn't be read. */
export interface HostStats {
  hostname: string;
  kernel: string;
  uptimeS: number;
  load: number[];
  cpu: { model: string; cores: number; usagePct?: number };
  memory: { totalMb: number; availableMb: number };
  gpu?: { name: string; freqMhz?: number; maxFreqMhz?: number };
  temperatures: { name: string; celsius: number }[];
  disks: { label: string; path: string; totalGb: number; freeGb: number }[];
  network: { name: string; address: string; speedMbps?: number; rxKbps?: number; txKbps?: number }[];
}

export interface StatsWarning {
  level: "info" | "warn" | "bad";
  where: "box" | "hub" | "playback";
  text: string;
}

// Music video channels: the Hub downloads music videos and plays them as a live channel, shuffled
// afresh on every pass through the list.

/**
 * A channel the household (or later an LLM) curates. The Hub fills it to `target` videos: first one
 * video for each of `picks` ("Artist - Title"), then the best results of `queries`.
 */
export interface MixChannel {
  id: Id;
  name: string;
  number: number;
  /** What the channel is for, in plain words ("2000s UK club anthems"). The brief an LLM curator works from. */
  brief: string;
  /** Specific tracks, "Artist - Title", each searched for its official video. */
  picks: string[];
  /** Broader searches used to fill up to `target` once the picks are done. */
  queries: string[];
  /** Words that rule a video out (in its title), on top of the Hub's own list (lyric videos, reactions …). */
  exclude: string[];
  target: number;
  /** Smallest and largest picture height to download (720 = HD, 2160 = 4K). */
  minHeight: number;
  maxHeight: number;
  /** Longer videos (megamixes, full sets) are left out. */
  maxMinutes: number;
  /**
   * What the channel is made of. "music" is music videos, judged as such (an official video wins
   * over a lyric video). "ambience" is long atmospheric footage, such as Spooky TV's haunted
   * houses and ghost sounds: length is welcome and nothing has to look like a single.
   */
  style: MixStyle;
  enabled: boolean;
  /** Who fills it: "search" (picks and queries), or an LLM later. */
  curator: "search" | "llm";
  colour: string;
  createdAt: number;
  curatedAt?: number;
  /** Why the last curation stopped short. */
  error?: string;
  /**
   * YouTube playlists the channel follows. Every video in them is downloaded and put on the
   * channel, and the Hub reads them again every six hours for videos added since.
   */
  playlists?: MixPlaylist[];
}

/** A YouTube playlist a music channel follows. */
export interface MixPlaylist {
  /** YouTube's playlist id (the `list=` in the link). */
  id: Id;
  url: string;
  title: string;
  addedAt: number;
  /** When the Hub last read the playlist. */
  syncedAt?: number;
  /** Videos in the playlist when it was last read. */
  total?: number;
  /** Why videos in it were left out ("2 private or deleted", "1 longer than 10 min"). */
  skipped?: string[];
  /** Why the playlist couldn't be read last time (private, deleted, yt-dlp broken). */
  error?: string;
}

/** A followed playlist, with how its videos are getting on. */
export interface MixPlaylistInfo extends MixPlaylist {
  counts: Record<MixVideoStatus, number>;
  /** The one downloading now, 0 to 1. */
  progress?: number;
  /** Videos that couldn't be downloaded, and why. */
  failures: { title: string; error: string }[];
  /** The Hub is reading it now (or will soon). */
  syncing: boolean;
}

export type MixStyle = "music" | "ambience";
export const MIX_STYLES: readonly MixStyle[] = ["music", "ambience"];

export type MixVideoStatus = "queued" | "downloading" | "ready" | "failed";

export interface MixVideo {
  /** YouTube video id (or yt-dlp's id for other sites). */
  id: Id;
  url: string;
  title: string;
  artist?: string;
  track?: string;
  uploader?: string;
  durationS: number;
  height: number;
  fps?: number;
  status: MixVideoStatus;
  progress?: number;
  path?: string;
  sizeBytes?: number;
  error?: string;
  addedAt: number;
  /** "nas" for a file that was already on the NAS (linked, never downloaded or deleted). */
  source?: "nas";
}

/** A folder on the NAS, for choosing video files to put on a music channel. */
export interface NasListing {
  /** "" for the list of shares. */
  dir: string;
  parent?: string;
  folders: { name: string; path: string }[];
  files: { name: string; path: string; sizeBytes: number }[];
}

/** A video in a channel, and how it got there. */
export interface MixEntry {
  video: MixVideo;
  /** "pick: Cascada - Everytime We Touch", "query: house music official video", "added by hand", "llm". */
  origin: string;
  addedAt: number;
}

export interface MixChannelInfo extends MixChannel {
  counts: Record<MixVideoStatus, number>;
  /** Space the channel's downloaded videos take on the NAS. */
  readyBytes: number;
  /** The guide channel's id (mix:…). */
  channelId: Id;
  /** How many videos it should end up with: the target (when the Hub searches for it) plus its playlists' videos. */
  goal: number;
  playlists?: MixPlaylistInfo[];
}

/** A search result, with whether it would be accepted and why not. */
export interface MixCandidate {
  id: Id;
  url: string;
  title: string;
  artist?: string;
  track?: string;
  uploader?: string;
  durationS: number;
  height: number;
  views?: number;
  thumbnail?: string;
  score: number;
  /** Empty when the video passes the channel's rules. */
  rejected: string[];
}

export interface MixOverview {
  channels: MixChannelInfo[];
  /** yt-dlp, which finds and downloads the videos. */
  downloader: { ok: boolean; version?: string; error?: string };
  /** What the Hub is doing right now ("Downloading Cascada - Everytime We Touch"). */
  working?: string;
  /** Free space where the videos are kept. */
  diskFreeBytes?: number;
  /** Downloaded videos across every channel (a video on two channels counts once), and their size. */
  totals: { ready: number; bytes: number };
}

// ---------------------------------------------------------------------------
// Jump scares and projected clips
//
// What started as Halloween jump scares is now any short clip cut in over the TV: a jump scare in
// October, a snowman walking along the bottom in December, a bunny hopping across at Easter. Each
// built clip says which occasion it's for, and only the current occasion's clips come up at
// random. The names in the code (scare, ScareMix, /api/scares) stay as they were, so older phones,
// TVs and scripts keep working.

/** A clip the Hub keeps, uploaded from the phone or from a pack: a video, a picture (a transparent GIF, PNG, WebP or SVG works best) or a sound. */
export interface ScareClip {
  id: string;
  name: string;
  kind: "video" | "image" | "audio";
  /** Where the TV loads it from (/api/scares/clips/…). */
  url: string;
  sizeBytes: number;
  addedAt: number;
  /** A seasonal projection clip rather than a jump scare, and the season it's for. */
  projection?: boolean;
  season?: SeasonId | "any";
  motion?: ProjectionMotion;
  /** Downloaded from the community library (its id there). */
  communityId?: string;
  /** The pack it came with; removing the pack removes it. */
  packId?: string;
}

/** The occasion a clip is for. "everyday" clips are for no occasion in particular. */
export type ClipTheme = "halloween" | "christmas" | "newyear" | "valentines" | "easter" | "bonfire" | "birthday" | "everyday";
export const CLIP_THEMES: readonly ClipTheme[] = ["halloween", "christmas", "newyear", "valentines", "easter", "bonfire", "birthday", "everyday"];
export const CLIP_THEME_NAMES: Record<ClipTheme, string> = {
  halloween: "Halloween",
  christmas: "Christmas",
  newyear: "New Year",
  valentines: "Valentine's",
  easter: "Easter",
  bonfire: "Bonfire Night",
  birthday: "Birthday",
  everyday: "Any time",
};
/** Which occasion's clips come up: the date decides on "auto". */
export type ClipSeason = "auto" | ClipTheme;

export interface ScareSettings {
  enabled: boolean;
  /** Never two clips closer together than this. */
  minGapMinutes: number;
  /** The chance, each time the gap has passed, that the next minute holds a clip. */
  chancePercent: number;
  /** How long a clip is on screen when it doesn't say (a video shorter than this ends it early). */
  seconds: number;
  /** How loud, 0 to 1. */
  volume: number;
  /** During live TV as well as films, episodes and recordings. */
  duringLive: boolean;
  /** Only while something is playing; off means a clip can come on the menus too. */
  whilePlayingOnly: boolean;
  /** Whose clips come up at random and from "Show one now": the occasion, or "auto" by the date. */
  season: ClipSeason;
  /** The community pack list the Hub browses (an https address of an index.json); empty turns it off. */
  libraryUrl: string;
}

/** The community pack list in this project's repository (community/clips/index.json). */
export const DEFAULT_CLIP_LIBRARY = "https://raw.githubusercontent.com/gazoscalvertos/UltimateTV/main/community/clips/index.json";

export const DEFAULT_SCARE_SETTINGS: ScareSettings = {
  enabled: false,
  minGapMinutes: 20,
  chancePercent: 25,
  seconds: 4,
  volume: 0.7,
  duringLive: true,
  whilePlayingOnly: true,
  season: "auto",
  libraryUrl: DEFAULT_CLIP_LIBRARY,
};

/**
 * Where a clip's picture sits: one of nine spots, over all of the screen on black ("full", for a
 * jump scare), or over all of it with whatever is on still showing through ("overlay", for falling
 * snow or rising hearts on a transparent picture).
 */
export type ScareSpot = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right" | "full" | "overlay";
export const SCARE_SPOTS: readonly ScareSpot[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right", "full", "overlay"];
/** How much of the screen a placed picture takes (its height): a third, a half, or nearly all of it. */
export type ScareSize = "small" | "medium" | "large";
export const SCARE_SIZES: readonly ScareSize[] = ["small", "medium", "large"];

/**
 * How a placed picture moves while it's on. Walking, hopping and flying go across the screen in
 * the spot's row (top, middle or bottom); rising, dropping and peeking stay in the spot's column.
 */
export type ClipMotion = "still" | "walk-left" | "walk-right" | "hop-left" | "hop-right" | "fly-left" | "fly-right" | "rise" | "drop" | "peek";
export const CLIP_MOTIONS: readonly ClipMotion[] = ["still", "walk-left", "walk-right", "hop-left", "hop-right", "fly-left", "fly-right", "rise", "drop", "peek"];
export const CLIP_MOTION_NAMES: Record<ClipMotion, string> = {
  still: "Stays put",
  "walk-left": "Walks across, right to left",
  "walk-right": "Walks across, left to right",
  "hop-left": "Hops across, right to left",
  "hop-right": "Hops across, left to right",
  "fly-left": "Flies across, right to left",
  "fly-right": "Flies across, left to right",
  rise: "Floats up from the bottom",
  drop: "Drops down from the top, then goes back up",
  peek: "Peeks up from the bottom edge",
};

/**
 * A clip built on the phone (or brought in with a pack) from the uploaded clips: a picture or a
 * video, a sound, or both, placed somewhere on the screen and perhaps moving across it.
 */
export interface ScareMix {
  id: string;
  name: string;
  /** A picture or video clip. */
  visualId?: string;
  /** A sound clip, played with it. */
  audioId?: string;
  spot: ScareSpot;
  size: ScareSize;
  /** Play the video without its own sound (the sound clip, if any, plays instead). */
  muteVideo: boolean;
  /** Seconds it stays on; 0 uses the general setting. */
  seconds: number;
  createdAt: number;
  /** The occasion it's for; built scares from before there were occasions are Halloween's. */
  theme?: ClipTheme;
  /** How it moves; still when missing. */
  motion?: ClipMotion;
  /** The pack it came with. */
  packId?: string;
}

/** One clip on its way to the TV. Without a clip or a sound the TV draws (and screams) its own scare. */
export interface Scare {
  id: string;
  clip?: Pick<ScareClip, "id" | "name" | "kind" | "url">;
  /** A sound to play with it. */
  audio?: Pick<ScareClip, "id" | "name" | "url">;
  /** Where the picture goes; "full" (the default) covers the screen on black. */
  spot?: ScareSpot;
  size?: ScareSize;
  motion?: ClipMotion;
  /** The occasion; the TV only screams for Halloween's. */
  theme?: ClipTheme;
  /** The video's own sound is off. */
  muted?: boolean;
  /** The built clip it came from. */
  mixId?: string;
  seconds: number;
  volume: number;
  /** Sent by hand from the phone rather than by the random timer. */
  byHand: boolean;
}

/** A pack brought in to the Hub: its clips and built clips go when it's removed. */
export interface InstalledClipPack {
  id: string;
  name: string;
  theme: ClipTheme;
  description?: string;
  author?: string;
  /** Where it came from: one that ships with the Hub, a file from the phone, a link, or the community list. */
  source: "starter" | "file" | "link" | "community";
  installedAt: number;
  clipIds: string[];
  mixIds: string[];
  sizeBytes: number;
}

export interface ScareState {
  settings: ScareSettings;
  clips: ScareClip[];
  mixes: ScareMix[];
  packs?: InstalledClipPack[];
  /** The occasion the date (or the setting) picks right now. */
  season?: ClipTheme;
  /** The TV is playing this occasion's clips one after another, like a window projector. */
  looping?: ClipTheme | null;
}

/**
 * The occasion for a date: the seasonal projections' calendar (seasonOn in seasons.ts), or
 * "everyday" outside them. Birthdays are never guessed.
 */
export function clipSeasonFor(choice: ClipSeason | undefined, at: number | Date = Date.now()): ClipTheme {
  if (choice && choice !== "auto") return choice;
  return seasonOn(at instanceof Date ? at : new Date(at)) ?? "everyday";
}

/** The occasion a built clip is for. */
export const mixTheme = (m: Pick<ScareMix, "theme">): ClipTheme => m.theme ?? "halloween";

/**
 * Puts a clip together from what the Hub keeps: a built clip, an uploaded clip, or (with neither
 * asked for) one of the occasion's built clips at random. On Halloween, loose pictures and videos
 * uploaded for jump scares join in, and with nothing at all the TV draws its own scare. Sounds on
 * their own aren't picked at random. Undefined when the one asked for has gone, or the occasion
 * has nothing to show. Used by the Hub (the phone's buttons) and the TV (the random timer) alike.
 */
export function scareFrom(
  state: ScareState,
  want: { clipId?: string; mixId?: string; theme?: ClipTheme },
  byHand: boolean,
  rand: () => number = Math.random,
  at: number | Date = Date.now(),
): Scare | undefined {
  const { settings, clips, mixes } = state;
  const id = `${Date.now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
  const base = { id, seconds: settings.seconds, volume: settings.volume, byHand };
  const asClip = (c: ScareClip) => ({ id: c.id, name: c.name, kind: c.kind, url: c.url });
  const fromMix = (m: ScareMix): Scare => {
    const visual = clips.find((c) => c.id === m.visualId && c.kind !== "audio");
    const audio = clips.find((c) => c.id === m.audioId && c.kind === "audio");
    return {
      ...base,
      ...(visual ? { clip: asClip(visual) } : {}),
      ...(audio ? { audio: { id: audio.id, name: audio.name, url: audio.url } } : {}),
      spot: m.spot,
      size: m.size,
      ...(m.motion && m.motion !== "still" ? { motion: m.motion } : {}),
      theme: mixTheme(m),
      muted: m.muteVideo,
      mixId: m.id,
      seconds: m.seconds > 0 ? m.seconds : settings.seconds,
    };
  };
  const fromClip = (c: ScareClip): Scare =>
    c.kind === "audio" ? { ...base, audio: { id: c.id, name: c.name, url: c.url } } : { ...base, clip: asClip(c) };
  if (want.mixId) {
    const m = mixes.find((x) => x.id === want.mixId);
    return m ? fromMix(m) : undefined;
  }
  if (want.clipId) {
    const c = clips.find((x) => x.id === want.clipId);
    return c ? fromClip(c) : undefined;
  }
  const theme = want.theme ?? clipSeasonFor(settings.season, at);
  const pool: (() => Scare)[] = [
    ...mixes.filter((m) => mixTheme(m) === theme).map((m) => () => fromMix(m)),
    ...(theme === "halloween" ? clips.filter((c) => c.kind !== "audio" && !c.packId).map((c) => () => fromClip(c)) : []),
  ];
  if (pool.length) return pool[Math.floor(rand() * pool.length)]!();
  return theme === "halloween" ? { ...base, theme } : undefined;
}

/** Keeps the settings sane whoever sent them (the phone, the TV, a script). */
export function cleanScareSettings(patch: Partial<ScareSettings>, base: ScareSettings = DEFAULT_SCARE_SETTINGS): ScareSettings {
  const num = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const season = (value: unknown): ClipSeason | undefined => (value === "auto" || CLIP_THEMES.includes(value as ClipTheme) ? (value as ClipSeason) : undefined);
  const library = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const url = value.trim();
    return url === "" || /^https:\/\/[^\s]{1,300}$/.test(url) ? url : undefined;
  };
  return {
    enabled: patch.enabled === undefined ? base.enabled : Boolean(patch.enabled),
    minGapMinutes: patch.minGapMinutes === undefined ? base.minGapMinutes : num(patch.minGapMinutes, 1, 24 * 60, base.minGapMinutes),
    chancePercent: patch.chancePercent === undefined ? base.chancePercent : num(patch.chancePercent, 1, 100, base.chancePercent),
    seconds: patch.seconds === undefined ? base.seconds : num(patch.seconds, 1, 30, base.seconds),
    volume: patch.volume === undefined ? base.volume : num(patch.volume, 0, 1, base.volume),
    duringLive: patch.duringLive === undefined ? base.duringLive : Boolean(patch.duringLive),
    whilePlayingOnly: patch.whilePlayingOnly === undefined ? base.whilePlayingOnly : Boolean(patch.whilePlayingOnly),
    season: season(patch.season) ?? base.season ?? DEFAULT_SCARE_SETTINGS.season,
    libraryUrl: library(patch.libraryUrl) ?? base.libraryUrl ?? DEFAULT_CLIP_LIBRARY,
  };
}

// ---------------------------------------------------------------------------
// Clip packs: built clips and the files they use, in one file to share

/** A pack file (.utvpack): JSON, with each clip's file inside it as base64. */
export interface ClipPackFile {
  format: "ultimatetv.clips";
  version: 1;
  /** Lower-case letters, digits and dashes; bringing in a pack with the same id replaces it. */
  id: string;
  name: string;
  theme: ClipTheme;
  description?: string;
  author?: string;
  createdAt?: string;
  clips: { key: string; name: string; type: string; data: string }[];
  mixes: {
    name: string;
    visual?: string;
    audio?: string;
    spot?: ScareSpot;
    size?: ScareSize;
    motion?: ClipMotion;
    muteVideo?: boolean;
    seconds?: number;
    /** When it differs from the pack's (fireworks for New Year in a Bonfire Night pack). */
    theme?: ClipTheme;
  }[];
}

/** A pack in a list to install from: one that ships with the Hub, or one on the community list. */
export interface ClipPackListing {
  id: string;
  name: string;
  theme: ClipTheme;
  description?: string;
  author?: string;
  sizeBytes: number;
  /** How many built clips it has. */
  count?: number;
  /** Jump scares or anything that might frighten; off for gentle seasonal ones. */
  scary?: boolean;
  installed: boolean;
}

export interface ClipLibrary {
  starter: ClipPackListing[];
  community: { url: string; packs: ClipPackListing[]; error?: string };
}

/** A phone, tablet or screen that has paired with the Hub and may control the TV. */
export interface PairedDevice {
  id: string;
  name: string;
  /** "tv" is a screen running the TV app; "phone" is a remote or the Android app. */
  kind: "tv" | "phone";
  pairedAt: number;
  lastSeenAt: number;
  /** The address it last called from. */
  ip?: string;
}

/** A second screen asking to join; a paired device lets it in after checking the code matches. */
export interface PendingScreen {
  id: string;
  name: string;
  code: string;
  ip?: string;
  at: number;
}

/** What the TV shows to pair a phone: the code (also in the QR code's address) and when it runs out. */
export interface PairingCode {
  code: string;
  /** The address the QR code opens: the phone remote with the code in it. */
  url: string;
  expiresAt: number;
}

export interface DeviceList {
  devices: PairedDevice[];
  pending: PendingScreen[];
  /** The device asking, when it's paired. */
  me: string | null;
  /** False when the Hub was started with PAIRING=off. */
  enforced: boolean;
}
