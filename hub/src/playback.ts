// Turns "play this" into a URL the box can open, plus everything the player needs: resume point,
// subtitles, skip markers, frame rate and what plays next.

import type { PlaybackInfo, PlaybackRequest, StreamCandidate, TitleRef } from "@ultimatetv/shared";
import { episodeLabel } from "@ultimatetv/shared";
import { catchupUrl } from "./catchup.js";
import type { HubContext } from "./context.js";
import { type Library, NotAllowedError } from "./library.js";
import { type ContentFilter, NO_FILTER } from "./profiles.js";
import { LiveRelay } from "./relay.js";
import { ticksToMs } from "./services/jellyfin.js";

export class PlaybackError extends Error {
  constructor(
    message: string,
    readonly code: "busy" | "unavailable" | "not-found",
    readonly recordings: string[] = [],
  ) {
    super(message);
  }
}

/** Remembers the last stream list per title so "play stream N" resolves without asking the addons again. */
const streamCache = new Map<string, { at: number; streams: StreamCandidate[] }>();

export class Playback {
  constructor(
    private ctx: HubContext,
    private library: Library,
  ) {}

  async resolve(req: PlaybackRequest & { force?: boolean }, hubBase: string, f: ContentFilter = NO_FILTER): Promise<PlaybackInfo> {
    if (f.kids) this.check(req, f);
    switch (req.kind) {
      case "channel":
        return this.channel(req.id, hubBase, req.force ?? false);
      case "catchup":
        return this.catchup(req.id, req.start, hubBase, req.force ?? false);
      case "recording":
        return this.recording(req.id, hubBase);
      case "title":
      case "stream":
        return this.title(req, hubBase, f);
    }
  }

  /** Kids profiles can only play allowed channels, and programmes and recordings from them. */
  private check(req: PlaybackRequest, f: ContentFilter): void {
    let channelId: string | undefined;
    if (req.kind === "channel") channelId = req.id;
    else if (req.kind === "catchup") channelId = this.ctx.guide.get(req.id)?.channelId;
    else if (req.kind === "recording") channelId = this.ctx.recordings.get(req.id)?.channelId;
    else return; // Titles are checked against their certificate in title().
    const channel = channelId ? this.ctx.channels.get(channelId) : undefined;
    if (!channel || !f.channel(channel)) throw new NotAllowedError();
  }

  private channel(id: string, hubBase: string, force: boolean): PlaybackInfo {
    const channel = this.ctx.channels.get(id);
    if (!channel) throw new PlaybackError("That channel isn't available", "not-found");
    const verdict = this.ctx.guard.check(LiveRelay.key(id), "view");
    if (!verdict.ok && verdict.blockedBy.length > 0 && !force) {
      const recs = this.ctx.recordings.withStatus("recording");
      const names = recs.map((r) => `${r.programme.title} is recording on ${r.channelName}`).join(". ");
      throw new PlaybackError(`${names || "Your IPTV connection is busy"}. Switching channel will stop the recording.`, "busy", recs.map((r) => r.id));
    }
    const { now } = this.ctx.guide.nowNext(id);
    const info: PlaybackInfo = {
      url: `${hubBase}/api/live/${encodeURIComponent(id)}.ts${force ? "?force=1" : ""}`,
      title: channel.name,
      live: true,
      startMs: 0,
      externalSubtitles: [],
      progressKey: `channel:${id}`,
      skip: [],
    };
    if (now) info.subtitle = now.title;
    if (now?.image) info.artwork = now.image;
    if (channel.logo) info.logo = channel.logo;
    return info;
  }

  private catchup(programmeId: string, _start: number | undefined, hubBase: string, force: boolean): PlaybackInfo {
    const p = this.ctx.guide.get(programmeId);
    if (!p) throw new PlaybackError("That programme isn't in the guide any more", "not-found");
    const url = catchupUrl(this.ctx.channels.feeds(p.channelId), p.start, p.end, { settings: this.ctx.settings.get(), timeZoneOf: (s) => this.ctx.ingest.sourceMeta(s)?.timeZone });
    if (!url) throw new PlaybackError("Catch-up isn't available for this programme", "unavailable");
    const token = this.ctx.proxy.register({ url, label: `Catch-up: ${p.title}`, iptv: true, force });
    const progress = this.ctx.progress.get(`programme:${p.id}`);
    return {
      url: `${hubBase}/api/stream/${token}`,
      title: p.title,
      subtitle: [episodeLabel(p.season, p.episode), p.subtitle].filter(Boolean).join(" · ") || this.ctx.channels.get(p.channelId)?.name || "",
      live: false,
      startMs: progress && !progress.watched ? progress.positionMs : 0,
      durationMs: p.end - p.start,
      externalSubtitles: [],
      progressKey: `programme:${p.id}`,
      skip: [],
      ...(p.image ? { artwork: p.image } : {}),
    };
  }

  private recording(id: string, hubBase: string): PlaybackInfo {
    const r = this.ctx.recordings.get(id);
    if (!r) throw new PlaybackError("That recording has been deleted", "not-found");
    if (r.status === "recording" && r.method === "live") {
      // Still recording: watch it live (shares the recording's stream), Sky-style "play from start" comes once it finishes.
      return { ...this.channel(r.channelId, hubBase, false), title: r.programme.title, progressKey: `recording:${id}` };
    }
    if (r.status !== "completed" || !r.path) throw new PlaybackError("This recording isn't ready yet", "unavailable");
    const p = r.programme;
    return {
      url: `${hubBase}/api/recordings/${encodeURIComponent(id)}/file`,
      title: p.title,
      subtitle: [episodeLabel(p.season, p.episode), p.subtitle].filter(Boolean).join(" · ") || r.channelName,
      live: false,
      startMs: r.positionMs,
      durationMs: p.end - p.start,
      fps: 25,
      externalSubtitles: [],
      progressKey: `recording:${id}`,
      skip: [],
      ...(p.image ? { artwork: p.image } : {}),
    };
  }

  private async title(req: PlaybackRequest, hubBase: string, f: ContentFilter): Promise<PlaybackInfo> {
    if (f.kids) await this.library.details(req.id, f);
    const ep = req.episodeId ? episodeNumbers(req.episodeId) : undefined;
    const cacheKey = `${req.id}|${req.episodeId ?? ""}`;
    const cached = streamCache.get(cacheKey);
    const streams = cached && Date.now() - cached.at < 10 * 60_000 ? cached.streams : await this.library.streams(req.id, ep);
    streamCache.set(cacheKey, { at: Date.now(), streams });
    const chosen = req.streamId ? streams.find((s) => s.id === req.streamId) : (streams.find((s) => s.ready) ?? streams[0]);
    if (!chosen) throw new PlaybackError("Nothing to play this from yet. Try again later, or check your sources in Settings.", "unavailable");

    const details = await this.library.details(req.id);
    const info: PlaybackInfo = {
      url: chosen.url,
      title: details.name,
      live: false,
      startMs: 0,
      quality: chosen.quality,
      externalSubtitles: [],
      progressKey: `title:${req.id}${req.episodeId ? `|${req.episodeId}` : ""}`,
      skip: [],
    };
    if (chosen.headers) info.headers = chosen.headers;
    const artwork = details.backdrop ?? details.poster;
    if (artwork) info.artwork = artwork;
    if (info.url.startsWith("/")) info.url = hubBase + info.url;
    if (ep) {
      const season = details.seasons?.find((s) => s.season === ep.season);
      const episode = season?.episodes.find((e) => e.episode === ep.episode);
      info.subtitle = `${episodeLabel(ep.season, ep.episode)}${episode ? ` · ${episode.name}` : ""}`;
      const next = season?.episodes.find((e) => e.episode === ep.episode + 1) ?? details.seasons?.find((s) => s.season === ep.season + 1)?.episodes[0];
      if (next) info.next = { kind: "title", id: req.id, episodeId: `s${next.season}e${next.episode}`, name: `${episodeLabel(next.season, next.episode)} · ${next.name}` };
    } else if (details.year) {
      info.subtitle = String(details.year);
    }

    // IPTV VOD counts against the connection limit, so it goes through the Hub's proxy.
    if (chosen.kind === "xtream") {
      const token = this.ctx.proxy.register({ url: chosen.url, label: `IPTV: ${details.name}`, iptv: true, force: false });
      info.url = `${hubBase}/api/stream/${token}`;
    }

    if (chosen.kind === "jellyfin") {
      const jf = this.ctx.jellyfin();
      const [, itemId, mediaSourceId] = chosen.id.split(":");
      if (jf && itemId) {
        const item = await jf.item(itemId);
        const resume = item.UserData?.PlaybackPositionTicks;
        if (resume) info.startMs = ticksToMs(resume);
        if (item.RunTimeTicks) info.durationMs = ticksToMs(item.RunTimeTicks);
        const src = item.MediaSources?.find((m) => m.Id === mediaSourceId) ?? item.MediaSources?.[0];
        const video = src?.MediaStreams?.find((m) => m.Type === "Video");
        const fps = video?.RealFrameRate ?? video?.AverageFrameRate;
        if (fps) info.fps = fps;
        for (const s of src?.MediaStreams ?? []) {
          if (s.Type === "Subtitle" && s.IsExternal && src) info.externalSubtitles.push({ url: jf.subtitleUrl(itemId, src.Id, s.Index, s.Codec), lang: s.Language ?? "und", label: s.DisplayTitle ?? s.Language ?? "Subtitles" });
        }
        const segments = await jf.segments(itemId);
        info.skip = segments
          .filter((s) => /intro|recap|outro|credits/i.test(s.Type))
          .map((s) => ({ kind: /intro/i.test(s.Type) ? "intro" : /recap/i.test(s.Type) ? "recap" : "credits", startMs: ticksToMs(s.StartTicks), endMs: ticksToMs(s.EndTicks) }));
        info.progressKey = `jellyfin:${itemId}`;
      }
    } else {
      const p = this.ctx.progress.get(info.progressKey);
      if (p && !p.watched) info.startMs = p.positionMs;
    }
    if (!info.fps) {
      const fps = /\b(23\.976|24|25|29\.97|50|59\.94|60) ?fps\b/i.exec(chosen.detail ?? "");
      if (fps?.[1]) info.fps = Number(fps[1]);
    }
    return info;
  }

  /** Saves progress, and passes it on to Jellyfin for library items. */
  async report(key: string, positionMs: number, durationMs: number | undefined, event: "start" | "progress" | "stop", paused = false, ref?: TitleRef): Promise<void> {
    if (key.startsWith("jellyfin:")) {
      const jf = this.ctx.jellyfin();
      if (jf) await jf.reportProgress(key.slice(9), positionMs, event, paused).catch((err) => this.ctx.log.warn({ err: String(err) }, "Jellyfin progress failed"));
      return;
    }
    if (key.startsWith("channel:")) return;
    if (key.startsWith("recording:")) {
      const r = this.ctx.recordings.get(key.slice(10));
      if (r && r.status === "completed") {
        const watched = durationMs ? positionMs / durationMs > 0.92 : r.watched;
        this.ctx.recordings.save({ ...r, positionMs: watched ? 0 : positionMs, watched: watched || r.watched });
        this.ctx.events.emit({ type: "recordings.changed" });
      }
      return;
    }
    const entry: Parameters<HubContext["progress"]["save"]>[0] = { key, positionMs };
    if (durationMs) entry.durationMs = durationMs;
    if (ref) entry.title = ref;
    this.ctx.progress.save(entry);
  }
}

/** Season and episode numbers from an episode request id: "s2e5" (what the UI sends) or a TMDB episode id. */
export function episodeNumbers(episodeId: string): { season: number; episode: number } | undefined {
  const tmdb = /^tmdb:episode:\d+:(\d+):(\d+)$/.exec(episodeId);
  if (tmdb) return { season: Number(tmdb[1]), episode: Number(tmdb[2]) };
  const se = /(?:^|:)s(\d+)e(\d+)$/i.exec(episodeId);
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };
  return undefined;
}
