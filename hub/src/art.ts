// Art mode's paintings. The Hub asks museums that give their images away for paintings in the
// collections the household chose, downloads each at about the TV's size (4K, never blown up), and
// keeps them on disk with their details. The TV then shows them from the Hub: smooth, and still
// working with no internet. Sources, all with free public APIs and open licences:
//   - Art Institute of Chicago: public-domain works are CC0, IIIF images at any size
//   - The Metropolitan Museum of Art: Open Access works are CC0, full-size originals
//   - Cleveland Museum of Art: Open Access works are CC0, print-size JPEGs (about 3400 px)

import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ART_COLLECTIONS, ART_SOURCES, kidsFriendlyTitle, type ArtCollection, type ArtItem, type ArtSourceId, type ArtStatus, type ScreensaverSettings } from "@ultimatetv/shared";
import { fetchJson, fetchOk, type Fetch } from "./http.js";
import type { Logger } from "./log.js";

/** The TV is 3840×2160: pictures are fetched to fit that, and never made bigger. */
export const ART_MAX_W = 3840;
export const ART_MAX_H = 2160;
const USER_AGENT = "UltimateTV-Hub/1.0 (home TV art screensaver; personal use)";
const MIN_BYTES = 40_000;
const MAX_BYTES = 40 * 1024 * 1024;
/** Files over this are shrunk to the TV's size (Met originals can be tens of megabytes). */
const SHRINK_OVER = 6 * 1024 * 1024;
const PER_SEARCH = 30;

export interface ArtCandidate {
  source: ArtSourceId;
  sourceId: string;
  title: string;
  artist: string;
  date: string;
  page: string;
  imageUrl: string;
}

type Searcher = (term: string, page: number, fetchImpl: Fetch) => Promise<ArtCandidate[]>;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Art Institute of Chicago: public-domain paintings with an image, at the TV's size via IIIF. */
export const searchAic: Searcher = async (term, page, fetchImpl) => {
  const q = new URLSearchParams({ q: term, "query[term][is_public_domain]": "true", fields: "id,title,artist_title,date_display,image_id,artwork_type_title,is_public_domain", limit: String(PER_SEARCH), page: String(page) });
  const json = await fetchJson<{ data?: Record<string, unknown>[] }>(`https://api.artic.edu/api/v1/artworks/search?${q}`, fetchImpl, { headers: { "User-Agent": USER_AGENT, "AIC-User-Agent": USER_AGENT } }, 20_000);
  return (json.data ?? [])
    .filter((d) => d.is_public_domain === true && d.artwork_type_title === "Painting" && typeof d.image_id === "string")
    .map((d) => ({
      source: "aic" as const,
      sourceId: String(d.id),
      title: clean(d.title),
      artist: clean(d.artist_title),
      date: clean(d.date_display),
      page: `https://www.artic.edu/artworks/${d.id}`,
      // "!w,h" fits inside the box and, as IIIF does, never enlarges.
      imageUrl: `https://www.artic.edu/iiif/2/${d.image_id}/full/!${ART_MAX_W},${ART_MAX_H}/0/default.jpg`,
    }));
};

/** Cleveland Museum of Art: CC0 paintings; the "print" image is about 3400 px, "web" about 1200. */
export const searchCma: Searcher = async (term, page, fetchImpl) => {
  const q = new URLSearchParams({ q: term, type: "Painting", cc0: "1", has_image: "1", limit: String(PER_SEARCH), skip: String((page - 1) * PER_SEARCH), fields: "id,title,creators,creation_date,images,url" });
  const json = await fetchJson<{ data?: { id: number; title?: string; creators?: { description?: string }[]; creation_date?: string; url?: string; images?: { print?: { url?: string }; web?: { url?: string } } }[] }>(`https://openaccess-api.clevelandart.org/api/artworks/?${q}`, fetchImpl, { headers: { "User-Agent": USER_AGENT } }, 20_000);
  const out: ArtCandidate[] = [];
  for (const d of json.data ?? []) {
    const imageUrl = d.images?.print?.url || d.images?.web?.url;
    if (!imageUrl) continue;
    out.push({
      source: "cma",
      sourceId: String(d.id),
      title: clean(d.title),
      // "Claude Monet (French, 1840–1926)" → "Claude Monet"
      artist: clean(d.creators?.[0]?.description).replace(/\s*\(.*$/, ""),
      date: clean(d.creation_date),
      page: d.url || `https://www.clevelandart.org/art/${d.id}`,
      imageUrl,
    });
  }
  return out;
};

/** The Met: a search gives ids, then each object says whether it's public domain and where its image is. */
export const searchMet: Searcher = async (term, page, fetchImpl) => {
  const q = new URLSearchParams({ q: term, hasImages: "true", isPublicDomain: "true", medium: "Paintings" });
  const found = await fetchJson<{ objectIDs?: number[] | null }>(`https://collectionapi.metmuseum.org/public/collection/v1/search?${q}`, fetchImpl, { headers: { "User-Agent": USER_AGENT } }, 20_000);
  const ids = (found.objectIDs ?? []).slice((page - 1) * PER_SEARCH, page * PER_SEARCH);
  const out: ArtCandidate[] = [];
  // Gently: a few at a time (the Met allows 80 requests a second; this is far under).
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(
      ids.slice(i, i + 4).map((id) =>
        fetchJson<Record<string, unknown>>(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, fetchImpl, { headers: { "User-Agent": USER_AGENT } }, 20_000).catch(() => null),
      ),
    );
    for (const d of batch) {
      if (!d || d.isPublicDomain !== true || typeof d.primaryImage !== "string" || !d.primaryImage || !/painting/i.test(clean(d.classification) || clean(d.objectName))) continue;
      out.push({ source: "met", sourceId: String(d.objectID), title: clean(d.title), artist: clean(d.artistDisplayName), date: clean(d.objectDate), page: clean(d.objectURL) || `https://www.metmuseum.org/art/collection/search/${d.objectID}`, imageUrl: d.primaryImage });
    }
  }
  return out;
};

const SEARCHERS: Record<ArtSourceId, Searcher> = { aic: searchAic, met: searchMet, cma: searchCma };

/** Shrinks a picture to fit the TV with ffmpeg (a missing ffmpeg leaves it as it is). */
export type Shrink = (file: string, out: string) => Promise<boolean>;
export const ffmpegShrink: Shrink = (file, out) =>
  new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-i", file, "-vf", `scale=w='min(${ART_MAX_W},iw)':h='min(${ART_MAX_H},ih)':force_original_aspect_ratio=decrease:flags=lanczos`, "-q:v", "2", out], { stdio: "ignore" });
    const timer = setTimeout(() => ff.kill("SIGKILL"), 120_000);
    ff.on("error", () => resolve(false));
    ff.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });

interface StoredItem extends ArtItem {
  bytes: number;
  added: number;
}
interface Index {
  items: StoredItem[];
  /** Which page of each search to ask for next, so another fetch finds different paintings. */
  pass: number;
}

export interface ArtOptions {
  dir: string;
  fetchImpl: Fetch;
  log: Logger;
  settings: () => ScreensaverSettings;
  shrink?: Shrink;
  /** The searchers, for tests. */
  searchers?: Partial<Record<ArtSourceId, Searcher>>;
}

const idOf = (c: ArtCandidate) => `${c.source}-${c.sourceId}`.replace(/[^a-z0-9-]/gi, "");

export class ArtGallery {
  private index: Index | null = null;
  private running: Promise<void> | null = null;
  private lastError: string | undefined;
  private lastRun: number | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly o: ArtOptions) {}

  private get file() {
    return path.join(this.o.dir, "index.json");
  }
  imagePath(id: string): string {
    return path.join(this.o.dir, `${id.replace(/[^a-z0-9-]/gi, "")}.jpg`);
  }

  private async load(): Promise<Index> {
    if (this.index) return this.index;
    try {
      const j = JSON.parse(await readFile(this.file, "utf8")) as Partial<Index>;
      this.index = { items: Array.isArray(j.items) ? j.items : [], pass: typeof j.pass === "number" ? j.pass : 1 };
    } catch {
      this.index = { items: [], pass: 1 };
    }
    return this.index;
  }
  private async save(): Promise<void> {
    await mkdir(this.o.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.index));
    await rename(tmp, this.file);
  }

  /** The collections to fetch for: those chosen (all when none), only the kids' ones in Kids-friendly mode. */
  selected(s = this.o.settings()): ArtCollection[] {
    const chosen = ART_COLLECTIONS.filter((c) => s.artCollections.length === 0 || s.artCollections.includes(c.id));
    const list = s.artKids ? chosen.filter((c) => c.kids) : chosen;
    return list.length ? list : ART_COLLECTIONS.filter((c) => c.kids);
  }

  /** What the TV shows: the kept paintings in the chosen collections, in order by artist. */
  async list(opts: { kids?: boolean } = {}): Promise<ArtItem[]> {
    const s = this.o.settings();
    const wanted = new Set(this.selected(s).map((c) => c.id));
    const kids = opts.kids || s.artKids;
    const items = (await this.load()).items
      .filter((i) => i.collections.some((c) => wanted.has(c)) && (!kids || i.kids))
      .map(({ bytes: _b, added: _a, ...item }) => item);
    return items.sort((a, b) => a.artist.localeCompare(b.artist) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }

  async status(): Promise<ArtStatus> {
    const idx = await this.load();
    return {
      cached: idx.items.length,
      target: this.o.settings().artCount,
      bytes: idx.items.reduce((n, i) => n + i.bytes, 0),
      running: this.running !== null,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.lastRun ? { lastRun: this.lastRun } : {}),
      collections: ART_COLLECTIONS,
      sources: ART_SOURCES,
    };
  }

  /** Daily top-up (and soon after the Hub starts), only while an art-showing screensaver is chosen. */
  start(first = 90_000): void {
    const go = () => {
      const t = this.o.settings().theme;
      if (t === "gallery" || t === "shuffle") void this.refill().catch(() => undefined);
    };
    setTimeout(go, first).unref();
    this.timer = setInterval(go, 24 * 3_600_000);
    this.timer.unref();
  }
  stop(): void {
    clearInterval(this.timer);
  }

  /** Fetches paintings until each chosen collection has its share of the target. Runs one at a time. */
  refill(): Promise<void> {
    this.running ??= this.fill().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async fill(): Promise<void> {
    const idx = await this.load();
    const s = this.o.settings();
    const cols = this.selected(s);
    const quota = Math.ceil(s.artCount / cols.length);
    this.lastError = undefined;
    let added = 0;
    let failures = 0;
    try {
      for (const col of cols) {
        const have = () => idx.items.filter((i) => i.collections.includes(col.id)).length;
        for (const term of [...col.terms].sort(() => Math.random() - 0.5)) {
          for (const source of ART_SOURCES) {
            if (have() >= quota || idx.items.length >= s.artCount) break;
            let found: ArtCandidate[];
            try {
              found = await (this.o.searchers?.[source.id] ?? SEARCHERS[source.id])(term, idx.pass, this.o.fetchImpl);
            } catch (err) {
              failures++;
              this.lastError = `${source.name}: ${err instanceof Error ? err.message : String(err)}`;
              this.o.log.warn({ source: source.id, term, err: String(err) }, "Art search failed");
              continue;
            }
            for (const c of found.sort(() => Math.random() - 0.5)) {
              if (have() >= quota || idx.items.length >= s.artCount) break;
              const id = idOf(c);
              const known = idx.items.find((i) => i.id === id);
              if (known) {
                if (!known.collections.includes(col.id)) known.collections.push(col.id);
                known.kids ||= col.kids && kidsFriendlyTitle(known.title);
                continue;
              }
              try {
                const bytes = await this.download(c, id);
                idx.items.push({ id, title: c.title || "Untitled", artist: c.artist || "Unknown artist", date: c.date, source: c.source, page: c.page, collections: [col.id], kids: col.kids && kidsFriendlyTitle(c.title), bytes, added: Date.now() });
                added++;
                // Saved as we go, so a stopped Hub keeps what it has.
                if (added % 5 === 0) await this.save();
              } catch (err) {
                failures++;
                this.o.log.debug({ id, err: String(err) }, "Art download skipped");
              }
            }
          }
        }
      }
    } finally {
      idx.pass = idx.pass >= 6 ? 1 : idx.pass + 1;
      await this.prune(s);
      this.lastRun = Date.now();
      await this.save();
      this.o.log.info({ added, failures, kept: idx.items.length }, "Art gallery fetch finished");
    }
  }

  private async download(c: ArtCandidate, id: string): Promise<number> {
    await mkdir(this.o.dir, { recursive: true });
    const res = await fetchOk(c.imageUrl, this.o.fetchImpl, { headers: { "User-Agent": USER_AGENT } }, 180_000);
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) throw new Error("Not an image");
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Too big");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) throw new Error(`Odd size (${buf.length} bytes)`);
    const dest = this.imagePath(id);
    const tmp = `${dest}.part`;
    await writeFile(tmp, buf);
    if (buf.length > SHRINK_OVER) {
      const shrunk = `${dest}.small.jpg`;
      if (await (this.o.shrink ?? ffmpegShrink)(tmp, shrunk)) {
        await rename(shrunk, tmp);
      } else if (buf.length > 20 * 1024 * 1024) {
        await rm(tmp, { force: true });
        await rm(shrunk, { force: true });
        throw new Error("Couldn't shrink a very large picture");
      }
    }
    await rename(tmp, dest);
    return (await stat(dest)).size;
  }

  /** Over the target: first the ones outside the chosen collections, then the oldest. */
  private async prune(s: ScreensaverSettings): Promise<void> {
    const idx = await this.load();
    if (idx.items.length <= s.artCount) return;
    const wanted = new Set(this.selected(s).map((c) => c.id));
    const rank = (i: StoredItem) => (i.collections.some((c) => wanted.has(c)) ? 1 : 0);
    idx.items.sort((a, b) => rank(a) - rank(b) || a.added - b.added);
    const drop = idx.items.splice(0, idx.items.length - s.artCount);
    await Promise.all(drop.map((i) => rm(this.imagePath(i.id), { force: true })));
  }

  /** Forgets every painting (Settings › Screensaver › Clear). */
  async clear(): Promise<void> {
    const idx = await this.load();
    await Promise.all(idx.items.map((i) => rm(this.imagePath(i.id), { force: true })));
    idx.items = [];
    await this.save();
  }
}
