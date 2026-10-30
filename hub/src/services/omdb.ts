// OMDb (omdbapi.com) for the scores TMDB doesn't have: IMDb, Rotten Tomatoes and Metacritic. A free
// key allows 1,000 lookups a day; answers are cached for a week.

import type { TitleScore } from "@ultimatetv/shared";
import type { Db } from "../db.js";
import { fetchJson, type Fetch } from "../http.js";

const WEEK = 7 * 86_400_000;

interface OmdbAnswer {
  Response?: "True" | "False";
  Error?: string;
  imdbRating?: string;
  Metascore?: string;
  Ratings?: { Source: string; Value: string }[];
}

/** OMDb's ratings as scores: "8.3/10", "87%" and "76/100" each become a value and a percentage. */
export function scoresFrom(a: OmdbAnswer): TitleScore[] {
  if (a.Response === "False") return [];
  const out: TitleScore[] = [];
  const ratings = a.Ratings ?? [];
  const imdb = ratings.find((r) => r.Source === "Internet Movie Database")?.Value ?? (a.imdbRating && a.imdbRating !== "N/A" ? `${a.imdbRating}/10` : undefined);
  const m = imdb && /^(\d+(?:\.\d+)?)\/10$/.exec(imdb);
  if (m) out.push({ source: "imdb", label: "IMDb", value: m[1]!, pct: Math.round(Number(m[1]) * 10) });
  const rt = ratings.find((r) => r.Source === "Rotten Tomatoes")?.Value;
  const t = rt && /^(\d+)%$/.exec(rt);
  if (t) out.push({ source: "rotten-tomatoes", label: "Rotten Tomatoes", value: `${t[1]}%`, pct: Number(t[1]) });
  const mc = ratings.find((r) => r.Source === "Metacritic")?.Value ?? (a.Metascore && a.Metascore !== "N/A" ? `${a.Metascore}/100` : undefined);
  const c = mc && /^(\d+)\/100$/.exec(mc);
  if (c) out.push({ source: "metacritic", label: "Metacritic", value: c[1]!, pct: Number(c[1]) });
  return out;
}

export class OmdbClient {
  constructor(
    private readonly apiKey: string,
    private readonly db: Db,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  /** The scores for an IMDb id ("tt0113277"); none when OMDb doesn't know it. */
  async scores(imdbId: string): Promise<TitleScore[]> {
    if (!/^tt\d{5,10}$/.test(imdbId)) return [];
    const key = `omdb:${imdbId}`;
    const cached = this.db.cacheGet<OmdbAnswer>(key);
    const answer = cached ?? (await fetchJson<OmdbAnswer>(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(this.apiKey)}`, this.fetchImpl, {}, 10_000));
    // A bad key is an answer too ("Invalid API key!"); don't keep that for a week.
    if (!cached && !(answer.Response === "False" && /key/i.test(answer.Error ?? ""))) this.db.cacheSet(key, answer, WEEK);
    if (answer.Response === "False" && /key/i.test(answer.Error ?? "")) throw new Error(`OMDb: ${answer.Error}`);
    return scoresFrom(answer);
  }
}
