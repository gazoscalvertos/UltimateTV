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
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
  const gz = /\.gz($|\?)/i.test(url) || /gzip/i.test(res.headers.get("content-type") ?? "");
  // fetch already undoes Content-Encoding: gzip, so only a gzipped *file* needs gunzipping here.
  return gz ? body.pipe(createGunzip()) : body;
}
