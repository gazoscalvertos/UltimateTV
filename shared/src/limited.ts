/**
 * Limited mode (#78): the reduced TV app the box shows when the Hub is off.
 *
 * The Hub hands the box one snapshot of what it needs (GET /api/box/offline): the channel list
 * with playable URLs, a week of guide, the profiles with their Kids rules, and the Jellyfin
 * connection. The box keeps it on disk and shows it with no network at all.
 *
 * Everything here is pure so both sides agree: the Hub builds the snapshot with it and the box
 * reads it back, trims it and filters it for the profile on the TV. That sharing matters most for
 * the Kids rules — the box must apply exactly what the Hub would have applied (see
 * `certificationRank`, `allowsChannel` and `allowsTitle`), or a Kids profile could see more with
 * the Hub off than with it on.
 */
import { CERTIFICATIONS, CHANNEL_CATEGORIES, type Certification, type ChannelCategory, type ProfileKind } from "./domain.js";
import { kidsAllowLookup, kidsAllowSays, type KidsAllowKind, type KidsAllowList } from "./kidsallow.js";

/** How much guide the box keeps: a week, so a holiday week still has a grid. */
export const LIMITED_GUIDE_DAYS = 7;
/** The grid starts an hour back so a programme that has just started is still there. */
export const LIMITED_GUIDE_BACK_MS = 60 * 60_000;
/** Per channel, the most programmes kept: stops a snapshot growing without end. */
export const LIMITED_MAX_PER_CHANNEL = 240;

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

/** Films and series for children, as the Hub decides it for anything without a certificate. */
export const KIDS_GENRES = /\b(family|kids|children|children's)\b/i;

const RATING_MAP: Record<string, Certification> = {
  U: "U",
  UC: "U",
  G: "U",
  "TV-Y": "U",
  "TV-Y7": "U",
  "TV-G": "U",
  "0": "U",
  "6": "U",
  PG: "PG",
  "TV-PG": "PG",
  "12": "12",
  "12A": "12A",
  "PG-13": "12A",
  "TV-14": "15",
  "15": "15",
  "16": "15",
  R: "18",
  "18": "18",
  "NC-17": "18",
  "TV-MA": "18",
  R18: "18",
};

/**
 * Where a rating sits in the household's own ladder (U, PG, 12, 12A, 15, 18), or null when it
 * isn't a rating this house knows. Shared so the Hub and the box's Limited mode never disagree.
 */
export function certificationRank(rating: string | undefined): number | null {
  if (!rating) return null;
  const key = rating.toUpperCase().replace(/^GB-|^UK-|^US-/, "").trim();
  const cert = RATING_MAP[key];
  return cert ? CERTIFICATIONS.indexOf(cert) : null;
}

/** A programme as the box keeps it: what a grid shows, and nothing else. */
export interface LimitedProgramme {
  id: string;
  channelId: string;
  start: number;
  end: number;
  title: string;
  subtitle?: string;
  image?: string;
  categories: string[];
  isNew: boolean;
  isRepeat: boolean;
  isFilm: boolean;
}

/** A channel as the box keeps it, with the URL it plays from with no Hub. */
export interface LimitedChannel {
  id: string;
  number: number;
  name: string;
  logo?: string;
  category: ChannelCategory;
  userCategory?: string;
  /** The channel's first feed. Missing when the channel has no source yet. */
  url?: string;
  /** Headers the feed needs: the same User-Agent the Hub's relay sends. */
  headers?: Record<string, string>;
}

/** A profile with the rules a Kids profile needs, so the box can enforce them alone. */
export interface LimitedProfile {
  id: string;
  name: string;
  kind: ProfileKind;
  maxCertification: Certification;
  channelCategories: ChannelCategory[];
  allowedChannels: string[];
  /** The household's by-hand allow and block lists, if any. */
  allow?: KidsAllowList;
}

export interface LimitedJellyfinTitle {
  /** Jellyfin's own item id, which is what a stream URL and progress reports use. */
  id: string;
  /** The household-side reference (`jellyfin:…` or `tmdb:…`), which is what allow lists use. */
  refId: string;
  kind: "movie" | "series";
  name: string;
  subtitle?: string;
  poster?: string;
  backdrop?: string;
  positionMs?: number;
  runtimeMs?: number;
  genres?: string[];
  certification?: string;
  /** Jellyfin's media source, when the film has more than one. */
  sourceId?: string;
}

export interface LimitedJellyfin {
  url: string;
  serverName?: string;
  userId: string;
  /** Sent to Jellyfin directly, so a film plays and reports progress with the Hub off. */
  token: string;
  items: LimitedJellyfinTitle[];
}

/** A tap on the Limited-mode screen: a channel, or a Jellyfin film. */
export type LimitedPlayRequest = { kind: "channel"; id: string } | { kind: "jellyfin"; id: string };

/** Whether that tap played, and one plain sentence when it didn't. */
export type LimitedPlayAnswer =
  | { ok: true; title: string; subtitle?: string; artwork?: string; live: boolean; durationMs?: number }
  | { ok: false; reason: string };

/** Everything the box keeps for Limited mode. */
export interface LimitedSnapshot {
  at: number;
  channels: LimitedChannel[];
  guide: { from: number; to: number; programmes: Record<string, LimitedProgramme[]> };
  profiles: LimitedProfile[];
  jellyfin?: LimitedJellyfin;
}

/** One programme in a rail. */
export interface LimitedSlot {
  id: string;
  title: string;
  subtitle?: string;
  start: number;
  end: number;
  image?: string;
}

export interface LimitedViewChannel {
  id: string;
  number: number;
  name: string;
  logo?: string;
  category: ChannelCategory;
  /** False when the channel is in the guide but has no URL the box can play. */
  playable: boolean;
  now?: LimitedSlot;
  next?: LimitedSlot;
  programmes: LimitedSlot[];
}

export interface LimitedViewJellyfin {
  serverName: string;
  items: { id: string; name: string; subtitle?: string; poster?: string; positionMs?: number; runtimeMs?: number }[];
}

/** What Limited mode's screen gets: already filtered for the profile on the TV. */
export interface LimitedView {
  at: number;
  /** Who the box thinks is watching, if it knows. */
  profile: string | null;
  kids: boolean;
  channels: LimitedViewChannel[];
  jellyfin: LimitedViewJellyfin | null;
  guideFrom: number;
  guideTo: number;
}

const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asText = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const asNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asTexts = (v: unknown): string[] => asList(v).filter((x): x is string => typeof x === "string");
const asBool = (v: unknown): boolean => v === true;
const asCategory = (v: unknown): ChannelCategory => (typeof v === "string" && (CHANNEL_CATEGORIES as readonly string[]).includes(v) ? (v as ChannelCategory) : "other");
const asCert = (v: unknown): Certification | undefined => (typeof v === "string" && (CERTIFICATIONS as readonly string[]).includes(v) ? (v as Certification) : undefined);
const asKind = (v: unknown): ProfileKind => (v === "kids" || v === "guest" ? v : "adult");
const asHeaders = (v: unknown): Record<string, string> | undefined => {
  const r = asRecord(v);
  if (!r) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(r)) if (typeof val === "string") out[k] = val;
  return Object.keys(out).length ? out : undefined;
};

function readChannel(v: unknown): LimitedChannel | null {
  const r = asRecord(v);
  const id = asText(r?.id);
  const name = asText(r?.name);
  if (!r || !id || !name) return null;
  const url = asText(r.url);
  const headers = asHeaders(r.headers);
  return {
    id,
    number: asNum(r.number) ?? 0,
    name,
    ...(asText(r.logo) ? { logo: asText(r.logo)! } : {}),
    category: asCategory(r.category),
    ...(asText(r.userCategory) ? { userCategory: asText(r.userCategory)! } : {}),
    ...(url ? { url } : {}),
    ...(url && headers ? { headers } : {}),
  };
}

function readProgramme(v: unknown, channelId: string): LimitedProgramme | null {
  const r = asRecord(v);
  if (!r) return null;
  const id = asText(r.id);
  const title = asText(r.title);
  const start = asNum(r.start);
  const end = asNum(r.end);
  if (!id || !title || start === undefined || end === undefined || end <= start) return null;
  return {
    id,
    channelId: asText(r.channelId) ?? channelId,
    start,
    end,
    title,
    ...(asText(r.subtitle) ? { subtitle: asText(r.subtitle)! } : {}),
    ...(asText(r.image) ? { image: asText(r.image)! } : {}),
    categories: asTexts(r.categories),
    isNew: asBool(r.isNew),
    isRepeat: asBool(r.isRepeat),
    isFilm: asBool(r.isFilm),
  };
}

function readProfile(v: unknown): LimitedProfile | null {
  const r = asRecord(v);
  const id = asText(r?.id);
  const name = asText(r?.name);
  if (!r || !id || !name) return null;
  const kind = asKind(r.kind);
  const allow = asRecord(r.allow);
  const allowList = allow ? { allow: asList(allow.allow), block: asList(allow.block) } : null;
  return {
    id,
    name,
    kind,
    maxCertification: asCert(r.maxCertification) ?? (kind === "kids" ? "U" : "18"),
    channelCategories: asList(r.channelCategories).map(asCategory),
    allowedChannels: asTexts(r.allowedChannels),
    ...(allowList ? { allow: { allow: asList(allowList.allow) as KidsAllowList["allow"], block: asList(allowList.block) as KidsAllowList["block"] } } : {}),
  };
}

function readJellyfinTitle(v: unknown): LimitedJellyfinTitle | null {
  const r = asRecord(v);
  const id = asText(r?.id);
  const name = asText(r?.name);
  if (!r || !id || !name) return null;
  const positionMs = asNum(r.positionMs);
  const runtimeMs = asNum(r.runtimeMs);
  return {
    id,
    refId: asText(r.refId) ?? `jellyfin:${id}`,
    kind: r.kind === "series" ? "series" : "movie",
    name,
    ...(asText(r.subtitle) ? { subtitle: asText(r.subtitle)! } : {}),
    ...(asText(r.poster) ? { poster: asText(r.poster)! } : {}),
    ...(asText(r.backdrop) ? { backdrop: asText(r.backdrop)! } : {}),
    ...(positionMs !== undefined ? { positionMs } : {}),
    ...(runtimeMs !== undefined ? { runtimeMs } : {}),
    ...(asTexts(r.genres).length ? { genres: asTexts(r.genres) } : {}),
    ...(asText(r.certification) ? { certification: asText(r.certification)! } : {}),
    ...(asText(r.sourceId) ? { sourceId: asText(r.sourceId)! } : {}),
  };
}

function readJellyfin(v: unknown): LimitedJellyfin | undefined {
  const r = asRecord(v);
  const url = asText(r?.url);
  const userId = asText(r?.userId);
  const token = asText(r?.token);
  if (!r || !url || !userId || !token) return undefined;
  return {
    url,
    ...(asText(r.serverName) ? { serverName: asText(r.serverName)! } : {}),
    userId,
    token,
    items: asList(r.items)
      .map(readJellyfinTitle)
      .filter((i): i is LimitedJellyfinTitle => i !== null),
  };
}

/**
 * Turns whatever is on disk (or whatever the Hub just sent) into a snapshot, or null when it is
 * missing, corrupt or not a snapshot at all. Never throws: a box with a bad cache file still boots.
 *
 * The guide is cut to the week ahead of `now` and to `LIMITED_MAX_PER_CHANNEL` per channel here,
 * so an old snapshot read back months later comes out small and current.
 */
export function parseLimitedSnapshot(raw: unknown, now: number = Date.now()): LimitedSnapshot | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  const r = asRecord(value);
  if (!r) return null;
  const channelList = asList(r.channels);
  if (!channelList.length) return null;
  const channels = channelList.map(readChannel).filter((c): c is LimitedChannel => c !== null);
  if (!channels.length) return null;

  const guide = asRecord(r.guide);
  const from = Math.max(asNum(guide?.from) ?? now - LIMITED_GUIDE_BACK_MS, now - LIMITED_GUIDE_BACK_MS);
  const to = Math.min(asNum(guide?.to) ?? now + LIMITED_GUIDE_DAYS * DAY_MS, now + LIMITED_GUIDE_DAYS * DAY_MS);
  const rawProgrammes = asRecord(guide?.programmes) ?? {};
  const programmes: Record<string, LimitedProgramme[]> = {};
  for (const channel of channels) {
    const rows = asList(rawProgrammes[channel.id])
      .map((p) => readProgramme(p, channel.id))
      .filter((p): p is LimitedProgramme => p !== null && p.end > from && p.start < to)
      .sort((a, b) => a.start - b.start)
      .slice(0, LIMITED_MAX_PER_CHANNEL);
    if (rows.length) programmes[channel.id] = rows;
  }

  const profiles = asList(r.profiles)
    .map(readProfile)
    .filter((p): p is LimitedProfile => p !== null);

  const jellyfin = readJellyfin(r.jellyfin);
  return {
    at: asNum(r.at) ?? now,
    channels,
    guide: { from, to, programmes },
    profiles,
    ...(jellyfin ? { jellyfin } : {}),
  };
}

/**
 * The profile Limited mode should use for whoever the TV says is watching.
 *
 * An unknown viewer counts as Kids: the box only learns whose profile is up from the TV app, and a
 * box that has never been told may well have a child in front of it. With the Hub off there is
 * nobody to ask, so too little beats too much. A grown-up whose name isn't in the cached profiles
 * gets null, which is the adult view.
 */
export function limitedProfileFor(snapshot: LimitedSnapshot, viewer: { name: string; kids: boolean } | null): LimitedProfile | null {
  const byName = viewer ? snapshot.profiles.find((p) => p.name === viewer.name) : undefined;
  if (byName) return byName;
  if (viewer && !viewer.kids) return null;
  const kidsOne = snapshot.profiles.find((p) => p.kind === "kids");
  if (kidsOne) return kidsOne;
  // Nothing cached to say what a child may watch: the strictest reading of the rules.
  return { id: "", name: viewer?.name || "Kids", kind: "kids", maxCertification: "U", channelCategories: ["kids"], allowedChannels: [] };
}

function allowLookup(profile: LimitedProfile) {
  return profile.allow ? kidsAllowLookup(profile.allow) : null;
}

/** Whether this profile may see this channel: the Hub's own rule, run on the box. */
export function allowsChannel(profile: LimitedProfile | null, channel: { id: string; name: string; category: ChannelCategory }): boolean {
  if (!profile) return true;
  const lookup = allowLookup(profile);
  const said = lookup ? kidsAllowSays(lookup, "channel", channel.id, channel.name) : null;
  if (said === "block") return false;
  if (said === "allow") return true;
  if (profile.kind === "adult") return true;
  const kids = profile.kind === "kids";
  const categories = profile.channelCategories.length ? profile.channelCategories : kids ? (["kids"] as ChannelCategory[]) : [];
  if (!categories.length) return true;
  return categories.includes(channel.category) || profile.allowedChannels.includes(channel.id);
}

/** Whether this profile may see this film or series: the Hub's own certificate and genre rule. */
export function allowsTitle(profile: LimitedProfile | null, title: { refId: string; name: string; kind: KidsAllowKind; genres?: string[]; certification?: string }): boolean {
  if (!profile) return true;
  const lookup = allowLookup(profile);
  const said = lookup ? kidsAllowSays(lookup, title.kind, title.refId, title.name) : null;
  if (said === "block") return false;
  if (said === "allow") return true;
  if (profile.kind === "adult") return true;
  const rank = certificationRank(title.certification);
  const max = CERTIFICATIONS.indexOf(profile.maxCertification);
  if (rank !== null) return rank <= max;
  if (profile.kind === "guest") return true;
  return (title.genres ?? []).some((g) => KIDS_GENRES.test(g));
}

const slot = (p: LimitedProgramme): LimitedSlot => ({ id: p.id, title: p.title, ...(p.subtitle ? { subtitle: p.subtitle } : {}), start: p.start, end: p.end, ...(p.image ? { image: p.image } : {}) });

/**
 * What the Limited mode screen shows for one viewer: the channels and programmes they may see,
 * what's on now and next on each, and the Jellyfin films they may carry on with.
 *
 * Kids rules are applied HERE, on the box, from the cached profile: with the Hub off there is
 * nobody else to ask, and a Kids profile must see exactly what it would see with the Hub on.
 */
export function limitedView(snapshot: LimitedSnapshot | null, viewer: { name: string; kids: boolean } | null, now: number = Date.now()): LimitedView {
  const empty: LimitedView = { at: now, profile: viewer?.name ?? null, kids: viewer?.kids ?? false, channels: [], jellyfin: null, guideFrom: now, guideTo: now };
  if (!snapshot) return empty;
  const profile = limitedProfileFor(snapshot, viewer);
  const kids = profile?.kind === "kids";
  const channels: LimitedViewChannel[] = [];
  for (const channel of snapshot.channels) {
    if (!allowsChannel(profile, channel)) continue;
    const all = snapshot.guide.programmes[channel.id] ?? [];
    const nowRow = all.find((p) => p.start <= now && p.end > now);
    const nextRow = all.find((p) => p.start >= (nowRow?.end ?? now));
    // The whole week the box kept: that is what makes the guide's later days work with the Hub off.
    const rows = all;
    channels.push({
      id: channel.id,
      number: channel.number,
      name: channel.name,
      ...(channel.logo ? { logo: channel.logo } : {}),
      category: channel.category,
      playable: Boolean(channel.url),
      ...(nowRow ? { now: slot(nowRow) } : {}),
      ...(nextRow ? { next: slot(nextRow) } : {}),
      programmes: rows.map(slot),
    });
  }
  channels.sort((a, b) => a.number - b.number);
  const jf = snapshot.jellyfin;
  const items = jf
    ? jf.items.filter((i) => allowsTitle(profile, { refId: i.refId, name: i.name, kind: i.kind, ...(i.genres ? { genres: i.genres } : {}), ...(i.certification ? { certification: i.certification } : {}) }))
    : [];
  return {
    at: snapshot.at,
    profile: profile?.name ?? viewer?.name ?? null,
    kids,
    channels,
    jellyfin: jf ? { serverName: jf.serverName ?? "Jellyfin", items: items.map((i) => ({ id: i.id, name: i.name, ...(i.subtitle ? { subtitle: i.subtitle } : {}), ...(i.poster ? { poster: i.poster } : {}), ...(i.positionMs !== undefined ? { positionMs: i.positionMs } : {}), ...(i.runtimeMs !== undefined ? { runtimeMs: i.runtimeMs } : {}) })) } : null,
    guideFrom: snapshot.guide.from,
    guideTo: snapshot.guide.to,
  };
}
