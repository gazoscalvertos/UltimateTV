// TorBox API client: account check, and turning a magnet into a downloadable file link.

import { fetchJson, type Fetch } from "../http.js";

const API = "https://api.torbox.app/v1/api";

interface TorboxResponse<T> {
  success: boolean;
  detail?: string;
  data: T;
}

export interface TorboxTorrent {
  id: number;
  hash: string;
  name: string;
  size: number;
  progress: number;
  download_state: string;
  download_finished: boolean;
  download_speed?: number;
  files?: { id: number; name: string; short_name?: string; size: number }[];
}

const VIDEO = /\.(mkv|mp4|m4v|avi|ts|m2ts|webm)$/i;

export class TorboxClient {
  constructor(
    private apiKey: string,
    private fetchImpl: Fetch = fetch,
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchJson<TorboxResponse<T>>(`${API}${path}`, this.fetchImpl, { ...init, headers: { Authorization: `Bearer ${this.apiKey}`, ...init.headers } }, 30_000);
    if (!res.success) throw new Error(res.detail ?? "TorBox request failed");
    return res.data;
  }

  user(): Promise<{ email?: string; plan?: number; premium_expires_at?: string }> {
    return this.call("/user/me");
  }

  async addMagnet(magnet: string): Promise<number> {
    const form = new FormData();
    form.set("magnet", magnet);
    const data = await this.call<{ torrent_id: number }>("/torrents/createtorrent", { method: "POST", body: form });
    return data.torrent_id;
  }

  torrent(id: number): Promise<TorboxTorrent> {
    return this.call<TorboxTorrent>(`/torrents/mylist?id=${id}&bypass_cache=true`);
  }

  async isCached(hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const data = await this.call<Record<string, unknown> | { hash: string }[] | null>(`/torrents/checkcached?hash=${hashes.join(",")}&format=list`);
    const list = Array.isArray(data) ? data.map((d) => d.hash) : Object.keys(data ?? {});
    return new Set(list.map((h) => h.toLowerCase()));
  }

  /** A direct HTTPS link to one file of a finished torrent. Defaults to the largest video file. */
  async downloadLink(torrent: TorboxTorrent, fileId?: number): Promise<{ url: string; name: string; size: number }> {
    const files = torrent.files ?? [];
    const file = fileId !== undefined ? files.find((f) => f.id === fileId) : [...files].filter((f) => VIDEO.test(f.name)).sort((a, b) => b.size - a.size)[0];
    if (!file) throw new Error("No video file in that torrent");
    const q = new URLSearchParams({ token: this.apiKey, torrent_id: String(torrent.id), file_id: String(file.id), zip_link: "false" });
    const url = await this.call<string>(`/torrents/requestdl?${q}`);
    return { url, name: file.short_name ?? file.name.split("/").pop() ?? file.name, size: file.size };
  }
}

export function magnetFor(infoHash: string, name?: string): string {
  return `magnet:?xt=urn:btih:${infoHash}${name ? `&dn=${encodeURIComponent(name)}` : ""}`;
}
