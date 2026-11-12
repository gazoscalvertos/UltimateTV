// Sport tonight (issue #231): what's on now and today, your teams' games over the next week, and the
// teams and sports you follow. OK on a game offers Watch / Record / Remind and following a side.

import { For, Index, onMount, Show } from "solid-js";
import { hub } from "../api";
import { askText } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { addTeam, pickMatch, refetchSport, sportCall, sportView } from "../sport";
import { errorToast, toast } from "../store";
import type { SportMatch } from "@ultimatetv/shared";

function Row(props: { m: SportMatch; first: boolean }) {
  const m = () => props.m;
  return (
    <button class="list-row" data-row data-focus data-autofocus={props.first ? "" : undefined} onClick={() => void pickMatch(m())}>
      <Show when={m().programme.image} fallback={<div class="list-art card-fallback" />}>
        <img class="list-art" src={m().programme.image} alt="" />
      </Show>
      <span class="list-main">
        <span class="list-title">
          {m().programme.title} <Show when={m().live}><span class="flag flag-rec">LIVE</span></Show>
          <Show when={m().favourite}>
            <span class="flag">
              <Icon name="hearted" /> {m().favourite}
            </span>
          </Show>
        </span>
        <span class="list-sub">
          {m().when} · {m().channelName}
          {m().reminder ? " · Reminder set" : m().recording ? " · Recording" : ""}
        </span>
      </span>
      <Icon name={m().recording ? "record" : m().reminder ? "bell" : "info"} class="list-icon" />
    </button>
  );
}

export function SportScreen() {
  const v = () => sportView();
  onMount(() => void refetchSport());
  const toggle = async (key: "remind" | "record") => {
    const on = !v()?.[key];
    await sportCall(() => hub.sportSettings({ [key]: on }));
    toast(key === "remind" ? (on ? "A reminder is set when your teams are on" : "No automatic reminders") : on ? "Your teams' games are recorded too" : "Automatic recording is off", "good");
  };
  const add = async () => {
    const name = await askText("Team or sport to follow", "", "Arsenal, Formula 1, Six Nations… (the guide's titles and descriptions are searched)");
    if (name) await addTeam(name).catch(errorToast);
  };
  return (
    <div class="screen planner sport" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="160">
        <div class="planner-head" data-row>
          <h1 class="page-title">Sport tonight</h1>
          <p class="muted">Live and upcoming sport in the guide, soonest first. Follow a team or a sport and a reminder is set when it's on.</p>
        </div>
        <Show when={v()} fallback={<p class="empty">Looking…</p>}>
          {(view) => (
            <>
              <h3 class="rail-title" data-row>On now and today</h3>
              <Show when={view().matches.length} fallback={<p class="empty" data-row>{view().available ? "No sport in the guide for the rest of today." : "Sport isn't switched on for this profile."}</p>}>
                <div class="list">
                  <Index each={view().matches}>{(m, i) => <Row m={m()} first={i === 0} />}</Index>
                </div>
              </Show>
              <Show when={view().mine.length}>
                <h3 class="rail-title" data-row>Your teams, the next seven days</h3>
                <div class="list">
                  <Index each={view().mine}>{(m) => <Row m={m()} first={false} />}</Index>
                </div>
              </Show>
              <h3 class="rail-title" data-row>Teams and sports you follow</h3>
              <div class="list">
                <For each={view().teams}>
                  {(t) => (
                    <button
                      class="list-row"
                      data-row
                      data-focus
                      onClick={async () => {
                        await sportCall(() => hub.sportRemoveTeam(t));
                        toast(`Stopped following ${t}`);
                      }}
                    >
                      <span class="list-main">
                        <span class="list-title">{t}</span>
                        <span class="list-sub">OK to stop following</span>
                      </span>
                      <Icon name="hearted" class="list-icon" />
                    </button>
                  )}
                </For>
                <button class="list-row" data-row data-focus onClick={() => void add()}>
                  <span class="list-main">
                    <span class="list-title">Follow a team or sport…</span>
                    <span class="list-sub">{view().teams.length ? "Add another" : "Nothing followed yet"}</span>
                  </span>
                  <Icon name="heart" class="list-icon" />
                </button>
              </div>
              <div class="list" data-row>
                <button class="list-row" data-row data-focus onClick={() => void toggle("remind")}>
                  <span class="list-main">
                    <span class="list-title">Remind me when they're on</span>
                    <span class="list-sub">{view().remind ? "On" : "Off"}</span>
                  </span>
                  <Icon name="bell" class="list-icon" />
                </button>
                <button class="list-row" data-row data-focus onClick={() => void toggle("record")}>
                  <span class="list-main">
                    <span class="list-title">Record their games too</span>
                    <span class="list-sub">{view().record ? "On: each game is recorded as it appears in the guide" : "Off"}</span>
                  </span>
                  <Icon name="record" class="list-icon" />
                </button>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
