// Home: a hero for what you were watching or what's new, then your play queue and rails (live
// now, continue watching, recordings, films on TV tonight, trending, recently added).

import { createResource, For, onCleanup, Show } from "solid-js";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { QueueRow } from "../components/QueueRow";
import { RailRow } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { HOME_KEYS, useHints } from "../hints";
import { useKeys } from "../keys";
import { play } from "../player";
import { isKids, nav } from "../store";
import { castSettings } from "../cast";

export function Home() {
  const [home, { refetch }] = createResource(() => hub.home());
  // Refreshed only when a recording finishes, so the rails don't shift under the remote.
  onCleanup(onHubEvent((e) => (e.type === "recording.finished" || e.type === "watchlist.changed" ? void refetch() : undefined)));

  // The colour keys are shortcuts on Home, as on Sky.
  const castOk = () => !isKids() || castSettings().gamesForKids;
  useHints(() => HOME_KEYS.filter((h) => h.key !== "blue" || castOk()));
  useKeys((a) => {
    if (a === "red") nav.push({ name: "planner" });
    else if (a === "green") nav.push({ name: "guide" });
    else if (a === "yellow") nav.push({ name: "search" });
    else if (a === "blue" && castOk()) nav.push({ name: "cast" });
    else return false;
    return true;
  });

  return (
    <div class="screen home" data-layer>
      <Show when={home()?.hero}>
        {(hero) => (
          <div class="hero-bg">
            <img src={hero().backdrop} alt="" />
          </div>
        )}
      </Show>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <Show when={home()} fallback={<div class="spinner" />}>
          <Show when={home()!.hero}>
            {(hero) => (
              <section class="hero" data-row>
                <Show when={hero().logo} fallback={<h1 class="hero-title">{hero().name}</h1>}>
                  <img class="hero-logo" src={hero().logo} alt={hero().name} />
                </Show>
                <p class="hero-meta">{hero().subtitle ?? hero().year}</p>
                <Show when={hero().overview}>
                  <p class="hero-overview">{hero().overview}</p>
                </Show>
                <div class="hero-actions" data-focus-group>
                  <button
                    class="btn btn-primary btn-large"
                    data-focus
                    data-autofocus
                    onClick={() => (hero().action === "resume" ? void play({ kind: "title", id: hero().id }, { title: hero() }) : nav.push({ name: "details", id: hero().id }))}
                  >
                    <Icon name="play" />
                    {hero().action === "resume" ? "Resume" : "Watch"}
                  </button>
                  <button class="btn btn-large" data-focus onClick={() => nav.push({ name: "details", id: hero().id })}>
                    <Icon name="info" />
                    More info
                  </button>
                </div>
              </section>
            )}
          </Show>
          <QueueRow />
          <For each={home()!.rails}>{(rail) => <RailRow rail={rail} />}</For>
        </Show>
      </div>
    </div>
  );
}
