// Trailers for the muted preview behind Home's hero (#240, docs/hero-trailer.md). TMDB hands over
// a YouTube page; the TV app's player can't open that, so the Hub asks yt-dlp for the video's own
// address and passes the bytes on (the address is tied to the Hub's connection, so the box can't
// fetch it directly). Only a picture, 720p or less: the preview is muted and the box is busy.

import type { YtDlp } from "./ytdlp.js";

type Fetch = typeof fetch;

/** A YouTube video id as TMDB gives it. Anything else is refused before it reaches yt-dlp. */
export const TRAILER_KEY = /^[\w-]{6,20}$/;

/** How long a resolved address is trusted: they last about six hours. */
const KEEP_MS = 2 * 60 * 60_000;

export class TrailerStreams {
  private known = new Map<string, { url: string; at: number }>();
  private asking = new Map<string, Promise<string>>();

  constructor(
    private ytdlp: YtDlp | null,
    private fetchImpl: Fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  get available(): boolean {
    return this.ytdlp !== null;
  }

  private async address(key: string): Promise<string> {
    const had = this.known.get(key);
    if (had && this.now() - had.at < KEEP_MS) return had.url;
    const going = this.asking.get(key);
    if (going) return going;
    if (!this.ytdlp) throw Object.assign(new Error("yt-dlp isn't installed on the Hub"), { statusCode: 503 });
    const p = this.ytdlp
      .streamUrl(`https://www.youtube.com/watch?v=${key}`)
      .then((url) => {
        this.known.set(key, { url, at: this.now() });
        // A few at a time is all Home ever asks for.
        while (this.known.size > 24) this.known.delete(this.known.keys().next().value as string);
        return url;
      })
      .finally(() => this.asking.delete(key));
    this.asking.set(key, p);
    return p;
  }

  /** The video's bytes (a range of them when the player asks), or the status to answer with. */
  async open(key: string, range?: string): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | null }> {
    if (!TRAILER_KEY.test(key)) throw Object.assign(new Error("No such trailer"), { statusCode: 404 });
    let url = await this.address(key).catch((err: Error) => {
      throw Object.assign(new Error(err.message), { statusCode: (err as { statusCode?: number }).statusCode ?? 502 });
    });
    const get = (u: string) => this.fetchImpl(u, { headers: range ? { range } : {} });
    let res = await get(url);
    if (res.status === 403 || res.status === 410) {
      // The address expired early: ask once more.
      this.known.delete(key);
      url = await this.address(key);
      res = await get(url);
    }
    if (!res.ok && res.status !== 206) throw Object.assign(new Error("The trailer isn't available"), { statusCode: 502 });
    const headers: Record<string, string> = { "content-type": res.headers.get("content-type") ?? "video/mp4", "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
    for (const h of ["content-length", "content-range"]) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    return { status: res.status, headers, body: res.body };
  }
}
