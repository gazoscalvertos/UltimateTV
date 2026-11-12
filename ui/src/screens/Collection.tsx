// One collection or franchise (issue #238): its films in release order, with Play starting the
// first one not watched yet. The Hub only sends the films this profile may watch, so a Kids profile
// sees the Kids-rated ones of a franchise and never the rest.

import { createResource, For, Show } from "solid-js";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { Poster } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { play } from "../player";
import { errorToast, nav } from "../store";

const PER_ROW = 6;

export function CollectionScreen(props: { id: string }) {
  const [c] = createResource(() => props.id, (id) => hub.collection(id).catch((err) => (errorToast(err), null)));
  const rows = () => {
    const films = c()?.films ?? [];
    const out: (typeof films)[] = [];
    for (let i = 0; i < films.length; i += PER_ROW) out.push(films.slice(i, i + PER_ROW));
    return out;
  };
  const watched = () => (c()?.films ?? []).filter((f) => f.watched).length;
  return (
    <div class="screen collection" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="160">
        <Show when={c()} fallback={<div class="spinner" />}>
          {(col) => (
            <>
              <div class="planner-head" data-row>
                <h1 class="page-title">{col().name}</h1>
                <p class="muted">
                  {col().films.length === 1 ? "1 film" : `${col().films.length} films`} in release order
                  <Show when={watched() > 0}> · {watched()} watched</Show>
                  {col().source === "tmdb" ? " · From TMDB: films marked In your library are here, the rest can be found from their page" : ""}
                </p>
                <Show when={col().overview}>
                  <p class="muted collection-overview">{col().overview}</p>
                </Show>
              </div>
              <Show when={col().next}>
                {(next) => (
                  <section class="rail" data-row>
                    <div class="rail-track" data-focus-group>
                      <button class="btn btn-primary btn-large" data-focus data-autofocus onClick={() => void play({ kind: "title", id: next().id }, { title: next() })}>
                        <Icon name="play" /> {watched() > 0 ? `Play next: ${next().name}` : `Play ${next().name}`}
                      </button>
                    </div>
                  </section>
                )}
              </Show>
              <For each={rows()}>
                {(row, i) => (
                  <section class="rail" data-row>
                    <div class="rail-track" data-scroll-x="96" data-focus-group>
                      <For each={row}>
                        {(f, j) => <Poster title={{ ...f, subtitle: f.watched ? "Watched" : (f.year ? String(f.year) : ""), badges: f.badges ?? [`${i() * PER_ROW + j() + 1}`] }} onSelect={() => nav.push({ name: "details", id: f.id })} />}
                      </For>
                    </div>
                  </section>
                )}
              </For>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
