// Seasonal projections: something friendly drifts across the picture for a holiday, now and then,
// like the window projections people put up at Christmas and Halloween. An uploaded or community
// clip moves the way it was tagged (across the top, along the bottom, falling, rising, or still in a
// corner); with none, the TV draws its own (a sleigh, snow, a hopping bunny, fireworks…).
//
// The Hub keeps the settings and the clips (hub/src/projections.ts); the TV decides when one comes,
// as only it knows what's playing. They're gentle, so the Kids profile gets them too unless turned off.
// The season's built clips (projected clips from packs, see JumpScare.tsx) come up here too, though
// never on Kids.

import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { DEFAULT_PROJECTION_SETTINGS, projectionFrom, type DrawnProjection, type Projection, type ProjectionState } from "@ultimatetv/shared";
import { hub } from "../api";
import { builtClipCount, showBuiltClip } from "./JumpScare";
import { onHubEvent } from "../events";
import { addOverlayKeys } from "../keys";
import { isLive, playerState } from "../player";
import { isKids } from "../store";

const TICK_MS = 60_000;

/** A seeded spread of positions and delays, so a drawn scene isn't the same every time. */
const spread = (n: number) => Array.from({ length: n }, (_, i) => ({ i, x: Math.random() * 100, d: Math.random(), s: 0.6 + Math.random() * 0.8, hue: Math.floor(Math.random() * 360) }));

function Reindeer(props: { x: number }) {
  return (
    <g transform={`translate(${props.x} 0)`}>
      <ellipse cx="0" cy="30" rx="22" ry="9" />
      <path d="M18 26 L28 12 L34 14 L26 28 Z" />
      <path d="M28 12 l-4 -10 M28 12 l4 -9 M30 6 l6 -4 M26 6 l-6 -3" stroke-width="2.5" fill="none" />
      <path class="legs" d="M-14 36 l-6 14 M-6 36 l2 14 M8 36 l-4 14 M16 36 l6 14" stroke-width="3" fill="none" />
    </g>
  );
}

function Drawn(props: { kind: DrawnProjection; seconds: number }) {
  const style = { "--dur": `${props.seconds}s` };
  return (
    <div class={`proj-drawn proj-${props.kind}`} style={style}>
      <Switch>
        <Match when={props.kind === "sleigh"}>
          <svg class="proj-mover across-top" viewBox="0 0 360 80" fill="currentColor" stroke="currentColor">
            <Reindeer x={40} />
            <Reindeer x={110} />
            <Reindeer x={180} />
            <path d="M200 30 C230 34 240 40 250 44" stroke-width="2" fill="none" />
            <path d="M250 30 h70 l10 -18 h8 l-8 34 h-80 z" />
            <path d="M240 58 h100 c8 0 12 -6 12 -12" stroke-width="4" fill="none" />
            <circle cx="300" cy="20" r="10" class="santa" />
            <path d="M292 12 l10 -14 l8 12 z" class="santa" />
            <rect x="262" y="14" width="24" height="18" rx="3" class="sack" />
          </svg>
          <div class="proj-trail across-top" />
        </Match>
        <Match when={props.kind === "snow" || props.kind === "confetti"}>
          <For each={spread(props.kind === "snow" ? 70 : 90)}>
            {(f) => <i class="proj-flake" style={{ left: `${f.x}%`, "animation-delay": `${f.d * props.seconds * 0.6}s`, "--size": f.s, "--hue": f.hue }} />}
          </For>
        </Match>
        <Match when={props.kind === "presents"}>
          <For each={spread(9)}>
            {(f) => (
              <svg class="proj-gift" style={{ left: `${5 + f.x * 0.9}%`, "animation-delay": `${f.d * 2}s`, "--hue": f.hue }} viewBox="0 0 40 40">
                <rect x="4" y="14" width="32" height="24" rx="3" />
                <rect x="2" y="9" width="36" height="8" rx="2" />
                <path d="M20 9v29M12 9c-4-6 4-8 8 0c4-8 12-6 8 0" class="ribbon" />
              </svg>
            )}
          </For>
        </Match>
        <Match when={props.kind === "fireworks" || props.kind === "rocket"}>
          <For each={spread(props.kind === "rocket" ? 3 : 7)}>
            {(b) => (
              <div class="proj-burst" style={{ left: `${10 + b.x * 0.8}%`, top: `${12 + b.d * 40}%`, "animation-delay": `${b.i * (props.seconds / 9)}s`, "--hue": b.hue }}>
                <Show when={props.kind === "rocket"}>
                  <i class="proj-rocket" />
                </Show>
                <For each={Array.from({ length: 18 })}>{(_, k) => <i style={{ "--a": `${k() * 20}deg` }} />}</For>
              </div>
            )}
          </For>
        </Match>
        <Match when={props.kind === "hearts" || props.kind === "balloons"}>
          <For each={spread(16)}>
            {(h) => <i class={props.kind === "hearts" ? "proj-heart" : "proj-balloon"} style={{ left: `${h.x}%`, "animation-delay": `${h.d * props.seconds * 0.5}s`, "--size": h.s, "--hue": h.hue }} />}
          </For>
        </Match>
        <Match when={props.kind === "bunny"}>
          <div class="proj-mover across-bottom">
            <svg class="proj-hop" viewBox="0 0 120 110" fill="currentColor">
              <ellipse cx="55" cy="72" rx="34" ry="24" />
              <circle cx="88" cy="50" r="16" />
              <ellipse cx="84" cy="18" rx="6" ry="20" transform="rotate(-12 84 18)" />
              <ellipse cx="96" cy="20" rx="6" ry="20" transform="rotate(14 96 20)" />
              <circle cx="22" cy="66" r="9" class="tail" />
              <ellipse cx="78" cy="94" rx="14" ry="6" />
              <circle cx="94" cy="47" r="2.5" class="eye" />
            </svg>
          </div>
        </Match>
        <Match when={props.kind === "eggs"}>
          <For each={spread(8)}>
            {(e) => <i class="proj-egg" style={{ left: `${4 + e.x * 0.9}%`, "animation-delay": `${e.d * 2.5}s`, "--hue": e.hue }} />}
          </For>
        </Match>
        <Match when={props.kind === "ghost"}>
          <div class="proj-mover across-top proj-float">
            <svg viewBox="0 0 100 120" fill="currentColor">
              <path d="M10 60 C10 20 90 20 90 60 V110 l-13 -10 l-13 10 l-13 -10 l-13 10 l-13 -10 l-15 10 Z" />
              <circle cx="36" cy="55" r="7" class="eye" />
              <circle cx="64" cy="55" r="7" class="eye" />
              <ellipse cx="50" cy="78" rx="7" ry="9" class="eye" />
            </svg>
          </div>
        </Match>
        <Match when={props.kind === "bats"}>
          <For each={spread(6)}>
            {(b) => (
              <svg class="proj-bat" style={{ top: `${6 + b.x * 0.3}%`, "animation-delay": `${b.d * 3}s`, "--size": b.s }} viewBox="0 0 100 40" fill="currentColor">
                <path class="wing" d="M50 20 C40 5 20 0 0 10 C10 14 14 22 12 28 C20 22 30 26 34 32 C40 26 44 24 50 26 C56 24 60 26 66 32 C70 26 80 22 88 28 C86 22 90 14 100 10 C80 0 60 5 50 20 Z" />
              </svg>
            )}
          </For>
        </Match>
      </Switch>
    </div>
  );
}

export function ProjectionLayer() {
  const [state, setState] = createSignal<ProjectionState>({ settings: DEFAULT_PROJECTION_SETTINGS, season: null, clips: [] });
  const [showing, setShowing] = createSignal<Projection | null>(null);
  let lastAt = Date.now();
  let hideTimer: number | undefined;

  const load = () => void hub.projections().then(setState, () => undefined);
  const hide = () => {
    window.clearTimeout(hideTimer);
    setShowing(null);
  };
  const show = (p: Projection) => {
    if (document.hidden || (isKids() && !state().settings.kids && !p.byHand)) return;
    lastAt = Date.now();
    setShowing(p);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, Math.max(3, p.seconds) * 1000 + 500);
  };

  const dueNow = (): boolean => {
    const st = state();
    const s = st.settings;
    if (!s.enabled || !st.season || showing() || document.hidden) return false;
    if (isKids() && !s.kids) return false;
    if (Date.now() - lastAt < s.minGapMinutes * 60_000) return false;
    const playing = playerState().status === "playing";
    if (s.whilePlayingOnly && !playing) return false;
    if (playing && isLive() && !s.duringLive) return false;
    return Math.random() * 100 < s.chancePercent;
  };

  onMount(load);
  // The season changes at midnight on a TV that's never reloaded.
  const reload = window.setInterval(load, 60 * 60_000);
  const off = onHubEvent((e) => {
    if (e.type === "projection") show(e.projection);
    if (e.type === "projections.changed" || e.type === "hello") load();
  });
  const tick = window.setInterval(() => {
    if (!dueNow()) return;
    // The season's built clips (from packs, or built on the phone) take their turn with the rest.
    const season = state().season;
    const built = season ? builtClipCount(season) : 0;
    const others = state().clips.filter((c) => c.kind !== "audio" && (c.season === season || c.season === "any")).length + (state().settings.drawn ? 2 : 0);
    if (season && built && Math.random() < built / (built + Math.max(1, others)) && showBuiltClip(season)) {
      lastAt = Date.now();
      return;
    }
    const p = projectionFrom(state(), {}, false);
    if (p) show(p);
  }, TICK_MS);
  const offKeys = addOverlayKeys((action) => {
    if (!showing() || action !== "back") return false;
    hide();
    return true;
  });
  onCleanup(() => {
    off();
    offKeys();
    window.clearInterval(tick);
    window.clearInterval(reload);
    window.clearTimeout(hideTimer);
  });

  return (
    <Show when={showing()}>
      {(p) => (
        <div class="projection-layer" aria-hidden="true">
          <Show when={p().clip} fallback={<Drawn kind={p().drawn!} seconds={p().seconds} />}>
            {(clip) => (
              <div class={`proj-mover proj-clip ${clip().motion}`} style={{ "--dur": `${p().seconds}s` }}>
                <Show when={clip().kind === "video"} fallback={<img src={clip().url} alt="" />}>
                  <video
                    src={clip().url}
                    autoplay
                    playsinline
                    ref={(v) => {
                      v.volume = p().volume;
                      v.muted = p().volume === 0;
                    }}
                  />
                </Show>
              </div>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
