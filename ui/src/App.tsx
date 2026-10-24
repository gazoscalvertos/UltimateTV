// The shell: picks the screen for the current route, keeps focus somewhere sensible, and
// handles things that can happen anywhere (reminders, a recording taking the connection,
// the TV going to standby).

import { createEffect, ErrorBoundary, For, Match, on, onCleanup, onMount, Switch } from "solid-js";
import { agent } from "./agent";
import { ApiError, hub, session } from "./api";
import { choose, DialogHost } from "./components/Dialog";
import { startEvents, onHubEvent } from "./events";
import { activeLayer, current, focus, focusFirst } from "./focus";
import { onBack, useKeys } from "./keys";
import { channels, isLive, liveChannelId, loadChannels, nowPlaying, play, stopPlayback } from "./player";
import { Browse } from "./screens/Browse";
import { Details } from "./screens/Details";
import { Guide } from "./screens/Guide";
import { Home } from "./screens/Home";
import { Planner } from "./screens/Planner";
import { Player } from "./screens/Player";
import { Profiles } from "./screens/Profiles";
import { Search } from "./screens/Search";
import { Settings } from "./screens/Settings";
import { closeTopDialog, nav, setProfile, toast, toasts } from "./store";
import { startRemoteBridge } from "./remote";

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
    window.addEventListener("keydown", onKey, true);
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
    });
  });

  onMount(() => {
    startEvents();
    startRemoteBridge();
    void restoreSession();
    onCleanup(
      onHubEvent(async (e) => {
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
          return;
        }
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
          <Match when={nav.current().name === "settings"}>
            <Settings />
          </Match>
        </Switch>
      </ErrorBoundary>
      <DialogHost />
      <div class="toasts">
        <For each={toasts()}>{(t) => <div class={`toast toast-${t.tone}`}>{t.message}</div>}</For>
      </div>
    </>
  );
}
