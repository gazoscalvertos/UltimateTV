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

export class SelfUpdate {
  private readonly dir: string;
  private latest?: { sha: string; at: number };
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
    if (check) {
      const latest = await this.latestCommit();
      if (latest) sw.latest = latest;
      if (latest && sw.commit && !latest.startsWith(sw.commit)) {
        const diff = await this.compare(sw.commit, latest);
        if (diff) Object.assign(sw, diff);
      } else if (latest) sw.behind = 0;
    }
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
        headers: { Accept: "application/vnd.github+json", "User-Agent": "UltimateTV-Hub" },
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

  private async latestCommit(): Promise<string | undefined> {
    if (this.latest && Date.now() - this.latest.at < CHECK_EVERY_MS) return this.latest.sha;
    try {
      const res = await this.fetchImpl(`https://api.github.com/repos/${REPO}/commits/main`, {
        headers: { Accept: "application/vnd.github.sha", "User-Agent": "UltimateTV-Hub" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return undefined;
      const sha = (await res.text()).trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) return undefined;
      this.latest = { sha, at: Date.now() };
      return sha;
    } catch {
      return undefined;
    }
  }
}
