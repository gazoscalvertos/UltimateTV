// Sport tonight (issue #231): live and upcoming sport from the guide, favourite teams and sports
// per profile, and an automatic reminder (and optional recording) when one of them is on.
// See docs/sport-tonight.md.

import type { Channel, Programme } from "./domain.js";

/** Words that make a programme sport when its guide category says so. */
const SPORT_WORDS =
  /\b(sports?|football|soccer|rugby|cricket|tennis|golf|formula ?(?:1|one|2|e)|f1|moto ?gp|motorsport|racing|grand prix|boxing|ufc|mma|wrestling|darts|snooker|cycling|athletics|nfl|nba|nhl|basketball|baseball|olympics?|premier league|champions league|netball|hockey|swimming|gymnastics)\b/i;
/** Filler a sport channel puts between events: not sport. */
const FILLER = /^(close|off air|teleshopping|to be announced|tba|programmes? resume|trailers?)\b/i;

/** Whether a guide entry is sport: its categories say so, or it is on a sport channel. */
export function isSportProgramme(p: Pick<Programme, "title" | "categories">, channel?: Pick<Channel, "category" | "userCategory">): boolean {
  if (FILLER.test(p.title.trim())) return false;
  if (p.categories.some((c) => SPORT_WORDS.test(c))) return true;
  return (channel?.userCategory ?? channel?.category) === "sport";
}

const norm = (s: string): string =>
  ` ${s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** The favourite (a team or a sport, "Arsenal", "Formula 1") that a programme is about, if any. */
export function matchFavourite(p: Pick<Programme, "title" | "subtitle" | "description">, teams: readonly string[]): string | undefined {
  const hay = norm([p.title, p.subtitle, p.description].filter(Boolean).join(" . "));
  return teams.find((t) => {
    const n = norm(t);
    return n.trim().length > 1 && hay.includes(n);
  });
}

/**
 * Names worth offering as a favourite from a programme title: the two sides of "Arsenal v
 * Tottenham" (the competition before a colon is dropped), or the series of "Formula 1: Qualifying".
 */
export function teamsIn(title: string): string[] {
  const clean = (s: string) =>
    s
      .replace(/\((?:live|new|hd|repeat)\)/gi, "")
      .replace(/\s+[-–]\s+(?:live|highlights|replay).*$/i, "")
      .replace(/^\s*(?:live|new)\s*:\s*/i, "")
      .trim();
  const sides = title.split(/\s+(?:v|vs\.?|versus)\s+/i);
  if (sides.length === 2) {
    const left = clean(sides[0]!);
    const right = clean(sides[1]!);
    const out = [left.includes(":") ? left.slice(left.lastIndexOf(":") + 1).trim() : left, right.includes(":") ? right.slice(0, right.indexOf(":")).trim() : right];
    return out.filter((t) => t.length > 1 && t.length <= 40);
  }
  const head = clean(title);
  const colon = head.indexOf(":");
  const series = colon > 1 ? head.slice(0, colon).trim() : "";
  return series && series.length <= 40 ? [series] : [];
}

/** What a profile keeps for sport. */
export interface SportSettings {
  /** Teams or sports ("Arsenal", "Formula 1"): matched against titles and descriptions. */
  teams: string[];
  /** Set a reminder when a favourite is in the guide. */
  remind: boolean;
  /** Record it as well (not for a Kids profile). */
  record: boolean;
}

export const MAX_SPORT_TEAMS = 30;

export function cleanSportTeams(raw: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    if (typeof t !== "string") continue;
    const name = t.replace(/\s+/g, " ").trim().slice(0, 40);
    const key = norm(name);
    if (name.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, MAX_SPORT_TEAMS);
}

/** One sport programme, with where and when. */
export interface SportMatch {
  programme: Programme;
  channelName: string;
  channelLogo?: string;
  channelNumber?: number;
  /** On air now. */
  live: boolean;
  /** "Live now", "20:00", "Tomorrow 12:30". */
  when: string;
  /** The favourite this is about. */
  favourite?: string;
  /** A reminder is set for it. */
  reminder: boolean;
  /** A recording is scheduled or done. */
  recording: boolean;
  /** Sides or series to offer as favourites. */
  teams: string[];
}

export interface SportView extends SportSettings {
  /** Sport today, soonest first. */
  matches: SportMatch[];
  /** Favourites' coming games over the next week. */
  mine: SportMatch[];
  /** False for a Kids profile that isn't allowed the sport category. */
  available: boolean;
}
