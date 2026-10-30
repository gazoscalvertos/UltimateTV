// OpenSubtitles (api.opensubtitles.com, REST API v1) for subtitles a film or episode doesn't come
// with: TorBox and IPTV copies often have none. Searches are by IMDb or TMDB id. Downloads count
// against a daily limit (5 a day without an account, more with a free login); each file is kept
// on the Hub for a month so playing it again costs nothing.

import type { SubtitleResult } from "@ultimatetv/shared";
import type { Db } from "../db.js";
import { fetchJson, fetchOk, type Fetch } from "../http.js";
import type { Logger } from "../log.js";

const API = "https://api.opensubtitles.com/api/v1";
const USER_AGENT = "UltimateTV v0.2";
const DAY = 86_400_000;

/** The Hub's three-letter languages (ISO 639-2, as mpv uses) as OpenSubtitles' two-letter codes. */
const TWO_LETTER: Record<string, string> = { eng: "en", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", ita: "it", pol: "pl", por: "pt-PT", nld: "nl", dut: "nl", swe: "sv", dan: "da", nor: "no", fin: "fi", gre: "el", ell: "el", tur: "tr", ara: "ar", hin: "hi", jpn: "ja", kor: "ko", chi: "zh-CN", zho: "zh-CN", rus: "ru", ukr: "uk" };

/** Where a downloaded file is kept in the Hub's cache. */
export const subtitleFileKey = (fileId: number | string) => `opensubtitles:file:${fileId}`;

export function openSubtitlesLang(lang: string): string {
  const l = lang.trim().toLowerCase();
  return TWO_LETTER[l] ?? (/^[a-z]{2}(-[a-z]{2})?$/i.test(l) ? l : "en");
}

export interface SubtitleQuery {
  imdbId?: string;
  tmdbId?: number;
  kind: "movie" | "series";
  season?: number;
  episode?: number;
  /** ISO 639-2 ("eng") or two letters ("en"). */
  lang: string;
}

interface OsFile {
  file_id: number;
  file_name?: string;
}

interface OsSubtitle {
  id: string;
  attributes: {
    language?: string;
    release?: string;
    download_count?: number;
    hearing_impaired?: boolean;
    ai_translated?: boolean;
    machine_translated?: boolean;
    from_trusted?: boolean;
    fps?: number;
    files?: OsFile[];
  };
}

/** The query string for /subtitles. OpenSubtitles wants the parameters sorted, lower case, without "tt". */
export function searchParams(q: SubtitleQuery): string {
  const p: Record<string, string> = { languages: openSubtitlesLang(q.lang), order_by: "download_count" };
  const imdb = q.imdbId?.replace(/^tt/i, "").replace(/^0+/, "");
  if (q.kind === "series" && q.season !== undefined && q.episode !== undefined) {
    if (imdb) p.parent_imdb_id = imdb;
    else if (q.tmdbId) p.parent_tmdb_id = String(q.tmdbId);
    p.season_number = String(q.season);
    p.episode_number = String(q.episode);
    p.type = "episode";
  } else {
    if (imdb) p.imdb_id = imdb;
    else if (q.tmdbId) p.tmdb_id = String(q.tmdbId);
    p.type = q.kind === "movie" ? "movie" : "all";
  }
  return Object.keys(p)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(p[k]!.toLowerCase())}`)
    .join("&");
}

/** The search's answers as the TV lists them, best first: people-made over machine-made, then the most downloaded. */
export function resultsFrom(data: OsSubtitle[]): SubtitleResult[] {
  const out: SubtitleResult[] = [];
  for (const s of data) {
    const a = s.attributes;
    const file = a.files?.[0];
    if (!file) continue;
    const r: SubtitleResult = { fileId: file.file_id, lang: a.language ?? "en", release: a.release || file.file_name || "Subtitles", downloads: a.download_count ?? 0, hearingImpaired: Boolean(a.hearing_impaired), machine: Boolean(a.ai_translated || a.machine_translated) };
    if (a.from_trusted) r.trusted = true;
    out.push(r);
  }
  return out.sort((a, b) => Number(a.machine) - Number(b.machine) || Number(Boolean(b.trusted)) - Number(Boolean(a.trusted)) || b.downloads - a.downloads);
}

export class OpenSubtitlesClient {
  constructor(
    private readonly account: { apiKey: string; username?: string; password?: string },
    private readonly db: Db,
    private readonly fetchImpl: Fetch = fetch,
    private readonly log?: Logger,
  ) {}

  get signedIn(): boolean {
    return Boolean(this.account.username && this.account.password);
  }

  private headers(token?: string): Record<string, string> {
    return { "Api-Key": this.account.apiKey, "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  /** A login token (kept for a day), when an account is set; downloads work without one, five a day. */
  private async token(): Promise<{ token: string; base: string } | null> {
    if (!this.signedIn) return null;
    const key = `opensubtitles:token:${this.account.username}`;
    const cached = this.db.cacheGet<{ token: string; base: string }>(key);
    if (cached) return cached;
    const r = await fetchJson<{ token?: string; base_url?: string }>(`${API}/login`, this.fetchImpl, { method: "POST", headers: this.headers(), body: JSON.stringify({ username: this.account.username, password: this.account.password }) }, 15_000);
    if (!r.token) throw new Error("OpenSubtitles didn't accept the login");
    // Signed-in users are sent to their own server (vip-api for VIPs).
    const value = { token: r.token, base: r.base_url && /^[\w.-]+$/.test(r.base_url) ? `https://${r.base_url}/api/v1` : API };
    this.db.cacheSet(key, value, DAY - 3_600_000);
    return value;
  }

  async search(q: SubtitleQuery): Promise<SubtitleResult[]> {
    if (!q.imdbId && !q.tmdbId) return [];
    const qs = searchParams(q);
    const key = `opensubtitles:search:${qs}`;
    const cached = this.db.cacheGet<SubtitleResult[]>(key);
    if (cached) return cached;
    const r = await fetchJson<{ data?: OsSubtitle[] }>(`${API}/subtitles?${qs}`, this.fetchImpl, { headers: this.headers() }, 15_000);
    const results = resultsFrom(r.data ?? []).slice(0, 30);
    this.db.cacheSet(key, results, DAY);
    return results;
  }

  /** The subtitle file's text (SRT), from the Hub's copy when it has one. */
  async file(fileId: number): Promise<string> {
    const key = subtitleFileKey(fileId);
    const cached = this.db.cacheGet<string>(key);
    if (cached) return cached;
    const auth = await this.token().catch((e: Error) => (this.log?.warn({ err: e.message }, "OpenSubtitles login failed: downloading without it"), null));
    const r = await fetchJson<{ link?: string; remaining?: number; message?: string }>(
      `${auth?.base ?? API}/download`,
      this.fetchImpl,
      { method: "POST", headers: this.headers(auth?.token), body: JSON.stringify({ file_id: fileId, sub_format: "srt" }) },
      15_000,
    ).catch((e: Error) => {
      // 406 is OpenSubtitles saying today's downloads are used up.
      if (/HTTP 406/.test(e.message)) throw Object.assign(new Error(`That's today's OpenSubtitles downloads used up${this.signedIn ? "" : ": sign in on the setup page for more"}`), { statusCode: 429 });
      throw e;
    });
    if (!r.link) throw new Error(r.message ?? "OpenSubtitles didn't give a download link");
    const text = await (await fetchOk(r.link, this.fetchImpl, {}, 20_000)).text();
    if (r.remaining !== undefined) this.log?.info({ remaining: r.remaining }, "OpenSubtitles download");
    this.db.cacheSet(key, text, 30 * DAY);
    return text;
  }
}
