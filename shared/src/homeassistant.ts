// Home Assistant both ways: the TV as a media player Home Assistant can read and control, and a
// webhook told when playback changes (a film starts, it's paused, the credits roll), so lights can
// dim and come back up. The TV app reports what it's doing to the Hub; the Hub keeps the latest,
// answers Home Assistant and works out the events. The pure parts live here, for the tests.

/** What's on, the way automations want it: a film, an episode of something, live TV or anything else. */
export type HaKind = "film" | "episode" | "live" | "video";

/** What the TV app tells the Hub (POST /api/ha/state) whenever it changes. */
export interface TvPlayState {
  /** "off" after the TV was put in standby from the box, until something happens again. */
  status: "off" | "idle" | "playing" | "paused" | "buffering";
  profile: { id: string; name: string; kind: "adult" | "kids" } | null;
  playing: TvPlaying | null;
  /** The box player's volume, 0–100 (the TV's own volume is on its remote). */
  volume: number;
  muted: boolean;
}

export interface TvPlaying {
  /** Stays the same while the same thing plays (the progress key, or the channel). */
  key: string;
  kind: HaKind;
  title: string;
  /** "S2 E5 · The one with…", the year of a film, or the programme on now for live TV. */
  subtitle?: string;
  season?: number;
  episode?: number;
  channel?: { id: string; number: number; name: string };
  artwork?: string;
  /** Where it plays from ("Jellyfin", "IPTV", …). */
  source?: string;
  positionMs: number;
  durationMs?: number;
  /** The end credits are rolling (Jellyfin's credits marker, or the last minutes). */
  credits: boolean;
}

export const HA_EVENTS = ["started", "paused", "resumed", "stopped", "credits", "channel_changed", "profile_switched"] as const;
export type HaEventType = (typeof HA_EVENTS)[number];

/** What the webhook gets, one POST per event. */
export interface HaEvent {
  app: string;
  type: HaEventType;
  kind: HaKind | null;
  title: string | null;
  subtitle: string | null;
  channel: string | null;
  /** The profile watching ("Gary", "Kids"), and whether it's a Kids profile. */
  profile: string | null;
  kids: boolean;
  /** Seconds in, and how long it is (null for live TV). */
  position: number;
  duration: number | null;
  /** For channel_changed and profile_switched: what it was before. */
  from?: string | null;
  at: string;
  /** Only on the test event sent from Settings. */
  test?: true;
}

/** The TV as Home Assistant's media_player sees it (GET /api/ha/state): the attribute names it uses. */
export interface HaState {
  state: "off" | "idle" | "playing" | "paused" | "buffering";
  app_name: string;
  media_title: string | null;
  media_series_title: string | null;
  media_content_type: "movie" | "episode" | "channel" | "video" | null;
  media_content_id: string | null;
  media_season: number | null;
  media_episode: number | null;
  media_channel: string | null;
  media_duration: number | null;
  media_position: number | null;
  media_position_updated_at: string | null;
  entity_picture: string | null;
  source: string | null;
  volume_level: number;
  is_volume_muted: boolean;
  kind: HaKind | null;
  credits: boolean;
  profile: string | null;
  kids: boolean;
  /** The TV app is connected to the Hub. */
  connected: boolean;
  updated_at: string | null;
}

export interface HaSettings {
  /** A Home Assistant webhook (…/api/webhook/<id>) told about each playback event. */
  webhookUrl: string;
}

export const DEFAULT_HA_SETTINGS: HaSettings = { webhookUrl: "" };

export function cleanHaSettings(patch: Partial<HaSettings>, base: HaSettings = DEFAULT_HA_SETTINGS): HaSettings {
  const v = patch.webhookUrl;
  if (v === undefined) return { ...base };
  if (typeof v !== "string" || !v.trim()) return { webhookUrl: "" };
  try {
    const u = new URL(v.trim());
    return { webhookUrl: u.protocol === "http:" || u.protocol === "https:" ? u.toString() : base.webhookUrl };
  } catch {
    return { ...base };
  }
}

/** What Home Assistant may ask of the TV (POST /api/ha/command). */
export const HA_COMMANDS = ["play", "pause", "play_pause", "stop", "volume_set", "volume_up", "volume_down", "volume_mute", "channel_up", "channel_down", "select_source", "turn_on", "turn_off"] as const;
export type HaCommandName = (typeof HA_COMMANDS)[number];
export type HaCommand =
  | { command: Exclude<HaCommandName, "volume_set" | "volume_mute" | "select_source"> }
  /** 0–1, as Home Assistant's volume_level. */
  | { command: "volume_set"; value: number }
  | { command: "volume_mute"; value: boolean }
  /** A channel's name or number. */
  | { command: "select_source"; value: string };

/** Home Assistant's own service names work too, so a universal media player can map them one to one. */
const ALIASES: Record<string, HaCommandName> = {
  media_play: "play",
  media_pause: "pause",
  media_play_pause: "play_pause",
  media_stop: "stop",
  media_next_track: "channel_up",
  media_previous_track: "channel_down",
  next_track: "channel_up",
  previous_track: "channel_down",
  mute: "volume_mute",
};

/** A command from Home Assistant, or the reason it isn't one. */
export function cleanHaCommand(raw: unknown): HaCommand | { error: string } {
  const body = (raw && typeof raw === "object" ? raw : {}) as { command?: unknown; value?: unknown };
  const name = String(body.command ?? "").trim().toLowerCase();
  const command = (ALIASES[name] ?? name) as HaCommandName;
  if (!HA_COMMANDS.includes(command)) return { error: `Unknown command. Use one of: ${HA_COMMANDS.join(", ")}` };
  if (command === "volume_set") {
    const n = Number(body.value);
    if (body.value === undefined || body.value === null || body.value === "" || !Number.isFinite(n)) return { error: "volume_set needs a value from 0 to 1" };
    // 0–100 works too, for people who think in percent.
    return { command, value: Math.min(1, Math.max(0, n > 1 ? n / 100 : n)) };
  }
  if (command === "volume_mute") {
    const v = body.value;
    return { command, value: v === undefined ? true : v === true || v === 1 || /^(true|1|on|yes)$/i.test(String(v)) };
  }
  if (command === "select_source") {
    const v = String(body.value ?? "").trim().slice(0, 80);
    if (!v) return { error: "select_source needs a channel name or number" };
    return { command, value: v };
  }
  return { command };
}

/** Anything the TV sent, made safe to keep and pass on. */
export function cleanTvPlayState(raw: unknown): TvPlayState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const STATUSES = ["off", "idle", "playing", "paused", "buffering"] as const;
  const status = STATUSES.find((s) => s === r.status);
  if (!status) return null;
  const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
  const p = r.profile as Record<string, unknown> | null | undefined;
  const profile = p && text(p.id) && text(p.name) ? { id: text(p.id)!, name: text(p.name, 40)!, kind: p.kind === "kids" ? ("kids" as const) : ("adult" as const) } : null;
  let playing: TvPlaying | null = null;
  const g = r.playing as Record<string, unknown> | null | undefined;
  const KINDS: HaKind[] = ["film", "episode", "live", "video"];
  if (g && typeof g === "object" && text(g.key, 500) && text(g.title)) {
    const kind = KINDS.find((k) => k === g.kind) ?? "video";
    playing = { key: text(g.key, 500)!, kind, title: text(g.title)!, positionMs: num(g.positionMs) ?? 0, credits: g.credits === true };
    const sub = text(g.subtitle);
    if (sub) playing.subtitle = sub;
    const season = num(g.season);
    const episode = num(g.episode);
    if (season !== undefined) playing.season = season;
    if (episode !== undefined) playing.episode = episode;
    const c = g.channel as Record<string, unknown> | undefined;
    if (c && text(c.id) && text(c.name)) playing.channel = { id: text(c.id)!, number: num(c.number) ?? 0, name: text(c.name, 80)! };
    // Pictures on the box's own disk are data: URLs, far too big to hand on.
    const art = text(g.artwork, 2000);
    if (art && /^(https?:\/\/|\/)/.test(art)) playing.artwork = art;
    const source = text(g.source, 40);
    if (source) playing.source = source;
    const duration = num(g.durationMs);
    if (duration) playing.durationMs = duration;
  }
  const vol = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(100, Math.max(0, Math.round(r.volume))) : 100;
  // Playing or paused with nothing to name isn't something an automation can use.
  const effective = !playing && (status === "playing" || status === "paused" || status === "buffering") ? "idle" : status;
  return { status: effective, profile, playing: effective === "off" ? null : playing, volume: vol, muted: r.muted === true };
}

const seconds = (ms: number | undefined) => (ms === undefined ? null : Math.round(ms / 1000));
const contentType = (k: HaKind): HaState["media_content_type"] => (k === "film" ? "movie" : k === "live" ? "channel" : k);

/**
 * The media_player view of the TV's last report. `reportedAt` is when the Hub heard it, which is
 * when the position was true; Home Assistant moves the position on from there by itself.
 */
export function haState(s: TvPlayState | null, opts: { reportedAt: number | null; connected: boolean; appName: string; hubBase?: string }): HaState {
  const on = opts.connected && s !== null && s.status !== "off";
  const g = on ? s.playing : null;
  const art = g?.artwork ? (g.artwork.startsWith("/") && opts.hubBase ? opts.hubBase + g.artwork : g.artwork) : null;
  const series = g && g.kind === "episode" ? g.title : null;
  return {
    state: on ? s.status : "off",
    app_name: opts.appName,
    media_title: g ? (g.kind === "episode" && g.subtitle ? g.subtitle : g.kind === "live" ? (g.subtitle ?? g.title) : g.title) : null,
    media_series_title: series,
    media_content_type: g ? contentType(g.kind) : null,
    media_content_id: g?.key ?? null,
    media_season: g?.season ?? null,
    media_episode: g?.episode ?? null,
    media_channel: g?.channel?.name ?? null,
    media_duration: g && g.kind !== "live" ? seconds(g.durationMs) : null,
    media_position: g && g.kind !== "live" ? seconds(g.positionMs) : null,
    media_position_updated_at: g && opts.reportedAt ? new Date(opts.reportedAt).toISOString() : null,
    entity_picture: art,
    source: g?.channel?.name ?? g?.source ?? null,
    volume_level: s ? Math.round(s.volume) / 100 : 1,
    is_volume_muted: s?.muted ?? false,
    kind: g?.kind ?? null,
    credits: g?.credits ?? false,
    profile: s?.profile?.name ?? null,
    kids: s?.profile?.kind === "kids",
    connected: opts.connected,
    updated_at: opts.reportedAt ? new Date(opts.reportedAt).toISOString() : null,
  };
}

const active = (s: TvPlayState["status"]) => s === "playing" || s === "buffering";

/** The events between two reports from the TV, in the order they happened. Pure, for the tests. */
export function haEvents(prev: TvPlayState | null, next: TvPlayState, appName: string, now: number): HaEvent[] {
  const out: HaEvent[] = [];
  const event = (type: HaEventType, s: TvPlayState, g: TvPlaying | null, extra: Partial<HaEvent> = {}): HaEvent => ({
    app: appName,
    type,
    kind: g?.kind ?? null,
    title: g?.title ?? null,
    subtitle: g?.subtitle ?? null,
    channel: g?.channel?.name ?? null,
    profile: s.profile?.name ?? null,
    kids: s.profile?.kind === "kids",
    position: g && g.kind !== "live" ? Math.round(g.positionMs / 1000) : 0,
    duration: g && g.kind !== "live" && g.durationMs ? Math.round(g.durationMs / 1000) : null,
    ...extra,
    at: new Date(now).toISOString(),
  });
  if (prev && prev.profile?.id !== next.profile?.id && next.profile) out.push(event("profile_switched", next, next.playing, { from: prev.profile?.name ?? null }));
  const was = prev?.playing ?? null;
  const is = next.playing;
  if (was && is && was.key !== is.key && was.kind === "live" && is.kind === "live") {
    // Flicking through channels is one thing happening, not a stop and a start.
    out.push(event("channel_changed", next, is, { from: was.channel?.name ?? was.title }));
  } else if (was && (!is || was.key !== is.key)) {
    out.push(event("stopped", prev!, was));
    if (is) out.push(event("started", next, is));
  } else if (!was && is) {
    out.push(event("started", next, is));
  } else if (was && is && prev) {
    if (active(prev.status) && next.status === "paused") out.push(event("paused", next, is));
    else if (prev.status === "paused" && active(next.status)) out.push(event("resumed", next, is));
  }
  if (is && is.credits && !(was && was.key === is.key && was.credits)) out.push(event("credits", next, is));
  return out;
}
