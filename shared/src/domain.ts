// Domain model shared by the Hub, the TV UI and the box shell.
// Times are epoch milliseconds (UTC) everywhere; the UI formats them in local time.

import type { BoxInfo, BoxSoftware, PlaybackStats, PlayerState } from "./agent.js";
import type { SpotifyState, WebAppState } from "./music.js";

export type Id = string;

// ---------------------------------------------------------------------------
// Live TV

export type ChannelCategory = "entertainment" | "films" | "sport" | "news" | "kids" | "music" | "documentaries" | "other";

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
  externalSubtitles: SubtitleTrack[];
  /** Report progress to this key. */
  progressKey: string;
  /** Intro/credits markers from Jellyfin media segments. */
  skip: { kind: "intro" | "recap" | "credits"; startMs: number; endMs: number }[];
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

/** The look of the app. "auto" wears the Halloween theme over Halloween week and is plain the rest of the year. */
export type ThemeChoice = "auto" | "default" | "halloween";
export const THEME_CHOICES: readonly ThemeChoice[] = ["auto", "default", "halloween"];
/** The theme actually worn, once "auto" has looked at the date. */
export type ThemeName = "default" | "halloween";

/** Halloween week: the theme comes out on 25 October and goes away after the 1st of November. */
export function isHalloweenWeek(at: number | Date = Date.now()): boolean {
  const d = at instanceof Date ? at : new Date(at);
  const month = d.getMonth();
  const day = d.getDate();
  return (month === 9 && day >= 25) || (month === 10 && day <= 1);
}

/** Which theme to wear: what was chosen, or, on "auto", the date decides. */
export function resolveTheme(choice: ThemeChoice | undefined, at: number | Date = Date.now()): ThemeName {
  if (choice === "halloween") return "halloween";
  if (choice === "default") return "default";
  return isHalloweenWeek(at) ? "halloween" : "default";
}

export interface Settings {
  /** The app's name everywhere it's shown (the TV, the phone remote, the setup pages, Spotify). */
  appName: string;
  /** The look of the app on the TV and the phone remote. */
  theme: ThemeChoice;
  iptv: IptvSource[];
  xmltvUrls: string[];
  jellyfin?: { url: string; userId: string; token: string; serverName?: string };
  tmdbApiKey?: string;
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
  };
  numbering: "uk" | "provider";
  /** Regular expression on the provider's group/category names; channels outside it are hidden. Empty = show all. */
  channelFilter: string;
}

/** Settings as the UI sees them: secrets replaced by a flag saying they're set. */
export interface PublicSettings {
  appName: string;
  theme: ThemeChoice;
  iptv: { id: Id; kind: "xtream" | "m3u"; name: string; connections: number; host: string; status?: IptvSourceStatus }[];
  xmltvCount: number;
  jellyfin?: { url: string; serverName?: string };
  tmdb: boolean;
  addons: { url: string; name: string }[];
  torbox: boolean;
  recording: Settings["recording"];
  playback: Settings["playback"];
  numbering: Settings["numbering"];
  channelFilter: string;
  library: Settings["library"];
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
  /** A jump scare: cut this clip in over whatever is on, now. */
  | { type: "scare"; scare: Scare }
  /** The jump scare settings or clips changed (the phone's Scares sheet, or the TV's settings). */
  | { type: "scares.changed" }
  /** From the phone's settings: things only the TV app can do. "report" asks it to post its software state. */
  | { type: "box.command"; command: "update" | "reload" | "report" | "stats"; on?: boolean }
  /** The phone asks the TV app something (what's playing, play this, seek); it answers at /api/tv/reply/:id. */
  | { type: "tv.call"; id: string; method: TvMethod; args: unknown }

  /** A music service login typed on the phone: the TV fetches it once from /api/music/login/:id. */
  | { type: "music.login"; app: "deezer"; id: string }
  /** A phone or screen paired or was removed, a screen is waiting to be let in, or the pairing code was used. */
  | { type: "devices.changed" };

/** The Hub's own software, for the phone's settings page. */
export interface HubSoftware {
  commit?: string;
  date?: string;
  /** The newest commit on main, when GitHub answered. */
  latest?: string;
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
export type TvMethod = "now" | "play" | "seek" | "track" | "musicLibrary" | "musicTracks" | "musicPlay" | "musicControl";

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
  } | null;
  player: PlayerState;
  /** The stats overlay's sections, when something plays. */
  stats: PlaybackStats | null;
  info: BoxInfo | null;
  spotify: SpotifyState | null;
  webApp: WebAppState | null;
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
// Jump scares

/** A clip the Hub keeps for jump scares, uploaded from the phone. */
export interface ScareClip {
  id: string;
  name: string;
  kind: "video" | "image";
  /** Where the TV loads it from (/api/scares/clips/…). */
  url: string;
  sizeBytes: number;
  addedAt: number;
}

export interface ScareSettings {
  enabled: boolean;
  /** Never two scares closer together than this. */
  minGapMinutes: number;
  /** The chance, each time the gap has passed, that the next minute holds a scare. */
  chancePercent: number;
  /** How long a scare is on screen (a video shorter than this ends it early). */
  seconds: number;
  /** How loud the scare is, 0 to 1. */
  volume: number;
  /** Scare during live TV as well as films, episodes and recordings. */
  duringLive: boolean;
  /** Only while something is playing; off means the scare can come on the menus too. */
  whilePlayingOnly: boolean;
}

export const DEFAULT_SCARE_SETTINGS: ScareSettings = {
  enabled: false,
  minGapMinutes: 20,
  chancePercent: 25,
  seconds: 4,
  volume: 0.7,
  duringLive: true,
  whilePlayingOnly: true,
};

/** One scare on its way to the TV. Without a clip the TV draws (and screams) its own. */
export interface Scare {
  id: string;
  clip?: Pick<ScareClip, "id" | "name" | "kind" | "url">;
  seconds: number;
  volume: number;
  /** Sent by hand from the phone rather than by the random timer. */
  byHand: boolean;
}

export interface ScareState {
  settings: ScareSettings;
  clips: ScareClip[];
}

/** Keeps the scare settings sane whoever sent them (the phone, the TV, a script). */
export function cleanScareSettings(patch: Partial<ScareSettings>, base: ScareSettings = DEFAULT_SCARE_SETTINGS): ScareSettings {
  const num = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    enabled: patch.enabled === undefined ? base.enabled : Boolean(patch.enabled),
    minGapMinutes: patch.minGapMinutes === undefined ? base.minGapMinutes : num(patch.minGapMinutes, 1, 24 * 60, base.minGapMinutes),
    chancePercent: patch.chancePercent === undefined ? base.chancePercent : num(patch.chancePercent, 1, 100, base.chancePercent),
    seconds: patch.seconds === undefined ? base.seconds : num(patch.seconds, 1, 30, base.seconds),
    volume: patch.volume === undefined ? base.volume : num(patch.volume, 0, 1, base.volume),
    duringLive: patch.duringLive === undefined ? base.duringLive : Boolean(patch.duringLive),
    whilePlayingOnly: patch.whilePlayingOnly === undefined ? base.whilePlayingOnly : Boolean(patch.whilePlayingOnly),
  };
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
