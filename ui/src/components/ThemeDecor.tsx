// The moving bits of the other themes, as Halloween.tsx is for Halloween: snow and fairy lights at
// Christmas, blossom and eggs at Easter, hearts for Valentine's, and a neon horizon for Cyberpunk.
// Like the bats, none of it is drawn while something is playing, and it's all drawn rather than
// loaded, so a theme adds nothing to download. The colours themselves come from shared/src/themes.ts.

import { For, Index, Show } from "solid-js";
import { nowPlaying } from "../player";
import { theme } from "../store";

/** The same scatter every time, so the snow doesn't jump about when the theme is put on again. */
const scatter = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => {
    const r = (k: number) => {
      const x = Math.sin((i + 1) * 12.9898 * k + seed * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    return { left: r(1) * 100, delay: r(2), size: r(3), drift: r(4) };
  });

const SNOW = scatter(46, 1);
const PETALS = scatter(16, 2);
const HEARTS = scatter(12, 3);
const BULBS = Array.from({ length: 22 }, (_, i) => i);
const BULB_COLOURS = ["#ff4b4b", "#ffd34d", "#4bd16f", "#4fa3ff", "#ff7bd8"];

function Christmas() {
  return (
    <>
      <svg class="xm-lights" viewBox="0 0 1100 70" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 8 Q 27.5 40 55 8 T 110 8 T 165 8 T 220 8 T 275 8 T 330 8 T 385 8 T 440 8 T 495 8 T 550 8 T 605 8 T 660 8 T 715 8 T 770 8 T 825 8 T 880 8 T 935 8 T 990 8 T 1045 8 T 1100 8" fill="none" stroke="#1d2b1f" stroke-width="2.5" />
        <Index each={BULBS}>
          {(i) => (
            <ellipse
              class="xm-bulb"
              cx={27.5 + i() * 50}
              cy={28}
              rx="6"
              ry="9"
              fill={BULB_COLOURS[i() % BULB_COLOURS.length]}
              style={{ "animation-delay": `${(i() % 5) * 0.35}s` }}
            />
          )}
        </Index>
      </svg>
      <For each={SNOW}>
        {(f) => (
          <i
            class="xm-flake"
            style={{
              left: `${f.left}%`,
              "--size": `${0.25 + f.size * 0.55}rem`,
              "--time": `${9 + f.drift * 9}s`,
              "--drift": `${(f.drift - 0.5) * 8}rem`,
              "animation-delay": `${-f.delay * 18}s`,
            }}
          />
        )}
      </For>
    </>
  );
}

function Egg(props: { x: number; colour: string; band: string; tilt: number }) {
  return (
    <g transform={`translate(${props.x} 0) rotate(${props.tilt} 30 70)`}>
      <path d="M30 4C14 4 4 34 4 52c0 16 12 26 26 26s26-10 26-26C56 34 46 4 30 4z" fill={props.colour} />
      <path d="M6 44c8-6 16 6 24 0s16 6 24 0" fill="none" stroke={props.band} stroke-width="5" stroke-linecap="round" />
    </g>
  );
}

function Easter() {
  return (
    <>
      <svg class="ea-eggs" viewBox="0 0 200 84" aria-hidden="true">
        <Egg x={0} colour="#c9b5ff" band="#ff9ecb" tilt={-12} />
        <Egg x={52} colour="#9fe3c8" band="#ffd36b" tilt={6} />
        <Egg x={110} colour="#ffc2dc" band="#8fd0ff" tilt={-4} />
        <path d="M0 80c40-10 80-10 200-4v8H0z" fill="#9ad38a" opacity="0.9" />
      </svg>
      <For each={PETALS}>
        {(p) => (
          <i
            class="ea-petal"
            style={{
              left: `${p.left}%`,
              "--size": `${0.7 + p.size * 0.6}rem`,
              "--time": `${14 + p.drift * 10}s`,
              "--drift": `${(p.drift - 0.5) * 14}rem`,
              "animation-delay": `${-p.delay * 24}s`,
            }}
          />
        )}
      </For>
    </>
  );
}

function Valentine() {
  return (
    <For each={HEARTS}>
      {(h) => (
        <svg
          class="vl-heart"
          viewBox="0 0 32 30"
          style={{
            left: `${h.left}%`,
            "--size": `${1.2 + h.size * 1.6}rem`,
            "--time": `${16 + h.drift * 12}s`,
            "animation-delay": `${-h.delay * 28}s`,
          }}
        >
          <path d="M16 29S2 20 2 10a7 7 0 0 1 14-2 7 7 0 0 1 14 2c0 10-14 19-14 19z" fill="currentColor" />
        </svg>
      )}
    </For>
  );
}

function Cyberpunk() {
  return (
    <>
      <div class="cp-scan" />
      <div class="cp-horizon" />
    </>
  );
}

export function ThemeDecor() {
  return (
    <Show when={!nowPlaying() && ["christmas", "easter", "valentine", "cyberpunk"].includes(theme())}>
      <div class={`decor-layer decor-${theme()}`} aria-hidden="true">
        <Show when={theme() === "christmas"}>
          <Christmas />
        </Show>
        <Show when={theme() === "easter"}>
          <Easter />
        </Show>
        <Show when={theme() === "valentine"}>
          <Valentine />
        </Show>
        <Show when={theme() === "cyberpunk"}>
          <Cyberpunk />
        </Show>
      </div>
    </Show>
  );
}
