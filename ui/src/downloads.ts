// Downloads to the box: films, episodes and recordings copied onto the box's own disk (the box
// shell fetches them, see box/src/downloads.ts), so they play away from home with the NAS and
// Jellyfin out of reach, and start at once at home. Play uses a finished download by itself.

import { createEffect, createSignal } from "solid-js";
import type { BoxDownload, BoxDownloadRequest, BoxDownloads, Episode, PlaybackRequest, Recording, TitleDetails, TitleRef } from "@ultimatetv/shared";
import { clockTime, dayLabel, episodeLabel, formatBytes } from "@ultimatetv/shared";
import { agent, agentHas, onBox } from "./agent";
import { api, hub } from "./api";
import { isKids, profile, toast } from "./store";

/** The box shell can download (an older shell can't until it's updated). */
export const canDownload = () => onBox && agentHas("downloads");

const [all, setAll] = createSignal<BoxDownloads | null>(null);
/** For a Kids profile, the downloads it may see (null: all of them). */
const [allowedIds, setAllowedIds] = createSignal<Set<string> | null>(null);
export { all as boxDownloads };

export function startDownloads(): void {
  if (!canDownload()) return;
  agent.onDownloads((d) => setAll(d));
  void agent.downloads().then(setAll, () => undefined);
  // Kids see what their profile allows: the Hub decides from the certificate kept with each download.
  createEffect(() => {
    const d = all();
    const p = profile();
    if (!d || p?.kind !== "kids") return setAllowedIds(null);
    const items = d.items.map((i) => ({ id: i.id, ...(i.title ? { title: i.title } : {}), ...(i.channelId ? { channelId: i.channelId } : {}) }));
    void api<{ allowed: string[] }>("/api/offline/allowed", { method: "POST", body: { items } }).then(
      (r) => setAllowedIds(new Set(r.allowed)),
      () => setAllowedIds(new Set<string>()),
    );
  });
  // The box's Hub-down screen offers the downloads this profile may watch.
  if (agentHas("offlineProfile")) {
    createEffect(() => {
      const p = profile();
      const allowed = allowedIds();
      if (!p || (p.kind === "kids" && !allowed)) return;
      void agent.offlineProfile({ name: p.name, kids: p.kind === "kids", ...(p.kind === "kids" ? { allowedDownloads: [...allowed!] } : {}) }).catch(() => undefined);
    });
  }
}

/** The downloads this profile may see, newest first. */
export function visibleDownloads(): BoxDownload[] {
  const d = all();
  if (!d) return [];
  const allowed = allowedIds();
  const list = isKids() ? d.items.filter((i) => allowed?.has(i.id)) : d.items;
  return [...list].sort((a, b) => b.addedAt - a.addedAt);
}

const keyOf = (req: PlaybackRequest) => `${req.kind}:${req.id}|${req.episodeId ?? ""}`;

/** The download of a film, episode or recording, finished or not. */
export function downloadOf(req: PlaybackRequest): BoxDownload | undefined {
  const k = keyOf(req);
  return all()?.items.find((i) => keyOf(i.req) === k);
}

/** "Downloaded", "Downloading 45%" or "Queued", for badges. */
export function downloadLabel(d: BoxDownload | undefined): string | null {
  if (!d) return null;
  if (d.status === "done") return "Downloaded";
  if (d.status === "failed") return "Download failed";
  if (d.status === "downloading") return d.bytesTotal ? `Downloading ${Math.floor((d.bytesDone / d.bytesTotal) * 100)}%` : "Downloading";
  return "Waiting to download";
}

export function titleRefOf(d: TitleDetails): TitleRef {
  const ref: TitleRef = { id: d.id, kind: d.kind, name: d.name };
  if (d.year) ref.year = d.year;
  if (d.poster) ref.poster = d.poster;
  if (d.backdrop) ref.backdrop = d.backdrop;
  if (d.genres.length) ref.genres = d.genres;
  if (d.certification) ref.certification = d.certification;
  return ref;
}

export function filmRequest(t: TitleDetails): BoxDownloadRequest {
  const image = t.poster ?? t.backdrop;
  return { req: { kind: "title", id: t.id }, title: titleRefOf(t), name: t.name, ...(t.year ? { subtitle: String(t.year) } : {}), ...(image ? { image } : {}) };
}

export function episodeRequest(t: TitleDetails, e: Episode): BoxDownloadRequest {
  const image = e.still ?? t.backdrop ?? t.poster;
  return {
    req: { kind: "title", id: t.id, episodeId: `s${e.season}e${e.episode}` },
    title: titleRefOf(t),
    name: t.name,
    subtitle: [episodeLabel(e.season, e.episode), e.name].filter(Boolean).join(" · "),
    ...(image ? { image } : {}),
  };
}

export function recordingRequest(r: Recording): BoxDownloadRequest {
  const p = r.programme;
  return {
    req: { kind: "recording", id: r.id },
    name: p.title,
    subtitle: [episodeLabel(p.season, p.episode), p.subtitle, `${r.channelName} · ${dayLabel(p.start)} ${clockTime(p.start)}`].filter(Boolean).join(" · "),
    channelId: r.channelId,
    ...(p.image ? { image: p.image } : {}),
  };
}

/** A season's episodes, asking the Hub when the details didn't list them. */
export async function episodesOf(t: TitleDetails, season: number): Promise<Episode[]> {
  const listed = t.seasons?.find((s) => s.season === season);
  if (listed?.episodes.length) return listed.episodes;
  return (await hub.season(t.id, season).catch(() => null))?.episodes ?? [];
}

/** Every episode of a series (specials left out unless that's all there is). */
export async function allEpisodes(t: TitleDetails): Promise<Episode[]> {
  const seasons = (t.seasons ?? []).filter((s) => s.season > 0);
  const list = seasons.length ? seasons : (t.seasons ?? []);
  const out: Episode[] = [];
  for (const s of list) out.push(...(await episodesOf(t, s.season)));
  return out;
}

/** Adds to the box's downloads and says so. Kids can watch downloads but not add them. */
export async function downloadToBox(items: BoxDownloadRequest[], what: string): Promise<BoxDownloads> {
  if (!canDownload()) throw new Error("Update the TV box to download to it (Settings › About)");
  if (isKids()) throw new Error("Ask a grown-up to download things");
  const before = new Set((all()?.items ?? []).map((i) => keyOf(i.req)));
  const fresh = items.filter((i) => !before.has(keyOf(i.req)));
  const d = await agent.download(items);
  setAll(d);
  const room = d.freeBytes - d.reserveBytes;
  if (!fresh.length) toast(`${what} is already downloaded or on its way`);
  else toast(`Downloading ${what} to the box. ${formatBytes(Math.max(0, room))} free.`, "good");
  return d;
}

export async function removeFromBox(id: string): Promise<void> {
  setAll(await agent.removeDownload(id));
}
