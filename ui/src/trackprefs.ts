// Remembering the audio and subtitle choice per series and profile (issue #228). The choice is a
// language, applied to the next episode, Up Next and Resume by matching the language on whichever
// source the episode comes from. "Default" clears it.

import { rememberedAudio, rememberedSubtitle, trackLang, type TrackPref } from "@ultimatetv/shared";
import { agent } from "./agent";
import { hub } from "./api";
import { nowPlaying, playerState, type NowPlaying } from "./player";
import { toast } from "./store";

/** Films and shows (not live TV, links or recordings) have an id to remember it under. */
const titleOf = (np: NowPlaying | null): string | null => (np && np.req.kind === "title" && !np.info.live ? np.req.id : null);
export const canRemember = () => titleOf(nowPlaying()) !== null;

async function save(body: Pick<TrackPref, "audio" | "subtitle">): Promise<void> {
  const title = titleOf(nowPlaying());
  if (!title) return;
  await hub.saveTrackPref({ title, ...body }).catch(() => undefined);
}

/** The person picked a sound track: do it, and remember its language for this series. */
export async function chooseAudio(id: number): Promise<void> {
  await agent.setAudioTrack(id);
  const t = playerState().audioTracks.find((x) => x.id === id);
  if (t?.lang) await save({ audio: { lang: trackLang(t.lang), ...(t.audioDescription ? { description: true } : {}) } });
}

/** Subtitles on a track, or off (null). */
export async function chooseSubtitle(id: number | null): Promise<void> {
  await agent.setSubtitleTrack(id);
  if (id === null) return save({ subtitle: "off" });
  const t = playerState().subtitleTracks.find((x) => x.id === id);
  if (t?.lang) await save({ subtitle: { lang: trackLang(t.lang) } });
}

/** Options › Default: forget this series' choice and go back to the profile's own settings. */
export async function clearRemembered(): Promise<void> {
  const title = titleOf(nowPlaying());
  if (!title) return;
  await hub.clearTrackPref(title).catch(() => undefined);
  toast("Back to your usual sound and subtitles from the next episode");
}

/**
 * Called as something starts: once the player knows its tracks, apply what this profile chose last
 * time. True when a choice was found, so the profile's defaults (and OpenSubtitles) stay out of it.
 */
export async function applyRemembered(np: NowPlaying): Promise<boolean> {
  const title = titleOf(np);
  if (!title) return false;
  const { pref } = await hub.trackPref(title).catch(() => ({ pref: null }));
  if (!pref) return false;
  for (let i = 0; i < 30 && nowPlaying() === np && playerState().status !== "playing"; i++) await new Promise((r) => setTimeout(r, 1000));
  const st = playerState();
  if (nowPlaying() !== np || st.status !== "playing") return true;
  const a = rememberedAudio(st.audioTracks, pref);
  if (a !== undefined) await agent.setAudioTrack(a).catch(() => undefined);
  const s = rememberedSubtitle(st.subtitleTracks, pref);
  if (s !== undefined) await agent.setSubtitleTrack(s).catch(() => undefined);
  return true;
}
