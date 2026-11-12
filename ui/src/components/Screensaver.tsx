// Over everything when the TV is left alone: the dimmed screen, then the screensaver. Moving
// themes are drawn on a canvas; pictures (landscapes, art, the household's photos) cross-fade
// with a slow pan. A small clock moves round the corners so nothing sits still for long.

import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { binNotice, describeWeather, formatTemp, greeting, isNightHour, visibleItems, weatherHeadline, whenLabel, shuffleThemes, type ArtItem, type ScreensaverPhoto, type ScreensaverThemeId } from "@ultimatetv/shared";
import { hub } from "../api";
import { family, familyViewer, loadFamily } from "../family";
import { idleMode, screensaverConfig } from "../idle";
import { activeMusic, spotify, webApp } from "../music";
import { radioLine, radioSettings } from "../radio";
import { artwork, landscape, svgUrl } from "../screensavers/pictures";
import { SCENES } from "../screensavers/scenes";
import { appName, isKids, now, reducedMotion } from "../store";
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
    <div class="saver-slides" classList={{ "no-drift": !screensaverConfig().drift || reducedMotion() }} style={{ "--slide-s": `${props.seconds + 3}s`, "--fade-s": `${screensaverConfig().fadeSeconds}s` }}>
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

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const artUrl = (a: ArtItem) => `/api/art/image/${a.id}`;

/**
 * Art mode: one painting at a time, as large as it goes without being stretched, on black, with an
 * optional matte and a museum card. Paintings come from the Hub (already sized for the TV), the
 * next is loaded before the fade starts, and the card fades away after a while so nothing stays
 * lit in one place.
 */
function Gallery(props: { empty: () => void }) {
  const c = screensaverConfig;
  const [items] = createResource(() => hub.artItems(isKids()).then((r) => r.items).catch(() => [] as ArtItem[]));
  const [slides, setSlides] = createSignal<{ key: number; art: ArtItem }[]>([]);
  const [card, setCard] = createSignal(true);
  let order: ArtItem[] = [];
  let i = 0;
  let key = 0;
  let timer: number | undefined;
  let cardTimer: number | undefined;
  const pick = (): ArtItem | undefined => {
    if (i >= order.length) {
      const all = items() ?? [];
      // Shuffle again each lap, without repeating the painting just shown.
      const last = order[order.length - 1];
      order = c().artOrder === "ordered" ? all : shuffled(all);
      if (order.length > 1 && order[0] === last) order = [...order.slice(1), order[0]!];
      i = 0;
    }
    return order[i++];
  };
  const peek = () => order[i];
  const advance = () => {
    window.clearTimeout(timer);
    window.clearTimeout(cardTimer);
    const art = pick();
    if (!art) return;
    setSlides((s) => [...s.slice(-1), { key: ++key, art }]);
    setCard(true);
    // The card stays up for a while, then goes; a long-held painting is just the painting.
    cardTimer = window.setTimeout(() => setCard(false), Math.min(30_000, c().artSeconds * 500));
    timer = window.setTimeout(advance, c().artSeconds * 1000);
    // Fetch the next while this one is showing, so the fade never waits.
    const next = peek();
    if (next) new Image().src = artUrl(next);
  };
  createEffect(() => {
    const list = items();
    if (list === undefined) return;
    if (list.length === 0) props.empty();
    else if (slides().length === 0) advance();
  });
  onCleanup(() => {
    window.clearTimeout(timer);
    window.clearTimeout(cardTimer);
  });
  const top = () => slides()[slides().length - 1]?.key;
  return (
    <div class="gallery" style={{ "--fade-s": `${c().fadeSeconds}s`, "--art-bright": String(c().artBrightness / 100) }}>
      <For each={slides()}>
        {(s) => (
          <div class={`gallery-slide frame-${c().artFrame}`} classList={{ shown: s.key === top() }}>
            <div class="gallery-matte">
              <img src={artUrl(s.art)} alt={s.art.title} onError={advance} />
            </div>
            <Show when={c().artCaption}>
              <div class="gallery-card" classList={{ hide: !card() }}>
                <div class="gallery-title">{s.art.title}</div>
                <div class="gallery-artist">{s.art.artist}</div>
                <Show when={s.art.date}>
                  <div class="gallery-date">{s.art.date}</div>
                </Show>
                <div class="gallery-credit">{{ aic: "Art Institute of Chicago", met: "The Metropolitan Museum of Art", cma: "Cleveland Museum of Art" }[s.art.source]} · Public domain</div>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * "Today": the family board as an idle screen. A big clock and the weather on the left, what's on
 * (the next five things), bin day and birthdays on the right. It nudges itself round every minute
 * so nothing stays lit in one place, and re-reads the Hub now and then so it is never stale.
 * A Guest, or a house with nothing set up, gets the fallback instead.
 */
function Today(props: { empty: () => void }) {
  const [spot, setSpot] = createSignal(0);
  const t = window.setInterval(() => setSpot((s) => (s + 1) % 4), 60_000);
  const reload = window.setInterval(() => void loadFamily(), 5 * 60_000);
  onCleanup(() => {
    window.clearInterval(t);
    window.clearInterval(reload);
  });
  onMount(() => void loadFamily());
  createEffect(() => {
    const f = family();
    if (f && (!f.configured || familyViewer() === "guest")) props.empty();
  });
  const c = screensaverConfig;
  const items = () => visibleItems(family()?.items ?? [], now(), familyViewer(), { days: 7, limit: 5 });
  const bin = () => binNotice(family()?.items ?? [], now(), 17);
  const time = () => new Date(now()).toLocaleTimeString(c().clock12 ? "en-US" : "en-GB", { hour: c().clock12 ? "numeric" : "2-digit", minute: "2-digit", hour12: c().clock12 });
  return (
    <div class="saver-today">
      <div class={`today-board spot-${spot()}`}>
        <div>
          <div class="today-greeting">{greeting(now())}</div>
          <div class="today-time">{time()}</div>
          <div class="today-date">{new Date(now()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
          <Show when={weather()?.report}>
            {(r) => (
              <div class="today-weather">
                <WeatherIcon code={r().now.code} isDay={r().now.isDay} />
                <div>
                  {formatTemp(r().now.tempC, weather()!.settings.temperature)} {describeWeather(r().now.code, r().now.isDay).label}
                  <small>{weatherHeadline(r(), now(), weather()!.settings.wind)}</small>
                </div>
              </div>
            )}
          </Show>
          <Show when={bin()}>
            <div class="today-bin">{bin()}</div>
          </Show>
        </div>
        <Show when={items().length} fallback={<div class="today-empty">Nothing planned. Enjoy the day.</div>}>
          <ul class="today-list">
            <For each={items()}>
              {(i) => (
                <li class={`family-item kind-${i.kind}`}>
                  <span class="family-when">{whenLabel(i, now(), c().clock12)}</span>
                  <span class="family-title">{i.title}</span>
                  <Show when={i.detail}>
                    <small>{i.detail}</small>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
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
      <Match when={props.id === "gallery"}>
        <Gallery empty={props.fallback} />
      </Match>
      <Match when={props.id === "today"}>
        <Today empty={props.fallback} />
      </Match>
    </Switch>
  );
}

function Clock() {
  const [spot, setSpot] = createSignal(0);
  const t = window.setInterval(() => setSpot((s) => (s + 1) % 4), 60_000);
  onCleanup(() => window.clearInterval(t));
  const time = () => new Date(now()).toLocaleTimeString(screensaverConfig().clock12 ? "en-US" : "en-GB", { hour: screensaverConfig().clock12 ? "numeric" : "2-digit", minute: "2-digit", hour12: screensaverConfig().clock12 });
  const date = () => new Date(now()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const song = () => {
    const which = activeMusic();
    // Settings › Radio and podcasts can leave the station off the clock.
    if (which === "radio") return radioSettings().onScreensaver ? radioLine() : "";
    if (which === "spotify") {
      const tr = spotify().track;
      return tr && spotify().status === "playing" ? `${tr.name} · ${tr.artists.join(", ")}` : "";
    }
    const np = webApp().nowPlaying;
    return which === "deezer" && np?.playing ? `${np.title}${np.artist ? ` · ${np.artist}` : ""}` : "";
  };
  return (
    <div class={`saver-clock spot-${spot()} size-${screensaverConfig().clockSize}`}>
      <div class="saver-time">{time()}</div>
      <Show when={screensaverConfig().showDate}>
        <div class="saver-date">{date()}</div>
      </Show>
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
  const [galleryFailed, setGalleryFailed] = createSignal(false);
  const [todayFailed, setTodayFailed] = createSignal(false);
  // Shuffle only includes the gallery once the Hub has paintings for it.
  const [hasArt] = createResource(() => hub.art().then((a) => a.cached > 0).catch(() => false));
  const choices = () => shuffleThemes(new Date().getMonth() + 1, Boolean(c().photosPath) && !photosFailed(), Boolean(hasArt()) && !galleryFailed());
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
    if (t === "gallery" && galleryFailed()) return "landscapes";
    if (t === "today" && todayFailed()) return "landscapes";
    return t;
  });
  const fallback = () => {
    if (theme() === "gallery") setGalleryFailed(true);
    else if (theme() === "today") setTodayFailed(true);
    else setPhotosFailed(true);
    if (c().theme === "shuffle") setShuffled(choose());
  };
  // Night hours (Settings › Screensaver): carry on, a good deal dimmer, or black.
  const night = () => c().night !== "none" && isNightHour(new Date(now()).getHours(), c().nightFromHour, c().nightToHour);
  return (
    <div class="screensaver" classList={{ "night-dim": night() && c().night === "dim" }}>
      <Show when={theme() !== "black" && !(night() && c().night === "black")}>
        {/* Keyed, so a new theme starts afresh. */}
        <Show when={theme()} keyed>
          {(id) => <Theme id={id} fallback={fallback} />}
        </Show>
        <Show when={theme() === "today" ? false : theme() === "gallery" ? c().artClock : c().clock}>
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
