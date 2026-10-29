// Music: what's playing (Spotify or Deezer) with its controls, then your Spotify playlists,
// albums and artists, and Deezer's own player. Play/Pause on the remote works from any screen
// while music plays (see App.tsx).

import { createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import type { MusicItem } from "@ultimatetv/shared";
import { Icon } from "../components/Icon";
import { Progress } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { useKeys } from "../keys";
import { activeMusic, duration, likedSongs, music, musicPlayPause, musicSkip, openWebApp, spotify, spotifyPosition, spotifySetup, webApp } from "../music";
import { pairStamp } from "../pairing";
import { stopPlayback } from "../player";
import { appName, errorToast, nav } from "../store";

/** A ticking clock for progress bars, while the screen is open. */
export function useTicker(ms = 500): () => number {
  const [t, setT] = createSignal(Date.now());
  const id = setInterval(() => setT(Date.now()), ms);
  onCleanup(() => clearInterval(id));
  return t;
}

export function MusicCard(props: { item: MusicItem }) {
  const i = () => props.item;
  return (
    <button class="card card-square" data-focus onClick={() => nav.push({ name: "music-list", item: i() })}>
      <div class="card-art" classList={{ "card-art-round": i().kind === "artist" }}>
        <Show when={i().image} fallback={<div class={`card-fallback music-fallback music-fallback-${i().kind}`}>{i().kind === "liked" ? "♥" : <Icon name="music" />}</div>}>
          <img src={i().image} alt="" loading="lazy" />
        </Show>
      </div>
      <div class="card-label">
        <span class="card-title">{i().name}</span>
        <Show when={i().subtitle}>
          <span class="card-sub">{i().subtitle}</span>
        </Show>
      </div>
    </button>
  );
}

function MusicRail(props: { title: string; items: MusicItem[] }) {
  return (
    <Show when={props.items.length}>
      <section class="rail" data-row>
        <h3 class="rail-title">{props.title}</h3>
        <div class="rail-track" data-scroll-x="96" data-focus-group>
          <For each={props.items}>{(item) => <MusicCard item={item} />}</For>
        </div>
      </section>
    </Show>
  );
}

const run = (p: Promise<unknown>) => void p.catch(errorToast);

/** Play/Pause, and the skip keys for the next and previous song. */
export function useMusicKeys(): void {
  useKeys((a) => {
    if (a === "playPause" || a === "play" || a === "pause") run(musicPlayPause());
    else if (a === "fastForward") run(musicSkip(1));
    else if (a === "rewind") run(musicSkip(-1));
    else return false;
    return true;
  });
}

function NowPlaying() {
  const tick = useTicker();
  const s = spotify;
  const which = activeMusic;
  const deezer = () => webApp().nowPlaying;
  const title = () => (which() === "deezer" ? deezer()?.title : s().track?.name) ?? "";
  const artist = () => (which() === "deezer" ? deezer()?.artist : s().track?.artists.join(", ")) ?? "";
  const art = () => (which() === "deezer" ? deezer()?.artwork : s().track?.cover);
  const playing = () => (which() === "deezer" ? Boolean(deezer()?.playing) : s().status === "playing" || s().status === "buffering");
  const pos = () => spotifyPosition(s(), tick());
  const control = (c: Parameters<ReturnType<typeof music>["spotifyControl"]>[0]) => run(music().spotifyControl(c));
  const nextRepeat = () => (s().repeat === "off" ? "all" : s().repeat === "all" ? "one" : "off");

  return (
    <section class="now-playing" data-row>
      <div class="np-art">
        <Show when={art()} fallback={<div class="card-fallback music-fallback"><Icon name="music" /></div>}>
          <img src={art()} alt="" />
        </Show>
      </div>
      <div class="np-info">
        <span class={`np-source np-source-${which()}`}>
          {which() === "deezer" ? "Deezer" : `Spotify${s().context?.name ? ` · ${s().context!.name}` : ""}`}
          <Show when={!playing()}> · Paused</Show>
        </span>
        <h1 class="np-title">{title()}</h1>
        <p class="np-artist">{artist()}</p>
        <Show when={which() === "spotify" && s().track}>
          <div class="np-progress">
            <span>{duration(pos())}</span>
            <Progress value={s().track!.durationMs ? pos() / s().track!.durationMs : 0} />
            <span>{duration(s().track!.durationMs)}</span>
          </div>
        </Show>
        <div class="np-controls" data-focus-group>
          <button class="btn btn-round" data-focus aria-label="Previous" onClick={() => run(musicSkip(-1))}>
            <Icon name="prev" />
          </button>
          <button class="btn btn-round btn-round-large" data-focus data-autofocus aria-label={playing() ? "Pause" : "Play"} onClick={() => run(musicPlayPause())}>
            <Icon name={playing() ? "pause" : "play"} />
          </button>
          <button class="btn btn-round" data-focus aria-label="Next" onClick={() => run(musicSkip(1))}>
            <Icon name="next" />
          </button>
          <Switch>
            <Match when={which() === "spotify"}>
              <button class="btn btn-round" classList={{ on: s().shuffle }} data-focus aria-label="Shuffle" onClick={() => control({ cmd: "shuffle", on: !s().shuffle })}>
                <Icon name="shuffle" />
              </button>
              <button class="btn btn-round" classList={{ on: s().repeat !== "off" }} data-focus aria-label="Repeat" onClick={() => control({ cmd: "repeat", mode: nextRepeat() })}>
                <Icon name={s().repeat === "one" ? "repeatOne" : "repeat"} />
              </button>
              <span class="np-volume">
                <button class="btn btn-round" data-focus aria-label="Quieter" onClick={() => control({ cmd: "volume", delta: -5 })}>
                  <Icon name="minus" />
                </button>
                <span class="np-volume-value">
                  <Icon name="speaker" />
                  {s().volume}%
                </span>
                <button class="btn btn-round" data-focus aria-label="Louder" onClick={() => control({ cmd: "volume", delta: 5 })}>
                  <Icon name="plus" />
                </button>
              </span>
            </Match>
            <Match when={which() === "deezer"}>
              <button class="btn" data-focus onClick={() => run(openWebApp("deezer"))}>
                Open Deezer
              </button>
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  );
}

function Welcome() {
  return (
    <section class="music-welcome" data-row>
      <h1 class="page-title">Music</h1>
      <p class="empty">
        <Show when={spotify().signedIn} fallback="Open Deezer, or sign in to Spotify below.">
          Pick a playlist below, or choose <b>{spotify().deviceName ?? appName()}</b> in the Spotify app on your phone.
        </Show>
      </p>
    </section>
  );
}

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\?.*$/, "");

/**
 * Spotify isn't ready: not installed, not running, or nobody signed in yet. Signing in is from
 * a phone's Spotify app (pick the TV in its device list) or, the other way, with a code.
 */
function SpotifySetup() {
  const s = spotify;
  const name = () => s().deviceName ?? appName();
  const [busy, setBusy] = createSignal(false);
  const setup = (arg: Parameters<typeof spotifySetup>[0]) => {
    setBusy(true);
    void spotifySetup(arg)
      .catch(errorToast)
      .finally(() => setBusy(false));
  };
  return (
    <section class="music-pair" data-row>
      <Switch>
        <Match when={s().installed === false}>
          <div class="music-pair-text">
            <h2>Spotify isn't on this box yet</h2>
            <p>Update the box in Settings › About and Spotify is added. It needs a Spotify Premium account.</p>
          </div>
        </Match>
        <Match when={!s().available && s().installed === undefined}>
          <div class="music-pair-text">
            <h2>Spotify isn't set up on this box yet</h2>
            <p>Update the box in Settings › About to add it.</p>
          </div>
        </Match>
        <Match when={!s().available}>
          <div class="music-pair-text" data-focus-group>
            <h2>{s().problem ? "Spotify isn't starting" : "Spotify is starting…"}</h2>
            <Show when={s().problem} fallback={<p>This takes a few seconds after the box starts.</p>}>
              <p>
                The box says: <span class="music-problem">{s().problem}</span>
              </p>
            </Show>
            <button class="btn" data-focus data-autofocus disabled={busy()} onClick={() => setup({ restart: true })}>
              {busy() ? "Restarting…" : "Restart Spotify"}
            </button>
          </div>
        </Match>
        <Match when={s().signIn === "code"}>
          <Show when={s().pair}>
            {(pair) => (
              <div class="qr-card">
                <img src={`/api/qr.svg?text=${encodeURIComponent(pair().url)}`} alt="" />
                <p>{host(pair().url)}</p>
              </div>
            )}
          </Show>
          <div class="music-pair-text">
            <h2>Sign in to Spotify with a code</h2>
            <Show when={s().pair} fallback={<p>Getting a sign-in code from Spotify…</p>}>
              {(pair) => (
                <>
                  <p>Scan the code with your phone, or go to {host(pair().url)} and enter:</p>
                  <div class="pair-code">{pair().code}</div>
                  <p class="muted">Spotify needs a Premium account to play on the TV. Once you're signed in, your playlists appear here.</p>
                </>
              )}
            </Show>
            <div class="music-pair-actions" data-focus-group>
              <button class="btn" data-focus disabled={busy()} onClick={() => setup({ signIn: "phone" })}>
                Sign in from the Spotify app instead
              </button>
            </div>
          </div>
        </Match>
        <Match when={true}>
          <div class="qr-card">
            <img src={`/api/qr.svg?text=${encodeURIComponent("https://open.spotify.com/")}`} alt="" />
            <p>Opens Spotify</p>
          </div>
          <div class="music-pair-text">
            <h2>Sign in to Spotify from your phone</h2>
            <ol class="music-steps">
              <li>Join the home Wi-Fi on your phone and open the Spotify app (scan the code to open it).</li>
              <li>Play any song, then tap the devices button (the little speaker and screen) at the bottom of the player.</li>
              <li>
                Pick <b>{name()}</b>. The music plays on the TV.
              </li>
            </ol>
            <p class="muted">The TV remembers the account, and your playlists, albums and artists appear here. It needs Spotify Premium. Anyone else at home can pick {name()} from their own Spotify app too.</p>
            <div class="music-pair-actions" data-focus-group>
              <button class="btn" data-focus disabled={busy()} onClick={() => setup({ signIn: "code" })}>
                {busy() ? "Getting a code…" : "Not listed? Sign in with a code"}
              </button>
            </div>
          </div>
        </Match>
      </Switch>
    </section>
  );
}

/** Spotify's card in the services row: whether it's ready, and how to use it. */
function SpotifyCard() {
  const s = spotify;
  const name = () => s().deviceName ?? appName();
  const sub = () => {
    const st = s();
    if (st.signedIn) return `Signed in${st.username ? ` as ${st.username}` : ""}. Pick a playlist below, or choose ${name()} in the Spotify app.`;
    if (st.installed === false || (!st.available && st.installed === undefined)) return "Not on this box yet. Update the box in Settings › About.";
    if (!st.available) return st.problem ? "Not starting. See below." : "Starting…";
    return "Not signed in yet. Sign in below.";
  };
  return (
    <div class="service-card service-spotify" classList={{ "service-off": !s().signedIn }}>
      <span class="service-name">Spotify</span>
      <span class="service-sub">{sub()}</span>
    </div>
  );
}

function Services() {
  return (
    <section class="rail" data-row>
      <h3 class="rail-title">Music services</h3>
      <div class="rail-track" data-scroll-x="96" data-focus-group>
        <button class="service-card service-deezer" data-focus onClick={() => run(stopPlayback().then(() => openWebApp("deezer")))}>
          <span class="service-name">Deezer</span>
          <span class="service-sub">
            <Show when={webApp().nowPlaying} fallback={webApp().signedIn ? "Opens Deezer's player. Back returns here; the music keeps playing." : "Opens Deezer's player. Log in first with the code beside this."}>
              {(np) => `${np().playing ? "Playing" : "Paused"}: ${np().title}`}
            </Show>
          </span>
        </button>
        <Show when={webApp().signedIn !== true}>
          <div class="service-login">
            <div class="qr-card">
              <img src={`/api/music/login/qr.svg?v=${pairStamp()}`} alt="" />
            </div>
            <div class="service-login-text">
              <h3>Log in to Deezer</h3>
              <p>Scan this with your phone and type your Deezer email and password there. Deezer opens on the TV and logs in. Google or Apple sign-in doesn't work on the TV: set a Deezer password first.</p>
            </div>
          </div>
        </Show>
        <SpotifyCard />
      </div>
    </section>
  );
}

export function Music() {
  const signedIn = () => spotify().signedIn;
  const load = (kind: "playlists" | "albums" | "artists") => () => (signedIn() ? kind : false);
  const [playlists] = createResource(load("playlists"), (k) => music().spotifyLibrary(k, 0).catch(() => ({ items: [], total: 0 })));
  const [albums] = createResource(load("albums"), (k) => music().spotifyLibrary(k, 0).catch(() => ({ items: [], total: 0 })));
  const [artists] = createResource(load("artists"), (k) => music().spotifyLibrary(k, 0).catch(() => ({ items: [], total: 0 })));
  const playlistItems = () => {
    const liked = likedSongs(spotify());
    return [...(liked ? [liked] : []), ...(playlists()?.items ?? [])];
  };

  useMusicKeys();

  return (
    <div class="screen music" data-layer>
      <Show when={activeMusic() === "spotify" ? spotify().track?.cover : activeMusic() === "deezer" ? webApp().nowPlaying?.artwork : undefined}>
        {(art) => (
          <div class="music-bg">
            <img src={art()} alt="" />
          </div>
        )}
      </Show>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <Show when={activeMusic()} fallback={<Welcome />}>
          <NowPlaying />
        </Show>
        <Switch>
          <Match when={!signedIn()}>
            <Services />
            <SpotifySetup />
          </Match>
          <Match when={true}>
            <Services />
            <MusicRail title="Your playlists" items={playlistItems()} />
            <MusicRail title="Albums" items={albums()?.items ?? []} />
            <MusicRail title="Artists" items={artists()?.items ?? []} />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
