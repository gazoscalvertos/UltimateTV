// The shell: picks the screen for the current route, keeps focus somewhere sensible, and
// handles things that can happen anywhere (reminders, a recording taking the connection,
// the TV going to standby).

import { createEffect, ErrorBoundary, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { resolveTheme } from "@ultimatetv/shared";
import { agent } from "./agent";
import { ApiError, hub, session } from "./api";
import { choose, DialogHost } from "./components/Dialog";
import { EasterEggs } from "./components/EasterEggs";
import { Halloween } from "./components/Halloween";
import { ThemeDecor } from "./components/ThemeDecor";
import { JumpScare } from "./components/JumpScare";
import { NewsFlash } from "./components/NewsFlash";
import { ScreensaverLayer } from "./components/Screensaver";
import { Notices } from "./components/Notices";
import { StartingCard } from "./components/Starting";
import { startEvents, onHubEvent } from "./events";
import { activeLayer, current, focus, focusFirst } from "./focus";
import { onAnyKey, onBack, useKeys } from "./keys";
import { channels, isLive, liveChannelId, loadChannels, nowPlaying, play, starting, cancelStarting, stopPlayback } from "./player";
import { activeMusic, musicPlayPause, pauseAllMusic, startMusic } from "./music";
import { Browse } from "./screens/Browse";
import { Details } from "./screens/Details";
import { Guide } from "./screens/Guide";
import { GuideEditor } from "./screens/GuideEditor";
import { Home } from "./screens/Home";
import { MixChannelScreen } from "./screens/MixChannel";
import { Music } from "./screens/Music";
import { MusicList } from "./screens/MusicList";
import { Planner } from "./screens/Planner";
import { Player } from "./screens/Player";
import { Profiles } from "./screens/Profiles";
import { Search } from "./screens/Search";
import { Settings } from "./screens/Settings";
import { Weather } from "./screens/Weather";
import { startWeather } from "./weather";
import { closeTopDialog, nav, setAppName, setProfile, setTheme, toast, toasts } from "./store";
import { startPhoneBridge } from "./phone";
import { startQueue } from "./queue";
import { startDownloads } from "./downloads";
import { startSaveNotices } from "./save";
import { DownloadsScreen } from "./screens/Downloads";
import { pairingWait, pairScreen } from "./pairing";
import { startRemoteBridge } from "./remote";
import { startIdle, wake } from "./idle";
import { startCast } from "./cast";
import { startSleep } from "./sleep";
import { CastScreen } from "./screens/Cast";
import { KeyHints, openHelp } from "./components/KeyHints";
import { AlertCard, MirroringLayer, ScreenShareLayer, SleepWarning } from "./components/Overlays";
import { ProjectionLayer } from "./components/Projection";

function ScreenError(props: { error: unknown; reset: () => void }) {
  const message = props.error instanceof ApiError && props.error.status === 403 ? "That isn't available on this profile." : props.error instanceof Error ? props.error.message : "Something went wrong.";
  return (
    <div class="screen error-screen" data-layer>
      <h1>{message}</h1>
      <div class="dialog-options">
        <button class="btn btn-primary" data-focus data-autofocus onClick={() => (nav.back() ? props.reset() : (nav.reset({ name: "home" }), props.reset()))}>
          Go back
        </button>
        <button class="btn" data-focus onClick={props.reset}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** Over everything while a title is looked up: Back cancels it, other keys wait. */
function StartingLayer(props: { name: string; since: number }) {
  useKeys((a) => {
    if (a === "back") cancelStarting();
    return true;
  });
  return (
    <div class="starting-layer">
      <StartingCard title={props.name} step="Finding the best version" since={props.since} />
    </div>
  );
}

async function restoreSession(): Promise<void> {
  try {
    const { profiles, current } = await hub.profiles();
    const saved = profiles.find((p) => p.id === session.profileId);
    // The Hub agrees we're still on the saved profile (a PIN profile needs a valid token).
    if (saved && current === saved.id) {
      setProfile(saved);
      await loadChannels();
      const settings = await hub.settings().catch(() => null);
      if (settings?.playback.startOn === "live") {
        const first = liveChannelId() ?? (await hub.channels()).channels[0]?.id;
        nav.reset({ name: "home" });
        if (first) void play({ kind: "channel", id: first });
      } else nav.reset({ name: "home" });
    }
  } catch {
    // Hub not reachable yet: stay on the profile picker, which retries when opened.
  }
}

export function App() {
  onBack(() => {
    if (closeTopDialog()) return;
    nav.back();
  });

  // Global keys, lowest priority: anything a screen doesn't use.
  useKeys((a) => {
    if (nav.current().name === "profiles") return false;
    if (a === "guide" && nav.current().name !== "guide") {
      nav.push({ name: "guide" });
      return true;
    }
    if (a === "home") {
      nav.reset({ name: "home" });
      return true;
    }
    // Info on a screen that doesn't use it: what the buttons do.
    if (a === "info" && nav.current().name !== "player") {
      void openHelp();
      return true;
    }
    // Music playing and no video: Play/Pause is the music's, on any screen.
    if (a === "playPause" && !nowPlaying() && activeMusic()) {
      void musicPlayPause();
      return true;
    }
    if ((a === "channelUp" || a === "channelDown") && !isLive()) {
      const id = liveChannelId() ?? channels()[0]?.id;
      if (id) void play({ kind: "channel", id });
      return true;
    }
    return false;
  });

  // Keep something focused. Until the remote is pressed on a new screen, focus follows its
  // `data-autofocus` item as content loads in; after that, only lost focus is put back.
  onMount(() => {
    let scheduled = false;
    let touched = false;
    const onKey = () => (touched = true);
    // Typing into a box counts too, though those keys never reach dispatch.
    window.addEventListener("keydown", onKey, true);
    const offAnyKey = onAnyKey(onKey);
    createEffect(on(nav.stack, () => (touched = false)));
    const check = () => {
      scheduled = false;
      const layer = activeLayer();
      if (layer === document.body) return;
      const auto = layer.querySelector<HTMLElement>("[data-autofocus]");
      if (!touched && auto && document.activeElement !== auto && !layer.hasAttribute("data-focus-free")) focusFirst();
      else if (!current()) {
        // Switching with the top menu keeps you on the menu, as on Sky.
        const tab = layer.querySelector<HTMLElement>(".tab.active");
        if (!auto && tab) focus(tab);
        else focusFirst();
      }
    };
    const observer = new MutationObserver(() => {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(check);
      }
    });
    observer.observe(document.getElementById("app")!, { childList: true, subtree: true });
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("keydown", onKey, true);
      offAnyKey();
    });
  });

  onMount(() => {
    // The Hub only sends events to a paired screen.
    void pairScreen().then(startEvents);
    startRemoteBridge();
    startPhoneBridge();
    startIdle();
    startQueue();
    startDownloads();
    startCast();
    startSleep();
    startSaveNotices();
    startWeather();
    void startMusic();
    void restoreSession();
    const loadLook = () =>
      hub.settings().then((s) => {
        setAppName(s.appName);
        setTheme(resolveTheme(s));
      }, () => undefined);
    void loadLook();
    // The seasonal themes come and go by the date: look again every hour rather than leaving the
    // theme a day behind on a TV that is never reloaded.
    const lookTimer = window.setInterval(loadLook, 60 * 60_000);
    onCleanup(() => window.clearInterval(lookTimer));
    onCleanup(
      onHubEvent(async (e) => {
        if (e.type === "settings.changed") void loadLook();
        if (e.type === "reminder") {
          const r = e.reminder;
          const pick = await choose({
            title: `${r.programme.title} is starting`,
            message: `On ${r.channelName} now.`,
            options: [
              { label: "Watch now", value: "watch", icon: "play" },
              { label: "Not now", value: "no" },
            ],
          });
          if (pick === "watch") void play({ kind: "channel", id: r.channelId });
        }
        if (e.type === "connection.conflict") {
          toast(e.message, "bad");
          // The recording now owns the connection and shares it: follow it.
          if (isLive() && e.recording) void play({ kind: "channel", id: e.recording.channelId });
        }
        if (e.type === "recording.started" && !nowPlaying()) toast(`Recording ${e.recording.programme.title}`);
        if (e.type === "recording.finished") toast(`${e.recording.programme.title} has recorded`, "good");
        if (e.type === "profiles.changed") {
          const { profiles } = await hub.profiles().catch(() => ({ profiles: [] }));
          const mine = profiles.find((p) => p.id === session.profileId);
          if (mine) setProfile(mine);
        }
      }),
    );
    // TV off: stop playing. TV back on: Home, or the profile picker if a PIN is set.
    onCleanup(
      agent.onPower(async (active) => {
        if (!active) {
          await stopPlayback();
          await pauseAllMusic();
          return;
        }
        wake();
        const { locked } = await hub.profiles().catch(() => ({ locked: false }));
        nav.reset({ name: locked ? "profiles" : "home" });
      }),
    );
  });

  return (
    <>
      <ErrorBoundary fallback={(err, reset) => <ScreenError error={err} reset={reset} />}>
        <Switch>
          <Match when={nav.current().name === "profiles"}>
            <Profiles />
          </Match>
          <Match when={nav.current().name === "home"}>
            <Home />
          </Match>
          <Match when={nav.current().name === "guide"}>
            <Guide />
          </Match>
          <Match when={(() => { const r = nav.current(); return r.name === "guide-edit" ? r : null; })()}>
            {(r) => <GuideEditor {...(r().id ? { id: r().id } : {})} />}
          </Match>
          <Match when={nav.current().name === "player"}>
            <Player />
          </Match>
          <Match when={(() => { const r = nav.current(); return r.name === "browse" ? r : null; })()}>
            {(r) => <Browse kind={r().kind} />}
          </Match>
          <Match when={(() => { const r = nav.current(); return r.name === "details" ? r : null; })()}>
            {(r) => <Details id={r().id} />}
          </Match>
          <Match when={nav.current().name === "search"}>
            <Search />
          </Match>
          <Match when={(() => { const r = nav.current(); return r.name === "planner" ? r : null; })()}>
            {(r) => <Planner {...(r().tab ? { tab: r().tab } : {})} />}
          </Match>
          <Match when={(() => { const r = nav.current(); return r.name === "settings" ? r : null; })()}>
            {(r) => <Settings {...(r().section ? { section: r().section } : {})} />}
          </Match>
          <Match when={(() => { const r = nav.current(); return r.name === "mix-channel" ? r : null; })()}>
            {(r) => <MixChannelScreen id={r().id} />}
          </Match>
          <Match when={nav.current().name === "downloads"}>
            <DownloadsScreen />
          </Match>
          <Match when={nav.current().name === "music"}>
            <Music />
          </Match>
          <Match when={nav.current().name === "cast"}>
            <CastScreen />
          </Match>
          <Match when={nav.current().name === "weather"}>
            <Weather />
          </Match>
          <Match when={(() => { const r = nav.current(); return r.name === "music-list" ? r : null; })()}>
            {(r) => <MusicList item={r().item} />}
          </Match>
        </Switch>
      </ErrorBoundary>
      <Show when={starting()}>{(st) => <StartingLayer name={st().name} since={st().since} />}</Show>
      <Show when={pairingWait()}>
        {(w) => (
          <div class="pairing-wait">
            <div>
              <h1>Let this screen in</h1>
              <p>Only paired screens can show what's on and be worked from a phone. On a paired phone, open the Hub's settings page and choose Phones; or on your TV, Settings › Phones and remotes. Let in “{w().name}” when it shows this code:</p>
              <div class="pairing-code">{w().code}</div>
            </div>
          </div>
        )}
      </Show>
      <KeyHints />
      <ProjectionLayer />
      <Halloween />
      <ThemeDecor />
      <EasterEggs />
      <NewsFlash />
      <Notices />
      <JumpScare />
      <ScreenShareLayer />
      <MirroringLayer />
      <AlertCard />
      <SleepWarning />
      <DialogHost />
      <div class="toasts">
        <For each={toasts()}>{(t) => <div class={`toast toast-${t.tone}`}>{t.message}</div>}</For>
      </div>
      <ScreensaverLayer />
    </>
  );
}
