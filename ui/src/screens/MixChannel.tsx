// One music video channel: watch it, fill it up, reshuffle, change what it plays, and the videos it
// has, where OK on one offers to take it out (the Hub won't pick it again).

import { createResource, For, onCleanup, Show } from "solid-js";
import type { MixEntry, MixVideo } from "@ultimatetv/shared";
import { hub } from "../api";
import { askText, choose, confirm } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { play } from "../player";
import { errorToast, nav, toast } from "../store";

const minutes = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const size = (h: number) => (h >= 2160 ? "4K" : h >= 1440 ? "1440p" : h >= 1080 ? "HD" : `${h}p`);

function videoName(v: MixVideo): string {
  if (v.artist && v.track) return `${v.artist.split(/,\s*/)[0]} – ${v.track}`;
  return v.title.replace(/\s*[([][^)\]]*(official|video|hd|4k|remaster)[^)\]]*[)\]]/gi, "").trim();
}

function statusOf(v: MixVideo): string {
  if (v.status === "ready") return `${v.source === "nas" ? "On the NAS · " : ""}${size(v.height)} · ${minutes(v.durationS)}`;
  if (v.status === "downloading") return `Downloading${v.progress ? ` ${Math.round(v.progress * 100)}%` : ""}`;
  if (v.status === "queued") return "Waiting to download";
  return `Couldn't download${v.error ? `: ${v.error}` : ""}`;
}

/** Splits typed text into tracks ("Artist - Title") and broader searches. */
export function splitAdditions(text: string): { picks: string[]; queries: string[] } {
  const parts = text
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  return {
    picks: parts.filter((t) => / - /.test(t)),
    queries: parts.filter((t) => !/ - /.test(t)).map((t) => `${t} official music video`),
  };
}

export function MixChannelScreen(props: { id: string }) {
  const [data, { refetch }] = createResource(
    () => props.id,
    (id) => hub.mixChannel(id),
  );
  let timer: number | undefined;
  onCleanup(
    onHubEvent((e) => {
      if (e.type !== "mix.changed" || (e.channelId && e.channelId !== props.id) || timer) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refetch();
      }, 3000);
    }),
  );
  onCleanup(() => clearTimeout(timer));

  const c = () => data()?.channel;
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done, "good");
      await refetch();
    } catch (err) {
      errorToast(err);
    }
  };

  const watch = () => {
    const ch = c();
    if (ch) void play({ kind: "channel", id: ch.channelId });
  };
  const addMore = async () => {
    const ch = c();
    if (!ch) return;
    const text = await askText("Add artists, genres or songs (Artist - Title), with commas between");
    if (!text) return;
    const add = splitAdditions(text);
    await act(() => hub.updateMix(ch.id, { picks: [...add.picks, ...ch.picks], queries: [...add.queries, ...ch.queries], target: ch.target + add.picks.length }), "Added. The Hub is looking for them now.");
  };
  /** Folder by folder through the NAS: OK on a file adds it, or add a whole folder at once. */
  const fromNas = async () => {
    const ch = c();
    if (!ch) return;
    let dir: string | undefined;
    for (;;) {
      let here;
      try {
        here = await hub.browseNas(dir);
      } catch (err) {
        errorToast(err);
        return;
      }
      const count = here.files.length;
      type Pick = { kind: "all" | "up" | "dir" | "file"; path: string };
      const pick = await choose<Pick>({
        title: here.dir ? here.dir : "Videos on the NAS",
        message: here.dir ? `${here.folders.length} folders, ${count} videos. OK on a video puts it on ${ch.name}.` : "Pick the share the videos are on.",
        options: [
          ...(count ? [{ label: `Add all ${count} videos here`, value: { kind: "all" as const, path: here.dir }, icon: "plus" as const, detail: "And any in the folders inside" }] : []),
          ...(here.dir ? [{ label: "Up a folder", value: { kind: "up" as const, path: here.parent ?? "" }, icon: "prev" as const }] : []),
          ...here.folders.map((f) => ({ label: f.name, value: { kind: "dir" as const, path: f.path }, icon: "list" as const })),
          ...here.files.map((f) => ({ label: f.name, value: { kind: "file" as const, path: f.path }, icon: "play" as const, detail: `${Math.round(f.sizeBytes / 1024 ** 2)} MB` })),
        ],
      });
      if (!pick) return;
      if (pick.kind === "dir" || pick.kind === "up") {
        dir = pick.path || undefined;
        continue;
      }
      try {
        const r = await hub.addMixFiles(ch.id, [pick.path]);
        toast(r.added ? `${r.added} video${r.added === 1 ? "" : "s"} added to ${ch.name}${r.skipped.length ? `. ${r.skipped.length} couldn't be read` : ""}` : (r.skipped[0] ?? "Already on the channel"), r.added ? "good" : "bad");
        await refetch();
      } catch (err) {
        errorToast(err);
      }
      if (pick.kind === "all") return;
      dir = here.dir;
    }
  };
  const options = async () => {
    const ch = c();
    if (!ch) return;
    const pick = await choose({
      title: ch.name,
      message: ch.brief || undefined,
      options: [
        { label: "Rename", value: "rename", icon: "edit" },
        { label: "Describe it", value: "brief", icon: "list", detail: "What it's for, in a few words. An AI curator will work from this" },
        { label: `Number of videos: ${ch.target}`, value: "target" },
        { label: `Picture: ${size(ch.minHeight)} to ${size(ch.maxHeight)}`, value: "size" },
        { label: ch.enabled ? "Turn off" : "Turn on", value: "enabled", detail: ch.enabled ? "Takes it out of the guide; its videos stay" : undefined },
        { label: "Delete channel", value: "delete", icon: "trash", tone: "danger" as const },
      ],
    });
    if (pick === "rename") {
      const name = await askText("Channel name", ch.name);
      if (name) await act(() => hub.updateMix(ch.id, { name }));
    }
    if (pick === "brief") {
      const brief = await askText("Describe the channel", ch.brief);
      if (brief !== undefined) await act(() => hub.updateMix(ch.id, { brief }));
    }
    if (pick === "target") {
      const target = await choose<number>({ title: "How many videos?", options: [20, 30, 50, 80, 120].map((n) => ({ label: `${n} videos`, value: n })) });
      if (target) await act(() => hub.updateMix(ch.id, { target }));
    }
    if (pick === "size") {
      const s = await choose<[number, number]>({
        title: "Picture quality",
        message: "4K videos take about four times the space of HD ones.",
        options: [
          { label: "HD or 4K", value: [720, 2160], detail: "The best there is, at least 720p" },
          { label: "Full HD or 4K", value: [1080, 2160], detail: "Skips videos only in 720p" },
          { label: "HD only", value: [720, 1080], detail: "Saves space on the NAS" },
        ],
      });
      if (s) await act(() => hub.updateMix(ch.id, { minHeight: s[0], maxHeight: s[1] }));
    }
    if (pick === "enabled") await act(() => hub.updateMix(ch.id, { enabled: !ch.enabled }));
    if (pick === "delete" && (await confirm(`Delete ${ch.name}?`, "The videos it downloaded are deleted from the NAS too, unless another channel has them. Files you added from the NAS stay where they are.", "Delete", true))) {
      try {
        await hub.deleteMix(ch.id);
        toast(`${ch.name} deleted`);
        nav.back() || nav.reset({ name: "settings", section: "music" });
      } catch (err) {
        errorToast(err);
      }
    }
  };
  const videoMenu = async (e: MixEntry) => {
    const ch = c();
    if (!ch) return;
    const pick = await choose({
      title: videoName(e.video),
      message: `${statusOf(e.video)}. Found by ${e.origin}.`,
      options: [
        { label: "Take it off this channel", value: "remove", icon: "trash", tone: "danger" as const, detail: "It won't be picked again" },
        { label: "Keep it", value: "keep" },
      ],
    });
    if (pick === "remove") await act(() => hub.removeMixVideo(ch.id, e.video.id), "Taken off. Another video will be found to replace it.");
  };

  const order: Record<MixVideo["status"], number> = { downloading: 0, queued: 1, ready: 2, failed: 3 };

  return (
    <div class="screen settings mix-channel" data-layer>
      <TopBar />
      <div class="settings-layout">
        <nav class="settings-nav" data-focus-group>
          <button class="settings-nav-item mix-action" data-focus data-autofocus onClick={watch}>
            <Icon name="play" /> Watch
          </button>
          <button class="settings-nav-item mix-action" data-focus onClick={() => void addMore()}>
            <Icon name="plus" /> Add artists or songs
          </button>
          <button class="settings-nav-item mix-action" data-focus onClick={() => void fromNas()}>
            <Icon name="download" /> Add videos from the NAS
          </button>
          <button class="settings-nav-item mix-action" data-focus onClick={() => c() && void act(() => hub.curateMix(c()!.id), "Looking for more videos now")}>
            <Icon name="search" /> Find more videos now
          </button>
          <button class="settings-nav-item mix-action" data-focus onClick={() => c() && void act(() => hub.shuffleMix(c()!.id), "Reshuffled after this video")}>
            <Icon name="shuffle" /> Shuffle again
          </button>
          <button class="settings-nav-item mix-action" data-focus onClick={() => void options()}>
            <Icon name="edit" /> Channel options
          </button>
        </nav>
        <div class="settings-panel page" data-scroll-y="40" data-focus-group>
          <Show when={data()} fallback={<div class="spinner" />}>
            {(d) => (
              <>
                <div class="mix-head">
                  <img class="mix-logo" src={`/api/mix-channels/${encodeURIComponent(d().channel.id)}/logo.svg`} alt="" />
                  <div>
                    <h2>
                      {d().channel.number} {d().channel.name}
                    </h2>
                    <p class="hint">
                      {d().channel.counts.ready} of {d().channel.target} videos ready
                      {d().channel.counts.queued + d().channel.counts.downloading ? `, ${d().channel.counts.queued + d().channel.counts.downloading} to download` : ""}
                      {d().channel.enabled ? "" : ". Turned off"}
                      {d().channel.error ? `. ${d().channel.error}` : ""}
                    </p>
                  </div>
                </div>
                <Show when={d().videos.length} fallback={<p class="hint">No videos yet. The Hub is looking for some; they appear here as they're found.</p>}>
                  <For each={[...d().videos].sort((a, b) => order[a.video.status] - order[b.video.status] || videoName(a.video).localeCompare(videoName(b.video)))}>
                    {(e) => (
                      <button class="setting-row mix-video" classList={{ failed: e.video.status === "failed" }} data-focus onClick={() => void videoMenu(e)}>
                        <Show when={e.video.status === "ready"} fallback={<span class="mix-thumb mix-thumb-empty" />}>
                          <img class="mix-thumb" src={`/api/mix/videos/${encodeURIComponent(e.video.id)}/thumb.jpg`} alt="" onError={(ev) => (ev.currentTarget.style.visibility = "hidden")} />
                        </Show>
                        <span class="setting-label">
                          {videoName(e.video)}
                          <small>{e.origin}</small>
                        </span>
                        <span class="setting-value">{statusOf(e.video)}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
