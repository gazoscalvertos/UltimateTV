// Everyday things for living with the TV: a watchlist ("Save for later"), the sleep timer,
// warnings before something breaks, and skipping the adverts on recordings.

import type { TitleRef } from "./domain.js";

// ---------------------------------------------------------------------------
// Watchlist

/**
 * Something saved for later on one profile: a title from any source, or just a name ("Dune",
 * heard about at work) that turns into a title once a source has it.
 */
export interface WatchItem {
  id: string;
  name: string;
  year?: number;
  kind: "movie" | "series" | "unknown";
  /** The title to open, once a source has it. */
  title?: TitleRef;
  addedAt: number;
  /** Where it was saved from. */
  from: "tv" | "phone" | "voice" | "app";
}

export interface WatchlistInput {
  title?: Partial<TitleRef>;
  name?: string;
  year?: number;
  from?: WatchItem["from"];
}

// ---------------------------------------------------------------------------
// Sleep timer

export type SleepChoice = { minutes: number } | { end: true } | { off: true };

/** The sleep timer as the TV runs it, for the phone and the Options menu. */
export interface SleepState {
  /** When it goes off (ms since 1970), or null when it isn't set. */
  at: number | null;
  /** "At the end of this programme" rather than a number of minutes. */
  end: boolean;
  /** What to call it: "45 min", "End of Dune". */
  label: string;
}

export const SLEEP_MINUTES = [15, 30, 45, 60, 90, 120] as const;

// ---------------------------------------------------------------------------
// Alerts: things worth knowing before they become "the TV's broken".

export type AlertLevel = "info" | "warn" | "bad";

export interface Alert {
  /** Stable per problem ("iptv-expiry:src1"), so it's sent once rather than every check. */
  key: string;
  level: AlertLevel;
  title: string;
  message: string;
  /** When it was first seen. */
  since: number;
  /** When it was last sent out, if it has been. */
  sentAt?: number;
}

export interface AlertSettings {
  /** A Home Assistant webhook (or any URL taking a JSON POST). */
  webhookUrl: string;
  /** An ntfy topic URL (https://ntfy.sh/your-topic), for a phone notification with no Home Assistant. */
  ntfyUrl: string;
  /** Warn this many days before the IPTV or TorBox subscription runs out. */
  expiryDays: number;
  /** Warn when the NAS has less than this many GB free. */
  diskFreeGb: number;
  /** Show alerts to adult profiles on the TV too (a small pop-up, once each). */
  onTv: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = { webhookUrl: "", ntfyUrl: "", expiryDays: 14, diskFreeGb: 50, onTv: true };

export interface AlertState {
  settings: AlertSettings;
  alerts: Alert[];
  /** Somewhere to send them is set. */
  configured: boolean;
  /** When the checks last ran. */
  checkedAt?: number;
  /** When the IPTV and TorBox subscriptions run out, as far as the Hub knows. */
  expiries: { name: string; at: number }[];
}

const cleanUrl = (v: unknown, fallback: string) => {
  if (v === undefined) return fallback;
  if (typeof v !== "string" || !v.trim()) return "";
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : fallback;
  } catch {
    return fallback;
  }
};

export function cleanAlertSettings(patch: Partial<AlertSettings>, base: AlertSettings = DEFAULT_ALERT_SETTINGS): AlertSettings {
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return {
    webhookUrl: cleanUrl(patch.webhookUrl, base.webhookUrl),
    ntfyUrl: cleanUrl(patch.ntfyUrl, base.ntfyUrl),
    expiryDays: num(patch.expiryDays, 1, 60, base.expiryDays),
    diskFreeGb: num(patch.diskFreeGb, 1, 10_000, base.diskFreeGb),
    onTv: patch.onTv === undefined ? base.onTv : Boolean(patch.onTv),
  };
}

/** "in 3 days", "tomorrow", "today", "2 days ago", for an expiry. */
export function daysFromNow(at: number, now: number): string {
  const days = Math.floor((startOfLocalDay(at) - startOfLocalDay(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Advert skipping on recordings (comskip, run by the Hub after each recording).

export interface AdBreak {
  startMs: number;
  endMs: number;
}

export interface AdSkipSettings {
  /** Look for the adverts in each new recording. */
  enabled: boolean;
  /** "button" shows Skip adverts (like Skip intro); "auto" jumps over them. */
  mode: "button" | "auto";
}

export const DEFAULT_ADSKIP_SETTINGS: AdSkipSettings = { enabled: true, mode: "button" };

/**
 * Reads comskip's EDL output ("start end type" in seconds, a line per break) into breaks,
 * dropping anything under 20 seconds (a black frame isn't an advert break) and merging breaks
 * closer than 5 seconds apart.
 */
export function parseEdl(text: string): AdBreak[] {
  const breaks: AdBreak[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([\d.]+)\s+([\d.]+)(?:\s+(\d+))?/.exec(line);
    if (!m) continue;
    const startMs = Math.round(Number(m[1]) * 1000);
    const endMs = Math.round(Number(m[2]) * 1000);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const last = breaks[breaks.length - 1];
    if (last && startMs - last.endMs < 5000) last.endMs = Math.max(last.endMs, endMs);
    else breaks.push({ startMs, endMs });
  }
  return breaks.filter((b) => b.endMs - b.startMs >= 20_000);
}
