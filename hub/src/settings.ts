import { cleanLook, DEFAULT_APP_NAME, DEFAULT_SCREENSAVER, resolveTheme, type IptvSource, type IptvSourceStatus, type PublicSettings, type Settings } from "@ultimatetv/shared";
import type { Db } from "./db.js";

export function defaultSettings(mediaRoot = "/mnt/nas"): Settings {
  return {
    appName: DEFAULT_APP_NAME,
    // Dark, with the seasonal themes on (see cleanLook).
    theme: "auto",
    iptv: [],
    xmltvUrls: [],
    addonUrls: [],
    library: {
      moviesPath: `${mediaRoot}/Movies`,
      tvPath: `${mediaRoot}/TV`,
      recordingsPath: `${mediaRoot}/Recordings`,
      inboxPath: `${mediaRoot}/Inbox`,
      musicVideosPath: `${mediaRoot}/Music Videos`,
    },
    recording: {
      paddingBeforeMin: 2,
      paddingAfterMin: 5,
      preferCatchup: true,
      autoDeleteWatchedDays: 0,
    },
    playback: {
      preferredAudioLang: "eng",
      preferredSubtitleLang: "eng",
      subtitlesByDefault: false,
      maxSizeGb: 60,
      avoidDvProfile5: true,
      autoplayNext: true,
      startOn: "home",
    },
    numbering: "uk",
    channelFilter: "^(UK|GB|United Kingdom)\\b|\\b(UK|GB)\\b",
    screensaver: { ...DEFAULT_SCREENSAVER },
  };
}

/** Settings seeded from environment variables, so a compose file can configure the Hub without the phone page. */
export function settingsFromEnv(env: NodeJS.ProcessEnv, base: Settings): Settings {
  const s: Settings = structuredClone(base);
  if (env.XTREAM_URL && env.XTREAM_USER && env.XTREAM_PASS && !s.iptv.some((x) => x.kind === "xtream")) {
    s.iptv.push({
      id: "xtream1",
      kind: "xtream",
      name: env.XTREAM_NAME ?? "IPTV",
      url: env.XTREAM_URL.replace(/\/+$/, ""),
      username: env.XTREAM_USER,
      password: env.XTREAM_PASS,
      connections: Number(env.XTREAM_CONNECTIONS ?? 1),
    });
  }
  if (env.M3U_URL && !s.iptv.some((x) => x.kind === "m3u")) {
    s.iptv.push({ id: "m3u1", kind: "m3u", name: env.M3U_NAME ?? "Playlist", url: env.M3U_URL, connections: Number(env.M3U_CONNECTIONS ?? 1) });
  }
  if (env.XMLTV_URLS) s.xmltvUrls = [...new Set([...s.xmltvUrls, ...env.XMLTV_URLS.split(/[\s,]+/).filter(Boolean)])];
  if (env.TMDB_API_KEY) s.tmdbApiKey = env.TMDB_API_KEY;
  if (env.TORBOX_API_KEY) s.torboxApiKey = env.TORBOX_API_KEY;
  if (env.ADDON_URLS) s.addonUrls = [...new Set([...s.addonUrls, ...env.ADDON_URLS.split(/[\s,]+/).filter(Boolean)])];
  if (env.MOVIES_PATH) s.library.moviesPath = env.MOVIES_PATH;
  if (env.TV_PATH) s.library.tvPath = env.TV_PATH;
  if (env.RECORDINGS_PATH) s.library.recordingsPath = env.RECORDINGS_PATH;
  if (env.INBOX_PATH) s.library.inboxPath = env.INBOX_PATH;
  if (env.MUSIC_VIDEOS_PATH) s.library.musicVideosPath = env.MUSIC_VIDEOS_PATH;
  return s;
}

export class SettingsStore {
  private cache: Settings;
  private listeners = new Set<(s: Settings) => void>();

  constructor(
    private db: Db,
    defaults: Settings,
  ) {
    const saved = db.getKv<Partial<Settings>>("settings");
    this.cache = mergeSettings(defaults, saved ?? {});
    // Older Hubs let the same source be added twice; drop the copies once, on start.
    const unique = dedupeSources(this.cache.iptv);
    if (unique.length !== this.cache.iptv.length) {
      this.cache = { ...this.cache, iptv: unique };
      db.setKv("settings", this.cache);
    }
  }

  get(): Settings {
    return this.cache;
  }

  update(patch: Partial<Settings>): Settings {
    this.cache = mergeSettings(this.cache, patch);
    this.db.setKv("settings", this.cache);
    for (const l of this.listeners) l(this.cache);
    return this.cache;
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connectionLimit(): number {
    const sources = this.cache.iptv;
    if (sources.length === 0) return 1;
    // The guard is per provider; with several providers the smallest limit is the safe one to share.
    return Math.max(1, Math.min(...sources.map((s) => s.connections || 1)));
  }
}

/** Two sources are the same when they reach the same provider account: kind, address and (for Xtream) username. */
export function sourceKey(src: Pick<IptvSource, "kind" | "url"> & { username?: string }): string {
  let url = src.url.trim();
  try {
    const u = new URL(url);
    url = `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    url = url.replace(/\/+$/, "");
  }
  return src.kind === "xtream" ? `xtream|${url}|${(src.username ?? "").trim().toLowerCase()}` : `m3u|${url}`;
}

/** Keeps the first of each source, in order. */
export function dedupeSources(sources: IptvSource[]): IptvSource[] {
  const seen = new Set<string>();
  return sources.filter((src) => {
    const key = sourceKey(src);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  return {
    ...base,
    ...patch,
    library: { ...base.library, ...patch.library },
    recording: { ...base.recording, ...patch.recording },
    playback: { ...base.playback, ...patch.playback },
    screensaver: { ...base.screensaver, ...patch.screensaver },
  };
}

export function publicSettings(s: Settings, setupUrl: string, statusOf?: (sourceId: string) => IptvSourceStatus | undefined): PublicSettings {
  const look = cleanLook(s);
  const result: PublicSettings = {
    appName: s.appName,
    ...look,
    themeNow: resolveTheme(look),
    iptv: s.iptv.map((src: IptvSource) => {
      const entry: PublicSettings["iptv"][number] = { id: src.id, kind: src.kind, name: src.name, connections: src.connections, host: hostOf(src.url) };
      const status = statusOf?.(src.id);
      if (status) entry.status = status;
      return entry;
    }),
    xmltvCount: s.xmltvUrls.length,
    tmdb: Boolean(s.tmdbApiKey),
    addons: s.addonUrls.map((url) => ({ url: redactAddonUrl(url), name: addonName(url) })),
    torbox: Boolean(s.torboxApiKey),
    recording: s.recording,
    playback: s.playback,
    numbering: s.numbering,
    channelFilter: s.channelFilter,
    library: s.library,
    screensaver: s.screensaver,
    setupUrl,
  };
  if (s.jellyfin) {
    result.jellyfin = { url: s.jellyfin.url };
    if (s.jellyfin.serverName) result.jellyfin.serverName = s.jellyfin.serverName;
  }
  return result;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** AIOStreams URLs embed the user's config (and debrid keys) in the path, so only the host is shown. */
export function redactAddonUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…/manifest.json`;
  } catch {
    return "addon";
  }
}

function addonName(url: string): string {
  const host = hostOf(url);
  if (/aiostreams/i.test(url)) return "AIOStreams";
  if (/torrentio/i.test(host)) return "Torrentio";
  if (/comet/i.test(host)) return "Comet";
  return host;
}
