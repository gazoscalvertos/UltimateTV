// Subtitles from OpenSubtitles, for the TV's Options › Find subtitles and for turning them on by
// themselves when a profile wants subtitles and the film has none. The Hub searches by the title's
// IMDb or TMDB id, downloads the chosen file once, and serves it to mpv on the box.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SubtitleResult, TitleDetails } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import type { ContentFilter } from "./profiles.js";
import { subtitleFileKey } from "./services/opensubtitles.js";

type Req<Q = Record<string, string | undefined>, B = unknown, P = Record<string, string>> = FastifyRequest<{ Querystring: Q; Body: B; Params: P }>;

/** "s2e5" as numbers. */
export function parseEpisodeId(id: string | undefined): { season: number; episode: number } | undefined {
  const m = id ? /^s(\d+)e(\d+)$/i.exec(id) : null;
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : undefined;
}

export interface SubtitleSearch {
  configured: boolean;
  results: SubtitleResult[];
  /** Why there's nothing to list, in words for the TV. */
  note?: string;
}

export function registerSubtitles(app: FastifyInstance, ctx: HubContext, details: (id: string, f: ContentFilter) => Promise<TitleDetails>, filterOf: (req: FastifyRequest) => ContentFilter, hubBase: (req: FastifyRequest) => string): void {
  app.get("/api/subtitles", async (req: Req<{ titleId?: string; episodeId?: string; lang?: string }>): Promise<SubtitleSearch> => {
    const os = ctx.openSubtitles();
    if (!os) return { configured: false, results: [], note: "Add an OpenSubtitles key on the phone's setup page first" };
    const id = req.query.titleId ?? "";
    // Through the profile's filter, so Kids can't look up what they can't watch.
    const d = await details(id, filterOf(req));
    if (!d.imdbId && !d.tmdbId) return { configured: true, results: [], note: "OpenSubtitles can't look this one up: it has no IMDb or TMDB id" };
    const ep = parseEpisodeId(req.query.episodeId);
    const results = await os.search({
      kind: d.kind,
      ...(d.imdbId ? { imdbId: d.imdbId } : {}),
      ...(d.tmdbId ? { tmdbId: d.tmdbId } : {}),
      ...(ep ?? {}),
      lang: req.query.lang || ctx.settings.get().playback.preferredSubtitleLang,
    });
    return { configured: true, results, ...(results.length ? {} : { note: "OpenSubtitles has none in that language" }) };
  });

  app.post("/api/subtitles/download", async (req: Req<Record<string, string>, { fileId?: number; lang?: string; label?: string }>, reply) => {
    const os = ctx.openSubtitles();
    if (!os) return reply.code(400).send({ error: "Add an OpenSubtitles key on the phone's setup page first" });
    const fileId = Number(req.body?.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) return reply.code(400).send({ error: "Which subtitles?" });
    await os.file(fileId);
    const lang = String(req.body?.lang ?? "en").slice(0, 8);
    return { url: `${hubBase(req)}/api/subtitles/files/${fileId}.srt`, lang, label: String(req.body?.label ?? "").slice(0, 60) || `${lang.toUpperCase()} (OpenSubtitles)` };
  });

  // mpv on the box fetches the file itself, so this needs no pairing; only files already downloaded are served.
  app.get("/api/subtitles/files/:file", async (req: Req<Record<string, string>, unknown, { file: string }>, reply) => {
    const m = /^(\d+)\.srt$/.exec(req.params.file);
    const text = m ? ctx.db.cacheGet<string>(subtitleFileKey(m[1]!)) : undefined;
    if (!text) return reply.code(404).send({ error: "No such subtitles" });
    return reply.type("application/x-subrip; charset=utf-8").send(text);
  });
}
