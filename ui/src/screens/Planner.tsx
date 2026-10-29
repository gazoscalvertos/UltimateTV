// Recordings: what's recorded (grouped by series), what's coming up, series links, clashes and
// downloads to the NAS.

import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import type { Download, Recording, SeriesLink } from "@ultimatetv/shared";
import { clockTime, dayLabel, episodeLabel, formatBytes } from "@ultimatetv/shared";
import { hub } from "../api";
import { choose, confirm } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { Progress } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { canDownload, downloadLabel, downloadOf, downloadToBox, recordingRequest } from "../downloads";
import { useHints } from "../hints";
import { useKeys } from "../keys";
import { play } from "../player";
import { errorToast, isKids, type PlannerTab, toast } from "../store";

const TABS: { id: PlannerTab; label: string }[] = [
  { id: "recorded", label: "Recorded" },
  { id: "scheduled", label: "Coming up" },
  { id: "series", label: "Series links" },
  { id: "downloads", label: "Downloads" },
];

const STATUS: Record<Recording["status"], string> = {
  scheduled: "Will record",
  "waiting-catchup": "Will save from catch-up",
  recording: "Recording now",
  processing: "Finishing",
  completed: "Recorded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function Planner(props: { tab?: PlannerTab }) {
  const [tab, setTab] = createSignal<PlannerTab>(props.tab ?? "recorded");
  const [data, { refetch }] = createResource(() => hub.planner());
  const [downloads, dl] = createResource(() => hub.downloads().then((d) => d.downloads));
  onCleanup(
    onHubEvent((e) => {
      if (e.type === "recordings.changed" || e.type === "recording.started" || e.type === "recording.finished") void refetch();
      if (e.type === "downloads.changed") void dl.refetch();
    }),
  );

  const recorded = createMemo(() => {
    const list = (data()?.recordings ?? []).filter((r) => r.status === "completed" || r.status === "failed").sort((a, b) => b.programme.start - a.programme.start);
    const groups = new Map<string, Recording[]>();
    for (const r of list) groups.set(r.programme.title, [...(groups.get(r.programme.title) ?? []), r]);
    return [...groups.entries()];
  });
  const upcoming = createMemo(() => (data()?.recordings ?? []).filter((r) => ["scheduled", "waiting-catchup", "recording", "processing"].includes(r.status)).sort((a, b) => a.start - b.start));

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      if (message) toast(message);
      await refetch();
    } catch (err) {
      errorToast(err);
    }
  };

  const recordingMenu = async (r: Recording) => {
    if (r.status !== "completed") {
      if (await confirm("Delete this failed recording?", r.error ?? "It didn't record.", "Delete", true)) await act(() => hub.deleteRecording(r.id), "Deleted");
      return;
    }
    const pick = await choose({
      title: r.programme.title,
      message: [episodeLabel(r.programme.season, r.programme.episode), r.programme.subtitle, `${r.channelName} · ${dayLabel(r.programme.start)} ${clockTime(r.programme.start)}`].filter(Boolean).join(" · "),
      options: [
        { label: r.positionMs > 0 && !r.watched ? "Resume" : "Play", value: "play", icon: "play" },
        { label: r.watched ? "Mark as not watched" : "Mark as watched", value: "watched", icon: "check" },
        ...(canDownload() && !isKids() ? [{ label: downloadLabel(downloadOf({ kind: "recording", id: r.id })) ?? "Download to box", value: "download", icon: "download" }] : []),
        ...(isKids() ? [] : [{ label: "Delete", value: "delete", icon: "trash", tone: "danger" as const }]),
      ],
    });
    if (pick === "play") void play({ kind: "recording", id: r.id });
    if (pick === "watched") await act(() => hub.markWatched(r.id, !r.watched));
    if (pick === "download") await downloadToBox([recordingRequest(r)], r.programme.title).catch(errorToast);
    if (pick === "delete" && (await confirm("Delete this recording?", `${r.programme.title} will be deleted from the NAS.`, "Delete", true))) await act(() => hub.deleteRecording(r.id), "Recording deleted");
  };

  const upcomingMenu = async (r: Recording) => {
    if (await confirm(`Cancel ${r.programme.title}?`, r.status === "recording" ? "It's recording now. What's been recorded so far is kept." : "It won't be recorded.", "Cancel recording", true)) {
      await act(() => hub.deleteRecording(r.id), "Recording cancelled");
    }
  };

  const linkMenu = async (l: SeriesLink) => {
    const pick = await choose({
      title: l.title,
      message: `${l.scope === "any" ? "Any channel" : l.channelName} · ${l.newOnly ? "New episodes only" : "All episodes"} · ${l.keepLatest ? `Keeps the latest ${l.keepLatest}` : "Keeps everything"}`,
      options: [
        { label: l.scope === "any" ? `Only on ${l.channelName}` : "On any channel", value: "scope" },
        { label: l.newOnly ? "Record repeats too" : "New episodes only", value: "new" },
        { label: l.keepLatest ? "Keep every episode" : "Keep the latest 5", value: "keep" },
        { label: "Cancel series link", value: "delete", tone: "danger" },
      ],
    });
    if (pick === "scope") await act(() => hub.updateSeriesLink(l.id, { scope: l.scope === "any" ? "this" : "any" }), "Series link updated");
    if (pick === "new") await act(() => hub.updateSeriesLink(l.id, { newOnly: !l.newOnly }), "Series link updated");
    if (pick === "keep") await act(() => hub.updateSeriesLink(l.id, { keepLatest: l.keepLatest ? 0 : 5 }), "Series link updated");
    if (pick === "delete") await cancelLink(l);
  };

  const cancelLink = async (l: SeriesLink) => {
    if (await confirm("Cancel series link?", `${l.title} won't record any more. Recordings you've got are kept.`, "Cancel series link", true)) {
      await act(() => hub.deleteSeriesLink(l.id), "Series link cancelled");
    }
  };

  const downloadMenu = async (d: Download) => {
    const active = d.status !== "completed" && d.status !== "failed" && d.status !== "cancelled";
    if (await confirm(active ? `Stop saving ${d.title}?` : `Remove ${d.title} from this list?`, active ? "The part downloaded so far is deleted." : "The file stays on the NAS.", active ? "Stop" : "Remove", active)) {
      try {
        await hub.deleteDownload(d.id);
        await dl.refetch();
      } catch (err) {
        errorToast(err);
      }
    }
  };

  useHints(() => [
    { key: "blue", label: "Next tab" },
  ]);
  useKeys((a) => {
    if (a === "blue") {
      const i = TABS.findIndex((t) => t.id === tab());
      setTab(TABS[(i + 1) % TABS.length]!.id);
      return true;
    }
    return false;
  });

  return (
    <div class="screen planner" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="160">
        <div class="planner-head" data-row>
          <h1 class="page-title">Recordings</h1>
          <div class="planner-tabs" data-focus-group>
            <For each={TABS}>
              {(t, i) => (
                <button class="chip" classList={{ active: tab() === t.id }} data-focus data-autofocus={i() === 0 ? "" : undefined} onClick={() => setTab(t.id)} onFocus={() => setTab(t.id)}>
                  {t.label}
                  <Show when={t.id === "scheduled" && upcoming().length}>
                    <span class="chip-count">{upcoming().length}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>

        <For each={data()?.conflicts ?? []}>
          {(c) => (
            <div class="conflict" data-row>
              <Icon name="info" />
              <div>
                <strong>Clash at {clockTime(c.start)} {dayLabel(c.start).toLowerCase()}</strong>
                <p>{c.message}</p>
              </div>
            </div>
          )}
        </For>

        <Show when={data()} fallback={<div class="spinner" />}>
          <Switch>
            <Match when={tab() === "recorded"}>
              <Show when={recorded().length} fallback={<p class="empty">Nothing recorded yet. Press Record in the TV Guide to record a programme, or twice for the whole series.</p>}>
                <div class="list">
                  <For each={recorded()}>
                    {([title, recs]) => (
                      <div class="list-group" data-row>
                        <h3 class="list-group-title">
                          {title}
                          <span class="muted">
                            {recs.length} {recs.length === 1 ? "recording" : "recordings"}
                          </span>
                        </h3>
                        <For each={recs}>
                          {(r) => (
                            <button class="list-row" data-focus onClick={() => void recordingMenu(r)}>
                              <Show when={r.programme.image} fallback={<div class="list-art card-fallback" />}>
                                <img class="list-art" src={r.programme.image} alt="" />
                              </Show>
                              <span class="list-main">
                                <span class="list-title">
                                  {[episodeLabel(r.programme.season, r.programme.episode), r.programme.subtitle].filter(Boolean).join(" · ") || r.programme.title}
                                  <Show when={!r.watched && r.status === "completed"}>
                                    <span class="flag flag-new">New</span>
                                  </Show>
                                  <Show when={r.status === "failed"}>
                                    <span class="flag flag-bad">Failed</span>
                                  </Show>
                                  <Show when={r.incomplete}>
                                    <span class="flag">Part recorded</span>
                                  </Show>
                                </span>
                                <span class="list-sub">
                                  {r.channelName} · {dayLabel(r.programme.start)} {clockTime(r.programme.start)} · {r.method === "catchup" ? "From catch-up" : "Recorded live"}
                                </span>
                                <Show when={r.positionMs > 0 && !r.watched}>
                                  <Progress value={r.positionMs / (r.programme.end - r.programme.start)} class="list-progress" />
                                </Show>
                              </span>
                              <span class="list-side">{r.sizeBytes ? formatBytes(r.sizeBytes) : ""}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Match>

            <Match when={tab() === "scheduled"}>
              <Show when={upcoming().length} fallback={<p class="empty">Nothing set to record.</p>}>
                <div class="list">
                  <For each={upcoming()}>
                    {(r) => (
                      <button class="list-row" data-row data-focus onClick={() => void upcomingMenu(r)}>
                        <span class="list-when">
                          <strong>{clockTime(r.programme.start)}</strong>
                          <span>{dayLabel(r.programme.start)}</span>
                        </span>
                        <span class="list-main">
                          <span class="list-title">
                            {r.programme.title}
                            <Show when={r.seriesLinkId}>
                              <Icon name="series" class="mark-series" />
                            </Show>
                          </span>
                          <span class="list-sub">{[episodeLabel(r.programme.season, r.programme.episode), r.channelName].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span class="list-side" classList={{ "rec-now": r.status === "recording" }}>
                          <Show when={r.status === "recording"}>
                            <Icon name="record" />
                          </Show>
                          {STATUS[r.status]}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Match>

            <Match when={tab() === "series"}>
              <Show when={data()!.seriesLinks.length} fallback={<p class="empty">No series links. Press Record on a programme in the guide and choose Series link.</p>}>
                <div class="list">
                  <For each={data()!.seriesLinks}>
                    {(l) => (
                      <div class="list-row-actions" data-row data-focus-group>
                        <button class="list-row" data-focus onClick={() => void linkMenu(l)}>
                          <Icon name="series" class="list-icon mark-series" />
                          <span class="list-main">
                            <span class="list-title">{l.title}</span>
                            <span class="list-sub">
                              {l.scope === "any" ? "Any channel" : l.channelName} · {l.newOnly ? "New episodes" : "All episodes"} · {l.keepLatest ? `Keeps the latest ${l.keepLatest}` : "Keeps everything"}
                            </span>
                          </span>
                          <span class="list-side">{upcoming().filter((r) => r.seriesLinkId === l.id).length} coming up</span>
                        </button>
                        <button class="list-row list-row-action" data-focus aria-label={`Cancel the ${l.title} series link`} onClick={() => void cancelLink(l)}>
                          <Icon name="trash" />
                          <span>Cancel</span>
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Match>

            <Match when={tab() === "downloads"}>
              <Show when={downloads()?.length} fallback={<p class="empty">Nothing saving to the NAS. Choose Save to NAS on a film to keep a copy.</p>}>
                <div class="list">
                  <For each={downloads()}>
                    {(d) => (
                      <button class="list-row" data-row data-focus onClick={() => void downloadMenu(d)}>
                        <Icon name="download" class="list-icon" />
                        <span class="list-main">
                          <span class="list-title">
                            {d.title}
                            {d.season ? ` · ${episodeLabel(d.season, d.episode)}` : d.year ? ` (${d.year})` : ""}
                          </span>
                          <span class="list-sub">
                            {d.status === "downloading"
                              ? `${Math.round(d.progress * 100)}% · ${formatBytes(d.bytesDone)}${d.bytesTotal ? ` of ${formatBytes(d.bytesTotal)}` : ""}${d.speedBps ? ` · ${formatBytes(d.speedBps)}/s` : ""}`
                              : d.status === "completed"
                                ? `Saved to ${d.path ?? "the NAS"}`
                                : d.status === "waiting-debrid"
                                  ? "TorBox is fetching it"
                                  : d.status === "failed"
                                    ? (d.error ?? "Failed")
                                    : d.status === "queued"
                                      ? "Waiting"
                                      : d.status}
                          </span>
                          <Show when={d.status === "downloading"}>
                            <Progress value={d.progress} class="list-progress" />
                          </Show>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Match>
          </Switch>
        </Show>
      </div>
      <footer class="legend">
        <span>
          <kbd>OK</kbd> Options
        </span>
        <span>
          <kbd class="key-blue" /> Next tab
        </span>
      </footer>
    </div>
  );
}
