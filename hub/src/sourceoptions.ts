// Source options (#219): test a source, pause it, and put the sources in order.
//
// Every provider is a string key, so a new kind of provider only has to say what its key is:
//   "iptv:<id>"        an IPTV source (Xtream or M3U), paused with `paused` on the source itself
//   "jellyfin", "plex" the media server
//   "torbox"           the TorBox account
//   "addon:<hash>"     a Stremio add-on, keyed by a hash of its URL (the URL carries the household's config)
// Paused providers keep their settings but are left out of the guide, the library and Versions.
// The order is what Play and Versions prefer, after the quality rules (see orderStreams).

import { createHash } from "node:crypto";
import type { IptvSource, Settings, SourceTestResult, StreamCandidate } from "@ultimatetv/shared";
import { withUserAgent, type Fetch } from "./http.js";
import { addonBase } from "./services/stremio.js";

export interface SourceInfo {
  key: string;
  name: string;
  /** Which kind of provider it is, for the Options menu. */
  type: "iptv" | "jellyfin" | "plex" | "emby" | "torbox" | "addon";
}

export function iptvKey(id: string): string {
  return `iptv:${id}`;
}

/** The key of a Stremio add-on: a short hash of its URL, so it survives other add-ons being added or removed. */
export function addonKey(url: string): string {
  return `addon:${createHash("sha1").update(url.trim()).digest("hex").slice(0, 8)}`;
}

/** Every provider that is set up, in the default order (IPTV, media server, TorBox, add-ons). */
export function listProviders(s: Settings, addonName: (url: string) => string = (u) => u): SourceInfo[] {
  const out: SourceInfo[] = s.iptv.map((src) => ({ key: iptvKey(src.id), name: src.name, type: "iptv" as const }));
  if (s.jellyfin) out.push({ key: "jellyfin", name: "Jellyfin", type: "jellyfin" });
  if (s.plex) out.push({ key: "plex", name: "Plex", type: "plex" });
  if (s.emby) out.push({ key: "emby", name: "Emby", type: "emby" });
  if (s.torboxApiKey) out.push({ key: "torbox", name: "TorBox", type: "torbox" });
  for (const url of s.addonUrls) out.push({ key: addonKey(url), name: addonName(url), type: "addon" });
  return out;
}

/** The saved order applied to the providers that are set up: unknown keys dropped, new ones last. */
export function orderedKeys(s: Settings): string[] {
  const all = listProviders(s).map((p) => p.key);
  const known = new Set(all);
  const saved = [...new Set(s.providerOrder ?? [])].filter((k) => known.has(k));
  return [...saved, ...all.filter((k) => !saved.includes(k))];
}

export function isPaused(s: Settings, key: string): boolean {
  if (key.startsWith("iptv:")) return Boolean(s.iptv.find((x) => x.id === key.slice(5))?.paused);
  return (s.pausedProviders ?? []).includes(key);
}

/** The keys of every paused provider, IPTV included. */
export function pausedKeys(s: Settings): string[] {
  return listProviders(s)
    .map((p) => p.key)
    .filter((k) => isPaused(s, k));
}

/** The IPTV sources that are not paused. */
export function activeIptv(s: Pick<Settings, "iptv">): IptvSource[] {
  return s.iptv.filter((x) => !x.paused);
}

export class UnknownSourceError extends Error {
  constructor(key: string) {
    super(`No source "${key}"`);
  }
}

/** The settings patch that pauses or resumes a provider. */
export function pausePatch(s: Settings, key: string, paused: boolean): Partial<Settings> {
  if (!listProviders(s).some((p) => p.key === key)) throw new UnknownSourceError(key);
  if (key.startsWith("iptv:")) return { iptv: s.iptv.map((x) => (`iptv:${x.id}` === key ? { ...x, paused: paused || undefined } : x)) as IptvSource[] };
  const rest = (s.pausedProviders ?? []).filter((k) => k !== key);
  return { pausedProviders: paused ? [...rest, key] : rest };
}

/** The settings patch that removes a provider (its login goes; for IPTV, the existing DELETE route does the same). */
export function removePatch(s: Settings, key: string): Partial<Settings> {
  const info = listProviders(s).find((p) => p.key === key);
  if (!info) throw new UnknownSourceError(key);
  const keep = <T>(list: T[] | undefined, drop: (k: string) => boolean): string[] => (list as unknown as string[] | undefined)?.filter((k) => !drop(k)) ?? [];
  const patch: Partial<Settings> = { providerOrder: keep(s.providerOrder, (k) => k === key), pausedProviders: keep(s.pausedProviders, (k) => k === key) };
  if (info.type === "iptv") patch.iptv = s.iptv.filter((x) => iptvKey(x.id) !== key);
  else if (info.type === "jellyfin") patch.jellyfin = undefined;
  else if (info.type === "plex") patch.plex = undefined;
  else if (info.type === "emby") patch.emby = undefined;
  else if (info.type === "torbox") patch.torboxApiKey = "";
  else patch.addonUrls = s.addonUrls.filter((u) => addonKey(u) !== key);
  return patch;
}

/** The settings patch that saves an order. Unknown keys are refused; sources left out go last. */
export function orderPatch(s: Settings, order: unknown): Partial<Settings> {
  if (!Array.isArray(order) || order.some((k) => typeof k !== "string")) throw new Error("order must be a list of source ids");
  const known = new Set(listProviders(s).map((p) => p.key));
  const bad = (order as string[]).find((k) => !known.has(k));
  if (bad) throw new UnknownSourceError(bad);
  const saved = [...new Set(order as string[])];
  return { providerOrder: [...saved, ...listProviders(s).map((p) => p.key).filter((k) => !saved.includes(k))] };
}

/** Points a copy gains for each place its provider is above the last one, up to MAX_ORDER_STEPS places. */
const ORDER_POINTS = 10;
const MAX_ORDER_STEPS = 3;

/**
 * Applies the household's order to streams that are already ranked by quality. The quality rules
 * stay in charge (a CAM copy, the wrong language or an oversized file still sinks, and a clearly
 * better picture still wins); the order is what decides between copies of a similar standard, and
 * breaks every tie. Paused providers' copies are dropped (they should not be there to begin with).
 */
export function orderStreams(ranked: StreamCandidate[], order: string[], paused: string[] = []): StreamCandidate[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  const n = order.length;
  const bonus = (c: StreamCandidate): number => {
    const r = c.provider !== undefined ? rank.get(c.provider) : undefined;
    return r === undefined ? 0 : Math.min(n - 1 - r, MAX_ORDER_STEPS) * ORDER_POINTS;
  };
  return ranked
    .filter((c) => !(c.provider && paused.includes(c.provider)))
    .map((c, i) => ({ c, i, v: (c.score ?? 0) + bonus(c) }))
    .sort((a, b) => b.v - a.v || (rank.get(a.c.provider ?? "") ?? n) - (rank.get(b.c.provider ?? "") ?? n) || a.i - b.i)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Test connection

const TEST_TIMEOUT_MS = 15_000;

interface Probe {
  status: number;
  ms: number;
  text: string;
}

async function probe(url: string, fetchImpl: Fetch, init: RequestInit = {}): Promise<Probe> {
  const t0 = Date.now();
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
  const text = await res.text().catch(() => "");
  return { status: res.status, ms: Date.now() - t0, text };
}

function json(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A message for a thrown fetch error that a household can read. */
function why(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "It didn't answer in time";
  const code = e?.cause?.code;
  if (code === "ENOTFOUND") return "That address wasn't found";
  if (code === "ECONNREFUSED") return "The connection was refused";
  return e?.message ?? "Couldn't connect";
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

async function testIptv(src: IptvSource, fetchImpl: Fetch): Promise<Omit<SourceTestResult, "id" | "name">> {
  const f = withUserAgent(fetchImpl);
  const t0 = Date.now();
  if (src.kind === "m3u") {
    const r = await probe(src.url, f);
    if (r.status >= 400) return { reachable: true, ms: r.ms, error: `The provider answered HTTP ${r.status}` };
    const channels = (r.text.match(/^#EXTINF/gm) ?? []).length;
    if (!r.text.trimStart().startsWith("#EXTM3U")) return { reachable: true, ms: r.ms, error: "That address didn't return a playlist" };
    return { reachable: true, ms: r.ms, detail: `Playlist fetched, ${channels.toLocaleString("en-GB")} entries` };
  }
  const q = new URLSearchParams({ username: src.username, password: src.password });
  const r = await probe(`${src.url.replace(/\/+$/, "")}/player_api.php?${q}`, f);
  if (r.status >= 400) return { reachable: true, ms: r.ms, signedIn: false, error: `The provider answered HTTP ${r.status}` };
  const info = json(r.text).user_info as Record<string, unknown> | undefined;
  const ms = Date.now() - t0;
  const signedIn = Boolean(info) && num(info!.auth) !== 0;
  const out: Omit<SourceTestResult, "id" | "name"> = { reachable: true, ms, signedIn };
  if (!signedIn) {
    out.error = "The provider refused the username and password";
    return out;
  }
  const exp = num(info!.exp_date);
  if (exp) out.expiresAt = exp * 1000;
  const active = num(info!.active_cons);
  const max = num(info!.max_connections);
  if (active !== undefined) out.activeConnections = active;
  if (max !== undefined) out.maxConnections = max;
  const status = typeof info!.status === "string" ? info!.status : undefined;
  if (status) out.detail = status;
  if (status && status !== "Active") out.error = `The account is ${status.toLowerCase()}`;
  else if (out.expiresAt && out.expiresAt < Date.now()) out.error = "The subscription has expired";
  return out;
}

async function testJellyfin(s: NonNullable<Settings["jellyfin"]>, fetchImpl: Fetch): Promise<Omit<SourceTestResult, "id" | "name">> {
  const base = s.url.replace(/\/+$/, "");
  const pub = await probe(`${base}/System/Info/Public`, fetchImpl);
  if (pub.status >= 400) return { reachable: true, ms: pub.ms, error: `The server answered HTTP ${pub.status}` };
  const name = json(pub.text).ServerName;
  const me = await probe(`${base}/Users/${encodeURIComponent(s.userId)}`, fetchImpl, { headers: { "X-Emby-Token": s.token } });
  const signedIn = me.status < 400;
  return { reachable: true, ms: pub.ms + me.ms, signedIn, ...(typeof name === "string" ? { detail: name } : {}), ...(signedIn ? {} : { error: "Jellyfin no longer accepts this login" }) };
}

async function testPlex(s: NonNullable<Settings["plex"]>, fetchImpl: Fetch): Promise<Omit<SourceTestResult, "id" | "name">> {
  const base = s.url.replace(/\/+$/, "");
  const id = await probe(`${base}/identity`, fetchImpl, { headers: { Accept: "application/json" } });
  if (id.status >= 400) return { reachable: true, ms: id.ms, error: `The server answered HTTP ${id.status}` };
  const me = await probe(`${base}/library/sections`, fetchImpl, { headers: { Accept: "application/json", "X-Plex-Token": s.token } });
  const signedIn = me.status < 400;
  return { reachable: true, ms: id.ms + me.ms, signedIn, ...(s.serverName ? { detail: s.serverName } : {}), ...(signedIn ? {} : { error: "Plex no longer accepts this login" }) };
}

async function testTorbox(key: string, fetchImpl: Fetch): Promise<Omit<SourceTestResult, "id" | "name">> {
  const r = await probe("https://api.torbox.app/v1/api/user/me", fetchImpl, { headers: { Authorization: `Bearer ${key}` } });
  if (r.status >= 500) return { reachable: true, ms: r.ms, error: `TorBox answered HTTP ${r.status}` };
  if (r.status >= 400) return { reachable: true, ms: r.ms, signedIn: false, error: "TorBox refused the API key" };
  const data = json(r.text).data as Record<string, unknown> | undefined;
  const out: Omit<SourceTestResult, "id" | "name"> = { reachable: true, ms: r.ms, signedIn: true };
  const expires = typeof data?.premium_expires_at === "string" ? Date.parse(data.premium_expires_at) : NaN;
  if (Number.isFinite(expires)) out.expiresAt = expires;
  return out;
}

async function testAddon(url: string, fetchImpl: Fetch): Promise<Omit<SourceTestResult, "id" | "name">> {
  const r = await probe(`${addonBase(url)}/manifest.json`, fetchImpl);
  if (r.status >= 400) return { reachable: true, ms: r.ms, error: `The add-on answered HTTP ${r.status}` };
  const name = json(r.text).name;
  return { reachable: true, ms: r.ms, ...(typeof name === "string" ? { detail: name } : {}) };
}

/** Tests one provider by key. Never throws for an unreachable source: that is the answer. */
export async function testSource(s: Settings, key: string, fetchImpl: Fetch = fetch, addonName: (url: string) => string = (u) => u): Promise<SourceTestResult> {
  const info = listProviders(s, addonName).find((p) => p.key === key);
  if (!info) throw new UnknownSourceError(key);
  const t0 = Date.now();
  try {
    let r: Omit<SourceTestResult, "id" | "name">;
    if (info.type === "iptv") r = await testIptv(s.iptv.find((x) => iptvKey(x.id) === key)!, fetchImpl);
    else if (info.type === "jellyfin") r = await testJellyfin(s.jellyfin!, fetchImpl);
    else if (info.type === "plex") r = await testPlex(s.plex!, fetchImpl);
    else if (info.type === "emby") r = await testJellyfin(s.emby!, fetchImpl);
    else if (info.type === "torbox") r = await testTorbox(s.torboxApiKey!, fetchImpl);
    else r = await testAddon(s.addonUrls.find((u) => addonKey(u) === key)!, fetchImpl);
    return { id: key, name: info.name, ...r };
  } catch (err) {
    return { id: key, name: info.name, reachable: false, ms: Date.now() - t0, error: why(err) };
  }
}
