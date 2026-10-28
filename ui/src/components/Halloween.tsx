// The Halloween theme's decorations, drawn over the app (never over the video while something is
// playing, so a film is never covered in bats). The colours themselves come from styles.css; this
// is the bits that move: cobwebs in the corners, bats crossing now and then, and a slow fog.
//
// Everything here is drawn rather than loaded, so the theme adds nothing to download.

import { createSignal, For, onCleanup, Show } from "solid-js";
import { nowPlaying } from "../player";
import { isKids, theme } from "../store";

/** A bat, every half a minute or so, crossing the screen at a height of its own. */
interface Bat {
  id: number;
  top: number;
  seconds: number;
  scale: number;
  rightToLeft: boolean;
}

export function Cobweb(props: { corner: "left" | "right" }) {
  return (
    <svg class={`cobweb cobweb-${props.corner}`} viewBox="0 0 120 120" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <path d="M0 0 L120 0 M0 0 L0 120 M0 0 L110 110 M0 0 L60 118 M0 0 L118 60" />
        <path d="M30 0 A30 30 0 0 1 0 30 M55 0 A55 55 0 0 1 0 55 M82 0 A82 82 0 0 1 0 82 M112 0 A112 112 0 0 1 0 112" />
      </g>
    </svg>
  );
}

/** A ghost that drifts up the screen and fades: the easter eggs' reward. */
export function Ghost(props: { from: number }) {
  return (
    <svg class="egg-ghost" style={{ "--from": `${props.from}%` }} viewBox="0 0 100 130" aria-hidden="true">
      <path d="M50 6c22 0 36 17 36 40v72c0 5-6 7-9 3l-7-9-8 10c-3 4-8 4-11 0l-7-9-8 9c-3 4-9 2-9-3V46C27 23 28 6 50 6z" fill="#f4f7ff" opacity="0.92" />
      <circle cx="38" cy="46" r="6" fill="#1b1030" />
      <circle cx="62" cy="46" r="6" fill="#1b1030" />
      <ellipse cx="50" cy="66" rx="7" ry="9" fill="#1b1030" opacity="0.8" />
    </svg>
  );
}

export function Halloween() {
  const [bats, setBats] = createSignal<Bat[]>([]);
  let next = 1;
  // Bats only come out on the menus: nobody wants one flapping across the film.
  const on = () => theme() === "halloween" && !nowPlaying();

  const timer = window.setInterval(() => {
    if (!on() || bats().length > 2) return;
    // Roughly one bat a minute, at a random height, speed and size.
    if (Math.random() > 0.35) return;
    const bat: Bat = {
      id: next++,
      top: 8 + Math.random() * 55,
      seconds: 9 + Math.random() * 7,
      scale: 0.6 + Math.random() * 0.7,
      rightToLeft: Math.random() < 0.5,
    };
    setBats((list) => [...list, bat]);
    window.setTimeout(() => setBats((list) => list.filter((b) => b.id !== bat.id)), bat.seconds * 1000 + 500);
  }, 20_000);
  onCleanup(() => window.clearInterval(timer));

  return (
    <Show when={theme() === "halloween" && !isKids()}>
      <div class="hw-layer" aria-hidden="true">
        <Show when={!nowPlaying()}>
          <Cobweb corner="left" />
          <Cobweb corner="right" />
          <div class="hw-fog" />
        </Show>
        <For each={bats()}>
          {(b) => (
            <svg
              class="hw-bat"
              classList={{ back: b.rightToLeft }}
              style={{ "--top": `${b.top}%`, "--time": `${b.seconds}s`, "--scale": String(b.scale) }}
              viewBox="0 0 120 60"
            >
              <path
                class="hw-bat-wings"
                d="M60 22c6-10 14-16 24-18-4 6-3 12 2 15 7-4 16-4 24 2-10 0-16 5-19 13-7-6-15-7-22-3-3 2-6 2-9 0-7-4-15-3-22 3-3-8-9-13-19-13 8-6 17-6 24-2 5-3 6-9 2-15 10 2 18 8 24 18z"
                fill="currentColor"
              />
            </svg>
          )}
        </For>
      </div>
    </Show>
  );
}
