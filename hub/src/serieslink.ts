// Series link planning. Pure functions: given the links, the guide and what's already recorded,
// decide which airings to record and how, within the IPTV connection limit.
//
// With one connection the order of preference is (plan §5.3):
//   1. record from catch-up after the programme airs (no live connection needed),
//   2. share the stream when the TV is on the same channel (handled live by the relay),
//   3. use another airing (a repeat or +1) that doesn't clash,
//   4. otherwise report the clash so the planner can ask, Sky-style.

import type { Channel, Conflict, Programme, Recording, RecordingMethod, SeriesLink } from "@ultimatetv/shared";

export interface PlanInput {
  links: SeriesLink[];
  /** Upcoming programmes for the links' series keys (any channel). */
  airings: Programme[];
  recordings: Recording[];
  channels: Map<string, Channel>;
  connectionLimit: number;
  preferCatchup: boolean;
  now: number;
}

export interface PlannedRecording {
  programme: Programme;
  link: SeriesLink;
  method: RecordingMethod;
  start: number;
  end: number;
}

export interface Plan {
  add: PlannedRecording[];
}

const ACTIVE: Recording["status"][] = ["scheduled", "waiting-catchup", "recording", "processing", "completed"];

export function episodeKeyOf(p: Programme): string {
  return p.episodeKey ?? `prog:${p.id}`;
}

export function recordingWindow(p: Programme, before: number, after: number): { start: number; end: number } {
  return { start: p.start - before * 60_000, end: p.end + after * 60_000 };
}

export function methodFor(p: Programme, channel: Channel | undefined, preferCatchup: boolean, now: number): RecordingMethod {
  // Catch-up needs the archive to still hold the programme when we fetch it; keep a day's margin.
  if (preferCatchup && channel && channel.catchupDays >= 1 && p.end > now - (channel.catchupDays - 1) * 86_400_000) return "catchup";
  return "live";
}

function matchesLink(p: Programme, link: SeriesLink): boolean {
  if (p.seriesKey !== link.seriesKey) return false;
  if (link.scope === "this" && p.channelId !== link.channelId) return false;
  if (link.newOnly && p.isRepeat && !p.isNew) return false;
  return true;
}

/** Preference among airings of one episode: the link's own channel, higher quality, then earliest. */
function airingScore(p: Programme, link: SeriesLink, channels: Map<string, Channel>): number {
  const c = channels.get(p.channelId);
  let score = 0;
  if (p.channelId === link.channelId) score += 100;
  if (c) score += c.maxHeight >= 1080 ? 20 : c.maxHeight >= 720 ? 10 : 0;
  if (c && /\+ ?1\b/.test(c.name)) score -= 30;
  return score;
}

export function planSeriesLinks(input: PlanInput): Plan {
  const recorded = new Set<string>();
  const occupied: { start: number; end: number; key: string }[] = [];
  for (const r of input.recordings) {
    if (!ACTIVE.includes(r.status)) continue;
    recorded.add(episodeKeyOf(r.programme));
    if (r.method === "live" && (r.status === "scheduled" || r.status === "recording") && r.end > input.now) {
      occupied.push({ start: r.start, end: r.end, key: r.id });
    }
  }

  const add: PlannedRecording[] = [];
  const unplaced: { episode: Programme[]; link: SeriesLink }[] = [];

  for (const link of input.links) {
    const byEpisode = new Map<string, Programme[]>();
    for (const p of input.airings) {
      if (p.end <= input.now || !matchesLink(p, link)) continue;
      const key = episodeKeyOf(p);
      if (recorded.has(key)) continue;
      const list = byEpisode.get(key) ?? [];
      list.push(p);
      byEpisode.set(key, list);
    }

    for (const [key, options] of byEpisode) {
      const ranked = [...options].sort((a, b) => airingScore(b, link, input.channels) - airingScore(a, link, input.channels) || a.start - b.start);
      let placed: PlannedRecording | null = null;
      for (const p of ranked) {
        const channel = input.channels.get(p.channelId);
        const method = methodFor(p, channel, input.preferCatchup, input.now);
        const window = recordingWindow(p, link.paddingBeforeMin, link.paddingAfterMin);
        if (method === "catchup" || fits(occupied, window, input.connectionLimit)) {
          placed = { programme: p, link, method, ...window };
          break;
        }
      }
      if (placed) {
        if (placed.method === "live") occupied.push({ start: placed.start, end: placed.end, key: placed.programme.id });
        recorded.add(key);
        add.push(placed);
      } else {
        unplaced.push({ episode: ranked, link });
      }
    }
  }

  // Episodes that clash everywhere still get scheduled on their preferred airing, so nothing is
  // silently dropped; findConflicts reports the clash and the planner asks which one to keep.
  for (const { episode, link } of unplaced) {
    const p = episode[0]!;
    const window = recordingWindow(p, link.paddingBeforeMin, link.paddingAfterMin);
    add.push({ programme: p, link, method: "live", ...window });
    occupied.push({ start: window.start, end: window.end, key: p.id });
  }
  return { add };
}

function fits(occupied: { start: number; end: number }[], w: { start: number; end: number }, limit: number): boolean {
  return maxOverlap([...occupied, w], w) <= limit;
}

/** Highest number of intervals overlapping at any instant within `w`. */
function maxOverlap(intervals: { start: number; end: number }[], w: { start: number; end: number }): number {
  const events: [number, number][] = [];
  for (const i of intervals) {
    const s = Math.max(i.start, w.start);
    const e = Math.min(i.end, w.end);
    if (s < e) events.push([s, 1], [e, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of events) {
    cur += d;
    max = Math.max(max, cur);
  }
  return max;
}

/** Live recordings that can't all get a connection: groups of overlapping recordings above the limit. */
export function findConflicts(recordings: Recording[], limit: number, now: number, channelName: (id: string) => string): Conflict[] {
  const live = recordings
    .filter((r) => r.method === "live" && (r.status === "scheduled" || r.status === "recording") && r.end > now)
    .sort((a, b) => a.start - b.start);
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();
  for (const r of live) {
    if (seen.has(r.id)) continue;
    const overlapping = live.filter((o) => o.start < r.end && o.end > r.start);
    if (maxOverlap(overlapping, r) <= limit) continue;
    overlapping.forEach((o) => seen.add(o.id));
    const names = overlapping.map((o) => `${o.programme.title} (${channelName(o.channelId)})`);
    conflicts.push({
      start: Math.min(...overlapping.map((o) => o.start)),
      end: Math.max(...overlapping.map((o) => o.end)),
      recordings: overlapping,
      message:
        limit === 1
          ? `${names.join(" and ")} are on at the same time, and your IPTV plan has one connection. Choose which one to keep.`
          : `${overlapping.length} recordings overlap but your IPTV plan has ${limit} connections. Choose which to keep.`,
    });
  }
  return conflicts;
}
