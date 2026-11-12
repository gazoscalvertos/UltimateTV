// The programs a Request goes to (issue #225): Jellyseerr/Overseerr (one API for films and series)
// or Radarr (films) and Sonarr (series) directly. Each is asked to add a title and, later, how it
// is getting on. Every client takes a `fetch` so tests can fake it.

import type { PublicRequestSettings, RequestSettings, RequestTestResult, RequestVia } from "@ultimatetv/shared";
import { fetchJson, fetchOk, HttpError, type Fetch } from "../http.js";

/** Where a request got to in the program that holds it. */
export type BackendStatus = "requested" | "downloading" | "ready" | "declined" | "gone";

export interface Backend {
  /** "Jellyseerr", "Radarr": for the notes on a request. */
  name: string;
  /** Adds the title; returns what the program calls it, to ask about later. */
  submit(kind: "movie" | "series", tmdbId: number, name: string): Promise<string>;
  status(kind: "movie" | "series", ref: string): Promise<BackendStatus>;
}

const base = (url: string) => url.trim().replace(/\/+$/, "");
const headers = (apiKey: string) => ({ "X-Api-Key": apiKey, Accept: "application/json" });
const json = (apiKey: string, body: unknown): RequestInit => ({ method: "POST", headers: { ...headers(apiKey), "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** What a program said when it refused, in a line a person can read. */
export function explain(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return "It didn't accept the API key";
    if (err.status === 404) return "That address isn't right (no API at it)";
    return err.message;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNREFUSED|ENOTFOUND|timeout|aborted/i.test(msg) ? "Couldn't reach it: check the address" : msg;
}

// ---------------------------------------------------------------------------
// Jellyseerr / Overseerr

export class JellyseerrClient implements Backend {
  readonly name = "Jellyseerr";
  constructor(
    private readonly cfg: { url: string; apiKey: string },
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private get<T>(path: string): Promise<T> {
    return fetchJson<T>(`${base(this.cfg.url)}/api/v1${path}`, this.fetchImpl, { headers: headers(this.cfg.apiKey) }, 15_000);
  }

  /** The status page needs no key, so the key is checked with a call that does. */
  async test(): Promise<string> {
    const st = await fetchJson<{ version?: string }>(`${base(this.cfg.url)}/api/v1/status`, this.fetchImpl, {}, 10_000);
    await this.get("/auth/me");
    return `Jellyseerr/Overseerr ${st.version ?? ""}`.trim();
  }

  async submit(kind: "movie" | "series", tmdbId: number): Promise<string> {
    try {
      await fetchOk(`${base(this.cfg.url)}/api/v1/request`, this.fetchImpl, json(this.cfg.apiKey, kind === "movie" ? { mediaType: "movie", mediaId: tmdbId } : { mediaType: "tv", mediaId: tmdbId, seasons: "all" }), 15_000);
    } catch (err) {
      // Somebody already asked for it: that's what was wanted, and it is followed the same way.
      if (!(err instanceof HttpError && err.status === 409)) throw err;
    }
    return String(tmdbId);
  }

  /** Jellyseerr's media status: 2 pending, 3 processing, 4 partly there, 5 there; a request's own status 3 is declined. */
  async status(kind: "movie" | "series", ref: string): Promise<BackendStatus> {
    let d: { mediaInfo?: { status?: number; requests?: { status?: number }[] } };
    try {
      d = await this.get(`/${kind === "movie" ? "movie" : "tv"}/${encodeURIComponent(ref)}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return "gone";
      throw err;
    }
    const info = d.mediaInfo;
    if (!info) return "gone";
    if (info.status === 5 || info.status === 4) return "ready";
    if (info.status === 3) return "downloading";
    const asked = info.requests ?? [];
    if (asked.length && asked.every((r) => r.status === 3)) return "declined";
    return "requested";
  }
}

// ---------------------------------------------------------------------------
// Radarr and Sonarr (the same API, different words)

interface ArrCfg {
  url: string;
  apiKey: string;
  qualityProfileId?: number;
  rootFolder?: string;
}

abstract class ArrClient {
  abstract readonly name: string;
  constructor(
    protected readonly cfg: ArrCfg,
    protected readonly fetchImpl: Fetch = fetch,
  ) {}

  protected get<T>(path: string): Promise<T> {
    return fetchJson<T>(`${base(this.cfg.url)}/api/v3${path}`, this.fetchImpl, { headers: headers(this.cfg.apiKey) }, 15_000);
  }

  protected post<T>(path: string, body: unknown): Promise<T> {
    return fetchJson<T>(`${base(this.cfg.url)}/api/v3${path}`, this.fetchImpl, json(this.cfg.apiKey, body), 20_000);
  }

  async test(): Promise<string> {
    const st = await this.get<{ appName?: string; version?: string }>("/system/status");
    // A title can't be added without a quality profile and a folder, so a program with none is called out now.
    const [profiles, roots] = await Promise.all([this.get<{ id: number }[]>("/qualityprofile"), this.get<{ path: string }[]>("/rootfolder")]);
    if (!profiles.length) throw new Error("It has no quality profile yet: make one in its Settings › Profiles");
    if (!roots.length) throw new Error("It has no root folder yet: add one in its Settings › Media Management");
    return `${st.appName ?? this.name} ${st.version ?? ""}`.trim();
  }

  /** The profile and folder to add with: the ones chosen in settings, else the program's first. */
  protected async defaults(): Promise<{ qualityProfileId: number; rootFolderPath: string }> {
    const qualityProfileId = this.cfg.qualityProfileId ?? (await this.get<{ id: number }[]>("/qualityprofile"))[0]?.id;
    const rootFolderPath = this.cfg.rootFolder ?? (await this.get<{ path: string }[]>("/rootfolder"))[0]?.path;
    if (!qualityProfileId || !rootFolderPath) throw new Error(`${this.name} has no quality profile or root folder to add it with`);
    return { qualityProfileId, rootFolderPath };
  }

  /** What the program is downloading, by the id of the film or series each download belongs to. */
  protected async queued(field: "movieId" | "seriesId"): Promise<Set<number>> {
    const q = await this.get<{ records?: Record<string, number>[] }>("/queue?page=1&pageSize=200").catch(() => ({ records: [] as Record<string, number>[] }));
    return new Set((q.records ?? []).map((r) => r[field]).filter((n): n is number => typeof n === "number"));
  }
}

export class RadarrClient extends ArrClient implements Backend {
  readonly name = "Radarr";

  async submit(_kind: "movie" | "series", tmdbId: number): Promise<string> {
    const found = await this.get<{ id?: number }[]>(`/movie?tmdbId=${tmdbId}`).catch(() => []);
    if (found[0]?.id) return String(found[0].id);
    const look = await this.get<Record<string, unknown>>(`/movie/lookup/tmdb?tmdbId=${tmdbId}`);
    const added = await this.post<{ id: number }>("/movie", { ...look, ...(await this.defaults()), monitored: true, minimumAvailability: "released", addOptions: { searchForMovie: true } });
    return String(added.id);
  }

  async status(_kind: "movie" | "series", ref: string): Promise<BackendStatus> {
    let m: { hasFile?: boolean; monitored?: boolean };
    try {
      m = await this.get(`/movie/${encodeURIComponent(ref)}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return "gone";
      throw err;
    }
    if (m.hasFile) return "ready";
    return (await this.queued("movieId")).has(Number(ref)) ? "downloading" : "requested";
  }
}

export class SonarrClient extends ArrClient implements Backend {
  readonly name = "Sonarr";

  /** Sonarr finds series by their TheTVDB id, which TMDB knows. */
  constructor(
    cfg: ArrCfg,
    private readonly tvdbOf: (tmdbId: number) => Promise<number | undefined>,
    fetchImpl: Fetch = fetch,
  ) {
    super(cfg, fetchImpl);
  }

  async submit(_kind: "movie" | "series", tmdbId: number, name: string): Promise<string> {
    const tvdbId = await this.tvdbOf(tmdbId);
    const look = await this.get<Record<string, unknown>[]>(`/series/lookup?term=${encodeURIComponent(tvdbId ? `tvdb:${tvdbId}` : name)}`);
    const match = (tvdbId ? look.find((s) => s.tvdbId === tvdbId) : undefined) ?? look[0];
    if (!match) throw new Error(`Sonarr couldn't find "${name}"`);
    if (typeof match.id === "number") return String(match.id);
    const added = await this.post<{ id: number }>("/series", { ...match, ...(await this.defaults()), monitored: true, seasonFolder: true, addOptions: { monitor: "all", searchForMissingEpisodes: true } });
    return String(added.id);
  }

  async status(_kind: "movie" | "series", ref: string): Promise<BackendStatus> {
    let s: { statistics?: { episodeFileCount?: number } };
    try {
      s = await this.get(`/series/${encodeURIComponent(ref)}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return "gone";
      throw err;
    }
    // A series is there once its first episodes are: the rest follow as they air or download.
    if ((s.statistics?.episodeFileCount ?? 0) > 0) return "ready";
    return (await this.queued("seriesId")).has(Number(ref)) ? "downloading" : "requested";
  }
}

// ---------------------------------------------------------------------------
// Which program takes which kind

export interface Backends {
  via?: RequestVia;
  movie?: Backend;
  series?: Backend;
}

export function backendsFrom(cfg: RequestSettings | undefined, tvdbOf: (tmdbId: number) => Promise<number | undefined>, fetchImpl: Fetch = fetch): Backends {
  if (cfg?.jellyseerr?.url && cfg.jellyseerr.apiKey) {
    const j = new JellyseerrClient(cfg.jellyseerr, fetchImpl);
    return { via: "jellyseerr", movie: j, series: j };
  }
  const out: Backends = {};
  if (cfg?.radarr?.url && cfg.radarr.apiKey) out.movie = new RadarrClient(cfg.radarr, fetchImpl);
  if (cfg?.sonarr?.url && cfg.sonarr.apiKey) out.series = new SonarrClient(cfg.sonarr, tvdbOf, fetchImpl);
  if (out.movie || out.series) out.via = "arr";
  return out;
}

/** The Test button: asks one program who it is and whether the key works. */
export async function testRequestApp(app: RequestTestResult["app"], cfg: ArrCfg, fetchImpl: Fetch = fetch): Promise<RequestTestResult> {
  const t0 = Date.now();
  try {
    if (!cfg.url?.trim() || !cfg.apiKey?.trim()) throw new Error("Give its address and API key first");
    const detail = app === "jellyseerr" ? await new JellyseerrClient(cfg, fetchImpl).test() : app === "radarr" ? await new RadarrClient(cfg, fetchImpl).test() : await new SonarrClient(cfg, async () => undefined, fetchImpl).test();
    return { app, ok: true, detail, ms: Date.now() - t0 };
  } catch (err) {
    return { app, ok: false, error: explain(err), ms: Date.now() - t0 };
  }
}

/** The settings as the UI sees them: where requests go, with no keys. */
export function publicRequestSettings(cfg: RequestSettings | undefined): PublicRequestSettings {
  const b = backendsFrom(cfg, async () => undefined);
  return {
    configured: Boolean(b.via),
    ...(b.via ? { via: b.via } : {}),
    ...(cfg?.jellyseerr?.url ? { jellyseerr: { url: cfg.jellyseerr.url } } : {}),
    ...(cfg?.radarr?.url ? { radarr: { url: cfg.radarr.url } } : {}),
    ...(cfg?.sonarr?.url ? { sonarr: { url: cfg.sonarr.url } } : {}),
  };
}
