// M3U / M3U8 playlist parser (IPTV "extended M3U" with tvg-* attributes).

export interface M3uEntry {
  name: string;
  url: string;
  tvgId?: string;
  tvgName?: string;
  logo?: string;
  group?: string;
  /** Catch-up attributes some providers add (catchup="xc", catchup-days="7", catchup-source="…"). */
  catchup?: string;
  catchupDays: number;
  catchupSource?: string;
  /** "live", "movie" or "series", from the URL shape Xtream panels use. */
  kind: "live" | "movie" | "series";
}

export interface M3uPlaylist {
  epgUrls: string[];
  entries: M3uEntry[];
}

const ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of line.matchAll(ATTR)) result[m[1]!.toLowerCase()] = m[2]!;
  return result;
}

/** Splits `#EXTINF:-1 attrs,Title` at the comma that ends the attributes (titles may contain commas). */
function titleOf(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "," && !inQuote) return line.slice(i + 1).trim();
  }
  return "";
}

export function kindFromUrl(url: string): M3uEntry["kind"] {
  if (/\/movie\//i.test(url)) return "movie";
  if (/\/series\//i.test(url)) return "series";
  return "live";
}

export function parseM3u(text: string): M3uPlaylist {
  const lines = text.split(/\r?\n/);
  const epgUrls: string[] = [];
  const entries: M3uEntry[] = [];
  let pending: Omit<M3uEntry, "url" | "kind"> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) {
      const a = attributes(line);
      const epg = a["url-tvg"] ?? a["x-tvg-url"];
      if (epg) epgUrls.push(...epg.split(",").map((u) => u.trim()).filter(Boolean));
      continue;
    }
    if (line.startsWith("#EXTINF")) {
      const a = attributes(line);
      const name = titleOf(line) || a["tvg-name"] || "Unnamed";
      pending = { name, catchupDays: Number(a["catchup-days"] ?? a["timeshift"] ?? 0) || 0 };
      if (a["tvg-id"]) pending.tvgId = a["tvg-id"];
      if (a["tvg-name"]) pending.tvgName = a["tvg-name"];
      if (a["tvg-logo"]) pending.logo = a["tvg-logo"];
      if (a["group-title"]) pending.group = a["group-title"];
      if (a["catchup"]) pending.catchup = a["catchup"];
      if (a["catchup-source"]) pending.catchupSource = a["catchup-source"];
      continue;
    }
    if (line.startsWith("#EXTGRP:") && pending && !pending.group) {
      pending.group = line.slice(8).trim();
      continue;
    }
    if (line.startsWith("#")) continue;
    if (pending) {
      entries.push({ ...pending, url: line, kind: kindFromUrl(line) });
      pending = null;
    }
  }
  return { epgUrls, entries };
}
