// Easy mode Home (#229): four big tiles and Continue watching, nothing else. For people who just
// want to watch: every screen is one or two presses from here, and there is no menu to get lost in.

import { createEffect, createResource, For, onCleanup, Show } from "solid-js";
import { hub } from "../api";
import { choose } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { RailRow } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { featureOn } from "../features";
import { useHints } from "../hints";
import { useKeys } from "../keys";
import { current } from "../focus";
import { markHome } from "../perf";
import { allowsSection, nav } from "../store";

interface Tile {
  label: string;
  hint: string;
  icon: string;
  show: () => boolean;
  go: () => void | Promise<void>;
}

const on = (...ids: Parameters<typeof featureOn>[0][]) => ids.some((id) => featureOn(id) && allowsSection(id));

/** Films and TV is one tile for two screens: one more press picks which, unless only one is on. */
async function filmsAndTv(): Promise<void> {
  const films = on("films");
  const shows = on("shows");
  if (films && !shows) return nav.push({ name: "browse", kind: "movie" });
  if (shows && !films) return nav.push({ name: "browse", kind: "series" });
  const pick = await choose<"movie" | "series">({
    title: "Films and TV",
    options: [
      { label: "Films", value: "movie", icon: "play" },
      { label: "TV shows", value: "series", icon: "series" },
    ],
  });
  if (pick) nav.push({ name: "browse", kind: pick });
}

const TILES: Tile[] = [
  { label: "Watch TV", hint: "The channels, what's on now", icon: "play", show: () => on("live"), go: () => nav.push({ name: "guide" }) },
  { label: "Films and TV", hint: "Films and series to pick from", icon: "series", show: () => on("films", "shows"), go: filmsAndTv },
  { label: "Recordings", hint: "What the box has recorded", icon: "record", show: () => on("recordings"), go: () => nav.push({ name: "planner" }) },
  { label: "Search", hint: "Find a film, show or channel", icon: "search", show: () => on("search"), go: () => nav.push({ name: "search" }) },
];

export function EasyHome() {
  const [home, { refetch }] = createResource(() => hub.home());
  createEffect(() => {
    if (!home()) return;
    let raf = 0;
    let tries = 0;
    const look = () => {
      if (current()) return markHome();
      if (++tries < 90) raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);
    onCleanup(() => cancelAnimationFrame(raf));
  });
  onCleanup(onHubEvent((e) => (e.type === "recording.finished" || e.type === "progress.changed" ? void refetch() : undefined)));

  // The colour keys still jump to the same places as on the full Home, minus the games.
  useHints(() => [
    { key: "red", label: "Recordings", feature: "recordings" },
    { key: "green", label: "TV guide", feature: "live" },
    { key: "yellow", label: "Search", feature: "search" },
  ]);
  useKeys((a) => {
    if (a === "red") nav.push({ name: "planner" });
    else if (a === "green") nav.push({ name: "guide" });
    else if (a === "yellow") nav.push({ name: "search" });
    else return false;
    return true;
  });

  const resume = () => home()?.rails.find((r) => r.id === "continue" && r.items.length);
  return (
    <div class="screen home easy-home" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <div class="easy-tiles" data-focus-group>
          <For each={TILES.filter((t) => t.show())}>
            {(t, i) => (
              <button class="easy-tile" data-focus data-autofocus={i() === 0 ? "" : undefined} onClick={() => void t.go()}>
                <Icon name={t.icon} />
                <span>
                  {t.label}
                  <small>{t.hint}</small>
                </span>
              </button>
            )}
          </For>
        </div>
        <Show when={home()} fallback={<div class="spinner" />}>
          <Show when={resume()}>{(rail) => <RailRow rail={rail()} />}</Show>
        </Show>
      </div>
    </div>
  );
}
