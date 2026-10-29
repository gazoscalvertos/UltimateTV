// Talks to the Hub. Every request carries the current profile so the Hub can filter for Kids.

import type { BoxState, Channel, Conflict, CustomGuide, DeviceList, Download, GuideChoices, GuideWindow, HomeScreen, HubEvent, HubSoftware, HubStatus, MixChannel, MixChannelInfo, MixEntry, MixOverview, NasListing, NowNext, PairedDevice, PairingCode, PlaybackInfo, PlaybackRequest, Profile, Programme, PublicSettings, Rail, ScreensaverInfo, ScreensaverPhoto, ScreensaverSettings, Recording, Reminder, Scare, ScareSettings, ScareState, SearchResult, Season, SeriesLink, Settings, StreamCandidate, TitleDetails, TitleRef } from "@ultimatetv/shared";

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
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status, data.code, data.recordings ?? []);
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
  profiles: () => api<{ profiles: Profile[]; locked: boolean; current: string | null; admin: boolean }>("/api/profiles"),
  unlock: (id: string, pin?: string) => api<{ token: string; profile: Profile }>(`/api/profiles/${enc(id)}/unlock`, { method: "POST", body: { pin } }),
  createProfile: (name: string, kind: Profile["kind"]) => api<Profile>("/api/profiles", { method: "POST", body: { name, kind } }),
  updateProfile: (id: string, patch: Partial<Profile> & { pin?: string | null }) => api<Profile>(`/api/profiles/${enc(id)}`, { method: "PATCH", body: patch }),
  deleteProfile: (id: string) => api<{ ok: true }>(`/api/profiles/${enc(id)}`, { method: "DELETE" }),

  home: () => api<HomeScreen>("/api/home"),
  browse: (kind: "movie" | "series") => api<{ rails: Rail[] }>(`/api/browse/${kind}`),
  title: (id: string) => api<TitleDetails>(`/api/titles/${enc(id)}`),
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
  findAdverts: (id: string) => api<{ ok: true }>(`/api/recordings/${enc(id)}/adverts`, { method: "POST" }),
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
  removeMixVideo: (id: string, videoId: string) => api<{ ok: true }>(`/api/mix-channels/${enc(id)}/videos/${enc(videoId)}`, { method: "DELETE" }),

  settings: () => api<PublicSettings>("/api/settings"),
  screensaver: () => api<ScreensaverInfo>("/api/screensaver"),
  screensaverPhotos: () => api<{ photos: ScreensaverPhoto[] }>("/api/screensaver/photos"),
  browsePhotos: (dir?: string) => api<NasListing>(`/api/screensaver/nas${q({ dir })}`),
  saveSettings: (patch: Partial<Pick<Settings, "recording" | "playback" | "appName" | "theme">> & { screensaver?: Partial<ScreensaverSettings> }) => api<PublicSettings>("/api/settings", { method: "PUT", body: patch }),

  /** Jump scares: the settings and clips the Hub keeps, and setting one off now. */
  scares: () => api<ScareState>("/api/scares"),
  saveScares: (patch: Partial<ScareSettings>) => api<ScareState>("/api/scares", { method: "PUT", body: patch }),
  scareNow: (clipId?: string) => api<{ scare: Scare }>("/api/scares/now", { method: "POST", body: clipId ? { clipId } : {} }),
  refresh: () => api<{ ok: true }>("/api/refresh", { method: "POST" }),
  reportBox: (state: Omit<BoxState, "reportedAt">) => api<{ ok: true }>("/api/box/state", { method: "POST", body: state }),
  /** The Hub's own version, checked against GitHub's main. */
  hubSoftware: () => api<{ hub: HubSoftware }>("/api/software?check=1").then((r) => r.hub),
  updateHub: () => api<{ ok: true }>("/api/software/hub/update", { method: "POST" }),

  /** Phones and screens paired with the TV, and the code that pairs another. */
  devices: () => api<DeviceList>("/api/devices"),
  pairCode: () => api<PairingCode>("/api/pair/code"),
  renameDevice: (id: string, name: string) => api<PairedDevice>(`/api/devices/${enc(id)}`, { method: "PATCH", body: { name } }),
  removeDevice: (id: string) => api<{ ok: true }>(`/api/devices/${enc(id)}`, { method: "DELETE" }),
  letScreenIn: (id: string) => api<PairedDevice>(`/api/devices/pending/${enc(id)}`, { method: "POST" }),
  turnScreenAway: (id: string) => api<{ ok: boolean }>(`/api/devices/pending/${enc(id)}`, { method: "DELETE" }),
  apiKey: (fresh = false) => api<{ key: string }>("/api/pair/api-key", fresh ? { method: "POST" } : {}),
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
