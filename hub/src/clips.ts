import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface Clip {
  /** Path relative to the clips folder, used in the /clips/ URL. */
  file: string;
  title: string;
  /** What the clip is meant to test, e.g. "Dolby Vision P8 in MKV, 23.976p". */
  tests?: string;
  sizeBytes: number;
}

const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".m4v", ".ts", ".m2ts", ".webm", ".mov"]);

interface ManifestEntry {
  file: string;
  title?: string;
  tests?: string;
}

/**
 * Lists test clips in the clips folder (top level only). An optional clips.json
 * manifest gives friendly titles and what each clip tests, and sets the order.
 */
export async function listClips(dir: string): Promise<Clip[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const manifest = await readManifest(path.join(dir, "clips.json"));
  const files = names.filter((n) => VIDEO_EXTENSIONS.has(path.extname(n).toLowerCase()));
  const order = new Map(manifest.map((m, i) => [m.file, i]));
  files.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));

  const clips: Clip[] = [];
  for (const file of files) {
    const info = await stat(path.join(dir, file));
    if (!info.isFile()) continue;
    const entry = manifest.find((m) => m.file === file);
    clips.push({ file, title: entry?.title ?? file, tests: entry?.tests, sizeBytes: info.size });
  }
  return clips;
}

async function readManifest(file: string): Promise<ManifestEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is ManifestEntry => typeof e?.file === "string");
  } catch {
    return [];
  }
}
