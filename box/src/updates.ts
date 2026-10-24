// Over-the-air updates for the box. The installer leaves /etc/ultimatetv/version (the commit the
// box runs) and a root service, ultimatetv-update, that pulls the latest app and OS packages and
// restarts the TV session. A polkit rule lets the tv user start that one service, so Settings can
// check for and install updates without a keyboard.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { BoxSoftware } from "@ultimatetv/shared";

const run = promisify(execFile);
const UNIT = "ultimatetv-update.service";

/** key=value lines, as in /etc/ultimatetv/version and `systemctl show`. */
export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** The commit at the tip of a branch, from `git ls-remote` output. */
export function remoteCommit(lsRemote: string, branch: string): string | undefined {
  return lsRemote
    .split("\n")
    .map((l) => l.split(/\s+/))
    .find(([, ref]) => ref === `refs/heads/${branch}`)?.[0];
}

export class Updates {
  constructor(private readonly log: (line: string) => void) {}

  /** What the box runs, whether a newer version is out (when it can tell) and how the last update went. */
  async status(check: boolean): Promise<BoxSoftware> {
    const v = parseKeyValues(await readFile("/etc/ultimatetv/version", "utf8").catch(() => ""));
    const sw: BoxSoftware = { updating: false };
    if (v.commit && v.commit !== "unknown") sw.commit = v.commit;
    if (v.date) sw.date = v.date;
    if (v.branch) sw.branch = v.branch;
    const unit = await run("systemctl", ["show", UNIT, "-p", "ActiveState", "-p", "Result", "-p", "ExecMainExitTimestamp"], { timeout: 5000 })
      .then((r) => parseKeyValues(r.stdout))
      .catch(() => ({}) as Record<string, string>);
    sw.updating = unit.ActiveState === "activating" || unit.ActiveState === "active";
    if (unit.ExecMainExitTimestamp && unit.ExecMainExitTimestamp !== "n/a") {
      const at = new Date(unit.ExecMainExitTimestamp.replace(/^\w+ /, "").replace(/ \w+$/, ""));
      sw.lastUpdate = { at: Number.isNaN(at.getTime()) ? unit.ExecMainExitTimestamp : at.toISOString(), ok: unit.Result === "success" };
    }
    if (check && v.repo && v.branch) {
      // A private repository needs root's stored token, so an unanswered check just shows as unknown.
      const latest = await run("git", ["ls-remote", v.repo, `refs/heads/${v.branch}`], { timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
        .then((r) => remoteCommit(r.stdout, v.branch!))
        .catch((e: Error) => (this.log(`Update check failed: ${e.message}`), undefined));
      if (latest) sw.latest = latest;
    }
    return sw;
  }

  /** Starts the update. The TV session restarts when it's done, a few minutes later. */
  async start(): Promise<void> {
    this.log("Starting an update");
    await run("systemctl", ["start", "--no-block", UNIT], { timeout: 10_000 });
  }
}
