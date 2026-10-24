// Catch-up (timeshift) URLs for a programme on a channel feed.

import type { Settings } from "@ultimatetv/shared";
import type { StoredFeed } from "./channels.js";
import { XtreamClient } from "./ingest/xtream.js";

export interface CatchupContext {
  settings: Settings;
  timeZoneOf(sourceId: string): string | undefined;
}

/**
 * Fills an M3U `catchup-source` template. Supports the common placeholders: {utc}, {utcend},
 * {start}, {end}, {duration}, {offset}, ${start}, ${end}, ${timestamp} and {Y}{m}{d}{H}{M}{S}.
 */
export function fillCatchupTemplate(template: string, start: number, end: number, now = Date.now()): string {
  const s = Math.floor(start / 1000);
  const e = Math.floor(end / 1000);
  const d = new Date(start);
  const two = (n: number) => String(n).padStart(2, "0");
  return template
    .replace(/\$?\{utc\}|\$\{start\}|\{start\}|\$\{timestamp\}|\{timestamp\}/g, String(s))
    .replace(/\$?\{utcend\}|\$\{end\}|\{end\}/g, String(e))
    .replace(/\{duration\}|\$\{duration\}/g, String(e - s))
    .replace(/\{offset\}|\$\{offset\}/g, String(Math.floor(now / 1000) - s))
    .replace(/\{Y\}/g, String(d.getUTCFullYear()))
    .replace(/\{m\}/g, two(d.getUTCMonth() + 1))
    .replace(/\{d\}/g, two(d.getUTCDate()))
    .replace(/\{H\}/g, two(d.getUTCHours()))
    .replace(/\{M\}/g, two(d.getUTCMinutes()))
    .replace(/\{S\}/g, two(d.getUTCSeconds()));
}

/** Returns the catch-up URL for the first feed that supports it, or null. */
export function catchupUrl(feeds: StoredFeed[], start: number, end: number, ctx: CatchupContext, now = Date.now()): string | null {
  for (const feed of feeds) {
    if (feed.catchupDays <= 0 || start < now - feed.catchupDays * 86_400_000) continue;
    const source = ctx.settings.iptv.find((s) => s.id === feed.sourceId);
    if (!source) continue;
    if (source.kind === "xtream") {
      const client = new XtreamClient(source);
      return client.catchupUrl(feed.upstreamId, start, (end - start) / 60_000, ctx.timeZoneOf(source.id) ?? "Europe/London");
    }
    if (feed.catchupSource) {
      const filled = fillCatchupTemplate(feed.catchupSource, start, end, now);
      return /^https?:/i.test(filled) ? filled : feed.url + filled;
    }
    // Flussonic-style "append" catch-up without a template.
    return `${feed.url}${feed.url.includes("?") ? "&" : "?"}utc=${Math.floor(start / 1000)}&lutc=${Math.floor(now / 1000)}`;
  }
  return null;
}
