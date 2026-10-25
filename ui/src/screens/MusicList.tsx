// A playlist, album or artist: Play, Shuffle, and its songs. The box fetches the songs in the
// background, so the list fills in over a few seconds the first time.

import { createResource, For, onCleanup, Show } from "solid-js";
import type { MusicItem, MusicTracks } from "@ultimatetv/shared";
import { Icon } from "../components/Icon";
import { duration, music, spotify } from "../music";
import { stopPlayback } from "../player";
import { errorToast } from "../store";
import { useMusicKeys } from "./Music";

export function MusicList(props: { item: MusicItem }) {
  let timer: number | undefined;
  let tries = 0;
  const [tracks, { mutate }] = createResource(
    () => props.item.uri,
    async (uri): Promise<MusicTracks> => {
      const first = await music().spotifyTracks(uri);
      // Keep asking until every song has its name, for up to half a minute.
      const again = async () => {
        const t = await music().spotifyTracks(uri).catch(() => null);
        if (t) mutate(t);
        if (t && (!t.ready || t.items.some((i) => i.name === "…")) && ++tries < 30) timer = window.setTimeout(again, 1000);
      };
      if (!first.ready || first.items.some((i) => i.name === "…")) timer = window.setTimeout(again, 1000);
      return first;
    },
  );
  onCleanup(() => clearTimeout(timer));
  useMusicKeys();

  const play = (options: { skipTo?: string; shuffle?: boolean }) =>
    void stopPlayback()
      .then(() => music().spotifyPlay(props.item.uri, options))
      .catch(errorToast);
  const playingHere = () => spotify().context?.uri === props.item.uri;

  return (
    <div class="screen music-list" data-layer>
      <div class="page" data-scroll-y="200">
        <header class="ml-header" data-row>
          <div class="ml-art" classList={{ "card-art-round": props.item.kind === "artist" }}>
            <Show when={props.item.image} fallback={<div class={`card-fallback music-fallback music-fallback-${props.item.kind}`}>{props.item.kind === "liked" ? "♥" : <Icon name="music" />}</div>}>
              <img src={props.item.image} alt="" />
            </Show>
          </div>
          <div class="ml-info">
            <span class="np-source">{{ playlist: "Playlist", album: "Album", artist: "Artist", liked: "Playlist", track: "Song" }[props.item.kind]}</span>
            <h1 class="np-title">{props.item.name}</h1>
            <p class="np-artist">{props.item.subtitle ?? (tracks()?.total ? `${tracks()!.total} songs` : "")}</p>
            <div class="np-controls" data-focus-group>
              <button class="btn btn-primary btn-large" data-focus data-autofocus onClick={() => play({ shuffle: false })}>
                <Icon name="play" />
                Play
              </button>
              <button class="btn btn-large" data-focus onClick={() => play({ shuffle: true })}>
                <Icon name="shuffle" />
                Shuffle
              </button>
            </div>
          </div>
        </header>
        <Show when={tracks()} fallback={<div class="spinner" />}>
          <Show when={tracks()!.items.length || !tracks()!.ready} fallback={<p class="empty">No songs here.</p>}>
            <ol class="track-list" data-focus-group>
              <For each={tracks()!.items}>
                {(t, i) => (
                  <li data-row>
                    <button class="track-row" classList={{ playing: playingHere() && spotify().track?.uri === t.uri }} data-focus onClick={() => play({ skipTo: t.uri })}>
                      <span class="track-n">{playingHere() && spotify().track?.uri === t.uri ? <Icon name={spotify().status === "playing" ? "speaker" : "pause"} /> : i() + 1}</span>
                      <Show when={t.image} fallback={<span class="track-art" />}>
                        <img class="track-art" src={t.image} alt="" loading="lazy" />
                      </Show>
                      <span class="track-name">
                        <span class="track-title">{t.name}</span>
                        <Show when={t.subtitle}>
                          <span class="track-sub">{t.subtitle}</span>
                        </Show>
                      </span>
                      <span class="track-time">{t.durationMs ? duration(t.durationMs) : ""}</span>
                    </button>
                  </li>
                )}
              </For>
            </ol>
            <Show when={!tracks()!.ready}>
              <div class="spinner" />
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
