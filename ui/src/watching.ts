// Watching elsewhere and Sync play on the TV (see shared/src/watching.ts for the idea).
//
// While something plays, the TV tells the Hub what and where every few seconds. The Hub answers
// with anything another screen asked of it ("stop, they've carried on on the phone") and, while
// in a Sync play group, the group's shared clock, which the TV follows.

import { createSignal } from "solid-js";
import type { PlaybackRequest, SyncAction, SyncGroup, WatchClient, WatchCommand, WatchReport, WatchSession } from "@ultimatetv/shared";
import { positionAt, syncCorrection, WATCH_REPORT_MS } from "@ultimatetv/shared";
import { agent, onBox, onDesktop } from "./agent";
import { api } from "./api";
import { nowPlaying, play, playerState, stopPlayback } from "./player";
import { toast } from "./store";

const client: WatchClient = onDesktop ? "desktop" : onBox ? "tv" : "browser";
const enc = encodeURIComponent;

/** Other screens' playback, while the TV is looking (the top bar chip and the Watching elsewhere screen). */
export const [elsewhere, setElsewhere] = createSignal<WatchSession[]>([]);
/** The Sync play group this TV is in, if any. */
export const [syncGroup, setSyncGroup] = createSignal<SyncGroup | null>(null);

/** Hub clock minus ours, so positions worked out from the Hub's `at` line up. */
let offset = 0;
const hubNow = () => Date.now() + offset;
const learnClock = (hubTime: unknown) => {
  if (typeof hubTime === "number" && Number.isFinite(hubTime)) offset = hubTime - Date.now();
};

/** Our device id as the Hub knows us. */
let myDevice: string | null = null;
const isMe = (device: string) => device === myDevice;

/** While applying the group's clock, our own pause and seek aren't news to send back. */
let applyingUntil = 0;

const sameReq = (a: PlaybackRequest, b: PlaybackRequest) => a.kind === b.kind && a.id === b.id && (a.episodeId ?? "") === (b.episodeId ?? "");

function buildReport(event: WatchReport["event"]): WatchReport | null {
  const np = nowPlaying();
  if (!np || np.info.progressKey.startsWith("link:")) return null;
  const st = playerState();
  const name = np.title?.name ?? np.info.title;
  const subtitle = np.info.subtitle ?? (np.title && np.info.title !== np.title.name ? np.info.title : undefined);
  const artwork = np.title?.backdrop ?? np.title?.poster ?? np.info.artwork ?? np.info.logo;
  const durationMs = st.durationMs ?? np.info.durationMs;
  const g = syncGroup();
  return {
    req: np.req,
    name,
    ...(subtitle ? { subtitle } : {}),
    ...(artwork ? { artwork } : {}),
    ...(np.title ? { title: np.title } : {}),
    live: np.info.live,
    positionMs: Math.max(0, Math.round(st.positionMs)),
    ...(durationMs ? { durationMs } : {}),
    paused: st.status === "paused",
    event,
    client,
    ...(g && !g.ended ? { sync: g.id } : {}),
  };
}

/** The last report sent, and what it was about, so a stop names the thing that stopped. */
let lastSent: WatchReport | null = null;
let sentKey: string | null = null;
const keyOf = () => {
  const np = nowPlaying();
  return np ? `${np.req.kind}|${np.req.id}|${np.req.episodeId ?? ""}|${np.since}` : null;
};

/** Tells the Hub what's playing, and does whatever it says another screen asked. */
export async function reportWatching(event: WatchReport["event"] = "progress"): Promise<void> {
  // A stop is about what was last reported: by now the player may already be on the next thing.
  const r = event === "stop" ? (lastSent ? { ...lastSent, event: "stop" as const } : null) : buildReport(event);
  if (!r) return;
  if (event === "stop") {
    lastSent = null;
    sentKey = null;
  } else {
    lastSent = r;
    sentKey = keyOf();
  }
  try {
    const res = await api<{ now: number; me?: string; commands: WatchCommand[]; sync: SyncGroup | null }>("/api/watching", { method: "POST", body: r });
    learnClock(res.now);
    if (res.me) myDevice = res.me;
    if (event === "stop") return;
    for (const c of res.commands ?? []) void obey(c);
    if (res.sync) follow(res.sync);
  } catch {
    // The Hub is away: nothing to share, and the film plays on.
  }
}

async function obey(c: WatchCommand): Promise<void> {
  if (c.type === "pause") {
    applyingUntil = Date.now() + 1500;
    await agent.pause(true).catch(() => undefined);
    toast("Paused from another screen");
  } else if (c.type === "stop") {
    toast("Carried on on another screen");
    await stopPlayback();
  } else if (c.type === "sync") {
    await joinGroup(c.group);
  }
}

// -------------------------------------------------------------------------------------------------
// Sync play

let polling: string | null = null;

/** Starts following a group this TV is already playing (another screen joined us). */
async function joinGroup(id: string): Promise<void> {
  const res = await api<{ now: number; group: SyncGroup }>(`/api/sync/${enc(id)}`).catch(() => null);
  if (!res) return;
  learnClock(res.now);
  const others = res.group.members.filter((m) => !isMe(m.device)).map((m) => m.deviceName);
  follow(res.group);
  toast(`Sync play with ${others.join(" and ") || "another screen"}: pausing or skipping on one does both`);
}

/** Takes the group's latest clock, lines the player up with it, and keeps listening for changes. */
function follow(g: SyncGroup): void {
  const before = syncGroup();
  // Ended, or we were taken out (gone quiet too long): stop following.
  if (g.ended || (myDevice && !g.members.some((m) => m.device === myDevice))) {
    if (before && before.id === g.id) {
      toast("Sync play has ended");
      leaveLocally();
    }
    return;
  }
  setSyncGroup(g);
  if (!before || before.seq !== g.seq) {
    if (before && g.last && g.last.action !== "join" && g.last.action !== "leave" && before.id === g.id) {
      const verb = g.last.action === "pause" ? "paused" : g.last.action === "play" ? "pressed play" : "skipped";
      if (!isMe(g.last.device)) toast(`${g.last.deviceName} ${verb}`);
    }
    void line();
  }
  if (polling !== g.id) void poll(g.id);
}

/** Moves the player to where the shared clock says, unless it's close enough already. */
async function line(): Promise<void> {
  const g = syncGroup();
  const np = nowPlaying();
  if (!g || !np || !sameReq(np.req, g.req)) return;
  const st = playerState();
  // Still opening the file: it lines up once it's playing.
  if (st.status === "loading" || st.status === "idle" || st.status === "buffering") return;
  const fix = syncCorrection({ positionMs: st.positionMs, paused: st.status === "paused" }, g, hubNow());
  if (fix.pause === undefined && fix.seekTo === undefined) return;
  applyingUntil = Date.now() + 2000;
  if (fix.seekTo !== undefined) await agent.seek(fix.seekTo, "absolute").catch(() => undefined);
  if (fix.pause !== undefined) await agent.pause(fix.pause).catch(() => undefined);
}

/** Long-polls the group, so a pause in the kitchen pauses the living room within a moment. */
async function poll(id: string): Promise<void> {
  polling = id;
  while (polling === id) {
    const g = syncGroup();
    if (!g || g.id !== id) break;
    const res = await api<{ now: number; group: SyncGroup }>(`/api/sync/${enc(id)}?since=${g.seq}&wait=20000`).catch((err: { status?: number }) => (err?.status === 404 ? "gone" : null));
    if (polling !== id) break;
    if (res === "gone") {
      if (syncGroup()?.id === id) {
        toast("Sync play has ended");
        leaveLocally();
      }
      break;
    }
    if (!res) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    learnClock(res.now);
    follow(res.group);
  }
  if (polling === id) polling = null;
}

function leaveLocally(): void {
  polling = null;
  setSyncGroup(null);
}

/** Leaves Sync play, carrying on watching here on our own. */
export async function leaveSync(): Promise<void> {
  const g = syncGroup();
  leaveLocally();
  if (g) await api(`/api/sync/${enc(g.id)}/leave`, { method: "POST", body: {} }).catch(() => undefined);
}

/** Tells the group about a pause, play or seek pressed here. */
async function tellGroup(action: SyncAction, positionMs: number): Promise<void> {
  const g = syncGroup();
  if (!g || Date.now() < applyingUntil) return;
  const res = await api<{ now: number; group: SyncGroup }>(`/api/sync/${enc(g.id)}/action`, { method: "POST", body: { action, positionMs: Math.round(positionMs) } }).catch(() => null);
  if (res) {
    learnClock(res.now);
    setSyncGroup(res.group);
  }
}

/** A seek pressed on the TV (or the phone remote): in Sync play, everyone follows. */
export async function userSeek(ms: number, mode: "absolute" | "relative"): Promise<void> {
  const from = playerState().positionMs;
  await agent.seek(ms, mode);
  if (syncGroup() && !nowPlaying()?.info.live) {
    const to = mode === "absolute" ? ms : Math.max(0, from + ms);
    await tellGroup("seek", to);
  }
}

// -------------------------------------------------------------------------------------------------
// Carrying on from another screen

export async function loadElsewhere(): Promise<WatchSession[]> {
  const res = await api<{ now: number; me: string | null; sessions: WatchSession[] }>("/api/watching");
  learnClock(res.now);
  myDevice = res.me;
  setElsewhere(res.sessions);
  return res.sessions;
}

/** Where another screen has got to now. */
export const placeOf = (s: WatchSession) => (s.stopped || s.live ? s.positionMs : positionAt(s, hubNow()));

/**
 * Plays what another screen is playing, from where it has got to. `stopThere` stops it on that
 * screen (moving from the bedroom to the living room); otherwise both carry on separately.
 */
export async function resumeHere(s: WatchSession, stopThere: boolean): Promise<boolean> {
  await leaveSync();
  const startMs = s.live ? undefined : Math.max(0, Math.round(placeOf(s)) - 2000);
  const ok = await play(s.req, { ...(s.title ? { title: s.title } : {}), ...(startMs !== undefined ? { startMs } : {}) });
  if (ok && stopThere && !s.stopped) await api(`/api/watching/${enc(s.device)}/command`, { method: "POST", body: { type: "stop" } }).catch(() => undefined);
  return ok;
}

/** Joins another screen's film in step: pausing or skipping on either does it on both. */
export async function syncWith(s: WatchSession): Promise<boolean> {
  const res = await api<{ now: number; group: SyncGroup }>("/api/sync", { method: "POST", body: { with: s.device, client } });
  learnClock(res.now);
  const g = res.group;
  const startMs = g.live ? undefined : Math.round(positionAt(g, hubNow()));
  const ok = await play(g.req, { ...(g.title ? { title: g.title } : {}), ...(startMs !== undefined ? { startMs } : {}) });
  if (!ok) {
    await api(`/api/sync/${enc(g.id)}/leave`, { method: "POST", body: {} }).catch(() => undefined);
    return false;
  }
  setSyncGroup(g);
  void reportWatching("start");
  void poll(g.id);
  return true;
}

// -------------------------------------------------------------------------------------------------

let timer: number | undefined;
let lineTimer: number | undefined;

/** Reports every few seconds while something plays, and keeps a Sync play member lined up. */
export function startWatching(): void {
  window.clearInterval(timer);
  window.clearInterval(lineTimer);
  timer = window.setInterval(() => {
    const np = nowPlaying();
    const key = keyOf();
    if (key !== sentKey) {
      // Something else started (or it stopped): say the last one stopped, and leave its group.
      const g = syncGroup();
      if (g && (!np || !sameReq(np.req, g.req))) void leaveSync();
      void (async () => {
        if (lastSent) await reportWatching("stop");
        if (np) await reportWatching("start");
      })();
      return;
    }
    if (np) void reportWatching("progress");
  }, WATCH_REPORT_MS);
  // What the other screens are playing, for the top bar's chip.
  const look = () => void loadElsewhere().catch(() => undefined);
  look();
  window.setInterval(look, 20_000);
  // Small drifts are checked every couple of seconds between reports.
  lineTimer = window.setInterval(() => {
    if (syncGroup()) void line();
  }, 2000);
  // Pause and play pressed anywhere on the TV (the remote, the phone, a doorbell pop-up) go to the
  // group: when the player goes from playing to paused, or back, without us applying it, tell
  // everyone. Buffering in between doesn't count as either.
  let steady: "playing" | "paused" | null = null;
  agent.onState((st) => {
    if (st.status !== "playing" && st.status !== "paused") {
      if (st.status === "idle" || st.status === "loading" || st.status === "ended") steady = null;
      return;
    }
    const prev = steady;
    steady = st.status;
    const g = syncGroup();
    const np = nowPlaying();
    if (!g || !prev || prev === st.status || Date.now() < applyingUntil || !np || !sameReq(np.req, g.req)) return;
    void tellGroup(st.status === "paused" ? "pause" : "play", st.positionMs);
  });
}
