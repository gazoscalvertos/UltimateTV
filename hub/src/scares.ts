// Jump scares and projected clips: a short clip cut in over whatever is on, now and then, until
// someone turns it off. In October it's a jump scare; in December a snowman walking along the
// bottom of the screen; at Easter a bunny hopping across. The Hub keeps the settings (so the TV
// and every phone agree), the clips (uploaded from the phone or brought in with a pack) and the
// clips built from them: a picture or video and a sound, placed somewhere on the screen, perhaps
// moving, for an occasion. The TV decides when a random one lands, because only it knows what's
// playing; the phone can also set one off at once with POST /api/scares/now, or have the TV play
// them one after another like a window projector (POST /api/scares/loop).
//
// Packs (see clippacks.ts) carry built clips and their files between Hubs: exported from the
// phone, shared with a link and QR code, downloaded from the community list, or the starter packs
// that ship in hub/packs.
//
// Nothing is ever shown on a Kids profile: the TV app leaves clips off there.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import {
  CLIP_MOTIONS,
  PROJECTION_MOTIONS,
  SEASON_IDS,
  CLIP_THEME_NAMES,
  CLIP_THEMES,
  cleanScareSettings,
  clipSeasonFor,
  DEFAULT_SCARE_SETTINGS,
  mixTheme,
  SCARE_SIZES,
  SCARE_SPOTS,
  scareFrom,
  type ClipLibrary,
  type ClipMotion,
  type ClipPackFile,
  type ClipPackListing,
  type ClipTheme,
  type InstalledClipPack,
  type ProjectionMotion,
  type ScareClip,
  type ScareMix,
  type ScareSettings,
  type ScareState,
  type SeasonId,
} from "@ultimatetv/shared";
import { BadPack, checkClipFile, checkIndex, checkPack, CLIP_TYPES, download, LIBRARY_HOSTS, MAX_PACK_BYTES, packFile, packSlug, sha256, type CheckedPack, type CommunityEntry } from "./clippacks.js";
import type { HubContext } from "./context.js";
import { sendFile } from "./streaming.js";

const DEFAULT_NAMES: Record<ScareClip["kind"], string> = { video: "Clip", image: "Picture", audio: "Sound" };
/** Built clips kept, not counting the ones that came with packs. */
const MAX_MIXES = 40;
const MAX_UPLOAD = 200 * 1024 * 1024;
/** Uploaded clips kept (not counting packs'); the oldest goes when a new one makes it too many. */
const MAX_CLIPS = 40;
/** Packs kept at once. */
const MAX_PACKS = 20;
/** Share links kept; the oldest goes first. */
const MAX_SHARES = 20;
/** How long the community list is kept before it's read again. */
const LIBRARY_TTL_MS = 30 * 60_000;
/**
 * Served with every clip: nothing in a clip may run or load anything, even if someone opens an
 * SVG picture straight in a browser rather than in the TV's <img>.
 */
const CLIP_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; media-src 'self'; sandbox";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A clip as the Hub keeps it: what the phone sees, plus the file it's in. */
export interface StoredClip extends ScareClip {
  file: string;
}

/** What a clip is for: a jump scare or a built clip's part (the default), or a seasonal projection (projections.ts). */
export interface ClipUse {
  projection?: boolean;
  season?: SeasonId | "any";
  motion?: ProjectionMotion;
  communityId?: string;
}

/** The clip library, shared by jump scares, built clips and seasonal projections. */
export interface ClipStore {
  dir: string;
  all(): StoredClip[];
  keep(body: Buffer, type: string, name: string, use?: ClipUse): Promise<StoredClip>;
  update(id: string, patch: ClipUse & { name?: string }): StoredClip | undefined;
  remove(id: string): Promise<boolean>;
}

/** Keeps a clip's projection fields sane whoever sent them. */
export function cleanUse(input: Record<string, unknown>): ClipUse {
  const use: ClipUse = {};
  const flag = input.projection;
  if (flag !== undefined) use.projection = flag === true || flag === "1" || flag === "true";
  if (input.season !== undefined) use.season = SEASON_IDS.includes(input.season as SeasonId) ? (input.season as SeasonId) : "any";
  if (PROJECTION_MOTIONS.includes(input.motion as ProjectionMotion)) use.motion = input.motion as ProjectionMotion;
  return use;
}

/** A share link: which built clips, packed up when someone opens it. */
interface ClipShare {
  id: string;
  name: string;
  theme: ClipTheme;
  mixIds: string[];
  createdAt: number;
}

type Req = FastifyRequest<{ Params: { id?: string }; Querystring: Record<string, string | undefined>; Body: unknown }>;

const objectBody = (req: Req): Record<string, unknown> => (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? (req.body as Record<string, unknown>) : {});
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const typeOfFile = (file: string): string => Object.entries(CLIP_TYPES).find(([, ext]) => file.endsWith(ext))?.[0] ?? "application/octet-stream";

export interface ScareOptions {
  /** Where the starter packs are (hub/packs). */
  packsDir?: string;
  /** The address a phone reaches the Hub at, for share links. */
  phoneBase?: (req: FastifyRequest) => string;
}

export async function registerScares(app: FastifyInstance, ctx: HubContext, dataDir: string, opts: ScareOptions = {}): Promise<ClipStore> {
  const clipDir = path.join(dataDir, "scare-clips");
  await mkdir(clipDir, { recursive: true });
  const packsDir = opts.packsDir ?? path.resolve(here, "../packs");
  const phoneBase = opts.phoneBase ?? ((req: FastifyRequest) => `${req.protocol}://${req.headers.host ?? req.hostname}`);

  const settings = (): ScareSettings => cleanScareSettings(ctx.db.getKv<Partial<ScareSettings>>("scares") ?? {}, DEFAULT_SCARE_SETTINGS);
  const clips = (): StoredClip[] => (ctx.db.getKv<StoredClip[]>("scare-clips") ?? []).slice().sort((a, b) => b.addedAt - a.addedAt);
  const saveClips = (list: StoredClip[]) => ctx.db.setKv("scare-clips", list);
  const shown = (c: StoredClip): ScareClip => {
    const { file: _file, ...clip } = c;
    return clip;
  };
  const mixes = (): ScareMix[] => (ctx.db.getKv<ScareMix[]>("scare-mixes") ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const saveMixes = (list: ScareMix[]) => ctx.db.setKv("scare-mixes", list);
  const packs = (): InstalledClipPack[] => (ctx.db.getKv<InstalledClipPack[]>("clip-packs") ?? []).slice().sort((a, b) => b.installedAt - a.installedAt);
  const savePacks = (list: InstalledClipPack[]) => ctx.db.setKv("clip-packs", list);
  const shares = (): ClipShare[] => ctx.db.getKv<ClipShare[]>("clip-shares") ?? [];
  /** The TV is playing this occasion's clips one after another; not kept over a restart. */
  let looping: ClipTheme | null = null;
  const state = (): ScareState => {
    const s = settings();
    return { settings: s, clips: clips().filter((c) => !c.projection).map(shown), mixes: mixes(), packs: packs(), season: clipSeasonFor(s.season), looping };
  };

  // Files left behind by a Hub that was restored from a backup without its clips, and the other
  // way round: a clip whose file has gone is no use, so it's dropped from the list on start.
  const files = new Set(await readdir(clipDir).catch(() => [] as string[]));
  const kept = clips().filter((c) => files.has(c.file));
  if (kept.length !== clips().length) saveClips(kept);

  const removeFile = (c: StoredClip) => unlink(path.join(clipDir, c.file)).catch(() => undefined);

  /** Writes a clip's file and says what to keep for it; the caller saves the list. */
  const store = async (body: Buffer, said: string, name: string, packId?: string, use: ClipUse = {}): Promise<StoredClip> => {
    const { ext, kind } = checkClipFile(body, said);
    const id = randomBytes(8).toString("hex");
    const file = `${id}${ext}`;
    await writeFile(path.join(clipDir, file), body);
    return {
      id,
      file,
      name: name.replace(/\s+/g, " ").trim().slice(0, 60) || DEFAULT_NAMES[kind],
      kind,
      url: `/api/scares/clips/${id}`,
      sizeBytes: body.length,
      addedAt: Date.now(),
      ...(packId ? { packId } : {}),
      ...(use.projection ? { projection: true, season: use.season ?? "any", motion: use.motion ?? "across-top" } : {}),
      ...(use.communityId ? { communityId: use.communityId } : {}),
    };
  };

  /** Keeps an uploaded clip; the oldest uploaded one goes when there are too many (packs' are left alone). */
  const keep = async (body: Buffer, type: string, name: string, use: ClipUse = {}): Promise<StoredClip> => {
    const clip = await store(body, type, name, undefined, use);
    const all = [clip, ...clips()];
    const loose = all.filter((c) => !c.packId);
    const dropped = new Set(loose.slice(MAX_CLIPS).map((c) => c.id));
    for (const old of all.filter((c) => dropped.has(c.id))) await removeFile(old);
    saveClips(all.filter((c) => !dropped.has(c.id)));
    return clip;
  };

  const changed = () => ctx.events.emit({ type: "scares.changed" });

  const remove = async (id: string): Promise<boolean> => {
    const clip = clips().find((c) => c.id === id);
    if (!clip) return false;
    saveClips(clips().filter((c) => c.id !== clip.id));
    await removeFile(clip);
    // Built clips lose it; one left with nothing in it goes too.
    const without = (m: ScareMix): ScareMix => {
      const { visualId, audioId, ...rest } = m;
      return { ...rest, ...(visualId && visualId !== clip.id ? { visualId } : {}), ...(audioId && audioId !== clip.id ? { audioId } : {}) };
    };
    saveMixes(mixes().map(without).filter((m) => m.visualId || m.audioId));
    changed();
    if (clip.projection) ctx.events.emit({ type: "projections.changed" });
    return true;
  };

  const update = (id: string, patch: ClipUse & { name?: string }): StoredClip | undefined => {
    const list = clips();
    const clip = list.find((c) => c.id === id);
    if (!clip) return undefined;
    const name = patch.name?.replace(/\s+/g, " ").trim().slice(0, 60);
    if (name) clip.name = name;
    if (patch.projection !== undefined) {
      if (patch.projection) {
        clip.projection = true;
        clip.season = patch.season ?? clip.season ?? "any";
        clip.motion = patch.motion ?? clip.motion ?? "across-top";
      } else {
        delete clip.projection;
        delete clip.season;
        delete clip.motion;
      }
    } else if (clip.projection) {
      if (patch.season) clip.season = patch.season;
      if (patch.motion) clip.motion = patch.motion;
    }
    saveClips(list);
    changed();
    ctx.events.emit({ type: "projections.changed" });
    return clip;
  };

  /** Sends a clip to the TV: the built clip or uploaded clip asked for, else one of the occasion's at random. */
  const fire = (want: { clipId?: string; mixId?: string; theme?: ClipTheme }, byHand: boolean) => {
    const scare = scareFrom(state(), want, byHand);
    if (!scare) {
      const theme = want.theme ?? clipSeasonFor(settings().season);
      const why = want.mixId ? "That one has been deleted" : want.clipId ? "That clip has gone" : `Nothing for ${CLIP_THEME_NAMES[theme]} yet: add a pack or build one`;
      throw Object.assign(new Error(why), { statusCode: 404 });
    }
    ctx.events.emit({ type: "scare", scare });
    return scare;
  };

  const theme = (v: unknown): ClipTheme | undefined => (CLIP_THEMES.includes(v as ClipTheme) ? (v as ClipTheme) : undefined);

  /** A built clip as sent, checked against the clips it names. */
  const cleanMix = (input: Partial<ScareMix>): ScareMix => {
    const list = clips();
    const visual = typeof input.visualId === "string" && input.visualId ? list.find((c) => c.id === input.visualId) : undefined;
    const audio = typeof input.audioId === "string" && input.audioId ? list.find((c) => c.id === input.audioId) : undefined;
    if (input.visualId && (!visual || visual.kind === "audio")) throw new BadPack("Pick a picture or video for it");
    if (input.audioId && (!audio || audio.kind !== "audio")) throw new BadPack("Pick a sound for it");
    if (!visual && !audio) throw new BadPack("Pick a picture or video, a sound, or both");
    const seconds = Number(input.seconds);
    const motion = CLIP_MOTIONS.includes(input.motion as ClipMotion) ? input.motion! : "still";
    return {
      id: randomBytes(6).toString("hex"),
      name: String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || [visual?.name, audio?.name].filter(Boolean).join(" + "),
      ...(visual ? { visualId: visual.id } : {}),
      ...(audio ? { audioId: audio.id } : {}),
      spot: SCARE_SPOTS.includes(input.spot as ScareMix["spot"]) ? input.spot! : "full",
      size: SCARE_SIZES.includes(input.size as ScareMix["size"]) ? input.size! : "medium",
      muteVideo: Boolean(input.muteVideo),
      // Walking across an 85-inch screen takes longer than a jump scare: up to a minute.
      seconds: Number.isFinite(seconds) ? Math.min(60, Math.max(0, Math.round(seconds))) : 0,
      createdAt: Date.now(),
      theme: theme(input.theme) ?? clipSeasonFor(settings().season),
      ...(motion !== "still" ? { motion } : {}),
    };
  };

  // ---------------------------------------------------------------------------
  // Packs

  /** Takes a pack's clips and built clips away, files and all. */
  const removePack = async (id: string): Promise<boolean> => {
    const pack = packs().find((p) => p.id === id);
    const all = clips();
    const theirs = all.filter((c) => c.packId === id);
    if (!pack && !theirs.length) return false;
    for (const c of theirs) await removeFile(c);
    saveClips(all.filter((c) => c.packId !== id));
    saveMixes(mixes().filter((m) => m.packId !== id));
    savePacks(packs().filter((p) => p.id !== id));
    return true;
  };

  /** Brings a checked pack in, replacing one with the same id. */
  const installPack = async (pack: CheckedPack, source: InstalledClipPack["source"]): Promise<InstalledClipPack> => {
    if (!packs().some((p) => p.id === pack.id) && packs().length >= MAX_PACKS) throw new BadPack(`That's ${MAX_PACKS} packs already: remove one first`);
    await removePack(pack.id);
    const made: StoredClip[] = [];
    try {
      for (const c of pack.clips) made.push(await store(c.data, c.type, c.name, pack.id));
    } catch (e) {
      for (const c of made) await removeFile(c);
      throw e;
    }
    const byKey = new Map(pack.clips.map((c, i) => [c.key, made[i]!.id]));
    const now = Date.now();
    const built: ScareMix[] = pack.mixes.map((m, i) => ({
      id: randomBytes(6).toString("hex"),
      name: m.name,
      ...(m.visual ? { visualId: byKey.get(m.visual)! } : {}),
      ...(m.audio ? { audioId: byKey.get(m.audio)! } : {}),
      spot: m.spot,
      size: m.size,
      muteVideo: m.muteVideo,
      seconds: m.seconds,
      // Kept in the pack's order, newest first.
      createdAt: now - i,
      theme: m.theme,
      ...(m.motion !== "still" ? { motion: m.motion } : {}),
      packId: pack.id,
    }));
    const record: InstalledClipPack = {
      id: pack.id,
      name: pack.name,
      theme: pack.theme,
      ...(pack.description ? { description: pack.description } : {}),
      ...(pack.author ? { author: pack.author } : {}),
      source,
      installedAt: now,
      clipIds: made.map((c) => c.id),
      mixIds: built.map((m) => m.id),
      sizeBytes: pack.sizeBytes,
    };
    saveClips([...made, ...clips()]);
    saveMixes([...built, ...mixes()]);
    savePacks([record, ...packs()]);
    changed();
    return record;
  };

  /** Packs built clips (and the files they use) into a pack file. */
  const exportPack = async (want: { name?: unknown; theme?: unknown; mixIds?: unknown; description?: unknown; author?: unknown }): Promise<ClipPackFile> => {
    const ids = Array.isArray(want.mixIds) ? want.mixIds.filter((x): x is string => typeof x === "string") : undefined;
    const t = theme(want.theme);
    const chosen = mixes().filter((m) => (ids ? ids.includes(m.id) : !t || mixTheme(m) === t));
    if (!chosen.length) throw new BadPack("Pick at least one to put in the pack");
    const packTheme = t ?? mixTheme(chosen[0]!);
    const name = String(want.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || `${CLIP_THEME_NAMES[packTheme]} clips`;
    const all = clips();
    const used = [...new Set(chosen.flatMap((m) => [m.visualId, m.audioId]).filter((x): x is string => Boolean(x)))];
    const files = [];
    for (const id of used) {
      const c = all.find((x) => x.id === id);
      if (!c) continue;
      files.push({ key: c.id, name: c.name, type: typeOfFile(c.file), data: await readFile(path.join(clipDir, c.file)) });
    }
    const total = files.reduce((a, f) => a + f.data.length, 0);
    if (total * 1.34 > MAX_PACK_BYTES) throw new BadPack("Those clips are too big for one pack: pick fewer, or shorter videos");
    return packFile(
      {
        id: `${packSlug(name)}-${randomBytes(3).toString("hex")}`,
        name,
        theme: packTheme,
        ...(typeof want.description === "string" && want.description.trim() ? { description: want.description.trim().slice(0, 300) } : {}),
        ...(typeof want.author === "string" && want.author.trim() ? { author: want.author.trim().slice(0, 60) } : {}),
      },
      files,
      chosen.map((m) => ({
        name: m.name,
        ...(m.visualId ? { visual: m.visualId } : {}),
        ...(m.audioId ? { audio: m.audioId } : {}),
        spot: m.spot,
        size: m.size,
        motion: m.motion ?? "still",
        muteVideo: m.muteVideo,
        seconds: m.seconds,
        theme: mixTheme(m),
      })),
    );
  };

  // The starter packs that ship with the Hub, read once.
  const starters = new Map<string, { file: string; listing: Omit<ClipPackListing, "installed"> }>();
  for (const file of (await readdir(packsDir).catch(() => [] as string[])).filter((f) => f.endsWith(".utvpack")).sort()) {
    try {
      const pack = checkPack(await readFile(path.join(packsDir, file)));
      starters.set(pack.id, {
        file,
        listing: { id: pack.id, name: pack.name, theme: pack.theme, ...(pack.description ? { description: pack.description } : {}), author: pack.author ?? "UltimateTV", sizeBytes: pack.sizeBytes, count: pack.mixes.length, scary: pack.theme === "halloween" },
      });
    } catch (e) {
      app.log.warn(`Starter pack ${file} skipped: ${(e as Error).message}`);
    }
  }

  // The community list, kept for a while.
  let community: { url: string; at: number; packs: CommunityEntry[]; error?: string } | undefined;
  const communityList = async (fresh = false) => {
    const url = settings().libraryUrl;
    if (!url) return { url, at: Date.now(), packs: [] as CommunityEntry[], error: "The community list is turned off" };
    if (!fresh && community && community.url === url && Date.now() - community.at < LIBRARY_TTL_MS) return community;
    try {
      const body = await download(url, { maxBytes: 1024 * 1024, timeoutMs: 15_000 });
      community = { url, at: Date.now(), packs: checkIndex(JSON.parse(body.toString()), url) };
    } catch (e) {
      community = { url, at: Date.now(), packs: [], error: e instanceof SyntaxError ? "The community list isn't JSON" : (e as Error).message };
    }
    return community;
  };

  const library = async (fresh: boolean): Promise<ClipLibrary> => {
    const installed = new Set(packs().map((p) => p.id));
    const list = await communityList(fresh);
    return {
      starter: [...starters.values()].map((s) => ({ ...s.listing, installed: installed.has(s.listing.id) })),
      community: {
        url: list.url,
        // The starter packs are on the community list too, for Hubs older than them; here they're listed once.
        packs: list.packs.filter((p) => !starters.has(p.id)).map(({ url: _url, sha256: _sha, ...p }) => ({ ...p, installed: installed.has(p.id) })),
        ...(list.error ? { error: list.error } : {}),
      },
    };
  };

  const sharePage = (share: ClipShare, base: string): string => {
    const all = clips();
    const list = mixes().filter((m) => share.mixIds.includes(m.id));
    const items = list
      .map((m) => {
        const visual = all.find((c) => c.id === m.visualId);
        const pic = visual?.kind === "image" ? `<img src="${esc(visual.url)}" alt="">` : visual?.kind === "video" ? `<video src="${esc(visual.url)}" muted loop autoplay playsinline></video>` : `<span class="snd">🔊</span>`;
        return `<li>${pic}<b>${esc(m.name)}</b></li>`;
      })
      .join("");
    const packUrl = `/api/scares/shares/${encodeURIComponent(share.id)}/pack`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(share.name)}</title>
<style>
:root{color-scheme:dark;--bg:#0b1220;--card:#16213a;--text:#eef2ff;--muted:#9aa7c7;--accent:#4f8cff}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,sans-serif;padding:24px 16px;max-width:640px;margin-inline:auto}
h1{font-size:1.5rem;margin:0 0 4px}p{color:var(--muted);margin:0 0 16px}
ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}
li{background:var(--card);border-radius:14px;padding:10px;display:grid;gap:8px;text-align:center}
li img,li video{width:100%;height:100px;object-fit:contain}.snd{font-size:3rem;line-height:100px}
a.btn{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:12px;margin:16px 0}
small{color:var(--muted)}
</style></head><body>
<h1>${esc(share.name)}</h1>
<p>${esc(CLIP_THEME_NAMES[share.theme])} · ${list.length} clip${list.length === 1 ? "" : "s"} for UltimateTV</p>
<ul>${items || "<li>These clips have been deleted.</li>"}</ul>
<a class="btn" href="${esc(packUrl)}" download>Download the pack</a>
<small>Send the file to a friend with UltimateTV: on their phone remote, Clips › Add a pack. Or paste this page's pack link there: ${esc(`${base}${packUrl}`)}</small>
</body></html>`;
  };

  // ---------------------------------------------------------------------------
  // Routes

  await app.register(async (scope) => {
    // A clip can be the request body itself (the phone's file picker, or curl --data-binary @clip.mp4),
    // and so can a pack file.
    scope.addContentTypeParser(/^(image|video|audio)\/|^application\/octet-stream/, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

    scope.get("/api/scares", async () => state());

    scope.put("/api/scares", async (req: Req) => {
      ctx.db.setKv("scares", cleanScareSettings(objectBody(req) as Partial<ScareSettings>, settings()));
      changed();
      return state();
    });

    scope.post("/api/scares/clips", { bodyLimit: MAX_UPLOAD }, async (req: Req, reply) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: "Send the clip as the request body" });
      const clip = await keep(req.body, String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase(), String(req.query.name ?? ""), cleanUse(req.query));
      changed();
      if (clip.projection) ctx.events.emit({ type: "projections.changed" });
      return { clip: shown(clip), clips: state().clips };
    });

    scope.get("/api/scares/clips/:id", async (req: Req, reply) => {
      const clip = clips().find((c) => c.id === req.params.id);
      if (!clip) return reply.code(404).send({ error: "That clip has gone" });
      reply.header("Cache-Control", "private, max-age=86400").header("Content-Security-Policy", CLIP_POLICY).header("X-Content-Type-Options", "nosniff");
      // ?download=1 saves it (to share it, or add it to the community library).
      if (req.query.download) reply.header("Content-Disposition", `attachment; filename="${clip.name.replace(/[^\w .-]+/g, "_")}${path.extname(clip.file)}"`);
      return sendFile(req, reply, path.join(clipDir, clip.file));
    });

    scope.delete("/api/scares/clips/:id", async (req: Req, reply) => {
      if (!(await remove(req.params.id ?? ""))) return reply.code(404).send({ error: "That clip has gone" });
      return { ok: true, clips: state().clips, mixes: state().mixes };
    });

    /** Renames a clip, or makes it a seasonal projection: { name, projection, season, motion }. */
    scope.patch("/api/scares/clips/:id", async (req: Req, reply) => {
      const b = objectBody(req) as Record<string, unknown> & { name?: string };
      const clip = update(req.params.id ?? "", { ...cleanUse(b), ...(typeof b.name === "string" ? { name: b.name } : {}) });
      if (!clip) return reply.code(404).send({ error: "That clip has gone" });
      return { clip: shown(clip), clips: state().clips };
    });

    /** Saves a clip built on the phone: { name, visualId, audioId, spot, size, motion, theme, muteVideo, seconds }. */
    scope.post("/api/scares/mixes", async (req: Req) => {
      const mix = cleanMix(objectBody(req) as Partial<ScareMix>);
      const all = [mix, ...mixes()];
      const own = all.filter((m) => !m.packId).slice(MAX_MIXES).map((m) => m.id);
      const list = all.filter((m) => !own.includes(m.id));
      saveMixes(list);
      changed();
      return { mix, mixes: list };
    });

    scope.delete("/api/scares/mixes/:id", async (req: Req, reply) => {
      if (!mixes().some((m) => m.id === req.params.id)) return reply.code(404).send({ error: "That one has been deleted" });
      saveMixes(mixes().filter((m) => m.id !== req.params.id));
      changed();
      return { ok: true, mixes: mixes() };
    });

    /** Show one now, from the phone. Works whether or not the random ones are turned on. */
    scope.post("/api/scares/now", async (req: Req) => {
      const body = objectBody(req);
      const pick = (v: unknown, q: string | undefined) => (typeof v === "string" && v ? v : q || undefined);
      const clipId = pick(body.clipId, req.query.clipId);
      const mixId = pick(body.mixId, req.query.mixId);
      const t = theme(pick(body.theme, req.query.theme));
      return { scare: fire({ ...(clipId ? { clipId } : {}), ...(mixId ? { mixId } : {}), ...(t ? { theme: t } : {}) }, true) };
    });

    /** The TV plays an occasion's clips one after another until told to stop: { theme } starts it, { theme: null } stops it. */
    scope.post("/api/scares/loop", async (req: Req, reply) => {
      const body = objectBody(req);
      if (body.theme === null || body.theme === "" || body.on === false) looping = null;
      else {
        const t = theme(body.theme) ?? clipSeasonFor(settings().season);
        if (!scareFrom(state(), { theme: t }, true)) return reply.code(404).send({ error: `Nothing for ${CLIP_THEME_NAMES[t]} yet: add a pack or build one` });
        looping = t;
      }
      changed();
      return state();
    });

    // Packs ----------------------------------------------------------------

    /** Brings in a pack file: the file itself as the body (JSON, or whatever the phone's file picker calls it). */
    scope.post("/api/scares/packs", { bodyLimit: MAX_PACK_BYTES }, async (req: Req) => {
      const pack = await installPack(checkPack(req.body), "file");
      return { pack, ...state() };
    });

    /** Brings in a pack from a link: { url }. */
    scope.post("/api/scares/packs/link", async (req: Req) => {
      const url = String(objectBody(req).url ?? "").trim();
      if (!/^https?:\/\/\S{1,500}$/.test(url)) throw new BadPack("Paste the pack's link (http or https)");
      const pack = await installPack(checkPack(await download(url)), "link");
      return { pack, ...state() };
    });

    scope.delete("/api/scares/packs/:id", async (req: Req, reply) => {
      if (!(await removePack(String(req.params.id)))) return reply.code(404).send({ error: "That pack isn't here" });
      changed();
      return state();
    });

    /** A pack file of built clips: { name, theme, mixIds, description, author }, downloaded. */
    scope.post("/api/scares/packs/export", async (req: Req, reply) => {
      const pack = await exportPack(objectBody(req));
      return reply
        .type("application/json")
        .header("Content-Disposition", `attachment; filename="${pack.id}.utvpack"`)
        .send(JSON.stringify(pack));
    });

    /** A share link for some built clips: { name, theme, mixIds }; the pack is made when it's opened. */
    scope.post("/api/scares/shares", async (req: Req) => {
      const body = objectBody(req);
      const ids = Array.isArray(body.mixIds) ? body.mixIds.filter((x): x is string => typeof x === "string") : [];
      const chosen = mixes().filter((m) => ids.includes(m.id));
      if (!chosen.length) throw new BadPack("Pick at least one to share");
      const t = theme(body.theme) ?? mixTheme(chosen[0]!);
      const share: ClipShare = {
        id: randomBytes(5).toString("hex"),
        name: String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || `${CLIP_THEME_NAMES[t]} clips`,
        theme: t,
        mixIds: chosen.map((m) => m.id),
        createdAt: Date.now(),
      };
      ctx.db.setKv("clip-shares", [share, ...shares()].slice(0, MAX_SHARES));
      const url = `${phoneBase(req)}/clips/share/${share.id}`;
      return { share: { ...share, url, packUrl: `${phoneBase(req)}/api/scares/shares/${share.id}/pack`, qr: `/api/scares/shares/${share.id}/qr.svg` } };
    });

    scope.get("/api/scares/shares/:id/pack", async (req: Req, reply) => {
      const share = shares().find((s) => s.id === req.params.id);
      if (!share) return reply.code(404).send({ error: "That share link has gone" });
      const pack = await exportPack({ name: share.name, theme: share.theme, mixIds: share.mixIds });
      return reply
        .type("application/json")
        .header("Content-Disposition", `attachment; filename="${packSlug(share.name)}.utvpack"`)
        .send(JSON.stringify(pack));
    });

    scope.get("/api/scares/shares/:id/qr.svg", async (req: Req, reply) => {
      const share = shares().find((s) => s.id === req.params.id);
      if (!share) return reply.code(404).send({ error: "That share link has gone" });
      const svg = await QRCode.toString(`${phoneBase(req)}/clips/share/${share.id}`, { type: "svg", margin: 1, color: { dark: "#0b1220", light: "#ffffff" } });
      return reply.type("image/svg+xml").header("Cache-Control", "private, max-age=600").send(svg);
    });

    scope.get("/clips/share/:id", async (req: Req, reply) => {
      const share = shares().find((s) => s.id === req.params.id);
      if (!share) return reply.code(404).type("text/plain").send("That share link has gone.");
      return reply.type("text/html").header("Cache-Control", "no-store").send(sharePage(share, phoneBase(req)));
    });

    // The library: starter packs and the community list -------------------

    scope.get("/api/scares/library", async (req: Req) => library(req.query.fresh === "1"));

    /** Installs a pack from the library: { id, from: "starter" | "community" }. */
    scope.post("/api/scares/library/install", async (req: Req, reply) => {
      const body = objectBody(req);
      const id = String(body.id ?? "");
      if (body.from === "community") {
        const entry = (await communityList()).packs.find((p) => p.id === id);
        if (!entry) return reply.code(404).send({ error: "That pack isn't on the community list any more" });
        const data = await download(entry.url, { hosts: LIBRARY_HOSTS });
        if (sha256(data) !== entry.sha256) throw new BadPack("That pack doesn't match the community list's checksum, so it wasn't added");
        const pack = checkPack(data);
        if (pack.id !== entry.id) throw new BadPack("That pack isn't the one the community list says it is");
        return { pack: await installPack(pack, "community"), ...state() };
      }
      const starter = starters.get(id);
      if (!starter) return reply.code(404).send({ error: "There's no starter pack by that name" });
      return { pack: await installPack(checkPack(await readFile(path.join(packsDir, starter.file))), "starter"), ...state() };
    });
  });

  return { dir: clipDir, all: clips, keep, update, remove };
}
