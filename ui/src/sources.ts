// What Settings › Sources lists: one generic row per provider, each with a status that says what
// to do next while it isn't set up (issue #218). Pure, so the wording is unit-tested; the screen
// (screens/Sources.tsx) adds the handlers. A provider added later (Emby, a second Jellyfin…) is
// one more entry in `providerList` and one more handler in the screen, nothing else.

import type { PublicSettings } from "@ultimatetv/shared";

export type ProviderKind = "iptv" | "xtream" | "jellyfin" | "plex" | "addons" | "torbox" | "guide" | "tmdb";

/** One row on the Providers screen. */
export interface ProviderInfo {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Set up and working. */
  ok: boolean;
  /** What the row's value says: what is connected, or what to do next. */
  status: string;
  /** What OK does when it isn't set up, e.g. "add a playlist". Empty for rows that are set up on the phone only. */
  next: string;
  /** A line under the label. */
  hint?: string;
  /** Rows that can't be set up from the TV (the guide count, TMDB): OK says to use the phone. */
  phoneOnly?: boolean;
}

export interface ProviderContext {
  demo?: boolean;
  channels?: number;
  programmes?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Not set up – press OK to add a playlist". */
export const nextStep = (lead: string, action: string) => `${lead} – press OK to ${action}`;

export function providerList(s: PublicSettings, ctx: ProviderContext = {}): ProviderInfo[] {
  const m3u = s.iptv.filter((x) => x.kind === "m3u");
  const xtream = s.iptv.filter((x) => x.kind === "xtream");
  const iptvText = (list: PublicSettings["iptv"]) => list.map((x) => `${x.name} (${plural(x.connections, "connection")})`).join(", ");
  const addonNames = s.addons.map((a) => a.name || a.url).join(", ");
  return [
    {
      id: "iptv",
      label: "IPTV playlist (M3U)",
      kind: "iptv",
      ok: m3u.length > 0 || Boolean(ctx.demo && xtream.length === 0),
      status: m3u.length > 0 ? iptvText(m3u) : ctx.demo && xtream.length === 0 ? "Demo channels" : nextStep("Not set up", "add a playlist"),
      next: "add a playlist",
    },
    {
      id: "xtream",
      label: "Xtream Codes",
      kind: "xtream",
      ok: xtream.length > 0,
      status: xtream.length > 0 ? iptvText(xtream) : nextStep("Not set up", "add a login"),
      next: "add a login",
    },
    {
      id: "guide",
      label: "TV guide",
      kind: "guide",
      ok: (ctx.programmes ?? 0) > 0,
      status: `${plural(ctx.channels ?? 0, "channel")}, ${plural(ctx.programmes ?? 0, "programme")}`,
      next: "",
      phoneOnly: true,
    },
    {
      id: "jellyfin",
      label: "Jellyfin",
      kind: "jellyfin",
      ok: Boolean(s.jellyfin),
      status: s.jellyfin ? s.jellyfin.serverName ?? "Connected" : nextStep("Not signed in", "sign in"),
      next: "sign in",
    },
    {
      id: "plex",
      label: "Plex",
      kind: "plex",
      ok: Boolean(s.plex),
      status: s.plex ? s.plex.serverName ?? "Connected" : nextStep("Not signed in", "sign in"),
      next: "sign in",
    },
    {
      id: "tmdb",
      label: "Film and TV info (TMDB)",
      kind: "tmdb",
      ok: s.tmdb,
      status: s.tmdb ? "Connected" : "Not set up – add the key on your phone",
      next: "",
      phoneOnly: true,
    },
    {
      id: "addons",
      label: "AIOStreams and add-ons",
      kind: "addons",
      ok: s.addons.length > 0,
      status: s.addons.length > 0 ? addonNames : nextStep("No add-ons yet", "add one"),
      next: "add one",
    },
    {
      id: "torbox",
      label: "TorBox",
      kind: "torbox",
      ok: s.torbox,
      status: s.torbox ? "Connected" : nextStep("Not set up", "add your key"),
      next: "add your key",
    },
  ];
}

/** Whether a profile may set sources up: grown-ups only, never Kids or Guest. */
export const canSetUpSources = (profile: { kind: string } | null | undefined): boolean => Boolean(profile) && profile!.kind !== "kids" && profile!.kind !== "guest";

/** A Stremio add-on address as the Hub wants it: stremio:// becomes https://, and a manifest is optional. */
export function cleanAddonUrl(input: string): string | null {
  let u = input.trim();
  if (!u) return null;
  u = u.replace(/^stremio:\/\//i, "https://");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname) return null;
  } catch {
    return null;
  }
  return u;
}

/** A server address as typed on a TV: a bare "192.168.0.20:8096" gets http://. */
export function cleanServerUrl(input: string): string | null {
  let u = input.trim().replace(/\/+$/, "");
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  try {
    return new URL(u).hostname ? u : null;
  } catch {
    return null;
  }
}

/** Adds an add-on to the list (no duplicates); null when it's already there. */
export function withAddon(urls: string[], url: string): string[] | null {
  const key = (x: string) => x.replace(/\/+$/, "").replace(/\/manifest\.json$/i, "").toLowerCase();
  return urls.some((x) => key(x) === key(url)) ? null : [...urls, url];
}
