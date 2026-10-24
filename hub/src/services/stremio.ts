// Stremio addon protocol client. Works with any addon URL; AIOStreams is the main one, and it
// returns TorBox-resolved links that play directly.

import type { StreamCandidate } from "@ultimatetv/shared";
import { parseQuality } from "@ultimatetv/shared";
import { fetchJson, type Fetch } from "../http.js";

export interface AddonManifest {
  id: string;
  name: string;
  version?: string;
  resources: (string | { name: string; types?: string[]; idPrefixes?: string[] })[];
  types: string[];
  idPrefixes?: string[];
  catalogs?: { type: string; id: string; name?: string }[];
}

export interface AddonStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  behaviorHints?: { filename?: string; videoSize?: number; bingeGroup?: string; notWebReady?: boolean; proxyHeaders?: { request?: Record<string, string> } };
}

/** Turns `…/manifest.json` (or the bare base URL) into the addon's base URL. */
export function addonBase(url: string): string {
  return url.replace(/\/manifest\.json(\?.*)?$/, "").replace(/\/+$/, "");
}

export class AddonClient {
  constructor(
    readonly url: string,
    private fetchImpl: Fetch = fetch,
  ) {}

  get base(): string {
    return addonBase(this.url);
  }

  manifest(): Promise<AddonManifest> {
    return fetchJson<AddonManifest>(`${this.base}/manifest.json`, this.fetchImpl, {}, 15_000);
  }

  /** `id` is an IMDb id for films ("tt0133093") or "tt0903747:1:2" for an episode. */
  async streams(type: "movie" | "series", id: string): Promise<AddonStream[]> {
    const r = await fetchJson<{ streams?: AddonStream[] }>(`${this.base}/stream/${type}/${encodeURIComponent(id)}.json`, this.fetchImpl, {}, 30_000);
    return r.streams ?? [];
  }
}

const CACHED = /⚡|\[(?:TB|RD|AD|PM|DL)\+\]|\binstant\b|\bcached\b/i;
const UNCACHED = /⏳|\[(?:TB|RD|AD|PM|DL) ?(?:download|⏳)\]|\buncached\b|\bdownload\b/i;

export function streamToCandidate(s: AddonStream, addonName: string, index: number): StreamCandidate | null {
  const url = s.url;
  if (!url) return null; // Plain torrents (infoHash only) need a debrid service; AIOStreams resolves those for us.
  const text = [s.name, s.title, s.description, s.behaviorHints?.filename].filter(Boolean).join(" ");
  const quality = parseQuality(text);
  if (!quality.sizeBytes && s.behaviorHints?.videoSize) quality.sizeBytes = s.behaviorHints.videoSize;
  const name = s.name ?? "";
  const torbox = /\bTB\b|torbox/i.test(text);
  const ready = CACHED.test(name) || (!UNCACHED.test(name) && !UNCACHED.test(s.title ?? s.description ?? ""));
  const candidate: StreamCandidate = {
    id: `addon:${index}`,
    kind: torbox ? "torbox" : "addon",
    label: torbox ? "TorBox" : addonName,
    detail: [s.name, s.title ?? s.description].filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 300),
    quality,
    ready,
    url,
    downloadable: true,
  };
  const headers = s.behaviorHints?.proxyHeaders?.request;
  if (headers) candidate.headers = headers;
  return candidate;
}
