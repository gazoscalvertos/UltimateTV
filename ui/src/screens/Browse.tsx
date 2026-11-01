// Films or TV Shows: your library first, then popular titles and genres. The chips at the top
// narrow it to the profile's Favourites.

import { createResource, createSignal, For, Show } from "solid-js";
import type { Rail } from "@ultimatetv/shared";
import { hub } from "../api";
import { RailRow } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { favourites } from "../favourites";

/** Favourites shown as rows of this many, so a long list reads as a grid rather than one long rail. */
const PER_ROW = 10;

export function Browse(props: { kind: "movie" | "series" }) {
  const [data] = createResource(() => props.kind, (k) => hub.browse(k));
  const [onlyFavourites, setOnlyFavourites] = createSignal(false);
  const liked = () => favourites().titles.filter((f) => f.title.kind === props.kind).map((f) => f.title);
  const likedRails = (): Rail[] => {
    const items = liked();
    const rails: Rail[] = [];
    for (let i = 0; i < items.length; i += PER_ROW) {
      rails.push({ id: `favourites-${i}`, title: i === 0 ? `Your favourite ${props.kind === "movie" ? "films" : "shows"}` : "", kind: "titles", items: items.slice(i, i + PER_ROW) });
    }
    return rails;
  };
  return (
    <div class="screen browse" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <h1 class="page-title">{props.kind === "movie" ? "Films" : "TV Shows"}</h1>
        <div class="browse-filter" data-row data-focus-group>
          <button class="chip" classList={{ active: !onlyFavourites() }} data-focus onClick={() => setOnlyFavourites(false)}>
            Everything
          </button>
          <button class="chip" classList={{ active: onlyFavourites() }} data-focus onClick={() => setOnlyFavourites(true)}>
            Favourites <span class="chip-count">{liked().length}</span>
          </button>
        </div>
        <Show
          when={!onlyFavourites()}
          fallback={
            <Show when={liked().length} fallback={<p class="empty">No favourites yet. Open a {props.kind === "movie" ? "film" : "show"} and press Blue, or choose Add to Favourites.</p>}>
              <For each={likedRails()}>{(rail) => <RailRow rail={rail} />}</For>
            </Show>
          }
        >
          <Show when={data()} fallback={<div class="spinner" />}>
            <Show when={data()!.rails.length} fallback={<p class="empty">Nothing here yet. Connect Jellyfin, TMDB or your IPTV films in Settings.</p>}>
              <For each={data()!.rails}>{(rail) => <RailRow rail={rail} />}</For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
