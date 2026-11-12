// The PlayStation 5 app's side of the Hub (docs/ps5-architecture.md, ADR 0005).
//
// The console app is no longer our own player: it is EVO Player's engine (hardware 4K decoding
// and GPU drawing, which only a registered title can use) with UltimateTV as a "provider". The
// provider's C half is deliberately thin. It asks these `/api/ps5/*` routes for rows already
// shaped like EVO's `evo_provider_item_t` and for stream choices already shaped like
// `evo_stream_choice_t`, so the logic lives here, in TypeScript, where it is tested.
//
// Everything in this file is pure: the routes (ps5routes.ts) fetch, this file shapes.

import { createHash } from "node:crypto";
import type { Episode, HomeScreen, NowNext, PlaybackInfo, Rail, Recording, SearchResult, TitleDetails, TitleRef } from "@ultimatetv/shared";
import { themeInfo, type ThemeName, type ThemePalette } from "@ultimatetv/shared";

/** The limits of EVO's `evo_provider_item_t` fields, so a long title can't be cut mid-character. */
export const MAX = { title: 191, subtitle: 159, overview: 319, art: 383, facts: 95, id: 159 } as const;

/** One catalogue row, in EVO's own field names. */
export interface Ps5Row {
  id: string;
  parent_id: string;
  title: string;
  subtitle: string;
  overview: string;
  art_url: string;
  backdrop_url: string;
  logo_url: string;
  rating: string;
  cert: string;
  facts: string;
  duration_sec: number;
  resume_pos_sec: number;
  kind: "movie" | "episode" | "series" | "channel" | "recording" | "header" | "hero";
  is_folder: boolean;
  is_live: boolean;
  played: boolean;
  now_title: string;
  next_title: string;
}

export interface Ps5Page {
  items: Ps5Row[];
  has_more: boolean;
}

/** A row that is a heading for the rows after it, not something to open. */
export const HEADER = "__header__";
/** Marks the hero row (in `next_title`, which surfaces to the bundle as `row.next`). */
export const HERO = "__hero__";

/** Cut to `max` characters on a whole character, with an ellipsis, never splitting a surrogate pair. */
export function clip(text: string | undefined, max: number): string {
  const chars = Array.from(text ?? "");
  return chars.length <= max ? chars.join("") : chars.slice(0, max - 1).join("").trimEnd() + "…";
}

/** A Hub path (`/api/art/...`) becomes an address the console can fetch; a full address is left alone. */
export function absolute(url: string | undefined, origin: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith("/") ? origin + url : "";
}

const blank = (): Ps5Row => ({
  id: "", parent_id: "", title: "", subtitle: "", overview: "", art_url: "", backdrop_url: "", logo_url: "", rating: "", cert: "",
  facts: "", duration_sec: 0, resume_pos_sec: 0, kind: "movie", is_folder: false, is_live: false, played: false, now_title: "", next_title: "",
});

// ---------------------------------------------------------------------------
// Ids. EVO treats an id as opaque, so what's in it is ours: `<what>:<ref>`.

export type Ps5Target = { what: "title"; id: string } | { what: "episode"; id: string; episodeId: string } | { what: "channel" | "recording" | "series" | "rail"; id: string };

export function titleRowId(t: TitleRef): string {
  if (t.kind === "series" && !t.episodeId) return `series:${t.id}`;
  return t.episodeId ? `episode:${t.id}|${t.episodeId}` : `title:${t.id}`;
}

export function parseRowId(raw: string): Ps5Target | null {
  const colon = raw.indexOf(":");
  if (colon < 1) return null;
  const what = raw.slice(0, colon);
  const rest = raw.slice(colon + 1);
  if (!rest) return null;
  if (what === "episode") {
    const bar = rest.lastIndexOf("|");
    return bar > 0 && bar < rest.length - 1 ? { what, id: rest.slice(0, bar), episodeId: rest.slice(bar + 1) } : null;
  }
  return what === "title" || what === "channel" || what === "recording" || what === "series" || what === "rail" ? { what, id: rest } : null;
}

// ---------------------------------------------------------------------------
// Rows

export function rowForTitle(t: TitleRef, origin: string, parent = ""): Ps5Row {
  const folder = t.kind === "series" && !t.episodeId;
  const resumable = t.progress != null && t.progress > 0;
  return {
    ...blank(),
    id: clip(titleRowId(t), MAX.id),
    parent_id: parent,
    title: clip(t.name, MAX.title),
    subtitle: clip(t.subtitle ?? (t.year ? String(t.year) : ""), MAX.subtitle),
    art_url: absolute(t.poster, origin),
    backdrop_url: absolute(t.backdrop, origin),
    logo_url: absolute(t.logo, origin),
    cert: clip(t.certification, 15),
    facts: clip([t.year, ...(t.genres ?? []).slice(0, 3)].filter(Boolean).join(" · "), MAX.facts),
    kind: t.kind === "series" ? (t.episodeId ? "episode" : "series") : "movie",
    is_folder: folder,
    // Only a fraction is known here; the player gets the real resume point from /api/ps5/resolve.
    played: false,
    resume_pos_sec: resumable ? -1 : 0,
  };
}

export function rowForChannel(n: NowNext, origin: string, parent = ""): Ps5Row {
  return {
    ...blank(),
    id: `channel:${n.channel.id}`,
    parent_id: parent,
    title: clip(n.channel.name, MAX.title),
    subtitle: n.channel.number ? String(n.channel.number) : "",
    art_url: absolute(n.channel.logo, origin),
    kind: "channel",
    is_live: true,
    now_title: clip(n.now?.title, 127),
    next_title: clip(n.next?.title, 127),
  };
}

export function rowForRecording(r: Recording, parent = ""): Ps5Row {
  return {
    ...blank(),
    id: `recording:${r.id}`,
    parent_id: parent,
    title: clip(r.programme.title, MAX.title),
    subtitle: clip(r.channelName, MAX.subtitle),
    overview: clip(r.programme.description, MAX.overview),
    duration_sec: Math.round((r.end - r.start) / 1000),
    kind: "recording",
    played: r.watched,
  };
}

const header = (rail: Rail): Ps5Row => ({ ...blank(), id: `rail:${rail.id}`, title: clip(rail.title, MAX.title), overview: HEADER, kind: "header" });

/** Home as one list: the hero, then each rail as a heading followed by its cards, in the TV's order. */
export function homeRows(home: HomeScreen, origin: string): Ps5Page {
  const items: Ps5Row[] = [];
  if (home.hero) {
    const h = home.hero;
    items.push({
      ...rowForTitle(h, origin),
      kind: "hero",
      // EVO's data model has no backdrop or hero field, so the hero is told apart by `next_title`
      // and shows its wide picture where a card shows a poster.
      next_title: HERO,
      art_url: absolute(h.backdrop ?? h.poster, origin),
      overview: clip(h.overview, MAX.overview),
      // What the big button says, so the bundle can show "Resume" / "Watch" / "Live" like the TV.
      subtitle: h.action === "resume" ? "Resume" : h.action === "live" ? "Live" : "Watch",
    });
  }
  for (const rail of home.rails) {
    const cards: Ps5Row[] = [];
    if (rail.kind === "titles") for (const t of rail.items) cards.push(rowForTitle(t, origin, `rail:${rail.id}`));
    else if (rail.kind === "channels") for (const n of rail.channels ?? []) cards.push(rowForChannel(n, origin, `rail:${rail.id}`));
    else if (rail.kind === "recordings") for (const r of rail.recordings ?? []) cards.push(rowForRecording(r, `rail:${rail.id}`));
    // Sport tonight stays on the TV and the phone: it has nothing to open.
    if (cards.length === 0) continue;
    items.push(header(rail), ...cards);
  }
  return { items, has_more: false };
}

/** A series opened: its episodes in season order, each headed by the season. */
export function seriesRows(d: TitleDetails, origin: string): Ps5Page {
  const items: Ps5Row[] = [];
  for (const s of d.seasons ?? []) {
    items.push({ ...blank(), id: `rail:season-${s.season}`, title: clip(s.name || `Season ${s.season}`, MAX.title), overview: HEADER, kind: "header" });
    for (const e of s.episodes) items.push(episodeRow(d, e, origin));
  }
  return { items, has_more: false };
}

function episodeRow(d: TitleDetails, e: Episode, origin: string): Ps5Row {
  return {
    ...blank(),
    id: `episode:${d.id}|s${e.season}e${e.episode}`,
    parent_id: `series:${d.id}`,
    title: clip(`${e.episode}. ${e.name}`, MAX.title),
    subtitle: clip(`S${e.season} E${e.episode}`, MAX.subtitle),
    overview: clip(e.overview, MAX.overview),
    art_url: absolute(e.still ?? d.poster, origin),
    duration_sec: (e.runtimeMin ?? 0) * 60,
    kind: "episode",
    played: e.watched === true,
  };
}

/** Search results as one list: only what the console can play or open. */
export function searchRows(results: SearchResult[], origin: string): Ps5Page {
  const items: Ps5Row[] = [];
  for (const r of results) {
    if (r.kind === "title" && r.title) items.push(rowForTitle(r.title, origin));
    else if (r.kind === "channel" && r.channel) items.push(rowForChannel({ channel: r.channel }, origin));
    else if (r.kind === "recording" && r.recording) items.push(rowForRecording(r.recording));
  }
  return { items, has_more: false };
}

// ---------------------------------------------------------------------------
// Playback

/** One entry of EVO's `evo_stream_choice_t`, in its field names. */
export interface Ps5Choice {
  url: string;
  label: string;
  container: string;
  is_live: boolean;
  width: number;
  height: number;
  video_range: string;
  headers: string;
  sub_url: string;
  facts: string;
}

export interface Ps5Resolved {
  choices: Ps5Choice[];
  /** Where to start, so the console resumes the way the TV does. */
  start_sec: number;
  duration_sec: number;
  live: boolean;
}

const HDR_WORDS: Record<string, string> = { hdr10: "HDR10", "hdr10+": "HDR10+", hlg: "HLG", "dolby vision": "Dolby Vision", dv: "Dolby Vision", sdr: "SDR" };

/** What the Hub's /api/play said, as the stream the console's player opens. */
export function resolved(info: PlaybackInfo, origin: string): Ps5Resolved {
  const q = (info.quality ?? {}) as { height?: number; width?: number; hdr?: string; label?: string };
  const url = absolute(info.url, origin) || info.url;
  const headers = Object.entries(info.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("");
  const sub = info.externalSubtitles.find((s) => /srt|vtt|subrip|\.ass/i.test(s.url) || true);
  const container = info.hls || /\.m3u8(\?|$)/i.test(url) ? "m3u8" : /\.ts(\?|$)/i.test(url) ? "ts" : /\.mp4(\?|$)/i.test(url) ? "mp4" : /\.mkv(\?|$)/i.test(url) ? "mkv" : "";
  const hdr = HDR_WORDS[String(q.hdr ?? "").toLowerCase()] ?? "";
  const choice: Ps5Choice = {
    url,
    label: clip(info.source?.label ? `${info.source.label}${q.label ? ` · ${q.label}` : ""}` : (q.label ?? "Hub"), 120),
    container,
    is_live: info.live,
    width: q.width ?? 0,
    height: q.height ?? 0,
    video_range: hdr,
    headers: clip(headers, 1000),
    sub_url: sub ? absolute(sub.url, origin) || sub.url : "",
    facts: "",
  };
  return { choices: [choice], start_sec: Math.max(0, Math.round(info.startMs / 1000)), duration_sec: Math.round((info.durationMs ?? 0) / 1000), live: info.live };
}

// ---------------------------------------------------------------------------
// The look. The console draws the Hub's pages itself (RmlUi, an HTML/CSS subset), so the Hub
// writes them: same palette as the TV, so a theme change or a seasonal theme reaches the
// console with no new install. EVO fetches `manifest.json`, checks each file's sha256, and caches
// them. A bundle is markup and styling only: no scripts, ever.

export interface BundleFile {
  path: string;
  body: string;
}
export interface BundleManifest {
  id: "ultimatetv";
  name: string;
  version: string;
  api_version: 1;
  entry: "main.rml";
  data_model: "ultimatetv";
  assets: { path: string; bytes: number; sha256: string }[];
}

/** EVO's own limits (evo_provider_bundle.h): a bundle over them is refused, so we refuse first. */
export const BUNDLE_LIMITS = { files: 64, fileBytes: 2 * 1024 * 1024, bundleBytes: 8 * 1024 * 1024, nodes: 4000 } as const;

/** "r g b" or "#rrggbb" or "rgba(...)" to RmlUi's colour syntax. RmlUi takes #hex and rgba(), not space lists. */
function colour(value: string): string {
  const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(value);
  return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : value.trim();
}

export function stylesheet(p: ThemePalette): string {
  const c = (k: keyof ThemePalette) => colour(p[k]);
  // Everything is in dp against a 1920 x 1080 canvas (EVO scales it to the panel), and the first
  // 152dp are left clear for EVO's own navigation rail, which it draws over a bundle.
  return `body { display: block; width: 100%; height: 100%; margin: 0; padding: 0; background-color: ${c("--bg")}; color: ${c("--fg")}; font-family: Lato; font-size: 22dp; }
#pane { display: block; position: absolute; left: 152dp; top: 0; right: 0; bottom: 0; padding: 36dp 56dp 0 40dp; overflow: auto; background: ${c("--bg")}; }
#crumb { display: block; font-size: 20dp; color: ${c("--muted")}; padding-bottom: 14dp; }
#status { display: block; font-size: 24dp; color: ${c("--fg-2")}; padding: 24dp 0; }
#status.bad { color: ${c("--bad")}; }
.hero { display: block; position: relative; height: 340dp; margin-bottom: 28dp; border-radius: 18dp; overflow: hidden; background-color: ${c("--panel")}; }
.hero img.backdrop { display: block; position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.hero .shade { display: block; position: absolute; left: 0; top: 0; width: 100%; height: 100%; background: linear-gradient(to right, ${c("--bg")} 18%, rgba(0, 0, 0, 0) 85%); }
.hero .text { display: block; position: absolute; left: 36dp; bottom: 30dp; width: 760dp; }
.hero h1 { display: block; font-size: 46dp; font-weight: bold; margin: 0 0 8dp 0; }
.hero p { display: block; font-size: 22dp; color: ${c("--fg-2")}; margin: 0 0 18dp 0; height: 62dp; overflow: hidden; }
.btn { display: inline-block; padding: 12dp 30dp; border-radius: 12dp; background-color: ${c("--panel-2")}; color: ${c("--fg")}; font-size: 24dp; font-weight: bold; tab-index: auto; nav: auto; }
.btn:focus { background-color: ${c("--sel")}; color: ${c("--on-sel")}; }
.hero .btn.go { background-color: ${c("--accent")}; color: ${c("--on-accent")}; }
.rail { display: block; font-size: 28dp; font-weight: bold; margin: 26dp 0 12dp 0; color: ${c("--fg")}; }
.cards { display: block; }
.card { display: inline-block; width: 214dp; margin: 0 18dp 22dp 0; vertical-align: top; tab-index: auto; nav: auto; border-radius: 12dp; border: 3dp ${c("--bg")}; padding: 0; background-color: ${c("--bg")}; }
.card:focus { border-color: ${c("--focus")}; background-color: ${c("--panel")}; }
.card .art { display: block; width: 208dp; height: 312dp; border-radius: 9dp; background-color: ${c("--panel")}; }
.card.wide .art { height: 117dp; width: 208dp; }
.card .art img { display: block; width: 100%; height: 100%; }
.card .initial { display: block; padding-top: 110dp; text-align: center; font-size: 60dp; color: ${c("--dim")}; }
.card .name { display: block; font-size: 21dp; padding: 8dp 6dp 0 6dp; height: 30dp; overflow: hidden; color: ${c("--fg")}; }
.card .sub { display: block; font-size: 17dp; padding: 0 6dp 6dp 6dp; height: 24dp; overflow: hidden; color: ${c("--muted")}; }
.card .live { color: ${c("--good")}; }
.more { display: block; margin: 12dp 0 40dp 0; }
`;
}

/** The one page. Rows come from EVO's data model; hero and headings are rows of their own kinds. */
export function markup(): string {
  return `<rml>
<head>
<title>UltimateTV</title>
<link type="text/rcss" href="main.rcss"/>
</head>
<body data-model="ultimatetv">
<div id="pane">
  <div id="crumb">{{ breadcrumb }}</div>
  <div id="status" data-if="status != ''" data-class-bad="has_error">{{ status }}</div>
  <div class="cards">
    <div data-for="row : rows">
      <div data-if="row.next == '__hero__'" class="hero">
        <img class="backdrop" data-if="row.art != ''" data-attr-src="row.art"/>
        <div class="shade"></div>
        <div class="text">
          <h1>{{ row.title }}</h1>
          <p>{{ row.overview }}</p>
          <div class="btn go" data-attr-rowid="row.id" data-event-click="activate()">{{ row.subtitle }}</div>
        </div>
      </div>
      <div data-if="row.overview == '__header__'" class="rail">{{ row.title }}</div>
      <div data-if="row.overview != '__header__' &amp;&amp; row.next != '__hero__'" class="card" data-attr-rowid="row.id" data-event-click="activate()" >
        <div class="art">
          <img data-if="row.art != ''" data-attr-src="row.art"/>
          <div data-if="row.art == ''" class="initial">{{ row.initial }}</div>
        </div>
        <div class="name">{{ row.title }}</div>
        <div class="sub" data-class-live="row.is_live">{{ row.is_live ? row.now : row.subtitle }}</div>
      </div>
    </div>
  </div>
  <div class="more" data-if="has_more"><div class="btn" data-event-click="load_more()">More</div></div>
</div>
</body>
</rml>
`;
}

/** The whole bundle for a theme, with a manifest whose version changes whenever any byte does. */
export function bundle(theme: ThemeName): { files: BundleFile[]; manifest: BundleManifest } {
  const files: BundleFile[] = [
    { path: "main.rml", body: markup() },
    { path: "main.rcss", body: stylesheet(themeInfo(theme).palette) },
  ];
  const assets = files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.body), sha256: createHash("sha256").update(f.body).digest("hex") }));
  const version = createHash("sha256").update(assets.map((a) => a.sha256).join()).digest("hex").slice(0, 12);
  const total = assets.reduce((n, a) => n + a.bytes, 0);
  if (files.length > BUNDLE_LIMITS.files || total > BUNDLE_LIMITS.bundleBytes || assets.some((a) => a.bytes > BUNDLE_LIMITS.fileBytes)) {
    throw new Error("The PlayStation 5 bundle is over the console's limits");
  }
  return { files, manifest: { id: "ultimatetv", name: "UltimateTV", version, api_version: 1, entry: "main.rml", data_model: "ultimatetv", assets } };
}
