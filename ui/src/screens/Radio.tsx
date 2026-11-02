// The Music tab's two live sections: radio stations the Hub knows about, and podcasts it reads
// from their feeds. Neither has a picture to show, so they play with the Music tab still up (the
// player is asked not to go full screen) and this screen draws what's playing.

import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { PodcastEpisode, PodcastShow, PodcastSearchResult, RadioStation } from "@ultimatetv/shared";
import { Icon } from "../components/Icon";
import { askText, choose } from "../components/Dialog";
import { TopBar } from "../components/TopBar";
import { useKeys } from "../keys";
import { Progress } from "../components/Rail";
import { duration } from "../music";
import { playerState } from "../player";
import {
  addStation,
  followFeed,
  loadPodcasts,
  loadRadio,
  nowLineFor,
  openShow,
  podcastShows,
  playEpisode,
  playStation,
  radioBusy,
  radioPauseToggle,
  radioPlaying,
  radioStations,
  refreshNow,
  removeStation,
  stopRadio,
  unfollow,
} from "../radio";
import { errorToast, nav, toast } from "../store";

const run = (p: Promise<unknown>) => void p.catch(errorToast);

/** A station's second line: what's playing on it, or what kind of station it is. */
function stationSub(station: RadioStation): string {
  return nowLineFor(station.id) ?? station.genre ?? (station.source === "custom" ? "Your station" : "Radio");
}

function StationCard(props: { station: RadioStation }) {
  const playing = () => {
    const on = radioPlaying();
    return on?.kind === "station" && on.station.id === props.station.id;
  };
  return (
    <button
      class="card card-square"
      classList={{ "card-playing": playing() }}
      data-focus
      onClick={() => run(playing() ? stopRadio() : playStation(props.station))}
    >
      <div class="card-art">
        <Show when={props.station.logo} fallback={<div class="card-fallback music-fallback"><Icon name="music" /></div>}>
          <img src={props.station.logo} alt="" loading="lazy" />
        </Show>
      </div>
      <div class="card-label">
        <span class="card-title">{props.station.name}</span>
        <span class="card-sub">{playing() ? "Playing" : stationSub(props.station)}</span>
      </div>
    </button>
  );
}

/** What's playing from here: a station, or a podcast episode, with the controls that make sense. */
export function RadioNowPlaying() {
  const on = radioPlaying;
  const name = () => {
    const p = on();
    return p ? (p.kind === "station" ? p.station.name : p.episode.title) : "";
  };
  const sub = () => {
    const p = on();
    if (!p) return "";
    if (p.kind === "station") return nowLineFor(p.station.id) ?? p.station.genre ?? "Radio";
    return p.show.title;
  };
  const art = () => {
    const p = on();
    return p ? (p.kind === "station" ? p.station.logo : p.episode.image ?? p.show.image) : undefined;
  };
  const paused = () => playerState().status === "paused";
  return (
    <Show when={on()}>
      {(pick) => (
        <section class="now-playing" data-row>
          <div class="np-art">
            <Show when={art()} fallback={<div class="card-fallback music-fallback"><Icon name="music" /></div>}>
              <img src={art()} alt="" />
            </Show>
          </div>
          <div class="np-info">
            <span class="np-source np-source-radio">{pick().kind === "station" ? "Radio" : "Podcast"}</span>
            <h1 class="np-title">{name()}</h1>
            <p class="np-artist">{sub()}</p>
            <div class="np-controls" data-focus-group>
              <button class="btn btn-round btn-round-large btn-primary" data-focus data-autofocus aria-label={paused() ? "Play" : "Pause"} onClick={() => run(radioPauseToggle())}>
                <Icon name={paused() ? "play" : "pause"} />
              </button>
              <button class="btn btn-round" data-focus aria-label="Stop" onClick={() => run(stopRadio())}>
                <Icon name="close" />
              </button>
            </div>
          </div>
        </section>
      )}
    </Show>
  );
}

/** The radio stations rail, with adding and removing your own. */
export function RadioSection() {
  const [adding, setAdding] = createSignal(false);
  onMount(() => {
    void loadRadio().catch(errorToast);
  });
  // Ask each station's stream what it's playing, a few at a time, while the section is open.
  onMount(() => {
    const ask = () => {
      for (const s of radioStations().slice(0, 24)) void refreshNow(s.id);
    };
    ask();
    const id = window.setInterval(ask, 30_000);
    onCleanup(() => window.clearInterval(id));
  });

  const add = async () => {
    if (adding()) return;
    setAdding(true);
    try {
      const name = await askText("What's the station called?");
      if (!name) return;
      const url = await askText("Paste the stream address", "", "It usually ends in .mp3 or .m3u8");
      if (!url) return;
      const station = await addStation(name, url);
      if (station) void refreshNow(station.id);
    } finally {
      setAdding(false);
    }
  };

  const menu = async (station: RadioStation) => {
    const pick = await choose<"play" | "remove">({
      title: station.name,
      message: stationSub(station),
      options: [
        { label: "Play", value: "play", icon: "play" },
        ...(station.source === "custom" ? [{ label: "Remove this station", value: "remove" as const, icon: "trash", tone: "danger" as const }] : []),
      ],
    });
    if (pick === "play") await playStation(station);
    if (pick === "remove") {
      const sure = await choose<"yes" | "no">({
        title: `Remove ${station.name}?`,
        options: [
          { label: "Remove it", value: "yes", tone: "danger" },
          { label: "Keep it", value: "no" },
        ],
      });
      if (sure === "yes") await removeStation(station.id);
    }
  };

  return (
    <Show when={radioStations().length}>
      <section class="rail" data-row>
        <h3 class="rail-title">Radio</h3>
        <div class="rail-track" data-scroll-x="96" data-focus-group>
          <For each={radioStations()}>
            {(station) => (
              <div class="rail-item">
                <StationCard station={station} />
              </div>
            )}
          </For>
          <button class="card card-square" data-focus onClick={() => void add()}>
            <div class="card-art">
              <div class="card-fallback music-fallback">
                <Icon name="plus" />
              </div>
            </div>
            <div class="card-label">
              <span class="card-title">Add a station</span>
              <span class="card-sub">A stream address</span>
            </div>
          </button>
        </div>
      </section>
    </Show>
  );
}

function showSub(show: PodcastShow): string {
  if (show.problem) return show.problem;
  const fresh = show.freshCount ? `${show.freshCount} new` : "";
  const many = `${show.episodeCount} episode${show.episodeCount === 1 ? "" : "s"}`;
  return fresh ? `${fresh} · ${many}` : many;
}

/** The podcasts rail: the shows the household follows, newest episodes first. */
export function PodcastSection() {
  const [finding, setFinding] = createSignal(false);
  onMount(() => {
    void loadPodcasts().catch(errorToast);
  });

  const find = async () => {
    if (finding()) return;
    setFinding(true);
    try {
      const how = await choose<"search" | "address">({
        title: "Find a podcast",
        options: [
          { label: "Search by name", value: "search", icon: "search" },
          { label: "Paste an RSS address", value: "address", icon: "link" },
        ],
      });
      if (!how) return;
      if (how === "address") {
        const url = await askText("Paste the podcast's RSS address", "", "It usually ends in .xml or /rss");
        if (url) await followFeed(url);
        return;
      }
      const q = await askText("Search for a podcast");
      if (!q) return;
      const reply = await hubSearch(q);
      if (!reply.length) {
        toast(`Nothing found for “${q}”`, "bad");
        return;
      }
      const picked = await choose<PodcastSearchResult>({
        title: `Podcasts: ${q}`,
        options: reply.map((r) => ({ label: r.title, value: r, detail: r.author ?? `${r.episodeCount ?? 0} episodes` })),
      });
      if (picked) await followFeed(picked.feedUrl);
    } finally {
      setFinding(false);
    }
  };

  const menu = async (show: PodcastShow) => {
    const pick = await choose<"open" | "remove">({
      title: show.title,
      message: showSub(show),
      ...(show.image ? { image: show.image } : {}),
      options: [
        { label: "See the episodes", value: "open", icon: "list" },
        { label: "Stop following", value: "remove", icon: "trash", tone: "danger" },
      ],
    });
    if (pick === "open") nav.push({ name: "podcast", id: show.id });
    if (pick === "remove") await unfollow(show.id);
  };

  return (
    <Show when={podcastShows().length}>
      <section class="rail" data-row>
        <h3 class="rail-title">Podcasts</h3>
        <div class="rail-track" data-scroll-x="96" data-focus-group>
          <For each={podcastShows()}>
            {(show) => (
              <button class="card card-square" data-focus onClick={() => void menu(show)}>
                <div class="card-art">
                  <Show when={show.image} fallback={<div class="card-fallback music-fallback"><Icon name="speaker" /></div>}>
                    <img src={show.image} alt="" loading="lazy" />
                  </Show>
                </div>
                <div class="card-label">
                  <span class="card-title">{show.title}</span>
                  <span class="card-sub">{showSub(show)}</span>
                </div>
              </button>
            )}
          </For>
          <button class="card card-square" data-focus onClick={() => void find()}>
            <div class="card-art">
              <div class="card-fallback music-fallback">
                <Icon name="plus" />
              </div>
            </div>
            <div class="card-label">
              <span class="card-title">Find a podcast</span>
              <span class="card-sub">Search, or paste a feed</span>
            </div>
          </button>
        </div>
      </section>
    </Show>
  );
}

async function hubSearch(q: string): Promise<PodcastSearchResult[]> {
  try {
    const reply = await (await import("../api")).hub.podcastSearch(q);
    return reply.results;
  } catch (err) {
    errorToast(err);
    return [];
  }
}

function episodeSub(episode: PodcastEpisode): string {
  const when = new Date(episode.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const length = episode.durationMs ? duration(episode.durationMs) : "";
  const heard = episode.positionMs ? `${duration(episode.positionMs)} in` : "";
  return [when, length, heard].filter(Boolean).join(" · ");
}

/** One podcast's episodes, newest first, each resuming where it was left. */
export function PodcastShowScreen(props: { id: string }) {
  const [show, { refetch }] = createResource(
    () => props.id,
    (id) => openShow(id).catch(() => null),
  );
  useKeys((a) => {
    if (a === "playPause" && radioPlaying()) {
      void radioPauseToggle();
      return true;
    }
    return false;
  });
  const playingId = () => {
    const on = radioPlaying();
    return on?.kind === "episode" ? on.episode.id : undefined;
  };
  const play = (episode: PodcastEpisode) => {
    const s = show()?.show;
    if (!s) return;
    if (playingId() === episode.id) return void radioPauseToggle();
    run(playEpisode(s, episode, !episode.positionMs));
  };
  return (
    <div class="screen podcast" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <Show when={show()} fallback={<p class="muted">Reading the feed…</p>}>
          {(page) => (
            <>
              <header class="ml-header" data-row>
                <div class="ml-art">
                  <Show when={page().show.image} fallback={<div class="card-fallback music-fallback"><Icon name="speaker" /></div>}>
                    <img src={page().show.image} alt="" />
                  </Show>
                </div>
                <div class="ml-info">
                  <span class="np-source">Podcast</span>
                  <h1 class="np-title">{page().show.title}</h1>
                  <p class="np-artist">{page().show.author ?? `${page().episodes.length} episodes`}</p>
                  <Show when={page().show.problem}>
                    <p class="muted">{page().show.problem}</p>
                  </Show>
                  <div class="np-controls" data-focus-group>
                    <button class="btn" data-focus onClick={() => void refetch()}>
                      <Icon name="restart" />
                      Check for new
                    </button>
                    <button
                      class="btn btn-danger"
                      data-focus
                      onClick={() => {
                        void unfollow(props.id);
                        nav.back();
                      }}
                    >
                      <Icon name="trash" />
                      Stop following
                    </button>
                  </div>
                </div>
              </header>
              <div class="list">
                <For each={page().episodes}>
                  {(episode) => (
                    <button class="list-row" data-row data-focus onClick={() => play(episode)}>
                      <span class="list-main">
                        <span class="list-title">
                          {episode.title}
                          <Show when={episode.fresh}>
                            <span class="flag flag-new">New</span>
                          </Show>
                        </span>
                        <span class="list-sub">{episodeSub(episode)}</span>
                        <Show when={episode.positionMs && episode.durationMs}>
                          <Progress value={episode.positionMs! / episode.durationMs!} class="list-progress" />
                        </Show>
                      </span>
                      <Icon name={playingId() === episode.id ? "pause" : "play"} class="list-icon" />
                    </button>
                  )}
                </For>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
