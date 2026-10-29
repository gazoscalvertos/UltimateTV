// Seasonal clips: friendly things that drift across the TV for a holiday (a sleigh over the top of
// the picture at Christmas, a bunny hopping along the bottom at Easter, fireworks at New Year),
// the gentle cousin of the jump scares. Clips come from the household's own uploads, from the
// community library (an index of clips anyone can add to), or are drawn by the TV itself.

export type SeasonId = "christmas" | "newyear" | "valentines" | "easter" | "halloween" | "bonfire" | "birthday";

export interface Holiday {
  id: SeasonId;
  name: string;
  /** What the TV draws by itself when no clips are uploaded for the season. */
  drawn: DrawnProjection[];
}

export const SEASONS: readonly Holiday[] = [
  { id: "christmas", name: "Christmas", drawn: ["sleigh", "snow", "presents"] },
  { id: "newyear", name: "New Year", drawn: ["fireworks"] },
  { id: "valentines", name: "Valentine's Day", drawn: ["hearts"] },
  { id: "easter", name: "Easter", drawn: ["bunny", "eggs"] },
  { id: "halloween", name: "Halloween", drawn: ["ghost", "bats"] },
  { id: "bonfire", name: "Bonfire Night", drawn: ["fireworks", "rocket"] },
  { id: "birthday", name: "Birthday", drawn: ["balloons", "confetti"] },
];

export const SEASON_IDS: readonly SeasonId[] = SEASONS.map((s) => s.id);

/** Clips the TV draws itself, so every season works with nothing uploaded. */
export type DrawnProjection = "sleigh" | "snow" | "presents" | "fireworks" | "rocket" | "hearts" | "bunny" | "eggs" | "ghost" | "bats" | "balloons" | "confetti";
export const DRAWN_PROJECTIONS: readonly DrawnProjection[] = ["sleigh", "snow", "presents", "fireworks", "rocket", "hearts", "bunny", "eggs", "ghost", "bats", "balloons", "confetti"];

/** How an uploaded clip moves: across the top, down from the top, up from the bottom, along the bottom, or still in a corner. */
export type ProjectionMotion = "across-top" | "across-bottom" | "fall" | "rise" | "corner";
export const PROJECTION_MOTIONS: readonly ProjectionMotion[] = ["across-top", "across-bottom", "fall", "rise", "corner"];

/** Easter Sunday in the Gregorian calendar (the anonymous algorithm), as [month 1–12, day]. */
export function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const dayOfYear = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000);

/**
 * The season a date falls in, by the household's local calendar, or null. Christmas is the 1st to
 * Boxing Day; New Year is New Year's Eve and Day; Easter runs from Palm Sunday to Easter Monday;
 * Halloween is its week (as the Halloween theme is); Bonfire Night is the 4th to the 6th of November.
 * Birthdays are only ever chosen by hand.
 */
export function seasonOn(date: Date): SeasonId | null {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 12 && d >= 1 && d <= 26) return "christmas";
  if ((m === 12 && d === 31) || (m === 1 && d === 1)) return "newyear";
  if (m === 2 && (d === 13 || d === 14)) return "valentines";
  if ((m === 10 && d >= 24) || (m === 11 && d === 1)) return "halloween";
  if (m === 11 && d >= 4 && d <= 6) return "bonfire";
  const [em, ed] = easterSunday(y);
  const today = dayOfYear(y, m, d);
  const easter = dayOfYear(y, em, ed);
  if (today >= easter - 7 && today <= easter + 1) return "easter";
  return null;
}

export interface ProjectionSettings {
  /** Seasonal clips now and then while the season lasts. */
  enabled: boolean;
  /** "auto" follows the calendar; a season id keeps that one on whatever the date (a birthday party). */
  season: "auto" | SeasonId;
  minGapMinutes: number;
  chancePercent: number;
  /** How long one stays on screen. */
  seconds: number;
  /** How loud a clip's sound is, 0 to 1 (drawn ones are silent). */
  volume: number;
  /** On the Kids profile too: they're friendly, so on by default. */
  kids: boolean;
  /** Only while something plays; off lets them drift over the menus too. */
  whilePlayingOnly: boolean;
  duringLive: boolean;
  /** Mix in the TV's own drawn ones as well as the uploaded clips. */
  drawn: boolean;
}

export const DEFAULT_PROJECTION_SETTINGS: ProjectionSettings = {
  enabled: true,
  season: "auto",
  minGapMinutes: 45,
  chancePercent: 20,
  seconds: 10,
  volume: 0.4,
  kids: true,
  whilePlayingOnly: false,
  duringLive: true,
  drawn: true,
};

export function cleanProjectionSettings(patch: Partial<ProjectionSettings>, base: ProjectionSettings = DEFAULT_PROJECTION_SETTINGS): ProjectionSettings {
  const num = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value);
    return value !== undefined && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const bool = (value: unknown, fallback: boolean) => (value === undefined ? fallback : Boolean(value));
  return {
    enabled: bool(patch.enabled, base.enabled),
    season: patch.season === "auto" || SEASON_IDS.includes(patch.season as SeasonId) ? (patch.season as ProjectionSettings["season"]) : base.season,
    minGapMinutes: num(patch.minGapMinutes, 1, 24 * 60, base.minGapMinutes),
    chancePercent: num(patch.chancePercent, 1, 100, base.chancePercent),
    seconds: num(patch.seconds, 3, 60, base.seconds),
    volume: num(patch.volume, 0, 1, base.volume),
    kids: bool(patch.kids, base.kids),
    whilePlayingOnly: bool(patch.whilePlayingOnly, base.whilePlayingOnly),
    duringLive: bool(patch.duringLive, base.duringLive),
    drawn: bool(patch.drawn, base.drawn),
  };
}

/** The season in force: the one picked by hand, else the calendar's. */
export function activeSeason(settings: Pick<ProjectionSettings, "season">, date: Date): SeasonId | null {
  return settings.season === "auto" ? seasonOn(date) : settings.season;
}

/** A clip used for seasonal projections, as the phone and TV see it (kept with the jump scare clips). */
export interface ProjectionClip {
  id: string;
  name: string;
  kind: "video" | "image" | "audio";
  url: string;
  season: SeasonId | "any";
  motion: ProjectionMotion;
  /** Downloaded from the community library (its id there). */
  communityId?: string;
}

/** One projection on its way to the TV: an uploaded clip, or one the TV draws. */
export interface Projection {
  id: string;
  season: SeasonId | null;
  drawn?: DrawnProjection;
  clip?: Pick<ProjectionClip, "id" | "name" | "kind" | "url" | "motion">;
  seconds: number;
  volume: number;
  byHand: boolean;
}

export interface ProjectionState {
  settings: ProjectionSettings;
  /** The season in force now (by the Hub's clock), or null. */
  season: SeasonId | null;
  clips: ProjectionClip[];
}

/**
 * Picks a projection for the season: one of its uploaded clips (or one for any season), or one of
 * the drawn ones. A clip or drawn one asked for by name wins. Undefined when there's nothing to show.
 */
export function projectionFrom(
  state: ProjectionState,
  want: { clipId?: string; drawn?: DrawnProjection; season?: SeasonId },
  byHand: boolean,
  rand: () => number = Math.random,
): Projection | undefined {
  const { settings } = state;
  const season = want.season ?? state.season;
  const id = `${Date.now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
  const base = { id, season, seconds: settings.seconds, volume: settings.volume, byHand };
  const asClip = (c: ProjectionClip): Projection => ({ ...base, clip: { id: c.id, name: c.name, kind: c.kind, url: c.url, motion: c.motion } });
  if (want.clipId) {
    const c = state.clips.find((x) => x.id === want.clipId && x.kind !== "audio");
    return c ? asClip(c) : undefined;
  }
  if (want.drawn) return DRAWN_PROJECTIONS.includes(want.drawn) ? { ...base, drawn: want.drawn } : undefined;
  if (!season) return undefined;
  const clips = state.clips.filter((c) => c.kind !== "audio" && (c.season === season || c.season === "any"));
  const drawn = settings.drawn || !clips.length ? (SEASONS.find((s) => s.id === season)?.drawn ?? []) : [];
  const pool: (() => Projection)[] = [...clips.map((c) => () => asClip(c)), ...drawn.map((d) => () => ({ ...base, drawn: d }))];
  return pool.length ? pool[Math.floor(rand() * pool.length)]!() : undefined;
}

// ---------------------------------------------------------------------------
// The community library: an index of clips (JSON, by default in this project's GitHub repository)
// that any household can download from, and add to with a pull request.

export interface CommunityClip {
  id: string;
  name: string;
  /** "projection" drifts across for a season; "scare" is a jump scare. */
  use: "projection" | "scare";
  season: SeasonId | "any";
  motion?: ProjectionMotion;
  /** Where to fetch it from: absolute, or relative to the index. */
  url: string;
  type: string;
  sizeBytes?: number;
  author?: string;
  licence?: string;
  /** Already on this Hub. */
  downloaded?: boolean;
}

export interface CommunityIndex {
  /** Where the index came from. */
  source: string;
  clips: CommunityClip[];
  /** Why it couldn't be read, when it couldn't. */
  error?: string;
}

/** Reads a community index file, dropping anything malformed. `base` resolves relative clip addresses. */
export function parseCommunityIndex(json: unknown, base: string): CommunityClip[] {
  const list = (json as { clips?: unknown })?.clips;
  if (!Array.isArray(list)) return [];
  const out: CommunityClip[] = [];
  for (const raw of list.slice(0, 500)) {
    const c = raw as Record<string, unknown>;
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const id = text(c.id, 64);
    const name = text(c.name, 60);
    const file = text(c.url ?? c.file, 1000);
    const type = text(c.type, 40).toLowerCase();
    if (!/^[\w-]+$/.test(id) || !name || !file || !/^(image|video|audio)\//.test(type)) continue;
    let url: string;
    try {
      url = new URL(file, base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(url)) continue;
    const season = SEASON_IDS.includes(c.season as SeasonId) ? (c.season as SeasonId) : "any";
    const clip: CommunityClip = { id, name, use: c.use === "scare" ? "scare" : "projection", season, url, type };
    if (PROJECTION_MOTIONS.includes(c.motion as ProjectionMotion)) clip.motion = c.motion as ProjectionMotion;
    if (typeof c.sizeBytes === "number" && c.sizeBytes > 0) clip.sizeBytes = c.sizeBytes;
    const author = text(c.author, 60);
    if (author) clip.author = author;
    const licence = text(c.licence ?? c.license, 40);
    if (licence) clip.licence = licence;
    out.push(clip);
  }
  return out;
}
