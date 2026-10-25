// yt-dlp: finds music videos and downloads them for the music video channels. Search results are
// judged against a channel's rules (HD or better, not a lyric video, not an hour-long mix) and
// scored so the official video wins.

import { spawn } from "node:child_process";
import type { MixCandidate, MixChannel } from "@ultimatetv/shared";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs yt-dlp with these arguments. `onLine` gets each line of output as it comes (progress). */
export type Run = (args: string[], opts?: { onLine?: (line: string) => void; signal?: AbortSignal; timeoutMs?: number }) => Promise<RunResult>;

export function spawnRun(bin: string): Run {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], ...(opts.signal ? { signal: opts.signal } : {}) });
      let stdout = "";
      let stderr = "";
      let partial = "";
      const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
        if (!opts.onLine) return;
        partial += chunk;
        const lines = partial.split(/\r?\n|\r/);
        partial = lines.pop() ?? "";
        for (const l of lines) if (l) opts.onLine(l);
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-20_000);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
}

/** The fields of yt-dlp's --dump-json we use. */
export interface YtInfo {
  id: string;
  title?: string;
  webpage_url?: string;
  original_url?: string;
  duration?: number;
  height?: number;
  fps?: number;
  view_count?: number;
  uploader?: string;
  channel?: string;
  channel_is_verified?: boolean;
  artist?: string;
  artists?: string[];
  track?: string;
  thumbnail?: string;
  live_status?: string;
  is_live?: boolean;
  age_limit?: number;
}

export type Rules = Pick<MixChannel, "minHeight" | "maxMinutes" | "exclude">;

/** Titles with these are not music videos, or not ones you'd want on a channel. */
export const DEFAULT_EXCLUDE = [
  "lyric", "lyrics", "official audio", "audio only", "(audio)", "[audio]", "visualiser", "visualizer", "reaction", "karaoke",
  "1 hour", "10 hours", "full album", "teaser", "trailer", "slowed", "reverb", "nightcore", "8d", "tutorial", "behind the scenes",
  "making of", "interview", "instrumental", "remix contest", "fan made", "fanmade", "cover by",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Cascada - Everytime We Touch (Official Video) [HD]" → "Cascada - Everytime We Touch". */
export function cleanVideoTitle(title: string): string {
  return title
    .replace(/\s*[([](?:[^)\]]*\b(?:official|video|hd|hq|4k|uhd|remaster(?:ed)?|music video|clip officiel|videoclip|lyrics?)\b[^)\]]*)[)\]]/gi, "")
    .replace(/\s*[|｜]\s*.*$/, "")
    .replace(/\s+-\s+official\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !["the", "ft", "feat", "featuring", "and", "official", "video", "music"].includes(w));

/** How much of a pick ("Artist - Title") the video's title and channel cover, 0 to 1. */
export function overlap(pick: string, info: Pick<YtInfo, "title" | "uploader" | "channel" | "artist" | "track">): number {
  const want = [...new Set(words(pick))];
  if (!want.length) return 1;
  const have = new Set(words([info.title, info.uploader, info.channel, info.artist, info.track].filter(Boolean).join(" ")));
  return want.filter((w) => have.has(w)).length / want.length;
}

/** Scores a search result against a channel's rules; `pick` is the track it should be. */
export function judge(info: YtInfo, rules: Rules, pick?: string): { score: number; rejected: string[] } {
  const rejected: string[] = [];
  const title = info.title ?? "";
  const height = info.height ?? 0;
  const duration = info.duration ?? 0;
  if (info.is_live || info.live_status === "is_live" || info.live_status === "is_upcoming") rejected.push("a live stream");
  if (height < rules.minHeight) rejected.push(height ? `only ${height}p` : "no picture size");
  if (duration > rules.maxMinutes * 60) rejected.push(`too long (${Math.round(duration / 60)} min)`);
  if (duration && duration < 90) rejected.push("too short");
  if ((info.age_limit ?? 0) >= 18) rejected.push("age-restricted");
  const lower = ` ${title.toLowerCase()} `;
  for (const w of [...DEFAULT_EXCLUDE, ...rules.exclude]) {
    const word = w.trim().toLowerCase();
    if (!word) continue;
    const re = /^[a-z0-9]/.test(word) ? new RegExp(`\\b${escape(word)}\\b`) : new RegExp(escape(word));
    if (re.test(lower)) {
      rejected.push(`"${w}" in the title`);
      break;
    }
  }
  const match = pick ? overlap(pick, info) : 1;
  if (pick && match < 0.6) rejected.push(`doesn't look like ${pick}`);

  let score = match * 4;
  if (/official\s+(music\s+)?video|clip officiel|official hd video/i.test(title)) score += 5;
  if (/vevo$/i.test(info.uploader ?? info.channel ?? "")) score += 3;
  if (info.channel_is_verified) score += 1;
  if (info.artist || info.artists?.length) score += 1;
  if (height >= 1080) score += 1;
  if (height >= 2160) score += 1;
  if (/\b(live|concert|acoustic|unplugged|extended|megamix)\b/i.test(title)) score -= 3;
  if (info.view_count) score += Math.log10(info.view_count) / 2;
  return { score: Math.round(score * 100) / 100, rejected };
}

export function toCandidate(info: YtInfo, rules: Rules, pick?: string): MixCandidate {
  const { score, rejected } = judge(info, rules, pick);
  const c: MixCandidate = {
    id: info.id,
    url: info.webpage_url ?? info.original_url ?? `https://www.youtube.com/watch?v=${info.id}`,
    title: info.title ?? info.id,
    durationS: Math.round(info.duration ?? 0),
    height: info.height ?? 0,
    score,
    rejected,
  };
  const artist = info.artist ?? info.artists?.join(", ");
  if (artist) c.artist = artist;
  if (info.track) c.track = info.track;
  if (info.uploader ?? info.channel) c.uploader = (info.uploader ?? info.channel)!;
  if (info.view_count) c.views = info.view_count;
  if (info.thumbnail) c.thumbnail = info.thumbnail;
  return c;
}

/** What the guide calls a video: "Artist – Track" when YouTube knows them, else its tidied title. */
export function displayTitle(v: { title: string; artist?: string; track?: string }): string {
  if (v.artist && v.track) return `${v.artist.split(/,\s*/)[0]} – ${v.track}`;
  return cleanVideoTitle(v.title).replace(/\s+-\s+/, " – ");
}

export interface Downloaded {
  path: string;
  height: number;
  fps?: number;
  durationS?: number;
}

export class YtDlp {
  constructor(
    private run: Run,
    /** Extra arguments for every call, e.g. cookies (YTDLP_ARGS). */
    private extra: string[] = [],
  ) {}

  /** A download that prints nothing for this long has hung (YouTube stopped sending) and is stopped. */
  stallMs = 5 * 60_000;

  private args(list: string[]): string[] {
    // YouTube needs a JavaScript runtime; Node is already in the Hub's image.
    return ["--js-runtimes", "node", "--no-warnings", "--ignore-config", ...this.extra, ...list];
  }

  async version(): Promise<string> {
    const r = await this.run(["--version"], { timeoutMs: 20_000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `yt-dlp exited with ${r.code}`);
    return r.stdout.trim();
  }

  /** Updates the standalone yt-dlp binary (YouTube changes often enough that an old one stops working). */
  async update(): Promise<string> {
    const r = await this.run(["-U"], { timeoutMs: 120_000 });
    return (r.stdout + r.stderr).trim().split("\n").pop() ?? "";
  }

  /** Searches YouTube, with full details (picture size) for each result. */
  /** Search results `offset + 1` to `offset + limit`, so later passes can look further down the list. */
  async search(query: string, limit = 8, offset = 0): Promise<YtInfo[]> {
    const n = Math.min(Math.max(limit, 1), 30);
    const page = offset > 0 ? ["--playlist-items", `${offset + 1}:${offset + n}`] : [];
    const r = await this.run(this.args(["--dump-json", "--skip-download", "--no-playlist", "--ignore-errors", ...page, `ytsearch${offset + n}:${query}`]), { timeoutMs: 300_000 });
    const out: YtInfo[] = [];
    for (const line of r.stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const info = JSON.parse(line) as YtInfo;
        if (info.id) out.push(info);
      } catch {
        // Not JSON: a stray message.
      }
    }
    if (!out.length && r.code !== 0) throw new Error(lastError(r.stderr) || `yt-dlp exited with ${r.code}`);
    return out;
  }

  /** Details for one video by its URL or id. */
  async info(url: string): Promise<YtInfo> {
    const r = await this.run(this.args(["--dump-json", "--skip-download", "--no-playlist", url]), { timeoutMs: 120_000 });
    const line = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    if (r.code !== 0 || !line) throw new Error(lastError(r.stderr) || "yt-dlp couldn't read that video");
    return JSON.parse(line) as YtInfo;
  }

  /** Downloads the best version between minHeight and maxHeight to `<dir>/<id>.<ext>`, with a jpg thumbnail beside it. */
  async download(url: string, id: string, dir: string, size: { minHeight: number; maxHeight: number }, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Downloaded> {
    const h = `[height>=${size.minHeight}][height<=${size.maxHeight}]`;
    const args = this.args([
      "--no-playlist",
      "-f",
      `bv*${h}+ba/b${h}`,
      "-S",
      `res:${size.maxHeight},fps`,
      "--merge-output-format",
      "mkv",
      "-o",
      `${dir}/${id}.%(ext)s`,
      "--write-thumbnail",
      "--convert-thumbnails",
      "jpg",
      "-o",
      `thumbnail:${dir}/${id}.%(ext)s`,
      "--newline",
      "--progress",
      "--progress-template",
      "download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
      "--print",
      "after_move:DONE\t%(filepath)s\t%(height)s\t%(fps)s\t%(duration)s",
      url,
    ]);
    let done: Downloaded | undefined;
    // yt-dlp can sit forever on a connection YouTube has stopped answering, which would hold up
    // every download behind it, so a download that goes quiet is stopped.
    const watch = new AbortController();
    let stalled = false;
    let quiet: NodeJS.Timeout | undefined;
    const alive = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        stalled = true;
        watch.abort();
      }, this.stallMs);
    };
    const cancel = () => watch.abort();
    signal?.addEventListener("abort", cancel);
    alive();
    // Video and audio download one after the other; the video is most of it.
    let part = 0;
    let lastTotal = 0;
    let r: RunResult;
    try {
      r = await this.run(args, {
        signal: watch.signal,
        timeoutMs: 60 * 60_000,
        onLine: (line) => {
          alive();
          const p = /^PROGRESS (\S+) (\S+) (\S+)/.exec(line);
          if (p) {
            const got = Number(p[1]);
            const total = Number(p[2]) || Number(p[3]);
            if (total && total !== lastTotal && got < total * 0.05 && lastTotal) part++;
            if (total) lastTotal = total;
            if (total && onProgress) onProgress(Math.min(0.99, part === 0 ? (got / total) * 0.9 : 0.9 + (got / total) * 0.09));
            return;
          }
          done = parseDone(line) ?? done;
        },
      });
    } catch (err) {
      if (stalled) throw new Error(`The download stalled (nothing from YouTube for ${Math.round(this.stallMs / 60_000)} minutes)`);
      throw err;
    } finally {
      clearTimeout(quiet);
      signal?.removeEventListener("abort", cancel);
    }
    if (stalled) throw new Error(`The download stalled (nothing from YouTube for ${Math.round(this.stallMs / 60_000)} minutes)`);
    // Runners that don't stream lines still return the output.
    for (const line of done ? [] : r.stdout.split("\n")) done = parseDone(line) ?? done;
    if (r.code !== 0 || !done) {
      const err = lastError(r.stderr);
      throw new Error(/requested format is not available/i.test(err) ? `No version at ${size.minHeight}p or better` : err || `yt-dlp exited with ${r.code}`);
    }
    return done;
  }
}

function parseDone(line: string): Downloaded | undefined {
  const d = /^DONE\t(.+)\t(\S*)\t(\S*)\t(\S*)$/.exec(line.trim());
  if (!d) return undefined;
  const done: Downloaded = { path: d[1]!, height: Number(d[2]) || 0 };
  if (Number(d[3])) done.fps = Number(d[3]);
  if (Number(d[4])) done.durationS = Number(d[4]);
  return done;
}

/** The useful line of yt-dlp's error output. */
export function lastError(stderr: string): string {
  const lines = stderr.trim().split("\n").filter(Boolean);
  const err = [...lines].reverse().find((l) => l.startsWith("ERROR:")) ?? lines.pop() ?? "";
  return err.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, "").slice(0, 300);
}
