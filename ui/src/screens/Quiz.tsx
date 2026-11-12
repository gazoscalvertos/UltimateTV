// The family quiz (issue #264): a lobby to set it up, then questions with four coloured answers
// that the remote's Red, Green, Yellow and Blue keys pick. 1 to 4, or the arrows and OK, work
// too for a TV that keeps its colour keys, and phones can join with the QR code.

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { QuizDifficulty, QuizPlayer, QuizRoundInfo, QuizView } from "@ultimatetv/shared";
import { quizChoiceForAction, QUIZ_COLOURS, QUIZ_DIFFICULTIES, QUIZ_LETTERS, QUIZ_MAX_PLAYERS, QUIZ_QUESTION_COUNTS, QUIZ_ROUNDS, QUIZ_SECONDS, QUIZ_SHAPES } from "@ultimatetv/shared";
import { choose, confirm, askText } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { useHints, type Hint } from "../hints";
import { useKeys } from "../keys";
import { quiz, quizClock, quizJoinUrl, quizView } from "../quiz";
import { nav, profile } from "../store";

const DIFFICULTY: Record<QuizDifficulty, string> = { easy: "Easy (little ones)", family: "Family", tricky: "Tricky (grown-ups)" };

const secondsLabel = (s: number) => (s === 0 ? "No time limit" : `${s} seconds`);
/** The one after `from` in a list, going back to the first at the end (or the first when `from` isn't in it). */
const next = <T,>(list: readonly T[], from: T): T => list[(list.indexOf(from) + 1) % list.length]!;

export function QuizScreen() {
  const v = quizView;
  onMount(async () => {
    await quiz.open();
    // Whoever picked the quiz up is playing: they're added to a new game, and can be taken out.
    const first = quizView();
    const me = profile();
    if (first && first.phase === "lobby" && !first.players.length && me) await quiz.addPlayer(me.name);
  });

  const [tick, setTick] = createSignal(0);
  const clock = window.setInterval(() => setTick((n) => n + 1), 200);
  onCleanup(() => window.clearInterval(clock));

  const leave = async () => {
    const view = v();
    if (view && view.phase !== "lobby" && view.phase !== "final") {
      if (!(await confirm("Stop the quiz?", "The scores will be lost.", "Stop the quiz", true))) return;
    }
    await quiz.end();
    nav.back();
  };

  useKeys((a) => {
    if (a === "back") {
      void leave();
      return true;
    }
    const view = v();
    if (!view) return false;
    if (view.phase === "question" && view.question && !view.question.watching) {
      const choice = quizChoiceForAction(a);
      if (choice !== undefined) {
        if (choice < view.question.options.length) void quiz.answer(choice);
        return true;
      }
      // OK on an answer picks it. OK anywhere else must never leave the quiz (the top menu may hold the focus):
      // it ends the question early once somebody has answered (on a phone, say), and otherwise does nothing.
      if (a === "ok" && !(document.activeElement as HTMLElement | null)?.classList.contains("quiz-answer")) {
        if (view.players.some((p) => p.answered)) void quiz.next();
        return true;
      }
    } else if (view.phase === "question" && view.question?.watching && a === "ok") {
      void quiz.next();
      return true;
    } else if (view.phase === "reveal" && a === "ok") {
      void quiz.next();
      return true;
    } else if (view.phase === "lobby") {
      if (a === "green") {
        void start();
        return true;
      }
      if (a === "yellow") {
        void addPlayer();
        return true;
      }
    }
    return false;
  });

  const hints = (): Hint[] => {
    const view = v();
    if (!view) return [];
    switch (view.phase) {
      case "lobby":
        return [
          { key: "ok", label: "Choose" },
          { key: "green", label: "Start" },
          { key: "yellow", label: "Add a player" },
          { key: "back", label: "Leave" },
        ];
      case "question":
        return view.question?.watching
          ? [{ key: "ok", label: "Skip the extract" }]
          : [
              { key: "red", label: "A" },
              { key: "green", label: "B" },
              { key: "yellow", label: "C" },
              { key: "blue", label: "D" },
              { key: "back", label: "Stop" },
            ];
      case "reveal":
        return [
          { key: "ok", label: "Next question" },
          { key: "back", label: "Stop" },
        ];
      default:
        return [
          { key: "ok", label: "Choose" },
          { key: "back", label: "Leave" },
        ];
    }
  };
  useHints(hints);

  const addPlayer = async () => {
    const view = v();
    if (!view || view.phase !== "lobby" || view.players.length >= QUIZ_MAX_PLAYERS) return;
    const name = await askText("Player's name", "", "Type a name, or type it on your phone remote");
    if (name?.trim()) await quiz.addPlayer(name.trim());
  };
  const start = async () => {
    const view = v();
    if (view?.phase !== "lobby") return;
    if (!view.players.length) return void (await addPlayer());
    await quiz.start();
  };

  return (
    <div class="screen quiz-screen" data-layer>
      <TopBar />
      <div class="page quiz-page" data-scroll-y="120">
        <Show when={v()} fallback={<div class="spinner" />}>
          {(view) => (
            <>
              <Show when={view().phase === "lobby"}>
                <Lobby view={view()} start={start} addPlayer={addPlayer} />
              </Show>
              <Show when={view().phase === "loading"}>
                <div class="quiz-wait">
                  <div class="spinner" />
                  <h2>Choosing the questions…</h2>
                </div>
              </Show>
              <Show when={(view().phase === "question" || view().phase === "reveal") && view().question}>
                <Question view={view()} tick={tick} />
              </Show>
              <Show when={view().phase === "final"}>
                <Podium view={view()} leave={leave} />
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby

function Lobby(props: { view: QuizView; start: () => void; addPlayer: () => void }) {
  const s = () => props.view.settings;
  const rounds = (): QuizRoundInfo[] => [...QUIZ_ROUNDS];
  const have = (r: QuizRoundInfo) => r.source === "bank" || (props.view.available[r.id] ?? 0) > 0;

  const toggleRound = async (r: QuizRoundInfo) => {
    if (!have(r)) {
      await choose({ title: r.label, message: r.source === "extract" ? "There's nothing in the library to make extracts from yet. This needs films (or music videos on the music channels) with enough different titles." : "The library doesn't have enough for this round yet.", options: [{ label: "OK", value: "ok" }] });
      return;
    }
    const on = s().rounds.includes(r.id);
    if (on && s().rounds.length === 1) return;
    await quiz.settings({ rounds: on ? s().rounds.filter((x) => x !== r.id) : [...s().rounds, r.id] });
  };
  const difficulties = () => QUIZ_DIFFICULTIES.filter((d) => !(props.view.kids && d === "tricky"));
  const removePlayer = async (p: QuizPlayer) => {
    const pick = await choose({ title: p.name, options: [{ label: "Take out of the game", value: "remove", tone: "danger" }, { label: "Keep", value: "keep" }] });
    if (pick === "remove") await quiz.removePlayer(p.id);
  };

  return (
    <div class="quiz-lobby">
      <h1 class="page-title">Family quiz</h1>
      <Show when={props.view.notice}>
        <p class="quiz-notice">{props.view.notice}</p>
      </Show>

      <div class="quiz-grid">
        <section class="quiz-col">
          <h2 class="rail-title quiz-h">How to play</h2>
          <div class="quiz-styles" data-row data-focus-group>
            <button class="quiz-style" classList={{ on: s().style === "turns" }} data-focus data-autofocus onClick={() => void quiz.settings({ style: "turns" })}>
              <Icon name="remote" />
              <b>Take turns</b>
              <span>One remote. Each question is for the next person, who answers with the colour keys.</span>
            </button>
            <button class="quiz-style" classList={{ on: s().style === "together" }} data-focus onClick={() => void quiz.settings({ style: "together" })}>
              <Icon name="phone" />
              <b>Everyone together</b>
              <span>Everyone answers on their own phone. Quicker answers score more.</span>
            </button>
          </div>

          <h2 class="rail-title quiz-h">
            Players <small>{props.view.players.length} of {QUIZ_MAX_PLAYERS}</small>
          </h2>
          <div class="quiz-players" data-row data-focus-group>
            <For each={props.view.players}>
              {(p) => (
                <button class="chip quiz-player" data-focus onClick={() => void removePlayer(p)}>
                  <Icon name={p.via === "phone" ? "phone" : "remote"} />
                  {p.name}
                </button>
              )}
            </For>
            <Show when={props.view.players.length < QUIZ_MAX_PLAYERS}>
              <button class="chip" data-focus onClick={props.addPlayer}>
                <kbd class="key-yellow" /> Add a player
              </button>
            </Show>
          </div>

          <h2 class="rail-title quiz-h">Rounds</h2>
          <div class="quiz-rounds" data-row data-focus-group>
            <For each={rounds()}>
              {(r) => (
                <button class="chip quiz-round" classList={{ active: s().rounds.includes(r.id), missing: !have(r) }} data-focus onClick={() => void toggleRound(r)} title={r.detail}>
                  <Show when={s().rounds.includes(r.id)}>
                    <Icon name="check" />
                  </Show>
                  {r.label}
                </button>
              )}
            </For>
          </div>

          <div class="quiz-options" data-row data-focus-group>
            <button class="btn" data-focus onClick={() => void quiz.settings({ questions: next<number>(QUIZ_QUESTION_COUNTS, s().questions) })}>
              {s().questions} questions
            </button>
            <button class="btn" data-focus onClick={() => void quiz.settings({ seconds: next<number>(QUIZ_SECONDS, s().seconds) })}>
              {secondsLabel(s().seconds)}
            </button>
            <button class="btn" data-focus onClick={() => void quiz.settings({ difficulty: next(difficulties(), s().difficulty) })}>
              {DIFFICULTY[s().difficulty]}
            </button>
            <button class="btn btn-primary btn-large quiz-start" data-focus onClick={props.start}>
              <kbd class="key-green" /> Start the quiz
            </button>
          </div>
        </section>

        <aside class="quiz-join">
          <h2 class="rail-title quiz-h">Join on your phone</h2>
          <Show when={quizJoinUrl()} fallback={<p class="muted">Getting the link…</p>}>
            {(url) => (
              <>
                <img class="quiz-qr" src={`/api/quiz/qr.svg?v=${props.view.code}`} alt="" />
                <p class="quiz-code">{props.view.code}</p>
                <p class="muted">Scan the code, or open <b>{url().replace(/\?.*$/, "")}</b> and type the four letters.</p>
              </>
            )}
          </Show>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Questions and answers

function Question(props: { view: QuizView; tick: () => number }) {
  const q = createMemo(() => props.view.question!);
  const reveal = () => (props.view.phase === "reveal" ? props.view.reveal : undefined);
  const byId = createMemo(() => new Map(props.view.players.map((p) => [p.id, p])));
  const turn = () => (q().turn ? byId().get(q().turn!) : undefined);
  /** Who picked each answer, once it's out. */
  const pickers = (i: number) => (reveal()?.results ?? []).filter((r) => r.choice === i).map((r) => byId().get(r.playerId)?.name ?? "");
  const left = () => {
    props.tick();
    const end = q().endsAt;
    if (!end || props.view.phase !== "question") return null;
    return Math.max(end - quizClock(), 0);
  };
  const secondsLeft = () => Math.ceil((left() ?? 0) / 1000);
  const countdown = () => (left() === null ? 0 : left()! / (q().seconds * 1000));
  // The next question follows by itself, so say when.
  const autoIn = () => {
    props.tick();
    const at = reveal()?.nextAt;
    return at ? Math.max(0, Math.ceil((at - quizClock()) / 1000)) : 0;
  };

  return (
    <div class="quiz-question">
      <div class="quiz-top">
        <span class="quiz-round-name">{q().roundLabel}</span>
        <span class="quiz-count">
          Question {q().number} of {q().of}
        </span>
        <Show when={turn()}>
          {(p) => (
            <span class="quiz-turn">
              <Icon name={p().via === "phone" ? "phone" : "remote"} /> {p().name}'s turn
            </span>
          )}
        </Show>
        <Show when={!q().turn && props.view.phase === "question" && !q().watching}>
          <span class="quiz-turn">
            <Icon name="phone" /> Everyone answers now
          </span>
        </Show>
      </div>

      <Show when={left() !== null && props.view.phase === "question"}>
        <div class="quiz-clock" classList={{ low: secondsLeft() <= 5 }}>
          <div class="quiz-track">
            <i style={{ transform: `scaleX(${Math.min(countdown(), 1)})` }} />
          </div>
          <b>{secondsLeft()}</b>
        </div>
      </Show>

      <Show when={q().watching}>
        <div class="quiz-watching">Get ready: an extract is about to play. Watch and listen closely!</div>
      </Show>

      <div class="quiz-body">
        <Show when={q().image}>
          <img class="quiz-picture" classList={{ blur: Boolean(q().blur) && props.view.phase === "question" }} src={q().image} alt="" />
        </Show>
        <div class="quiz-words">
          <h1 class="quiz-text">{q().text}</h1>
          <Show when={q().detail}>
            <p class="quiz-detail">{q().detail}</p>
          </Show>
        </div>
      </div>

      <div class="quiz-answers" data-row data-focus-group>
        <For each={q().options}>
          {(text, i) => (
            <button
              class={`quiz-answer ${QUIZ_COLOURS[i()]}`}
              classList={{ right: reveal()?.correct === i(), wrong: reveal() !== undefined && reveal()!.correct !== i(), shut: Boolean(q().watching) || (props.view.phase === "reveal") }}
              data-focus
              disabled={Boolean(q().watching)}
              onClick={() => (props.view.phase === "question" ? void quiz.answer(i()) : void quiz.next())}
            >
              <span class="quiz-shape" aria-hidden="true">{QUIZ_SHAPES[i()]}</span>
              <span class="quiz-letter">{QUIZ_LETTERS[i()]}</span>
              <span class="quiz-option">{text}</span>
              <Show when={reveal()?.correct === i()}>
                <Icon name="check" class="quiz-tick" />
              </Show>
              <Show when={pickers(i()).length}>
                <span class="quiz-pickers">{pickers(i()).join(", ")}</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      <Show when={reveal()}>
        {(r) => (
          <div class="quiz-result">
            <Show when={r().fact}>
              <p class="quiz-fact">{r().fact}</p>
            </Show>
            <p class="quiz-gains">
              <For each={r().results}>
                {(x) => (
                  <span classList={{ got: x.right }}>
                    {byId().get(x.playerId)?.name ?? ""}: {x.right ? `+${x.gained}` : x.choice === null ? "no answer" : "not this time"}
                  </span>
                )}
              </For>
            </p>
            <p class="muted quiz-next">
              <kbd>OK</kbd> Next question in {autoIn()}
            </p>
          </div>
        )}
      </Show>

      <Scores view={props.view} />
    </div>
  );
}

function Scores(props: { view: QuizView }) {
  const sorted = () => [...props.view.players].sort((a, b) => b.score - a.score);
  return (
    <div class="quiz-scores">
      <For each={sorted()}>
        {(p) => (
          <span class="quiz-score" classList={{ turn: props.view.question?.turn === p.id, done: p.answered && props.view.phase === "question" }}>
            <Icon name={p.via === "phone" ? "phone" : "remote"} />
            {p.name}
            <b>{p.score}</b>
            <Show when={p.answered && props.view.phase === "question"}>
              <Icon name="check" class="quiz-ok" />
            </Show>
          </span>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The end

function Podium(props: { view: QuizView; leave: () => void }) {
  const ranked = () => [...props.view.players].sort((a, b) => b.score - a.score || b.right - a.right);
  const tied = () => ranked().length > 1 && ranked()[0]!.score === ranked()[1]!.score;
  const total = () => props.view.question?.of ?? props.view.settings.questions;
  return (
    <div class="quiz-final">
      <h1 class="page-title">{tied() ? "It's a draw!" : ranked().length > 1 ? `${ranked()[0]!.name} wins!` : `${ranked()[0]?.name ?? "Well"}, well done!`}</h1>
      <div class="quiz-podium">
        <For each={ranked().slice(0, 3)}>
          {(p, i) => (
            <div class={`quiz-step place-${i() + 1}`}>
              <span class="quiz-medal">{["🥇", "🥈", "🥉"][i()]}</span>
              <b>{p.name}</b>
              <span class="quiz-points">{p.score}</span>
              <small>{p.right} right</small>
            </div>
          )}
        </For>
      </div>
      <Show when={ranked().length > 3}>
        <ol class="quiz-rest" start={4}>
          <For each={ranked().slice(3)}>
            {(p) => (
              <li>
                {p.name} <b>{p.score}</b>
              </li>
            )}
          </For>
        </ol>
      </Show>
      <p class="muted quiz-total">{total() ? `${total()} questions played` : ""}</p>
      <div class="quiz-end-buttons" data-row data-focus-group>
        <button class="btn btn-primary btn-large" data-focus data-autofocus onClick={() => void quiz.again()}>
          Play again
        </button>
        <button class="btn btn-large" data-focus onClick={props.leave}>
          Finish
        </button>
      </div>
    </div>
  );
}
