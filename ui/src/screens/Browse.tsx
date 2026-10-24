// Films or TV Shows: your library first, then popular titles and genres.

import { createResource, For, Show } from "solid-js";
import { hub } from "../api";
import { RailRow } from "../components/Rail";
import { TopBar } from "../components/TopBar";

export function Browse(props: { kind: "movie" | "series" }) {
  const [data] = createResource(() => props.kind, (k) => hub.browse(k));
  return (
    <div class="screen browse" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <h1 class="page-title">{props.kind === "movie" ? "Films" : "TV Shows"}</h1>
        <Show when={data()} fallback={<div class="spinner" />}>
          <Show when={data()!.rails.length} fallback={<p class="empty">Nothing here yet. Connect Jellyfin, TMDB or your IPTV films in Settings.</p>}>
            <For each={data()!.rails}>{(rail) => <RailRow rail={rail} />}</For>
          </Show>
        </Show>
      </div>
    </div>
  );
}
