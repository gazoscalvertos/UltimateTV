// Over everything when the TV is left alone: the dimmed screen, then the screensaver. Moving
// themes are drawn on a canvas; pictures (landscapes, art, the household's photos) cross-fade
// with a slow pan. A small clock moves round the corners so nothing sits still for long.

import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { describeWeather, formatTemp, shuffleThemes, type ScreensaverPhoto, type ScreensaverThemeId } from "@ultimatetv/shared";
import { hub } from "../api";
import { idleMode, screensaverConfig } from "../idle";
import { activeMusic, spotify, webApp } from "../music";
import { artwork, landscape, svgUrl } from "../screensavers/pictures";
import { SCENES } from "../screensavers/scenes";
import { appName, now, reducedMotion } from "../store";
import { weather } from "../weather";
import { WeatherIcon } from "./WeatherIcon";

const SHUFFLE_EVERY_MS = 10 * 60_000;

function SceneCanvas(props: { id: string }) {
  let canvas!: HTMLCanvasElement;
  onMount(() => {
    // Drawn at up to 1080p and scaled to the screen: plenty for soft, moving scenes.
    const scale = Math.min(1, 1080 / window.innerHeight);
    const w = Math.round(window.innerWidth * scale);
    const h = Math.round(window.innerHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const frame = SCENES[props.id]!(ctx, w, h, { name: appName() });
    const start = performance.now();
    let last = start;
    let raf = 0;
    const tick = (at: number) => {
      // A long gap (the app hidden) shouldn't make everything jump.
      const dt = Math.min(0.1, (at - last) / 1000);
      last = at;
      frame((at - start) / 1000, dt);
      raf = requestAnimationFrame(tick);
    };
    frame(0, 0);
    // Reduce motion (Settings › Accessibility): the scene as a still picture, a few seconds in so
    // whatever drifts in has arrived.
    if (reducedMotion()) for (let t = 0.05; t <= 5; t += 0.05) frame(t, 0.05);
    else raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });
  return <canvas class="saver-canvas" ref={canvas} />;
}

interface Slide {
  key: number;
  src: string;
  kind: "image" | "video" | "photo";
  /** Where the slow pan heads. */
  pan: [number, number];
}

/** One picture after another, cross-fading. `next` gives the next one's address and kind. */
function Slideshow(props: { next: () => { src: string; kind: Slide["kind"] } | null; seconds: number }) {
  const [slides, setSlides] = createSignal<Slide[]>([]);
  let key = 0;
  let timer: number | undefined;
  const advance = () => {
    window.clearTimeout(timer);
    const n = props.next();
    if (!n) return;
    const slide: Slide = { key: ++key, ...n, pan: [Math.random() * 6 - 3, Math.random() * 4 - 2] };
    setSlides((s) => [...s.slice(-1), slide]);
    // Videos move on when they end (or after a minute and a half at most).
    timer = window.setTimeout(advance, n.kind === "video" ? 90_000 : props.seconds * 1000);
  };
  onMount(advance);
  onCleanup(() => window.clearTimeout(timer));
  const top = () => slides()[slides().length - 1]?.key;
  return (
    <div class="saver-slides" style={{ "--slide-s": `${props.seconds + 3}s` }}>
      <For each={slides()}>
        {(s) => (
          <div class="saver-slide" classList={{ shown: s.key === top() }} style={{ "--pan-x": `${s.pan[0]}%`, "--pan-y": `${s.pan[1]}%` }}>
            <Switch>
              <Match when={s.kind === "video"}>
                <video src={s.src} autoplay muted playsinline onEnded={advance} onError={advance} />
              </Match>
              <Match when={s.kind === "photo"}>
                <img class="saver-photo-bg" src={s.src} alt="" />
                <img class="saver-photo" src={s.src} alt="" onError={advance} />
              </Match>
              <Match when={s.kind === "image"}>
                <img class="saver-picture" src={s.src} alt="" />
              </Match>
            </Switch>
          </div>
        )}
      </For>
    </div>
  );
}

function Photos(props: { seconds: number; empty: () => void }) {
  const [list] = createResource(() => hub.screensaverPhotos().then((r) => r.photos).catch(() => [] as ScreensaverPhoto[]));
  let i = 0;
  createEffect(() => {
    if (list() && list()!.length === 0) props.empty();
  });
  return (
    <Show when={list()?.length}>
      <Slideshow
        seconds={props.seconds}
        next={() => {
          const all = list()!;
          const p = all[i++ % all.length]!;
          // Fetch the one after, so it's ready when the fade starts.
          const after = all[i % all.length];
          if (after?.kind === "image") new Image().src = `/api/screensaver/photos/${after.id}`;
          return { src: `/api/screensaver/photos/${p.id}`, kind: p.kind === "video" ? "video" : "photo" };
        }}
      />
    </Show>
  );
}

function Theme(props: { id: ScreensaverThemeId; fallback: () => void }) {
  const seconds = () => screensaverConfig().photoSeconds;
  let seed = Math.floor(Math.random() * 1e9);
  return (
    <Switch>
      <Match when={SCENES[props.id]}>
        <SceneCanvas id={props.id} />
      </Match>
      <Match when={props.id === "landscapes"}>
        <Slideshow seconds={seconds()} next={() => ({ src: svgUrl(landscape(seed++)), kind: "image" })} />
      </Match>
      <Match when={props.id === "art"}>
        <Slideshow seconds={seconds()} next={() => ({ src: svgUrl(artwork(seed++)), kind: "image" })} />
      </Match>
      <Match when={props.id === "photos"}>
        <Photos seconds={seconds()} empty={props.fallback} />
      </Match>
    </Switch>
  );
}

function Clock() {
  const [spot, setSpot] = createSignal(0);
  const t = window.setInterval(() => setSpot((s) => (s + 1) % 4), 60_000);
  onCleanup(() => window.clearInterval(t));
  const time = () => new Date(now()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const date = () => new Date(now()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const song = () => {
    const which = activeMusic();
    if (which === "spotify") {
      const tr = spotify().track;
      return tr && spotify().status === "playing" ? `${tr.name} · ${tr.artists.join(", ")}` : "";
    }
    const np = webApp().nowPlaying;
    return which === "deezer" && np?.playing ? `${np.title}${np.artist ? ` · ${np.artist}` : ""}` : "";
  };
  return (
    <div class={`saver-clock spot-${spot()}`}>
      <div class="saver-time">{time()}</div>
      <div class="saver-date">{date()}</div>
      <Show when={weather()?.settings.onScreensaver ? weather()!.report : undefined}>
        {(r) => (
          <div class="saver-weather">
            <WeatherIcon code={r().now.code} isDay={r().now.isDay} />
            {formatTemp(r().now.tempC, weather()!.settings.temperature)} {describeWeather(r().now.code, r().now.isDay).label}
          </div>
        )}
      </Show>
      <Show when={song()}>
        <div class="saver-song">♪ {song()}</div>
      </Show>
    </div>
  );
}

function Saver() {
  const c = screensaverConfig;
  const [photosFailed, setPhotosFailed] = createSignal(false);
  const choices = () => shuffleThemes(new Date().getMonth() + 1, Boolean(c().photosPath) && !photosFailed());
  const choose = (): ScreensaverThemeId => {
    const list = choices();
    return list[Math.floor(Math.random() * list.length)] ?? "aurora";
  };
  const [shuffled, setShuffled] = createSignal(choose());
  const timer = window.setInterval(() => c().theme === "shuffle" && setShuffled(choose()), SHUFFLE_EVERY_MS);
  onCleanup(() => window.clearInterval(timer));
  const theme = createMemo((): ScreensaverThemeId => {
    const t = c().theme;
    if (t === "shuffle") return shuffled();
    // An empty or missing photos folder: something pretty rather than nothing.
    if (t === "photos" && photosFailed()) return "landscapes";
    return t;
  });
  const fallback = () => {
    setPhotosFailed(true);
    if (c().theme === "shuffle") setShuffled(choose());
  };
  return (
    <div class="screensaver">
      <Show when={theme() !== "black"}>
        {/* Keyed, so a new theme starts afresh. */}
        <Show when={theme()} keyed>
          {(id) => <Theme id={id} fallback={fallback} />}
        </Show>
        <Show when={c().clock}>
          <Clock />
        </Show>
      </Show>
    </div>
  );
}

export function ScreensaverLayer() {
  // Restart the dim fade each time, so it eases down rather than snapping.
  const [dimmed, setDimmed] = createSignal(false);
  createEffect(
    on(idleMode, (m) => {
      if (m === "dim") requestAnimationFrame(() => setDimmed(true));
      else setDimmed(false);
    }),
  );
  return (
    <>
      <div class="dim-layer" classList={{ on: dimmed() }} style={{ "--dim-level": String(screensaverConfig().dimPercent / 100) }} />
      <Show when={idleMode() === "saver"}>
        <Saver />
      </Show>
    </>
  );
}
