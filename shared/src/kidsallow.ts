// What a parent has had the last word on for a Kids profile: a title or channel the rating limit
// would have kept out ("Allow for Kids") and one it would have let through ("Hide from Kids").
// Ratings are blunt — most IPTV VOD has none at all, and a certificate the studio picked in
// another country doesn't always land on the UK scale — so the parent's say-so wins either way.
//
// Lists are per Kids profile, and only adult profiles may change them.

import type { Id } from "./domain.js";

/** A title or a channel: `movie` for a film, `series` for a show, `channel` for a channel. */
export type KidsAllowKind = "movie" | "series" | "channel";

/** One entry in the list. `name` is kept so the phone can show it without asking the Hub for it. */
export interface KidsAllowEntry {
  /** The title's id (`tmdb:movie:…`, `jellyfin:…`, `programme:…`) or the channel's id. */
  id: Id;
  kind: KidsAllowKind;
  /** The title's or channel's name, for the list on the phone. */
  name: string;
  /** Added at, so the list can be shown newest first. */
  addedAt: number;
}

/** What one Kids profile has been allowed and blocked. */
export interface KidsAllowList {
  /** Shown to Kids even though the rating says no. */
  allow: KidsAllowEntry[];
  /** Kept from Kids even though the rating says yes. */
  block: KidsAllowEntry[];
}

export const NO_KIDS_ALLOW: KidsAllowList = { allow: [], block: [] };

/** How long the lists may grow; a parent is not going to curate thousands of titles. */
export const MAX_KIDS_ALLOW = 500;

const KINDS = new Set<string>(["movie", "series", "channel"]);

export function isKidsAllowKind(v: unknown): v is KidsAllowKind {
  return typeof v === "string" && KINDS.has(v);
}

/** One entry, cleaned: anything that isn't a title or channel id and name is dropped. */
export function cleanKidsAllowEntry(raw: unknown, now = Date.now()): KidsAllowEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<KidsAllowEntry>;
  if (typeof r.id !== "string" || !r.id.trim()) return null;
  if (!isKidsAllowKind(r.kind)) return null;
  if (typeof r.name !== "string" || !r.name.trim()) return null;
  const addedAt = typeof r.addedAt === "number" && Number.isFinite(r.addedAt) ? r.addedAt : now;
  return { id: r.id.trim(), kind: r.kind, name: r.name.trim().slice(0, 200), addedAt };
}

/** A whole list, cleaned: junk dropped, duplicates on id+kind collapsed to the newest entry. */
export function cleanKidsAllowEntries(raw: unknown, now = Date.now()): KidsAllowEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, KidsAllowEntry>();
  for (const item of raw) {
    const entry = cleanKidsAllowEntry(item, now);
    if (!entry) continue;
    const key = `${entry.kind}:${entry.id}`;
    const had = seen.get(key);
    if (!had || entry.addedAt > had.addedAt) seen.set(key, entry);
  }
  return [...seen.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, MAX_KIDS_ALLOW);
}

/** A whole stored allow-list, tolerating anything the database happens to hold. */
export function cleanKidsAllowList(raw: unknown, now = Date.now()): KidsAllowList {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<KidsAllowList>;
  return { allow: cleanKidsAllowEntries(r.allow, now), block: cleanKidsAllowEntries(r.block, now) };
}

/** "movie:tmdb:movie:123" — the key a filter checks, so a film and a series can share an id prefix. */
export function kidsAllowKey(kind: KidsAllowKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Fast lookups for the filter, built once per request from the stored lists. Ids catch the same
 * title wherever it turns up; the names catch a film or series by what it's called, because a
 * broadcast's id changes with every airing (`programme:film4:1793600000000`) and the parent
 * meant the film, not that showing of it.
 */
export interface KidsAllowLookup {
  allow: ReadonlySet<string>;
  block: ReadonlySet<string>;
  /** Normalised names of the allowed and blocked films and series. */
  allowNames: ReadonlySet<string>;
  blockNames: ReadonlySet<string>;
}

/** The same normalising the guide uses, so "The Dune (UK)" and "Dune" meet. */
export function kidsAllowName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\((new|uk|us|hd|\d{4})\)/g, " ")
    .replace(/^(new|live):\s*/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ")
    .trim();
}

const names = (entries: KidsAllowEntry[]) => new Set(entries.filter((e) => e.kind !== "channel").map((e) => kidsAllowName(e.name)).filter(Boolean));

export function kidsAllowLookup(list: KidsAllowList): KidsAllowLookup {
  const keys = (entries: KidsAllowEntry[]) => new Set(entries.map((e) => kidsAllowKey(e.kind, e.id)));
  return { allow: keys(list.allow), block: keys(list.block), allowNames: names(list.allow), blockNames: names(list.block) };
}

export const NO_KIDS_ALLOW_LOOKUP: KidsAllowLookup = { allow: new Set(), block: new Set(), allowNames: new Set(), blockNames: new Set() };

/**
 * Whether a parent has said yes or no to this title or channel: `allow`, `block`, or null for
 * "no opinion, go by the rating". An id match beats a name match, so a parent can block a whole
 * name and still allow one particular edition of it.
 */
export function kidsAllowSays(lookup: KidsAllowLookup, kind: KidsAllowKind, id: string, name?: string): "allow" | "block" | null {
  const key = kidsAllowKey(kind, id);
  if (lookup.allow.has(key)) return "allow";
  if (lookup.block.has(key)) return "block";
  if (!name) return null;
  const named = kidsAllowName(name);
  if (!named) return null;
  if (lookup.allowNames.has(named)) return "allow";
  if (lookup.blockNames.has(named)) return "block";
  return null;
}

// ---------------------------------------------------------------------------
// The weekly summary: what a Kids profile watched this week, for a parent to look at.

/** One title in a day's list. */
export interface KidsViewingTitle {
  id: Id;
  kind: "movie" | "series" | "channel" | "recording";
  name: string;
}

/** One day of the summary. */
export interface KidsViewingDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  /** Minutes watched that day, from the Kids time records. */
  minutes: number;
  /** Everything started that day, in the order it was first played. */
  titles: KidsViewingTitle[];
}

/** A PIN guessed at (and refused) while a lockout was in force. */
export interface KidsLockout {
  /** When it happened. */
  at: number;
  /** Which profile's PIN was being guessed at. */
  profileId: Id;
  /** How long the lockout lasts, in whole minutes. */
  minutes: number;
}

/** A week (or the days it has) for one Kids profile. */
export interface KidsSummary {
  profileId: Id;
  profileName: string;
  /** Earliest day included, YYYY-MM-DD. */
  from: string;
  /** Latest day included, YYYY-MM-DD, which is today. */
  to: string;
  /** Oldest first, so the phone can read it down the page. */
  days: KidsViewingDay[];
  /** Every title in the window, in the order first played. */
  titles: KidsViewingTitle[];
  totalMinutes: number;
  lockouts: KidsLockout[];
  /** What the profile asked a parent for in the window, newest first (issue #224). */
  asks?: KidsAsk[];
}

/** How many days of viewing the summary covers. */
export const KIDS_SUMMARY_DAYS = 7;
/** How long the per-day records are kept, so the summary has history after a quiet week. */
export const KIDS_VIEWING_KEEP_DAYS = 35;
/** The most lockouts worth remembering. */
export const MAX_KIDS_LOCKOUTS = 200;

/** One Kids profile's lists, as the phone setup page and the TV read them. */
export interface KidsAllowProfile {
  profileId: Id;
  profileName: string;
  list: KidsAllowList;
}

/** What `GET /api/kids-allow` answers. A Kids profile sees no profiles at all. */
export interface KidsAllowReply {
  profiles: KidsAllowProfile[];
}

// ---------------------------------------------------------------------------
// Ask a parent (issue #224): a Kids or Guest profile asks for something it isn't allowed, and an
// adult answers from the TV or a phone.

/** What an adult can say: yes just for now, yes for good (Kids only), or no. */
export type KidsAskAnswer = "once" | "always" | "no";

/** One request. `status` is `pending` until the first adult answers; after that it is the answer. */
export interface KidsAsk {
  id: Id;
  /** The profile that asked. */
  profileId: Id;
  profileName: string;
  /** `kids` or `guest`, so a phone knows whether "Always allow" is on offer. */
  profileKind: "kids" | "guest";
  /** The title or channel asked for. */
  titleId: Id;
  kind: KidsAllowKind;
  name: string;
  at: number;
  status: "pending" | KidsAskAnswer;
  answeredAt?: number;
}

/** The most requests one profile may make in KIDS_ASK_WINDOW_MS. */
export const KIDS_ASK_LIMIT = 3;
export const KIDS_ASK_WINDOW_MS = 10 * 60_000;
/** How long "Allow once" lasts: an evening's viewing, not for good. */
export const KIDS_ASK_ONCE_MS = 6 * 3_600_000;
/** How long an unanswered request waits before it lapses. */
export const KIDS_ASK_PENDING_MS = 30 * 60_000;
