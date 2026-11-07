// Watching elsewhere: what the other TVs, phones and tablets in the house are playing, with
// "Resume here" (carry on from the same place, stopping it there or not) and "Sync play" (the
// same thing on both, pausing and skipping together).

import { createSignal, Index, onCleanup, onMount, Show } from "solid-js";
import type { WatchSession } from "@ultimatetv/shared";
import { watchLine } from "@ultimatetv/shared";
import { choose } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { Progress } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { errorToast, toast } from "../store";
import { elsewhere, loadElsewhere, placeOf, resumeHere, syncGroup, syncWith } from "../watching";

const clientLabel = (s: WatchSession) => (s.client === "android" ? "Android" : s.client === "tv" ? "TV" : s.client === "desktop" ? "Computer" : "Browser");

/** What happens when you pick one: the choices, then doing it. */
export async function carryOn(s: WatchSession): Promise<void> {
  const canSync = !s.stopped;
  const pick = await choose({
    title: s.name + (s.subtitle ? ` · ${s.subtitle}` : ""),
    message: watchLine(s, placeOf(s)),
    options: [
      { label: s.live ? "Watch here" : "Resume here", value: "here", icon: "play" },
      ...(!s.stopped ? [{ label: s.live ? `Watch here and switch off ${s.deviceName}` : `Move here (stop it on ${s.deviceName})`, value: "move", icon: "next" }] : []),
      ...(canSync ? [{ label: s.live ? "Sync play (both on this channel)" : "Sync play (pause and skip together)", value: "sync", icon: "screens" }] : []),
      { label: "Back", value: "back" },
    ],
  });
  try {
    if (pick === "here") await resumeHere(s, false);
    if (pick === "move") await resumeHere(s, true);
    if (pick === "sync" && (await syncWith(s))) toast(`Sync play with ${s.deviceName}: pausing or skipping on one does both`);
  } catch (err) {
    errorToast(err);
  }
}

export function ElsewhereScreen() {
  const [loaded, setLoaded] = createSignal(false);
  const refresh = () =>
    loadElsewhere()
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  onMount(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 5000);
    onCleanup(() => window.clearInterval(t));
  });

  return (
    <div class="screen planner elsewhere" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="160">
        <div class="planner-head" data-row>
          <h1 class="page-title">Watching elsewhere</h1>
          <p class="muted">Carry on from another TV, phone or tablet, or watch the same thing together with Sync play.</p>
        </div>
        <Show when={syncGroup()}>
          {(g) => (
            <p class="muted sync-banner" data-row>
              <Icon name="screens" /> In Sync play: {g().name} with {g().members.map((m) => m.deviceName).join(", ")}
            </p>
          )}
        </Show>
        <Show
          when={elsewhere().length}
          fallback={<p class="empty">{loaded() ? "Nothing is playing on the other screens. Start something on a phone, a tablet or another TV and it shows up here." : "Looking…"}</p>}
        >
          <div class="list">
            <Index each={elsewhere()}>
              {(s, i) => (
                <button class="list-row" data-row data-focus data-autofocus={i === 0 ? "" : undefined} onClick={() => void carryOn(s())}>
                  <Show when={s().artwork} fallback={<div class="list-art card-fallback" />}>
                    <img class="list-art" src={s().artwork} alt="" />
                  </Show>
                  <span class="list-main">
                    <span class="list-title">
                      {s().name}
                      <Show when={s().sync}>
                        <span class="flag">Sync play</span>
                      </Show>
                      <Show when={s().stopped}>
                        <span class="flag">Stopped</span>
                      </Show>
                    </span>
                    <Show when={s().subtitle}>
                      <span class="list-sub">{s().subtitle}</span>
                    </Show>
                    <span class="list-sub">
                      {watchLine(s(), placeOf(s()))} · {clientLabel(s())}
                      {s().profile ? ` · ${s().profile!.name}` : ""}
                    </span>
                    <Show when={!s().live && s().durationMs}>
                      <Progress value={placeOf(s()) / s().durationMs!} class="list-progress" />
                    </Show>
                  </span>
                  <Icon name={s().paused || s().stopped ? "pause" : "play"} class="list-icon" />
                </button>
              )}
            </Index>
          </div>
        </Show>
      </div>
      <footer class="legend">
        <span>
          <kbd>OK</kbd> Resume here or Sync play
        </span>
      </footer>
    </div>
  );
}

/**
 * "On other screens" on Home, under the hero: what the other TVs, phones and tablets are playing
 * (and stopped in the last few hours). OK offers Resume here, Move here and Sync play.
 */
export function ElsewhereRow() {
  return (
    <Show when={elsewhere().length}>
      <section class="rail" data-row>
        <h3 class="rail-title">On other screens</h3>
        <div class="rail-track" data-scroll-x="96" data-focus-group>
          <Index each={elsewhere()}>
            {(s) => (
              <button class="card card-wide" data-focus onClick={() => void carryOn(s())}>
                <div class="card-art">
                  <Show when={s().artwork} fallback={<div class="card-fallback">{s().name}</div>}>
                    <img src={s().artwork} alt="" loading="lazy" />
                  </Show>
                  <span class="card-badge">{s().sync ? "Sync play" : s().stopped ? "Stopped" : s().paused ? "Paused" : (s().deviceName ?? "Playing")}</span>
                  <Show when={!s().live && s().durationMs}>
                    <Progress value={placeOf(s()) / s().durationMs!} class="card-progress" />
                  </Show>
                </div>
                <div class="card-label">
                  <span class="card-title">{s().name}</span>
                  <span class="card-sub">{watchLine(s(), placeOf(s()))}</span>
                </div>
              </button>
            )}
          </Index>
        </div>
      </section>
    </Show>
  );
}
