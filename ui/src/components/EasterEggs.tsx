// Hidden things to find with the remote. They work whatever the theme is, all year round, and
// never while a Kids profile is on. Each one watches for a run of key presses:
//
//   Up Up Down Down Left Right Left Right  a ghost drifts up the screen, and the Halloween
//                                          theme comes on until it's changed in Settings
//   Red Red Red                            the lights flicker
//   1 3 1 3                                pumpkins rain down the screen
//
// They're listed in docs/halloween.md, so the household has something to find.

import { createSignal, For, onCleanup } from "solid-js";
import type { Action } from "@ultimatetv/shared";
import { useKeys } from "../keys";
import { isKids, setTheme, theme, toast } from "../store";
import { Ghost } from "./Halloween";

const KONAMI: Action[] = ["up", "up", "down", "down", "left", "right", "left", "right"];
const FLICKER: Action[] = ["red", "red", "red"];
const THIRTEEN: Action[] = ["digit1", "digit3", "digit1", "digit3"];
/** A run has to be done in one go: a gap this long starts it again. */
const RUN_GAP_MS = 2500;

const ends = (keys: Action[], want: Action[]) => want.every((a, i) => keys[keys.length - want.length + i] === a);

// A ghost's wail and a creak, made rather than shipped (as the pop-up sounds are).
let audio: AudioContext | null = null;
function wail(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const ctx = audio;
    const at = ctx.currentTime + 0.05;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, at);
    osc.frequency.exponentialRampToValueAtTime(180, at + 1.6);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
    const vibrato = ctx.createOscillator();
    const depth = ctx.createGain();
    vibrato.frequency.value = 5.5;
    depth.gain.value = 18;
    vibrato.connect(depth).connect(osc.frequency);
    vibrato.start(at);
    vibrato.stop(at + 1.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 1.9);
  } catch {
    // No sound device: the ghost is still there.
  }
}

export function EasterEggs() {
  const [ghosts, setGhosts] = createSignal<{ id: number; from: number }[]>([]);
  const [pumpkins, setPumpkins] = createSignal<{ id: number; left: number; delay: number; spin: number }[]>([]);
  const [flickering, setFlickering] = createSignal(false);
  let next = 1;
  let run: Action[] = [];
  let lastAt = 0;
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

  const booGhosts = () => {
    wail();
    for (let i = 0; i < 3; i++) {
      const ghost = { id: next++, from: 15 + i * 30 + Math.random() * 10 };
      later(() => {
        setGhosts((list) => [...list, ghost]);
        later(() => setGhosts((list) => list.filter((g) => g.id !== ghost.id)), 5200);
      }, i * 500);
    }
    if (theme() !== "halloween") {
      setTheme("halloween");
      toast("Boo! The Halloween theme is on. Settings › About › Theme turns it off.", "good");
    } else {
      toast("Boo!", "good");
    }
  };

  const lightsFlicker = () => {
    setFlickering(true);
    later(() => setFlickering(false), 2600);
  };

  const pumpkinRain = () => {
    const drop = Array.from({ length: 14 }, () => ({
      id: next++,
      left: Math.random() * 94,
      delay: Math.random() * 1.8,
      spin: Math.random() < 0.5 ? -1 : 1,
    }));
    setPumpkins(drop);
    later(() => setPumpkins([]), 7000);
  };

  useKeys((action) => {
    // Kids keep the app plain: no ghosts, no flickering lights.
    if (isKids()) return false;
    const now = Date.now();
    if (now - lastAt > RUN_GAP_MS) run = [];
    lastAt = now;
    run = [...run, action].slice(-KONAMI.length);
    if (ends(run, KONAMI)) {
      run = [];
      booGhosts();
    } else if (ends(run, FLICKER)) {
      run = [];
      lightsFlicker();
    } else if (ends(run, THIRTEEN)) {
      run = [];
      pumpkinRain();
    }
    // Never swallow the key: the screen under this still does its job.
    return false;
  });

  onCleanup(() => {
    for (const t of timers) window.clearTimeout(t);
  });

  return (
    <div class="egg-layer" classList={{ flicker: flickering() }} aria-hidden="true">
      <For each={ghosts()}>{(g) => <Ghost from={g.from} />}</For>
      <For each={pumpkins()}>
        {(p) => (
          <svg class="egg-pumpkin" style={{ "--left": `${p.left}%`, "--delay": `${p.delay}s`, "--spin": String(p.spin) }} viewBox="0 0 64 64">
            <path d="M32 14c-12 0-22 8-22 22s10 20 22 20 22-8 22-20-10-22-22-22z" fill="#f07b16" />
            <path d="M30 6h4c0 5 3 7 7 8-4 2-7 1-11 0z" fill="#3f8f3a" />
            <path d="M20 30l7-5 6 5-6 2zM44 30l-7-5-6 5 6 2zM22 40c4 5 16 5 20 0-3 1-7 2-10 2s-7-1-10-2z" fill="#2a1430" />
          </svg>
        )}
      </For>
    </div>
  );
}
