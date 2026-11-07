// What every screen in the house is playing, and watching one thing together in two rooms.
//
// Each player (the TV box, the desktop app, the Android client) tells the Hub what it is playing
// every few seconds. Any other screen can then list those, and either carry on from the same
// place ("Resume here", the TV to the phone at bedtime) or join in ("Sync play": the same film in
// the kitchen and the living room, pausing and seeking together).
//
// Sync play keeps one shared clock on the Hub: where the film is, whether it's paused, and when
// that was true. Every member works out where it should be from that and nudges itself back when
// it drifts. A pause, play or seek on any member moves the shared clock, so everyone follows.

import type { PlaybackRequest, TitleRef } from "./domain.js";

/** Which app is playing: the TV box, the desktop app, the Android client or a browser. */
export type WatchClient = "tv" | "desktop" | "android" | "browser";

/** What a player sends the Hub while it plays (POST /api/watching). */
export interface WatchReport {
  req: PlaybackRequest;
  /** What to call it: "The Night Manager", "BBC One". */
  name: string;
  /** The episode or programme: "S1 E3 · Episode 3". */
  subtitle?: string;
  artwork?: string;
  title?: TitleRef;
  live: boolean;
  positionMs: number;
  durationMs?: number;
  paused: boolean;
  /** "stop" ends it here; the Hub keeps it a while so another screen can carry on from there. */
  event: "start" | "progress" | "stop";
  client: WatchClient;
  /** What this screen calls itself when it isn't paired (a paired one is known by its name). */
  deviceName?: string;
  /** The Sync play group this screen is in, so the Hub knows it is still there. */
  sync?: string;
}

/** One screen's playback, as every other screen sees it (GET /api/watching). */
export interface WatchSession {
  /** Who is playing: the paired device id, or the phone's own id when it isn't paired. */
  device: string;
  deviceName: string;
  client: WatchClient;
  /** Set when this is a TV box, so a phone can say "play it on that TV". */
  box?: string;
  req: PlaybackRequest;
  name: string;
  subtitle?: string;
  artwork?: string;
  title?: TitleRef;
  live: boolean;
  positionMs: number;
  durationMs?: number;
  paused: boolean;
  /** When `positionMs` was true, by the Hub's clock. */
  at: number;
  startedAt: number;
  /** Stopped (or not heard from for a while): it can still be carried on from where it got to. */
  stopped: boolean;
  profile: { id: string; name: string } | null;
  sync?: string;
}

/** Something another screen asked this one to do; it comes back in answer to the next report. */
export type WatchCommand = { type: "pause" } | { type: "stop" } | { type: "sync"; group: string };

export interface SyncMember {
  device: string;
  deviceName: string;
  client: WatchClient;
}

export type SyncAction = "play" | "pause" | "seek";

/** The shared clock of a Sync play group (GET /api/sync/:id). */
export interface SyncGroup {
  id: string;
  req: PlaybackRequest;
  name: string;
  subtitle?: string;
  artwork?: string;
  title?: TitleRef;
  live: boolean;
  durationMs?: number;
  /** Where everyone should be at `at` (Hub clock), and whether everyone is paused. */
  positionMs: number;
  paused: boolean;
  at: number;
  /** Goes up whenever anything changes, for the long poll. */
  seq: number;
  members: SyncMember[];
  /** Fewer than two screens left: everyone stops following. */
  ended: boolean;
  /** Who did the last thing, so a screen can say "Kitchen paused". */
  last?: { device: string; deviceName: string; action: SyncAction | "join" | "leave" };
}

/** A playing session not heard from for this long is treated as stopped (the box was switched off). */
export const WATCH_STALE_MS = 45_000;
/** How long a stopped session can still be carried on from. */
export const WATCH_KEEP_STOPPED_MS = 4 * 60 * 60_000;
/** Close enough: a member within this of the shared clock is left alone. */
export const SYNC_TOLERANCE_MS = 2_500;
/** How often a player tells the Hub what it's doing. */
export const WATCH_REPORT_MS = 5_000;

/** Where something is now, given where it was at `at` and whether it was playing. */
export function positionAt(s: { positionMs: number; paused: boolean; at: number; durationMs?: number | undefined }, now: number): number {
  const moved = s.paused ? 0 : Math.max(0, now - s.at);
  const pos = s.positionMs + moved;
  return s.durationMs && s.durationMs > 0 ? Math.min(pos, s.durationMs) : pos;
}

/** Finished (or as good as): not worth offering to carry on. */
export function watchFinished(s: { positionMs: number; durationMs?: number | undefined; live: boolean }): boolean {
  return !s.live && Boolean(s.durationMs) && s.positionMs >= (s.durationMs as number) * 0.95;
}

/**
 * What a Sync play member should do to match the shared clock: pause or play, and seek when it is
 * more than the tolerance away. Live TV is left alone (everyone is on the same channel already).
 */
export function syncCorrection(local: { positionMs: number; paused: boolean }, group: Pick<SyncGroup, "positionMs" | "paused" | "at" | "durationMs" | "live">, now: number, toleranceMs = SYNC_TOLERANCE_MS): { pause?: boolean; seekTo?: number } {
  const out: { pause?: boolean; seekTo?: number } = {};
  if (local.paused !== group.paused) out.pause = group.paused;
  if (group.live) return out;
  const want = positionAt(group, now);
  // Paused, a smaller gap still shows (the two screens show different pictures side by side).
  const tolerance = group.paused ? Math.min(toleranceMs, 1_000) : toleranceMs;
  if (Math.abs(local.positionMs - want) > tolerance) out.seekTo = Math.round(want);
  return out;
}

/** "3:05" or "1:02:09". */
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "Living room TV · paused at 42:10", for the lists on every app. */
export function watchLine(s: Pick<WatchSession, "deviceName" | "live" | "paused" | "stopped" | "positionMs" | "durationMs">, positionMs = s.positionMs): string {
  if (s.live) return s.stopped ? `${s.deviceName} · was watching live` : `${s.deviceName} · watching live`;
  const at = clockLabel(positionMs) + (s.durationMs ? ` of ${clockLabel(s.durationMs)}` : "");
  const what = s.stopped ? "stopped at" : s.paused ? "paused at" : "at";
  return `${s.deviceName} · ${what} ${at}`;
}

const KINDS = new Set<PlaybackRequest["kind"]>(["channel", "catchup", "recording", "title", "stream"]);
const CLIENTS = new Set<WatchClient>(["tv", "desktop", "android", "browser"]);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const ms = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

/** A report as the Hub keeps it, or null when it isn't one. Anything unexpected is dropped. */
export function cleanWatchReport(raw: unknown): WatchReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const q = r.req as Record<string, unknown> | undefined;
  if (!q || typeof q !== "object" || !KINDS.has(q.kind as PlaybackRequest["kind"])) return null;
  const id = str(q.id, 300);
  if (!id) return null;
  // A link sent from a phone (a YouTube page) can't be started again elsewhere.
  if (id.startsWith("link:")) return null;
  const req: PlaybackRequest = { kind: q.kind as PlaybackRequest["kind"], id };
  const episodeId = str(q.episodeId, 120);
  if (episodeId) req.episodeId = episodeId;
  const streamId = str(q.streamId, 300);
  if (streamId) req.streamId = streamId;
  if (typeof q.start === "number" && Number.isFinite(q.start)) req.start = q.start;
  const name = str(r.name, 200);
  if (!name) return null;
  const event = r.event === "start" || r.event === "stop" ? r.event : "progress";
  const client = CLIENTS.has(r.client as WatchClient) ? (r.client as WatchClient) : "browser";
  const out: WatchReport = { req, name, live: r.live === true, positionMs: ms(r.positionMs) ?? 0, paused: r.paused === true, event, client };
  const subtitle = str(r.subtitle, 200);
  if (subtitle) out.subtitle = subtitle;
  const artwork = str(r.artwork, 2000);
  // data: pictures are the box's own copies: far too big to pass round every five seconds.
  if (artwork && !artwork.startsWith("data:")) out.artwork = artwork;
  const durationMs = ms(r.durationMs);
  if (durationMs) out.durationMs = durationMs;
  const deviceName = str(r.deviceName, 60);
  if (deviceName) out.deviceName = deviceName;
  const sync = str(r.sync, 40);
  if (sync) out.sync = sync;
  const t = r.title as Record<string, unknown> | undefined;
  if (t && typeof t === "object" && typeof t.id === "string" && typeof t.name === "string" && (t.kind === "movie" || t.kind === "series")) {
    out.title = t as unknown as TitleRef;
  }
  return out;
}
