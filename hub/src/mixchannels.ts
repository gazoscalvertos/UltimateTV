// Music video channels: the Hub keeps a list of music videos per channel, downloads them to the
// NAS with yt-dlp and plays them as a live channel. Each pass through a channel's videos is a
// fresh shuffle, never the same order as the pass before and never the same video twice in a row,
// and the schedule is written into the guide like any other channel's programmes.
//
// Who picks the videos is a Curator. The built-in one searches YouTube for the channel's picks
// ("Artist - Title") and then its broader searches; an LLM curator can plug in later and only has
// to return those two lists from the channel's brief. Everything is also reachable over
// /api/mix-channels, so an outside agent can search, add and remove videos itself.
//
// A channel can also follow YouTube playlists: every video in them is downloaded the same way and
// put on the channel, and each playlist is read again every six hours for videos added since (and
// ones taken out of it come off). Playlist videos are on top of the channel's target, which is
// only how many the Hub finds itself.

import { existsSync } from "node:fs";
import { mkdir, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import type { Channel, MixCandidate, MixChannel, MixChannelInfo, MixEntry, MixOverview, MixPlaylist, MixPlaylistInfo, MixVideo, MixVideoStatus, Programme } from "@ultimatetv/shared";
import { normaliseChannelName } from "@ultimatetv/shared";
import type { ChannelStore } from "./channels.js";
import { type CropDetect, ffmpegCropDetect } from "./cropdetect.js";
import { ffprobeVideo, grabStill, insideRoots, isVideoFile, listNas, nasRoots, nasVideoId, titleFromFile, videosIn, type VideoProbe } from "./nasvideos.js";
import { slug } from "./channels.js";
import type { Db } from "./db.js";
import type { GuideStore } from "./epg.js";
import type { EventBus } from "./events.js";
import type { Logger } from "./log.js";
import { FIRST_SEED_NAMES, MIX_SEEDS, type MixSeed } from "./mixseeds.js";
import type { SettingsStore } from "./settings.js";
import { displayTitle, overlap, playlistId, songKey, toCandidate, type Playlist, type YtDlp, type YtInfo } from "./ytdlp.js";

const HOUR = 3_600_000;
/** How far ahead the guide is filled, and when it is topped up. */
const PLAN_AHEAD = 48 * HOUR;
const TOP_UP_BELOW = 40 * HOUR;
/** How much of the schedule the TV is handed at once; it tunes in again when it runs out. */
const QUEUE_AHEAD = 6 * HOUR;
/** Searches go this far down YouTube's results, a page at a time, a few pages each pass. */
const SEARCH_PAGE = 25;
const SEARCH_DEPTH = 200;
const SEARCH_PAGES_PER_PASS = 3;
/** Leave this much room on the NAS. */
const MIN_FREE_BYTES = 10 * 1024 ** 3;
const RECURATE_AFTER = 24 * HOUR;
/** Playlists are read again this often for new videos. */
const RESYNC_AFTER = 6 * HOUR - 10 * 60_000;
/** The most of a playlist a channel takes, so a huge one can't fill the NAS. */
export const MAX_PLAYLIST = 200;
const MAX_PLAYLISTS = 20;

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });

export type Rand = () => number;

// ---------------------------------------------------------------------------
// Shuffling

/** Fisher–Yates. */
export function shuffle<T>(list: T[], rand: Rand = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The order of the next pass through a channel's videos: a new shuffle that doesn't repeat the
 * previous pass's order and doesn't start with the video that just played.
 */
export function nextLoop(ids: string[], previous: string[], last: string | undefined, rand: Rand = Math.random): string[] {
  if (ids.length <= 1) return [...ids];
  const same = (a: string[]) => a.length === previous.length && a.every((id, i) => id === previous[i]);
  let order = shuffle(ids, rand);
  for (let i = 0; i < 12 && (order[0] === last || (ids.length > 2 && same(order))); i++) order = shuffle(ids, rand);
  if (order[0] === last) {
    const j = 1 + Math.floor(rand() * (order.length - 1));
    [order[0], order[j]] = [order[j]!, order[0]!];
  }
  return order;
}

export interface Slot {
  videoId: string;
  start: number;
  end: number;
}

export interface BagState {
  /** Videos still to play in this pass, in order. */
  bag: string[];
  /** This pass's whole order, so the next one can differ from it. */
  loop: string[];
}

/** Fills `from`..`until` with videos, drawing from the bag and reshuffling when it empties. */
export function planSlots(from: number, until: number, durations: Map<string, number>, state: BagState, last: string | undefined, rand: Rand = Math.random): { slots: Slot[]; state: BagState } {
  const slots: Slot[] = [];
  let { bag, loop } = state;
  bag = [...bag];
  let t = from;
  let prev = last;
  if (!durations.size) return { slots, state: { bag, loop } };
  let empty = 0;
  while (t < until) {
    if (!bag.length) {
      loop = nextLoop([...durations.keys()], loop, prev, rand);
      bag = [...loop];
    }
    const id = bag.shift()!;
    const ms = durations.get(id);
    if (!ms || ms <= 0) {
      // Gone since the pass was shuffled; a pass of only missing videos would spin for ever.
      if (++empty > durations.size + bag.length + 1) break;
      continue;
    }
    empty = 0;
    slots.push({ videoId: id, start: t, end: t + ms });
    t += ms;
    prev = id;
  }
  return { slots, state: { bag, loop } };
}

/**
 * Four-minute videos are too narrow to read in the guide's grid, so the grid shows them in
 * half-hour blocks ("Darude, Milk Inc, Inna and 5 more") listing the songs. The block keeps the
 * first video's id, so it opens like any programme; now/next and search still see each video.
 */
export function guideBlocks(videos: Programme[], minutes = 30): Programme[] {
  const size = minutes * 60_000;
  const blocks: Programme[] = [];
  let group: Programme[] = [];
  const flush = () => {
    const [first] = group;
    const last = group[group.length - 1];
    if (!first || !last) return;
    const artists = [...new Set(group.map((p) => p.title.split(" – ")[0]!))];
    const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ || "Europe/London" });
    blocks.push({
      ...first,
      end: last.end,
      title: artists.length > 3 ? `${artists.slice(0, 3).join(", ")} and ${artists.length - 3} more` : artists.join(", "),
      description: group.map((p) => `${time(p.start)} ${p.title}`).join(" · "),
    });
    group = [];
  };
  for (const p of videos) {
    if (group.length && Math.floor(p.start / size) !== Math.floor(group[0]!.start / size)) flush();
    group.push(p);
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// Curators

export interface CuratorPlan {
  picks: string[];
  queries: string[];
}

export interface Curator {
  /** What to look for, given the channel and what it already has. */
  plan(channel: MixChannel, have: MixEntry[]): Promise<CuratorPlan>;
}

/** Turns a brief ("90s rock anthems, Oasis, Blur") into searches, one per comma. */
export function briefQueries(brief: string, style: MixChannel["style"] = "music"): string[] {
  const tail = style === "ambience" ? "ambience 4k" : "official music video";
  return brief
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .slice(0, 12)
    .map((t) => `${t} ${tail}`);
}

export const searchCurator: Curator = {
  async plan(c) {
    return { picks: c.picks, queries: c.queries.length ? c.queries : briefQueries(c.brief, c.style) };
  },
};

// ---------------------------------------------------------------------------
// Storage

interface StoredVideo extends MixVideo {
  thumbPath?: string;
  /** Black bars baked into the picture, as mpv's video-crop ("" when there are none). */
  crop?: string;
  /** Downloads of it that hung and were stopped. */
  stalls?: number;
}

/** Channels saved before ambience channels existed are music channels. */
function withStyle(c: MixChannel): MixChannel {
  return c.style === "ambience" || c.style === "music" ? c : { ...c, style: "music" };
}

export class MixStore {
  constructor(private db: Db) {}

  channels(): MixChannel[] {
    return this.db.json<MixChannel>("SELECT data FROM mix_channels").map(withStyle).sort((a, b) => a.number - b.number);
  }

  channel(id: string): MixChannel | undefined {
    const c = this.db.jsonOne<MixChannel>("SELECT data FROM mix_channels WHERE id = ?", id);
    return c ? withStyle(c) : undefined;
  }

  saveChannel(c: MixChannel): void {
    this.db.run("INSERT INTO mix_channels (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", c.id, JSON.stringify(c));
  }

  removeChannel(id: string): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM mix_entries WHERE channel_id = ?", id);
      this.db.run("DELETE FROM mix_channels WHERE id = ?", id);
    });
  }

  video(id: string): StoredVideo | undefined {
    return this.db.jsonOne<StoredVideo>("SELECT data FROM mix_videos WHERE id = ?", id);
  }

  videosWithStatus(status: MixVideoStatus): StoredVideo[] {
    return this.db.json<StoredVideo>("SELECT data FROM mix_videos WHERE status = ?", status);
  }

  saveVideo(v: StoredVideo): void {
    this.db.run("INSERT INTO mix_videos (id, status, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data", v.id, v.status, JSON.stringify(v));
  }

  removeVideo(id: string): void {
    this.db.run("DELETE FROM mix_videos WHERE id = ?", id);
  }

  entries(channelId: string): MixEntry[] {
    const rows = this.db.all<{ video_id: string; origin: string; added_at: number }>("SELECT video_id, origin, added_at FROM mix_entries WHERE channel_id = ? ORDER BY added_at", channelId);
    const out: MixEntry[] = [];
    for (const r of rows) {
      const video = this.video(r.video_id);
      if (video) out.push({ video, origin: r.origin, addedAt: Number(r.added_at) });
    }
    return out;
  }

  addEntry(channelId: string, videoId: string, origin: string, at = Date.now()): boolean {
    if (this.db.get("SELECT 1 FROM mix_entries WHERE channel_id = ? AND video_id = ?", channelId, videoId)) return false;
    this.db.run("INSERT INTO mix_entries (channel_id, video_id, origin, added_at) VALUES (?, ?, ?, ?)", channelId, videoId, origin, at);
    return true;
  }

  removeEntry(channelId: string, videoId: string): void {
    this.db.run("DELETE FROM mix_entries WHERE channel_id = ? AND video_id = ?", channelId, videoId);
  }

  /** Channels a video is on. */
  channelsOf(videoId: string): string[] {
    return this.db.all<{ channel_id: string }>("SELECT channel_id FROM mix_entries WHERE video_id = ?", videoId).map((r) => String(r.channel_id));
  }
}

// ---------------------------------------------------------------------------
// The manager

export interface MixOptions {
  db: Db;
  channels: ChannelStore;
  guide: GuideStore;
  settings: SettingsStore;
  events: EventBus;
  log: Logger;
  /** Null when yt-dlp isn't available (development): channels work, nothing downloads. */
  ytdlp: YtDlp | null;
  curators?: Partial<Record<MixChannel["curator"], Curator>>;
  rand?: Rand;
  /** Pause between searches and downloads, so YouTube isn't hammered. */
  pauseMs?: number;
  /** Downloads stop below this much free space (default 10 GB). */
  minFreeBytes?: number;
  /** Demo mode: videos point at test clips that don't need to exist. */
  demo?: boolean;
  /** Finds baked-in black bars (default ffmpeg's cropdetect). */
  cropDetect?: CropDetect;
  /** Where the NAS shares are mounted (default /mnt/nas): linked files must be inside them. */
  mediaRoot?: string;
  /** Reads a linked file's length and picture size (default ffprobe). */
  probe?: VideoProbe;
}

type Job = { kind: "curate"; channelId: string } | { kind: "download"; videoId: string } | { kind: "playlist"; channelId: string; listId: string; retry?: boolean };
type Lane = "curate" | "download";

const jobKey = (j: Job) => (j.kind === "download" ? `d:${j.videoId}` : j.kind === "curate" ? `c:${j.channelId}` : `p:${j.channelId}:${j.listId}`);
const laneOf = (j: Job): Lane => (j.kind === "download" ? "download" : "curate");

/** Whether the Hub looks for videos for this channel itself, or it only plays its playlists and files. */
const searches = (c: MixChannel) => Boolean(c.brief || c.picks.length || c.queries.length);

export class MixManager {
  readonly store: MixStore;
  private running = false;
  private stopped = false;
  private wakers = new Set<() => void>();
  private jobs: Job[] = [];
  /** What each lane is doing now, for the overview. */
  private busy: { curate?: string; download?: string } = {};
  /** The playlist being read now (`channel id:list id`). */
  private syncing?: string;
  private downloader: MixOverview["downloader"] = { ok: false, error: "Not checked yet" };
  private timers: NodeJS.Timeout[] = [];
  private abort: AbortController | null = null;
  private rand: Rand;

  constructor(private o: MixOptions) {
    this.store = new MixStore(o.db);
    this.rand = o.rand ?? Math.random;
    if (o.demo) this.downloader = { ok: true, version: "demo" };
    else if (!o.ytdlp) this.downloader = { ok: false, error: "yt-dlp isn't installed on the Hub" };
  }

  private get curators(): Record<MixChannel["curator"], Curator> {
    // Until an LLM curator is set up, "llm" channels are filled the same way as the rest.
    return { search: searchCurator, llm: searchCurator, ...this.o.curators };
  }

  private get dir(): string {
    return this.o.settings.get().library.musicVideosPath;
  }

  // -------------------------------------------------------------------------
  // Channels

  /**
   * Creates each starter channel once. Which ones have been made is kept by name, so a channel
   * added to the seeds later (Spooky TV) arrives when the Hub updates, and one the household has
   * deleted stays deleted.
   */
  seed(seeds: MixSeed[] = MIX_SEEDS, now = Date.now()): void {
    const saved = this.o.db.getKv<string[]>("mix-seeded-names");
    const made = new Set(saved ?? (this.o.db.getKv<boolean>("mix-seeded") ? FIRST_SEED_NAMES : []));
    for (const s of seeds) {
      if (made.has(s.name)) continue;
      if (!this.store.channel(`mix:${slug(normaliseChannelName(s.name))}`)) this.create(s, now);
      made.add(s.name);
    }
    this.o.db.setKv("mix-seeded-names", [...made]);
    this.o.db.setKv("mix-seeded", true);
  }

  create(input: Partial<MixChannel> & { name?: string; playlist?: string }, now = Date.now()): MixChannel {
    const name = String(input.name ?? "").trim().slice(0, 40);
    if (!name) throw badRequest("Give the channel a name");
    const list = input.playlist?.trim() ? playlistId(input.playlist) : undefined;
    if (input.playlist?.trim() && !list) throw badRequest("That isn't a YouTube playlist link");
    const id = `mix:${slug(normaliseChannelName(name))}`;
    if (this.store.channel(id)) throw Object.assign(new Error(`There's already a channel called ${name}`), { statusCode: 409 });
    const style: MixChannel["style"] = input.style === "ambience" ? "ambience" : "music";
    const wanted = Number(input.number);
    const number = Number.isInteger(wanted) && wanted > 0 && !this.o.channels.byNumber(wanted) ? wanted : this.o.channels.freeNumber(390);
    const c: MixChannel = {
      id,
      name,
      number,
      brief: String(input.brief ?? "").trim().slice(0, 500),
      picks: cleanList(input.picks, 200),
      queries: cleanList(input.queries, 20),
      exclude: cleanList(input.exclude, 50),
      target: clamp(input.target, 5, 200, 30),
      minHeight: clamp(input.minHeight, 360, 2160, 720),
      maxHeight: clamp(input.maxHeight, 720, 4320, 2160),
      // Ambience clips are long on purpose, so they get a far higher ceiling than a music video.
      maxMinutes: clamp(input.maxMinutes, 3, style === "ambience" ? 240 : 30, style === "ambience" ? 90 : 10),
      style,
      enabled: input.enabled ?? true,
      curator: input.curator === "llm" ? "llm" : "search",
      colour: /^#[0-9a-f]{6}$/i.test(input.colour ?? "") ? input.colour! : PALETTE[this.store.channels().length % PALETTE.length]!,
      createdAt: now,
    };
    if (!searches(c) && !list) throw badRequest("Say what the channel should play, or give it a playlist");
    this.store.saveChannel(c);
    this.syncRow(c.id);
    if (searches(c)) this.queue({ kind: "curate", channelId: c.id });
    if (list) return { ...c, playlists: [this.followPlaylist(c.id, input.playlist!, now)] };
    this.changed(c.id);
    return c;
  }

  update(id: string, patch: Partial<MixChannel>): MixChannel {
    const c = this.store.channel(id);
    if (!c) throw notFound("That channel has been deleted");
    if (patch.name !== undefined) c.name = String(patch.name).trim().slice(0, 40) || c.name;
    if (patch.brief !== undefined) c.brief = String(patch.brief).trim().slice(0, 500);
    if (patch.picks !== undefined) c.picks = cleanList(patch.picks, 200);
    if (patch.queries !== undefined) c.queries = cleanList(patch.queries, 20);
    if (patch.exclude !== undefined) c.exclude = cleanList(patch.exclude, 50);
    if (patch.target !== undefined) c.target = clamp(patch.target, 5, 200, c.target);
    if (patch.minHeight !== undefined) c.minHeight = clamp(patch.minHeight, 360, 2160, c.minHeight);
    if (patch.maxHeight !== undefined) c.maxHeight = clamp(patch.maxHeight, 720, 4320, c.maxHeight);
    if (patch.style !== undefined) c.style = patch.style === "ambience" ? "ambience" : "music";
    if (patch.maxMinutes !== undefined) c.maxMinutes = clamp(patch.maxMinutes, 3, c.style === "ambience" ? 240 : 30, c.maxMinutes);
    if (patch.enabled !== undefined) c.enabled = Boolean(patch.enabled);
    if (patch.curator !== undefined) c.curator = patch.curator === "llm" ? "llm" : "search";
    if (patch.colour !== undefined && /^#[0-9a-f]{6}$/i.test(patch.colour)) c.colour = patch.colour;
    const lookAgain = patch.picks !== undefined || patch.queries !== undefined || patch.brief !== undefined || patch.target !== undefined;
    if (lookAgain) delete c.curatedAt;
    this.store.saveChannel(c);
    this.syncRow(id);
    if (lookAgain) this.queue({ kind: "curate", channelId: id });
    this.changed(id);
    return c;
  }

  async remove(id: string): Promise<void> {
    if (!this.store.channel(id)) throw notFound("That channel has been deleted");
    const videos = this.store.entries(id).map((e) => e.video.id);
    this.store.removeChannel(id);
    this.o.db.run("DELETE FROM kv WHERE key = ?", `mix-bag:${id}`);
    this.o.db.run("DELETE FROM kv WHERE key LIKE ?", `mix-playlist:${id}:%`);
    this.o.guide.dropFrom(id);
    this.o.channels.removeOwn(id);
    this.jobs = this.jobs.filter((j) => j.kind === "download" || j.channelId !== id);
    for (const v of videos) await this.dropIfOrphan(v);
    this.changed(id);
    this.o.events.emit({ type: "guide.updated" });
  }

  info(c: MixChannel): MixChannelInfo {
    const counts: Record<MixVideoStatus, number> = { queued: 0, downloading: 0, ready: 0, failed: 0 };
    let readyBytes = 0;
    for (const e of this.store.entries(c.id)) {
      counts[e.video.status]++;
      if (e.video.status === "ready") readyBytes += e.video.sizeBytes ?? 0;
    }
    const { playlists, ...rest } = c;
    const out: MixChannelInfo = { ...rest, counts, readyBytes, channelId: c.id, goal: this.goal(c) };
    if (playlists?.length) out.playlists = playlists.map((p) => this.playlistInfo(c.id, p));
    return out;
  }

  /** How many videos the channel should end up with: its target (if it searches) plus its playlists' videos. */
  private goal(c: MixChannel): number {
    let n = searches(c) ? c.target : 0;
    for (const id of this.fromPlaylists(c)) if (this.store.video(id)?.status !== "failed") n++;
    return n;
  }

  private playlistInfo(channelId: string, p: MixPlaylist): MixPlaylistInfo {
    const counts: Record<MixVideoStatus, number> = { queued: 0, downloading: 0, ready: 0, failed: 0 };
    const failures: MixPlaylistInfo["failures"] = [];
    let progress: number | undefined;
    for (const id of this.members(channelId, p.id)) {
      const v = this.store.video(id);
      if (!v) continue;
      counts[v.status]++;
      if (v.status === "downloading") progress = v.progress ?? 0;
      if (v.status === "failed" && failures.length < 20) failures.push({ title: displayTitle(v), error: v.error ?? "Couldn't download it" });
    }
    const key = `${channelId}:${p.id}`;
    const out: MixPlaylistInfo = { ...p, counts, failures, syncing: this.syncing === key || this.jobs.some((j) => j.kind === "playlist" && `${j.channelId}:${j.listId}` === key) };
    if (progress !== undefined) out.progress = progress;
    return out;
  }

  async overview(): Promise<MixOverview> {
    const ready = new Map<string, number>();
    for (const c of this.store.channels()) for (const e of this.store.entries(c.id)) if (e.video.status === "ready") ready.set(e.video.id, e.video.sizeBytes ?? 0);
    const out: MixOverview = {
      channels: this.store.channels().map((c) => this.info(c)),
      downloader: this.downloader,
      totals: { ready: ready.size, bytes: [...ready.values()].reduce((a, b) => a + b, 0) },
    };
    const working = [this.busy.curate, this.busy.download].filter(Boolean).join(" · ");
    if (working) out.working = working;
    try {
      const fs = await statfs(existsSync(this.dir) ? this.dir : path.dirname(this.dir));
      out.diskFreeBytes = fs.bavail * fs.bsize;
    } catch {
      // The NAS isn't mounted (development).
    }
    return out;
  }

  /** Writes the channel's row in the channel list, keeping the number and favourite the household gave it. */
  syncRow(id: string): void {
    const c = this.store.channel(id);
    if (!c) return;
    const ready = this.store.entries(id).filter((e) => e.video.status === "ready");
    const prev = this.o.channels.get(id);
    const row: Channel = {
      id,
      number: prev?.number ?? c.number,
      name: c.name,
      logo: `/api/mix-channels/${encodeURIComponent(id)}/logo.svg`,
      category: prev?.userCategory ?? "music",
      ...(prev?.userCategory ? { userCategory: prev.userCategory } : {}),
      feeds: [],
      favourite: prev?.favourite ?? false,
      hidden: !c.enabled,
      maxHeight: ready.length ? Math.max(...ready.map((e) => e.video.height)) : c.maxHeight,
      catchupDays: 0,
      mix: { ready: ready.length, target: this.goal(c) },
    };
    this.o.channels.putOwn(row);
  }

  /** Puts back any channel rows that are missing (the first start after an upgrade). */
  syncAll(): void {
    for (const c of this.store.channels()) this.syncRow(c.id);
  }

  // -------------------------------------------------------------------------
  // Videos

  /** Adds a video by URL or id ("added by hand", or an outside curator). */
  async addVideo(channelId: string, input: { url?: string; id?: string; origin?: string }): Promise<MixEntry> {
    const c = this.store.channel(channelId);
    if (!c) throw notFound("That channel has been deleted");
    const url = input.url?.trim() || (input.id ? `https://www.youtube.com/watch?v=${input.id.trim()}` : "");
    if (!/^https?:\/\//.test(url)) throw badRequest("Give a video link or id");
    if (playlistId(url) && !/[?&]v=|youtu\.be\/[\w-]/.test(url)) throw badRequest("That's a playlist link. Add it as a playlist instead, and every video in it is downloaded");
    const known = input.id ? this.store.video(input.id) : undefined;
    let video = known;
    if (!video) {
      if (!this.o.ytdlp) throw Object.assign(new Error("yt-dlp isn't installed on the Hub"), { statusCode: 503 });
      const info = await this.o.ytdlp.info(url);
      video = this.store.video(info.id) ?? this.newVideo(toCandidate(info, c));
    }
    this.addToChannel(c, video, String(input.origin ?? "added by hand").slice(0, 120));
    return { video: this.store.video(video.id)!, origin: input.origin ?? "added by hand", addedAt: Date.now() };
  }

  // -------------------------------------------------------------------------
  // Playlists

  /** Video ids a followed playlist put on the channel, in the playlist's order. */
  private members(channelId: string, listId: string): string[] {
    return this.o.db.getKv<string[]>(`mix-playlist:${channelId}:${listId}`) ?? [];
  }

  /** Every video on the channel that came from one of its playlists. */
  private fromPlaylists(c: MixChannel): Set<string> {
    return new Set((c.playlists ?? []).flatMap((p) => this.members(c.id, p.id)));
  }

  /**
   * Follows a YouTube playlist: it's read straight away (in the background) and every video in it
   * downloaded, then read again every six hours. A playlist the channel already follows is read
   * again now, and videos that failed get another go.
   */
  followPlaylist(channelId: string, url: string, now = Date.now()): MixPlaylist {
    const c = this.store.channel(channelId);
    if (!c) throw notFound("That channel has been deleted");
    const id = playlistId(url);
    if (!id) throw badRequest("That isn't a YouTube playlist link (it needs a list= in it)");
    if (!this.o.ytdlp && !this.o.demo) throw Object.assign(new Error("yt-dlp isn't installed on the Hub"), { statusCode: 503 });
    let p = c.playlists?.find((x) => x.id === id);
    if (!p) {
      if ((c.playlists?.length ?? 0) >= MAX_PLAYLISTS) throw badRequest(`A channel can follow up to ${MAX_PLAYLISTS} playlists`);
      p = { id, url: `https://www.youtube.com/playlist?list=${id}`, title: "YouTube playlist", addedAt: now };
      c.playlists = [...(c.playlists ?? []), p];
      this.store.saveChannel(c);
    }
    this.queue({ kind: "playlist", channelId, listId: id, retry: true }, true);
    this.changed(channelId);
    return p;
  }

  /** Stops following a playlist, taking its videos off the channel unless `keepVideos`. */
  async unfollowPlaylist(channelId: string, listId: string, keepVideos = false): Promise<void> {
    const c = this.store.channel(channelId);
    if (!c) throw notFound("That channel has been deleted");
    if (!c.playlists?.some((p) => p.id === listId)) throw notFound("The channel doesn't follow that playlist");
    const ids = this.members(channelId, listId);
    c.playlists = c.playlists.filter((p) => p.id !== listId);
    if (!c.playlists.length) delete c.playlists;
    this.store.saveChannel(c);
    this.o.db.run("DELETE FROM kv WHERE key = ?", `mix-playlist:${channelId}:${listId}`);
    this.jobs = this.jobs.filter((j) => j.kind !== "playlist" || j.channelId !== channelId || j.listId !== listId);
    if (!keepVideos) {
      const others = this.fromPlaylists(c);
      for (const id of ids) {
        if (others.has(id)) continue;
        this.store.removeEntry(channelId, id);
        await this.dropIfOrphan(id);
      }
      this.reshuffle(channelId);
      this.o.events.emit({ type: "guide.updated" });
    }
    this.syncRow(channelId);
    this.changed(channelId);
  }

  /** Reads one playlist again now. */
  syncSoon(channelId: string, listId: string): void {
    const c = this.store.channel(channelId);
    if (!c) throw notFound("That channel has been deleted");
    if (!c.playlists?.some((p) => p.id === listId)) throw notFound("The channel doesn't follow that playlist");
    this.queue({ kind: "playlist", channelId, listId, retry: true }, true);
    this.changed(channelId);
  }

  /** Playlists not read for six hours are read again. */
  queuePlaylistSyncs(now = Date.now()): void {
    for (const c of this.store.channels()) {
      if (!c.enabled) continue;
      for (const p of c.playlists ?? []) if (!p.syncedAt || now - p.syncedAt > RESYNC_AFTER) this.queue({ kind: "playlist", channelId: c.id, listId: p.id });
    }
  }

  /**
   * Reads a playlist and brings the channel in line with it: new videos are queued to download,
   * ones taken out of the playlist come off the channel (and off the NAS, unless another channel
   * has them). `retry` gives videos that failed to download another go.
   */
  async syncPlaylist(channelId: string, listId: string, retry = false, now = Date.now()): Promise<{ added: number; removed: number }> {
    const c = this.store.channel(channelId);
    const p = c?.playlists?.find((x) => x.id === listId);
    const yt = this.o.ytdlp;
    if (!c || !p || !yt) return { added: 0, removed: 0 };
    this.syncing = `${channelId}:${listId}`;
    this.busy.curate = `Reading the playlist ${p.title}`;
    this.changed(channelId);
    const save = (patch: Partial<MixPlaylist>, drop: (keyof MixPlaylist)[] = []) => {
      const fresh = this.store.channel(channelId);
      const i = fresh?.playlists?.findIndex((x) => x.id === listId) ?? -1;
      if (!fresh || i < 0) return;
      const next = { ...fresh.playlists![i]!, ...patch };
      for (const k of drop) delete next[k];
      fresh.playlists![i] = next;
      this.store.saveChannel(fresh);
    };
    let list: Playlist;
    try {
      list = await yt.playlist(p.url, MAX_PLAYLIST);
    } catch (err) {
      const message = (err as Error).message;
      save({ syncedAt: now, error: /private|not exist|unavailable|does not exist/i.test(message) ? `YouTube says: ${message}. Is the playlist public or unlisted?` : message.slice(0, 300) });
      this.o.log.warn({ channel: channelId, playlist: listId, err: message }, "Couldn't read a music channel playlist");
      this.syncing = undefined;
      this.changed(channelId);
      return { added: 0, removed: 0 };
    }
    const before = new Set(this.members(channelId, listId));
    const blocked = new Set(this.o.db.getKv<string[]>(`mix-blocked:${channelId}`) ?? []);
    const skipped = new Map<string, number>();
    const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
    const members: string[] = [];
    let added = 0;
    let order = 0;
    for (const item of list.items) {
      if (this.stopped) break;
      if (item.unavailable) {
        skip(item.unavailable);
        continue;
      }
      if (item.durationS > c.maxMinutes * 60) {
        skip(`longer than ${c.maxMinutes} min`);
        continue;
      }
      if (blocked.has(item.id)) {
        skip("taken off by hand");
        continue;
      }
      const onChannel = this.store.channelsOf(item.id).includes(channelId);
      // On the channel already from a search or by hand: it stays that, so leaving the playlist doesn't take it off.
      if (onChannel && !before.has(item.id)) {
        if (retry && this.store.video(item.id)?.status === "failed") this.requeue(item.id);
        continue;
      }
      let v = this.store.video(item.id);
      if (!v) {
        v = this.newVideo({ id: item.id, url: item.url, title: item.title, durationS: item.durationS, height: 0, score: 0, rejected: [], ...(item.uploader ? { uploader: item.uploader } : {}) });
        // Downloads go oldest first, so this keeps them in the playlist's order.
        v = { ...v, addedAt: now + order++ };
        this.store.saveVideo(v);
      }
      members.push(item.id);
      if (!onChannel) {
        this.addToChannel(c, v, `playlist: ${list.title}`);
        added++;
      } else if (retry && v.status === "failed") this.requeue(item.id);
    }
    this.o.db.setKv(`mix-playlist:${channelId}:${listId}`, members);
    // Taken out of the playlist on YouTube: off the channel too (unless another playlist has it).
    let removed = 0;
    const kept = new Set(members);
    const fresh = this.store.channel(channelId);
    const others = new Set((fresh?.playlists ?? []).filter((x) => x.id !== listId).flatMap((x) => this.members(channelId, x.id)));
    if (!this.stopped) {
      for (const id of before) {
        if (kept.has(id) || others.has(id)) continue;
        this.store.removeEntry(channelId, id);
        await this.dropIfOrphan(id);
        removed++;
      }
    }
    save({ title: list.title, syncedAt: now, total: list.items.length, skipped: [...skipped].map(([why, n]) => `${n} ${why}`) }, ["error"]);
    this.o.log.info({ channel: channelId, playlist: listId, added, removed, total: list.items.length }, "Music channel playlist read");
    this.syncing = undefined;
    if (removed) this.reshuffle(channelId);
    this.syncRow(channelId);
    this.changed(channelId);
    if (added || removed) this.o.events.emit({ type: "guide.updated" });
    return { added, removed };
  }

  /** A failed video gets another go. */
  private requeue(videoId: string): void {
    const v = this.store.video(videoId);
    if (!v || v.status !== "failed") return;
    const again: StoredVideo = { ...v, status: "queued" };
    delete again.error;
    delete again.stalls;
    this.store.saveVideo(again);
    this.queue({ kind: "download", videoId });
  }

  /** The NAS shares, or one folder in them, for picking files to link. */
  async browseNas(dir?: string) {
    return listNas(dir, await nasRoots(this.o.mediaRoot ?? "/mnt/nas"));
  }

  /**
   * Puts video files that are already on the NAS on a channel: each path is a file, or a folder
   * whose videos (and its subfolders') are all added. They're played from where they are, never
   * copied, moved or deleted.
   */
  async addFiles(channelId: string, paths: string[], origin = "from the NAS"): Promise<{ added: number; skipped: string[] }> {
    const c = this.store.channel(channelId);
    if (!c) throw notFound("That channel has been deleted");
    const roots = await nasRoots(this.o.mediaRoot ?? "/mnt/nas");
    const files: string[] = [];
    const skipped: string[] = [];
    for (const raw of paths.map((p) => p.trim()).filter(Boolean).slice(0, 50)) {
      const real = await insideRoots(raw, roots);
      if (!real) {
        skipped.push(`${raw}: not found on the NAS (${roots.join(", ") || "no shares mounted"})`);
        continue;
      }
      const st = await stat(real);
      if (st.isDirectory()) {
        const found = await videosIn(real);
        if (!found.length) skipped.push(`${raw}: no videos in that folder`);
        files.push(...found);
      } else if (isVideoFile(real)) files.push(real);
      else skipped.push(`${raw}: not a video file`);
    }
    if (!files.length && !skipped.length) throw badRequest("Give a file or folder on the NAS");
    let added = 0;
    const probe = this.o.probe ?? ffprobeVideo;
    for (const file of [...new Set(files)].slice(0, 500)) {
      const id = nasVideoId(file);
      let v = this.store.video(id);
      if (!v) {
        try {
          const got = await probe(file);
          const named = titleFromFile(file);
          v = { id, url: `file://${file}`, ...named, durationS: got.durationS, height: got.height, status: "ready", path: file, sizeBytes: (await stat(file)).size, addedAt: Date.now(), source: "nas" };
          if (got.fps) v.fps = got.fps;
          if (!got.durationS) throw new Error("couldn't tell how long it is");
          this.store.saveVideo(v);
        } catch (err) {
          skipped.push(`${path.basename(file)}: ${(err as Error).message}`);
          continue;
        }
      }
      if (this.store.addEntry(c.id, id, origin)) added++;
    }
    if (added) {
      // A file taken off the channel before can come back when it's asked for by hand.
      const blocked = new Set(this.o.db.getKv<string[]>(`mix-blocked:${channelId}`) ?? []);
      for (const f of files) blocked.delete(nasVideoId(f));
      this.o.db.setKv(`mix-blocked:${channelId}`, [...blocked]);
      this.reshuffle(c.id);
      this.syncRow(c.id);
      this.changed(c.id);
      this.o.events.emit({ type: "guide.updated" });
      void this.findBars();
    }
    return { added, skipped };
  }

  async removeVideo(channelId: string, videoId: string): Promise<void> {
    this.store.removeEntry(channelId, videoId);
    // Not found again by the next curation.
    const c = this.store.channel(channelId);
    if (c) {
      const blocked = new Set(this.o.db.getKv<string[]>(`mix-blocked:${channelId}`) ?? []);
      blocked.add(videoId);
      this.o.db.setKv(`mix-blocked:${channelId}`, [...blocked]);
    }
    this.reshuffle(channelId);
    this.syncRow(channelId);
    await this.dropIfOrphan(videoId);
    this.changed(channelId);
  }

  /** Searches for candidates without adding them, judged against a channel's rules when given one. */
  async search(query: string, channelId?: string, limit = 10): Promise<MixCandidate[]> {
    if (!this.o.ytdlp) throw Object.assign(new Error("yt-dlp isn't installed on the Hub"), { statusCode: 503 });
    const q = query.trim();
    if (!q) throw badRequest("Search for something");
    const c = channelId ? this.store.channel(channelId) : undefined;
    const rules = c ?? { minHeight: 720, maxMinutes: 10, exclude: [], style: "music" as const };
    return (await this.o.ytdlp.search(q, limit)).map((i) => toCandidate(i, rules)).sort((a, b) => b.score - a.score);
  }

  private newVideo(cand: MixCandidate): StoredVideo {
    const v: StoredVideo = { id: cand.id, url: cand.url, title: cand.title, durationS: cand.durationS, height: cand.height, status: "queued", addedAt: Date.now() };
    if (cand.artist) v.artist = cand.artist;
    if (cand.track) v.track = cand.track;
    if (cand.uploader) v.uploader = cand.uploader;
    this.store.saveVideo(v);
    return v;
  }

  private addToChannel(c: MixChannel, v: StoredVideo, origin: string): void {
    if (!this.store.addEntry(c.id, v.id, origin)) return;
    if (v.status === "ready") {
      this.reshuffle(c.id);
      this.syncRow(c.id);
    } else if (v.status === "failed") {
      // Asked for by hand: try it again.
      this.store.saveVideo({ ...v, status: "queued" });
    }
    this.queue({ kind: "download", videoId: v.id });
    this.changed(c.id);
  }

  private async dropIfOrphan(videoId: string): Promise<void> {
    if (this.store.channelsOf(videoId).length) return;
    const v = this.store.video(videoId);
    this.store.removeVideo(videoId);
    if (this.o.demo) return;
    // A file linked from the NAS is the household's own: only its still goes.
    for (const f of [v?.source === "nas" ? undefined : v?.path, v?.thumbPath]) if (f && f.startsWith(this.dir)) await rm(f, { force: true }).catch(() => undefined);
  }

  filePath(videoId: string): string | undefined {
    return this.store.video(videoId)?.path;
  }

  /** Every music video file the channels play, with its still: what a trip takes along. */
  travelFiles(): string[] {
    return this.store.videosWithStatus("ready").flatMap((v) => [v.path, v.thumbPath].filter((f): f is string => Boolean(f)));
  }

  thumbPath(videoId: string): string | undefined {
    return this.store.video(videoId)?.thumbPath;
  }

  // -------------------------------------------------------------------------
  // Schedule

  private readyDurations(channelId: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of this.store.entries(channelId)) if (e.video.status === "ready" && e.video.durationS > 0) m.set(e.video.id, e.video.durationS * 1000);
    return m;
  }

  /** Makes sure the guide has the next two days of this channel. */
  extend(channelId: string, now = Date.now()): void {
    const c = this.store.channel(channelId);
    if (!c) return;
    const durations = this.readyDurations(channelId);
    if (!durations.size) return;
    const last = this.o.guide.latestOn(channelId);
    if (last && last.end - now > TOP_UP_BELOW) return;
    const from = last && last.end > now ? last.end : now;
    const state = this.o.db.getKv<BagState>(`mix-bag:${channelId}`) ?? { bag: [], loop: [] };
    const { slots, state: next } = planSlots(from, now + PLAN_AHEAD, durations, state, last?.videoId, this.rand);
    const byId = new Map(this.store.entries(channelId).map((e) => [e.video.id, e.video]));
    this.o.guide.upsert(slots.map((s) => this.programme(c, byId.get(s.videoId)!, s)));
    this.o.db.setKv(`mix-bag:${channelId}`, next);
  }

  /** Starts a fresh pass after whatever is on now, e.g. when videos are added or removed. */
  reshuffle(channelId: string, now = Date.now()): void {
    const onNow = this.o.guide.nowNext(channelId, now).now;
    this.o.guide.dropFrom(channelId, onNow ? onNow.start : now);
    if (onNow && !this.readyDurations(channelId).has(onNow.videoId ?? "")) this.o.guide.dropFrom(channelId, onNow.start - 1);
    // The pass in progress becomes what's on now plus every other video, freshly shuffled.
    const kept = this.o.guide.nowNext(channelId, now).now?.videoId;
    const rest = shuffle([...this.readyDurations(channelId).keys()].filter((id) => id !== kept), this.rand);
    this.o.db.setKv(`mix-bag:${channelId}`, { bag: rest, loop: kept ? [kept, ...rest] : rest });
    this.extend(channelId, now);
  }

  extendAll(now = Date.now()): void {
    for (const c of this.store.channels()) this.extend(c.id, now);
  }

  private programme(c: MixChannel, v: StoredVideo, s: Slot): Programme {
    const p: Programme = {
      id: `${c.id}:${s.start}`,
      channelId: c.id,
      start: s.start,
      end: s.end,
      title: displayTitle(v),
      description: [v.artist && v.track ? v.title : undefined, `${v.height >= 2160 ? "4K" : v.height >= 1080 ? "HD 1080p" : `${v.height}p`} music video on ${c.name}.`].filter(Boolean).join(" · "),
      categories: ["Music"],
      isNew: false,
      isRepeat: false,
      isFilm: false,
      videoId: v.id,
    };
    if (v.thumbPath || this.o.demo) p.image = `/api/mix/videos/${encodeURIComponent(v.id)}/thumb.jpg`;
    return p;
  }

  /** What the TV plays when tuned to this channel: the video on now from where it has got to, then the rest. */
  tuneIn(channelId: string, now = Date.now()): { first: { videoId: string; offsetMs: number; programme: Programme }; queue: string[]; titles: string[]; crops: string[] } | null {
    this.extend(channelId, now);
    const upcoming = this.o.guide.onChannel(channelId, now, 200).filter((p) => p.start < now + QUEUE_AHEAD);
    const playable = upcoming.filter((p) => {
      const v = p.videoId ? this.store.video(p.videoId) : undefined;
      return v?.status === "ready" && v.path && (this.o.demo || existsSync(v.path));
    });
    const [first, ...rest] = playable;
    if (!first?.videoId) return null;
    const offsetMs = Math.max(0, now - first.start);
    return { first: { videoId: first.videoId, offsetMs, programme: first }, queue: rest.map((p) => p.videoId!), titles: playable.map((p) => p.title), crops: playable.map((p) => this.store.video(p.videoId!)?.crop ?? "") };
  }

  // -------------------------------------------------------------------------
  // The work loop: curation and downloads, one at a time.

  async start(): Promise<void> {
    this.syncAll();
    if (this.o.ytdlp) {
      await this.checkDownloader();
      void this.o.ytdlp
        .update()
        .then((msg) => this.o.log.info({ msg }, "yt-dlp update"))
        .catch(() => undefined);
      this.timers.push(setInterval(() => void this.o.ytdlp?.update().catch(() => undefined), 24 * HOUR));
    }
    // Downloads cut off by a restart start again.
    for (const v of this.store.videosWithStatus("downloading")) this.store.saveVideo({ ...v, status: "queued" });
    this.extendAll();
    this.timers.push(setInterval(() => this.extendAll(), 30 * 60_000));
    this.timers.push(
      setInterval(() => {
        this.queueCurations();
        this.queuePlaylistSyncs();
      }, 6 * HOUR),
    );
    // After a restart (an update, say) channels short of videos look again straight away.
    this.queueCurations(Date.now(), true);
    this.queuePlaylistSyncs();
    this.running = true;
    // Two lanes, so a long curation (or a restart part-way through one) never holds up the
    // downloads of the videos already chosen: one search and one download at a time.
    void this.loop("curate");
    void this.loop("download");
    void this.findBars();
  }

  /** Checks videos downloaded before bar detection existed, one at a time. */
  private findingBars = false;

  /** Also gives files linked from the NAS a still for the guide. */
  private async findBars(): Promise<void> {
    if (this.findingBars) return;
    this.findingBars = true;
    try {
      for (let again = true; again && !this.stopped; ) {
        again = false;
        for (const v of this.store.videosWithStatus("ready")) {
          if (this.stopped) return;
          if (!v.path || this.o.demo || !existsSync(v.path)) continue;
          const patch: Partial<StoredVideo> = {};
          if (v.crop === undefined) patch.crop = await this.barsOf(v.path);
          if (v.source === "nas" && !v.thumbPath) {
            const still = path.join(this.dir, `${v.id}.jpg`);
            await mkdir(this.dir, { recursive: true }).catch(() => undefined);
            if (await grabStill(v.path, v.durationS / 3, still)) patch.thumbPath = still;
            else patch.thumbPath = "";
          }
          if (!Object.keys(patch).length) continue;
          again = true;
          const now = this.store.video(v.id);
          if (now?.status === "ready") this.store.saveVideo({ ...now, ...patch });
        }
      }
    } catch (err) {
      // The Hub is shutting down.
      this.o.log.debug({ err: String(err) }, "Music video checks stopped");
    } finally {
      this.findingBars = false;
    }
  }

  private barsOf(file: string): Promise<string> {
    if (this.o.demo) return Promise.resolve("");
    return (this.o.cropDetect ?? ffmpegCropDetect)(file).catch(() => "");
  }

  stop(): void {
    this.running = false;
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.abort?.abort();
    this.wakeAll();
  }

  async checkDownloader(): Promise<MixOverview["downloader"]> {
    if (!this.o.ytdlp) return (this.downloader = { ok: false, error: "yt-dlp isn't installed on the Hub" });
    try {
      this.downloader = { ok: true, version: await this.o.ytdlp.version() };
    } catch (err) {
      this.downloader = { ok: false, error: `yt-dlp isn't working: ${(err as Error).message}` };
    }
    return this.downloader;
  }

  /** Channels short of videos, and not looked at for a day (or at all, with `any`), get curated. */
  queueCurations(now = Date.now(), any = false): void {
    for (const c of this.store.channels()) {
      if (!c.enabled || !searches(c)) continue;
      const listed = this.fromPlaylists(c);
      const have = this.store.entries(c.id).filter((e) => e.video.status !== "failed" && !listed.has(e.video.id)).length;
      if (have < c.target && (any || !c.curatedAt || now - c.curatedAt > RECURATE_AFTER)) this.queue({ kind: "curate", channelId: c.id });
    }
  }

  /** Asks for a channel to be filled up now. */
  curateSoon(channelId: string): void {
    if (!this.store.channel(channelId)) throw notFound("That channel has been deleted");
    this.queue({ kind: "curate", channelId }, true);
  }

  private queue(job: Job, first = false): void {
    const i = this.jobs.findIndex((j) => jobKey(j) === jobKey(job));
    if (i >= 0) {
      // Asked for again: keep the stronger request (a retry), and move it up when asked to.
      const had = this.jobs[i]!;
      if (job.kind === "playlist" && had.kind === "playlist" && job.retry) had.retry = true;
      if (!first) return this.wakeAll();
      this.jobs.splice(i, 1);
      job = had;
    }
    first ? this.jobs.unshift(job) : this.jobs.push(job);
    this.wakeAll();
  }

  private wakeAll(): void {
    for (const w of [...this.wakers]) w();
  }

  private nextJob(kind: Lane): Job | undefined {
    if (kind === "curate") {
      // Playlists and curations share a lane: both read YouTube's listings, one at a time.
      const curate = this.jobs.findIndex((j) => laneOf(j) === "curate");
      return curate >= 0 ? this.jobs.splice(curate, 1)[0] : undefined;
    }
    // Downloads, oldest first, straight from the store (so none is lost to a restart).
    this.jobs = this.jobs.filter((j) => j.kind !== "download");
    const queued = this.store.videosWithStatus("queued").filter((v) => this.store.channelsOf(v.id).length).sort((a, b) => a.addedAt - b.addedAt);
    return queued[0] ? { kind: "download", videoId: queued[0].id } : undefined;
  }

  private async loop(kind: Lane): Promise<void> {
    while (this.running) {
      const job = this.downloader.ok ? this.nextJob(kind) : undefined;
      if (!job) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(t);
            this.wakers.delete(done);
            resolve();
          };
          const t = setTimeout(done, 60_000);
          this.wakers.add(done);
        });
        if (kind === "download" && !this.downloader.ok && this.o.ytdlp) await this.checkDownloader();
        continue;
      }
      try {
        await this.run(job);
      } catch (err) {
        this.o.log.warn({ job, err: String(err) }, "Music channel job failed");
      } finally {
        this.busy[kind] = undefined;
        if (kind === "curate") this.syncing = undefined;
      }
      await new Promise((r) => setTimeout(r, this.o.pauseMs ?? 4000));
    }
  }

  /** Runs one job now. Public so tests (and the API) can drive it without the loop. */
  async run(job: Job): Promise<void> {
    if (job.kind === "curate") await this.curate(job.channelId);
    else if (job.kind === "playlist") await this.syncPlaylist(job.channelId, job.listId, job.retry);
    else await this.download(job.videoId);
  }

  /** Fills a channel up to its target from its curator's picks and searches. */
  async curate(channelId: string, now = Date.now()): Promise<number> {
    const c = this.store.channel(channelId);
    const yt = this.o.ytdlp;
    if (!c || !yt || !searches(c)) return 0;
    const entries = this.store.entries(channelId);
    // Playlist videos come on top of the target.
    const listed = this.fromPlaylists(c);
    let need = c.target - entries.filter((e) => e.video.status !== "failed" && !listed.has(e.video.id)).length;
    if (need <= 0) return 0;
    this.busy.curate = `Choosing videos for ${c.name}`;
    const plan = await this.curators[c.curator].plan(c, entries);
    const tried = new Set(this.o.db.getKv<string[]>(`mix-tried:${channelId}`) ?? []);
    const blocked = new Set(this.o.db.getKv<string[]>(`mix-blocked:${channelId}`) ?? []);
    const titles = entries.map((e) => displayTitle(e.video));
    // Two uploads of the same song are a duplicate; two haunted houses are not, so an ambience
    // channel is only deduped by title.
    const songs = new Set(c.style === "ambience" ? [] : entries.filter((e) => e.video.status !== "failed").map((e) => songKey(e.video)).filter(Boolean));
    let added = 0;
    const usable = (cand: MixCandidate) => {
      if (cand.rejected.length || blocked.has(cand.id)) return false;
      const known = this.store.video(cand.id);
      if (known?.status === "failed" || entries.some((e) => e.video.id === cand.id)) return false;
      // Another upload of a song the channel already has.
      const key = songKey(cand);
      if (key && songs.has(key)) return false;
      const t = displayTitle(cand);
      return !titles.some((have) => overlap(have, { title: t }) >= 0.85 && overlap(t, { title: have }) >= 0.85);
    };
    const take = (cand: MixCandidate, origin: string) => {
      const v = this.store.video(cand.id) ?? this.newVideo(cand);
      this.addToChannel(c, v, origin);
      titles.push(displayTitle(cand));
      const key = songKey(cand);
      if (key) songs.add(key);
      entries.push({ video: v, origin, addedAt: now });
      need--;
      added++;
    };
    let failures = 0;
    const searchFor = async (q: string, n: number, offset = 0): Promise<YtInfo[]> => {
      try {
        const r = await yt.search(q, n, offset);
        failures = 0;
        return r;
      } catch (err) {
        failures++;
        this.o.log.warn({ query: q, err: String(err) }, "Music video search failed");
        return [];
      }
    };
    for (const pick of plan.picks) {
      if (need <= 0 || this.stopped) break;
      if (tried.has(`pick:${pick}`)) continue;
      if (failures >= 3) break;
      this.busy.curate = `Looking for ${pick}`;
      const best = (await searchFor(c.style === "ambience" ? pick : `${pick} official video`, 5))
        .map((i) => toCandidate(i, c, pick))
        .filter(usable)
        .sort((a, b) => b.score - a.score)[0];
      if (best) take(best, `pick: ${pick}`);
      tried.add(`pick:${pick}`);
      this.o.db.setKv(`mix-tried:${channelId}`, [...tried]);
      await new Promise((r) => setTimeout(r, Math.min(this.o.pauseMs ?? 2000, 2000)));
    }
    // Each search carries on further down YouTube's results where the last pass stopped, so a
    // channel with only a search or two still fills up over a few passes.
    let depth = this.o.db.getKv<Record<string, number>>(`mix-depth:${channelId}`) ?? {};
    // Every search has been read to the end: start again from the top (YouTube's results change).
    if (plan.queries.length && plan.queries.every((q) => (depth[q] ?? 0) >= SEARCH_DEPTH)) depth = {};
    for (const q of plan.queries) {
      for (let pages = 0; pages < SEARCH_PAGES_PER_PASS; pages++) {
        if (need <= 0 || failures >= 3 || this.stopped) break;
        const offset = depth[q] ?? 0;
        if (offset >= SEARCH_DEPTH) break;
        this.busy.curate = `Searching for ${q}${offset ? ` (results ${offset + 1}–${offset + SEARCH_PAGE})` : ""}`;
        const got = await searchFor(q, SEARCH_PAGE, offset);
        if (!got.length) break;
        const found = got.map((i) => toCandidate(i, c)).filter(usable).sort((a, b) => b.score - a.score);
        for (const cand of found) {
          if (need <= 0) break;
          if (usable(cand)) take(cand, `search: ${q}`);
        }
        // Only move on once this page has nothing left to give.
        if (need > 0) {
          depth[q] = offset + SEARCH_PAGE;
          this.o.db.setKv(`mix-depth:${channelId}`, depth);
        }
      }
    }
    const fresh = this.store.channel(channelId);
    if (fresh) {
      fresh.curatedAt = now;
      if (need > 0) fresh.error = failures >= 3 ? "YouTube searches are failing. yt-dlp may need updating." : `Found ${c.target - need} of ${c.target}. Add more tracks or searches to fill it.`;
      else delete fresh.error;
      this.store.saveChannel(fresh);
    }
    this.changed(channelId);
    // Still short but getting somewhere: carry on down the search results after the queued downloads.
    if (need > 0 && added > 0 && failures < 3 && !this.stopped) this.queue({ kind: "curate", channelId });
    return added;
  }

  /** Downloads one video and puts it into the schedules of the channels that have it. */
  async download(videoId: string): Promise<void> {
    const v = this.store.video(videoId);
    const yt = this.o.ytdlp;
    if (!v || v.status === "ready" || !yt) return;
    const channelIds = this.store.channelsOf(videoId);
    if (!channelIds.length) return;
    const channels = channelIds.map((id) => this.store.channel(id)).filter((c): c is MixChannel => c !== undefined);
    // The strictest channel's smallest size and the most generous one's largest.
    const size = { minHeight: Math.min(...channels.map((c) => c.minHeight)), maxHeight: Math.max(...channels.map((c) => c.maxHeight)) };
    await mkdir(this.dir, { recursive: true });
    try {
      const fs = await statfs(this.dir);
      if (fs.bavail * fs.bsize < (this.o.minFreeBytes ?? MIN_FREE_BYTES)) {
        this.downloader = { ...this.downloader, ok: false, error: "The NAS is nearly full, so music videos have stopped downloading" };
        this.store.saveVideo({ ...v, status: "queued" });
        return;
      }
    } catch {
      // statfs not supported: carry on.
    }
    this.busy.download = `Downloading ${displayTitle(v)}`;
    this.store.saveVideo({ ...v, status: "downloading", progress: 0 });
    this.changed(channelIds[0]);
    this.abort = new AbortController();
    let lastSave = 0;
    try {
      const got = await yt.download(
        v.url,
        v.id,
        this.dir,
        size,
        (f) => {
          if (Date.now() - lastSave < 3000) return;
          lastSave = Date.now();
          this.store.saveVideo({ ...this.store.video(videoId)!, progress: Math.round(f * 100) / 100 });
        },
        this.abort.signal,
      );
      const thumb = path.join(this.dir, `${v.id}.jpg`);
      const ready: StoredVideo = { ...v, status: "ready", path: got.path, height: got.height || v.height, sizeBytes: (await stat(got.path).catch(() => null))?.size ?? 0 };
      delete ready.progress;
      delete ready.error;
      if (got.fps) ready.fps = got.fps;
      if (got.durationS) ready.durationS = Math.round(got.durationS);
      if (existsSync(thumb)) ready.thumbPath = thumb;
      ready.crop = await this.barsOf(got.path);
      this.store.saveVideo(ready);
      this.o.log.info({ video: v.id, title: v.title, height: ready.height }, "Music video downloaded");
    } catch (err) {
      const message = (err as Error).message;
      // A hung download gets one more go before the video counts as failed.
      if (message.startsWith("The download stalled") && !v.stalls) {
        const again: StoredVideo = { ...v, status: "queued", stalls: 1 };
        delete again.progress;
        this.store.saveVideo(again);
        this.o.log.warn({ video: v.id, title: v.title }, "Music video download stalled; trying again");
        this.changed(channelIds[0]);
        return;
      }
      const failed: StoredVideo = { ...v, status: "failed", error: message.slice(0, 300) };
      delete failed.progress;
      this.store.saveVideo(failed);
      this.o.log.warn({ video: v.id, err: failed.error }, "Music video download failed");
      // Fill the gap from the channel's list.
      for (const id of channelIds) this.queue({ kind: "curate", channelId: id });
    } finally {
      this.abort = null;
    }
    for (const id of channelIds) {
      if (this.store.video(videoId)?.status === "ready") this.reshuffle(id);
      this.syncRow(id);
      this.changed(id);
    }
    this.o.events.emit({ type: "guide.updated" });
  }

  private changed(channelId?: string): void {
    this.o.events.emit(channelId ? { type: "mix.changed", channelId } : { type: "mix.changed" });
  }
}

const PALETTE = ["#e0218a", "#1f8ef1", "#f07b16", "#11b67a", "#8a4dff", "#e5b700", "#e2283c", "#16a9c7"];

function cleanList(list: unknown, max: number): string[] {
  if (list === undefined) return [];
  const arr = Array.isArray(list) ? list : String(list).split(/\n|;/);
  return [...new Set(arr.map((x) => String(x).trim().slice(0, 200)).filter(Boolean))].slice(0, max);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** A simple logo for the guide: the channel's name on its colour. */
export function mixLogo(name: string, colour: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const words = name.replace(/\s+TV$/i, "").toUpperCase();
  const size = words.length > 10 ? 30 : words.length > 7 ? 38 : 46;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 135"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colour}"/><stop offset="1" stop-color="#14101f"/></linearGradient></defs><rect width="240" height="135" rx="18" fill="url(#g)"/><text x="120" y="${size > 40 ? 78 : 76}" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="${size}" fill="#fff" text-anchor="middle">${esc(words)}</text><text x="120" y="112" font-family="Inter, Arial, sans-serif" font-weight="600" font-size="18" letter-spacing="6" fill="#ffffffb0" text-anchor="middle">${/\bTV$/i.test(name) ? "TV" : "MUSIC"}</text></svg>`;
}
