// Updating the Hub from the phone. The Hub can't rebuild its own container, so it leaves a request
// file in its data volume; a systemd path unit on the Docker LXC (installed by tools/hub/update.sh)
// sees it and runs update.sh there, writing how it went back into the same folder.
//
//   <data>/update/helper   the helper is installed (written by update.sh)
//   <data>/update/request  the phone asked for an update (removed when it starts)
//   <data>/update/running  an update is running
//   <data>/update/result   "ok 2026-10-25T10:00:00+00:00" or "failed …"
//   <data>/update/last.log update.sh's output

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HubSoftware, SoftwareChange } from "@ultimatetv/shared";

const REPO = process.env.HUB_REPO ?? "gazoscalvertos/UltimateTV";
const CHECK_EVERY_MS = 5 * 60_000;
/** After a failed check, wait this long before asking GitHub again (the cached answer is shown meanwhile). */
const RETRY_AFTER_MS = 60_000;

export class SelfUpdate {
  private readonly dir: string;
  /** The last answer GitHub gave. Kept when a later check fails, so the phone shows it instead of "Couldn't check". */
  private latest?: { sha: string; at: number };
  private failedAt = 0;
  /** A check already on its way: the phone page, the TV and "Check again" share it. */
  private checking?: Promise<void>;
  private compared?: { key: string; behind: number; changes: SoftwareChange[] };

  constructor(
    dataDir: string,
    private readonly build: { commit?: string | undefined; date?: string | undefined },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.dir = path.join(dataDir, "update");
  }

  async status(check: boolean): Promise<HubSoftware> {
    const sw: HubSoftware = {
      canUpdate: existsSync(path.join(this.dir, "helper")),
      updating: existsSync(path.join(this.dir, "request")) || existsSync(path.join(this.dir, "running")),
    };
    if (this.build.commit) sw.commit = this.build.commit;
    if (this.build.date) sw.date = this.build.date;
    const result = (await readFile(path.join(this.dir, "result"), "utf8").catch(() => "")).trim();
    const m = /^(ok|failed)\s+(\S+)/.exec(result);
    if (m) sw.lastUpdate = { ok: m[1] === "ok", at: m[2]! };
    // Without `check` this answers from the cache, so a quick refresh doesn't lose what GitHub said.
    if (check) await this.check();
    const latest = this.latest?.sha;
    if (!latest) return sw;
    sw.latest = latest;
    sw.checkedAt = new Date(this.latest!.at).toISOString();
    if (sw.commit && !latest.startsWith(sw.commit)) {
      const diff = check ? await this.compare(sw.commit, latest) : this.compared?.key === `${sw.commit}...${latest}` ? this.compared : undefined;
      if (diff) Object.assign(sw, { behind: diff.behind, changes: diff.changes });
    } else sw.behind = 0;
    return sw;
  }

  async request(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, "request"), `${new Date().toISOString()}\n`);
  }

  async log(): Promise<string> {
    return readFile(path.join(this.dir, "last.log"), "utf8").catch(() => "");
  }

  /** What's on main that the running Hub doesn't have: merged pull requests by title, else commit subjects. */
  private async compare(from: string, to: string): Promise<{ behind: number; changes: SoftwareChange[] } | undefined> {
    const key = `${from}...${to}`;
    if (this.compared?.key === key) return this.compared;
    try {
      const res = await this.fetchImpl(`https://api.github.com/repos/${REPO}/compare/${from}...${to}`, {
        headers: this.headers("application/vnd.github+json"),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { ahead_by?: number; commits?: { sha: string; commit: { message: string; committer?: { date?: string } } }[] };
      const commits = body.commits ?? [];
      const changes: SoftwareChange[] = [];
      for (const c of commits) {
        const [subject = "", ...rest] = c.commit.message.split("\n");
        const pr = /^Merge pull request #(\d+)/.exec(subject);
        if (!pr) continue;
        const title = rest.map((l) => l.trim()).find(Boolean) ?? subject;
        changes.push({ sha: c.sha, title, pr: Number(pr[1]), ...(c.commit.committer?.date ? { date: c.commit.committer.date } : {}) });
      }
      // Pushed straight to main, without pull requests: list the commits themselves.
      if (!changes.length) {
        for (const c of commits) {
          const subject = c.commit.message.split("\n")[0] ?? "";
          if (!/^Merge /.test(subject)) changes.push({ sha: c.sha, title: subject, ...(c.commit.committer?.date ? { date: c.commit.committer.date } : {}) });
        }
      }
      // Newest first, and only the last 20.
      this.compared = { key, behind: body.ahead_by ?? commits.length, changes: changes.reverse().slice(0, 20) };
      return this.compared;
    } catch {
      return undefined;
    }
  }

  /** Refreshes the latest commit on main, at most every 5 minutes, and once a minute while GitHub isn't answering. */
  private check(): Promise<void> {
    const now = Date.now();
    if (this.latest && now - this.latest.at < CHECK_EVERY_MS) return Promise.resolve();
    if (now - this.failedAt < RETRY_AFTER_MS) return Promise.resolve();
    this.checking ??= (async () => {
      try {
        // The API allows 60 unauthenticated calls an hour; git's own endpoint isn't limited that way.
        const sha = (await this.fromApi()) ?? (await this.fromGit());
        if (sha) this.latest = { sha, at: Date.now() };
        else this.failedAt = Date.now();
      } finally {
        this.checking = undefined;
      }
    })();
    return this.checking;
  }

  private headers(accept: string): Record<string, string> {
    const h: Record<string, string> = { Accept: accept, "User-Agent": "UltimateTV-Hub" };
    if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return h;
  }

  private async fromApi(): Promise<string | undefined> {
    try {
      const res = await this.fetchImpl(`https://api.github.com/repos/${REPO}/commits/main`, {
        headers: this.headers("application/vnd.github.sha"),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return undefined;
      const sha = (await res.text()).trim();
      return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
    } catch {
      return undefined;
    }
  }

  /** What `git ls-remote` asks for: the refs list from git's smart HTTP endpoint. */
  private async fromGit(): Promise<string | undefined> {
    try {
      const res = await this.fetchImpl(`https://github.com/${REPO}.git/info/refs?service=git-upload-pack`, {
        headers: {
          "User-Agent": "git/2.45 UltimateTV-Hub",
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString("base64")}` } : {}),
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return undefined;
      return /([0-9a-f]{40}) refs\/heads\/main\b/.exec(await res.text())?.[1];
    } catch {
      return undefined;
    }
  }
}
