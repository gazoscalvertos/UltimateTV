// The guide's preview of live TV on a desktop (the AppImage, docs/desktop.md). On the TV box mpv's
// picture shows through a hole in the UI; on a desktop mpv plays in its own window, which Wayland
// won't let us place inside the guide, so mpv only carries the sound there. This plays the same
// channel's picture in the page instead: the Hub's live relay already fans one IPTV connection out
// to every viewer of a channel, so a second viewer costs no extra connection. mpegts.js turns the
// MPEG-TS into something the browser's own player takes (Media Source Extensions). It's only the
// picture: mpv is playing the sound.

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type MpegtsType from "mpegts.js";
import { session } from "../api";

/** The relay address the page fetches for a live channel's picture, or null when it isn't one. */
export function previewUrl(url: string, origin: string = location.origin): string | null {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return null;
  }
  if (!/^\/api\/live\/[^/]+\.ts$/.test(u.pathname)) return null;
  // Same origin as the page whatever host name the Hub put in, so no CORS.
  const out = new URL(u.pathname, origin);
  // Its own holder, or the Hub's relay would take mpv's stream away to give it to us (one
  // stream per holder); "force" was only for mpv's own start, and is left off.
  out.searchParams.set("holder", `${u.searchParams.get("holder") ?? "box"}:preview`);
  // Just the picture (the Hub takes the sound and subtitles out, hub/src/tsfilter.ts): a sound
  // track the browser can't decode (AC-3) would stop it all, and mpv is playing the sound.
  out.searchParams.set("video", "only");
  return out.toString();
}

let lib: Promise<typeof MpegtsType> | null = null;
const loadLib = () => (lib ??= import("mpegts.js").then((m) => m.default));

/** A muted picture of `url` filling its parent; `fallback` says why when there's none. */
export function LivePreview(props: { url: string | null; fallback: string }) {
  const [playing, setPlaying] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let video!: HTMLVideoElement;
  // Only a new address starts again: the same channel re-reported (mpv's state) carries on.
  const address = createMemo(() => props.url);

  createEffect(() => {
    const url = address();
    setPlaying(false);
    setFailed(false);
    if (!url) return;
    let player: MpegtsType.Player | null = null;
    let gone = false;
    const stop = () => {
      if (!player) return;
      player.pause();
      player.unload();
      player.detachMediaElement();
      player.destroy();
      player = null;
    };
    void loadLib()
      .then((mpegts) => {
        if (gone) return;
        if (!mpegts.isSupported()) return void setFailed(true);
        const headers: Record<string, string> = {};
        if (session.profileId) headers["X-Profile"] = session.profileId;
        if (session.token) headers["X-Profile-Token"] = session.token;
        player = mpegts.createPlayer(
          { type: "mpegts", isLive: true, url },
          { enableWorker: true, enableStashBuffer: false, lazyLoad: false, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 3, liveBufferLatencyMinRemain: 0.5, headers },
        );
        // A picture the browser can't play (HEVC without a hardware decoder, say): sound only, as before.
        player.on(mpegts.Events.ERROR, () => {
          setPlaying(false);
          setFailed(true);
          stop();
        });
        player.attachMediaElement(video);
        player.load();
        void Promise.resolve(player.play()).catch(() => undefined);
      })
      .catch(() => setFailed(true));
    onCleanup(() => {
      gone = true;
      stop();
    });
  });

  return (
    <>
      <video class="live-preview" classList={{ ready: playing() }} ref={video} muted playsinline autoplay onPlaying={() => setPlaying(true)} onEmptied={() => setPlaying(false)} />
      <Show when={!playing()}>
        <div class="preview-empty">{failed() || !props.url ? props.fallback : "Live TV"}</div>
      </Show>
    </>
  );
}
