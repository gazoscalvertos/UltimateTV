// Home: a hero for what you were watching or what's new, then your play queue, your watchlist and
// rails (live now, continue watching, recordings, films on TV tonight, trending, recently added).

import { createResource, For, onCleanup, Show } from "solid-js";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { QueueRow } from "../components/QueueRow";
import { RailRow } from "../components/Rail";
import { WatchlistRow } from "../components/WatchlistRow";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { play } from "../player";
import { nav } from "../store";

export function Home() {
  const [home, { refetch }] = createResource(() => hub.home());
  // Refreshed only when a recording finishes, so the rails don't shift under the remote.
  onCleanup(onHubEvent((e) => (e.type === "recording.finished" ? void refetch() : undefined)));

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
          <WatchlistRow />
          <For each={home()!.rails}>{(rail) => <RailRow rail={rail} />}</For>
        </Show>
      </div>
    </div>
  );
}
