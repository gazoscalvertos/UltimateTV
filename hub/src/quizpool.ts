// The household's library as the family quiz sees it (issue #264): the films and series the media
// server holds (as far as a profile may see them) and the music videos on the music channels.

import { demoQuizPool } from "./demo.js";
import { displayTitle } from "./ytdlp.js";
import type { HubContext } from "./context.js";
import type { ContentFilter } from "./profiles.js";
import type { LibSong, LibTitle, QuizPool } from "./quizsources.js";

const TICKS_PER_MS = 10_000;
/** Enough for a good spread without reading a huge library. */
const PER_KIND = 400;

export async function readQuizPool(ctx: HubContext, f: ContentFilter, demo = false): Promise<QuizPool> {
  // The demo Hub has no media server: its made-up titles stand in, for screenshots.
  if (demo) {
    const pool = demoQuizPool();
    return { ...pool, titles: pool.titles.filter((t) => f.ref({ id: String(t.req.id), kind: t.kind, name: t.name, genres: t.genres })) };
  }
  const titles: LibTitle[] = [];
  const media = ctx.media();
  if (media) {
    const max = f.profile?.maxCertification;
    for (const type of ["Movie", "Series"] as const) {
      const got = await media.items({ type, sortBy: "DateCreated", limit: PER_KIND, ...(f.limited && max ? { maxRating: max } : {}) }).catch(() => ({ items: [], total: 0 }));
      for (const item of got.items) {
        const ref = media.toTitleRef(item);
        // What this profile may see: the same rule as the rest of the app.
        if (!f.ref(ref)) continue;
        const cast = (item.People ?? []).filter((p) => p.Type === "Actor").map((p) => p.Name).slice(0, 6);
        titles.push({
          // Played from the library itself, never another source that happens to have the title.
          req: { kind: "title", id: media.key(item.Id) },
          kind: type === "Movie" ? "movie" : "series",
          name: item.Name,
          cast,
          genres: item.Genres ?? [],
          ...(item.ProductionYear ? { year: item.ProductionYear } : {}),
          ...(item.Overview ? { overview: item.Overview } : {}),
          ...(ref.poster ? { poster: ref.poster } : {}),
          ...(item.RunTimeTicks ? { runtimeMs: Math.round(item.RunTimeTicks / TICKS_PER_MS) } : {}),
        });
      }
    }
  }
  // Music videos can be anything, so Kids and Guests get no song questions.
  const songs: LibSong[] = [];
  if (!f.limited) {
    for (const v of ctx.mix.store.videosWithStatus("ready")) {
      const shown = displayTitle(v);
      const [artist, ...rest] = shown.split(" – ");
      const track = rest.join(" – ").trim();
      if (!artist || !track || artist.length > 40 || track.length > 60 || !v.durationS) continue;
      songs.push({ artist: artist.trim(), track, url: `/api/mix/videos/${encodeURIComponent(v.id)}/file`, durationMs: v.durationS * 1000 });
    }
  }
  return { titles, songs };
}
