/**
 * The snapshot the Hub hands a TV box for Limited mode (#78).
 *
 * A box with no Hub can't call /api/channels or /api/live: the channel URLs it is given are the
 * Hub's own relay, which is exactly the thing that is down. So this module builds the box its own
 * copy of what it needs — the first feed URL of every channel, a week of guide, the profiles with
 * their Kids rules, and the Jellyfin connection — which the box keeps on disk (GET
 * /api/box/offline) and plays straight from.
 *
 * The shape and the trimming rules live in @ultimatetv/shared (`LimitedSnapshot`), so the box reads
 * back exactly what is written here and applies the same Kids rules on its own.
 */
import { type Channel, type KidsAllowList, LIMITED_GUIDE_BACK_MS, LIMITED_GUIDE_DAYS, type LimitedChannel, type LimitedJellyfinTitle, type LimitedProfile, type LimitedSnapshot, type Profile, type Programme } from "@ultimatetv/shared";
import { IPTV_USER_AGENT } from "./http.js";
import type { JellyfinClient, JfItem } from "./services/jellyfin.js";

const DAY_MS = 24 * 60 * 60_000;

/** How far back the box's guide starts: an hour, so a programme that just began is still listed. */
export const OFFLINE_GUIDE_BACK_MS = LIMITED_GUIDE_BACK_MS;
/** How far ahead the box's guide goes: the week the issue asks for. */
export const OFFLINE_GUIDE_DAYS = LIMITED_GUIDE_DAYS;

/** The programme fields a grid draws, and no more: the guide is the biggest thing in the file. */
function slimProgramme(p: Programme): LimitedSnapshot["guide"]["programmes"][string][number] {
  return {
    id: p.id,
    channelId: p.channelId,
    start: p.start,
    end: p.end,
    title: p.title,
    ...(p.subtitle ? { subtitle: p.subtitle } : {}),
    ...(p.image ? { image: p.image } : {}),
    categories: p.categories,
    isNew: p.isNew,
    isRepeat: p.isRepeat,
    isFilm: p.isFilm,
  };
}

export interface BuildLimitedSnapshotOptions {
  now: number;
  /** Channels as the Hub lists them, hidden ones included: they are dropped here. */
  channels: Channel[];
  /** The channel's feeds in priority order: the first is the one the box plays. */
  feedsFor: (channelId: string) => { url: string }[];
  guideWindow: (channelIds: string[], from: number, to: number) => Record<string, Programme[]>;
  profiles: { profile: Profile; allow?: KidsAllowList }[];
  /** Jellyfin, when the household has it: the box then plays straight from the server. */
  jellyfin?: { url: string; serverName?: string; userId: string; token: string; items: LimitedJellyfinTitle[] };
}

/**
 * Builds what one box keeps for Limited mode. The caller decides the reference time; the guide is
 * cut to `now - 1h … now + 7d` here, so the file can't grow past a week however long the Hub runs.
 */
export function buildLimitedSnapshot(options: BuildLimitedSnapshotOptions): LimitedSnapshot {
  const { now } = options;
  const from = now - OFFLINE_GUIDE_BACK_MS;
  const to = now + OFFLINE_GUIDE_DAYS * DAY_MS;

  const listed = options.channels.filter((c) => !c.hidden);
  const channels: LimitedChannel[] = listed.map((c) => {
    const feed = options.feedsFor(c.id)[0];
    return {
      id: c.id,
      number: c.number,
      name: c.name,
      ...(c.logo ? { logo: c.logo } : {}),
      category: c.category,
      ...(c.userCategory ? { userCategory: c.userCategory } : {}),
      // No feed means the channel exists in the guide but there is nothing to play: the box shows it
      // greyed out rather than pretending it can tune it.
      ...(feed ? { url: feed.url, headers: { "User-Agent": IPTV_USER_AGENT } } : {}),
    };
  });

  const window = options.guideWindow(listed.map((c) => c.id), from, to);
  const programmes: Record<string, ReturnType<typeof slimProgramme>[]> = {};
  for (const channel of channels) {
    const rows = (window[channel.id] ?? [])
      .filter((p) => p.end > from && p.start < to)
      .sort((a, b) => a.start - b.start)
      .map(slimProgramme);
    if (rows.length) programmes[channel.id] = rows;
  }

  const profiles: LimitedProfile[] = options.profiles.map(({ profile, allow }) => ({
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    maxCertification: profile.maxCertification,
    channelCategories: profile.channelCategories,
    allowedChannels: profile.allowedChannels,
    ...(allow && (allow.allow.length || allow.block.length) ? { allow } : {}),
  }));

  return { at: now, channels, guide: { from, to, programmes }, profiles, ...(options.jellyfin ? { jellyfin: options.jellyfin } : {}) };
}

/**
 * The films and episodes a box keeps to play straight from Jellyfin: what to show, where it got to,
 * and enough to report progress back when the Hub returns. Filtered for Kids later, on the box.
 */
export function jellyfinOfflineItems(client: JellyfinClient, items: JfItem[]): LimitedJellyfinTitle[] {
  const out: LimitedJellyfinTitle[] = [];
  for (const item of items) {
    if (!item.Id) continue;
    const ref = client.toTitleRef(item);
    const positionMs = item.UserData?.PlaybackPositionTicks ? Math.round(item.UserData.PlaybackPositionTicks / 10_000) : undefined;
    const runtimeMs = item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000) : undefined;
    const source = item.MediaSources?.find((m) => m.Id);
    out.push({
      id: item.Id,
      refId: ref.id,
      kind: ref.kind === "series" ? "series" : "movie",
      name: ref.name,
      ...(ref.subtitle ? { subtitle: ref.subtitle } : {}),
      ...(ref.poster ? { poster: ref.poster } : {}),
      ...(ref.backdrop ? { backdrop: ref.backdrop } : {}),
      ...(positionMs !== undefined && positionMs > 0 ? { positionMs } : {}),
      ...(runtimeMs !== undefined && runtimeMs > 0 ? { runtimeMs } : {}),
      ...(ref.genres?.length ? { genres: ref.genres } : {}),
      ...(ref.certification ? { certification: ref.certification } : {}),
      ...(source?.Id ? { sourceId: source.Id } : {}),
    });
  }
  return out;
}
