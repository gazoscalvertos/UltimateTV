// Downloaded to the box: what's on the box's own disk to watch away from home, what's still
// coming, how much room it takes, and how long downloads are kept.

import { createSignal, Index, Show } from "solid-js";
import type { BoxDownload } from "@ultimatetv/shared";
import { durationLabel, formatBytes } from "@ultimatetv/shared";
import { agent } from "../agent";
import { choose, confirm } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { Progress } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { useHints } from "../hints";
import { useKeys } from "../keys";
import { boxDownloads, downloadLabel, removeFromBox, visibleDownloads } from "../downloads";
import { play } from "../player";
import { errorToast, isKids, toast } from "../store";

const KEEP_CHOICES = [3, 7, 14, 30, 0];
const keepLabel = (days: number) => (days ? `${days} days` : "Until I delete them");

function goesIn(d: BoxDownload): string | null {
  if (!d.expiresAt) return null;
  const left = d.expiresAt - Date.now();
  if (left < 86_400_000) return "Goes today";
  const days = Math.round(left / 86_400_000);
  return `Goes in ${days} ${days === 1 ? "day" : "days"}`;
}

function statusLine(d: BoxDownload): string {
  if (d.status === "downloading") {
    const parts = [downloadLabel(d)!, d.bytesTotal ? `${formatBytes(d.bytesDone)} of ${formatBytes(d.bytesTotal)}` : formatBytes(d.bytesDone)];
    if (d.speedBps) parts.push(`${formatBytes(d.speedBps)}/s`);
    return parts.join(" · ");
  }
  if (d.status === "failed") return `Didn't download: ${d.error ?? "it failed"}`;
  if (d.status === "queued") return d.error ? `Waiting: ${d.error}` : "Waiting to download";
  const parts = [d.bytesTotal ? formatBytes(d.bytesTotal) : null, d.watchedAt ? "Watched" : d.positionMs && d.durationMs ? `${durationLabel(d.durationMs - d.positionMs)} left` : null, goesIn(d)];
  return parts.filter(Boolean).join(" · ");
}

export function DownloadsScreen() {
  const remove = async (d: BoxDownload) => {
    if (!(await confirm(`Delete ${d.name}?`, d.status === "done" ? "It comes off the box. It's still at home to stream or download again." : "It stops downloading.", "Delete", true))) return;
    try {
      await removeFromBox(d.id);
      toast("Deleted from the box");
    } catch (err) {
      errorToast(err);
    }
  };

  const open = async (d: BoxDownload) => {
    if (d.status === "done") {
      void play(d.req, d.title ? { title: d.title } : {});
      return;
    }
    if (isKids()) return;
    const pick = await choose({
      title: d.name,
      message: [d.subtitle, statusLine(d)].filter(Boolean).join(" · "),
      options: [
        ...(d.status === "failed" ? [{ label: "Try again", value: "retry", icon: "restart" }] : []),
        { label: d.status === "failed" ? "Delete" : "Stop and delete", value: "delete", icon: "trash", tone: "danger" as const },
        { label: "Back", value: "back" },
      ],
    });
    try {
      if (pick === "retry") await agent.retryDownload(d.id);
      if (pick === "delete") await remove(d);
    } catch (err) {
      errorToast(err);
    }
  };

  // Red deletes the one the remote is on.
  const [focused, setFocused] = createSignal<string | null>(null);
  useHints(() => [
    ...(isKids() ? [] : [{ key: "red" as const, label: "Delete" }]),
  ]);
  useKeys((a) => {
    const d = a === "red" && !isKids() ? visibleDownloads().find((x) => x.id === focused()) : undefined;
    if (!d) return false;
    void remove(d);
    return true;
  });

  const setKeep = async () => {
    const s = boxDownloads()?.settings;
    if (!s) return;
    const days = await choose({
      title: "Keep downloads for",
      message: "Counted from when each one finishes downloading. They're deleted by themselves after that.",
      options: KEEP_CHOICES.map((d) => ({ label: keepLabel(d), value: d, ...(d === s.keepDays ? { icon: "check" } : {}) })),
    });
    if (days !== undefined) await agent.downloadSettings({ keepDays: days }).catch(errorToast);
  };
  const toggleWatched = async () => {
    const s = boxDownloads()?.settings;
    if (s) await agent.downloadSettings({ deleteWatched: !s.deleteWatched }).catch(errorToast);
  };

  return (
    <div class="screen planner downloads" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="160">
        <div class="planner-head" data-row>
          <h1 class="page-title">Downloaded</h1>
          <Show when={boxDownloads()}>
            {(b) => (
              <p class="muted">
                {formatBytes(b().usedBytes)} on the box · {formatBytes(Math.max(0, b().freeBytes - b().reserveBytes))} free
              </p>
            )}
          </Show>
        </div>
        <Show when={!isKids() && boxDownloads()}>
          {(b) => (
            <div class="planner-tabs" data-row data-focus-group>
              <button class="chip" data-focus onClick={() => void setKeep()}>
                Keep for: {keepLabel(b().settings.keepDays)}
              </button>
              <button class="chip" classList={{ active: b().settings.deleteWatched }} data-focus onClick={() => void toggleWatched()}>
                Delete a day after watching: {b().settings.deleteWatched ? "On" : "Off"}
              </button>
            </div>
          )}
        </Show>
        <Show
          when={visibleDownloads().length}
          fallback={<p class="empty">Nothing downloaded to the box yet. On a film, a series or a recording, choose Download to box, and it plays from here even away from home.</p>}
        >
          <div class="list">
            <Index each={visibleDownloads()}>
              {(d, i) => (
                <button class="list-row" data-row data-focus data-autofocus={i === 0 ? "" : undefined} onClick={() => void open(d())} onFocus={() => setFocused(d().id)}>
                  <Show when={d().artwork ?? d().image} fallback={<div class="list-art card-fallback" />}>
                    <img class="list-art" src={d().artwork ?? d().image} alt="" />
                  </Show>
                  <span class="list-main">
                    <span class="list-title">
                      {d().name}
                      <Show when={d().status === "failed"}>
                        <span class="flag flag-bad">Failed</span>
                      </Show>
                    </span>
                    <Show when={d().subtitle}>
                      <span class="list-sub">{d().subtitle}</span>
                    </Show>
                    <span class="list-sub">{statusLine(d())}</span>
                    <Show when={d().status === "downloading" && d().bytesTotal}>
                      <Progress value={d().bytesDone / d().bytesTotal!} class="list-progress" />
                    </Show>
                    <Show when={d().status === "done" && d().positionMs && d().durationMs}>
                      <Progress value={d().positionMs! / d().durationMs!} class="list-progress" />
                    </Show>
                  </span>
                  <Show when={d().status === "done"}>
                    <Icon name="play" class="list-icon" />
                  </Show>
                </button>
              )}
            </Index>
          </div>
        </Show>
      </div>
      <footer class="legend">
        <span>
          <kbd>OK</kbd> Play
        </span>
        <Show when={!isKids()}>
          <span data-key="red">
            <kbd class="key-red" /> Delete
          </span>
        </Show>
      </footer>
    </div>
  );
}
