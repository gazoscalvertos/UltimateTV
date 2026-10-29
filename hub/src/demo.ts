// Demo mode (DEMO=1): made-up channels, a two-day guide, recordings, a film library and generated
// artwork, so the UI can be tried and screenshotted without any real sources. Titles are invented.

import { existsSync } from "node:fs";
import path from "node:path";
import type { Channel, ChannelCategory, Episode, Programme, Recording, Season, SeriesLink, TitleRef } from "@ultimatetv/shared";
import { normaliseTitle } from "@ultimatetv/shared";
import type { StoredFeed } from "./channels.js";
import type { HubConfig } from "./config.js";
import type { HubContext } from "./context.js";
import type { VodEntry } from "./ingest/index.js";
import { MIX_SEEDS } from "./mixseeds.js";
import { hash } from "./ingest/xmltv.js";

interface DemoChannel {
  number: number;
  name: string;
  category: ChannelCategory;
  height: number;
  catchupDays: number;
  colour: string;
}

const CHANNELS: DemoChannel[] = [
  { number: 101, name: "BBC One", category: "entertainment", height: 1080, catchupDays: 7, colour: "#c4162a" },
  { number: 102, name: "BBC Two", category: "entertainment", height: 1080, catchupDays: 7, colour: "#6b2d8f" },
  { number: 103, name: "ITV1", category: "entertainment", height: 1080, catchupDays: 7, colour: "#1d3b8f" },
  { number: 104, name: "Channel 4", category: "entertainment", height: 1080, catchupDays: 7, colour: "#2a7f62" },
  { number: 105, name: "Channel 5", category: "entertainment", height: 1080, catchupDays: 0, colour: "#b0124f" },
  { number: 106, name: "BBC Three", category: "entertainment", height: 1080, catchupDays: 7, colour: "#d24c1e" },
  { number: 107, name: "BBC Four", category: "entertainment", height: 1080, catchupDays: 7, colour: "#3a4a5c" },
  { number: 108, name: "ITV2", category: "entertainment", height: 1080, catchupDays: 0, colour: "#2f63c9" },
  { number: 109, name: "ITV3", category: "entertainment", height: 720, catchupDays: 0, colour: "#4b3aa8" },
  { number: 110, name: "E4", category: "entertainment", height: 1080, catchupDays: 0, colour: "#7a1f6c" },
  { number: 111, name: "More4", category: "entertainment", height: 720, catchupDays: 0, colour: "#1b6d74" },
  { number: 112, name: "Dave", category: "entertainment", height: 1080, catchupDays: 0, colour: "#c79a12" },
  { number: 113, name: "Sky Showcase", category: "entertainment", height: 1080, catchupDays: 0, colour: "#0c5fa8" },
  { number: 114, name: "Sky Atlantic", category: "entertainment", height: 2160, catchupDays: 0, colour: "#14425e" },
  { number: 115, name: "Sky Max", category: "entertainment", height: 1080, catchupDays: 0, colour: "#8a1c2b" },
  { number: 301, name: "Film4", category: "films", height: 1080, catchupDays: 0, colour: "#1f1f2e" },
  { number: 302, name: "Sky Cinema Premiere", category: "films", height: 2160, catchupDays: 0, colour: "#5b1e7a" },
  { number: 401, name: "Sky Sports Main Event", category: "sport", height: 2160, catchupDays: 0, colour: "#b3001b" },
  { number: 402, name: "Sky Sports Premier League", category: "sport", height: 1080, catchupDays: 0, colour: "#3d1a78" },
  { number: 403, name: "TNT Sports 1", category: "sport", height: 1080, catchupDays: 0, colour: "#0a0a0a" },
  { number: 501, name: "BBC News", category: "news", height: 1080, catchupDays: 0, colour: "#a5121e" },
  { number: 502, name: "Sky News", category: "news", height: 1080, catchupDays: 0, colour: "#c3001f" },
  { number: 521, name: "Discovery", category: "documentaries", height: 1080, catchupDays: 0, colour: "#0f4f8a" },
  { number: 522, name: "National Geographic", category: "documentaries", height: 1080, catchupDays: 0, colour: "#d9a400" },
  { number: 601, name: "CBBC", category: "kids", height: 1080, catchupDays: 7, colour: "#79b41e" },
  { number: 602, name: "CBeebies", category: "kids", height: 1080, catchupDays: 7, colour: "#f2a20c" },
];

const POOLS: Record<ChannelCategory, string[]> = {
  entertainment: [
    "Harbour Lights", "The Quiet Fen", "Kitchen Rivals", "Northern Line", "Lakeside Murders", "Bake & Make", "The Allotment Year",
    "Quiz Night Live", "Coastal Rescue", "Room for Improvement", "Saturday Spectacular", "Antiques on the Road", "The Night Shift",
    "Hidden Villages", "Two Up, Two Down", "Market Town", "The Long Weekend", "Ward 9", "Pub Quiz Champions", "Dragon's Kitchen",
  ],
  films: ["The Long Road North", "Paper Moons", "Last Train to Brighton", "Starfall", "The Clockmaker", "Glasshouse", "Night Ferry", "Copper Sky", "The Lighthouse Keeper", "Thin Ice"],
  sport: ["Live: Premier League Football", "Super Sunday", "Goals Express", "Grand Prix Qualifying", "Test Cricket Highlights", "Fight Night Live", "Racing Today", "Golf Weekly"],
  news: ["News Hour", "World Tonight", "Business Live", "The Briefing", "Politics Live", "Newsday"],
  documentaries: ["Planet Ocean", "Wild Islands", "Engineering Giants", "Ancient Roads", "Deep Freeze", "Volcano Watch", "Secrets of the Nile"],
  kids: ["Rocket Pups", "Mo and the Moonbeams", "Space Detectives", "Art Attackers", "Dino Ranch Rescue", "The Muddles"],
  music: ["Top 40 Countdown"],
  other: ["Shopping Hour"],
};

const DESCRIPTIONS = [
  "A mysterious arrival shakes up the close-knit community, and old secrets come to the surface.",
  "Tensions rise as the team races against the clock to finish before the deadline.",
  "An unexpected discovery changes everything, and loyalties are tested to breaking point.",
  "Two rivals are forced to work together when a storm cuts the town off from the mainland.",
  "The investigation takes a dark turn when a key witness disappears without a trace.",
  "It's the final week, and only one can be crowned champion.",
];

/** BBC One's evening, fixed so screenshots tell a story (series link, a recording, a clash). */
const BBC_ONE_EVENING: [number, number, string, Partial<Programme>][] = [
  [18, 30, "Regional News", { categories: ["News"] }],
  [19, 0, "The One Night", { categories: ["Magazine"] }],
  [20, 0, "Harbour Lights", { season: 3, episode: 4, subtitle: "The Storm", categories: ["Drama"], isNew: true }],
  [21, 0, "Lakeside Murders", { season: 1, episode: 2, subtitle: "Still Waters", categories: ["Drama", "Crime"], isNew: true }],
  [22, 0, "News at Ten", { categories: ["News"] }],
  [22, 35, "Late Kick-off", { categories: ["Sport"] }],
];

interface DemoTitle {
  slug: string;
  name: string;
  kind: "movie" | "series";
  year: number;
  genres: string[];
  overview: string;
  rating: number;
  quality: string;
}

const TITLES: DemoTitle[] = [
  { slug: "copper-sky", name: "Copper Sky", kind: "movie", year: 2024, genres: ["Sci-Fi", "Adventure"], rating: 7.9, quality: "2160p DV HDR10 Atmos", overview: "When a mining colony loses contact with Earth, a reluctant pilot leads the search for the missing supply ship across a red desert planet." },
  { slug: "the-clockmaker", name: "The Clockmaker", kind: "movie", year: 2023, genres: ["Drama", "Mystery"], rating: 7.4, quality: "2160p HDR10 DDP5.1", overview: "A watch repairer in 1920s Edinburgh discovers that the timepieces she mends can turn back a single hour." },
  { slug: "night-ferry", name: "Night Ferry", kind: "movie", year: 2022, genres: ["Thriller"], rating: 6.8, quality: "1080p DDP5.1", overview: "Eight passengers. One overnight crossing. One of them won't reach the other side." },
  { slug: "glasshouse", name: "Glasshouse", kind: "movie", year: 2024, genres: ["Comedy", "Drama"], rating: 7.1, quality: "2160p HDR10 Atmos", overview: "Three estranged sisters inherit a crumbling Victorian greenhouse and a garden show entry they never asked for." },
  { slug: "thin-ice", name: "Thin Ice", kind: "movie", year: 2021, genres: ["Action", "Thriller"], rating: 6.9, quality: "2160p HDR10 Atmos", overview: "A disgraced ice-road trucker takes one last job across a frozen lake that is starting to crack." },
  { slug: "paper-moons", name: "Paper Moons", kind: "movie", year: 2019, genres: ["Family", "Animation"], rating: 8.2, quality: "2160p HDR10 DDP5.1", overview: "A shy origami artist folds a paper moon that floats away, and has to follow it across a city of folded wonders." },
  { slug: "the-long-road-north", name: "The Long Road North", kind: "movie", year: 2020, genres: ["Drama"], rating: 7.6, quality: "1080p DDP5.1", overview: "A grieving father and his teenage son drive from Cornwall to Cape Wrath in a borrowed camper van." },
  { slug: "starfall", name: "Starfall", kind: "movie", year: 2017, genres: ["Sci-Fi", "Action"], rating: 7.0, quality: "2160p DV HDR10 TrueHD Atmos", overview: "A meteor shower brings something with it, and a small Welsh town is the first to notice." },
  { slug: "last-train-to-brighton", name: "Last Train to Brighton", kind: "movie", year: 2021, genres: ["Comedy", "Romance"], rating: 6.7, quality: "1080p DDP5.1", overview: "Two strangers miss the last train and spend one chaotic night getting to the seaside by any means possible." },
  { slug: "the-lighthouse-keeper", name: "The Lighthouse Keeper", kind: "movie", year: 2018, genres: ["Drama", "Mystery"], rating: 7.3, quality: "2160p HDR10 DDP5.1", overview: "The new keeper of a remote lighthouse starts receiving messages from someone who left forty years ago." },
  { slug: "harbour-lights", name: "Harbour Lights", kind: "series", year: 2023, genres: ["Drama", "Crime"], rating: 8.1, quality: "1080p DDP5.1", overview: "Life, love and crime in a Cornish fishing village where everyone knows everyone's business, except the truth." },
  { slug: "northern-line", name: "Northern Line", kind: "series", year: 2022, genres: ["Thriller"], rating: 7.8, quality: "2160p HDR10 Atmos", overview: "A transport police detective follows a trail of disappearances along London's oldest Underground line." },
  { slug: "wild-islands", name: "Wild Islands", kind: "series", year: 2024, genres: ["Documentary"], rating: 8.9, quality: "2160p HDR10 DDP5.1", overview: "The extraordinary wildlife of the British Isles, filmed across a year from the Shetlands to the Scillies." },
  { slug: "kitchen-rivals", name: "Kitchen Rivals", kind: "series", year: 2024, genres: ["Reality"], rating: 7.2, quality: "1080p AAC", overview: "Home cooks from rival towns go head to head in a nationwide cook-off." },
  { slug: "space-detectives", name: "Space Detectives", kind: "series", year: 2021, genres: ["Kids", "Animation"], rating: 7.5, quality: "1080p AAC", overview: "Three young cadets solve mysteries across the galaxy with their robot dog, Bolt." },
  { slug: "the-quiet-fen", name: "The Quiet Fen", kind: "series", year: 2020, genres: ["Drama", "Mystery"], rating: 7.7, quality: "1080p DDP5.1", overview: "A detective returns to the Lincolnshire fens to reopen the case that ended her career." },
];

const PALETTES: [string, string, string][] = [
  ["#0f2027", "#2c5364", "#f6b042"],
  ["#1a1033", "#5b2a86", "#ff7a59"],
  ["#081c15", "#2d6a4f", "#b7e4c7"],
  ["#14213d", "#3a5a99", "#fca311"],
  ["#2b0f0f", "#8a2b2b", "#ffd6a5"],
  ["#03045e", "#0077b6", "#90e0ef"],
  ["#231942", "#5e548e", "#e0b1cb"],
  ["#1b1b1b", "#4a4e69", "#f2e9e4"],
  ["#0b3d2e", "#1f7a5a", "#f4d35e"],
  ["#2d1e2f", "#b56576", "#ffcdb2"],
];

function palette(seed: string): [string, string, string] {
  return PALETTES[parseInt(hash(seed), 36) % PALETTES.length]!;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Generated artwork: posters, backdrops, episode stills, channel logos and album covers. */
export function demoArt(kind: string, seed: string): string {
  const [dark, mid, accent] = palette(seed);
  const n = parseInt(hash(seed + kind), 36);
  const circles = (w: number, h: number, count: number) =>
    Array.from({ length: count }, (_, i) => {
      const x = ((n >> (i * 3)) % 100) / 100;
      const y = ((n >> (i * 2 + 5)) % 100) / 100;
      const r = (0.18 + (((n >> (i + 9)) % 30) / 100)) * Math.max(w, h);
      return `<circle cx="${(x * w).toFixed(0)}" cy="${(y * h).toFixed(0)}" r="${r.toFixed(0)}" fill="${i % 2 ? accent : mid}" opacity="${(0.18 + i * 0.07).toFixed(2)}"/>`;
    }).join("");
  const horizon = (w: number, h: number) => {
    const pts = Array.from({ length: 9 }, (_, i) => `${(i * w) / 8},${(h * (0.62 + (((n >> i) % 17) / 100))).toFixed(0)}`).join(" ");
    return `<polygon points="0,${h} ${pts} ${w},${h}" fill="${dark}" opacity="0.85"/>`;
  };

  if (kind === "logo") {
    const ch = CHANNELS.find((c) => slugOf(c.name) === seed);
    const name = ch?.name ?? seed;
    const words = name.split(" ");
    const short = words.length > 2 ? words.slice(0, 2).join(" ") : name;
    const sub = words.length > 2 ? words.slice(2).join(" ") : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect x="6" y="18" width="228" height="104" rx="18" fill="${ch?.colour ?? mid}"/><text x="120" y="${sub ? 70 : 82}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-weight="800" font-size="${short.length > 10 ? 30 : 36}" fill="#fff" text-anchor="middle">${esc(short)}</text>${sub ? `<text x="120" y="104" font-family="Inter, Segoe UI, Arial, sans-serif" font-weight="600" font-size="20" fill="#ffffffcc" text-anchor="middle">${esc(sub)}</text>` : ""}</svg>`;
  }
  if (kind === "poster") {
    const t = TITLES.find((x) => x.slug === seed);
    const lines = wrap((t?.name ?? seed).toUpperCase(), 12);
    const text = lines.map((l, i) => `<text x="32" y="${470 + (i - lines.length + 1) * 52}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-weight="800" font-size="46" letter-spacing="1" fill="#fff">${esc(l)}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/>${circles(400, 600, 4)}${horizon(400, 600)}<rect width="400" height="600" fill="url(#s)"/>${text}<text x="32" y="530" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="20" fill="${accent}" font-weight="600">${t ? `${t.year} · ${esc(t.genres[0] ?? "")}` : ""}</text></svg>`;
  }
  if (kind === "cover") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/>${circles(600, 600, 4)}<circle cx="300" cy="300" r="${90 + (n % 60)}" fill="none" stroke="${accent}" stroke-width="10" opacity="0.6"/></svg>`;
  }
  // backdrop / still
  const w = kind === "still" ? 640 : 1920;
  const h = kind === "still" ? 360 : 1080;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient><radialGradient id="sun" cx="0.72" cy="0.38" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#sun)"/>${circles(w, h, 3)}${horizon(w, h)}</svg>`;
}

export function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rand(seed: string): () => number {
  let x = parseInt(hash(seed), 36) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10_000) / 10_000;
  };
}

export function seedDemo(ctx: HubContext, config: HubConfig, now = Date.now()): void {
  const art = (kind: string, seed: string) => `/api/art/${kind}/${seed}.svg`;
  const channels: Channel[] = CHANNELS.map((c) => {
    const id = slugOf(c.name);
    return {
      id,
      number: c.number,
      name: c.name,
      logo: art("logo", id),
      category: c.category,
      feeds: [{ id: `demo:${id}`, sourceId: "demo", name: c.name, height: c.height, priority: 0, catchupDays: c.catchupDays }],
      favourite: c.number <= 104 || c.number === 401,
      hidden: false,
      maxHeight: c.height,
      catchupDays: c.catchupDays,
    };
  });
  const clip = (name: string) => (existsSync(path.join(config.clipsDir, name)) ? `/clips/${name}` : "/clips/h264-1080p25-aac.mp4");
  const feeds: StoredFeed[] = channels.map((c) => ({ ...c.feeds[0]!, channelId: c.id, upstreamId: c.id, url: `http://127.0.0.1:${config.port}${clip("h264-1080i25-ac3.ts")}` }));
  ctx.channels.replace(channels, feeds);

  // A guide from 12 hours ago to 36 hours ahead, on half-hour boundaries.
  const HALF = 30 * 60_000;
  const start = Math.floor((now - 12 * 3_600_000) / HALF) * HALF;
  const end = now + 36 * 3_600_000;
  const programmes: Programme[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (const c of channels) {
    const r = rand(c.id);
    const pool = POOLS[c.category];
    let t = start;
    let i = 0;
    while (t < end) {
      const film = c.category === "films";
      const mins = film ? 90 + Math.floor(r() * 3) * 15 : c.category === "news" ? 30 : [30, 60, 60, 60, 90][Math.floor(r() * 5)]!;
      const title = pool[Math.floor(r() * pool.length)]!;
      const season = 1 + Math.floor(r() * 4);
      const episode = 1 + Math.floor(r() * 8);
      const p = demoProgramme(c, t, mins, title, film ? {} : { season, episode }, DESCRIPTIONS[i++ % DESCRIPTIONS.length]!, film ? 2010 + Math.floor(r() * 14) : undefined);
      programmes.push(p);
      t += mins * 60_000;
    }
  }
  // BBC One's fixed evenings, today and tomorrow.
  for (const dayOffset of [0, 1]) {
    const base = today.getTime() + dayOffset * 86_400_000;
    const bbc1 = channels[0]!;
    for (let k = 0; k < BBC_ONE_EVENING.length; k++) {
      const [h, m, title, extra] = BBC_ONE_EVENING[k]!;
      const s = base + (h * 60 + m) * 60_000;
      const next = BBC_ONE_EVENING[k + 1];
      const e = next ? base + (next[0] * 60 + next[1]) * 60_000 : s + 55 * 60_000;
      for (let j = programmes.length - 1; j >= 0; j--) {
        const p = programmes[j]!;
        if (p.channelId === bbc1.id && p.start < e && p.end > s) programmes.splice(j, 1);
      }
      const ep = dayOffset === 1 && extra.episode ? { ...extra, episode: extra.episode + 1, subtitle: "Undertow" } : extra;
      programmes.push(demoProgramme(bbc1, s, (e - s) / 60_000, title, ep, ep.subtitle ? `${ep.subtitle}: ${DESCRIPTIONS[k % DESCRIPTIONS.length]}` : DESCRIPTIONS[k % DESCRIPTIONS.length]!));
    }
  }
  ctx.db.run("DELETE FROM programmes");
  ctx.guide.upsert(programmes);
  if (!ctx.guides.list().length) ctx.guides.create({ name: "Evenings", channels: ["sky-atlantic", "bbc-one", "channel-4", "film4", "sky-sports-main-event", "dave"] });
  ctx.db.setKv("epgUpdatedAt", now);
  ctx.db.setKv("sourcesUpdatedAt", now);

  // Library.
  const vod: VodEntry[] = TITLES.map((t, i) => ({
    id: `demo:${t.kind}:${t.slug}`,
    kind: t.kind,
    sourceId: "demo",
    name: t.name,
    year: t.year,
    poster: art("poster", t.slug),
    backdrop: art("backdrop", t.slug),
    overview: t.overview,
    genres: t.genres,
    rating: t.rating,
    category: t.quality,
    upstreamId: t.slug,
    url: clip(t.quality.startsWith("2160p") ? "hevc-2160p23976-eac3.mkv" : "h264-1080p25-aac.mp4"),
    added: now - i * 86_400_000,
  }));
  ctx.db.run("DELETE FROM vod");
  for (const e of vod) ctx.db.run("INSERT INTO vod (id, kind, source_id, name_norm, year, data) VALUES (?, ?, ?, ?, ?, ?)", e.id, e.kind, e.sourceId, normaliseTitle(e.name), e.year ?? null, JSON.stringify(e));

  const ref = (slug: string): TitleRef => {
    const t = TITLES.find((x) => x.slug === slug)!;
    return { id: `demo:${t.kind}:${t.slug}`, kind: t.kind, name: t.name, year: t.year, poster: art("poster", slug), backdrop: art("backdrop", slug) };
  };
  ctx.db.run("DELETE FROM progress");
  ctx.progress.save({ key: "title:demo:movie:copper-sky", positionMs: 48 * 60_000, durationMs: 128 * 60_000, title: ref("copper-sky") }, now - 3_600_000);
  ctx.progress.save({ key: "title:demo:series:northern-line", positionMs: 21 * 60_000, durationMs: 58 * 60_000, title: { ...ref("northern-line"), subtitle: "S1 E4 · The Last Stop" } }, now - 86_400_000);
  ctx.progress.save({ key: "title:demo:movie:paper-moons", positionMs: 30 * 60_000, durationMs: 96 * 60_000, title: ref("paper-moons") }, now - 2 * 86_400_000);

  // Recordings, a series link, a reminder and a clash.
  ctx.db.run("DELETE FROM recordings");
  ctx.db.run("DELETE FROM series_links");
  const bbc1 = channels[0]!;
  const tonight = (title: string) => programmes.find((p) => p.channelId === bbc1.id && p.title === title && p.start >= today.getTime() && p.start < today.getTime() + 86_400_000);
  const link: SeriesLink = { id: "demo-link-1", seriesKey: `t:${normaliseTitle("Harbour Lights")}`, title: "Harbour Lights", channelId: bbc1.id, channelName: bbc1.name, scope: "any", newOnly: false, keepLatest: 0, paddingBeforeMin: 2, paddingAfterMin: 5, createdAt: now - 20 * 86_400_000 };
  ctx.recordings.saveLink(link);
  const rec = (id: string, p: Programme, status: Recording["status"], extra: Partial<Recording> = {}): Recording => ({
    id,
    programme: p,
    channelId: p.channelId,
    channelName: channels.find((c) => c.id === p.channelId)?.name ?? "",
    status,
    method: "live",
    start: p.start - 120_000,
    end: p.end + 300_000,
    incomplete: false,
    watched: false,
    positionMs: 0,
    createdAt: now - 86_400_000,
    ...extra,
  });
  const hl = tonight("Harbour Lights");
  if (hl) ctx.recordings.save(rec("demo-r1", hl, hl.end < now ? "completed" : hl.start <= now ? "recording" : "scheduled", { seriesLinkId: link.id, method: "catchup" }));
  const lm = tonight("Lakeside Murders");
  if (lm) ctx.recordings.save(rec("demo-r2", lm, lm.end < now ? "completed" : "scheduled"));
  // A clash with Lakeside Murders on ITV1, to show the one-connection prompt.
  const itv = channels.find((c) => c.name === "ITV1")!;
  const clash = lm ? programmes.find((p) => p.channelId === itv.id && p.start < lm.end && p.end > lm.start) : undefined;
  if (clash && lm && lm.end > now) ctx.recordings.save(rec("demo-r3", clash, "scheduled"));

  const done = (title: string, daysAgo: number, season: number, episode: number, sub: string, channelIdx: number, watched = false) => {
    const c = channels[channelIdx]!;
    const s = today.getTime() - daysAgo * 86_400_000 + 20 * 3_600_000;
    const p = demoProgramme(c, s, 60, title, { season, episode, subtitle: sub }, DESCRIPTIONS[episode % DESCRIPTIONS.length]!);
    const extra: Partial<Recording> = { path: path.join(config.clipsDir, "h264-1080p25-aac.mp4"), sizeBytes: 2.4e9, watched, positionMs: episode === 3 ? 22 * 60_000 : 0 };
    if (title === "Harbour Lights") extra.seriesLinkId = link.id;
    // Advert breaks found by comskip, for the Skip adverts button.
    if (title === "Wild Islands") Object.assign(extra, { adBreaks: [{ startMs: 1000, endMs: 4 * 60_000 }, { startMs: 22 * 60_000, endMs: 25 * 60_000 }], adScan: "done" });
    return rec(`demo-done-${slugOf(title)}-${episode}`, p, "completed", extra);
  };
  for (const r of [
    done("Harbour Lights", 7, 3, 3, "High Tide", 0),
    done("Harbour Lights", 14, 3, 2, "Nets", 0, true),
    done("Wild Islands", 2, 1, 5, "Sea Cliffs", 22),
    done("Northern Line", 3, 2, 1, "Mind the Gap", 3),
    done("Kitchen Rivals", 4, 4, 6, "The Final", 2),
    done("The Quiet Fen", 5, 1, 3, "Low Water", 1),
  ]) {
    ctx.recordings.save(r);
  }

  // Downloads.
  ctx.db.run("DELETE FROM downloads");
  const dl = (id: string, title: string, status: string, progress: number, total: number) =>
    ctx.db.run("INSERT INTO downloads (id, status, created_at, data) VALUES (?, ?, ?, ?)", id, status, now, JSON.stringify({ id, title, kind: "movie", year: 2024, status, progress, bytesDone: Math.round(total * progress), bytesTotal: total, speedBps: status === "downloading" ? 48_000_000 : undefined, createdAt: now, request: { title, kind: "movie" } }));
  dl("demo-d1", "Copper Sky", "downloading", 0.46, 31e9);
  dl("demo-d2", "Glasshouse", "completed", 1, 18e9);

  seedDemoMix(ctx, clip("h264-1080p25-aac.mp4"), now);
}

/** The starter made-up channels (music videos and Spooky TV's atmosphere), filled with their picks as if downloaded (playing a test clip). */
function seedDemoMix(ctx: HubContext, clipUrl: string, now: number): void {
  const mix = ctx.mix;
  mix.seed(MIX_SEEDS, now - 3 * 86_400_000);
  const file = clipUrl.startsWith("/clips/") ? clipUrl : "/clips/h264-1080p25-aac.mp4";
  for (const c of mix.store.channels()) {
    const r = rand(c.id);
    const ambience = c.style === "ambience";
    c.picks.slice(0, ambience ? c.target : c.id === "mix:halloween-tv" ? 24 : 30).forEach((pick, i) => {
      const [artist, track] = ambience ? [] : pick.split(" - ");
      const id = `demo${hash(pick)}`;
      const status = c.id === "mix:halloween-tv" && i >= 20 ? (i === 23 ? "downloading" : "queued") : "ready";
      if (!mix.store.video(id)) {
        // Atmosphere clips run long: that's what keeps the channel going.
        const durationS = ambience ? 900 + Math.floor(r() * 1800) : 180 + Math.floor(r() * 120);
        const height = r() > 0.4 ? 2160 : 1080;
        mix.store.saveVideo({
          id,
          url: `https://www.youtube.com/watch?v=${id}`,
          title: ambience ? `${pick.replace(/\b\w/, (ch) => ch.toUpperCase())} (4K)` : `${pick} (Official Video)`,
          ...(artist && track ? { artist, track } : {}),
          uploader: ambience ? "Night Atmospheres" : `${artist ?? "Artist"}VEVO`,
          durationS,
          height,
          status,
          // About what YouTube's VP9/AV1 runs to: 4K near 2.5 MB a second, 1080p near 0.6.
          ...(status === "ready" ? { path: file, sizeBytes: Math.round(durationS * (height >= 2160 ? 2.5e6 : 0.6e6)) } : {}),
          ...(status === "downloading" ? { progress: 0.62 } : {}),
          addedAt: now - 2 * 86_400_000 + i,
        });
      }
      mix.store.addEntry(c.id, id, `pick: ${pick}`, now - 2 * 86_400_000 + i);
    });
    const fresh = mix.store.channel(c.id)!;
    fresh.curatedAt = now - 3_600_000;
    mix.store.saveChannel(fresh);
    mix.syncRow(c.id);
    ctx.guide.dropFrom(c.id);
    ctx.db.run("DELETE FROM kv WHERE key = ?", `mix-bag:${c.id}`);
    // The schedule starts a while back, so the guide shows what has played.
    mix.extend(c.id, now - 3 * 3_600_000);
    mix.extend(c.id, now);
  }
}

function demoProgramme(c: Channel, start: number, mins: number, title: string, extra: Partial<Programme>, description: string, year?: number): Programme {
  const film = c.category === "films";
  const p: Programme = {
    id: `${c.id}:${start}`,
    channelId: c.id,
    start,
    end: start + mins * 60_000,
    title,
    description,
    categories: film ? ["Film"] : [c.category === "entertainment" ? "Drama" : c.category],
    isNew: false,
    isRepeat: false,
    isFilm: film,
    seriesKey: `t:${normaliseTitle(title)}`,
    image: `/api/art/still/${slugOf(title)}.svg`,
    ...extra,
  };
  if (year) p.year = year;
  if (p.season !== undefined && p.episode !== undefined) p.episodeKey = `${p.seriesKey}|s${p.season}e${p.episode}`;
  return p;
}

const EPISODE_NAMES = ["The Arrival", "Low Tide", "Old Debts", "The Last Stop", "Undertow", "Lights Out", "Crossing", "Home Waters", "The Long Night", "Safe Harbour", "Second Chances", "Full Circle"];

/** Two series of six episodes for each demo series, with stills and a little watch history. */
export function demoSeasons(slug: string): Season[] {
  return [1, 2].map((season) => ({
    season,
    name: `Series ${season}`,
    episodes: Array.from({ length: 6 }, (_, i) => {
      const episode = i + 1;
      const ep: Episode = {
        id: `demo:episode:${slug}:${season}:${episode}`,
        season,
        episode,
        name: EPISODE_NAMES[(season - 1) * 6 + i]!,
        overview: DESCRIPTIONS[(season * 7 + episode) % DESCRIPTIONS.length]!,
        still: `/api/art/still/${slug}-s${season}e${episode}.svg`,
        runtimeMin: 58,
      };
      if (season === 1 && episode < 4) ep.watched = true;
      if (season === 1 && episode === 4) ep.progress = 0.36;
      return ep;
    }),
  }));
}
