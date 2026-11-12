// The family quiz (issue #264): one game at a time on the TV, played with the remote's colour keys,
// on phones, or both.
//
// The Hub runs the game, not the TV, so the TV and every phone see the same thing and answers
// from either end land in the same place. The TV hears about every change as a `quiz.state` event;
// a phone asks for the view about once a second. The questions come from quizsources.ts.
//
// Two ways to play (QuizStyle):
//   turns     each question is for whoever's turn it is, who answers with the remote's colour keys
//             (or on their own phone). Everyone else watches, and the next question is the next
//             person's.
//   together  everyone answers at once on their own phone, quickest right answer scores most. One
//             person may also play with the remote: its colour keys answer for them.
//
// A game's right answer is never in a view until the question is over. Nothing is saved: a game
// is for an evening, and a Hub restart ends it.

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { QuizPhase, QuizPlayer, QuizReveal, QuizSettings, QuizView } from "@ultimatetv/shared";
import { cleanPlayerName, cleanQuizCode, cleanQuizSettings, DEFAULT_QUIZ_SETTINGS, QUIZ_CODE_LETTERS, QUIZ_MAX_PLAYERS, QUIZ_REVEAL_MS, quizPoints, quizRoundLabel, quizTiers, quizViewForPhone } from "@ultimatetv/shared";
import type { EventBus } from "./events.js";
import type { Logger } from "./log.js";
import type { ContentFilter } from "./profiles.js";
import { availability, pickQuestions, type QuizDef, type QuizPool, type Rand } from "./quizsources.js";

export class QuizError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface QuizDeps {
  events: EventBus;
  /** The household's films, shows and music videos, as the profile asking may see them. */
  pool: (filter: ContentFilter) => Promise<QuizPool>;
  log: Logger;
  /** What the household calls the app. */
  appName?: () => string;
  rand?: Rand;
  now?: () => number;
}

interface PlayerRec {
  id: string;
  name: string;
  via: "remote" | "phone";
  score: number;
  right: number;
  secret: string;
}

interface Asking {
  def: QuizDef;
  number: number;
  turn?: string;
  startedAt: number;
  /** When the answers close; null for no limit, or while a clip is still playing. */
  endsAt: number | null;
  watching: boolean;
  answers: Map<string, { choice: number; at: number }>;
}

interface Session {
  code: string;
  phase: QuizPhase;
  settings: QuizSettings;
  players: PlayerRec[];
  kids: boolean;
  filter: ContentFilter;
  questions: QuizDef[];
  index: number;
  asking: Asking | null;
  reveal: QuizReveal | null;
  notice?: string;
  rev: number;
  available: QuizView["available"];
  touched: number;
}

/** A game left alone this long is forgotten. */
const IDLE_MS = 6 * 3_600_000;
/** A clip the TV never reports finishing opens its question this long after it should have ended. */
const CLIP_GRACE_MS = 20_000;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class Quiz {
  private session: Session | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly rand: Rand;
  private readonly now: () => number;
  private nextId = 1;
  private poolCache: { at: number; key: string; pool: QuizPool } | null = null;

  constructor(private deps: QuizDeps) {
    this.rand = deps.rand ?? Math.random;
    this.now = deps.now ?? Date.now;
  }

  // -------------------------------------------------------------------------
  // The game as it is

  private live(): Session | null {
    const s = this.session;
    if (s && this.now() - s.touched > IDLE_MS) {
      this.clearTimer();
      this.session = null;
      return null;
    }
    return s;
  }

  private change(s: Session): void {
    s.rev++;
    s.touched = this.now();
    this.deps.events.emit({ type: "quiz.state", view: this.view() });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private later(ms: number, fn: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(fn, Math.max(ms, 0));
    this.timer.unref?.();
  }

  /** What the TV (and the phone remote) is shown; null when there is no game. */
  view(): QuizView | null {
    const s = this.live();
    if (!s) return null;
    const a = s.asking;
    const players: QuizPlayer[] = s.players.map((p) => ({ id: p.id, name: p.name, via: p.via, score: p.score, right: p.right, answered: Boolean(a?.answers.has(p.id)) }));
    const view: QuizView = { rev: s.rev, now: this.now(), code: s.code, phase: s.phase, settings: s.settings, players, available: s.available, kids: s.kids };
    const appName = this.deps.appName?.();
    if (appName) view.appName = appName;
    if (s.notice) view.notice = s.notice;
    if (a && (s.phase === "question" || s.phase === "reveal")) {
      const d = a.def;
      view.question = {
        id: d.id,
        round: d.round,
        roundLabel: quizRoundLabel(d.round),
        text: d.text,
        options: d.options,
        number: a.number,
        of: s.questions.length,
        endsAt: a.endsAt,
        seconds: s.settings.seconds,
        ...(d.detail ? { detail: d.detail } : {}),
        ...(d.image ? { image: d.image } : {}),
        ...(d.blur ? { blur: true } : {}),
        ...(a.watching ? { watching: true } : {}),
        ...(a.turn ? { turn: a.turn } : {}),
        ...(d.clip && a.watching ? { clip: d.clip } : {}),
      };
      if (a.turn) view.turn = a.turn;
    }
    // The right answer is only told once the question is over.
    if (s.phase === "reveal" && s.reveal) view.reveal = s.reveal;
    return view;
  }

  /** What one phone is shown. */
  phoneView(code: string, id: string, secret: string, since?: number): QuizView | { unchanged: true; rev: number; now: number } {
    const { s } = this.phone(code, id, secret);
    if (since !== undefined && since === s.rev) return { unchanged: true, rev: s.rev, now: this.now() };
    return quizViewForPhone(this.view()!, id);
  }

  // -------------------------------------------------------------------------
  // Setting up

  /** The game on the TV, starting a lobby when there isn't one. */
  async open(filter: ContentFilter): Promise<QuizView> {
    let s = this.live();
    if (!s) {
      const kids = filter.limited;
      const pool = await this.pool(filter);
      s = {
        code: this.newCode(),
        phase: "lobby",
        settings: cleanQuizSettings({}, DEFAULT_QUIZ_SETTINGS, kids),
        players: [],
        kids,
        filter,
        questions: [],
        index: -1,
        asking: null,
        reveal: null,
        rev: 0,
        available: availability(pool, this.rand),
        touched: this.now(),
      };
      this.session = s;
      this.change(s);
    }
    return this.view()!;
  }

  private async pool(filter: ContentFilter): Promise<QuizPool> {
    const key = filter.profile?.id ?? "";
    const c = this.poolCache;
    if (c && c.key === key && this.now() - c.at < 10 * 60_000) return c.pool;
    const pool = await this.deps.pool(filter).catch((err) => {
      this.deps.log.warn({ err: String(err) }, "The quiz couldn't read the library");
      return { titles: [], songs: [] } as QuizPool;
    });
    this.poolCache = { at: this.now(), key, pool };
    return pool;
  }

  private newCode(): string {
    let code = "";
    const bytes = randomBytes(4);
    for (const b of bytes) code += QUIZ_CODE_LETTERS[b % QUIZ_CODE_LETTERS.length];
    return code;
  }

  private need(): Session {
    const s = this.live();
    if (!s) throw new QuizError("There's no quiz on. Start one on the TV.", 404);
    return s;
  }

  configure(patch: unknown): QuizView {
    const s = this.need();
    if (s.phase !== "lobby") throw new QuizError("The settings can only change before the game starts");
    s.settings = cleanQuizSettings({ ...s.settings, ...(patch && typeof patch === "object" ? patch : {}) }, s.settings, s.kids);
    // Together, one person at most can use the remote.
    if (s.settings.style === "together") {
      const remotes = s.players.filter((p) => p.via === "remote");
      for (const extra of remotes.slice(1)) s.players = s.players.filter((p) => p.id !== extra.id);
    }
    delete s.notice;
    this.change(s);
    return this.view()!;
  }

  /** Adds someone: from the TV (who then play with the remote), or a phone that has joined. */
  addPlayer(name: unknown, via: "remote" | "phone"): { player: QuizPlayer; secret: string } {
    const s = this.need();
    if (s.phase === "final") throw new QuizError("The game has finished. Play again to join in.", 409);
    const clean = cleanPlayerName(name);
    if (!clean) throw new QuizError("Type a name first");
    if (s.players.length >= QUIZ_MAX_PLAYERS) throw new QuizError(`That's the most players (${QUIZ_MAX_PLAYERS})`, 409);
    if (via === "remote" && s.settings.style === "together" && s.players.some((p) => p.via === "remote")) {
      throw new QuizError("Only one person can use the remote when everyone answers together. The rest can join on their phones.", 409);
    }
    let unique = clean;
    for (let n = 2; s.players.some((p) => p.name.toLowerCase() === unique.toLowerCase()); n++) unique = `${clean.slice(0, 14)} ${n}`;
    const rec: PlayerRec = { id: `p${this.nextId++}`, name: unique, via, score: 0, right: 0, secret: randomBytes(12).toString("hex") };
    s.players.push(rec);
    delete s.notice;
    this.change(s);
    return { player: { id: rec.id, name: rec.name, via, score: 0, right: 0, answered: false }, secret: rec.secret };
  }

  removePlayer(id: string): QuizView {
    const s = this.need();
    if (!s.players.some((p) => p.id === id)) return this.view()!;
    s.players = s.players.filter((p) => p.id !== id);
    s.asking?.answers.delete(id);
    if (s.phase === "question" && s.asking && !s.asking.watching) {
      // Whose turn it was has left, or the rest have all answered.
      if (s.asking.turn === id || !s.players.length || this.allIn(s)) {
        if (s.players.length) this.reveal(s);
        else this.finish(s);
        return this.view()!;
      }
    }
    this.change(s);
    return this.view()!;
  }

  // -------------------------------------------------------------------------
  // Playing

  async start(): Promise<QuizView | null> {
    const s = this.need();
    if (s.phase !== "lobby" && s.phase !== "final") throw new QuizError("The game is already on", 409);
    if (!s.players.length) throw new QuizError("Add at least one player first");
    s.phase = "loading";
    delete s.notice;
    this.change(s);
    const pool = await this.pool(s.filter);
    // The game may have been ended while the library was being read.
    if (this.session !== s || s.phase !== "loading") return this.view();
    const picked = pickQuestions(s.settings.rounds, quizTiers(s.settings.difficulty), s.settings.questions, pool, this.rand);
    if (picked.length < 3) {
      s.phase = "lobby";
      s.notice = "Those rounds don't have enough questions at this difficulty. Add another round, or make it a little harder or easier.";
      this.change(s);
      return this.view()!;
    }
    if (picked.length < s.settings.questions) s.notice = `Only ${picked.length} questions fit those rounds, so the game is that long.`;
    for (const p of s.players) {
      p.score = 0;
      p.right = 0;
    }
    s.questions = picked;
    s.index = -1;
    this.ask(s);
    return this.view()!;
  }

  /** Plays the same game again with the same players. */
  async again(): Promise<QuizView | null> {
    const s = this.need();
    if (s.phase !== "final") throw new QuizError("The game isn't over yet", 409);
    return this.start();
  }

  private ask(s: Session): void {
    s.index++;
    if (s.index >= s.questions.length) return this.finish(s);
    const def = s.questions[s.index]!;
    const turn = s.settings.style === "turns" && s.players.length ? s.players[s.index % s.players.length]!.id : undefined;
    const now = this.now();
    const watching = Boolean(def.clip);
    s.asking = { def, number: s.index + 1, startedAt: now, endsAt: null, watching, answers: new Map(), ...(turn ? { turn } : {}) };
    s.reveal = null;
    s.phase = "question";
    if (watching) {
      // The TV says when the clip is over; if it never does, the question opens by itself.
      this.later(def.clip!.lengthMs + CLIP_GRACE_MS, () => this.openAnswers(s));
    } else this.startClock(s);
    this.change(s);
  }

  private startClock(s: Session): void {
    const a = s.asking!;
    a.startedAt = this.now();
    if (s.settings.seconds > 0) {
      a.endsAt = a.startedAt + s.settings.seconds * 1000;
      this.later(s.settings.seconds * 1000, () => this.reveal(s));
    } else {
      a.endsAt = null;
      this.clearTimer();
    }
  }

  /** The clip has finished (or was skipped): the answers open. */
  private openAnswers(s: Session): void {
    if (this.session !== s || s.phase !== "question" || !s.asking?.watching) return;
    s.asking.watching = false;
    this.startClock(s);
    this.change(s);
  }

  clipDone(): QuizView {
    const s = this.need();
    this.openAnswers(s);
    return this.view()!;
  }

  /** Whether everyone who should answer has. */
  private allIn(s: Session): boolean {
    const a = s.asking;
    if (!a) return false;
    if (a.turn) return a.answers.has(a.turn);
    return s.players.length > 0 && s.players.every((p) => a.answers.has(p.id));
  }

  /** An answer from the remote's colour keys: whoever's turn it is, or the one person using the remote. */
  remoteAnswer(choice: unknown): QuizView {
    const s = this.need();
    const a = s.asking;
    if (s.phase !== "question" || !a) return this.view()!;
    const who = a.turn ?? s.players.find((p) => p.via === "remote")?.id;
    if (!who) throw new QuizError("Nobody is playing with the remote. Answer on your phone.", 409);
    return this.answer(s, who, choice);
  }

  phoneAnswer(code: string, id: string, secret: string, choice: unknown): QuizView {
    const { s, p } = this.phone(code, id, secret);
    return this.answer(s, p.id, choice);
  }

  private answer(s: Session, playerId: string, choice: unknown): QuizView {
    const a = s.asking;
    if (s.phase !== "question" || !a) throw new QuizError("The question has finished", 409);
    if (a.watching) throw new QuizError("Wait for the clip to finish", 409);
    if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= a.def.options.length) throw new QuizError("That isn't one of the answers");
    if (a.turn && a.turn !== playerId) throw new QuizError("It's not your turn", 409);
    // The first answer is the one that counts.
    if (!a.answers.has(playerId)) {
      a.answers.set(playerId, { choice, at: this.now() });
      if (this.allIn(s)) {
        this.reveal(s);
        return this.view()!;
      }
      this.change(s);
    }
    return this.view()!;
  }

  private reveal(s: Session): void {
    const a = s.asking;
    if (this.session !== s || s.phase !== "question" || !a) return;
    this.clearTimer();
    const timed = a.endsAt !== null;
    const span = Math.max(s.settings.seconds * 1000, 1);
    const who = a.turn ? s.players.filter((p) => p.id === a.turn) : s.players;
    const results = who.map((p) => {
      const got = a.answers.get(p.id);
      const right = got?.choice === a.def.correct;
      const left = got && a.endsAt ? (a.endsAt - got.at) / span : 0;
      const gained = quizPoints(Boolean(right), s.settings.style, left, timed);
      p.score += gained;
      if (right) p.right++;
      return { playerId: p.id, choice: got ? got.choice : null, right: Boolean(right), gained };
    });
    s.reveal = { correct: a.def.correct, nextAt: this.now() + QUIZ_REVEAL_MS, results, ...(a.def.fact ? { fact: a.def.fact } : {}) };
    s.phase = "reveal";
    this.later(QUIZ_REVEAL_MS, () => this.advance(s));
    this.change(s);
  }

  private advance(s: Session): void {
    if (this.session !== s || s.phase !== "reveal") return;
    this.ask(s);
  }

  private finish(s: Session): void {
    this.clearTimer();
    s.phase = "final";
    s.asking = null;
    s.reveal = null;
    this.change(s);
  }

  /** The host's OK: show the answer now, or move on to the next question. */
  next(): QuizView {
    const s = this.need();
    if (s.phase === "question") {
      if (s.asking?.watching) this.openAnswers(s);
      else this.reveal(s);
    } else if (s.phase === "reveal") this.advance(s);
    return this.view()!;
  }

  /** Ends the game and clears the table. */
  end(): void {
    const s = this.live();
    if (!s) return;
    this.clearTimer();
    this.session = null;
    this.deps.events.emit({ type: "quiz.state", view: null });
  }

  // -------------------------------------------------------------------------
  // Phones

  private phone(code: string, id: string, secret: string): { s: Session; p: PlayerRec } {
    const s = this.live();
    if (!s || cleanQuizCode(code) !== s.code) throw new QuizError("That quiz has finished or the code is wrong", 404);
    const p = s.players.find((x) => x.id === id);
    if (!p || typeof secret !== "string" || !same(p.secret, secret)) throw new QuizError("You're not in this game", 403);
    return { s, p };
  }

  /** A phone joins with the code on the TV and a name. */
  join(code: unknown, name: unknown): { id: string; secret: string; view: QuizView } {
    const s = this.live();
    if (!s || cleanQuizCode(code) !== s.code) throw new QuizError("That code isn't right. Look at the TV.", 404);
    const { player, secret } = this.addPlayer(name, "phone");
    return { id: player.id, secret, view: quizViewForPhone(this.view()!, player.id) };
  }

  leave(code: string, id: string, secret: string): void {
    const { p } = this.phone(code, id, secret);
    this.removePlayer(p.id);
  }

  /** The code, for the TV's QR. */
  code(): string | undefined {
    return this.live()?.code;
  }
}
