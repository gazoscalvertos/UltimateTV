// Turns raw provider streams into the channel list the guide shows: merged across providers,
// deduped (FHD/HD/SD of one channel become feeds of a single channel), categorised and numbered.

import type { Channel, ChannelCategory, ChannelFeed } from "@ultimatetv/shared";
import { heightFromName, normaliseChannelName } from "@ultimatetv/shared";
import type { Db } from "./db.js";

export interface RawFeed {
  sourceId: string;
  upstreamId: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  epgId?: string;
  catchupDays: number;
  /** M3U catch-up URL template (catchup-source), when the playlist provides one. */
  catchupSource?: string;
  /** Provider's order, used to keep provider numbering when asked. */
  providerNumber?: number;
}

export interface StoredFeed extends ChannelFeed {
  channelId: string;
  upstreamId: string;
  url: string;
  catchupSource?: string;
}

const CATEGORY_RULES: [ChannelCategory, RegExp][] = [
  ["sport", /\b(sports?|football|tnt sport|premier|racing|golf|cricket|f1|boxing|eurosport|laliga|nfl|nba)\b/i],
  ["news", /\b(news|cnn|gb news|bloomberg|al jazeera|parliament|cnbc|euronews)\b/i],
  ["films", /\b(movies?|films?|cinema|film4|tcm|great! ?movies)\b/i],
  ["kids", /\b(kids|cbbc|cbeebies|nick|nickelodeon|cartoon|boomerang|disney ?jr|pop|tiny pop|baby)\b/i],
  ["music", /\b(music|mtv|kerrang|kiss|magic|box hits|vevo|clubland|now 80s|now 90s)\b/i],
  ["documentaries", /\b(documentar|discovery|nat ?geo|national geographic|history|eden|quest|crime|blaze|animal planet|smithsonian|yesterday)\b/i],
];

export function categorise(name: string, group = ""): ChannelCategory {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(name)) return cat;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(group)) return cat;
  return "entertainment";
}

/** Where each category starts, mirroring Sky's EPG blocks (100s entertainment, 300s films, 400s sport …). */
const BLOCK_START: Record<ChannelCategory, number> = {
  entertainment: 101,
  films: 301,
  music: 350,
  sport: 401,
  news: 501,
  documentaries: 521,
  kids: 601,
  other: 801,
};

/** Channels that always lead their block, in this order. Everything else follows alphabetically. */
const UK_LEADERS: Partial<Record<ChannelCategory, string[]>> = {
  entertainment: [
    "bbc one", "bbc two", "itv1", "channel 4", "channel 5", "bbc three", "bbc four", "itv2", "itv3", "itv4", "itvbe",
    "e4", "more4", "sky showcase", "sky atlantic", "sky max", "sky witness", "sky comedy", "sky arts", "dave", "gold",
    "w", "alibi", "drama", "u and dave", "comedy central", "5star", "5usa", "channel 4 plus 1", "itv1 plus 1",
  ],
  films: ["film4", "sky cinema premiere", "sky cinema select", "sky cinema hits", "sky cinema greats", "sky cinema family", "sky cinema action", "sky cinema comedy", "sky cinema thriller", "sky cinema drama", "sky cinema sci fi horror", "sky cinema animation", "tcm", "great movies"],
  sport: ["sky sports main event", "sky sports premier league", "sky sports football", "sky sports cricket", "sky sports golf", "sky sports f1", "sky sports action", "sky sports arena", "sky sports news", "sky sports mix", "sky sports racing", "tnt sports 1", "tnt sports 2", "tnt sports 3", "tnt sports 4", "eurosport 1", "eurosport 2", "premier sports 1", "premier sports 2"],
  news: ["bbc news", "sky news", "gb news", "cnn", "bbc parliament", "al jazeera english", "bloomberg", "cnbc"],
  kids: ["cbbc", "cbeebies", "cartoon network", "nickelodeon", "nick jr", "disney jr", "pop", "tiny pop", "boomerang"],
};

interface Group {
  key: string;
  name: string;
  logo?: string;
  epgId?: string;
  category: ChannelCategory;
  feeds: (RawFeed & { height: number })[];
  providerNumber: number;
  visible: boolean;
}

export function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "channel";
}

/** Cleans a provider name for display: "UK: BBC One FHD" → "BBC One". */
export function displayName(name: string): string {
  return name
    .replace(/^[A-Z]{2,3}\s*[:|\-]\s*/, "")
    .replace(/\s*\b(FHD|UHD|HD|SD|4K|HEVC|H265|1080p?|720p?|50FPS|RAW|Backup|VIP)\b/gi, "")
    .replace(/\s*[|\-:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface BuildOptions {
  numbering: "uk" | "provider";
  filter: RegExp | null;
  /** Numbers and flags the user already has, kept stable across refreshes. */
  existing: Map<string, { number: number; favourite: boolean; hidden: boolean; userHidden?: boolean }>;
}

export function buildChannels(raw: RawFeed[], options: BuildOptions): { channels: Channel[]; feeds: StoredFeed[] } {
  const groups = new Map<string, Group>();
  raw.forEach((f, index) => {
    // Grouped by the id-safe slug: names that differ only in punctuation ("E4+1" / "E4 1") would
    // otherwise become two channels with the same id.
    const name = normaliseChannelName(f.name);
    if (!name) return;
    const key = slug(name);
    const height = heightFromName(f.name);
    const visible = !options.filter || options.filter.test(f.group ?? "") || options.filter.test(f.name);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: displayName(f.name), category: categorise(f.name, f.group), feeds: [], providerNumber: f.providerNumber ?? index + 1, visible };
      groups.set(key, g);
    }
    g.visible ||= visible;
    if (f.logo && !g.logo) g.logo = f.logo;
    if (f.epgId && !g.epgId) g.epgId = f.epgId;
    g.feeds.push({ ...f, height });
  });

  const channels: Channel[] = [];
  const feeds: StoredFeed[] = [];
  const used = new Set<number>();
  for (const e of options.existing.values()) used.add(e.number);

  const ordered = [...groups.values()].sort((a, b) => a.providerNumber - b.providerNumber);
  const pending: Group[] = [];
  for (const g of ordered) {
    const id = g.key;
    if (!options.existing.has(id)) pending.push(g);
  }
  const assigned = assignNumbers(pending, options.numbering, used);

  for (const g of ordered) {
    const id = g.key;
    const prev = options.existing.get(id);
    const number = prev?.number ?? assigned.get(g) ?? 9999;
    // Best feed first: highest resolution, then provider order. UHD feeds go after FHD because many UHD
    // IPTV feeds are event-only; the guide's UHD tab still finds them via maxHeight.
    const sorted = [...g.feeds].sort((a, b) => feedRank(b.height) - feedRank(a.height));
    const channelFeeds: StoredFeed[] = sorted.map((f, i) => {
      const stored: StoredFeed = {
        id: `${f.sourceId}:${f.upstreamId}`,
        sourceId: f.sourceId,
        name: f.name,
        height: f.height,
        priority: i,
        catchupDays: f.catchupDays,
        channelId: id,
        upstreamId: f.upstreamId,
        url: f.url,
      };
      if (f.catchupSource) stored.catchupSource = f.catchupSource;
      return stored;
    });
    for (const f of channelFeeds) feeds.push(f);
    const channel: Channel = {
      id,
      number,
      name: g.name,
      category: g.category,
      feeds: channelFeeds.map(({ channelId: _c, upstreamId: _u, url: _url, catchupSource: _cs, ...feed }) => feed),
      favourite: prev?.favourite ?? false,
      hidden: prev?.userHidden ?? !g.visible,
      maxHeight: Math.max(...g.feeds.map((f) => f.height)),
      catchupDays: Math.max(...g.feeds.map((f) => f.catchupDays)),
    };
    if (g.logo) channel.logo = g.logo;
    if (g.epgId) channel.epgId = g.epgId;
    channels.push(channel);
  }
  channels.sort((a, b) => a.number - b.number);
  return { channels, feeds };
}

function feedRank(height: number): number {
  return height === 1080 ? 4 : height === 2160 ? 3 : height === 720 ? 2 : 1;
}

function assignNumbers(groups: Group[], numbering: "uk" | "provider", used: Set<number>): Map<Group, number> {
  const result = new Map<Group, number>();
  const take = (start: number) => {
    let n = start;
    while (used.has(n)) n++;
    used.add(n);
    return n;
  };

  if (numbering === "provider") {
    for (const g of groups) result.set(g, take(g.providerNumber + 100));
    return result;
  }

  // Visible channels get the Sky-style blocks; hidden (filtered-out) ones go to 1000+.
  const byCategory = new Map<ChannelCategory, Group[]>();
  for (const g of groups) {
    if (!g.visible) continue;
    const list = byCategory.get(g.category) ?? [];
    list.push(g);
    byCategory.set(g.category, list);
  }
  for (const [cat, list] of byCategory) {
    const leaders = (UK_LEADERS[cat] ?? []).map(slug);
    const rank = (g: Group) => {
      const i = leaders.indexOf(g.key);
      return i === -1 ? leaders.length : i;
    };
    list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    // Leaders keep their slot even when an earlier one is missing, so BBC Two is 102 with or without BBC One.
    for (const g of list) {
      const r = rank(g);
      const n = r < leaders.length && !used.has(BLOCK_START[cat] + r) ? BLOCK_START[cat] + r : take(BLOCK_START[cat] + leaders.length);
      used.add(n);
      result.set(g, n);
    }
  }
  for (const g of groups) if (!g.visible) result.set(g, take(1001));
  return result;
}

// ---------------------------------------------------------------------------
// Storage

export class ChannelStore {
  constructor(private db: Db) {}

  replace(channels: Channel[], feeds: StoredFeed[]): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM channels");
      this.db.run("DELETE FROM feeds");
      for (const c of channels) {
        this.db.run("INSERT INTO channels (id, number, name, epg_id, hidden, data) VALUES (?, ?, ?, ?, ?, ?)", c.id, c.number, c.name, c.epgId ?? null, c.hidden ? 1 : 0, JSON.stringify(c));
      }
      for (const f of feeds) {
        this.db.run("INSERT OR REPLACE INTO feeds (id, channel_id, source_id, upstream_id, url, priority, data) VALUES (?, ?, ?, ?, ?, ?, ?)", f.id, f.channelId, f.sourceId, f.upstreamId, f.url, f.priority, JSON.stringify(f));
      }
    });
  }

  existingFlags(): BuildOptions["existing"] {
    const map: BuildOptions["existing"] = new Map();
    for (const c of this.db.json<Channel & { userHidden?: boolean }>("SELECT data FROM channels")) {
      map.set(c.id, { number: c.number, favourite: c.favourite, hidden: c.hidden, ...(c.userHidden !== undefined ? { userHidden: c.userHidden } : {}) });
    }
    return map;
  }

  list(includeHidden = false): Channel[] {
    return this.db.json<Channel>(`SELECT data FROM channels ${includeHidden ? "" : "WHERE hidden = 0"} ORDER BY number`);
  }

  get(id: string): Channel | undefined {
    return this.db.jsonOne<Channel>("SELECT data FROM channels WHERE id = ?", id);
  }

  byNumber(number: number): Channel | undefined {
    return this.db.jsonOne<Channel>("SELECT data FROM channels WHERE number = ? AND hidden = 0", number);
  }

  feeds(channelId: string): StoredFeed[] {
    return this.db.json<StoredFeed>("SELECT data FROM feeds WHERE channel_id = ? ORDER BY priority", channelId);
  }

  update(id: string, patch: { favourite?: boolean; hidden?: boolean; number?: number }): Channel | undefined {
    const c = this.get(id) as (Channel & { userHidden?: boolean }) | undefined;
    if (!c) return undefined;
    if (patch.favourite !== undefined) c.favourite = patch.favourite;
    if (patch.hidden !== undefined) {
      c.hidden = patch.hidden;
      c.userHidden = patch.hidden;
    }
    if (patch.number !== undefined) {
      const clash = this.byNumber(patch.number);
      if (clash && clash.id !== id) throw new Error(`Channel ${patch.number} is already ${clash.name}`);
      c.number = patch.number;
    }
    this.db.run("UPDATE channels SET number = ?, hidden = ?, data = ? WHERE id = ?", c.number, c.hidden ? 1 : 0, JSON.stringify(c), id);
    return c;
  }

  count(): number {
    return Number(this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE hidden = 0")?.n ?? 0);
  }
}
