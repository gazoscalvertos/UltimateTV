// Turns "play this" into a URL the box can open, plus everything the player needs: resume point,
// subtitles, skip markers, frame rate and what plays next.

import { randomBytes } from "node:crypto";
import type { Channel, PlaybackInfo, PlaybackRequest, StreamCandidate, TitleRef } from "@ultimatetv/shared";
import { episodeLabel, skipMarkersFrom } from "@ultimatetv/shared";
import { adSkipSettings } from "./adskip.js";
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
const STREAM_CACHE_MS = 30 * 60_000;

/** Who is asking and why: the TV by default, or a phone watching or downloading for later. */
export interface PlayContext {
  /** The device: "box" (the TV) or "phone:<id>". */
  holder?: string;
  /** Resolving for an offline download: IPTV waits for a free connection, Jellyfin can send a smaller copy. */
  download?: boolean;
  smaller?: boolean;
}

export class Playback {
  /** What each title being played is (which episode, and the one after), by progress key, for report(). */
  private playing = new Map<string, { episodeId?: string; next?: { episodeId: string; name?: string }; subtitle?: string }>();

  constructor(
    private ctx: HubContext,
    private library: Library,
  ) {}

  async resolve(req: PlaybackRequest & { force?: boolean }, hubBase: string, f: ContentFilter = NO_FILTER, pc: PlayContext = {}): Promise<PlaybackInfo> {
    if (f.kids) this.check(req, f);
    switch (req.kind) {
      case "channel":
        return this.channel(req.id, hubBase, req.force ?? false, pc);
      case "catchup":
        return this.catchup(req.id, req.start, hubBase, req.force ?? false, pc);
      case "recording":
        return this.recording(req.id, hubBase, pc);
      case "title":
      case "stream":
        return this.title(req, hubBase, f, req.force ?? false, pc);
    }
  }

  /**
   * A phone about to take the only IPTV connection from the TV (or another phone): ask first, so
   * nobody's programme stops without warning. The TV itself just switches, as it always has.
   */
  private askBeforeTakingOver(key: string, pc: PlayContext): void {
    const holder = pc.holder;
    if (!holder || holder === "box" || pc.download) return;
    const verdict = this.ctx.guard.check(key, "view");
    if (verdict.ok) return;
    const other = verdict.preempts.find((l) => [...l.holders].some(([h, k]) => k === "view" && h !== holder));
    if (!other) return;
    const who = other.holders.has("box") ? "the TV" : "another phone";
    throw new PlaybackError(`Your IPTV connection is in use on ${who} (${other.label}). Watching here will stop it there.`, "busy");
  }

  /** The stream list for a title or episode, from the last 30 minutes if it was looked up then. */
  private async titleStreams(id: string, episodeId?: string): Promise<StreamCandidate[]> {
    const key = `${id}|${episodeId ?? ""}`;
    const cached = streamCache.get(key);
    if (cached && Date.now() - cached.at < STREAM_CACHE_MS) return cached.streams;
    const streams = await this.library.streams(id, episodeId ? episodeNumbers(episodeId) : undefined);
    streamCache.set(key, { at: Date.now(), streams });
    return streams;
  }

  /**
   * Looks up the next episode's versions while the current one plays, so Up Next starts it at
   * once instead of asking every source (TorBox through AIOStreams takes seconds) at the end.
   */
  async prefetch(req: PlaybackRequest, f: ContentFilter = NO_FILTER): Promise<void> {
    if (req.kind !== "title") return;
    await this.library.details(req.id, f);
    await this.titleStreams(req.id, req.episodeId);
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

  private channel(id: string, hubBase: string, force: boolean, pc: PlayContext = {}): PlaybackInfo {
    const channel = this.ctx.channels.get(id);
    if (!channel) throw new PlaybackError("That channel isn't available", "not-found");
    if (channel.mix) return this.mixChannel(channel, hubBase);
    const verdict = this.ctx.guard.check(LiveRelay.key(id), "view");
    if (!verdict.ok && verdict.blockedBy.length > 0 && !force) {
      const recs = this.ctx.recordings.withStatus("recording");
      const names = recs.map((r) => `${r.programme.title} is recording on ${r.channelName}`).join(". ");
      throw new PlaybackError(`${names || "Your IPTV connection is busy"}. Switching channel will stop the recording.`, "busy", recs.map((r) => r.id));
    }
    if (!force) this.askBeforeTakingOver(LiveRelay.key(id), pc);
    const q = new URLSearchParams();
    if (force) q.set("force", "1");
    if (pc.holder && pc.holder !== "box") q.set("holder", pc.holder);
    const { now } = this.ctx.guide.nowNext(id);
    const info: PlaybackInfo = {
      url: `${hubBase}/api/live/${encodeURIComponent(id)}.ts${q.size ? `?${q}` : ""}`,
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

  /** A music video channel: the video on now from where it has got to, then the next few hours of them. */
  private mixChannel(channel: Channel, hubBase: string): PlaybackInfo {
    const tuned = this.ctx.mix.tuneIn(channel.id);
    if (!tuned) {
      const c = this.ctx.mix.store.channel(channel.id);
      const counts = c ? this.ctx.mix.info(c).counts : undefined;
      const busy = counts && counts.queued + counts.downloading > 0;
      throw new PlaybackError(busy ? `${channel.name} is still downloading its first videos. Try again in a few minutes.` : `${channel.name} has no videos yet. Add some in Settings › Music channels.`, "unavailable");
    }
    const file = (videoId: string) => `${hubBase}/api/mix/videos/${encodeURIComponent(videoId)}/file`;
    const p = tuned.first.programme;
    const info: PlaybackInfo = {
      url: file(tuned.first.videoId),
      title: channel.name,
      subtitle: p.title,
      live: true,
      startMs: tuned.first.offsetMs,
      externalSubtitles: [],
      progressKey: `channel:${channel.id}`,
      skip: [],
      queue: tuned.queue.map(file),
      titles: tuned.titles,
      ...(tuned.crops.some(Boolean) ? { crops: tuned.crops } : {}),
      fill: true,
    };
    if (p.image) info.artwork = p.image.startsWith("/") ? hubBase + p.image : p.image;
    if (channel.logo) info.logo = channel.logo;
    return info;
  }

  private catchup(programmeId: string, _start: number | undefined, hubBase: string, force: boolean, pc: PlayContext = {}): PlaybackInfo {
    const p = this.ctx.guide.get(programmeId);
    if (!p) throw new PlaybackError("That programme isn't in the guide any more", "not-found");
    const url = catchupUrl(this.ctx.channels.feeds(p.channelId), p.start, p.end, { settings: this.ctx.settings.get(), timeZoneOf: (s) => this.ctx.ingest.sourceMeta(s)?.timeZone });
    if (!url) throw new PlaybackError("Catch-up isn't available for this programme", "unavailable");
    if (!force) this.askBeforeTakingOver(`catchup:${p.id}`, pc);
    const token = this.ctx.proxy.register({ url, label: `Catch-up: ${p.title}`, iptv: true, force, ...this.lease(pc) });
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

  /** Who holds the proxy's IPTV lease: a phone's download waits behind anyone watching. */
  private lease(pc: PlayContext): { holder?: string; kind?: "view" | "background" } {
    return { ...(pc.holder ? { holder: pc.holder } : {}), ...(pc.download ? { kind: "background" as const } : {}) };
  }

  private recording(id: string, hubBase: string, pc: PlayContext = {}): PlaybackInfo {
    const r = this.ctx.recordings.get(id);
    if (!r) throw new PlaybackError("That recording has been deleted", "not-found");
    if (r.status === "recording" && r.method === "live") {
      // Still recording: watch it live (shares the recording's stream), Sky-style "play from start" comes once it finishes.
      return { ...this.channel(r.channelId, hubBase, false, pc), title: r.programme.title, progressKey: `recording:${id}` };
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
      // Advert breaks comskip found (adskip.ts) show Skip adverts, or are jumped over.
      skip: (r.adBreaks ?? []).map((b) => ({ kind: "adverts" as const, startMs: b.startMs, endMs: b.endMs })),
      ...(r.adBreaks?.length && adSkipSettings(this.ctx.db).mode === "auto" ? { autoSkipAdverts: true } : {}),
      ...(p.image ? { artwork: p.image } : {}),
    };
  }

  private async title(req: PlaybackRequest, hubBase: string, f: ContentFilter, force = false, pc: PlayContext = {}): Promise<PlaybackInfo> {
    if (f.kids) await this.library.details(req.id, f);
    const ep = req.episodeId ? episodeNumbers(req.episodeId) : undefined;
    const streams = await this.titleStreams(req.id, req.episodeId);
    const chosen = req.streamId ? streams.find((s) => s.id === req.streamId) : (streams.find((s) => s.ready) ?? streams[0]);
    if (!chosen) throw new PlaybackError("Nothing to play this from yet. Try again later, or check your sources in Settings.", "unavailable");

    const details = await this.library.details(req.id);
    const info: PlaybackInfo = {
      url: chosen.url,
      title: details.name,
      live: false,
      startMs: 0,
      quality: chosen.quality,
      source: { kind: chosen.kind, label: chosen.label },
      streamId: chosen.id,
      savable: chosen.downloadable,
      externalSubtitles: [],
      progressKey: `title:${req.id}${req.episodeId ? `|${req.episodeId}` : ""}`,
      skip: [],
    };
    if (chosen.headers) info.headers = chosen.headers;
    const artwork = details.backdrop ?? details.poster;
    if (artwork) info.artwork = artwork;
    if (info.url.startsWith("/")) info.url = hubBase + info.url;
    if (ep) {
      // The details may list a season without its episodes (TMDB sends them per season).
      const seasonOf = async (n: number) => {
        const listed = details.seasons?.find((s) => s.season === n);
        if (listed?.episodes.length || !details.seasons?.some((s) => s.season === n)) return listed;
        return (await this.library.season(req.id, n).catch(() => undefined)) ?? listed;
      };
      const season = await seasonOf(ep.season);
      const episode = season?.episodes.find((e) => e.episode === ep.episode);
      info.subtitle = `${episodeLabel(ep.season, ep.episode)}${episode ? ` · ${episode.name}` : ""}`;
      const next = season?.episodes.find((e) => e.episode === ep.episode + 1) ?? (await seasonOf(ep.season + 1))?.episodes[0];
      if (next) {
        info.next = { kind: "title", id: req.id, episodeId: `s${next.season}e${next.episode}`, name: `${episodeLabel(next.season, next.episode)} · ${next.name}` };
        const image = next.still ?? details.backdrop;
        if (image) info.next.image = image;
        if (next.overview) info.next.overview = next.overview;
      }
    } else if (details.year) {
      info.subtitle = String(details.year);
    }

    // IPTV VOD counts against the connection limit, so it goes through the Hub's proxy.
    if (chosen.kind === "xtream") {
      // Ask now rather than letting the player hit a 409: the TV can then offer "Switch anyway".
      const verdict = this.ctx.guard.check(`vod:${chosen.id}`, "view");
      if (!verdict.ok && verdict.blockedBy.length > 0 && !force && !pc.download) {
        const recs = this.ctx.recordings.withStatus("recording");
        const names = recs.map((r) => `${r.programme.title} is recording on ${r.channelName}`).join(". ");
        throw new PlaybackError(`${names || "Your IPTV connection is busy"}. Playing this will stop the recording.`, "busy", recs.map((r) => r.id));
      }
      if (!force) this.askBeforeTakingOver(`vod:${chosen.id}`, pc);
      const token = this.ctx.proxy.register({ url: chosen.url, label: `IPTV: ${details.name}`, iptv: true, force, ...this.lease(pc) });
      info.url = `${hubBase}/api/stream/${token}`;
    }

    if (chosen.kind === "jellyfin") {
      const jf = this.ctx.jellyfin();
      const [, itemId, mediaSourceId] = chosen.id.split(":");
      if (jf && itemId) {
        const item = await jf.item(itemId);
        const resume = item.UserData?.PlaybackPositionTicks;
        if (resume) info.startMs = ticksToMs(resume);
        else {
          // Jellyfin keeps no place under 5% of the runtime; the Hub's own record does.
          const p = this.ctx.progress.get(`jellyfin:${itemId}`);
          if (p && !p.watched && !item.UserData?.Played) info.startMs = p.positionMs;
        }
        if (item.RunTimeTicks) info.durationMs = ticksToMs(item.RunTimeTicks);
        const src = item.MediaSources?.find((m) => m.Id === mediaSourceId) ?? item.MediaSources?.[0];
        const video = src?.MediaStreams?.find((m) => m.Type === "Video");
        const fps = video?.RealFrameRate ?? video?.AverageFrameRate;
        if (fps) info.fps = fps;
        for (const s of src?.MediaStreams ?? []) {
          if (s.Type === "Subtitle" && s.IsExternal && src) info.externalSubtitles.push({ url: jf.subtitleUrl(itemId, src.Id, s.Index, s.Codec), lang: s.Language ?? "und", label: s.DisplayTitle ?? s.Language ?? "Subtitles" });
        }
        const segments = await jf.segments(itemId);
        info.skip = skipMarkersFrom(segments);
        info.progressKey = `jellyfin:${itemId}`;
        if (pc.smaller) {
          info.url = jf.hlsUrl(itemId, src?.Id, randomBytes(8).toString("hex"));
          info.hls = true;
          // Roughly 3.2 Mbit/s for the picture and sound together.
          if (info.durationMs && info.quality) info.quality = { ...info.quality, sizeBytes: Math.round((info.durationMs / 1000) * 400_000), height: Math.min(info.quality.height, 720), codec: "h264", audio: "aac", hdr: "sdr", channels: 2 };
        }
      }
    } else {
      const p = this.ctx.progress.get(info.progressKey);
      if (p && !p.watched) info.startMs = p.positionMs;
    }
    const about: { episodeId?: string; next?: { episodeId: string; name?: string }; subtitle?: string } = {};
    if (ep) about.episodeId = `s${ep.season}e${ep.episode}`;
    if (ep && info.subtitle) about.subtitle = info.subtitle;
    if (info.next?.episodeId) about.next = { episodeId: info.next.episodeId, name: info.next.name };
    if (this.playing.size > 200) this.playing.clear();
    this.playing.set(info.progressKey, about);
    if (!info.fps) {
      const fps = /\b(23\.976|24|25|29\.97|50|59\.94|60) ?fps\b/i.exec(chosen.detail ?? "");
      if (fps?.[1]) info.fps = Number(fps[1]);
    }
    return info;
  }

  /**
   * Saves progress, and passes it on to Jellyfin for library items (kept here too, for Continue
   * watching). A stop tells the TV, so Home shows it in Continue watching straight away.
   */
  async report(key: string, positionMs: number, durationMs: number | undefined, event: "start" | "progress" | "stop", paused = false, ref?: TitleRef): Promise<void> {
    await this.save(key, positionMs, durationMs, event, paused, ref);
    if (event === "stop") this.ctx.events.emit({ type: "progress.changed" });
  }

  private async save(key: string, positionMs: number, durationMs: number | undefined, event: "start" | "progress" | "stop", paused: boolean, ref?: TitleRef): Promise<void> {
    if (key.startsWith("jellyfin:")) {
      const jf = this.ctx.jellyfin();
      if (jf) await jf.reportProgress(key.slice(9), positionMs, event, paused).catch((err) => this.ctx.log.warn({ err: String(err) }, "Jellyfin progress failed"));
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
    // The start report comes before the player knows where it is, and a player that has just
    // stopped or reached the end can say 0: neither may wipe the place already saved.
    if (event === "start" || (positionMs < 1000 && this.ctx.progress.get(key))) return;
    const { subtitle, ...about } = this.playing.get(key) ?? {};
    const entry: Parameters<HubContext["progress"]["save"]>[0] = { key, positionMs, ...about };
    if (durationMs) entry.durationMs = durationMs;
    // The episode's "S1 E4 · Name" goes with it, for its card.
    if (ref) entry.title = { ...stripRef(ref), ...(subtitle ? { subtitle } : {}) };
    this.ctx.progress.save(entry);
  }
}

/** The title as Continue watching keeps it, without what's worked out each time it's shown. */
function stripRef(ref: TitleRef): TitleRef {
  const out: TitleRef = { id: ref.id, kind: ref.kind, name: ref.name };
  for (const k of ["year", "poster", "backdrop", "logo", "genres", "certification"] as const) if (ref[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = ref[k];
  return out;
}

/** Season and episode numbers from an episode request id: "s2e5" (what the UI sends) or a TMDB episode id. */
export function episodeNumbers(episodeId: string): { season: number; episode: number } | undefined {
  const tmdb = /^tmdb:episode:\d+:(\d+):(\d+)$/.exec(episodeId);
  if (tmdb) return { season: Number(tmdb[1]), episode: Number(tmdb[2]) };
  const se = /(?:^|:)s(\d+)e(\d+)$/i.exec(episodeId);
  if (se) return { season: Number(se[1]), episode: Number(se[2]) };
  return undefined;
}
