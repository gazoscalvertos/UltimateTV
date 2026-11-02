// Radio stations and podcasts. The Hub knows the stations and reads the podcast feeds; the TV
// asks for a stream address and plays it the way it plays any other live stream, so the box needs
// no new trick — Play/Pause is the player's own, and the Music tab draws its own now-playing panel
// because a radio stream has no picture to show behind it.

import { createSignal } from "solid-js";
import type { PlaybackInfo, PodcastEpisode, PodcastShow, PodcastShowWithEpisodes, RadioStation, TitleRef } from "@ultimatetv/shared";
import { agent } from "./agent";
import { hub } from "./api";
import { nowPlaying, play, playerState, stopPlayback } from "./player";
import { errorToast, toast } from "./store";

/** The station or episode the Music tab is playing. */
export type RadioPick = { kind: "station"; station: RadioStation } | { kind: "episode"; show: PodcastShow; episode: PodcastEpisode };

const [stations, setStations] = createSignal<RadioStation[]>([]);
const [shows, setShows] = createSignal<PodcastShow[]>([]);
const [pick, setPick] = createSignal<RadioPick | null>(null);
const [nowLine, setNowLine] = createSignal<Record<string, string>>({});
const [busy, setBusy] = createSignal<string | null>(null);

/** How often a podcast's place is sent back while it plays. */
const SAVE_EVERY_MS = 15_000;
let saveTimer = 0;
/** The episode whose place we're keeping, so it can be sent on the way out too. */
let saving: { showId: string; episodeId: string } | null = null;

const reqIdFor = (p: RadioPick): string => (p.kind === "station" ? `radio:${p.station.id}` : `podcast:${p.episode.id}`);

const refFor = (p: RadioPick): TitleRef => ({
  id: reqIdFor(p),
  kind: "movie",
  name: p.kind === "station" ? p.station.name : p.episode.title,
  ...(p.kind === "station" && p.station.logo ? { poster: p.station.logo } : {}),
  ...(p.kind === "episode" && p.episode.image ? { poster: p.episode.image } : {}),
});

export const radioStations = (): RadioStation[] => stations();
export const podcastShows = (): PodcastShow[] => shows();
export const radioBusy = (): string | null => busy();

/**
 * What's playing from here, or null: a video, or the radio stopped, means the panel goes away.
 * (The player owns "what's on" — this only says whether the thing on is ours.)
 */
export function radioPlaying(): RadioPick | null {
  const np = nowPlaying();
  const p = pick();
  return np && p && np.req.id === reqIdFor(p) ? p : null;
}

/** Radio or a podcast is what's on: the Music tab's panel, and the remote's Play/Pause key. */
export const radioOn = (): boolean => radioPlaying() !== null;

/** Play/Pause without needing to know which. Pausing radio leaves the station loaded. */
export async function radioPause(): Promise<void> {
  if (!radioPlaying()) return;
  if (playerState().status === "paused") return;
  await agent.pause(true).catch(() => undefined);
}

/** The line the screensaver shows while a station or an episode plays: "♪ Radio 2 · Dua Lipa — Houdini". */
export function radioLine(): string {
  const p = radioPlaying();
  if (!p) return "";
  if (p.kind === "station") {
    const now = nowLine()[p.station.id];
    return now ? `${p.station.name} · ${now}` : p.station.name;
  }
  return `${p.episode.title} · ${p.show.title}`;
}

export async function loadRadio(): Promise<void> {
  const reply = await hub.radio();
  setStations(reply.stations);
}

export async function loadPodcasts(): Promise<void> {
  const reply = await hub.podcasts();
  setShows(reply.shows);
}

/** Starts a station. Any video playing stops, as the box does for every play. */
export async function playStation(station: RadioStation): Promise<boolean> {
  return start({ kind: "station", station });
}

export async function playStationById(id: string): Promise<boolean> {
  const known = stations().find((s) => s.id === id);
  if (known) return playStation(known);
  // Asked for by the phone or by voice before the list was read: ask the Hub for that one.
  try {
    const reply = await hub.radio();
    setStations(reply.stations);
    const station = reply.stations.find((s) => s.id === id);
    if (!station) throw new Error("That station isn't on the list any more");
    return playStation(station);
  } catch (err) {
    errorToast(err);
    return false;
  }
}

export async function playEpisode(show: PodcastShow, episode: PodcastEpisode, fromStart = false): Promise<boolean> {
  return start({ kind: "episode", show, episode }, fromStart);
}

async function start(p: RadioPick, fromStart = false): Promise<boolean> {
  const id = reqIdFor(p);
  setBusy(id);
  try {
    const info: PlaybackInfo = p.kind === "station" ? await hub.radioPlay(p.station.id) : await hub.podcastPlay(p.show.id, p.episode.id, fromStart);
    setPick(p);
    // Not the full-screen player: a station has no picture, so the Music tab stays up.
    const ok = await play({ kind: "stream", id }, { info, title: refFor(p), fullscreen: false, ...(fromStart ? { fromStart: true } : {}) });
    if (!ok) {
      setPick(null);
      return false;
    }
    if (p.kind === "episode") startSaving(p.show.id, p.episode.id);
    return true;
  } catch (err) {
    setPick(null);
    errorToast(err);
    return false;
  } finally {
    setBusy(null);
  }
}

/** Play/Pause for whatever the Music tab is playing. */
export async function radioPauseToggle(): Promise<void> {
  await agent.pause(playerState().status !== "paused");
}

export async function stopRadio(): Promise<void> {
  if (!radioPlaying()) return;
  stopSaving();
  await stopPlayback();
  setPick(null);
}

/** Adds a station the household typed in. Returns it, or throws with the Hub's reason. */
export async function addStation(name: string, url: string): Promise<RadioStation | null> {
  try {
    const reply = await hub.addStation(name.trim(), url.trim());
    setStations(reply.stations);
    toast(`${reply.station.name} added`, "good");
    return reply.station;
  } catch (err) {
    errorToast(err);
    return null;
  }
}

export async function removeStation(id: string): Promise<void> {
  try {
    const reply = await hub.removeStation(id);
    setStations(reply.stations);
    const on = radioPlaying();
    if (on?.kind === "station" && on.station.id === id) await stopRadio();
  } catch (err) {
    errorToast(err);
  }
}

/**
 * A station's now-playing line ("Dua Lipa — Houdini"), if its stream sends one. Asked for once
 * per station every half minute: the Hub caches the answer, so several TVs don't hammer the stream.
 */
export async function refreshNow(stationId: string): Promise<void> {
  try {
    const reply = await hub.radioNow(stationId);
    if (!reply.now) return;
    setNowLine((all) => ({ ...all, [stationId]: reply.now! }));
  } catch {
    // A stream that won't answer just has no now-playing line.
  }
}

export const nowLineFor = (stationId: string): string | undefined => nowLine()[stationId];

/** Follows a feed: by a search result's address, or one pasted in. */
export async function followFeed(feedUrl: string): Promise<PodcastShow | null> {
  try {
    const reply = await hub.followPodcast(feedUrl.trim());
    setShows(reply.shows);
    toast(`${reply.show.title} added`, "good");
    return reply.show;
  } catch (err) {
    errorToast(err);
    return null;
  }
}

export async function unfollow(id: string): Promise<void> {
  try {
    const reply = await hub.unfollowPodcast(id);
    setShows(reply.shows);
    const on = radioPlaying();
    if (on?.kind === "episode" && on.show.id === id) await stopRadio();
  } catch (err) {
    errorToast(err);
  }
}

/** The episodes of one show, as freshly read (opening it also clears its new-episode badge). */
export async function openShow(id: string): Promise<PodcastShowWithEpisodes | null> {
  try {
    const reply = await hub.podcast(id);
    setShows((all) => all.map((s) => (s.id === id ? reply.show : s)));
    return reply;
  } catch (err) {
    errorToast(err);
    return null;
  }
}

function startSaving(showId: string, episodeId: string): void {
  stopSaving();
  saving = { showId, episodeId };
  saveTimer = window.setInterval(() => savePlace(), SAVE_EVERY_MS);
}

function stopSaving(): void {
  window.clearInterval(saveTimer);
  saveTimer = 0;
  savePlace();
  saving = null;
}

/** Sends where we got to, so the next listen carries on from there. */
function savePlace(): void {
  if (!saving) return;
  const st = playerState();
  const np = nowPlaying();
  if (!np || np.req.id !== `podcast:${saving.episodeId}`) return;
  if (st.status === "ended" && st.durationMs) {
    void hub.podcastPosition(saving.episodeId, st.durationMs, st.durationMs).catch(() => undefined);
    return;
  }
  if (st.positionMs <= 0) return;
  void hub.podcastPosition(saving.episodeId, st.positionMs, st.durationMs ?? undefined).catch(() => undefined);
}
