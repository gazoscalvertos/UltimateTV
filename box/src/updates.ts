// Over-the-air updates for the box. The installer leaves /etc/ultimatetv/version (the commit the
// box runs) and root services: ultimatetv-update (tools/box/update.sh) pulls the latest app and OS
// packages and restarts the TV session, ultimatetv-healthcheck checks the box works afterwards and
// rolls it back if not, and ultimatetv-rollback undoes the last update when asked. A polkit rule
// lets the tv user start the update and the roll back, so Settings and the phone can, without a
// keyboard. How the last update, its check and any roll back went is in /var/lib/ultimatetv/update.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BoxSoftware, BoxUpdateCheck, BoxUpdateHealth } from "@ultimatetv/shared";

const run = promisify(execFile);
/** The update asked for in Settings or on the phone, and the weekly one (it skips rolled back commits). */
const UNIT = "ultimatetv-update.service";
const AUTO_UNIT = "ultimatetv-update-auto.service";
const ROLLBACK_UNIT = "ultimatetv-rollback.service";
const STATE_DIR = "/var/lib/ultimatetv/update";

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

/** When a oneshot unit last finished, from `systemctl show`, as ISO (systemd's own text if it won't parse). */
function exitedAt(unit: Record<string, string>): string | undefined {
  const t = unit.ExecMainExitTimestamp;
  if (!t || t === "n/a") return undefined;
  const at = new Date(t.replace(/^\w+ /, "").replace(/ \w+$/, ""));
  return Number.isNaN(at.getTime()) ? t : at.toISOString();
}

/**
 * What the update scripts left in their state folder: the update that can be undone (last.env), its
 * health check (health.env), the last roll back (rollback.env). Pure, for the tests.
 */
export function updateRecords(files: { last?: string; health?: string; rollback?: string }): Pick<BoxSoftware, "health" | "canRollBack" | "rollbackTo" | "rollback"> {
  const out: Pick<BoxSoftware, "health" | "canRollBack" | "rollbackTo" | "rollback"> = {};
  const last = files.last ? parseKeyValues(files.last) : null;
  const health = files.health ? parseKeyValues(files.health) : null;
  if (last && (last.status === "checking" || last.status === "ok" || last.status === "failed" || last.status === "updating")) {
    out.canRollBack = last.status !== "updating" && Boolean(last.snapshot || last.from);
    if (last.from && last.from !== "unknown") out.rollbackTo = last.from;
    if (last.status !== "updating") {
      const h: BoxUpdateHealth = { status: last.status };
      // The check's result belongs to this update only if it came after it.
      if (health && last.status !== "checking") {
        if (health.at) h.at = health.at;
        if (health.summary) h.summary = health.summary;
        h.checks = checksFrom(health);
      }
      out.health = h;
    }
  }
  if (files.rollback) {
    const r = parseKeyValues(files.rollback);
    if (r.at) {
      out.rollback = { at: r.at, reason: r.reason ?? "", manual: r.manual === "1", ok: r.ok === "1", how: r.how === "app" ? "app" : "snapshot" };
      if (r.from) out.rollback.from = r.from;
      if (r.to) out.rollback.to = r.to;
      // A roll back leaves no update to check, but its health check (when that was why) still explains it.
      if (!out.health && health && !out.rollback.manual) out.health = { status: "failed", ...(health.at ? { at: health.at } : {}), ...(health.summary ? { summary: health.summary } : {}), checks: checksFrom(health) };
    }
  }
  return out;
}

function checksFrom(health: Record<string, string>): BoxUpdateCheck[] {
  return Object.entries(health)
    .filter(([k]) => k.startsWith("check."))
    .map(([k, v]) => ({ name: k.slice("check.".length), ok: v.startsWith("1"), detail: v.replace(/^[01] /, "") }));
}

export class Updates {
  /** The last check that worked, kept so a failed or skipped check still shows it. */
  private latest?: { key: string; sha: string; at: string };
  /** A check on its way: asks at the same time share it. */
  private checking?: Promise<void>;

  constructor(private readonly log: (line: string) => void) {}

  /** What the box runs, whether a newer version is out (when it can tell) and how the last update went. */
  async status(check: boolean): Promise<BoxSoftware> {
    const v = parseKeyValues(await readFile("/etc/ultimatetv/version", "utf8").catch(() => ""));
    const sw: BoxSoftware = { updating: false };
    if (v.commit && v.commit !== "unknown") sw.commit = v.commit;
    if (v.date) sw.date = v.date;
    if (v.branch) sw.branch = v.branch;
    const show = (name: string) =>
      run("systemctl", ["show", name, "-p", "ActiveState", "-p", "Result", "-p", "ExecMainExitTimestamp"], { timeout: 5000 })
        .then((r) => parseKeyValues(r.stdout))
        .catch(() => ({}) as Record<string, string>);
    const busy = (u: Record<string, string>) => u.ActiveState === "activating" || u.ActiveState === "active";
    const [manual, weekly, rollback] = await Promise.all([show(UNIT), show(AUTO_UNIT), show(ROLLBACK_UNIT)]);
    sw.updating = busy(manual) || busy(weekly);
    if (busy(rollback)) sw.rollingBack = true;
    // The later of the two updates is the last one.
    const finished = [manual, weekly]
      .map((u) => ({ at: exitedAt(u), ok: u.Result === "success" }))
      .filter((u): u is { at: string; ok: boolean } => Boolean(u.at))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (finished[0]) sw.lastUpdate = finished[0];
    const read = (name: string) => readFile(path.join(STATE_DIR, name), "utf8").catch(() => undefined);
    const [last, health, rolled] = await Promise.all([read("last.env"), read("health.env"), read("rollback.env")]);
    Object.assign(sw, updateRecords({ ...(last ? { last } : {}), ...(health ? { health } : {}), ...(rolled ? { rollback: rolled } : {}) }));
    if (v.repo && v.branch) {
      const key = `${v.repo}#${v.branch}`;
      if (check) await this.check(v.repo, v.branch);
      if (this.latest?.key === key) {
        sw.latest = this.latest.sha;
        sw.checkedAt = this.latest.at;
      }
    }
    return sw;
  }

  private check(repo: string, branch: string): Promise<void> {
    this.checking ??= (async () => {
      try {
        // A private repository needs root's stored token, so an unanswered check keeps the last answer.
        const sha = await run("git", ["ls-remote", repo, `refs/heads/${branch}`], { timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
          .then((r) => remoteCommit(r.stdout, branch))
          .catch((e: Error) => (this.log(`Update check failed: ${e.message}`), undefined));
        if (sha) this.latest = { key: `${repo}#${branch}`, sha, at: new Date().toISOString() };
      } finally {
        this.checking = undefined;
      }
    })();
    return this.checking;
  }

  /** Starts the update. The TV session restarts when it's done, a few minutes later. */
  async start(): Promise<void> {
    this.log("Starting an update");
    await run("systemctl", ["start", "--no-block", UNIT], { timeout: 10_000 });
  }

  /** Undoes the last update; the box reboots when it's done. */
  async rollBack(): Promise<void> {
    this.log("Rolling back the last update");
    await run("systemctl", ["start", "--no-block", ROLLBACK_UNIT], { timeout: 10_000 });
  }

  /** The last lines from the update, its health check and roll backs, for the Hub's diagnostics. */
  async history(): Promise<string[]> {
    const text = await readFile(path.join(STATE_DIR, "update.log"), "utf8").catch(() => "");
    return text.trim() ? text.trim().split("\n").slice(-80) : [];
  }
}
