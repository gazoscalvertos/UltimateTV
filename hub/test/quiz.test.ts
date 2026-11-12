// The family quiz (issue #264): the questions, the scoring and a whole game from lobby to podium.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubEvent, QuizView } from "@ultimatetv/shared";
import { cleanQuizSettings, quizChoiceForAction, quizPoints, QUIZ_REVEAL_MS } from "@ultimatetv/shared";
import { EventBus } from "../src/events.js";
import { silentLogger } from "../src/log.js";
import { NO_FILTER } from "../src/profiles.js";
import { Quiz, QuizError } from "../src/quiz.js";
import { QUIZ_BANK } from "../src/quizbank.js";
import { availability, clipWindow, maskTitle, pickQuestions, roundDefs, type LibSong, type LibTitle, type QuizPool } from "../src/quizsources.js";

/** A repeatable "random": the same numbers every run. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const film = (n: number, extra: Partial<LibTitle> = {}): LibTitle => ({
  req: { kind: "title", id: `jellyfin:f${n}` },
  kind: "movie",
  name: `Film Number ${n}`,
  year: 2000 + n,
  overview: `A story about Film Number ${n} and the people who live there, who go on a long journey across the sea to find a lost treasure.`,
  cast: [`Actor ${n}a`, `Actor ${n}b`],
  genres: ["Adventure"],
  poster: `/api/art/f${n}.jpg`,
  runtimeMs: 100 * 60_000,
  ...extra,
});
const song = (n: number): LibSong => ({ artist: `Artist ${n}`, track: `Song ${n}`, url: `/api/mix/videos/s${n}/file`, durationMs: 200_000 });
const pool: QuizPool = { titles: [1, 2, 3, 4, 5, 6].map((n) => film(n)), songs: [1, 2, 3, 4, 5].map(song) };

describe("the built-in questions", () => {
  it("each has four different answers, one of them right, and a sensible tier", () => {
    for (const q of QUIZ_BANK) {
      const all = [q.answer, ...q.wrong];
      expect(new Set(all.map((a) => a.toLowerCase())).size, q.text).toBe(4);
      expect([1, 2, 3]).toContain(q.tier);
      expect(q.text.endsWith("?"), q.text).toBe(true);
    }
  });

  it("has enough of every tier in every round to play a game", () => {
    const rounds = new Set(QUIZ_BANK.map((q) => q.round));
    expect(rounds.size).toBe(8);
    for (const r of rounds) {
      expect(QUIZ_BANK.filter((q) => q.round === r && q.tier === 1).length, `${r} tier 1`).toBeGreaterThanOrEqual(3);
      expect(QUIZ_BANK.filter((q) => q.round === r && q.tier === 2).length, `${r} tier 2`).toBeGreaterThanOrEqual(3);
      expect(QUIZ_BANK.filter((q) => q.round === r && q.tier === 3).length, `${r} tier 3`).toBeGreaterThanOrEqual(2);
    }
  });

  it("has no question asked twice", () => {
    expect(new Set(QUIZ_BANK.map((q) => q.text)).size).toBe(QUIZ_BANK.length);
  });
});

describe("questions from the household's library", () => {
  it("takes a film's name out of its description", () => {
    const masked = maskTitle("In The Lion King, a young lion called Simba must take his place as king of the Pride Lands one day.", "The Lion King");
    expect(masked).toBeDefined();
    expect(masked!.toLowerCase()).not.toContain("lion king");
    expect(masked).toContain("…");
  });

  it("won't use a description too short to be a clue", () => {
    expect(maskTitle("A film.", "Film")).toBeUndefined();
  });

  it("never gives the answer away in the question or the other options", () => {
    const defs = roundDefs("films", [1, 2, 3], pool, seeded());
    expect(defs.length).toBeGreaterThan(10);
    for (const d of defs) {
      expect(d.options).toHaveLength(4);
      expect(new Set(d.options).size).toBe(4);
      expect(d.correct).toBeGreaterThanOrEqual(0);
      if (d.id.endsWith(":story")) expect(d.detail).not.toContain("Film Number");
    }
  });

  it("asks who starred, with names from other films as the wrong answers", () => {
    const d = roundDefs("films", [2], pool, seeded()).find((x) => x.id.endsWith(":cast"))!;
    const n = /Film Number (\d+)/.exec(d.text)![1];
    expect(d.options[d.correct]).toMatch(new RegExp(`^Actor ${n}[ab]$`));
    for (const [i, o] of d.options.entries()) if (i !== d.correct) expect(o).not.toMatch(new RegExp(`^Actor ${n}[ab]$`));
  });

  it("asks release years that are plausible and not in the future", () => {
    const d = roundDefs("films", [3], pool, seeded()).find((x) => x.id.endsWith(":year"))!;
    for (const o of d.options) expect(Number(o)).toBeLessThanOrEqual(new Date().getFullYear());
  });

  it("blurs a poster so it is a clue, not a gift", () => {
    const d = roundDefs("films", [1], pool, seeded()).find((x) => x.id.endsWith(":poster"))!;
    expect(d.blur).toBe(true);
    expect(d.image).toBeDefined();
  });

  it("needs enough films to make wrong answers, and enough artists for the music", () => {
    // Two films can't make four options, or three wrong actors; only the year question needs no others.
    expect(roundDefs("films", [1, 2, 3], { titles: [film(1), film(2)], songs: [] }, seeded()).every((d) => d.id.endsWith(":year"))).toBe(true);
    expect(roundDefs("music", [2], { titles: [], songs: [song(1), song(2), song(3)] }, seeded())).toEqual([]);
    expect(availability({ titles: [], songs: [] }, seeded())).toEqual({});
    expect(availability(pool, seeded()).films).toBeGreaterThan(0);
  });

  it("makes extract questions with a clip inside the file, away from its ends", () => {
    const films = roundDefs("film-extracts", [1, 2, 3], pool, seeded());
    expect(films.length).toBe(6);
    for (const d of films) {
      expect(d.clip?.kind).toBe("film");
      expect(d.clip!.startMs).toBeGreaterThan(100 * 60_000 * 0.1);
      expect(d.clip!.startMs + d.clip!.lengthMs).toBeLessThan(100 * 60_000 * 0.8);
    }
    const tunes = roundDefs("music-extracts", [2], pool, seeded());
    expect(tunes[0]!.clip).toMatchObject({ kind: "music", url: expect.stringContaining("/api/mix/videos/") });
    expect(clipWindow(10_000, seeded())).toBeUndefined();
  });

  it("takes the rounds in turn and asks about one film at most twice", () => {
    const picked = pickQuestions(["general", "films", "music"], [1, 2], 12, pool, seeded());
    expect(picked.length).toBe(12);
    expect(new Set(picked.slice(0, 6).map((q) => q.round)).size).toBe(3);
    const perGroup = new Map<string, number>();
    for (const q of picked) if (q.group) perGroup.set(q.group, (perGroup.get(q.group) ?? 0) + 1);
    for (const n of perGroup.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("only draws from the tiers the difficulty allows", () => {
    for (const q of pickQuestions(["general", "science"], [1], 10, pool, seeded())) expect(q.tier).toBe(1);
  });
});

describe("keys, settings and scoring", () => {
  it("turns the colour keys, and 1 to 4, into answers", () => {
    expect(["red", "green", "yellow", "blue"].map(quizChoiceForAction)).toEqual([0, 1, 2, 3]);
    expect(["digit1", "digit2", "digit3", "digit4"].map(quizChoiceForAction)).toEqual([0, 1, 2, 3]);
    expect(quizChoiceForAction("ok")).toBeUndefined();
    expect(quizChoiceForAction("digit5")).toBeUndefined();
  });

  it("scores nothing for a wrong answer, and a speed bonus only when playing together with a clock", () => {
    expect(quizPoints(false, "together", 1, true)).toBe(0);
    expect(quizPoints(true, "turns", 1, true)).toBe(100);
    expect(quizPoints(true, "together", 1, true)).toBe(150);
    expect(quizPoints(true, "together", 0.5, true)).toBe(125);
    expect(quizPoints(true, "together", 0, true)).toBe(100);
    expect(quizPoints(true, "together", 1, false)).toBe(100);
  });

  it("cleans settings: bounds, unknown rounds, and no tricky questions for Kids", () => {
    const s = cleanQuizSettings({ questions: 500, seconds: 2, rounds: ["nonsense"], difficulty: "tricky", style: "x" }, undefined, true);
    expect(s.questions).toBe(40);
    expect(s.seconds).toBe(8);
    expect(s.rounds.length).toBeGreaterThan(0);
    expect(s.difficulty).toBe("family");
    expect(s.style).toBe("turns");
    expect(cleanQuizSettings({ seconds: 0 }).seconds).toBe(0);
  });
});

describe("a game", () => {
  let quiz: Quiz;
  let events: HubEvent[];
  const last = () => quiz.view()!;
  const rightChoice = () => {
    // The engine never shows the answer, so a test finds it the way a cheat can't: by playing the same seeded game.
    return answers[last().question!.id];
  };
  let answers: Record<string, number>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T19:00:00Z"));
    const bus = new EventBus();
    events = [];
    bus.on((e) => events.push(e));
    quiz = new Quiz({ events: bus, pool: async () => pool, log: silentLogger, rand: seeded(11) });
    answers = {};
  });
  afterEach(() => vi.useRealTimers());

  /** Ends the current question and reads the right answer from the reveal. */
  const learn = () => {
    quiz.next();
    const v = last();
    answers[v.question!.id] = v.reveal!.correct;
    return v;
  };

  it("opens a lobby with a code, and what the library can offer", async () => {
    const v = await quiz.open(NO_FILTER);
    expect(v.phase).toBe("lobby");
    expect(v.code).toMatch(/^[A-Z]{4}$/);
    expect(v.available.films).toBeGreaterThan(0);
    expect(v.available.music).toBeGreaterThan(0);
    // Opening again joins the same game.
    expect((await quiz.open(NO_FILTER)).code).toBe(v.code);
  });

  it("won't start without players, and keeps the settings until then", async () => {
    await quiz.open(NO_FILTER);
    await expect(quiz.start()).rejects.toThrow(/at least one player/i);
    quiz.configure({ questions: 8, seconds: 0 });
    expect(last().settings).toMatchObject({ questions: 8, seconds: 0 });
  });

  it("takes turns: the key answers for whoever's turn it is, and the next question is the next person's", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ style: "turns", questions: 8, rounds: ["general", "science", "geography", "animals"], difficulty: "easy" });
    const mum = quiz.addPlayer("Mum", "remote").player;
    const sam = quiz.addPlayer("Sam", "remote").player;
    await quiz.start();
    expect(last().phase).toBe("question");
    expect(last().question!.turn).toBe(mum.id);
    // The answer is not in the view while the question is open.
    expect(JSON.stringify(last())).not.toContain('"correct"');
    quiz.remoteAnswer(0);
    // Turns: the one answer ends the question.
    expect(last().phase).toBe("reveal");
    expect(last().reveal!.results).toHaveLength(1);
    expect(last().reveal!.results[0]!.playerId).toBe(mum.id);
    // Moves on by itself after a while, to Sam.
    vi.advanceTimersByTime(QUIZ_REVEAL_MS + 1);
    expect(last().phase).toBe("question");
    expect(last().question!.number).toBe(2);
    expect(last().question!.turn).toBe(sam.id);
  });

  it("scores a right answer 100 in turns, and keeps a running total to a podium", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ questions: 8, rounds: ["general", "science", "geography", "animals"], difficulty: "easy", seconds: 0 });
    const p = quiz.addPlayer("Gran", "remote").player;
    await quiz.start();
    let right = 0;
    for (let i = 0; i < 8; i++) {
      // Guess red; learn the truth from the reveal.
      quiz.remoteAnswer(0);
      const v = last();
      expect(v.phase).toBe("reveal");
      if (v.reveal!.results[0]!.right) right++;
      expect(v.reveal!.results[0]!.gained).toBe(v.reveal!.results[0]!.right ? 100 : 0);
      quiz.next();
    }
    expect(last().phase).toBe("final");
    expect(last().players.find((x) => x.id === p.id)!.score).toBe(right * 100);
    expect(last().question).toBeUndefined();
  });

  it("closes the question when time runs out, scoring nothing for no answer", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ questions: 8, rounds: ["general", "science", "geography", "animals"], seconds: 15, difficulty: "easy" });
    quiz.addPlayer("Dad", "remote");
    await quiz.start();
    const ends = last().question!.endsAt!;
    expect(ends - Date.now()).toBe(15_000);
    vi.advanceTimersByTime(15_001);
    expect(last().phase).toBe("reveal");
    expect(last().reveal!.results[0]).toMatchObject({ choice: null, right: false, gained: 0 });
  });

  it("plays together on phones: everyone answers, the quickest right answer scores most", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ style: "together", questions: 8, rounds: ["general", "science", "geography", "animals"], seconds: 20, difficulty: "easy" });
    const code = last().code;
    const a = quiz.join(code, "Ava");
    const b = quiz.join(code.toLowerCase(), "Ben");
    expect(a.view.you).toBe(a.id);
    await quiz.start();
    const q = last().question!;
    expect(q.turn).toBeUndefined();
    // Ava answers instantly, Ben five seconds later: everyone is in, so it reveals.
    quiz.phoneAnswer(code, a.id, a.secret, 0);
    expect(last().phase).toBe("question");
    expect(last().players.find((p) => p.id === a.id)!.answered).toBe(true);
    vi.advanceTimersByTime(5_000);
    quiz.phoneAnswer(code, b.id, b.secret, 0);
    const v = last();
    expect(v.phase).toBe("reveal");
    const ra = v.reveal!.results.find((r) => r.playerId === a.id)!;
    const rb = v.reveal!.results.find((r) => r.playerId === b.id)!;
    // Both picked the same colour, so both are right or both wrong; if right, the quicker one has more.
    expect(ra.right).toBe(rb.right);
    if (ra.right) {
      expect(ra.gained).toBe(150);
      expect(rb.gained).toBe(100 + Math.round(50 * (15 / 20)));
    }
  });

  it("keeps the first answer, and refuses a wrong secret, a wrong code and someone else's turn", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ style: "turns", questions: 8, rounds: ["general", "science", "geography", "animals"], seconds: 0, difficulty: "easy" });
    const code = last().code;
    const a = quiz.join(code, "Ava");
    const b = quiz.join(code, "Ben");
    await quiz.start();
    expect(() => quiz.phoneAnswer(code, a.id, "nope", 0)).toThrow(QuizError);
    expect(() => quiz.phoneAnswer("ZZZZ", a.id, a.secret, 0)).toThrow(/finished or the code/);
    expect(() => quiz.phoneAnswer(code, b.id, b.secret, 0)).toThrow(/not your turn/);
    expect(() => quiz.phoneAnswer(code, a.id, a.secret, 9)).toThrow(/isn't one of the answers/);
    expect(() => quiz.join("ZZZZ", "Cy")).toThrow(/code isn't right/);
  });

  it("lets only one person use the remote when everyone answers together", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ style: "together" });
    quiz.addPlayer("Mum", "remote");
    expect(() => quiz.addPlayer("Dad", "remote")).toThrow(/Only one person can use the remote/);
    quiz.addPlayer("Dad", "phone");
    expect(last().players).toHaveLength(2);
  });

  it("gives players with the same name their own", async () => {
    await quiz.open(NO_FILTER);
    quiz.addPlayer("Sam", "remote");
    expect(quiz.addPlayer("sam", "remote").player.name).toBe("sam 2");
    expect(() => quiz.addPlayer("   ", "remote")).toThrow(/name/);
  });

  it("holds the answers shut while a clip plays, then opens them when the TV says it's done", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ questions: 8, rounds: ["film-extracts"], seconds: 20, difficulty: "family" });
    quiz.addPlayer("Mum", "remote");
    await quiz.start();
    const q = last().question!;
    expect(q.watching).toBe(true);
    expect(q.clip?.kind).toBe("film");
    expect(q.endsAt).toBeNull();
    expect(() => quiz.remoteAnswer(0)).toThrow(/clip/);
    // A phone never gets the clip.
    const phone = quiz.join(last().code, "Pip");
    expect(phone.view.question!.clip).toBeUndefined();
    vi.advanceTimersByTime(5_000);
    quiz.clipDone();
    expect(last().question!.watching).toBeUndefined();
    expect(last().question!.endsAt).toBe(Date.now() + 20_000);
    quiz.remoteAnswer(1);
    expect(last().phase).toBe("reveal");
  });

  it("opens a question by itself if the TV never says the clip is over", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ questions: 8, rounds: ["music-extracts"], seconds: 0, difficulty: "family" });
    quiz.addPlayer("Mum", "remote");
    await quiz.start();
    expect(last().question!.watching).toBe(true);
    vi.advanceTimersByTime(12_000 + 20_000 + 1);
    expect(last().question!.watching).toBeUndefined();
  });

  it("says so when the chosen rounds can't make a game", async () => {
    quiz = new Quiz({ events: new EventBus(), pool: async () => ({ titles: [], songs: [] }), log: silentLogger, rand: seeded() });
    await quiz.open(NO_FILTER);
    quiz.configure({ rounds: ["films"] });
    quiz.addPlayer("Mum", "remote");
    const v = await quiz.start();
    expect(v!.phase).toBe("lobby");
    expect(v!.notice).toMatch(/enough questions/);
  });

  it("carries on if the library can't be read", async () => {
    quiz = new Quiz({ events: new EventBus(), pool: async () => Promise.reject(new Error("down")), log: silentLogger, rand: seeded() });
    const v = await quiz.open(NO_FILTER);
    expect(v.available).toEqual({});
    quiz.configure({ rounds: ["general", "science", "geography", "animals"] });
    quiz.addPlayer("Mum", "remote");
    expect((await quiz.start())!.phase).toBe("question");
  });

  it("plays again with the same players and a clean slate, and ends cleanly", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ questions: 8, rounds: ["general", "science", "geography", "animals"], seconds: 0, difficulty: "easy" });
    quiz.addPlayer("Mum", "remote");
    await quiz.start();
    for (let i = 0; i < 8; i++) {
      quiz.remoteAnswer(0);
      quiz.next();
    }
    expect(last().phase).toBe("final");
    await quiz.again();
    expect(last().phase).toBe("question");
    expect(last().players[0]!.score).toBe(0);
    expect(last().question!.number).toBe(1);
    quiz.end();
    expect(quiz.view()).toBeNull();
    expect(events.at(-1)).toEqual({ type: "quiz.state", view: null });
    expect(() => quiz.configure({})).toThrow(/no quiz on/i);
  });

  it("goes on without a player who leaves, and ends the question when the rest have all answered", async () => {
    await quiz.open(NO_FILTER);
    quiz.configure({ style: "together", questions: 8, rounds: ["general", "science", "geography", "animals"], seconds: 0, difficulty: "easy" });
    const code = last().code;
    const a = quiz.join(code, "Ava");
    const b = quiz.join(code, "Ben");
    await quiz.start();
    quiz.phoneAnswer(code, a.id, a.secret, 2);
    expect(last().phase).toBe("question");
    quiz.leave(code, b.id, b.secret);
    expect(last().phase).toBe("reveal");
    expect(last().players).toHaveLength(1);
  });

  it("forgets a game nobody touched for hours", async () => {
    await quiz.open(NO_FILTER);
    vi.advanceTimersByTime(7 * 3_600_000);
    expect(quiz.view()).toBeNull();
  });

  it("tells the TV about every change", async () => {
    await quiz.open(NO_FILTER);
    quiz.addPlayer("Mum", "remote");
    const states = events.filter((e) => e.type === "quiz.state");
    expect(states.length).toBeGreaterThanOrEqual(2);
    const views = states.map((e) => (e as { view: QuizView }).view);
    expect(views.at(-1)!.players).toHaveLength(1);
    expect(views.at(-1)!.rev).toBeGreaterThan(views[0]!.rev);
  });

  it("lets a polling phone ask only for what's new", async () => {
    await quiz.open(NO_FILTER);
    const code = last().code;
    const a = quiz.join(code, "Ava");
    const first = quiz.phoneView(code, a.id, a.secret) as QuizView;
    expect(quiz.phoneView(code, a.id, a.secret, first.rev)).toMatchObject({ unchanged: true });
    quiz.addPlayer("Mum", "remote");
    expect((quiz.phoneView(code, a.id, a.secret, first.rev) as QuizView).players).toHaveLength(2);
  });

  it("never lets a Kids profile play the tricky questions", async () => {
    const kids = { ...NO_FILTER, limited: true } as typeof NO_FILTER;
    const v = await quiz.open(kids);
    expect(v.kids).toBe(true);
    expect(quiz.configure({ difficulty: "tricky" }).settings.difficulty).toBe("family");
  });
});
