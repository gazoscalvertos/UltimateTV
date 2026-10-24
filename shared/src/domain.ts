// Domain model shared by the Hub, the TV UI and the box shell.
// Times are epoch milliseconds (UTC) everywhere; the UI formats them in local time.

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
  next?: PlaybackRequest & { name: string };
  /** Shown before an interrupting action, e.g. a recording that would stop. */
  warning?: string;
  /** Still or backdrop shown while the stream starts. */
  artwork?: string;
  /** Channel logo for the live banner. */
  logo?: string;
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

export interface Settings {
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
  iptv: { id: Id; kind: "xtream" | "m3u"; name: string; connections: number; host: string }[];
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
  | { type: "recordings.changed" }
  | { type: "recording.started"; recording: Recording }
  | { type: "recording.finished"; recording: Recording }
  | { type: "downloads.changed"; download: Download }
  | { type: "guide.updated" }
  | { type: "reminder"; reminder: Reminder }
  | { type: "connection.conflict"; message: string; recording?: Recording }
  | { type: "settings.changed" }
  | { type: "profiles.changed" }
  | { type: "toast"; message: string }
  /** From the phone remote: a key press, or text typed on the phone. */
  | { type: "remote.key"; action: string }
  | { type: "remote.text"; text: string };
