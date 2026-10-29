// The programme card: what's on, and what you can do with it (watch, watch from the start via
// catch-up, record, series link, remind, add to the watchlist). Also home to the Record button
// flow used everywhere.

import { createResource, For, Show } from "solid-js";
import type { Programme } from "@ultimatetv/shared";
import { clockTime, dayLabel, durationLabel, episodeLabel } from "@ultimatetv/shared";
import { hub, type ProgrammeInfo } from "../api";
import { play } from "../player";
import { addProgrammeToWatchlist, removeFromWatchlist, watchlistEntryForProgramme } from "../watchlist";
import { errorToast, openDialog, toast } from "../store";
import { choose, confirm, DialogFrame } from "./Dialog";
import { Icon } from "./Icon";

export function timeRange(p: Programme): string {
  return `${dayLabel(p.start)} ${clockTime(p.start)}–${clockTime(p.end)}`;
}

/** Sky's Record button: once records, on a series it asks whether to series link. */
export async function recordFlow(p: Programme, info?: ProgrammeInfo): Promise<boolean> {
  try {
    const i = info ?? (await hub.programme(p.id));
    if (i.seriesLink) {
      if (!(await confirm("Cancel series link?", `${i.seriesLink.title} won't record any more. Recordings you've already got are kept.`, "Cancel series link", true))) return false;
      await hub.deleteSeriesLink(i.seriesLink.id);
      toast(`Series link for ${i.seriesLink.title} cancelled`);
      return true;
    }
    if (i.recording && i.recording.status !== "cancelled" && i.recording.status !== "failed") {
      const done = i.recording.status === "completed";
      if (done) {
        toast("Already recorded. Find it in Recordings.");
        return false;
      }
      if (!(await confirm("Cancel this recording?", `${p.title} won't be recorded.`, "Cancel recording", true))) return false;
      await hub.deleteRecording(i.recording.id);
      toast("Recording cancelled");
      return true;
    }
    if (p.seriesKey && !p.isFilm) {
      const pick = await choose({
        title: p.title,
        message: "Record every episode? Series link finds them on any channel, uses catch-up when it can, and skips repeats.",
        options: [
          { label: "Series link", value: "series", icon: "series" },
          { label: "Just this episode", value: "once", icon: "record" },
        ],
      });
      if (!pick) return false;
      if (pick === "series") {
        await hub.seriesLink(p.id);
        toast(`Series linked: ${p.title}`, "good");
        return true;
      }
    }
    await hub.record(p.id);
    toast(p.end < Date.now() ? `${p.title} will be saved from catch-up` : `Recording ${p.title}`, "good");
    return true;
  } catch (err) {
    errorToast(err);
    return false;
  }
}

/** Opens the programme card. Resolves true if something changed (so the guide can refresh its marks). */
export function openProgramme(p: Programme): Promise<boolean> {
  return openDialog<boolean>((close) => {
    const [info, { refetch }] = createResource(() => hub.programme(p.id));
    const nowMs = Date.now();
    const onNow = p.start <= nowMs && p.end > nowMs;
    const past = p.end <= nowMs;
    const act = async (fn: () => Promise<unknown>) => {
      await fn();
      close(true);
    };
    return (
      <DialogFrame close={() => close(false)} wide class="programme-card">
        <div class="pc-layout">
          <div class="pc-art">
            <Show when={p.image} fallback={<div class="card-fallback">{p.title}</div>}>
              <img src={p.image} alt="" />
            </Show>
          </div>
          <div class="pc-body">
            <h2>{p.title}</h2>
            <p class="pc-meta">
              {[timeRange(p), info()?.channel?.name, durationLabel(p.end - p.start)].filter(Boolean).join(" · ")}
            </p>
            <p class="pc-flags">
              <Show when={episodeLabel(p.season, p.episode)}>
                <span class="flag">{episodeLabel(p.season, p.episode)}</span>
              </Show>
              <Show when={p.isNew}>
                <span class="flag flag-new">New</span>
              </Show>
              <Show when={p.subtitle}>
                <span class="flag">{p.subtitle}</span>
              </Show>
              <Show when={info()?.recording && info()!.recording!.status !== "cancelled"}>
                <span class="flag flag-rec">
                  <Icon name="record" /> {info()!.recording!.status === "completed" ? "Recorded" : "Recording"}
                </span>
              </Show>
              <Show when={info()?.seriesLink}>
                <span class="flag flag-rec">
                  <Icon name="series" /> Series linked
                </span>
              </Show>
            </p>
            <Show when={p.description}>
              <p class="pc-description">{p.description}</p>
            </Show>
            <div class="pc-actions">
              <Show when={onNow}>
                <button class="btn btn-primary" data-focus data-autofocus onClick={() => act(() => play({ kind: "channel", id: p.channelId }))}>
                  <Icon name="play" /> Watch
                </button>
              </Show>
              <Show when={info()?.catchup}>
                <button class="btn" classList={{ "btn-primary": past }} data-focus data-autofocus={past ? "" : undefined} onClick={() => act(() => play({ kind: "catchup", id: p.id }))}>
                  <Icon name="restart" /> {onNow ? "Watch from the start" : "Watch (catch-up)"}
                </button>
              </Show>
              <Show when={info()?.recording?.status === "completed"}>
                <button class="btn" data-focus onClick={() => act(() => play({ kind: "recording", id: info()!.recording!.id }))}>
                  <Icon name="play" /> Play recording
                </button>
              </Show>
              <button class="btn" data-focus data-autofocus={!onNow && !past ? "" : undefined} onClick={() => void recordFlow(p, info()).then((changed) => (changed ? close(true) : void refetch()))}>
                <Icon name={info()?.seriesLink ? "series" : "record"} />
                {info()?.seriesLink ? "Cancel series link" : info()?.recording && info()!.recording!.status !== "cancelled" && info()!.recording!.status !== "completed" ? "Cancel recording" : "Record"}
              </button>
              <Show when={!past && !onNow}>
                <button
                  class="btn"
                  data-focus
                  onClick={() =>
                    act(async () => {
                      try {
                        if (info()?.reminder) await hub.deleteReminder(p.id);
                        else await hub.remind(p.id);
                        toast(info()?.reminder ? "Reminder removed" : `We'll remind you when ${p.title} starts`);
                      } catch (err) {
                        errorToast(err);
                      }
                    })
                  }
                >
                  <Icon name="bell" /> {info()?.reminder ? "Remove reminder" : "Remind me"}
                </button>
              </Show>
              <Show when={!p.channelId.startsWith("mix:")}>
                <button
                  class="btn"
                  data-focus
                  onClick={() => {
                    const entry = watchlistEntryForProgramme(p);
                    void (entry ? removeFromWatchlist(entry) : addProgrammeToWatchlist(p));
                  }}
                >
                  <Show when={watchlistEntryForProgramme(p)} fallback={<><Icon name="bookmark" /> Add to watchlist</>}>
                    <Icon name="bookmarked" /> On your watchlist
                  </Show>
                </button>
              </Show>
            </div>
            <Show when={info()?.otherAirings.length}>
              <div class="pc-airings">
                <h4>Also showing</h4>
                <For each={info()!.otherAirings.slice(0, 3)}>{(a) => <p>{timeRange(a)}</p>}</For>
              </div>
            </Show>
          </div>
        </div>
      </DialogFrame>
    );
  }).then((v) => v === true);
}
