// Audio description (Settings › Accessibility): once the player knows a title's sound tracks,
// switch to the described one for a profile that wants it, or away from it for one that doesn't
// (some files mark the described track as the default).

import { audioTrackFor } from "@ultimatetv/shared";
import { agent } from "./agent";
import { nowPlaying, playerState, type NowPlaying } from "./player";
import { accessibility, toast } from "./store";

export async function autoAudioDescription(np: NowPlaying, preferredLang?: string): Promise<void> {
  for (let i = 0; i < 30 && nowPlaying() === np && playerState().status !== "playing"; i++) await new Promise((r) => setTimeout(r, 1000));
  const st = playerState();
  if (nowPlaying() !== np || st.status !== "playing") return;
  const want = accessibility().audioDescription;
  const id = audioTrackFor(st.audioTracks, want, preferredLang);
  if (id === undefined) return;
  await agent.setAudioTrack(id).catch(() => undefined);
  if (want) toast("Audio description on. Yellow › Audio for the others");
}
