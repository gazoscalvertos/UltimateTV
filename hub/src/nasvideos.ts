// Video files already on the NAS, for music channels: browsing the shares, and reading a file's
// length and picture size (ffprobe) and a still for the guide (ffmpeg).

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { NasListing } from "@ultimatetv/shared";

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi", ".ts", ".m2ts", ".mpg", ".mpeg", ".wmv", ".flv"]);

export const isVideoFile = (file: string) => VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase());

/** The id a NAS file gets in the music channel store: stable for the same path. */
export const nasVideoId = (file: string) => `nas-${createHash("sha1").update(file).digest("hex").slice(0, 16)}`;

/** "Cascada_-_Everytime.We.Touch [1080p].mkv" → artist and song where the name says them. */
export function titleFromFile(file: string): { title: string; artist?: string; track?: string } {
  let name = path.basename(file, path.extname(file));
  // Underscores and dots between words for spaces ("Mr. Brightside" keeps its dot).
  name = name.replace(/_+/g, " ").replace(/(?<=[\p{L}\p{N}])\.(?=[\p{L}\p{N}])/gu, " ");
  name = name
    .replace(/\s*[([](?:\d{3,4}p|4k|uhd|hd|hq|x26[45]|hevc|web-?dl|official[^)\]]*)[)\]]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = name.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) return { title: `${parts[0]} - ${parts.slice(1).join(" - ")}`, artist: parts[0], track: parts.slice(1).join(" - ") };
  return { title: name };
}

export interface ProbedVideo {
  durationS: number;
  height: number;
  fps?: number;
}

/** Reads a file's length, picture height and frame rate. */
export type VideoProbe = (file: string) => Promise<ProbedVideo>;

const run = (bin: string, args: string[], timeoutMs: number) =>
  new Promise<{ code: number; stdout: string }>((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", () => resolve({ code: -1, stdout: "" }));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout });
    });
  });

export const ffprobeVideo: VideoProbe = async (file) => {
  const r = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height,avg_frame_rate:format=duration", "-of", "json", file], 60_000);
  if (r.code !== 0) throw new Error("ffprobe couldn't read it");
  const j = JSON.parse(r.stdout) as { streams?: { height?: number; avg_frame_rate?: string }[]; format?: { duration?: string } };
  const s = j.streams?.[0];
  if (!s) throw new Error("It has no video in it");
  const [num, den] = (s.avg_frame_rate ?? "").split("/").map(Number);
  const out: ProbedVideo = { durationS: Math.round(Number(j.format?.duration) || 0), height: s.height ?? 0 };
  if (num && den) out.fps = Math.round((num / den) * 1000) / 1000;
  return out;
};

/** A still from a third of the way in, for the guide. False when ffmpeg couldn't make one. */
export async function grabStill(file: string, atS: number, out: string): Promise<boolean> {
  const r = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.max(0, Math.round(atS))), "-i", file, "-frames:v", "1", "-vf", "scale=640:-2", out], 60_000);
  return r.code === 0 && existsSync(out);
}

/**
 * The folders the Hub may read videos from: its media root and the other NAS shares mounted
 * beside it (/mnt/nas, /mnt/nas2 …). Nothing outside them can be added or played.
 */
export async function nasRoots(mediaRoot: string): Promise<string[]> {
  const roots = new Set<string>();
  const add = async (p: string) => {
    try {
      if ((await stat(p)).isDirectory()) roots.add(await realpath(p));
    } catch {
      // Not mounted.
    }
  };
  await add(mediaRoot);
  const parent = path.dirname(path.resolve(mediaRoot));
  if (parent === "/mnt") {
    for (const d of await readdir(parent).catch(() => [] as string[])) await add(path.join(parent, d));
  }
  return [...roots].sort();
}

/** The real path of `p` if it's inside one of the roots, else undefined. */
export async function insideRoots(p: string, roots: string[]): Promise<string | undefined> {
  if (!path.isAbsolute(p)) return undefined;
  const real = await realpath(p).catch(() => undefined);
  if (!real) return undefined;
  return roots.some((r) => real === r || real.startsWith(r.endsWith("/") ? r : `${r}/`)) ? real : undefined;
}

/** One folder's subfolders and video files; the roots themselves when `dir` is empty. */
export async function listNas(dir: string | undefined, roots: string[]): Promise<NasListing> {
  if (!dir) return { dir: "", folders: roots.map((r) => ({ name: r, path: r })), files: [] };
  const real = await insideRoots(dir, roots);
  if (!real) throw Object.assign(new Error("That folder isn't on the NAS"), { statusCode: 400 });
  const entries = await readdir(real, { withFileTypes: true });
  const folders: NasListing["folders"] = [];
  const files: NasListing["files"] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    if (e.name.startsWith(".") || e.name.startsWith("@")) continue;
    const p = path.join(real, e.name);
    if (e.isDirectory()) folders.push({ name: e.name, path: p });
    else if (e.isFile() && isVideoFile(e.name)) files.push({ name: e.name, path: p, sizeBytes: (await stat(p).catch(() => null))?.size ?? 0 });
  }
  const out: NasListing = { dir: real, folders, files };
  if (!roots.includes(real)) out.parent = path.dirname(real);
  return out;
}

/** Every video file in a folder and its subfolders (up to `limit`), in name order. */
export async function videosIn(dir: string, limit = 500): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, depth: number) => {
    if (out.length >= limit || depth > 6) return;
    const entries = (await readdir(d, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".") || e.name.startsWith("@")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.isFile() && isVideoFile(e.name)) out.push(p);
    }
  };
  await walk(dir, 0);
  return out;
}
