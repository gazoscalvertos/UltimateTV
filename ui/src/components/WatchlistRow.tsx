// "Your watchlist" on Home: films and shows this profile wants to watch some day, each saying
// when it's next on TV or that it's recorded. Selecting one offers what can be done with it now.

import { For, Show } from "solid-js";
import type { WatchlistEntry } from "@ultimatetv/shared";
import { clockTime, dayLabel } from "@ultimatetv/shared";
import { hub } from "../api";
import { play } from "../player";
import { errorToast, nav, toast } from "../store";
import { removeFromWatchlist, watchlist } from "../watchlist";
import { choose } from "./Dialog";
import { recordFlow } from "./ProgrammeCard";

/** "On now · Film4", "Tonight 21:00 · BBC Two", "Sat 4 Nov 21:00 · Film4". */
export function showingLabel(e: WatchlistEntry, at = Date.now()): string | undefined {
  const s = e.onTv;
  if (!s) return undefined;
  const p = s.programme;
  if (p.start <= at) return `On now · ${s.channelName}`;
  const day = dayLabel(p.start, at);
  const when = day === "Today" ? (new Date(p.start).getHours() >= 17 ? "Tonight" : "Today") : day;
  return `${when} ${clockTime(p.start)} · ${s.channelName}`;
}

function subtitle(e: WatchlistEntry): string {
  return showingLabel(e) ?? (e.recordingId ? (e.recordings > 1 ? `${e.recordings} recordings` : "Recorded") : e.year ? String(e.year) : e.film ? "Film" : "Series");
}

async function watchlistActions(e: WatchlistEntry): Promise<void> {
  const s = e.onTv;
  const onNow = s && s.programme.start <= Date.now();
  const pick = await choose({
    title: e.name,
    message: [showingLabel(e), e.showings > 1 ? `${e.showings} showings in the next fortnight` : "", e.recordings ? `${e.recordings} recorded` : ""].filter(Boolean).join(" · ") || "Not on TV in the next fortnight",
    ...(e.image ? { image: e.image } : {}),
    options: [
      ...(e.recordingId ? [{ label: "Play the recording", value: "recording", icon: "play" as const }] : []),
      ...(onNow ? [{ label: `Watch on ${s!.channelName}`, value: "watch", icon: "play" as const }] : []),
      ...(e.title ? [{ label: "More info", value: "info", icon: "info" as const }] : [{ label: "Find it in films and TV", value: "search", icon: "search" as const }]),
      ...(s && !onNow ? [{ label: "Record it", value: "record", icon: "record" as const }, { label: "Remind me when it starts", value: "remind", icon: "bell" as const }] : []),
      { label: "Take off my watchlist", value: "remove", icon: "trash" as const, tone: "danger" as const },
    ],
  });
  if (pick === "recording") void play({ kind: "recording", id: e.recordingId! });
  else if (pick === "watch") void play({ kind: "channel", id: s!.programme.channelId });
  else if (pick === "info") nav.push({ name: "details", id: e.title!.id });
  else if (pick === "search") nav.push({ name: "search", q: e.name });
  else if (pick === "record") void recordFlow(s!.programme);
  else if (pick === "remind") {
    try {
      await hub.remind(s!.programme.id);
      toast(`We'll remind you when ${e.name} starts`);
    } catch (err) {
      errorToast(err);
    }
  } else if (pick === "remove") void removeFromWatchlist(e);
}

export function WatchlistRow() {
  return (
    <Show when={watchlist().length}>
      <section class="rail" data-row>
        <h3 class="rail-title">Your watchlist</h3>
        <div class="rail-track" data-scroll-x="96" data-focus-group>
          <For each={watchlist()}>
            {(e) => (
              <button class="card card-poster" data-focus onClick={() => void watchlistActions(e)}>
                <div class="card-art">
                  <Show when={e.image} fallback={<div class="card-fallback">{e.name}</div>}>
                    <img src={e.image} alt="" loading="lazy" />
                  </Show>
                  <Show when={e.onTv || e.recordingId}>
                    <span class="card-badge" classList={{ "card-badge-new": Boolean(e.onTv && e.onTv.programme.start <= Date.now()) }}>
                      {e.onTv ? (e.onTv.programme.start <= Date.now() ? "On now" : "On TV") : "Recorded"}
                    </span>
                  </Show>
                </div>
                <div class="card-label">
                  <span class="card-title">{e.name}</span>
                  <span class="card-sub">{subtitle(e)}</span>
                </div>
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
