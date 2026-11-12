// The menu along the top of every main screen, with the clock and who's watching.

import { For, Show } from "solid-js";
import { clockTime, formatTemp } from "@ultimatetv/shared";
import type { FeatureId } from "@ultimatetv/shared";
import { featureOn } from "../features";
import { visibleDownloads } from "../downloads";
import { activeMusic, musicLine, musicPlayPause, spotify, webApp } from "../music";
import { playerState } from "../player";
import { sleep } from "../sleep";
import { appName, isEasy, isKids, nav, now, profile, type Route } from "../store";
import { weather } from "../weather";
import { syncGroup } from "../watching";
import { Icon } from "./Icon";
import { WeatherIcon } from "./WeatherIcon";

type Tab = { label: string; route: Route; match: Route["name"]; when?: () => boolean; feature?: FeatureId };

const TABS: Tab[] = [
  { label: "Home", route: { name: "home" }, match: "home" },
  { label: "TV Guide", route: { name: "guide" }, match: "guide", feature: "live" },
  { label: "Films", route: { name: "browse", kind: "movie" }, match: "browse", feature: "films" },
  { label: "TV Shows", route: { name: "browse", kind: "series" }, match: "browse", feature: "shows" },
  // Kids get radio and podcasts here, but not the grown-ups' Spotify account (or its explicit
  // songs), which the Music screen leaves out for them.
  { label: "Music", route: { name: "music" }, match: "music", feature: "music" },
  { label: "Recordings", route: { name: "planner" }, match: "planner", feature: "recordings" },
  // Once something is on the box's own disk (for a trip, say).
  { label: "Downloaded", route: { name: "downloads" }, match: "downloads", when: () => visibleDownloads().length > 0, feature: "downloads" },
  // Kids have it too: the quiz is on it, and the games on it stay behind the grown-ups' switch.
  { label: "Cast & games", route: { name: "cast" }, match: "cast", feature: "cast" },
];

/** Easy mode (#229) keeps the menu to the short list: where the four tiles go, and Home. */
const EASY_TABS = new Set(["Home", "TV Guide", "Films", "TV Shows", "Recordings"]);

function isActive(t: Tab): boolean {
  const cur = nav.current();
  // The quiz is part of Cast & games.
  if (t.match !== cur.name && !(t.match === "cast" && cur.name === "quiz")) return false;
  return cur.name !== "browse" || (t.route.name === "browse" && t.route.kind === cur.kind);
}

/** Shown while music plays from another screen, so it can be paused without leaving the one you're on. */
function MusicChip() {
  const line = () => musicLine();
  const paused = () => {
    const which = activeMusic();
    if (which === "radio") return playerState().status === "paused";
    if (which === "spotify") return spotify().status !== "playing";
    const np = webApp().nowPlaying;
    return !np?.playing;
  };
  const toggle = () => void musicPlayPause().catch(() => undefined);
  return (
    <Show when={line()}>
      <div class="music-chip" data-focus-group>
        <button class="music-chip-key" data-focus aria-label={paused() ? "Play the music" : "Pause the music"} onClick={toggle}>
          <Icon name={paused() ? "play" : "pause"} />
        </button>
        <button class="music-chip-name" data-focus aria-label={`What's playing: ${line()}`} onClick={() => nav.current().name !== "music" && nav.replace({ name: "music" })}>
          {line()}
        </button>
      </div>
    </Show>
  );
}

export function TopBar() {
  return (
    <header class="topbar" data-focus-group data-focus-only="up">
      <div class="brand">
        <span class="brand-mark">{appName().slice(0, 1).toUpperCase()}</span>
        <span class="brand-name">{appName()}</span>
      </div>
      <nav class="tabs">
        <For each={TABS.filter((t) => (!t.when || t.when()) && (!t.feature || featureOn(t.feature)) && (!isEasy() || EASY_TABS.has(t.label)))}>
          {(t) => (
            <button class="tab" classList={{ active: isActive(t) }} data-focus data-tab onClick={() => !isActive(t) && nav.replace(t.route)}>
              {t.label}
            </button>
          )}
        </For>
        <Show when={featureOn("search")}>
        <button class="tab tab-icon" classList={{ active: nav.current().name === "search" }} data-focus aria-label="Search" onClick={() => nav.current().name !== "search" && nav.replace({ name: "search" })}>
          <Icon name="search" />
        </button>
        </Show>
        <Show when={!isKids() && !isEasy()}>
          <button class="tab" classList={{ active: nav.current().name === "settings" }} data-focus onClick={() => nav.current().name !== "settings" && nav.replace({ name: "settings" })}>
            Settings
          </button>
        </Show>
      </nav>
      <div class="topbar-right">
        <Show when={nav.current().name !== "music"}>
          <MusicChip />
        </Show>
        {/* In Sync play: a small chip that opens Watching elsewhere (Home has a row of the rest). */}
        <Show when={nav.current().name !== "elsewhere" && syncGroup()}>
          <button class="tab elsewhere-chip" data-focus aria-label="In Sync play: watching elsewhere" onClick={() => nav.push({ name: "elsewhere" })}>
            <Icon name="screens" />
            Sync
          </button>
        </Show>
        <Show when={!isEasy() && featureOn("weather") && weather()?.settings.inTopBar ? weather()!.report : undefined}>
          {(r) => (
            <button class="tab weather-chip" classList={{ active: nav.current().name === "weather" }} data-focus aria-label="The weather" onClick={() => nav.current().name !== "weather" && nav.push({ name: "weather" })}>
              <WeatherIcon code={r().now.code} isDay={r().now.isDay} />
              {formatTemp(r().now.tempC, weather()!.settings.temperature)}
            </button>
          )}
        </Show>
        <Show when={sleep().at}>
          <span class="sleep-badge" title={`Sleep timer: ${sleep().label}`}>
            <Icon name="moon" />
            {clockTime(sleep().at!)}
          </span>
        </Show>
        <span class="clock">{clockTime(now())}</span>
        <Show when={profile()}>
          {(p) => (
            <button class="avatar avatar-small" style={{ "--c": p().colour }} data-focus aria-label={`Switch profile (${p().name})`} onClick={() => nav.reset({ name: "profiles" })}>
              {p().name.slice(0, 1)}
            </button>
          )}
        </Show>
      </div>
    </header>
  );
}
