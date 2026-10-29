// Clip packs: built clips and the files they use, in one file (.utvpack) to share with a friend,
// keep as a backup, or put on the community list. A pack is JSON with each file inside it as
// base64, so there's no archive to unpack and nothing in it can land anywhere but the clip folder.
//
// Everything that comes in is checked here before the Hub keeps any of it: the format, the sizes,
// what each file really is (from its first bytes, not what the pack says), and that pictures in
// SVG carry no script or outside links. Anything else is refused whole.

import { createHash } from "node:crypto";
import { CLIP_MOTIONS, CLIP_THEMES, SCARE_SIZES, SCARE_SPOTS, type ClipMotion, type ClipPackFile, type ClipPackListing, type ClipTheme, type ScareClip, type ScareSize, type ScareSpot } from "@ultimatetv/shared";

/** The files a clip can be, and the extension each is kept with. */
export const CLIP_TYPES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/webm": ".weba",
};

export const kindOf = (type: string): ScareClip["kind"] => (type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : "image");

/** A pack file as big as the Hub takes (the base64 inside makes it a third bigger than its files). */
export const MAX_PACK_BYTES = 60 * 1024 * 1024;
/** Its files, added up, once decoded. */
export const MAX_PACK_FILES_BYTES = 40 * 1024 * 1024;
/** Any one file in a pack. */
export const MAX_PACK_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_PACK_CLIPS = 24;
export const MAX_PACK_MIXES = 24;

export class BadPack extends Error {
  readonly statusCode = 400;
}

/** Works out what a file is from its first bytes, whatever it says it is. */
export function sniff(b: Buffer): string | undefined {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = b.subarray(8, 12).toString("latin1");
    if (brand.startsWith("qt")) return "video/quicktime";
    return brand.startsWith("M4A") ? "audio/mp4" : "video/mp4";
  }
  if (b.subarray(0, 4).toString("hex") === "1a45dfa3") return "video/webm";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (b.subarray(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  // An MP3 starts with its ID3 tag, or straight in with a frame sync.
  if (b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  const head = b.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return undefined;
}

/**
 * Why an SVG picture can't be kept, or undefined when it's fine: no script, no event handlers, no
 * embedded web pages, no entities, and nothing loaded from anywhere else. The TV only ever shows
 * clips in an <img>, where none of that would run anyway, and the Hub serves them with a policy
 * that blocks it too; this is the third lock on the door.
 */
export function svgProblem(b: Buffer): string | undefined {
  const text = b.toString("utf8");
  if (/<script[\s>]/i.test(text)) return "it has a script in it";
  if (/<foreignObject[\s>]/i.test(text)) return "it has a web page inside it";
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return "it declares entities";
  if (/\son[a-z]+\s*=/i.test(text)) return "it has event handlers";
  if (/javascript:/i.test(text)) return "it has a javascript: link";
  // href, xlink:href and url() may point within the picture (#id) or at an inline data: picture only.
  for (const m of text.matchAll(/(?:href\s*=\s*["']|url\(\s*["']?)([^"')\s]*)/gi)) {
    const target = m[1] ?? "";
    if (target && !target.startsWith("#") && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(target)) return "it loads something from elsewhere";
  }
  if (/@import/i.test(text)) return "it loads a style sheet from elsewhere";
  return undefined;
}

/** Checks a file meant for a clip, and says what it really is. */
export function checkClipFile(body: Buffer, said: string): { type: string; ext: string; kind: ScareClip["kind"] } {
  const sniffed = sniff(body);
  let real = sniffed ?? (CLIP_TYPES[said] && said !== "image/svg+xml" ? said : undefined);
  // An M4A sound is an MP4 file too: what it says it is decides between the two.
  if (sniffed === "video/mp4" && said.startsWith("audio/") && CLIP_TYPES[said]) real = said;
  const ext = real && CLIP_TYPES[real];
  if (!real || !ext) throw new BadPack("Send an MP4, WebM or MOV video, a JPEG, PNG, GIF, WebP or SVG picture, or an MP3, OGG, WAV or M4A sound");
  if (real === "image/svg+xml") {
    const problem = svgProblem(body);
    if (problem) throw new BadPack(`That SVG picture can't be used: ${problem}`);
  }
  return { type: real, ext, kind: kindOf(real) };
}

/** A pack's clip, checked and decoded. */
export interface PackClip {
  key: string;
  name: string;
  type: string;
  kind: ScareClip["kind"];
  data: Buffer;
}

/** A pack's built clip, checked against the pack's own clips. */
export interface PackMix {
  name: string;
  visual?: string;
  audio?: string;
  spot: ScareSpot;
  size: ScareSize;
  motion: ClipMotion;
  muteVideo: boolean;
  seconds: number;
  theme: ClipTheme;
}

export interface CheckedPack {
  id: string;
  name: string;
  theme: ClipTheme;
  description?: string;
  author?: string;
  clips: PackClip[];
  mixes: PackMix[];
  sizeBytes: number;
}

/** Text from a pack, one line, without control characters, cut to length. */
const line = (v: unknown, max: number): string =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Lower-case letters, digits and dashes, from anything. */
export const packSlug = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "pack";

/** Reads and checks a pack file, refusing it whole if anything in it is wrong. */
export function checkPack(raw: Buffer | string | unknown): CheckedPack {
  let pack: Partial<ClipPackFile>;
  if (Buffer.isBuffer(raw) || typeof raw === "string") {
    const size = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(raw);
    if (size > MAX_PACK_BYTES) throw new BadPack(`That pack is too big: the most is ${MAX_PACK_BYTES / 1024 / 1024} MB`);
    try {
      pack = JSON.parse(raw.toString()) as Partial<ClipPackFile>;
    } catch {
      throw new BadPack("That isn't a clip pack (it isn't JSON)");
    }
  } else {
    pack = (raw ?? {}) as Partial<ClipPackFile>;
  }
  if (!pack || typeof pack !== "object" || pack.format !== "ultimatetv.clips") throw new BadPack("That isn't a clip pack");
  if (pack.version !== 1) throw new BadPack("That pack is from a newer version of the app: update the Hub first");
  const id = typeof pack.id === "string" && /^[a-z0-9][a-z0-9-]{1,47}$/.test(pack.id) ? pack.id : undefined;
  if (!id) throw new BadPack("The pack's id should be 2 to 48 lower-case letters, digits and dashes");
  const name = line(pack.name, 60);
  if (!name) throw new BadPack("The pack has no name");
  const theme = CLIP_THEMES.includes(pack.theme as ClipTheme) ? (pack.theme as ClipTheme) : undefined;
  if (!theme) throw new BadPack(`The pack's theme should be one of ${CLIP_THEMES.join(", ")}`);
  if (!Array.isArray(pack.clips) || !Array.isArray(pack.mixes)) throw new BadPack("The pack has no clips");
  if (pack.clips.length > MAX_PACK_CLIPS) throw new BadPack(`A pack can have ${MAX_PACK_CLIPS} files at most`);
  if (pack.mixes.length > MAX_PACK_MIXES) throw new BadPack(`A pack can have ${MAX_PACK_MIXES} built clips at most`);
  if (!pack.mixes.length) throw new BadPack("The pack has no built clips in it");

  let total = 0;
  const clips: PackClip[] = [];
  for (const [i, c] of pack.clips.entries()) {
    const key = typeof c?.key === "string" && /^[\w-]{1,40}$/.test(c.key) ? c.key : undefined;
    if (!key) throw new BadPack(`File ${i + 1} in the pack has no proper key`);
    if (clips.some((x) => x.key === key)) throw new BadPack(`Two files in the pack are both called "${key}"`);
    if (typeof c.data !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(c.data)) throw new BadPack(`"${key}" in the pack isn't base64`);
    const data = Buffer.from(c.data, "base64");
    if (!data.length) throw new BadPack(`"${key}" in the pack is empty`);
    if (data.length > MAX_PACK_FILE_BYTES) throw new BadPack(`"${key}" in the pack is too big: ${MAX_PACK_FILE_BYTES / 1024 / 1024} MB at most for one file`);
    total += data.length;
    if (total > MAX_PACK_FILES_BYTES) throw new BadPack(`The files in the pack add up to too much: ${MAX_PACK_FILES_BYTES / 1024 / 1024} MB at most`);
    let checked;
    try {
      checked = checkClipFile(data, String(c.type ?? "").toLowerCase());
    } catch (e) {
      throw new BadPack(`"${key}" in the pack: ${(e as Error).message}`);
    }
    clips.push({ key, name: line(c.name, 60) || key, type: checked.type, kind: checked.kind, data });
  }

  const mixes: PackMix[] = pack.mixes.map((m, i) => {
    const visual = m?.visual ? clips.find((c) => c.key === m.visual) : undefined;
    const audio = m?.audio ? clips.find((c) => c.key === m.audio) : undefined;
    if (m?.visual && (!visual || visual.kind === "audio")) throw new BadPack(`Built clip ${i + 1} in the pack wants a picture or video it doesn't have`);
    if (m?.audio && (!audio || audio.kind !== "audio")) throw new BadPack(`Built clip ${i + 1} in the pack wants a sound it doesn't have`);
    if (!visual && !audio) throw new BadPack(`Built clip ${i + 1} in the pack has nothing in it`);
    const seconds = Number(m.seconds);
    return {
      name: line(m.name, 60) || [visual?.name, audio?.name].filter(Boolean).join(" + "),
      ...(visual ? { visual: visual.key } : {}),
      ...(audio ? { audio: audio.key } : {}),
      spot: SCARE_SPOTS.includes(m.spot as ScareSpot) ? m.spot! : "full",
      size: SCARE_SIZES.includes(m.size as ScareSize) ? m.size! : "medium",
      motion: CLIP_MOTIONS.includes(m.motion as ClipMotion) ? m.motion! : "still",
      muteVideo: Boolean(m.muteVideo),
      seconds: Number.isFinite(seconds) ? Math.min(60, Math.max(0, Math.round(seconds))) : 0,
      theme: CLIP_THEMES.includes(m.theme as ClipTheme) ? m.theme! : theme,
    };
  });
  // Files no built clip uses are left out, rather than kept for nothing.
  const used = new Set(mixes.flatMap((m) => [m.visual, m.audio]).filter(Boolean));
  const kept = clips.filter((c) => used.has(c.key));
  const description = line(pack.description, 300);
  const author = line(pack.author, 60);
  return {
    id,
    name,
    theme,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    clips: kept,
    mixes,
    sizeBytes: kept.reduce((a, c) => a + c.data.length, 0),
  };
}

/** Writes a pack file from clips and built clips (the other way from checkPack). */
export function packFile(info: { id: string; name: string; theme: ClipTheme; description?: string; author?: string }, clips: { key: string; name: string; type: string; data: Buffer }[], mixes: ClipPackFile["mixes"]): ClipPackFile {
  return {
    format: "ultimatetv.clips",
    version: 1,
    id: info.id,
    name: info.name,
    theme: info.theme,
    ...(info.description ? { description: info.description } : {}),
    ...(info.author ? { author: info.author } : {}),
    createdAt: new Date().toISOString(),
    clips: clips.map((c) => ({ key: c.key, name: c.name, type: c.type, data: c.data.toString("base64") })),
    mixes,
  };
}

// ---------------------------------------------------------------------------
// The community list: an index.json the Hub reads (by default from this project's repository),
// naming packs with their size and checksum. A pack is only fetched from an address the list
// gives, only over https from GitHub, and only kept if its checksum matches.

/** Where a community pack may be downloaded from. */
export const LIBRARY_HOSTS = ["raw.githubusercontent.com", "github.com", "objects.githubusercontent.com", "media.githubusercontent.com"];

export interface CommunityEntry extends Omit<ClipPackListing, "installed"> {
  url: string;
  sha256: string;
}

/** Reads a community index, keeping only the entries that are sound; the rest are skipped. */
export function checkIndex(raw: unknown, indexUrl: string): CommunityEntry[] {
  const index = raw as { format?: unknown; packs?: unknown };
  if (!index || typeof index !== "object" || index.format !== "ultimatetv.clip-index" || !Array.isArray(index.packs)) throw new BadPack("That isn't a clip pack list");
  const out: CommunityEntry[] = [];
  for (const p of index.packs.slice(0, 200) as Record<string, unknown>[]) {
    const id = typeof p?.id === "string" && /^[a-z0-9][a-z0-9-]{1,47}$/.test(p.id) ? p.id : undefined;
    const name = line(p?.name, 60);
    const theme = CLIP_THEMES.includes(p?.theme as ClipTheme) ? (p.theme as ClipTheme) : undefined;
    const sha256 = typeof p?.sha256 === "string" && /^[0-9a-f]{64}$/.test(p.sha256) ? p.sha256 : undefined;
    const sizeBytes = Number(p?.sizeBytes);
    let url: URL | undefined;
    try {
      url = new URL(String(p?.url ?? ""), indexUrl);
    } catch {
      url = undefined;
    }
    if (!id || !name || !theme || !sha256 || !url || url.protocol !== "https:" || !LIBRARY_HOSTS.includes(url.hostname)) continue;
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PACK_BYTES) continue;
    if (out.some((x) => x.id === id)) continue;
    const description = line(p.description, 300);
    const author = line(p.author, 60);
    const count = Number(p.count);
    out.push({
      id,
      name,
      theme,
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      sizeBytes,
      ...(Number.isFinite(count) && count > 0 ? { count: Math.round(count) } : {}),
      scary: Boolean(p.scary),
      url: url.toString(),
      sha256,
    });
  }
  return out;
}

export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/**
 * Downloads a pack (or a list), refusing anything bigger than the most a pack may be. Follows
 * redirects only to https addresses on the given hosts, when there are any.
 */
export async function download(url: string, opts: { hosts?: string[]; maxBytes?: number; timeoutMs?: number; fetcher?: typeof fetch } = {}): Promise<Buffer> {
  const max = opts.maxBytes ?? MAX_PACK_BYTES;
  const fetcher = opts.fetcher ?? fetch;
  let target = new URL(url);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  for (let hop = 0; hop < 4; hop++) {
    if (target.protocol !== "https:" && target.protocol !== "http:") throw new BadPack("Only http and https links");
    if (opts.hosts && (target.protocol !== "https:" || !opts.hosts.includes(target.hostname))) throw new BadPack(`Packs on the community list only come from GitHub, not ${target.hostname}`);
    const res = await fetcher(target, { redirect: "manual", signal, headers: { Accept: "application/json, application/octet-stream" } }).catch((e: Error) => {
      throw new BadPack(`Couldn't download it: ${e.message}`);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      target = new URL(res.headers.get("location")!, target);
      continue;
    }
    if (!res.ok) throw new BadPack(`Couldn't download it: ${res.status} ${res.statusText}`);
    if (Number(res.headers.get("content-length") ?? 0) > max) throw new BadPack(`That's too big: the most is ${Math.round(max / 1024 / 1024)} MB`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body ?? []) {
      size += (chunk as Uint8Array).length;
      if (size > max) throw new BadPack(`That's too big: the most is ${Math.round(max / 1024 / 1024)} MB`);
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
  throw new BadPack("Too many redirects");
}
