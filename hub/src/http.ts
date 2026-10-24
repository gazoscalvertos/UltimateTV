// Small fetch helpers with timeouts and readable errors. Every client takes a `fetch` so tests can fake it.

import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export type Fetch = typeof fetch;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body?: string,
  ) {
    super(`HTTP ${status} from ${redactUrl(url)}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

/**
 * IPTV panels often refuse clients they don't recognise (Node's fetch says "node"), so every request
 * to a provider presents itself as a common player.
 */
export const IPTV_USER_AGENT = "VLC/3.0.21 LibVLC/3.0.21";

/** Wraps a fetch so requests carry IPTV_USER_AGENT unless they set their own. */
export function withUserAgent(fetchImpl: Fetch, userAgent = IPTV_USER_AGENT): Fetch {
  return ((input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", userAgent);
    return fetchImpl(input, { ...init, headers });
  }) as Fetch;
}

/** Removes credentials from URLs before they reach logs or error messages. */
export function redactUrl(url: string): string {
  return url
    .replace(/(username|password|api_key|apikey|token|api-key)=([^&]+)/gi, "$1=***")
    .replace(/\/(live|movie|series|timeshift)\/[^/]+\/[^/]+\//i, "/$1/***/***/")
    .replace(/\/\/[^/@]+@/, "//***@");
}

export async function fetchOk(url: string, fetchImpl: Fetch = fetch, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
  return res;
}

export async function fetchJson<T>(url: string, fetchImpl: Fetch = fetch, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const res = await fetchOk(url, fetchImpl, init, timeoutMs);
  return (await res.json()) as T;
}

/** Streams a (possibly gzipped) response body as a Node stream, e.g. a 200 MB XMLTV file. */
export async function fetchStream(url: string, fetchImpl: Fetch = fetch, timeoutMs = 300_000): Promise<NodeJS.ReadableStream> {
  const res = await fetchOk(url, fetchImpl, {}, timeoutMs);
  if (!res.body) throw new Error(`Empty response from ${redactUrl(url)}`);
  // fetch already undoes Content-Encoding: gzip, and servers disagree on whether a .xml.gz file is sent
  // that way, so the bytes decide: gzip data starts 1f 8b, XML never does.
  const reader = (res.body as import("node:stream/web").ReadableStream<Uint8Array>).getReader();
  let first = await reader.read();
  while (!first.done && first.value.length === 0) first = await reader.read();
  const head = first.done ? undefined : first.value;
  const body = Readable.from(
    (async function* () {
      if (head) yield head;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    })(),
  );
  const gz = head !== undefined && head[0] === 0x1f && head[1] === 0x8b;
  return gz ? body.pipe(createGunzip()) : body;
}
