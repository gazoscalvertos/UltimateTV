// Starting and stopping playback, whoever asks: a channel from the guide, a title, a recording.
// Handles the "a recording is using the connection" prompt and reports progress to the Hub.

import { createSignal } from "solid-js";
import type { Channel, PlaybackInfo, PlaybackRequest, PlayerState, TitleRef } from "@ultimatetv/shared";
import { agent, agentHas, onBox } from "./agent";
import { ApiError, hub } from "./api";
import { choose } from "./components/Dialog";
import { playRefused } from "./kidstime";
import { startedPlaying } from "./queue";
import { autoSubtitles, subtitleModeFor } from "./subtitles";
import { autoAudioDescription } from "./accessibility";
import { errorToast, nav } from "./store";

export interface NowPlaying {
  req: PlaybackRequest;
  info: PlaybackInfo;
  title?: TitleRef;
  /** When Play was pressed, for the "starting" card's timer. */
  since: number;
  /** Carried on from the last episode: no "starting" card, just the picture when it's ready. */
  quiet?: boolean;
  /** Playing from a download on the box's disk. */
  downloadId?: string;
}

export const [nowPlaying, setNowPlaying] = createSignal<NowPlaying | null>(null);
/** Something is being looked up before it can play (finding versions can take a while). */
export const [starting, setStarting] = createSignal<{ name: string; since: number } | null>(null);
export const [playerState, setPlayerState] = createSignal<PlayerState>({ status: "idle", positionMs: 0, audioTracks: [], subtitleTracks: [] });
export const [channels, setChannels] = createSignal<Channel[]>([]);
/** The channel live TV is on (or was last on), for the guide's preview and channel up/down. */
export const [liveChannelId, setLiveChannelId] = createSignal<string | null>(null);
/** The channel list the guide last showed for a profile (a GuideChoice id), kept while the app runs. */
export const [guideList, setGuideList] = createSignal<{ profileId: string | null; id: string } | null>(null);
/** The channels in that list, so channel up/down on live TV stays within it, as on Sky. */
export const [listChannels, setListChannels] = createSignal<Channel[]>([]);

let lastPlace: { since: number; positionMs: number; durationMs?: number } | null = null;
agent.onState((s) => {
  setPlayerState(s);
  // The last real place, for the stop report: mpv can say 0 once a file has ended or stopped.
  const np = nowPlaying();
  if (np && !np.info.live && s.positionMs > 0 && s.status !== "loading" && s.status !== "idle") lastPlace = { since: np.since, positionMs: s.positionMs, ...(s.durationMs ? { durationMs: s.durationMs } : {}) };
});

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

/**
 * A finished download of a film, episode or recording plays from the box's disk: it works with the
 * NAS out of reach, and starts at once. Picking a version by hand still streams that version.
 */
async function fromDisk(req: PlaybackRequest): Promise<(PlaybackInfo & { downloadId: string }) | null> {
  if (!onBox || !agentHas("localCopy") || req.streamId || req.kind === "channel") return null;
  return agent.localCopy(req).catch(() => null);
}

async function resolve(req: PlaybackRequest): Promise<PlaybackInfo | null> {
  const local = await fromDisk(req);
  if (local) return local;
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
interface PlayOpts {
  fullscreen?: boolean;
  title?: TitleRef;
  fromStart?: boolean;
  /** The next episode, looked up ahead of time: start it without the "finding" and "starting" cards. */
  quiet?: boolean;
  /** Already known how to play (a link sent from a phone): don't ask the Hub. */
  info?: PlaybackInfo;
}

let playCount = 0;

export async function play(req: PlaybackRequest, opts: PlayOpts = {}): Promise<boolean> {
  const since = Date.now();
  const n = ++playCount;
  // Live channels answer at once; titles may ask every source first, so say what's happening.
  if (req.kind !== "channel" && !opts.quiet) setStarting({ name: opts.title?.name ?? "", since });
  try {
    return await start(req, opts, since, n);
  } finally {
    if (n === playCount) setStarting(null);
  }
}

/** Back while a title is being looked up: forget it, so it doesn't start a moment later. */
export function cancelStarting(): void {
  playCount++;
  setStarting(null);
}

async function start(req: PlaybackRequest, opts: PlayOpts, since: number, n: number): Promise<boolean> {
  let info: PlaybackInfo | null;
  try {
    info = opts.info ?? (await resolve(req));
  } catch (err) {
    // A Kids profile's time is up: back to the profile picker, not a toast.
    if (n === playCount && !playRefused(err)) errorToast(err);
    return false;
  }
  if (!info || n !== playCount) return false;
  // Start again: ignore the resume point (seeking after loading races the player opening the file).
  if (opts.fromStart && !info.live) info = { ...info, startMs: 0 };
  await report("stop");
  const settings = await hub.settings().catch(() => null);
  const s = settings?.playback;
  await agent.play({
    url: info.url,
    live: info.live,
    startMs: info.startMs,
    ...(info.headers ? { headers: info.headers } : {}),
    ...(info.fps ? { fps: info.fps } : {}),
    title: info.title,
    ...(info.artwork ? { artwork: info.artwork } : {}),
    subtitles: info.externalSubtitles.map((t) => ({ url: t.url, lang: t.lang, label: t.label })),
    ...(info.queue?.length ? { queue: info.queue } : {}),
    ...(info.fill ? { fill: true } : {}),
    ...(info.crops ? { crops: info.crops } : {}),
    ...(s ? { preferredAudioLang: s.preferredAudioLang, preferredSubtitleLang: s.preferredSubtitleLang, subtitlesByDefault: subtitleModeFor(s) !== "off", subtitleMode: subtitleModeFor(s) } : {}),
    ...(s?.subtitleStyle ? { subtitleStyle: s.subtitleStyle } : {}),
  });
  const downloadId = (info as { downloadId?: string }).downloadId;
  setNowPlaying({ req, info, since, ...(opts.title ? { title: opts.title } : {}), ...(opts.quiet ? { quiet: true } : {}), ...(downloadId ? { downloadId } : {}) });
  if (req.kind === "channel") setLiveChannelId(req.id);
  startedPlaying(req);
  const np = nowPlaying();
  if (np) void autoSubtitles(np, settings);
  if (np) void autoAudioDescription(np, s?.preferredAudioLang);
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
  // A link from a phone has nowhere to keep its place.
  if (!np || np.info.live || np.info.progressKey.startsWith("link:")) return;
  const st = playerState();
  const last = lastPlace?.since === np.since ? lastPlace : null;
  const durationMs = st.durationMs ?? last?.durationMs ?? np.info.durationMs;
  // At the end the place is the end (mpv may already say 0); otherwise the latest real place.
  const positionMs = st.status === "ended" && durationMs ? durationMs : st.positionMs > 0 ? st.positionMs : (last?.positionMs ?? 0);
  // The box keeps a download's place itself, as the Hub (or Jellyfin) may be out of reach.
  if (np.downloadId) void agent.downloadPosition(np.downloadId, positionMs, durationMs).catch(() => undefined);
  await hub
    .progress({
      key: np.info.progressKey,
      positionMs,
      event,
      paused: st.status === "paused",
      ...(durationMs ? { durationMs } : {}),
      ...(np.title ? { title: np.title } : {}),
    })
    .catch(() => undefined);
}

/** Plays a link sent from a phone: a video file, a stream, or a YouTube page (mpv on the box uses yt-dlp). */
export function playLink(url: string, title: string): Promise<boolean> {
  const info: PlaybackInfo = { url, title, live: false, startMs: 0, externalSubtitles: [], progressKey: `link:${url}`, skip: [] };
  return play({ kind: "stream", id: `link:${url}` }, { info, title: { id: `link:${url}`, kind: "movie", name: title } as TitleRef });
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
