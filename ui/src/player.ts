// Starting and stopping playback, whoever asks: a channel from the guide, a title, a recording.
// Handles the "a recording is using the connection" prompt and reports progress to the Hub.

import { createSignal } from "solid-js";
import type { Channel, PlaybackInfo, PlaybackRequest, PlayerState, TitleRef } from "@ultimatetv/shared";
import { agent } from "./agent";
import { ApiError, hub } from "./api";
import { choose } from "./components/Dialog";
import { errorToast, nav } from "./store";

export interface NowPlaying {
  req: PlaybackRequest;
  info: PlaybackInfo;
  title?: TitleRef;
}

export const [nowPlaying, setNowPlaying] = createSignal<NowPlaying | null>(null);
export const [playerState, setPlayerState] = createSignal<PlayerState>({ status: "idle", positionMs: 0, audioTracks: [], subtitleTracks: [] });
export const [channels, setChannels] = createSignal<Channel[]>([]);
/** The channel live TV is on (or was last on), for the guide's preview and channel up/down. */
export const [liveChannelId, setLiveChannelId] = createSignal<string | null>(null);
/** The channel list the guide last showed for a profile (a GuideChoice id), kept while the app runs. */
export const [guideList, setGuideList] = createSignal<{ profileId: string | null; id: string } | null>(null);
/** The channels in that list, so channel up/down on live TV stays within it, as on Sky. */
export const [listChannels, setListChannels] = createSignal<Channel[]>([]);

agent.onState((s) => setPlayerState(s));

let reportTimer: number | undefined;

export async function loadChannels(): Promise<void> {
  setChannels((await hub.channels()).channels);
}

export function channelById(id: string | null): Channel | undefined {
  return id ? channels().find((c) => c.id === id) : undefined;
}

export function channelByNumber(n: number): Channel | undefined {
  return channels().find((c) => c.number === n);
}

/** The next channel up or down the list, wrapping round. */
export function stepChannel(from: string | null, delta: number): Channel | undefined {
  const list = from && listChannels().some((c) => c.id === from) ? listChannels() : channels();
  if (!list.length) return undefined;
  const i = Math.max(0, list.findIndex((c) => c.id === from));
  return list[(i + delta + list.length) % list.length];
}

async function resolve(req: PlaybackRequest): Promise<PlaybackInfo | null> {
  try {
    return await hub.play(req);
  } catch (err) {
    if (err instanceof ApiError && err.code === "busy") {
      const pick = await choose({
        title: "Your IPTV connection is in use",
        message: err.message,
        options: [
          { label: "Keep recording", value: "keep" },
          { label: "Switch anyway", value: "switch", tone: "danger" },
        ],
      });
      if (pick !== "switch") return null;
      return hub.play({ ...req, force: true } as PlaybackRequest);
    }
    throw err;
  }
}

/**
 * Plays something. `fullscreen` (the default) opens the player screen; the guide passes false to
 * keep its preview window.
 */
export async function play(req: PlaybackRequest, opts: { fullscreen?: boolean; title?: TitleRef; fromStart?: boolean } = {}): Promise<boolean> {
  let info: PlaybackInfo | null;
  try {
    info = await resolve(req);
  } catch (err) {
    errorToast(err);
    return false;
  }
  if (!info) return false;
  // Start again: ignore the resume point (seeking after loading races the player opening the file).
  if (opts.fromStart && !info.live) info = { ...info, startMs: 0 };
  await report("stop");
  const s = (await hub.settings().catch(() => null))?.playback;
  await agent.play({
    url: info.url,
    live: info.live,
    startMs: info.startMs,
    ...(info.headers ? { headers: info.headers } : {}),
    ...(info.fps ? { fps: info.fps } : {}),
    title: info.title,
    ...(info.artwork ? { artwork: info.artwork } : {}),
    subtitles: info.externalSubtitles.map((t) => ({ url: t.url, lang: t.lang, label: t.label })),
    ...(s ? { preferredAudioLang: s.preferredAudioLang, preferredSubtitleLang: s.preferredSubtitleLang, subtitlesByDefault: s.subtitlesByDefault } : {}),
  });
  setNowPlaying({ req, info, ...(opts.title ? { title: opts.title } : {}) });
  if (req.kind === "channel") setLiveChannelId(req.id);
  void report("start");
  clearInterval(reportTimer);
  if (!info.live) reportTimer = window.setInterval(() => void report("progress"), 10_000);
  if (opts.fullscreen !== false) {
    await agent.setLayout({ mode: "fullscreen" });
    if (nav.current().name !== "player") nav.push({ name: "player" });
  }
  return true;
}

async function report(event: "start" | "progress" | "stop"): Promise<void> {
  const np = nowPlaying();
  if (!np || np.info.live) return;
  const st = playerState();
  await hub
    .progress({
      key: np.info.progressKey,
      positionMs: st.positionMs,
      event,
      paused: st.status === "paused",
      ...(st.durationMs ?? np.info.durationMs ? { durationMs: st.durationMs ?? np.info.durationMs } : {}),
      ...(np.title ? { title: np.title } : {}),
    })
    .catch(() => undefined);
}

export async function stopPlayback(): Promise<void> {
  clearInterval(reportTimer);
  await report("stop");
  setNowPlaying(null);
  await agent.stop();
  await agent.setLayout({ mode: "hidden" });
}

export function isLive(): boolean {
  return nowPlaying()?.info.live ?? false;
}
