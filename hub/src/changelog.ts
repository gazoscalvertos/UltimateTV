// What's new: the CHANGELOG.md this Hub was built with, served to the TV, the phone remote, the
// setup page and the Android app (which pop up the entries they haven't shown yet).

import { readFile, stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { parseChangelog, unseenChanges, type Changelog } from "@ultimatetv/shared";

export class ChangelogFile {
  private cached?: { mtimeMs: number; log: Changelog };

  constructor(private readonly file: string) {}

  /** Read again only when the file changes (a dev Hub), else the parsed copy. Empty when it's missing. */
  async read(): Promise<Changelog> {
    const info = await stat(this.file).catch(() => null);
    if (!info) return { releases: [] };
    if (this.cached?.mtimeMs !== info.mtimeMs) this.cached = { mtimeMs: info.mtimeMs, log: parseChangelog(await readFile(this.file, "utf8")) };
    return this.cached.log;
  }
}

export function registerChangelog(app: FastifyInstance, file: ChangelogFile, build: { commit?: string | undefined }): void {
  // Open to anyone on the network, like /api/health: it's the same file as on GitHub.
  //   ?seen=<id>  also answers `unseen`: the entries after the one the app showed last (an empty
  //               id, for an app that has shown none, gets the newest day's). The phone remote, the
  //               setup page and the Android app use it so they needn't parse anything themselves.
  //   ?limit=N    keeps the newest N sections; `latest` is always the newest entry.
  app.get<{ Querystring: { seen?: string; limit?: string } }>("/api/changelog", async (req) => {
    const log = await file.read();
    const limit = Number(req.query.limit);
    const releases = Number.isInteger(limit) && limit > 0 ? log.releases.slice(0, limit) : log.releases;
    return {
      ...log,
      releases,
      ...(req.query.seen !== undefined ? { unseen: unseenChanges(log, req.query.seen) } : {}),
      ...(build.commit ? { commit: build.commit } : {}),
    };
  });
}
