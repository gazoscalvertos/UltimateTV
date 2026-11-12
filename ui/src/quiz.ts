// The family quiz on the TV (issue #264). The game runs on the Hub; this is what the TV keeps of
// it, the calls the screen makes, and the one thing only the TV can do: play an extract from a
// film or a music video before a question is asked.
//
// It lives here, not in the screen, because the screen goes while a clip plays (the player takes
// over) and the game has to carry on without it.

import { createSignal } from "solid-js";
import type { PlaybackInfo, QuizClip, QuizState, QuizView } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { play } from "./player";
import { errorToast, nav, toast } from "./store";

const [view, setView] = createSignal<QuizView | null>(null);
const [joinUrl, setJoinUrl] = createSignal<string | null>(null);
export { view as quizView, joinUrl as quizJoinUrl };

let clipFor: string | null = null;
/** How far the Hub's clock is ahead of the TV's, so the countdown is the Hub's. */
let skew = 0;
/** The time as the Hub counts it. */
export const quizClock = (): number => Date.now() + skew;

function take(state: QuizState): QuizState {
  if (state.url) setJoinUrl(state.url);
  apply(state.view);
  return state;
}

function apply(next: QuizView | null): void {
  const was = view();
  // Only ever move forward: a slow answer to an older call mustn't undo what an event already said.
  if (next && was && next.code === was.code && next.rev < was.rev) return;
  setView(next);
  if (next) skew = next.now - Date.now();
  if (!next) setJoinUrl(null);
  else if (!was || was.code !== next.code) void hub.quiz().then((s) => s.url && setJoinUrl(s.url)).catch(() => undefined);
  const q = next?.question;
  if (q?.watching && q.clip && clipFor !== q.id) {
    clipFor = q.id;
    void playClip(q.clip);
  }
  if (!q?.watching) clipFor = null;
}

export function startQuiz(): void {
  onHubEvent((e) => {
    if (e.type === "quiz.state") apply(e.view);
  });
  void hub.quiz().then(take).catch(() => undefined);
}

/** Calls the Hub and keeps what it says; a complaint (nobody is playing yet) is a toast, not a crash. */
async function call(fn: () => Promise<QuizState>): Promise<boolean> {
  try {
    take(await fn());
    return true;
  } catch (err) {
    errorToast(err);
    return false;
  }
}

export const quiz = {
  open: () => call(hub.quizOpen),
  refresh: () => call(hub.quiz),
  settings: (patch: Parameters<typeof hub.quizSettings>[0]) => call(() => hub.quizSettings(patch)),
  addPlayer: (name: string) => call(() => hub.quizAddPlayer(name)),
  removePlayer: (id: string) => call(() => hub.quizRemovePlayer(id)),
  start: () => call(hub.quizStart),
  again: () => call(hub.quizAgain),
  answer: (choice: number) => call(() => hub.quizAnswer(choice)),
  next: () => call(hub.quizNext),
  async end(): Promise<void> {
    await hub.quizEnd().catch(() => undefined);
    apply(null);
  },
};

// ---------------------------------------------------------------------------
// Extracts

/**
 * Plays a few seconds of a film or a music video full screen, then comes back and tells the Hub
 * the answers can open. It plays through the ordinary player, so the Hub's checks and the
 * profile's limits apply; it's reported as a "link", so it never counts as watched or lands in
 * Continue watching, and its title is hidden so the player doesn't give the answer away.
 */
async function playClip(clip: QuizClip): Promise<void> {
  let started = false;
  try {
    let info: PlaybackInfo;
    if (clip.req) info = await hub.play(clip.req);
    else if (clip.url) info = { url: new URL(clip.url, window.location.href).href, title: "", live: false, startMs: 0, externalSubtitles: [], progressKey: "link:quiz", skip: [] };
    else throw new Error("Nothing to play");
    // Nothing from the file that says what it is: no title, queue, next episode, subtitles or chapter marks.
    const { next: _next, queue: _queue, titles: _titles, trickplay: _trick, ...rest } = info;
    const quiet: PlaybackInfo = { ...rest, title: "Quiz extract", subtitle: "", externalSubtitles: [], progressKey: "link:quiz", skip: [], startMs: clip.startMs, savable: false };
    started = await play(clip.req ?? { kind: "stream", id: "link:quiz" }, { info: quiet, quiet: true, startMs: clip.startMs });
  } catch (err) {
    errorToast(err);
  }
  if (!started) {
    toast("Couldn't play the extract: skipping it", "bad");
    await call(hub.quizClipDone);
    return;
  }
  // Back, or the time running out, ends it.
  await new Promise<void>((resolve) => {
    const until = Date.now() + clip.lengthMs;
    const timer = window.setInterval(() => {
      if (nav.current().name !== "player") {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() >= until) {
        window.clearInterval(timer);
        // Leaving the player stops what it was playing.
        nav.back();
        resolve();
      }
    }, 250);
  });
  await call(hub.quizClipDone);
}
