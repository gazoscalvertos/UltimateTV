// Save to NAS: the Hub downloads a TorBox, online or IPTV copy into the Films or TV folder with
// Jellyfin's naming, then tells Jellyfin so it's in the library for good (see
// hub/src/services/downloads.ts). Offered before playing (Details, Versions) and while playing.

import type { Episode, TitleDetails } from "@ultimatetv/shared";
import { episodeLabel } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { isKids, toast } from "./store";

export interface SaveRequest {
  titleId: string;
  episodeId?: string;
  /** The exact version (the one playing, or picked in Versions); otherwise the Hub picks. */
  streamId?: string;
}

/** Kids can't fill the NAS (the Hub insists on an adult too). */
export const canSave = () => !isKids();

export async function saveToNas(req: SaveRequest, name: string): Promise<void> {
  if (!canSave()) throw new Error("Ask a grown-up to save things to the NAS");
  const d = await hub.download(req.titleId, req.episodeId, req.streamId);
  toast(d.status === "completed" ? `${name} is already saved on the NAS` : `Saving ${name} to the NAS. It goes into Jellyfin when it's done (Recordings › Downloads shows how far it's got).`, "good");
}

/** Episodes one after another; the Hub fetches two at a time. */
export async function saveEpisodes(t: TitleDetails, eps: Episode[], name: string): Promise<void> {
  if (!canSave()) throw new Error("Ask a grown-up to save things to the NAS");
  let saved = 0;
  for (const e of eps) {
    await hub.download(t.id, `s${e.season}e${e.episode}`).then(
      () => saved++,
      () => undefined,
    );
  }
  if (!saved) throw new Error(`There's no copy of ${name} that can be saved to the NAS`);
  toast(`Saving ${saved === 1 && eps[0] ? `${t.name} ${episodeLabel(eps[0].season, eps[0].episode)}` : `${saved} episodes of ${name}`} to the NAS. They go into Jellyfin as each one finishes.`, "good");
}

/** Says when a save finishes (and whether Jellyfin has it) or fails, whichever screen is up. */
export function startSaveNotices(): void {
  onHubEvent((e) => {
    if (e.type !== "downloads.changed" || isKids()) return;
    const d = e.download;
    const name = d.season !== undefined && d.episode !== undefined ? `${d.title} ${episodeLabel(d.season, d.episode)}` : d.title;
    if (d.status === "completed" && d.jellyfin) toast(d.jellyfin.added ? `${name} is saved and in Jellyfin` : `${name} is saved on the NAS. ${d.jellyfin.note}`, d.jellyfin.added ? "good" : "info");
    if (d.status === "failed") toast(`Couldn't save ${name}: ${d.error ?? "the download failed"}`, "bad");
  });
}
