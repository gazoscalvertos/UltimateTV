// The Samsung and LG TV apps keep their screens on the Hub (docs/tv-updates.md): the app on the TV is a
// small shell that asks /tv/<name>/manifest.json what the current files are and runs them, so updating
// the Hub updates the TVs and nobody reinstalls from a computer.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/** The order the app's scripts and style load in (the same order each app's index.html used). */
export const TV_APP_FILES = {
  scripts: ["js/util.js", "js/hub.js", "js/nav.js", "js/player.js", "js/app.js"],
  styles: ["css/app.css"],
};

export interface TvAppManifest {
  /** A short hash of every file: changes whenever any of them does, so the shell knows to fetch again. */
  version: string;
  scripts: string[];
  styles: string[];
}

export function tvAppManifest(dir: string): TvAppManifest | undefined {
  const files = [...TV_APP_FILES.styles, ...TV_APP_FILES.scripts];
  if (!files.every((f) => existsSync(path.join(dir, f)))) return undefined;
  const hash = createHash("sha1");
  for (const f of files) hash.update(f).update("\0").update(readFileSync(path.join(dir, f)));
  return { version: hash.digest("hex").slice(0, 12), scripts: TV_APP_FILES.scripts, styles: TV_APP_FILES.styles };
}

/**
 * A TV app installed as a package runs from a file or app address, which the browser engine treats as
 * a different origin from the Hub. Tizen's <access origin> lets it through; webOS may not, so the
 * Hub answers those apps (Origin "null" or file://, nothing a normal web page sends) the way a page on
 * the Hub itself would be answered. Every call still needs the device token.
 */
export function allowPackagedApps(app: FastifyInstance): void {
  const packaged = (origin: string | undefined) => origin !== undefined && (origin === "null" || /^(file|app|ms-appx-web|tizen|webos):/i.test(origin));
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (!packaged(origin) || !(req.url.startsWith("/api/") || req.url.startsWith("/tv/"))) return;
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Expose-Headers", "Content-Length, Content-Type");
    if (req.method === "OPTIONS") {
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Token, X-Profile, X-Profile-Token, X-Max-Height, X-Max-Bitrate, X-Codecs");
      reply.header("Access-Control-Max-Age", "600");
      return reply.code(204).send();
    }
  });
}

export function registerTvApps(app: FastifyInstance, dirs: Record<string, string | undefined>): void {
  for (const [name, dir] of Object.entries(dirs)) {
    if (!dir) continue;
    app.get(`/tv/${name}/manifest.json`, async (_req, reply) => {
      const m = tvAppManifest(dir);
      if (!m) return reply.code(404).send({ error: `The ${name} app's files aren't on this Hub.` });
      return reply.header("Cache-Control", "no-cache").send(m);
    });
  }
}
