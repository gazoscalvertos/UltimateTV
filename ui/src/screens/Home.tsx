// Home: a hero for what you were watching or what's new, then your play queue and rails (live
// now, continue watching, recordings, films on TV tonight, trending, recently added).

import { createEffect, createResource, For, onCleanup, Show } from "solid-js";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { QueueRow } from "../components/QueueRow";
import { RailRow } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { HOME_KEYS, useHints } from "../hints";
import { useKeys } from "../keys";
import { play } from "../player";
import { errorToast, isKids, nav, toast } from "../store";
import { choose } from "../components/Dialog";
import { continueOptions, undoLabel, type ContinuePick } from "../continueWatching";
import { castSettings } from "../cast";
import { HomeWeather } from "../components/HomeWeather";
import { featureOn, shownRails, titleShown } from "../features";
import { current } from "../focus";
import { markHome } from "../perf";
import type { TitleRef, WatchItem } from "@ultimatetv/shared";

type SavedPick = "record" | "remind" | "open";

export function Home() {
  const [home, { refetch }] = createResource(() => hub.home());
  // #108: Home is usable once its content is drawn and the remote lands somewhere. Both happen a
  // frame or two apart, so keep looking until both are true and stop after that.
  // ("markHome" ignores the call when no profile was picked, e.g. a reload straight into Home.)
  createEffect(() => {
    if (!home()) return;
    let raf = 0;
    let tries = 0;
    const look = () => {
      if (current()) return markHome(); // the remote would land somewhere: Home is usable
      if (++tries < 90) raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);
    onCleanup(() => cancelAnimationFrame(raf));
  });
  // What's switched off on this screen (features.ts) leaves Home too.
  const hero = () => {
    const h = home()?.hero;
    return h && titleShown(h) && (h.action !== "live" || featureOn("live")) ? h : undefined;
  };
  // Refreshed only when a recording finishes, the watchlist or favourites change, or something stops playing
  // (Continue watching), so the rails don't shift under the remote otherwise.
  onCleanup(onHubEvent((e) => (e.type === "recording.finished" || e.type === "watchlist.changed" || e.type === "favourites.changed" || e.type === "progress.changed" ? void refetch() : undefined)));

  // The colour keys are shortcuts on Home, as on Sky.
  const castOk = () => !isKids() || castSettings().gamesForKids;
  useHints(() => HOME_KEYS.filter((h) => h.key !== "blue" || castOk()));
  useKeys((a) => {
    if (a === "red") nav.push({ name: "planner" });
    else if (a === "green") nav.push({ name: "guide" });
    else if (a === "yellow") nav.push({ name: "search" });
    else if (a === "blue" && castOk()) nav.push({ name: "cast" });
    else return false;
    return true;
  });

  // Options on a Continue watching card (issue #100): Resume, Mark as watched, Remove. Removing
  // hides it for this profile and offers Undo for a few seconds, so a film abandoned after ten
  // minutes stops sitting at the front of Home.
  const pickContinue = async (t: TitleRef) => {
    const pick = await choose<ContinuePick>({ title: t.name, ...(t.subtitle ? { message: t.subtitle } : {}), ...(t.backdrop ?? t.poster ? { image: (t.backdrop ?? t.poster)! } : {}), options: continueOptions(t) });
    try {
      if (pick === "play") void play({ kind: "title", id: t.id, ...(t.episodeId ? { episodeId: t.episodeId } : {}) }, { title: t });
      else if (pick === "watched") await hub.markContinueWatched(t.id);
      else if (pick === "hide") {
        await hub.hideFromContinue(t.id, true);
        toast(undoLabel(t), "good", { label: "Undo", run: () => void hub.hideFromContinue(t.id, false) });
      } else return;
      void refetch();
    } catch (err) {
      errorToast(err);
    }
  };

  // Options on a Saved for later card (issue #74): when the guide knows the title is on again the
  // menu offers one-press Record and Remind, so the list turns into something that records itself.
  // The airing lives on the saved item rather than the card, so it's fetched when the menu opens
  // (Details has its own Save toggle, which is where a title with nothing coming up goes).
  const pickSaved = async (t: TitleRef) => {
    // A Saved for later card only ever carries a subtitle when the Hub found an airing for it, so
    // anything else opens the title as it always did, without an ask.
    if (!t.subtitle?.startsWith("On ")) return nav.push({ name: "details", id: t.id });
    let item: WatchItem | undefined;
    try {
      item = (await hub.watchlist()).items.find((i) => i.title?.id === t.id);
    } catch (err) {
      errorToast(err);
      return;
    }
    const next = item?.next;
    if (!next) return nav.push({ name: "details", id: t.id });
    const pick = await choose<SavedPick>({
      title: t.name,
      message: next.when,
      ...(t.backdrop ?? t.poster ? { image: (t.backdrop ?? t.poster)! } : {}),
      options: [
        { label: "Record it", value: "record", icon: "record", detail: `${next.channelName} · Red` },
        { label: "Remind me", value: "remind", icon: "bell", detail: `${next.when} · Green` },
        { label: "Open", value: "open", icon: "info" },
      ],
      // Red records, Green reminds, as the rest of the app does for a programme (#74).
      keys: { red: "record", green: "remind" },
    });
    try {
      if (pick === "record") {
        await hub.record(next.programmeId);
        toast(`${t.name} is set to record on ${next.channelName}.`, "good");
      } else if (pick === "remind") {
        await hub.remind(next.programmeId);
        toast(`We'll remind you about ${t.name} · ${next.when.replace(/^On /, "")}.`, "good");
      } else if (pick === "open") nav.push({ name: "details", id: t.id });
      else return;
      void refetch();
    } catch (err) {
      errorToast(err);
    }
  };

  return (
    <div class="screen home" data-layer>
      <Show when={hero()}>
        {(hero) => (
          <div class="hero-bg">
            <img src={hero().backdrop} alt="" />
          </div>
        )}
      </Show>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <HomeWeather />
        <Show when={home()} fallback={<div class="spinner" />}>
          <Show when={hero()}>
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
                    onClick={() => (hero().action === "resume" ? void play({ kind: "title", id: hero().id, ...(hero().episodeId ? { episodeId: hero().episodeId! } : {}) }, { title: hero() }) : nav.push({ name: "details", id: hero().id }))}
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
          <For each={shownRails(home()!.rails)}>
            {(rail) =>
              rail.id === "continue" ? (
                <RailRow rail={rail} onPick={(t) => void pickContinue(t)} />
              ) : rail.id === "watchlist" ? (
                <RailRow rail={rail} onPick={(t) => void pickSaved(t)} />
              ) : (
                <RailRow rail={rail} />
              )
            }
          </For>
        </Show>
      </div>
    </div>
  );
}
