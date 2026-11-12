// Talks to the Hub. Every request carries the current profile so the Hub can filter for Kids.

import type { AccessibilitySettings, Changelog, HaEvent, HaSettings, HomeRowId, HomeRowsView, KidsAllowKind, KidsAllowList, KidsAllowReply, KidsAsk, KidsAskAnswer, KidsSummary, KidsTimeStatus, PersonDetails, SubtitleResult, TitleCast, TitleExtras, SelfTestReport, PerfReport, SourceTestResult } from "@ultimatetv/shared";
import type { AdSkipSettings, AdvertScan, AlertSettings, BackupState, AlertState, WeatherPlace, WeatherSettings, WeatherState, CastSettings, CommunityIndex, DrawnProjection, ProjectionSettings, ProjectionState, RecentSearch, TrackPref, SeasonId, ShareSession, WatchItem, WatchlistInput, FavouriteInput, FavouriteResult, Favourites } from "@ultimatetv/shared";
import type { RequestsView, TitleRequest, FollowingView, ArtItem, ArtStatus, BoxState, Channel, ClipLibrary, Conflict, CustomGuide, DeviceList, Download, GuideChoices, GuideWindow, HomeScreen, HubEvent, HubSoftware, HubStatus, MixChannel, MixChannelInfo, MixEntry, MixOverview, MixPlaylist, NasListing, NowNext, PairedDevice, PairingCode, PlaybackInfo, PlaybackRequest, PodcastSearchResult, PodcastShow, PodcastShowWithEpisodes, PodcastsReply, Profile, Programme, PublicSettings, RadioNow, RadioReply, RadioStation, Rail, ScreensaverInfo, ScreensaverPhoto, ScreensaverSettings, Recording, Reminder, Scare, ScareSettings, ScareState, SearchResult, Season, SeriesLink, Settings, StreamCandidate, TitleDetails, TitleRef, WebAppLoginReport } from "@ultimatetv/shared";

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Private mode or no storage: the profile is asked for again next time.
    }
  },
};

export const session = {
  profileId: store.get("utv-profile"),
  token: store.get("utv-token"),
  set(profileId: string | null, token: string | null): void {
    this.profileId = profileId;
    this.token = token;
    store.set("utv-profile", profileId);
    store.set("utv-token", token);
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly recordings: string[] = [],
    /** Whatever else the Hub put in the answer, such as the title a blocked page was for. */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (session.profileId) headers["X-Profile"] = session.profileId;
  if (session.token) headers["X-Profile-Token"] = session.token;
  const res = await fetch(path, { method: opts.method ?? "GET", headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; recordings?: string[] };
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status, data.code, data.recordings ?? [], data as Record<string, unknown>);
  return data;
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};
const enc = encodeURIComponent;

export interface ProgrammeInfo {
  programme: Programme;
  channel?: Channel;
  recording?: Recording;
  seriesLink?: SeriesLink;
  catchup: boolean;
  otherAirings: Programme[];
  reminder: boolean;
}

export interface Planner {
  recordings: Recording[];
  seriesLinks: SeriesLink[];
  conflicts: Conflict[];
  reminders: Reminder[];
}

export type StreamRow = StreamCandidate & { badges: string[] };

export const hub = {
  status: () => api<HubStatus>("/api/status"),
  musicLogin: (id: string) => api<{ email: string; password: string }>(`/api/music/login/${enc(id)}`),
  musicLoginResult: (id: string, report: WebAppLoginReport) => api<{ ok: true }>(`/api/music/login/${enc(id)}/result`, { method: "POST", body: report }),
  profiles: () => api<{ profiles: Profile[]; locked: boolean; current: string | null; admin: boolean }>("/api/profiles"),
  unlock: (id: string, pin?: string) => api<{ token: string; profile: Profile }>(`/api/profiles/${enc(id)}/unlock`, { method: "POST", body: { pin } }),
  createProfile: (name: string, kind: Profile["kind"]) => api<Profile>("/api/profiles", { method: "POST", body: { name, kind } }),
  kidsTime: () => api<{ current: KidsTimeStatus | null }>("/api/kids-time"),
  kidsTimeOf: (id: string) => api<KidsTimeStatus>(`/api/kids-time/${enc(id)}`),
  kidsReport: (playing: boolean) => api<{ status: KidsTimeStatus | null }>("/api/kids-time/report", { method: "POST", body: { playing } }),
  kidsExtra: (id: string, minutes: number, pin?: string) => api<{ status: KidsTimeStatus }>(`/api/kids-time/${enc(id)}/extra`, { method: "POST", body: { minutes, ...(pin ? { pin } : {}) } }),
  kidsAllow: () => api<KidsAllowReply>("/api/kids-allow"),
  setKidsAllow: (id: string, body: { side: "allow" | "block"; id: string; kind: KidsAllowKind; name: string }) => api<{ list: KidsAllowList }>(`/api/kids-allow/${enc(id)}`, { method: "PATCH", body }),
  clearKidsAllow: (id: string, kind: KidsAllowKind, titleId: string) => api<{ list: KidsAllowList }>(`/api/kids-allow/${enc(id)}/${kind}/${enc(titleId)}`, { method: "DELETE" }),
  // Ask a parent (#224): a Kids or Guest profile asks; an adult answers on the TV or a phone.
  askParent: (title: { id: string; kind: KidsAllowKind; name: string }) => api<{ ask: KidsAsk }>("/api/kids-asks", { method: "POST", body: title }),
  kidsAsks: () => api<{ asks: KidsAsk[] }>("/api/kids-asks"),
  answerKidsAsk: (id: string, answer: KidsAskAnswer) => api<{ ask: KidsAsk }>(`/api/kids-asks/${enc(id)}/answer`, { method: "POST", body: { answer } }),
  kidsSummary: (id?: string) => api<{ summaries: KidsSummary[] }>(`/api/kids-summary${id ? `?profile=${enc(id)}` : ""}`),
  /** The first-time tour was shown or skipped for the profile watching. */
  tourDone: () => api<{ ok: boolean }>("/api/profiles/me/toured", { method: "POST" }),
  updateProfile: (id: string, patch: Partial<Omit<Profile, "accessibility" | "limits">> & { accessibility?: Partial<AccessibilitySettings> | null; pin?: string | null; limits?: Profile["limits"] | null }) => api<Profile>(`/api/profiles/${enc(id)}`, { method: "PATCH", body: patch }),
  deleteProfile: (id: string) => api<{ ok: true }>(`/api/profiles/${enc(id)}`, { method: "DELETE" }),

  home: () => api<HomeScreen>("/api/home"),
  browse: (kind: "movie" | "series") => api<{ rails: Rail[] }>(`/api/browse/${kind}`),
  title: (id: string) => api<TitleDetails>(`/api/titles/${enc(id)}`),
  extras: (id: string) => api<TitleExtras>(`/api/titles/${enc(id)}/extras`),
  cast: (id: string, episode?: string) => api<TitleCast>(`/api/titles/${enc(id)}/cast${q({ episode })}`),
  person: (id: number) => api<PersonDetails>(`/api/people/${id}`),
  subtitleSearch: (titleId: string, episodeId?: string, lang?: string) => api<{ configured: boolean; results: SubtitleResult[]; note?: string }>(`/api/subtitles${q({ titleId, episodeId, lang })}`),
  subtitleDownload: (r: { fileId: number; lang: string; label: string }) => api<{ url: string; lang: string; label: string }>("/api/subtitles/download", { method: "POST", body: r }),
  season: (id: string, n: number) => api<Season>(`/api/titles/${enc(id)}/season/${n}`),
  streams: (id: string, episode?: string) => api<{ streams: StreamRow[] }>(`/api/titles/${enc(id)}/streams${q({ episode })}`),
  search: (text: string) => api<{ results: SearchResult[] }>(`/api/search${q({ q: text })}`),

  channels: () => api<{ channels: Channel[] }>("/api/channels"),
  guide: (from: number, to: number, category?: string) => api<GuideWindow>(`/api/guide${q({ from, to, category })}`),
  guides: () => api<GuideChoices>("/api/guides"),
  createGuide: (body: { name?: string; channels: string[] }) => api<CustomGuide>("/api/guides", { method: "POST", body }),
  updateGuide: (id: string, body: { name?: string; channels?: string[] }) => api<CustomGuide>(`/api/guides/${enc(id)}`, { method: "PATCH", body }),
  deleteGuide: (id: string) => api<{ ok: true }>(`/api/guides/${enc(id)}`, { method: "DELETE" }),
  setDefaultGuide: (guide: string) => api<Profile>("/api/guides/default", { method: "PUT", body: { guide } }),
  nowNext: (ids?: string[]) => api<{ items: NowNext[] }>(`/api/nownext${q({ ids: ids?.join(",") })}`),
  programme: (id: string) => api<ProgrammeInfo>(`/api/programmes/${enc(id)}`),
  setChannel: (id: string, patch: { favourite?: boolean; hidden?: boolean }) => api<Channel>(`/api/channels/${enc(id)}`, { method: "PATCH", body: patch }),

  planner: () => api<Planner>("/api/recordings"),
  record: (programmeId: string) => api<Recording>("/api/recordings", { method: "POST", body: { programmeId } }),
  deleteRecording: (id: string) => api<{ ok: true }>(`/api/recordings/${enc(id)}`, { method: "DELETE" }),
  markWatched: (id: string, watched: boolean) => api<{ ok: true }>(`/api/recordings/${enc(id)}/watched`, { method: "POST", body: { watched } }),
  seriesLink: (programmeId: string) => api<SeriesLink>("/api/series-links", { method: "POST", body: { programmeId } }),
  updateSeriesLink: (id: string, patch: Partial<SeriesLink>) => api<SeriesLink>(`/api/series-links/${enc(id)}`, { method: "PATCH", body: patch }),
  deleteSeriesLink: (id: string) => api<{ ok: true }>(`/api/series-links/${enc(id)}`, { method: "DELETE" }),
  remind: (programmeId: string) => api<Reminder>("/api/reminders", { method: "POST", body: { programmeId } }),
  deleteReminder: (id: string) => api<{ ok: true }>(`/api/reminders/${enc(id)}`, { method: "DELETE" }),

  play: (req: PlaybackRequest & { force?: boolean }) => api<PlaybackInfo>("/api/play", { method: "POST", body: req }),
  prefetch: (req: PlaybackRequest) => api<{ ok: boolean }>("/api/play/prefetch", { method: "POST", body: req }),
  progress: (body: { key: string; positionMs: number; durationMs?: number; event?: "start" | "progress" | "stop"; paused?: boolean; title?: TitleRef }) =>
    api<{ ok: true }>("/api/progress", { method: "POST", body }),

  // Continue watching card actions (issue #100).
  hideFromContinue: (id: string, hidden: boolean) => api<{ ok: true; hidden: boolean }>(`/api/continue/${enc(id)}/hide`, { method: "POST", body: { hidden } }),
  markContinueWatched: (id: string, watched = true) => api<{ ok: true; watched: boolean }>(`/api/continue/${enc(id)}/watched`, { method: "POST", body: { watched } }),

  // Home rows: which rows this profile shows, and in what order (#99).
  homeRows: () => api<HomeRowsView>("/api/home/rows"),
  // Radio and podcasts (#86). Playing one answers with a PlaybackInfo the TV hands to the box,
  // so nothing here needs the player to learn a new kind of request.
  radio: () => api<RadioReply>("/api/radio"),
  radioNow: (id: string) => api<RadioNow>(`/api/radio/${enc(id)}/now`),
  radioPlay: (id: string) => api<PlaybackInfo>(`/api/radio/${enc(id)}/play`),
  addStation: (name: string, url: string) => api<{ station: RadioStation; stations: RadioStation[] }>("/api/radio", { method: "POST", body: { name, url } }),
  removeStation: (id: string) => api<{ ok: true; stations: RadioStation[] }>(`/api/radio/${enc(id)}`, { method: "DELETE" }),
  podcasts: () => api<PodcastsReply>("/api/podcasts"),
  podcast: (id: string) => api<PodcastShowWithEpisodes>(`/api/podcasts/${enc(id)}`),
  podcastSearch: (q: string) => api<{ results: PodcastSearchResult[] }>(`/api/podcasts/search?q=${enc(q)}`),
  followPodcast: (feedUrl: string) => api<{ show: PodcastShow; shows: PodcastShow[] }>("/api/podcasts", { method: "POST", body: { feedUrl } }),
  unfollowPodcast: (id: string) => api<{ ok: true; shows: PodcastShow[] }>(`/api/podcasts/${enc(id)}`, { method: "DELETE" }),
  podcastPlay: (showId: string, episodeId: string, fromStart = false) => api<PlaybackInfo>(`/api/podcasts/${enc(showId)}/${enc(episodeId)}/play${fromStart ? "?from=start" : ""}`),
  podcastPosition: (episodeId: string, positionMs: number, durationMs?: number) => api<{ ok: true; resumeFrom: number }>(`/api/podcasts/${enc(episodeId)}/position`, { method: "POST", body: { positionMs, ...(durationMs ? { durationMs } : {}) } }),
  setHomeRows: (body: { order?: HomeRowId[]; hidden?: HomeRowId[]; preset?: "everything" | "simple" }) =>
    api<HomeRowsView>("/api/home/rows", { method: "PATCH", body }),

  downloads: () => api<{ downloads: Download[] }>("/api/downloads"),
  download: (titleId: string, episodeId?: string, streamId?: string) => api<Download>("/api/downloads", { method: "POST", body: { titleId, episodeId, streamId } }),
  deleteDownload: (id: string) => api<{ ok: true }>(`/api/downloads/${enc(id)}`, { method: "DELETE" }),

  mixChannels: () => api<MixOverview>("/api/mix-channels"),
  mixChannel: (id: string) => api<{ channel: MixChannelInfo; videos: MixEntry[] }>(`/api/mix-channels/${enc(id)}`),
  createMix: (body: Partial<MixChannel>) => api<MixChannelInfo>("/api/mix-channels", { method: "POST", body }),
  updateMix: (id: string, patch: Partial<MixChannel>) => api<MixChannelInfo>(`/api/mix-channels/${enc(id)}`, { method: "PATCH", body: patch }),
  deleteMix: (id: string) => api<{ ok: true }>(`/api/mix-channels/${enc(id)}`, { method: "DELETE" }),
  curateMix: (id: string) => api<{ ok: true }>(`/api/mix-channels/${enc(id)}/curate`, { method: "POST" }),
  shuffleMix: (id: string) => api<{ ok: true }>(`/api/mix-channels/${enc(id)}/shuffle`, { method: "POST" }),
  browseNas: (dir?: string) => api<NasListing>(`/api/mix/nas${q({ dir })}`),
  addMixFiles: (id: string, paths: string[]) => api<{ added: number; skipped: string[] }>(`/api/mix-channels/${enc(id)}/files`, { method: "POST", body: { paths } }),
  followMixPlaylist: (id: string, url: string) => api<MixPlaylist>(`/api/mix-channels/${enc(id)}/playlists`, { method: "POST", body: { url } }),
  syncMixPlaylist: (id: string, listId: string) => api<{ ok: true }>(`/api/mix-channels/${enc(id)}/playlists/${enc(listId)}/sync`, { method: "POST" }),
  unfollowMixPlaylist: (id: string, listId: string, keep: boolean) => api<{ ok: true }>(`/api/mix-channels/${enc(id)}/playlists/${enc(listId)}${keep ? "?keep=1" : ""}`, { method: "DELETE" }),
  removeMixVideo: (id: string, videoId: string) => api<{ ok: true }>(`/api/mix-channels/${enc(id)}/videos/${enc(videoId)}`, { method: "DELETE" }),

  settings: () => api<PublicSettings>("/api/settings"),
  /** Source options (#219). A source is its key from PublicSettings.providerOrder ("iptv:<id>", "jellyfin", …). */
  testSource: (key: string) => api<SourceTestResult>(`/api/sources/${enc(key)}/test`, { method: "POST" }),
  pauseSource: (key: string, paused: boolean) => api<PublicSettings>(`/api/sources/${enc(key)}/pause`, { method: "POST", body: { paused } }),
  orderSources: (order: string[]) => api<PublicSettings>("/api/sources/order", { method: "PUT", body: { order } }),
  removeSource: (key: string) => api<PublicSettings>(`/api/sources/${enc(key)}`, { method: "DELETE" }),
  screensaver: () => api<ScreensaverInfo>("/api/screensaver"),
  screensaverPhotos: () => api<{ photos: ScreensaverPhoto[] }>("/api/screensaver/photos"),
  art: () => api<ArtStatus>("/api/art"),
  artItems: (kids: boolean) => api<{ items: ArtItem[] }>(`/api/art/items${q({ kids: kids ? "1" : undefined })}`),
  artRefresh: () => api<{ ok: boolean }>("/api/art/refresh", { method: "POST" }),
  artClear: () => api<{ ok: boolean }>("/api/art", { method: "DELETE" }),
  browsePhotos: (dir?: string) => api<NasListing>(`/api/screensaver/nas${q({ dir })}`),
  saveSettings: (patch: Partial<Pick<Settings, "recording" | "playback" | "appName" | "theme" | "seasonal" | "radio">> & { screensaver?: Partial<ScreensaverSettings> }) => api<PublicSettings>("/api/settings", { method: "PUT", body: patch }),

  // Sources (Settings › Sources): everything that changes the household's setup needs an adult
  // profile (and its PIN once one is set), so a call can fail with code "pin".
  saveSources: (patch: { addonUrls?: string[]; torboxApiKey?: string }) => api<PublicSettings>("/api/settings", { method: "PUT", body: patch }),
  addIptv: (source: { kind: "m3u"; url: string; name?: string } | { kind: "xtream"; url: string; username: string; password: string; name?: string }) => api<PublicSettings>("/api/settings/iptv", { method: "POST", body: source }),
  removeIptv: (id: string) => api<PublicSettings>(`/api/settings/iptv/${enc(id)}`, { method: "DELETE" }),
  /** Jellyfin and Plex servers answering on the home network (an empty list when none do). */
  discoverServers: () => api<{ servers: { kind: "jellyfin" | "plex"; id: string; name: string; url: string }[] }>("/api/discover"),
  jellyfinQuickConnect: (url: string) => api<{ code: string; secret: string }>("/api/jellyfin/quickconnect", { method: "POST", body: { url } }),
  jellyfinQuickConnectCheck: (secret: string, url: string) => api<{ authenticated: boolean }>(`/api/jellyfin/quickconnect/${enc(secret)}${q({ url })}`),
  jellyfinLogin: (url: string, username: string, password: string) => api<{ ok: true }>("/api/jellyfin/login", { method: "POST", body: { url, username, password } }),
  removeJellyfin: () => api<{ ok: true }>("/api/jellyfin", { method: "DELETE" }),
  plexPin: () => api<{ id: number; code: string; authUrl: string }>("/api/plex/pin", { method: "POST" }),
  /** `url` is the chosen server; without it the Hub uses the first one plex.tv lists. */
  plexPinCheck: (id: number, url?: string) => api<{ authenticated: boolean; plex?: { url: string; serverName?: string } }>(`/api/plex/pin/${id}${q({ url })}`),
  removePlex: () => api<{ ok: true }>("/api/plex", { method: "DELETE" }),

  /** Jump scares: the settings and clips the Hub keeps, and setting one off now. */
  scares: () => api<ScareState>("/api/scares"),
  saveScares: (patch: Partial<ScareSettings>) => api<ScareState>("/api/scares", { method: "PUT", body: patch }),
  scareNow: (clipId?: string) => api<{ scare: Scare }>("/api/scares/now", { method: "POST", body: clipId ? { clipId } : {} }),
  startClipLoop: () => api<ScareState>("/api/scares/loop", { method: "POST", body: {} }),
  clipLibrary: () => api<ClipLibrary>("/api/scares/library"),
  installClipPack: (id: string, from: "starter" | "community") => api<ScareState>("/api/scares/library/install", { method: "POST", body: { id, from } }),
  stopClipLoop: () => api<ScareState>("/api/scares/loop", { method: "POST", body: { theme: null } }),
  refresh: () => api<{ ok: true }>("/api/refresh", { method: "POST" }),
  reportBox: (state: Omit<BoxState, "reportedAt">) => api<{ ok: true }>("/api/box/state", { method: "POST", body: state }),
  /** The Hub's own version, checked against GitHub's main. */
  changelog: () => api<Changelog>("/api/changelog"),
  hubSoftware: () => api<{ hub: HubSoftware }>("/api/software?check=1").then((r) => r.hub),
  updateHub: () => api<{ ok: true }>("/api/software/hub/update", { method: "POST" }),
  /** The last on-box self-test (#105), kept on the Hub for the phone and /api/diagnostics. */
  selfTest: () => api<{ report: SelfTestReport | null }>("/api/selftest"),
  saveSelfTest: (report: SelfTestReport) => api<{ ok: true; report: SelfTestReport }>("/api/selftest", { method: "POST", body: report }),
  clearSelfTest: () => api<{ ok: true }>("/api/selftest", { method: "DELETE" }),
  /** The TV app's own timings (#108), kept on the Hub for the phone and /api/diagnostics. */
  perf: () => api<{ report: PerfReport | null }>("/api/perf"),
  savePerf: (report: PerfReport) => api<{ ok: true; report: PerfReport }>("/api/perf", { method: "POST", body: report }),
  clearPerf: () => api<{ ok: true }>("/api/perf", { method: "DELETE" }),

  /** The nightly backup of the Hub's data to the NAS. */
  backup: () => api<BackupState>("/api/backup"),
  backupNow: () => api<BackupState>("/api/backup", { method: "POST" }),

  /** Phones and screens paired with the TV, and the code that pairs another. */
  devices: () => api<DeviceList>("/api/devices"),
  pairCode: () => api<PairingCode>("/api/pair/code"),
  renameDevice: (id: string, name: string) => api<PairedDevice>(`/api/devices/${enc(id)}`, { method: "PATCH", body: { name } }),
  removeDevice: (id: string) => api<{ ok: true }>(`/api/devices/${enc(id)}`, { method: "DELETE" }),
  letScreenIn: (id: string) => api<PairedDevice>(`/api/devices/pending/${enc(id)}`, { method: "POST" }),
  turnScreenAway: (id: string) => api<{ ok: boolean }>(`/api/devices/pending/${enc(id)}`, { method: "DELETE" }),
  apiKey: (fresh = false) => api<{ key: string }>("/api/pair/api-key", fresh ? { method: "POST" } : {}),

  // Watchlist ("Save for later"), per profile.
  watchlist: () => api<{ items: WatchItem[] }>("/api/watchlist"),
  saveForLater: (input: WatchlistInput) => api<{ item: WatchItem; items: WatchItem[] }>("/api/watchlist", { method: "POST", body: { from: "tv", ...input } }),
  // Favourites (films, shows and guide channels), per profile.
  favourites: () => api<Favourites>("/api/favourites"),
  favourite: (input: FavouriteInput) => api<FavouriteResult>("/api/favourites", { method: "POST", body: input }),
  requests: () => api<RequestsView>("/api/requests"),
  request: (title: TitleRef) => api<{ request: TitleRequest; fresh: boolean }>("/api/requests", { method: "POST", body: { title } }),
  answerRequest: (id: string, answer: "approve" | "decline") => api<{ request: TitleRequest }>(`/api/requests/${enc(id)}/answer`, { method: "POST", body: { answer } }),
  following: () => api<FollowingView>("/api/following"),
  follow: (title: TitleRef) => api<FollowingView>("/api/following", { method: "POST", body: { title } }),
  unfollow: (title: TitleRef) => api<FollowingView>(`/api/following/${enc(title.id)}?name=${enc(title.name)}`, { method: "DELETE" }),
  setFollowPopups: (on: boolean) => api<{ popups: boolean }>("/api/following/popups", { method: "PUT", body: { on } }),
  unsave: (id: string) => api<{ ok: boolean; items: WatchItem[] }>(`/api/watchlist/${enc(id)}`, { method: "DELETE" }),

  // Recent searches, per profile.
  recentSearches: () => api<{ searches: RecentSearch[] }>("/api/search/history"),
  rememberSearch: (q: string) => api<{ searches: RecentSearch[] }>("/api/search/history", { method: "POST", body: { q } }),
  forgetSearch: (q: string) => api<{ searches: RecentSearch[] }>(`/api/search/history?q=${enc(q)}`, { method: "DELETE" }),
  clearSearches: () => api<{ searches: RecentSearch[] }>("/api/search/history", { method: "DELETE" }),

  // Audio and subtitle choice per series, per profile.
  trackPref: (title: string) => api<{ pref: TrackPref | null }>(`/api/track-prefs?title=${enc(title)}`),
  saveTrackPref: (body: { title: string; audio?: TrackPref["audio"]; subtitle?: TrackPref["subtitle"] }) => api<{ pref: TrackPref }>("/api/track-prefs", { method: "PUT", body }),
  clearTrackPref: (title: string) => api<{ ok: boolean }>(`/api/track-prefs?title=${enc(title)}`, { method: "DELETE" }),

  // Alerts.
  alerts: () => api<AlertState>("/api/alerts"),
  saveAlerts: (patch: Partial<AlertSettings>) => api<AlertState>("/api/alerts/settings", { method: "PUT", body: patch }),
  checkAlerts: () => api<AlertState>("/api/alerts/check", { method: "POST" }),
  testAlert: () => api<{ ok: true }>("/api/alerts/test", { method: "POST" }),
  weather: () => api<WeatherState>("/api/weather"),
  saveWeather: (patch: Partial<WeatherSettings>) => api<WeatherState>("/api/weather/settings", { method: "PUT", body: patch }),
  weatherPlaces: (q: string) => api<{ places: WeatherPlace[] }>(`/api/weather/places${q ? `?q=${enc(q)}` : ""}`),
  refreshWeather: () => api<WeatherState>("/api/weather/refresh", { method: "POST" }),
  // Home Assistant playback events (the webhook; the media player side needs no setting).
  haSettings: () => api<{ settings: HaSettings; events: HaEvent[] }>("/api/ha/settings"),
  saveHa: (patch: Partial<HaSettings>) => api<{ settings: HaSettings; events: HaEvent[] }>("/api/ha/settings", { method: "PUT", body: patch }),
  testHa: () => api<{ ok: true }>("/api/ha/test", { method: "POST" }),
  playbackFailed: (what: string, error?: string) => api<{ told: boolean }>("/api/alerts/playback", { method: "POST", body: { what, ...(error ? { error } : {}) } }),

  // Advert skipping on recordings.
  adskip: () => api<{ settings: AdSkipSettings; installed: boolean | null; advertScan?: AdvertScan }>("/api/adskip"),
  saveAdskip: (patch: Partial<AdSkipSettings>) => api<{ settings: AdSkipSettings; installed: boolean | null; advertScan?: AdvertScan }>("/api/adskip", { method: "PUT", body: patch }),

  // Other screens: settings, and the TV's side of a laptop's screen share.
  castSettings: () => api<{ settings: CastSettings; shareUrl: string | null }>("/api/cast/settings"),
  saveCastSettings: (patch: Partial<CastSettings>) => api<{ settings: CastSettings; shareUrl: string | null }>("/api/cast/settings", { method: "PUT", body: patch }),
  answerShare: (id: string, sdp: string) => api<ShareSession>(`/api/cast/share/${enc(id)}/answer`, { method: "POST", body: { sdp } }),
  refuseShare: (id: string, reason: string) => api<ShareSession>(`/api/cast/share/${enc(id)}/refuse`, { method: "POST", body: { reason } }),
  endShare: (id: string) => api<{ ok: boolean }>(`/api/cast/share/${enc(id)}/end`, { method: "POST" }),

  // Seasonal projections.
  projections: () => api<ProjectionState & { communityUrl: string }>("/api/projections"),
  saveProjections: (patch: Partial<ProjectionSettings>) => api<ProjectionState & { communityUrl: string }>("/api/projections", { method: "PUT", body: patch }),
  projectionNow: (want: { clipId?: string; drawn?: DrawnProjection; season?: SeasonId } = {}) => api<{ ok: true }>("/api/projections/now", { method: "POST", body: want }),
  community: () => api<CommunityIndex>("/api/community/clips"),
  downloadCommunity: (id: string) => api<{ library: CommunityIndex }>(`/api/community/clips/${enc(id)}/download`, { method: "POST" }),
};

/** Live updates from the Hub. Reconnects on its own. */
export function connectEvents(onEvent: (e: HubEvent) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  const open = () => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/events`;
    socket = new WebSocket(url);
    socket.onopen = () => (delay = 1000);
    socket.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as HubEvent);
      } catch {
        // Ignore anything that isn't an event.
      }
    };
    socket.onclose = () => {
      if (closed) return;
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 30_000);
    };
  };
  open();
  return () => {
    closed = true;
    socket?.close();
  };
}
