// Where the family quiz's questions come from (issue #264).
//
// - The built-in bank (quizbank.ts): general knowledge, written for this app.
// - The household's own library: questions made from the films, series and music videos this
//   Hub already has, so the quiz is about the family's own telly and nothing copyrighted is
//   bundled. A film's description has its name blanked out, its poster is shown blurred, its cast
//   and year are asked about, and an extract round plays a few seconds of the file itself.
//
// Everything here is plain functions over plain data (the Hub's library is turned into
// LibTitle / LibSong by the caller), so it can be tested without a media server.

import type { PlaybackRequest, QuizClip, QuizRoundId } from "@ultimatetv/shared";
import { QUIZ_BANK } from "./quizbank.js";

export type Rand = () => number;

/** A film or series from the library, with what a question can use. */
export interface LibTitle {
  /** The id the TV plays it by. */
  req: PlaybackRequest;
  kind: "movie" | "series";
  name: string;
  year?: number;
  overview?: string;
  cast: string[];
  genres: string[];
  poster?: string;
  runtimeMs?: number;
}

/** A music video the Hub holds. */
export interface LibSong {
  artist: string;
  track: string;
  /** Where the TV plays it from, as a path on the Hub. */
  url: string;
  durationMs: number;
}

export interface QuizPool {
  titles: LibTitle[];
  songs: LibSong[];
}

/** A question ready to ask: four options, one right. */
export interface QuizDef {
  id: string;
  round: QuizRoundId;
  tier: 1 | 2 | 3;
  text: string;
  detail?: string;
  options: string[];
  correct: number;
  fact?: string;
  image?: string;
  blur?: boolean;
  clip?: QuizClip;
  /** What it is about (one film, one song), so a game doesn't ask about the same thing again and again. */
  group?: string;
}

export function shuffle<T>(list: T[], rand: Rand = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Puts the right answer among its three wrong ones, in a random place. */
export function withOptions(answer: string, wrong: string[], rand: Rand): { options: string[]; correct: number } {
  const options = shuffle([answer, ...wrong.slice(0, 3)], rand);
  return { options, correct: options.indexOf(answer) };
}

// ---------------------------------------------------------------------------
// The built-in bank

export function bankDefs(round: QuizRoundId, tiers: number[], rand: Rand): QuizDef[] {
  return QUIZ_BANK.filter((q) => q.round === round && tiers.includes(q.tier)).map((q, i) => ({
    id: `bank:${round}:${q.text}`.slice(0, 120) + `#${i}`,
    round,
    tier: q.tier,
    text: q.text,
    ...withOptions(q.answer, q.wrong, rand),
    ...(q.fact ? { fact: q.fact } : {}),
  }));
}

// ---------------------------------------------------------------------------
// The household's library

const KIDS_GENRE = /animation|family|children|kids/i;
const tierOf = (t: LibTitle, base: 1 | 2 | 3): 1 | 2 | 3 => (base > 1 && t.genres.some((g) => KIDS_GENRE.test(g)) ? ((base - 1) as 1 | 2) : base);

/** The description with the title taken out of it, or undefined when too little is left to be a fair clue. */
export function maskTitle(overview: string, name: string): string | undefined {
  let text = overview.replace(/\s+/g, " ").trim();
  if (text.length < 50) return undefined;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The whole title, then each longer word of it ("The Lion King" gives away "Lion" and "King" too).
  const words = name.split(/[\s:–-]+/).filter((w) => w.length >= 4 && !/^(the|and|with|from)$/i.test(w));
  for (const part of [name, ...words]) text = text.replace(new RegExp(`\\b${escape(part)}\\b`, "gi"), "…");
  // Keep it to a couple of sentences.
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > 260 && out) break;
    out += s;
  }
  out = out.trim();
  if (out.length > 300) out = `${out.slice(0, 297).trimEnd()}…`;
  return out.length >= 40 && (out.match(/…/g) ?? []).length <= 4 ? out : undefined;
}

function pickOthers<T>(from: T[], skip: (x: T) => boolean, n: number, rand: Rand): T[] {
  return shuffle(from.filter((x) => !skip(x)), rand).slice(0, n);
}

/** Distinct names to put beside the right one, never one that says the same as it. */
function otherNames(titles: LibTitle[], t: LibTitle, rand: Rand): string[] | undefined {
  const names = [...new Set(titles.filter((o) => o.kind === t.kind && o.name.toLowerCase() !== t.name.toLowerCase()).map((o) => o.name))];
  const picked = shuffle(names, rand).slice(0, 3);
  return picked.length === 3 ? picked : undefined;
}

const noun = (t: LibTitle) => (t.kind === "movie" ? "film" : "show");

/** Every question the household's films or series can make, each title asked about a few ways. */
export function titleDefs(titles: LibTitle[], kind: "movie" | "series", rand: Rand): QuizDef[] {
  const round: QuizRoundId = kind === "movie" ? "films" : "shows";
  const mine = titles.filter((t) => t.kind === kind);
  const out: QuizDef[] = [];
  for (const t of mine) {
    const others = otherNames(titles, t, rand);
    const key = `${round}:${t.req.id}`;
    if (others && t.poster) {
      out.push({ group: key, id: `${key}:poster`, round, tier: 1, text: `Which ${noun(t)} is this?`, detail: "The picture clears when the answer is out.", ...withOptions(t.name, others, rand), image: t.poster, blur: true });
    }
    const masked = t.overview ? maskTitle(t.overview, t.name) : undefined;
    if (others && masked) {
      out.push({ group: key, id: `${key}:story`, round, tier: tierOf(t, 2), text: `Which ${noun(t)} is this?`, detail: masked, ...withOptions(t.name, others, rand) });
    }
    // Who was in it: one of its cast, against actors from the others (never someone who was also in this one).
    if (t.cast.length >= 1) {
      const inThis = new Set(t.cast.map((c) => c.toLowerCase()));
      const strangers = [...new Set(mine.filter((o) => o !== t).flatMap((o) => o.cast))].filter((c) => !inThis.has(c.toLowerCase()));
      const wrong = shuffle(strangers, rand).slice(0, 3);
      if (wrong.length === 3) {
        const star = shuffle(t.cast.slice(0, 4), rand)[0]!;
        out.push({ group: key, id: `${key}:cast`, round, tier: tierOf(t, 2), text: `Who was in “${t.name}”?`, ...withOptions(star, wrong, rand), ...(t.poster ? { image: t.poster } : {}) });
      }
    }
    if (t.year) {
      const thisYear = new Date().getFullYear();
      const offsets = shuffle([-4, -3, -2, -1, 1, 2, 3, 4], rand)
        .map((o) => t.year! + o)
        .filter((y) => y <= thisYear && y > 1900)
        .slice(0, 3);
      if (offsets.length === 3) {
        out.push({
          group: key,
          id: `${key}:year`,
          round,
          tier: 3,
          text: kind === "movie" ? `Which year did “${t.name}” come out?` : `Which year did “${t.name}” start?`,
          ...withOptions(String(t.year), offsets.map(String), rand),
          ...(t.poster ? { image: t.poster } : {}),
        });
      }
    }
  }
  return out;
}

/** "Who sings this?" and "which of these is by …?", from the artists and songs on the music channels. */
export function songDefs(songs: LibSong[], rand: Rand): QuizDef[] {
  const artists = [...new Set(songs.map((s) => s.artist))];
  if (artists.length < 4) return [];
  const out: QuizDef[] = [];
  for (const s of songs) {
    const wrong = pickOthers(artists, (a) => a.toLowerCase() === s.artist.toLowerCase(), 3, rand);
    out.push({ group: `music:${s.url}`, id: `music:${s.url}:who`, round: "music", tier: 2, text: `Who sings “${s.track}”?`, ...withOptions(s.artist, wrong, rand) });
    const tracks = pickOthers(songs, (o) => o.artist.toLowerCase() === s.artist.toLowerCase() || o.track.toLowerCase() === s.track.toLowerCase(), 3, rand);
    if (tracks.length === 3) {
      out.push({ group: `music:${s.url}`, id: `music:${s.url}:song`, round: "music", tier: 2, text: `Which of these songs is by ${s.artist}?`, ...withOptions(s.track, tracks.map((o) => o.track), rand) });
    }
  }
  return out;
}

const CLIP_MS = 14_000;

/** A few seconds from inside a file, away from its opening titles and its end. */
export function clipWindow(durationMs: number, rand: Rand, length = CLIP_MS): { startMs: number; lengthMs: number } | undefined {
  if (durationMs < length * 3) return undefined;
  const from = durationMs * 0.15;
  const to = durationMs * 0.7 - length;
  return { startMs: Math.round(from + rand() * Math.max(to - from, 0)), lengthMs: length };
}

/** "Name that film" and "name that tune": the clip plays on the TV, then the question is asked. */
export function extractDefs(pool: QuizPool, round: "film-extracts" | "music-extracts", rand: Rand): QuizDef[] {
  const out: QuizDef[] = [];
  if (round === "film-extracts") {
    const films = pool.titles.filter((t) => t.kind === "movie");
    for (const t of films) {
      const window = t.runtimeMs ? clipWindow(t.runtimeMs, rand) : undefined;
      const others = otherNames(pool.titles, t, rand);
      if (!window || !others) continue;
      out.push({
        group: `films:${t.req.id}`,
        id: `film-extracts:${t.req.id}`,
        round,
        tier: tierOf(t, 2),
        text: "Which film is this extract from?",
        ...withOptions(t.name, others, rand),
        clip: { kind: "film", req: t.req, ...window },
      });
    }
    return out;
  }
  const artists = [...new Set(pool.songs.map((s) => s.artist))];
  if (artists.length < 4) return out;
  for (const s of pool.songs) {
    const window = clipWindow(s.durationMs, rand, 12_000);
    if (!window) continue;
    out.push({
      group: `music:${s.url}`,
      id: `music-extracts:${s.url}`,
      round,
      tier: 2,
      text: "Who is the artist?",
      ...withOptions(s.artist, pickOthers(artists, (a) => a.toLowerCase() === s.artist.toLowerCase(), 3, rand), rand),
      fact: `${s.artist}: “${s.track}”`,
      clip: { kind: "music", url: s.url, ...window },
    });
  }
  return out;
}

/** Every question a round could ask, before the game picks from them. */
export function roundDefs(round: QuizRoundId, tiers: number[], pool: QuizPool, rand: Rand): QuizDef[] {
  let all: QuizDef[];
  switch (round) {
    case "films":
      all = titleDefs(pool.titles, "movie", rand);
      break;
    case "shows":
      all = titleDefs(pool.titles, "series", rand);
      break;
    case "music":
      all = songDefs(pool.songs, rand);
      break;
    case "film-extracts":
    case "music-extracts":
      all = extractDefs(pool, round, rand);
      break;
    default:
      return bankDefs(round, tiers, rand);
  }
  return all.filter((q) => tiers.includes(q.tier));
}

/** How many questions each library round could ask at any difficulty: what the lobby offers. */
export function availability(pool: QuizPool, rand: Rand): Partial<Record<QuizRoundId, number>> {
  const all = [1, 2, 3];
  const out: Partial<Record<QuizRoundId, number>> = {};
  for (const round of ["films", "shows", "music", "film-extracts", "music-extracts"] as const) {
    const n = roundDefs(round, all, pool, rand).length;
    if (n) out[round] = n;
  }
  return out;
}

/**
 * Chooses a game's questions: the rounds take it in turns, each handing over a question at a time
 * from its own shuffled pile, so a four-round game isn't one round after another. Questions
 * that are the same (the same answer to the same words) are never asked twice.
 */
export function pickQuestions(rounds: QuizRoundId[], tiers: number[], count: number, pool: QuizPool, rand: Rand): QuizDef[] {
  const piles = rounds.map((r) => shuffle(roundDefs(r, tiers, pool, rand), rand)).filter((p) => p.length);
  const out: QuizDef[] = [];
  const seen = new Set<string>();
  // The same film or song comes up at most twice in a game.
  const perGroup = new Map<string, number>();
  while (out.length < count && piles.some((p) => p.length)) {
    for (const pile of piles) {
      if (out.length >= count) break;
      const q = pile.pop();
      if (!q) continue;
      const same = `${q.text}|${q.detail ?? ""}|${q.options[q.correct]}`;
      const used = q.group ? (perGroup.get(q.group) ?? 0) : 0;
      if (seen.has(same) || used >= 2) continue;
      seen.add(same);
      if (q.group) perGroup.set(q.group, used + 1);
      out.push(q);
    }
  }
  return out;
}
