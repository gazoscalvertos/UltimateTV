// Full-screen playback. Live TV gets Sky's banner (now/next, browse other channels with up/down
// without changing, channel numbers); films, episodes and recordings get a seek bar, skip intro,
// audio and subtitle options, and Up Next: the first thing in the play queue, or else the next
// episode.

import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { NowNext, PlaybackRequest, PlaybackStats, TitleRef } from "@ultimatetv/shared";
import { clockTime, digitOf } from "@ultimatetv/shared";
import { agent, agentHas } from "../agent";
import { hub } from "../api";
import { DialogFrame } from "../components/Dialog";
import { StartingCard } from "../components/Starting";
import { Icon } from "../components/Icon";
import { MusicCaption } from "../components/MusicCaption";
import { openProgramme, recordFlow } from "../components/ProgrammeCard";
import { Progress } from "../components/Rail";
import { useKeys } from "../keys";
import { chooseVersion } from "./Details";
import { channelById, channelByNumber, liveChannelId, nowPlaying, play, playerState, stepChannel, stopPlayback } from "../player";
import { queue } from "../queue";
import { nav, now, openDialog, setShowStats, showStats, toast } from "../store";

interface UpNext {
  req: PlaybackRequest;
  name: string;
  title?: TitleRef;
  image?: string;
  overview?: string;
  /** From the play queue, rather than the next episode. */
  queued: boolean;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** The stats overlay: refreshed every second while it's on. */
function StatsOverlay() {
  const [stats, setStats] = createSignal<PlaybackStats | null>(null);
  const load = () =>
    agentHas("stats")
      ? void agent.stats().then(setStats, () => setStats(null))
      : setStats({ sections: [{ title: "Box", rows: [["Stats", "This box needs a one-off update first (see Settings › About)"]] }] });
  load();
  const timer = window.setInterval(load, 1000);
  onCleanup(() => clearInterval(timer));
  return (
    <Show when={stats()}>
      {(s) => (
        <div class="stats-overlay">
          <For each={s().sections}>
            {(section) => (
              <section>
                <h4>{section.title}</h4>
                <dl>
                  <For each={section.rows}>
                    {([label, value]) => (
                      <>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </>
                    )}
                  </For>
                </dl>
              </section>
            )}
          </For>
          <p class="stats-hint">
            <kbd class="key-blue" /> Hide stats
          </p>
        </div>
      )}
    </Show>
  );
}

export function Player() {
  const live = () => nowPlaying()?.info.live ?? false;
  // Until the first frame shows, the "starting" card stands in for the picture.
  const [played, setPlayed] = createSignal(false);
  createEffect(on(nowPlaying, () => setPlayed(false)));
  createEffect(() => {
    if (playerState().status === "playing" || playerState().status === "paused") setPlayed(true);
  });
  const opening = () => !played() && !nowPlaying()?.quiet && (playerState().status === "loading" || playerState().status === "buffering");

  // What plays when this ends: the first thing queued (always, as it was asked for), else the
  // next episode (when autoplay is on).
  const upNext = createMemo((): UpNext | null => {
    const np = nowPlaying();
    if (!np || np.info.live) return null;
    const q = queue()[0];
    if (q) return { req: q.req, name: q.subtitle ? `${q.name} · ${q.subtitle}` : q.name, queued: true, ...(q.title ? { title: q.title } : {}), ...(q.image ? { image: q.image } : {}) };
    const n = np.info.next;
    if (!n) return null;
    const { name, image, overview, ...req } = n;
    return { req, name, queued: false, ...(np.title ? { title: np.title } : {}), ...(image ? { image } : {}), ...(overview ? { overview } : {}) };
  });

  // Look up what's next near the end of this, so it starts straight away.
  let prefetched = "";
  createEffect(() => {
    const np = nowPlaying();
    const st = playerState();
    const next = upNext();
    if (!np || !next || next.req.kind !== "title" || !st.durationMs) return;
    if (st.positionMs < st.durationMs - Math.min(5 * 60_000, st.durationMs / 4) && skip()?.kind !== "credits") return;
    const key = `${np.since}|${next.req.id}|${next.req.episodeId ?? ""}`;
    if (prefetched === key) return;
    prefetched = key;
    void hub.prefetch(next.req).catch(() => undefined);
  });
  const stopAndBack = () => (nav.back() ? undefined : nav.reset({ name: "home" }));
  const otherVersion = async () => {
    const np = nowPlaying();
    if (np?.req.kind !== "title") return;
    const { id, episodeId } = np.req;
    const title = await hub.title(id).catch(() => null);
    if (title) void chooseVersion(title, episodeId);
  };
  const [osd, setOsd] = createSignal(true);
  const [browse, setBrowse] = createSignal<string | null>(null);
  const [showNext, setShowNext] = createSignal(false);
  const [digits, setDigits] = createSignal("");
  // Up Next: a small card in the corner during the credits (or the last 30 s), then the next
  // episode, already looked up, starts as this one ends. Back hides the card and stops there.
  const [nextHidden, setNextHidden] = createSignal(false);
  createEffect(on(nowPlaying, () => setNextHidden(false)));
  const [playSettings] = createResource(() => hub.settings().then((s) => s.playback).catch(() => null));
  const autoplay = () => playSettings()?.autoplayNext ?? true;
  const remainingS = () => {
    const st = playerState();
    return st.durationMs ? Math.max(0, Math.ceil((st.durationMs - st.positionMs) / 1000)) : null;
  };
  const showNextCard = () => {
    if (!upNext() || nextHidden() || !played()) return false;
    const left = remainingS();
    return skip()?.kind === "credits" || playerState().status === "ended" || (left !== null && left <= 30);
  };
  // The next episode carries straight on; something else from the queue gets its "starting" card.
  const playNext = () => {
    const next = upNext();
    if (next) void play(next.req, { ...(next.queued ? {} : { quiet: true }), ...(next.title ? { title: next.title } : {}) });
  };
  const nextLabel = () => {
    const next = upNext();
    const what = next?.queued ? "Up next from your queue" : "Next episode";
    const counting = (next?.queued || autoplay()) && remainingS() !== null && playerState().status !== "ended";
    return counting ? `${what} in ${remainingS()} s` : what;
  };
  let hideTimer: number | undefined;
  let digitTimer: number | undefined;

  const poke = (ms = 5000) => {
    setOsd(true);
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (playerState().status !== "paused") {
        setOsd(false);
        setBrowse(null);
        setShowNext(false);
      }
    }, ms);
  };

  onMount(() => {
    void agent.setLayout({ mode: "fullscreen" });
    poke();
  });
  onCleanup(() => {
    clearTimeout(hideTimer);
    clearTimeout(digitTimer);
    if (nav.current().name !== "guide") void stopPlayback();
  });

  // Now/next for the banner: the channel playing, or the one being browsed.
  const bannerChannelId = () => browse() ?? liveChannelId();
  const [nn, { refetch }] = createResource(bannerChannelId, async (id) => (await hub.nowNext([id])).items[0] as NowNext | undefined);
  createEffect(on(() => Math.floor(now() / 60_000), () => void refetch(), { defer: true }));
  // Music channels change programme every few minutes: look again as each one ends.
  createEffect(() => {
    const end = nn()?.now?.end;
    if (!end) return;
    const t = window.setTimeout(() => void refetch(), Math.max(1000, end - Date.now() + 500));
    onCleanup(() => clearTimeout(t));
  });
  const [tunedAt, setTunedAt] = createSignal(Date.now());
  createEffect(on(nowPlaying, () => setTunedAt(Date.now())));

  // Up Next when a film or episode ends.
  createEffect(
    on(
      () => playerState().status,
      (status) => {
        const np = nowPlaying();
        // A music video channel ran through the videos it was given: tune in again for the next ones.
        if (status === "ended" && np?.info.live && np.info.queue && np.req.kind === "channel") return void play(np.req);
        if (status !== "ended" || !np || np.info.live) return;
        const next = upNext();
        if (next && !nextHidden() && (next.queued || autoplay())) playNext();
        else if (!next || nextHidden()) nav.back();
      },
    ),
  );

  const skip = createMemo(() => {
    const np = nowPlaying();
    const pos = playerState().positionMs;
    return np?.info.skip.find((s) => pos >= s.startMs && pos < s.endMs - 2000);
  });

  const tune = (id: string) => {
    setBrowse(null);
    setShowNext(false);
    void play({ kind: "channel", id }).then(() => poke());
  };

  const options = () =>
    openDialog((close) => {
      const st = playerState();
      return (
        <DialogFrame close={() => close()} class="options-panel">
          <h2>Options</h2>
          <h4>
            <Icon name="speaker" /> Audio
          </h4>
          <div class="option-list">
            <For each={st.audioTracks}>
              {(t) => (
                <button class="option" classList={{ selected: t.selected }} data-focus onClick={() => void agent.setAudioTrack(t.id).then(() => close())}>
                  {[t.title ?? t.lang ?? `Track ${t.id}`, t.codec?.toUpperCase(), t.channels ? `${t.channels > 2 ? `${t.channels - 1}.1` : "Stereo"}` : ""].filter(Boolean).join(" · ")}
                </button>
              )}
            </For>
          </div>
          <h4>
            <Icon name="subtitles" /> Subtitles
          </h4>
          <div class="option-list">
            <button class="option" classList={{ selected: !st.subtitleTracks.some((t) => t.selected) }} data-focus onClick={() => void agent.setSubtitleTrack(null).then(() => close())}>
              Off
            </button>
            <For each={st.subtitleTracks}>
              {(t) => (
                <button class="option" classList={{ selected: t.selected }} data-focus onClick={() => void agent.setSubtitleTrack(t.id).then(() => close())}>
                  {t.title ?? t.lang ?? `Track ${t.id}`}
                </button>
              )}
            </For>
          </div>
          <h4>
            <Icon name="moon" /> Night mode
          </h4>
          <div class="option-list">
            <button class="option" data-focus onClick={() => void agent.setNightMode(true).then(() => (toast("Night mode on: quieter loud bits, clearer speech"), close()))}>
              On
            </button>
            <button class="option" data-focus onClick={() => void agent.setNightMode(false).then(() => close())}>
              Off
            </button>
          </div>
          <h4>
            <Icon name="info" /> Playback stats
          </h4>
          <div class="option-list">
            <button class="option" classList={{ selected: showStats() }} data-focus onClick={() => (setShowStats(true), close())}>
              On
            </button>
            <button class="option" classList={{ selected: !showStats() }} data-focus onClick={() => (setShowStats(false), close())}>
              Off
            </button>
          </div>
        </DialogFrame>
      );
    });

  useKeys((a) => {
    const np = nowPlaying();
    if (!np) {
      if (a === "back") nav.back();
      return true;
    }
    const st = playerState();
    if (showNextCard() && (a === "ok" || a === "back")) {
      if (a === "ok") playNext();
      else if (playerState().status === "ended") nav.back();
      else setNextHidden(true);
      return true;
    }
    const d = digitOf(a);
    if (live() && d !== null) {
      const next = (digits() + d).slice(-3);
      setDigits(next);
      clearTimeout(digitTimer);
      const go = () => {
        const c = channelByNumber(Number(next));
        setDigits("");
        if (c) tune(c.id);
        else toast(`There's no channel ${next}`);
      };
      digitTimer = window.setTimeout(go, next.length >= 3 ? 300 : 2000);
      return true;
    }
    switch (a) {
      case "back":
        if (osd() && (browse() || showNext())) {
          setBrowse(null);
          setShowNext(false);
          return true;
        }
        if (osd() && live()) {
          setOsd(false);
          return true;
        }
        nav.back() || nav.reset({ name: "home" });
        return true;
      case "guide":
        nav.push({ name: "guide" });
        return true;
      case "home":
        nav.reset({ name: "home" });
        return true;
      case "yellow":
        void options();
        return true;
      case "blue":
        setShowStats(!showStats());
        return true;
      case "playPause":
      case "pause":
      case "play": {
        const pause = a === "pause" || (a === "playPause" && st.status !== "paused");
        void agent.pause(pause);
        if (!pause && live() && a === "play" && st.behindLiveMs) void agent.goLive();
        poke(pause ? 60_000 : 4000);
        return true;
      }
      case "rewind":
        void agent.seek(-30_000, "relative");
        poke();
        return true;
      case "fastForward":
        void agent.seek(live() ? 30_000 : 60_000, "relative");
        poke();
        return true;
    }

    if (live()) {
      switch (a) {
        case "up":
        case "down": {
          const from = browse() ?? liveChannelId();
          const c = stepChannel(from, a === "up" ? 1 : -1);
          if (osd() && c) setBrowse(c.id);
          setShowNext(false);
          poke(8000);
          return true;
        }
        case "left":
        case "right":
          setShowNext(a === "right");
          poke(8000);
          return true;
        case "channelUp":
        case "channelDown": {
          const c = stepChannel(liveChannelId(), a === "channelUp" ? 1 : -1);
          if (c) tune(c.id);
          return true;
        }
        case "ok":
          if (browse() && browse() !== liveChannelId()) tune(browse()!);
          else if (osd()) setOsd(false);
          else poke();
          return true;
        case "info": {
          const p = showNext() ? nn()?.next : nn()?.now;
          if (p) void openProgramme(p);
          return true;
        }
        case "record":
        case "red": {
          const p = showNext() ? nn()?.next : nn()?.now;
          if (p) void recordFlow(p);
          return true;
        }
      }
      return true;
    }

    // Films, episodes, recordings.
    switch (a) {
      case "ok":
        if (!osd() && skip()) {
          void agent.seek(skip()!.endMs, "absolute");
          return true;
        }
        void agent.pause(st.status !== "paused");
        poke(st.status === "paused" ? 4000 : 60_000);
        return true;
      case "left":
        void agent.seek(-10_000, "relative");
        poke();
        return true;
      case "right":
        void agent.seek(30_000, "relative");
        poke();
        return true;
      case "up":
      case "info":
        poke();
        return true;
      case "down":
        void options();
        return true;
    }
    return true;
  });

  const banner = () => nn();
  const browsing = () => browse() !== null && browse() !== liveChannelId();
  const progress = (start: number, end: number) => (now() - start) / (end - start);

  return (
    <div class="screen player" data-layer>
      <Show when={opening() && nowPlaying()}>
        {(np) => (
          <div class="player-spinner">
            <StartingCard
              title={np().title?.name ?? np().info.title}
              {...(np().info.source?.label ? { source: np().info.source!.label } : {})}
              step={playerState().status === "loading" ? "Connecting" : "Buffering"}
              since={np().since}
              {...(playerState().downloadKbps ? { downloadKbps: playerState().downloadKbps! } : {})}
              {...(playerState().bufferedMs ? { bufferedMs: playerState().bufferedMs! } : {})}
            />
          </div>
        )}
      </Show>
      <Show when={!opening() && (playerState().status === "buffering" || (nowPlaying()?.quiet && !played() && playerState().status === "loading"))}>
        <div class="player-spinner">
          <div class="spinner" />
        </div>
      </Show>
      <Show when={playerState().status === "error"}>
        <div class="player-spinner">
          <DialogFrame close={() => void stopAndBack()} class="player-error">
            <h2>That didn't play</h2>
            <p class="dialog-message">{playerState().error ?? "The stream didn't start."} Another version may work.</p>
            <div class="dialog-options">
              <Show when={nowPlaying()?.req.kind === "title"}>
                <button class="btn btn-primary" data-focus data-autofocus onClick={() => void otherVersion()}>
                  <Icon name="list" /> Choose another version
                </button>
              </Show>
              <button class="btn" data-focus data-autofocus={nowPlaying()?.req.kind === "title" ? undefined : ""} onClick={() => void stopAndBack()}>
                Back
              </button>
            </div>
          </DialogFrame>
        </div>
      </Show>

      <Show when={showStats()}>
        <StatsOverlay />
      </Show>

      <Show when={digits()}>
        <div class="digits-overlay">{digits()}</div>
      </Show>

      {/* Music channel caption, while the banner is down */}
      <Show when={live() && !osd() && nowPlaying()?.info.titles}>
        {(titles) => (
          <MusicCaption
            titles={titles()}
            schedule={browsing() ? undefined : nn()}
            channelName={channelById(liveChannelId())?.name ?? ""}
            tunedAt={tunedAt()}
            {...(channelById(liveChannelId())?.logo ? { logo: channelById(liveChannelId())!.logo! } : {})}
          />
        )}
      </Show>

      {/* Live banner */}
      <Show when={live() && osd()}>
        <div class="banner">
          <div class="banner-channel">
            <span class="banner-number">{channelById(bannerChannelId())?.number}</span>
            <Show when={channelById(bannerChannelId())?.logo}>
              <img class="banner-logo" src={channelById(bannerChannelId())!.logo} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
            </Show>
            <span class="banner-name">{channelById(bannerChannelId())?.name}</span>
            <Show when={browsing()}>
              <span class="flag">Press OK to watch</span>
            </Show>
          </div>
          <Show when={banner()} fallback={<div class="banner-body">{nowPlaying()?.info.subtitle ?? ""}</div>}>
            {(b) => (
              <div class="banner-body">
                <div class="banner-row" classList={{ dim: showNext() }}>
                  <span class="banner-when">Now</span>
                  <span class="banner-title">{b().now?.title ?? "No information"}</span>
                  <Show when={b().now}>
                    <span class="banner-time">
                      {clockTime(b().now!.start)}–{clockTime(b().now!.end)}
                    </span>
                  </Show>
                </div>
                <Show when={b().now}>
                  <Progress value={progress(b().now!.start, b().now!.end)} class="banner-progress" />
                </Show>
                <div class="banner-row" classList={{ dim: !showNext() }}>
                  <span class="banner-when">Next</span>
                  <span class="banner-title">{b().next?.title ?? ""}</span>
                  <Show when={b().next}>
                    <span class="banner-time">{clockTime(b().next!.start)}</span>
                  </Show>
                </div>
                <p class="banner-description">{(showNext() ? b().next : b().now)?.description ?? ""}</p>
                <Show when={!browsing() && playerState().status === "paused"}>
                  <p class="banner-paused">
                    <Icon name="pause" /> Paused · press Play to carry on
                  </p>
                </Show>
              </div>
            )}
          </Show>
          <div class="banner-hints">
            <span>
              <kbd>▲▼</kbd> Other channels
            </span>
            <span>
              <kbd class="key-red" /> Record
            </span>
            <span>
              <kbd class="key-yellow" /> Options
            </span>
          </div>
        </div>
      </Show>

      {/* On-demand OSD */}
      <Show when={!live() && osd()}>
        {(() => {
          const st = playerState;
          const np = nowPlaying;
          const duration = () => st().durationMs ?? np()?.info.durationMs ?? 0;
          return (
            <div class="osd">
              <div class="osd-title">
                <h2>{np()?.info.title}</h2>
                <Show when={np()?.info.subtitle}>
                  <p>{np()!.info.subtitle}</p>
                </Show>
              </div>
              <div class="osd-bar">
                <Icon name={st().status === "paused" ? "pause" : "play"} class="osd-state" />
                <span class="osd-time">{fmt(st().positionMs)}</span>
                <Progress value={duration() ? st().positionMs / duration() : 0} class="osd-progress" />
                <span class="osd-time">{duration() ? `-${fmt(duration() - st().positionMs)}` : ""}</span>
              </div>
              <div class="osd-meta">
                <Show when={np()?.info.source}>
                  <span class={`badge badge-source badge-${np()!.info.source!.kind}`}>From {np()!.info.source!.label}</span>
                </Show>
                <Show when={st().video}>
                  <span>
                    {st().video!.height >= 2000 ? "4K" : st().video!.height >= 1000 ? "HD" : "SD"}
                    {st().video!.hdr && st().video!.hdr !== "SDR" ? ` · ${st().video!.hdr}` : ""}
                  </span>
                </Show>
                <Show when={duration()}>
                  <span>Ends at {clockTime(Date.now() + duration() - st().positionMs)}</span>
                </Show>
                <span>
                  <kbd>◀▶</kbd> Skip back and forward
                </span>
                <span>
                  <kbd class="key-yellow" /> Audio and subtitles
                </span>
              </div>
            </div>
          );
        })()}
      </Show>

      <Show when={!live() && skip() && !showNextCard()}>
        <button class="skip-button" data-focus>
          Skip {skip()!.kind === "credits" ? "credits" : skip()!.kind} <kbd>OK</kbd>
        </button>
      </Show>

      <Show when={showNextCard() && upNext()}>
        {(next) => (
          <div class="up-next">
            <Show when={next().image}>
              <img class="up-next-image" src={next().image} alt="" />
            </Show>
            <div class="up-next-body">
              <p class="up-next-label">{nextLabel()}</p>
              <h3>{next().name}</h3>
              <Show when={next().overview}>
                <p class="up-next-overview">{next().overview}</p>
              </Show>
              <p class="up-next-keys">
                <kbd>OK</kbd> Play now · <kbd>Back</kbd> Hide
              </p>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
