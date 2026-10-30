// TMDB client for artwork, discovery rails and metadata. Responses are cached in SQLite.

import type { Episode, Season, TitleDetails, TitleKind, TitleRef, Trailer } from "@ultimatetv/shared";
import type { Db } from "../db.js";
import { fetchJson, type Fetch } from "../http.js";

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const DAY = 86_400_000;

interface TmdbResult {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  genre_ids?: number[];
}

interface TmdbDetails extends TmdbResult {
  genres?: { id: number; name: string }[];
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  seasons?: { season_number: number; name: string; episode_count: number }[];
  credits?: { cast?: { name: string }[] };
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  imdb_id?: string | null;
  images?: { logos?: { file_path: string; iso_639_1: string | null }[] };
  release_dates?: { results: { iso_3166_1: string; release_dates: { certification: string }[] }[] };
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
}

export interface TmdbVideo {
  key: string;
  name: string;
  site: string;
  type: string;
  official?: boolean;
  iso_639_1?: string | null;
  size?: number;
  published_at?: string;
}

/** The trailer to offer: an official English YouTube trailer if there is one, then teasers, biggest first. */
export function pickTrailer(videos: TmdbVideo[]): Trailer | undefined {
  const score = (v: TmdbVideo) => (v.type === "Trailer" ? 8 : v.type === "Teaser" ? 4 : 0) + (v.official ? 2 : 0) + (!v.iso_639_1 || v.iso_639_1 === "en" ? 1 : 0);
  const best = videos
    .filter((v) => v.site === "YouTube" && /^[\w-]{6,20}$/.test(v.key) && (v.type === "Trailer" || v.type === "Teaser"))
    .sort((a, b) => score(b) - score(a) || (b.size ?? 0) - (a.size ?? 0) || (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
  return best ? { name: best.name || "Trailer", url: `https://www.youtube.com/watch?v=${best.key}` } : undefined;
}

export const GENRES: Record<string, { movie: number; tv: number }> = {
  Comedy: { movie: 35, tv: 35 },
  Action: { movie: 28, tv: 10759 },
  Drama: { movie: 18, tv: 18 },
  Family: { movie: 10751, tv: 10751 },
  Documentary: { movie: 99, tv: 99 },
  Crime: { movie: 80, tv: 80 },
  "Sci-Fi": { movie: 878, tv: 10765 },
  Thriller: { movie: 53, tv: 9648 },
  Animation: { movie: 16, tv: 16 },
  Kids: { movie: 10751, tv: 10762 },
};

const GENRE_NAMES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action", 10762: "Kids", 10763: "News", 10764: "Reality", 10765: "Sci-Fi", 10766: "Soap", 10767: "Talk", 10768: "War",
};

export class TmdbClient {
  constructor(
    private apiKey: string,
    private db: Db,
    private fetchImpl: Fetch = fetch,
  ) {}

  private async get<T>(path: string, params: Record<string, string | number> = {}, ttl = DAY): Promise<T> {
    const q = new URLSearchParams({ language: "en-GB", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    // v4 read tokens are long JWTs sent as a bearer token; v3 keys go in the query string.
    const bearer = this.apiKey.length > 40;
    if (!bearer) q.set("api_key", this.apiKey);
    const url = `${API}${path}?${q}`;
    const cacheKey = `tmdb:${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
    const cached = this.db.cacheGet<T>(cacheKey);
    if (cached) return cached;
    const body = await fetchJson<T>(url, this.fetchImpl, bearer ? { headers: { Authorization: `Bearer ${this.apiKey}` } } : {}, 15_000);
    this.db.cacheSet(cacheKey, body, ttl);
    return body;
  }

  static image(path: string | null | undefined, size: "w300" | "w500" | "w780" | "w1280" | "original"): string | undefined {
    return path ? `${IMG}/${size}${path}` : undefined;
  }

  toRef(r: TmdbResult, kind?: TitleKind): TitleRef | null {
    const k: TitleKind | null = kind ?? (r.media_type === "movie" ? "movie" : r.media_type === "tv" ? "series" : null);
    if (!k) return null;
    const date = r.release_date ?? r.first_air_date;
    const ref: TitleRef = { id: `tmdb:${k}:${r.id}`, kind: k, name: r.title ?? r.name ?? "Untitled" };
    if (date) ref.year = Number(date.slice(0, 4));
    const poster = TmdbClient.image(r.poster_path, "w500");
    if (poster) ref.poster = poster;
    const backdrop = TmdbClient.image(r.backdrop_path, "w1280");
    if (backdrop) ref.backdrop = backdrop;
    if (r.genre_ids?.length) ref.genres = r.genre_ids.map((g) => GENRE_NAMES[g]).filter((g): g is string => Boolean(g));
    return ref;
  }

  async trending(limit = 20): Promise<TitleRef[]> {
    const r = await this.get<{ results: TmdbResult[] }>("/trending/all/week", {}, 6 * 3_600_000);
    return r.results.map((x) => this.toRef(x)).filter((x): x is TitleRef => x !== null).slice(0, limit);
  }

  async popular(kind: TitleKind, limit = 20): Promise<TitleRef[]> {
    const r = await this.get<{ results: TmdbResult[] }>(kind === "movie" ? "/movie/popular" : "/tv/popular", { region: "GB" });
    return r.results.map((x) => this.toRef(x, kind)).filter((x): x is TitleRef => x !== null).slice(0, limit);
  }

  /** Popular titles in a genre; `maxCertification` limits films to a UK certificate (Kids profiles). */
  async discover(kind: TitleKind, genre: string, limit = 20, maxCertification?: string): Promise<TitleRef[]> {
    const g = GENRES[genre];
    if (!g) return [];
    const params: Record<string, string | number> = {
      with_genres: kind === "movie" ? g.movie : g.tv,
      sort_by: "popularity.desc",
      "vote_count.gte": 200,
      watch_region: "GB",
    };
    if (maxCertification && kind === "movie") {
      params.certification_country = "GB";
      params["certification.lte"] = maxCertification;
    }
    const r = await this.get<{ results: TmdbResult[] }>(kind === "movie" ? "/discover/movie" : "/discover/tv", params);
    return r.results
      .map((x) => this.toRef(x, kind))
      .filter((x): x is TitleRef => x !== null)
      .map((x) => (maxCertification && kind === "movie" ? { ...x, certification: maxCertification } : x))
      .slice(0, limit);
  }

  async recommendations(kind: TitleKind, id: number, limit = 20): Promise<TitleRef[]> {
    const r = await this.get<{ results: TmdbResult[] }>(`/${kind === "movie" ? "movie" : "tv"}/${id}/recommendations`);
    return r.results.map((x) => this.toRef(x, kind)).filter((x): x is TitleRef => x !== null).slice(0, limit);
  }

  async trailer(kind: TitleKind, id: number): Promise<Trailer | undefined> {
    const r = await this.get<{ results: TmdbVideo[] }>(`/${kind === "movie" ? "movie" : "tv"}/${id}/videos`, { include_video_language: "en,null" }, 7 * DAY);
    return pickTrailer(r.results ?? []);
  }

  async search(query: string, limit = 20): Promise<TitleRef[]> {
    const r = await this.get<{ results: TmdbResult[] }>("/search/multi", { query, include_adult: "false" }, 3_600_000);
    return r.results.map((x) => this.toRef(x)).filter((x): x is TitleRef => x !== null).slice(0, limit);
  }

  /** Best TMDB match for a title from another source (Xtream VOD, a file name). */
  async match(kind: TitleKind, name: string, year?: number): Promise<TitleRef | null> {
    const params: Record<string, string | number> = { query: name };
    if (year) params[kind === "movie" ? "year" : "first_air_date_year"] = year;
    const r = await this.get<{ results: TmdbResult[] }>(kind === "movie" ? "/search/movie" : "/search/tv", params, 7 * DAY);
    const first = r.results[0];
    return first ? this.toRef(first, kind) : null;
  }

  async details(kind: TitleKind, id: number): Promise<TitleDetails> {
    const path = kind === "movie" ? `/movie/${id}` : `/tv/${id}`;
    const d = await this.get<TmdbDetails>(path, {
      append_to_response: kind === "movie" ? "credits,external_ids,images,release_dates" : "credits,external_ids,images,content_ratings",
      include_image_language: "en,null",
    });
    const ref = this.toRef(d, kind)!;
    const details: TitleDetails = {
      ...ref,
      genres: (d.genres ?? []).map((g) => g.name),
      cast: (d.credits?.cast ?? []).slice(0, 8).map((c) => c.name),
      tmdbId: d.id,
      availability: [],
      inLibrary: false,
    };
    if (d.overview) details.overview = d.overview;
    const runtime = d.runtime ?? d.episode_run_time?.[0];
    if (runtime) details.runtimeMin = runtime;
    if (d.vote_average) details.rating = Math.round(d.vote_average * 10) / 10;
    const imdb = d.external_ids?.imdb_id ?? d.imdb_id;
    if (imdb) details.imdbId = imdb;
    const logo = d.images?.logos?.find((l) => l.iso_639_1 === "en") ?? d.images?.logos?.[0];
    const logoUrl = TmdbClient.image(logo?.file_path, "w500");
    if (logoUrl) details.logo = logoUrl;
    const cert =
      kind === "movie"
        ? d.release_dates?.results.find((r) => r.iso_3166_1 === "GB")?.release_dates.find((x) => x.certification)?.certification
        : d.content_ratings?.results.find((r) => r.iso_3166_1 === "GB")?.rating;
    if (cert) details.certification = cert;
    if (kind === "series") {
      details.seasons = (d.seasons ?? [])
        .filter((s) => s.episode_count > 0)
        .sort((a, b) => (a.season_number === 0 ? 1 : b.season_number === 0 ? -1 : a.season_number - b.season_number))
        .map((s) => ({ season: s.season_number, name: s.season_number === 0 ? "Specials" : `Series ${s.season_number}`, episodes: [] }));
    }
    return details;
  }

  async season(tvId: number, season: number): Promise<Season> {
    const s = await this.get<{ season_number: number; name: string; episodes: { id: number; episode_number: number; name: string; overview?: string; still_path?: string | null; air_date?: string; runtime?: number }[] }>(`/tv/${tvId}/season/${season}`);
    return {
      season,
      name: season === 0 ? "Specials" : `Series ${season}`,
      episodes: s.episodes.map((e) => {
        const ep: Episode = { id: `tmdb:episode:${tvId}:${season}:${e.episode_number}`, season, episode: e.episode_number, name: e.name };
        if (e.overview) ep.overview = e.overview;
        const still = TmdbClient.image(e.still_path, "w500");
        if (still) ep.still = still;
        if (e.air_date) ep.airDate = e.air_date;
        if (e.runtime) ep.runtimeMin = e.runtime;
        return ep;
      }),
    };
  }
}
