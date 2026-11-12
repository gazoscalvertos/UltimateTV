// The family quiz (issue #264): what a game is made of, what the TV and the phones are shown, and
// the few rules both ends need to agree on (which key is which answer, how a score is worked out).
//
// The Hub runs the game (hub/src/quiz.ts) and everything here is just the shape of what it
// says. A question's right answer is only ever in a view once the question is over, so a phone can't
// peek at it.

import type { Action } from "./keys.js";
import type { PlaybackRequest } from "./domain.js";

/** The four answers, in order: the first option is red, the second green, the third yellow, the fourth blue. */
export type QuizColour = "red" | "green" | "yellow" | "blue";
export const QUIZ_COLOURS: readonly QuizColour[] = ["red", "green", "yellow", "blue"];
/** A shape for each colour, so the answers still tell apart for anyone who can't tell the colours. */
export const QUIZ_SHAPES: readonly string[] = ["▲", "●", "■", "◆"];
export const QUIZ_LETTERS: readonly string[] = ["A", "B", "C", "D"];

/**
 * The answer a key gives: the colour keys, and 1–4 for a TV that keeps its colour keys to itself.
 * Anything else is not an answer.
 */
export function quizChoiceForAction(action: Action | string): number | undefined {
  switch (action) {
    case "red":
    case "digit1":
      return 0;
    case "green":
    case "digit2":
      return 1;
    case "yellow":
    case "digit3":
      return 2;
    case "blue":
    case "digit4":
      return 3;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Rounds

/**
 * What a question is about. "bank" rounds come from the built-in questions, "library" rounds are
 * made from the household's own films, shows and music videos, and "extract" rounds play a few
 * seconds of one of them and ask what it was.
 */
export type QuizRoundId =
  | "general"
  | "science"
  | "geography"
  | "animals"
  | "history"
  | "food"
  | "sport"
  | "entertainment"
  | "films"
  | "shows"
  | "music"
  | "film-extracts"
  | "music-extracts";

export interface QuizRoundInfo {
  id: QuizRoundId;
  label: string;
  detail: string;
  source: "bank" | "library" | "extract";
}

export const QUIZ_ROUNDS: readonly QuizRoundInfo[] = [
  { id: "general", label: "General knowledge", detail: "A bit of everything", source: "bank" },
  { id: "science", label: "Science and nature", detail: "Space, the body, how things work", source: "bank" },
  { id: "geography", label: "Around the world", detail: "Countries, capitals and landmarks", source: "bank" },
  { id: "animals", label: "Animals", detail: "From pets to the wild", source: "bank" },
  { id: "history", label: "History", detail: "People and events", source: "bank" },
  { id: "food", label: "Food and drink", detail: "What's on the plate", source: "bank" },
  { id: "sport", label: "Sport", detail: "Games, teams and records", source: "bank" },
  { id: "entertainment", label: "Films, TV and music", detail: "Famous faces and favourite shows", source: "bank" },
  { id: "films", label: "Your films", detail: "Made from the films in your library", source: "library" },
  { id: "shows", label: "Your TV shows", detail: "Made from the series in your library", source: "library" },
  { id: "music", label: "Your music", detail: "Made from the music channels' videos", source: "library" },
  { id: "film-extracts", label: "Film extracts", detail: "A few seconds of one of your films: name it", source: "extract" },
  { id: "music-extracts", label: "Name that tune", detail: "A few seconds of a music video: who is it?", source: "extract" },
];

export const QUIZ_ROUND_IDS: readonly QuizRoundId[] = QUIZ_ROUNDS.map((r) => r.id);

export const isQuizRound = (v: unknown): v is QuizRoundId => typeof v === "string" && (QUIZ_ROUND_IDS as readonly string[]).includes(v);

export const quizRoundLabel = (id: QuizRoundId): string => QUIZ_ROUNDS.find((r) => r.id === id)?.label ?? id;

// ---------------------------------------------------------------------------
// Settings

/** "turns": one remote, each question is for whoever's turn it is. "together": everyone answers on their own phone. */
export type QuizStyle = "turns" | "together";
/** Easy is for little ones, family for everyone, tricky for the grown-ups. */
export type QuizDifficulty = "easy" | "family" | "tricky";

export interface QuizSettings {
  style: QuizStyle;
  rounds: QuizRoundId[];
  /** How many questions in the game. */
  questions: number;
  /** Seconds to answer; 0 for as long as it takes. */
  seconds: number;
  difficulty: QuizDifficulty;
}

export const QUIZ_QUESTION_COUNTS = [8, 12, 20, 30] as const;
export const QUIZ_SECONDS = [0, 15, 20, 30] as const;
export const QUIZ_DIFFICULTIES: readonly QuizDifficulty[] = ["easy", "family", "tricky"];
export const QUIZ_MAX_PLAYERS = 8;
/** After an answer is shown the game moves on by itself after this long, so a game with only phones needs no remote. */
export const QUIZ_REVEAL_MS = 9_000;

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  style: "turns",
  rounds: ["general", "science", "geography", "animals", "entertainment"],
  questions: 12,
  seconds: 20,
  difficulty: "family",
};

/** Settings from anywhere: anything unknown falls back to the default, and Kids never gets the tricky questions. */
export function cleanQuizSettings(raw: unknown, base: QuizSettings = DEFAULT_QUIZ_SETTINGS, kids = false): QuizSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rounds = Array.isArray(r.rounds) ? QUIZ_ROUND_IDS.filter((id) => (r.rounds as unknown[]).includes(id)) : base.rounds;
  const count = typeof r.questions === "number" ? Math.round(r.questions) : base.questions;
  const seconds = typeof r.seconds === "number" ? Math.round(r.seconds) : base.seconds;
  let difficulty: QuizDifficulty = QUIZ_DIFFICULTIES.includes(r.difficulty as QuizDifficulty) ? (r.difficulty as QuizDifficulty) : base.difficulty;
  if (kids && difficulty === "tricky") difficulty = "family";
  return {
    style: r.style === "together" || r.style === "turns" ? r.style : base.style,
    rounds: rounds.length ? rounds : base.rounds,
    questions: Math.min(Math.max(count, 3), 40),
    seconds: seconds <= 0 ? 0 : Math.min(Math.max(seconds, 8), 90),
    difficulty,
  };
}

/** The tiers of question a difficulty draws from (1 easy, 2 medium, 3 hard). */
export function quizTiers(difficulty: QuizDifficulty): (1 | 2 | 3)[] {
  return difficulty === "easy" ? [1] : difficulty === "family" ? [1, 2] : [2, 3];
}

// ---------------------------------------------------------------------------
// Scoring

export const QUIZ_POINTS = 100;
/** Most extra points for the fastest answer when everyone answers at once. */
export const QUIZ_SPEED_BONUS = 50;

/**
 * Points for an answer: nothing for a wrong one or none, 100 for a right one, and when everyone is
 * answering together up to 50 more for being quick. `left` is the fraction of the time still on
 * the clock (1 for an instant answer); with no time limit there is no bonus.
 */
export function quizPoints(right: boolean, style: QuizStyle, left: number, timed: boolean): number {
  if (!right) return 0;
  if (style !== "together" || !timed) return QUIZ_POINTS;
  return QUIZ_POINTS + Math.round(QUIZ_SPEED_BONUS * Math.min(Math.max(left, 0), 1));
}

// ---------------------------------------------------------------------------
// What is shown

export type QuizPhase = "lobby" | "loading" | "question" | "reveal" | "final";

export interface QuizPlayer {
  id: string;
  name: string;
  /** "remote" plays with the TV remote's colour keys, "phone" on their own phone. */
  via: "remote" | "phone";
  score: number;
  /** Questions answered right. */
  right: number;
  /** Whether they have answered the question on screen. */
  answered: boolean;
}

/** A few seconds of a film or a music video to play before the question is asked. */
export interface QuizClip {
  kind: "film" | "music";
  /** A film or show in the library: asked of the Hub like any other playback. */
  req?: PlaybackRequest;
  /** A music video the Hub holds, as a path on the Hub (the TV adds the Hub's address). */
  url?: string;
  startMs: number;
  lengthMs: number;
}

export interface QuizQuestionView {
  id: string;
  round: QuizRoundId;
  roundLabel: string;
  text: string;
  options: string[];
  /** A longer piece of the question under its heading, such as a film's description with its name taken out. */
  detail?: string;
  /** A poster or still (from the library). */
  image?: string;
  /** Show the picture blurred until the answer is out, so a poster is a clue and not a gift. */
  blur?: boolean;
  /** A clip is playing first: the answers are shut until the TV says it's done. */
  watching?: boolean;
  /** Number of this question in the game, from 1. */
  number: number;
  of: number;
  /** The player it is for, when taking turns. */
  turn?: string;
  /** The clock: when the answers close (epoch ms), null for no limit. Starts when any clip has played. */
  endsAt: number | null;
  seconds: number;
  /** Only the TV gets this: a clip to play before the answers open. */
  clip?: QuizClip;
}

export interface QuizAnswerResult {
  playerId: string;
  /** The option picked, null for none in time. */
  choice: number | null;
  right: boolean;
  gained: number;
}

export interface QuizReveal {
  /** The right option. */
  correct: number;
  /** A fact that goes with the answer. */
  fact?: string;
  /** When the next question follows by itself (the Hub's clock). */
  nextAt: number;
  results: QuizAnswerResult[];
}

export interface QuizView {
  /** Changes whenever anything does, so a phone polling can ask only for what's new. */
  rev: number;
  /** The Hub's clock, so a phone with the wrong time still counts down right. */
  now: number;
  /** The short code a phone types, or that the QR code carries. */
  code: string;
  phase: QuizPhase;
  settings: QuizSettings;
  players: QuizPlayer[];
  /** What the lobby may offer: which rounds the household's own library can make, and how many questions each has. */
  available: Partial<Record<QuizRoundId, number>>;
  question?: QuizQuestionView;
  reveal?: QuizReveal;
  /** The last thing that went wrong (the library had too few titles, say). */
  notice?: string;
  /** Whose turn it is, when taking turns. */
  turn?: string;
  /** What the household calls the app, for the phone page's heading. */
  appName?: string;
  /** True on the Kids profile: tricky questions and unsuitable titles are never used. */
  kids: boolean;
  /** For a phone's own view: which player it is. */
  you?: string;
  /** For a phone's own view: what it answered, if it has. */
  yourChoice?: number | null;
}

/** What a phone gets when it asks: no clip. */
export function quizViewForPhone(view: QuizView, you: string): QuizView {
  const { question, ...rest } = view;
  const mine = view.reveal?.results.find((r) => r.playerId === you)?.choice;
  const out: QuizView = { ...rest, you };
  if (mine !== undefined) out.yourChoice = mine;
  if (question) {
    const { clip: _clip, ...plain } = question;
    out.question = plain;
  }
  return out;
}

/** A player's name as typed: trimmed, one line, at most 16 characters. */
export function cleanPlayerName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 16) : "";
}

/** The code on the TV: four letters that can't be mistaken for each other. */
export const QUIZ_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function cleanQuizCode(raw: unknown): string {
  return typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) : "";
}

/** What the TV and the phone remote get from the Hub: the game (null when there is none) and the address a phone joins at. */
export interface QuizState {
  view: QuizView | null;
  url?: string;
}
