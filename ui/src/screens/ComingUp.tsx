// Coming up (issue #226): the next seven days of air dates for the series this profile follows, the
// episodes that have just arrived, and the list of what's followed. OK on an air date offers Remind
// and Record when the guide has it on one of the channels.

import { For, Index, onMount, Show } from "solid-js";
import { newEpisodeLabel } from "@ultimatetv/shared";
import type { ComingUpEpisode, FollowedSeries, NewEpisode } from "@ultimatetv/shared";
import { clockTime, dayLabel } from "@ultimatetv/shared";
import { hub } from "../api";
import { choose } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { followingView, refetchFollowing, setFollowing } from "../following";
import { play } from "../player";
import { errorToast, nav, toast } from "../store";

const reasonLabel: Record<FollowedSeries["reason"], string> = {
  followed: "Followed",
  saved: "From Saved for later",
  watching: "From Continue watching",
  link: "From a series link",
  queue: "From your queue",
};

async function pickUpcoming(c: ComingUpEpisode): Promise<void> {
  const next = c.next;
  const pick = await choose({
    title: `${c.title.name} · ${newEpisodeLabel(c)}`,
    message: next ? `${c.when}. ${next.when}.` : `${c.when}. It isn't on any of your channels yet.`,
    options: [
      ...(next ? [{ label: `Remind me at ${clockTime(next.start)}`, value: "remind", icon: "bell" as const }, { label: "Record it", value: "record", icon: "record" as const }] : []),
      { label: "Open the series", value: "open", icon: "info" as const },
      { label: "Stop following", value: "stop" },
      { label: "Back", value: "back" },
    ],
  });
  try {
    if (pick === "remind" && next) {
      await hub.remind(next.programmeId);
      toast(`Reminder set for ${c.title.name}`, "good");
    }
    if (pick === "record" && next) {
      await hub.record(next.programmeId);
      toast(`Recording ${c.title.name}`, "good");
    }
    if (pick === "open") nav.push({ name: "details", id: c.title.id });
    if (pick === "stop") await setFollowing(c.title, false);
  } catch (err) {
    errorToast(err);
  }
}

async function pickNew(e: NewEpisode): Promise<void> {
  const pick = await choose({
    title: `${e.title.name} · ${newEpisodeLabel(e)}`,
    message: e.inLibrary ? "It's in your library now." : `Aired ${dayLabel(e.at)}.`,
    options: [
      { label: "Play it", value: "play", icon: "play" as const },
      { label: "Open the series", value: "open", icon: "info" as const },
      { label: "Stop following", value: "stop" },
      { label: "Back", value: "back" },
    ],
  });
  try {
    if (pick === "play") await play({ kind: "title", id: e.title.id, episodeId: e.episodeId }, { title: { ...e.title, episodeId: e.episodeId } });
    if (pick === "open") nav.push({ name: "details", id: e.title.id });
    if (pick === "stop") await setFollowing(e.title, false);
  } catch (err) {
    errorToast(err);
  }
}

export function ComingUpScreen() {
  const v = () => followingView();
  // The dates change under a TV that stays on: look again every time the screen opens.
  onMount(() => void refetchFollowing());
  const togglePopups = async () => {
    try {
      await hub.setFollowPopups(!v()?.popups);
      toast(v()?.popups ? "No pop-ups for new episodes" : "A pop-up will tell you when a new episode arrives", "good");
    } catch (err) {
      errorToast(err);
    }
  };
  return (
    <div class="screen planner coming-up" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="160">
        <div class="planner-head" data-row>
          <h1 class="page-title">Coming up</h1>
          <p class="muted">New episodes of the series you follow. Follow one from its page; the ones you save, watch or record are followed for you.</p>
        </div>
        <Show when={v()} fallback={<p class="empty">Looking…</p>}>
          {(view) => (
            <>
              <Show when={view().newEpisodes.length}>
                <h3 class="rail-title" data-row>New episodes</h3>
                <div class="list">
                  <Index each={view().newEpisodes}>
                    {(e, i) => (
                      <button class="list-row" data-row data-focus data-autofocus={i === 0 ? "" : undefined} onClick={() => void pickNew(e())}>
                        <Show when={e().title.poster} fallback={<div class="list-art card-fallback" />}>
                          <img class="list-art" src={e().title.poster} alt="" />
                        </Show>
                        <span class="list-main">
                          <span class="list-title">
                            {e().title.name} <span class="flag">New</span>
                          </span>
                          <span class="list-sub">
                            {newEpisodeLabel(e())} · {e().inLibrary ? "In your library" : dayLabel(e().at)}
                          </span>
                        </span>
                        <Icon name="play" class="list-icon" />
                      </button>
                    )}
                  </Index>
                </div>
              </Show>
              <h3 class="rail-title" data-row>Next seven days</h3>
              <Show
                when={view().comingUp.length}
                fallback={
                  <p class="empty" data-row>
                    {!view().followed.length
                      ? "You aren't following any series yet. Open a series and choose Follow."
                      : !view().schedule
                        ? "Air dates need a TMDB key (Settings › Sources). New episodes from your library still show above."
                        : "Nothing is due in the next seven days."}
                  </p>
                }
              >
                <div class="list">
                  <Index each={view().comingUp}>
                    {(c, i) => (
                      <button class="list-row" data-row data-focus data-autofocus={i === 0 && !view().newEpisodes.length ? "" : undefined} onClick={() => void pickUpcoming(c())}>
                        <Show when={c().title.poster} fallback={<div class="list-art card-fallback" />}>
                          <img class="list-art" src={c().title.poster} alt="" />
                        </Show>
                        <span class="list-main">
                          <span class="list-title">{c().title.name}</span>
                          <span class="list-sub">
                            {newEpisodeLabel(c())} · {c().when}
                            {c().next ? ` · ${c().next!.when}` : ""}
                          </span>
                        </span>
                        <Icon name={c().next ? "record" : "info"} class="list-icon" />
                      </button>
                    )}
                  </Index>
                </div>
              </Show>
              <Show when={view().followed.length}>
                <h3 class="rail-title" data-row>Following</h3>
                <div class="list">
                  <For each={view().followed}>
                    {(f) => (
                      <button
                        class="list-row"
                        data-row
                        data-focus
                        onClick={async () => {
                          const pick = await choose({
                            title: f.title.name,
                            message: reasonLabel[f.reason],
                            options: [{ label: "Open the series", value: "open", icon: "info" as const }, { label: "Stop following", value: "stop" }, { label: "Back", value: "back" }],
                          });
                          if (pick === "open") nav.push({ name: "details", id: f.title.id });
                          if (pick === "stop") await setFollowing(f.title, false).catch(errorToast);
                        }}
                      >
                        <span class="list-main">
                          <span class="list-title">{f.title.name}</span>
                          <span class="list-sub">{reasonLabel[f.reason]}</span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <div class="list" data-row>
                <button class="list-row" data-row data-focus onClick={() => void togglePopups()}>
                  <span class="list-main">
                    <span class="list-title">Pop-up when a new episode arrives</span>
                    <span class="list-sub">{view().popups ? "On" : "Off"}</span>
                  </span>
                  <Icon name="bell" class="list-icon" />
                </button>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
