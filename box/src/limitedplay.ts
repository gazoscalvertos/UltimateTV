/**
 * Playing in Limited mode (#78): turning a tap on the reduced app into a play request the box's own
 * player can run with no Hub, and reporting a Jellyfin film's progress straight to Jellyfin.
 *
 * Both halves matter. A channel plays from the feed URL the box cached; a Jellyfin film plays from
 * the server itself, at the place the cache remembered, and reports progress to Jellyfin so the
 * household's Continue watching is right when the Hub comes back. The Kids check runs here too: the
 * cache holds every profile's rules, and this is the last point before a URL is handed to mpv.
 */
import { allowsChannel, allowsTitle, limitedProfileFor, type LimitedJellyfinTitle, type LimitedProfile, type LimitedSnapshot } from "@ultimatetv/shared";
import type { PlayOptions } from "@ultimatetv/shared";

/** A tap on the Limited-mode screen. */
export type LimitedPlayRequest = { kind: "channel"; id: string } | { kind: "jellyfin"; id: string };

/** What the box needs to report a film's progress itself. */
export interface LimitedJellyfinPlay {
  itemId: string;
  durationMs?: number;
}

export type LimitedPlayResult =
  | { ok: true; options: PlayOptions; jellyfin?: LimitedJellyfinPlay }
  | { ok: false; reason: string };

const TICKS_PER_MS = 10_000;

function profileOf(snapshot: LimitedSnapshot, viewer: { name: string; kids: boolean } | null): LimitedProfile | null {
  return limitedProfileFor(snapshot, viewer);
}

/**
 * Resolves a play request against the cache, or says why it can't be played. Never throws: the
 * page shows `reason` as one plain sentence instead of an error dialog.
 */
export function resolveLimitedPlay(snapshot: LimitedSnapshot | null, viewer: { name: string; kids: boolean } | null, request: LimitedPlayRequest, now: number = Date.now()): LimitedPlayResult {
  if (!snapshot) return { ok: false, reason: "This box hasn't saved anything to play yet. It'll fill up when the Hub is on." };
  const profile = profileOf(snapshot, viewer);

  if (request.kind === "channel") {
    const channel = snapshot.channels.find((c) => c.id === request.id);
    if (!channel) return { ok: false, reason: "That channel isn't in this box's saved list any more" };
    // Kids rules from the cached profile, exactly as the Hub would have applied them.
    if (!allowsChannel(profile, channel)) return { ok: false, reason: `${channel.name} isn't one of the channels this profile can watch` };
    if (!channel.url) return { ok: false, reason: `${channel.name} has no stream the box can play with the Hub off` };
    const nowRow = (snapshot.guide.programmes[channel.id] ?? []).find((p) => p.start <= now && p.end > now);
    return {
      ok: true,
      options: {
        url: channel.url,
        ...(channel.headers ? { headers: channel.headers } : {}),
        live: true,
        startMs: 0,
        title: channel.name,
        ...(nowRow ? { subtitle: nowRow.title } : {}),
        ...(channel.logo ? { artwork: channel.logo } : {}),
      },
    };
  }

  const jf = snapshot.jellyfin;
  if (!jf) return { ok: false, reason: "Jellyfin isn't set up on this box" };
  const item = jf.items.find((i) => i.id === request.id);
  if (!item) return { ok: false, reason: "That film isn't in this box's saved list any more" };
  if (!allowsTitle(profile, titleOf(item))) return { ok: false, reason: `${item.name} isn't one this profile can watch` };
  const startMs = item.positionMs && item.positionMs > 0 ? item.positionMs : 0;
  return {
    ok: true,
    options: {
      url: jellyfinStreamUrl(jf, item.id, item.sourceId),
      live: false,
      startMs,
      title: item.name,
      ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      ...(item.poster ? { artwork: jellyfinPoster(item.poster, jf.token) } : {}),
    },
    jellyfin: { itemId: item.id, ...(item.runtimeMs ? { durationMs: item.runtimeMs } : {}) },
  };
}

const titleOf = (item: LimitedJellyfinTitle) => ({
  refId: item.refId,
  name: item.name,
  kind: item.kind,
  ...(item.genres ? { genres: item.genres } : {}),
  ...(item.certification ? { certification: item.certification } : {}),
});

/** A film's stream URL, straight from the Jellyfin server the cache remembers. */
export function jellyfinStreamUrl(jellyfin: { url: string; token: string }, itemId: string, mediaSourceId?: string): string {
  const q = new URLSearchParams({ static: "true", api_key: jellyfin.token });
  if (mediaSourceId) q.set("mediaSourceId", mediaSourceId);
  return `${jellyfin.url.replace(/\/+$/, "")}/Videos/${encodeURIComponent(itemId)}/stream?${q}`;
}

/** Jellyfin image URLs carry no key, so the box adds the one it cached. */
export function jellyfinPoster(poster: string, token: string): string {
  return `${poster}${poster.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(token)}`;
}

/**
 * Tells Jellyfin where a film got to, so Continue watching is right when the Hub comes back. The
 * box does this itself because the Hub is the thing that's off. Resolves false on any failure: a
 * lost progress report must never interrupt a film.
 */
export async function reportJellyfinProgress(
  fetchImpl: typeof fetch,
  jellyfin: { url: string; token: string },
  report: { itemId: string; positionMs: number; event?: "start" | "progress" | "stop"; paused?: boolean },
): Promise<boolean> {
  const path = report.event === "start" ? "Playing" : report.event === "stop" ? "Playing/Stopped" : "Playing/Progress";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `MediaBrowser Client="UltimateTV", Device="UltimateTV Box", DeviceId="ultimatetv-box", Version="1.0.0", Token="${jellyfin.token}"`,
  };
  const body = JSON.stringify({ ItemId: report.itemId, PositionTicks: Math.round(report.positionMs * TICKS_PER_MS), IsPaused: Boolean(report.paused), PlayMethod: "DirectPlay" });
  try {
    const res = await fetchImpl(`${jellyfin.url.replace(/\/+$/, "")}/Sessions/${path}`, { method: "POST", headers, body, signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** What to tell Jellyfin about a film, if anything: the last thing said, and the state now. */
export interface JellyfinReportState {
  at: number;
  status: "playing" | "paused";
}

/** The states Jellyfin cares about, from the box's own PlayerState. */
export interface JellyfinNow {
  status: string;
  positionMs: number;
}

/**
 * Decides whether a film's playback state is worth a report, and which one. Called on every state
 * from mpv: start once, progress every ten seconds while it plays, and stop when it ends or fails.
 * A pause is reported at once so Jellyfin marks the film as held rather than carried on playing.
 * Returns null when there is nothing to say, so a chatty player doesn't flood Jellyfin.
 */
export function jellyfinReportFor(
  last: JellyfinReportState | null,
  now: JellyfinNow,
  at: number,
  pausedNow = false,
): { event: "start" | "progress" | "stop"; positionMs: number; paused?: boolean } | null {
  const playing = now.status === "playing";
  const over = now.status === "ended" || now.status === "error" || now.status === "idle";
  if (over) {
    if (!last) return null;
    return { event: "stop", positionMs: now.positionMs };
  }
  if (!playing && !(pausedNow && now.status === "paused")) return null;
  if (!last) return { event: "start", positionMs: now.positionMs };
  if (pausedNow && now.status === "paused" && last.status === "playing") return { event: "progress", positionMs: now.positionMs, paused: true };
  if (now.status !== "playing") return null;
  // Carrying on after a pause is a progress report, not a fresh start.
  if (last.status !== "playing") return { event: "progress", positionMs: now.positionMs };
  if (at - last.at < 10_000) return null;
  return { event: "progress", positionMs: now.positionMs };
}
