// Podcast feeds, read with the same streaming SAX parser the guide uses.
//
// A feed is somebody else's XML: missing fields, CDATA, entities, enclosures without
// a length, dates in half a dozen formats. Everything here is forgiving — an episode
// only needs a title and an audio address to be playable, and a feed that can't be
// read at all reports why instead of throwing at the caller.

import sax from "sax";
import type { ParsedFeed } from "@ultimatetv/shared";

const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_EPISODES = 200;

/** Dates in feeds are RFC 822 more often than ISO, and plenty are just wrong. */
export function feedDate(raw: string | undefined): number {
  if (!raw) return 0;
  const text = raw.trim();
  if (!text) return 0;
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return direct;
  // "Tue, 03 Nov 2026 09:00:00 +0000" is fine, but a missing day name or a stray
  // comma is common; try again with the punctuation tidied.
  const tidied = text.replace(/^[A-Za-z]{3},\s*/, "").replace(/\s+/g, " ");
  const second = Date.parse(tidied);
  return Number.isFinite(second) ? second : 0;
}

/** "1:02:03" or "3723" or "3723.5" → milliseconds. */
export function feedDuration(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  const parts = text.split(":");
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (![h, m, s].every(Number.isFinite)) return undefined;
    return Math.round(((h * 60 + m) * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (![m, s].every(Number.isFinite)) return undefined;
    return Math.round((m * 60 + s) * 1000);
  }
  const seconds = Number(text);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
}

const text = (v: string | undefined): string | undefined => {
  const cleaned = v?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : undefined;
};

/**
 * Read an RSS/Atom podcast feed. Never throws: a broken feed comes back with no
 * episodes, and the caller decides what to tell the household.
 */
export function parseFeed(xml: string): ParsedFeed {
  const feed: ParsedFeed = { title: "", episodes: [] };
  let channelTitle = "";
  let imageUrl: string | undefined;
  let author: string | undefined;
  let description: string | undefined;

  interface Draft {
    title?: string;
    url?: string;
    publishedAt?: number;
    durationMs?: number;
    description?: string;
    image?: string;
  }
  let episode: Draft | null = null;
  /** The element whose text we're collecting, and the episode it belongs to. */
  let capturing: { at: "feed" | "episode"; field: string; into: string[] } | null = null;

  const parser = sax.parser(true, { trim: false, normalize: false, lowercase: true });
  const enter = (name: string) => {
    // Atom feeds wrap each entry in <entry>; RSS uses <item>. Both are episodes.
    if (name === "item" || name === "entry") episode = {};
    if (episode) return;
    if (name === "title") capturing = { at: "feed", field: "title", into: [] };
    if (name === "description" || name === "subtitle" || name === "summary") {
      capturing = { at: "feed", field: "description", into: [] };
    }
  };
  /** Which of an episode's fields a tag is, or null for one we don't keep. */
  const episodeField = (name: string): string | null => {
    if (name === "title") return "title";
    if (name === "description" || name === "summary" || name === "content:encoded") return "description";
    if (name === "pubdate" || name === "published" || name === "updated") return "published";
    if (name === "duration" || name === "itunes:duration") return "duration";
    if (name === "guid" || name === "id") return "guid";
    return null;
  };

  parser.onopentag = (node) => {
    // Sax in strict mode keeps a tag's case, and feeds are written <pubDate>, <guid> and
    // <itunes:duration> — compare in one case so none of them are missed.
    const name = node.name.toLowerCase();
    enter(name);
    if (episode) {
      // An enclosure (or Atom's link rel="enclosure") is the audio file.
      const attrs = node.attributes as Record<string, string>;
      if (name === "enclosure" || name === "media:content") {
        const url = attrs.url ?? attrs.href;
        if (url && /^https?:/i.test(url)) {
          episode.url ??= url;
          const length = Number(attrs.length);
          if (!episode.durationMs && Number.isFinite(length) && length > 0) {
            // Not a duration: enclosure lengths are bytes. Left alone on purpose.
          }
        }
        return;
      }
      if (name === "link") {
        const rel = attrs.rel;
        const href = attrs.href;
        const type = attrs.type ?? "";
        if (href && /^https?:/i.test(href) && (rel === "enclosure" || /audio/i.test(type))) episode.url ??= href;
        if (href && /^https?:/i.test(href) && !rel) episode.url ??= href;
        return;
      }
      if (name === "image" || name === "itunes:image") {
        const href = attrs.href;
        if (href && /^https?:/i.test(href)) episode.image ??= href;
        return;
      }
      const field = episodeField(name);
      if (field) capturing = { at: "episode", field, into: [] };
      return;
    }
    if (name === "image") {
      const href = node.attributes as Record<string, string>;
      if (href.href && /^https?:/i.test(href.href)) imageUrl ??= href.href;
    }
    if (name === "itunes:author" || name === "author") capturing = { at: "feed", field: "author", into: [] };
    if (name === "itunes:image" || name === "image") {
      const href = (node.attributes as Record<string, string>).href;
      if (href && /^https?:/i.test(href)) imageUrl ??= href;
    }
  };
  parser.ontext = (chunk) => capturing?.into.push(chunk);
  parser.oncdata = (chunk) => capturing?.into.push(chunk);
  parser.onclosetag = (name) => {
    if (name === "item" || name === "entry") {
      const draft = episode as Draft | null;
      if (draft?.title && draft.url) {
        feed.episodes.push({
          title: draft.title,
          url: draft.url,
          publishedAt: draft.publishedAt ?? 0,
          ...(draft.durationMs ? { durationMs: draft.durationMs } : {}),
          ...(draft.description ? { description: draft.description } : {}),
          ...(draft.image ? { image: draft.image } : {}),
        });
      }
      episode = null;
      capturing = null;
      return;
    }
    if (!capturing) return;
    const raw = capturing.into.join("");
    const value = text(raw);
    if (capturing.at === "feed") {
      if (capturing.field === "title" && !channelTitle) channelTitle = value ?? "";
      if (capturing.field === "author" && !author) author = value;
      if (capturing.field === "description" && value && !description) description = value.slice(0, 2000);
    } else if (episode) {
      const field = capturing.field;
      const draft = episode as Draft;
      if (field === "title" && value && !draft.title) draft.title = value.slice(0, 300);
      if (field === "description" && value) draft.description = value.slice(0, 4000);
      if (field === "published") draft.publishedAt ??= feedDate(value);
      if (field === "duration") draft.durationMs ??= feedDuration(value);
    }
    capturing = null;
  };
  // A feed with one broken element shouldn't lose the rest of itself.
  parser.onerror = () => undefined;

  try {
    parser.write(xml).close();
  } catch {
    // Handled by the onerror above; keep whatever was read.
  }

  feed.title = (channelTitle || "").slice(0, 200);
  if (author) feed.author = author.slice(0, 200);
  if (description) feed.description = description;
  if (imageUrl) feed.image = imageUrl;
  // Newest first, and don't grow without bound on a long-running show.
  feed.episodes.sort((a, b) => b.publishedAt - a.publishedAt);
  feed.episodes = feed.episodes.slice(0, MAX_EPISODES);
  return feed;
}

export { MAX_FEED_BYTES };
