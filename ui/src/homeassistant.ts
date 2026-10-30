// Home Assistant both ways, the TV's half: tells the Hub what's playing whenever it changes (the
// Hub hands it on as a media player and as webhook events), and does what Home Assistant asks
// through the Hub (play, pause, stop, volume, channels, standby). See hub/src/homeassistant.ts.

import { createEffect, createSignal, on } from "solid-js";
import type { HaCommand, HaKind, TvPlayState } from "@ultimatetv/shared";
import { agent, agentHas, onBox } from "./agent";
import { api } from "./api";
import { onAnyKey } from "./keys";
import { channels, liveChannelId, nowPlaying, play, playerState, stepChannel, stopPlayback, type NowPlaying } from "./player";
import { profile } from "./store";

/** The box player's volume (0–100) as Home Assistant last set it; the box resets it to full for each new thing. */
const [volume, setVolumeSignal] = createSignal(100);
const [muted, setMuted] = createSignal(false);
/** Put to standby from here (Home Assistant or the sleep timer), until a key or something plays. */
const [tvOff, setTvOff] = createSignal(false);

/** The sleep timer put the TV to standby. */
export const markTvOff = () => setTvOff(true);

/** Film, episode, live TV or something else, for automations that only care about films. */
export function kindOf(np: NowPlaying): HaKind {
  if (np.info.live) return "live";
  if (np.req.kind === "title") return np.req.episodeId || np.title?.kind === "series" ? "episode" : "film";
  if (np.req.kind === "recording" || np.req.kind === "catchup") {
    // The guide doesn't say which programmes are films, so go by the episode label and the length.
    if (/^S\d+/i.test(np.info.subtitle ?? "")) return "episode";
    return (np.info.durationMs ?? 0) >= 80 * 60_000 ? "film" : "episode";
  }
  return "video";
}

/** The credits are rolling: Jellyfin's credits marker, or else the last few minutes. */
export function inCredits(np: NowPlaying, positionMs: number, durationMs: number | undefined): boolean {
  if (np.info.live) return false;
  const marker = np.info.skip.find((s) => s.kind === "credits");
  if (marker) return positionMs >= marker.startMs;
  if (!durationMs || durationMs < 10 * 60_000) return false;
  return positionMs >= durationMs - Math.max(30_000, Math.min(5 * 60_000, durationMs * 0.05));
}

function current(): TvPlayState {
  const np = nowPlaying();
  const st = playerState();
  const p = profile();
  const status: TvPlayState["status"] = tvOff()
    ? "off"
    : !np
      ? "idle"
      : st.status === "paused"
        ? "paused"
        : st.status === "loading" || st.status === "buffering"
          ? "buffering"
          : st.status === "playing"
            ? "playing"
            : "idle";
  let playing: TvPlayState["playing"] = null;
  if (np) {
    const kind = kindOf(np);
    const durationMs = st.durationMs ?? np.info.durationMs;
    const channel = np.req.kind === "channel" ? channels().find((c) => c.id === (liveChannelId() ?? np.req.id)) : undefined;
    const se = np.req.kind === "title" ? /s(\d+)e(\d+)$/i.exec(np.req.episodeId ?? "") : null;
    playing = {
      key: np.info.progressKey,
      kind,
      title: kind === "live" ? (channel?.name ?? np.info.title) : (np.title?.name ?? np.info.title),
      positionMs: st.positionMs,
      credits: inCredits(np, st.positionMs, durationMs),
      ...(np.info.subtitle ? { subtitle: np.info.subtitle } : {}),
      ...(se ? { season: Number(se[1]), episode: Number(se[2]) } : {}),
      ...(channel ? { channel: { id: channel.id, number: channel.number, name: channel.name } } : {}),
      ...(durationMs ? { durationMs } : {}),
      ...(np.info.source ? { source: np.info.source.label } : {}),
    };
    const art = np.info.artwork ?? np.title?.backdrop ?? np.title?.poster ?? np.info.logo;
    if (art) playing.artwork = art;
  }
  return { status, profile: p ? { id: p.id, name: p.name, kind: p.kind === "kids" ? "kids" : "adult" } : null, playing, volume: volume(), muted: muted() };
}

/** What has to change for a report to be worth sending (the position only when it jumps). */
const signature = (s: TvPlayState) => JSON.stringify([s.status, s.profile?.id, s.playing?.key, s.playing?.subtitle, s.playing?.credits, s.playing?.durationMs ? Math.round(s.playing.durationMs / 1000) : 0, s.volume, s.muted]);

let sent: { sig: string; at: number; positionMs: number; status: TvPlayState["status"] } | null = null;
let pending: number | undefined;

async function send(): Promise<void> {
  pending = undefined;
  const s = current();
  sent = { sig: signature(s), at: Date.now(), positionMs: s.playing?.positionMs ?? 0, status: s.status };
  await api("/api/ha/state", { method: "POST", body: s }).catch(() => undefined);
}

/** Sends soon (a moment's wait lets a burst of changes go as one), well inside the 2 s Home Assistant expects. */
function soon(): void {
  if (pending === undefined) pending = window.setTimeout(() => void send(), 300);
}

/** A seek, or the position drifting from where Home Assistant thinks it is. */
function jumped(s: TvPlayState): boolean {
  if (!sent || !s.playing || s.playing.kind === "live") return false;
  const expected = sent.positionMs + (sent.status === "playing" ? Date.now() - sent.at : 0);
  return Math.abs(s.playing.positionMs - expected) > 4000;
}

/** Puts the box player's volume back after a new thing starts at full. */
async function applyVolume(): Promise<void> {
  if (agentHas("setVolume") && (volume() !== 100 || muted())) await agent.setVolume(muted() ? 0 : volume()).catch(() => undefined);
}

async function setVolume(v: number, mute = muted()): Promise<void> {
  if (!agentHas("setVolume")) throw new Error("The TV box needs updating before its volume can be set");
  setVolumeSignal(Math.min(100, Math.max(0, Math.round(v))));
  setMuted(mute);
  await agent.setVolume(mute ? 0 : volume());
}

async function playChannel(id: string | undefined): Promise<void> {
  if (!id) throw new Error("There are no channels to play");
  if (!(await play({ kind: "channel", id }))) throw new Error("That channel didn't start");
}

/** A channel by its number or name ("101", "BBC One", "bbc one hd"). */
function channelFor(source: string): string | undefined {
  const list = channels();
  const n = Number(source);
  if (Number.isInteger(n)) {
    const byNumber = list.find((c) => c.number === n);
    if (byNumber) return byNumber.id;
  }
  const want = source.toLowerCase();
  return (list.find((c) => c.name.toLowerCase() === want) ?? list.find((c) => c.name.toLowerCase().startsWith(want)) ?? list.find((c) => c.name.toLowerCase().includes(want)))?.id;
}

/** Does what Home Assistant asked (relayed by the Hub as the "ha" TV call). */
export async function haCommand(cmd: HaCommand): Promise<{ ok: true }> {
  const np = nowPlaying();
  const st = playerState().status;
  const running = st === "playing" || st === "buffering" || st === "loading";
  if (cmd.command !== "turn_off") setTvOff(false);
  switch (cmd.command) {
    case "play":
      if (np) await agent.pause(false);
      else await playChannel(liveChannelId() ?? channels()[0]?.id);
      break;
    case "pause":
      if (np && running) await agent.pause(true);
      break;
    case "play_pause":
      if (np) await agent.pause(running);
      else await playChannel(liveChannelId() ?? channels()[0]?.id);
      break;
    case "stop":
      if (np) await stopPlayback();
      break;
    case "volume_set":
      await setVolume(cmd.value * 100, false);
      break;
    case "volume_up":
      await setVolume(volume() + 5, false);
      break;
    case "volume_down":
      await setVolume(volume() - 5, false);
      break;
    case "volume_mute":
      await setVolume(volume(), cmd.value);
      break;
    case "channel_up":
    case "channel_down":
      await playChannel(np?.info.live ? stepChannel(liveChannelId(), cmd.command === "channel_up" ? 1 : -1)?.id : (liveChannelId() ?? channels()[0]?.id));
      break;
    case "select_source": {
      const id = channelFor(cmd.value);
      if (!id) throw new Error(`No channel called ${cmd.value}`);
      await playChannel(id);
      break;
    }
    case "turn_on":
      if (agentHas("wakeTv")) await agent.wakeTv();
      break;
    case "turn_off":
      if (np) await stopPlayback();
      if (!agentHas("tvStandby")) throw new Error("The TV box needs updating before it can put the TV to standby");
      await agent.tvStandby();
      setTvOff(true);
      break;
  }
  void send();
  return { ok: true };
}

export function startHomeAssistant(): void {
  // Only the box reports: a TV app open in a browser (development) would muddle the state.
  if (!onBox) return;
  onAnyKey(() => setTvOff(false));
  createEffect(
    on(nowPlaying, (np) => {
      if (np) {
        setTvOff(false);
        void applyVolume();
      }
    }),
  );
  createEffect(() => {
    const s = current();
    if (!sent || signature(s) !== sent.sig || jumped(s)) soon();
  });
  // Now and then anyway, so the Hub's idea of the position and a restarted Hub catch up.
  window.setInterval(() => void send(), 30_000);
  void send();
}
