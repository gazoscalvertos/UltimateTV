// The routes behind radio and podcasts (issue #86). Both are Hub data — the TV, the phone
// and the watching app all read the same list, so a station added on the phone is there on
// the TV the next time the Music tab opens.
//
// Playing a station is just a stream: `GET /api/radio/:id/play` answers with a PlaybackInfo
// the TV hands to the box, which is the same shape /api/play gives for a channel. That means
// no new PlaybackRequest kind and no changes to anything that switches on one.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlaybackInfo, PodcastEpisode, RadioStation } from "@ultimatetv/shared";
import { PODCAST_RESUME_MS } from "@ultimatetv/shared";
import type { Profile } from "@ultimatetv/shared";
import type { Radio } from "./radio.js";
import type { Podcasts } from "./podcasts.js";

type Viewer = { profile: Profile | null; admin: boolean };

/** A station the TV can play: its name, its stream, and nothing to look up. */
export function stationPlayback(station: RadioStation): PlaybackInfo {
  return {
    url: station.url,
    title: station.name,
    ...(station.genre ? { subtitle: station.genre } : {}),
    ...(station.logo ? { logo: station.logo } : {}),
    live: true,
    startMs: 0,
    externalSubtitles: [],
    progressKey: `radio:${station.id}`,
    skip: [],
  };
}

/** An episode the TV can play, carrying on where it was left if asked. */
export function episodePlayback(showTitle: string, episode: PodcastEpisode, startMs = 0): PlaybackInfo {
  return {
    url: episode.url,
    title: episode.title,
    subtitle: showTitle,
    ...(episode.image ? { artwork: episode.image } : {}),
    live: false,
    startMs,
    ...(episode.durationMs ? { durationMs: episode.durationMs } : {}),
    externalSubtitles: [],
    // Deliberately not "podcast:" — see the note in progress.ts: this keeps an episode out of
    // Continue watching, which is for films and series.
    progressKey: `link:${episode.id}`,
    skip: [],
  };
}

export function registerRadio(app: FastifyInstance, deps: { radio: Radio; podcasts: Podcasts; viewer: (req: FastifyRequest) => Viewer }): void {
  type Req<P, Q, B> = FastifyRequest<{ Params: P; Querystring: Q; Body: B }>;
  const { radio, podcasts, viewer } = deps;
  /** A Kids profile sees only the stations marked for children. */
  const kidsOf = (req: FastifyRequest): boolean => viewer(req).profile?.kind === "kids";

  app.get("/api/radio", async (req) => ({ stations: radio.stations(kidsOf(req)) }));

  /** What a station is playing, when its stream says: one short read, cached for a few seconds. */
  app.get("/api/radio/:id/now", async (req: Req<{ id: string }, Record<string, string>, Record<string, string>>) => {
    const station = radio.get(decodeURIComponent(req.params.id), kidsOf(req));
    if (!station) throw Object.assign(new Error("No such station"), { statusCode: 404 });
    return radio.nowPlaying(station.id, station);
  });

  /** How to play a station: the TV hands this straight to the box. */
  app.get("/api/radio/:id/play", async (req: Req<{ id: string }, Record<string, string>, Record<string, string>>) => {
    const station = radio.get(decodeURIComponent(req.params.id), kidsOf(req));
    if (!station) throw Object.assign(new Error("No such station"), { statusCode: 404 });
    return stationPlayback(station);
  });

  /** Add the household's own station. Adult-only: it's a settings change, not a watch action. */
  app.post("/api/radio", async (req: Req<Record<string, string>, Record<string, string>, { name?: unknown; url?: unknown }>) => {
    if (!viewer(req).admin) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    const station = radio.add({ name: String(req.body?.name ?? ""), url: String(req.body?.url ?? "") });
    return { station, stations: radio.stations(false) };
  });

  app.delete("/api/radio/:id", async (req: Req<{ id: string }, Record<string, string>, Record<string, string>>) => {
    if (!viewer(req).admin) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    if (!radio.remove(decodeURIComponent(req.params.id))) throw Object.assign(new Error("No such station"), { statusCode: 404 });
    return { ok: true, stations: radio.stations(false) };
  });

  app.get("/api/podcasts", async () => ({ shows: await podcasts.listFresh() }));

  app.get("/api/podcasts/search", async (req: Req<Record<string, string>, { q?: string }, Record<string, string>>) => {
    const results = await podcasts.search(req.query?.q ?? "").catch((err: unknown) => {
      throw Object.assign(new Error(err instanceof Error ? err.message : "The podcast search didn't answer"), { statusCode: 502 });
    });
    return { results };
  });

  /** Following a show is a household change, like adding a station: adult-only, so Kids can't
   *  subscribe to anything (or unfollow what a grown-up chose). Listening is not. */
  app.post("/api/podcasts", async (req: Req<Record<string, string>, Record<string, string>, { feedUrl?: unknown }>) => {
    if (!viewer(req).admin) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    const show = await podcasts.add(req.body?.feedUrl).catch((err: unknown) => {
      throw Object.assign(new Error(err instanceof Error ? err.message : "That feed couldn't be read"), { statusCode: 400 });
    });
    return { show, shows: podcasts.list() };
  });

  /** A show's episodes. Opening it is also what clears its new-episode badge. */
  app.get("/api/podcasts/:id", async (req: Req<{ id: string }, Record<string, string>, Record<string, string>>) => {
    return podcasts.open(decodeURIComponent(req.params.id)).catch((err: unknown) => {
      throw Object.assign(new Error(err instanceof Error ? err.message : "That show couldn't be read"), { statusCode: 404 });
    });
  });

  app.delete("/api/podcasts/:id", async (req: Req<{ id: string }, Record<string, string>, Record<string, string>>) => {
    if (!viewer(req).admin) throw Object.assign(new Error("Ask a grown-up: this needs the PIN"), { statusCode: 403, code: "pin" });
    if (!podcasts.remove(decodeURIComponent(req.params.id))) throw Object.assign(new Error("No such show"), { statusCode: 404 });
    return { ok: true, shows: podcasts.list() };
  });

  /** Where someone got to in an episode, so the next open carries on from there. */
  app.post("/api/podcasts/:id/position", async (req: Req<{ id: string }, Record<string, string>, { positionMs?: unknown; durationMs?: unknown }>) => {
    const positionMs = Number(req.body?.positionMs);
    const durationMs = Number(req.body?.durationMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) throw Object.assign(new Error("Where did they get to?"), { statusCode: 400 });
    podcasts.savePosition(decodeURIComponent(req.params.id), positionMs, Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined);
    return { ok: true, resumeFrom: positionMs >= PODCAST_RESUME_MS ? positionMs : 0 };
  });

  /** A podcast plays from the episode's own address: nothing to resolve, but the same shape. */
  app.get("/api/podcasts/:showId/:episodeId/play", async (req: Req<{ showId: string; episodeId: string }, { from?: string }, Record<string, string>>) => {
    const show = await podcasts.open(decodeURIComponent(req.params.showId)).catch(() => null);
    if (!show) throw Object.assign(new Error("No such show"), { statusCode: 404 });
    const episode = show.episodes.find((e) => e.id === decodeURIComponent(req.params.episodeId));
    if (!episode) throw Object.assign(new Error("No such episode"), { statusCode: 404 });
    const fromStart = req.query?.from === "start";
    return episodePlayback(show.show.title, episode, fromStart ? 0 : (episode.positionMs ?? 0));
  });
}
