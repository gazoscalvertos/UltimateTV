// The box's update, health check and roll back scripts (tools/box/update.sh, healthcheck.sh,
// rollback.sh), run for real against stand-ins for snapper, systemctl, pacman, git, mpv and curl.

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { heartbeatText } from "../src/heartbeat.js";
import { updateRecords } from "../src/updates.js";

const TOOLS = path.resolve(__dirname, "../../tools/box");
const OLD = "1111111111111111111111111111111111111111";
const NEW = "2222222222222222222222222222222222222222";

const FAKES: Record<string, string> = {
  snapper: `echo "snapper $*" >>"$FAKE/calls"
case "$*" in
  *undochange*) exit "\${SNAPPER_UNDO_RC:-0}" ;;
  *--print-number*) echo 42 ;;
esac`,
  systemctl: `echo "systemctl $*" >>"$FAKE/calls"`,
  pacman: `echo "pacman $*" >>"$FAKE/calls"; exit "\${PACMAN_RC:-0}"`,
  git: `echo "git $*" >>"$FAKE/calls"
case "$*" in
  *rev-parse*) cat "$FAKE/head" ;;
  *ls-remote*) printf '%s\\trefs/heads/main\\n' "$REMOTE" ;;
  *"reset --hard origin/"*) echo "$REMOTE" >"$FAKE/head" ;;
  *"reset --hard "*) echo "\${@: -1}" >"$FAKE/head" ;;
esac`,
  mpv: `echo "mpv" >>"$FAKE/calls"; exit "\${MPV_RC:-0}"`,
  curl: `exit "\${CURL_RC:-0}"`,
  docker: `exit 0`,
};

interface Box {
  root: string;
  state: string;
  calls: () => string[];
  run: (script: string, args?: string[], env?: Record<string, string>) => { status: number | null; out: string };
  file: (name: string) => string;
  write: (name: string, text: string) => void;
}

const boxes: string[] = [];
afterEach(() => {
  for (const b of boxes.splice(0)) rmSync(b, { recursive: true, force: true });
});

function box(opts: { head?: string; remote?: string } = {}): Box {
  const root = mkdtempSync(path.join(os.tmpdir(), "utv-rollback-"));
  boxes.push(root);
  const dir = (p: string) => (mkdirSync(path.join(root, p), { recursive: true }), path.join(root, p));
  const fake = dir("fake");
  const bin = dir("fakebin");
  const etc = dir("etc");
  const app = dir("app/tools/box");
  dir("boot");
  dir("dev");
  dir("keep");
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  // The installer stand-in: fails when told to.
  writeFileSync(path.join(app, "install.sh"), `echo "install KEEP_CHECKOUT=$KEEP_CHECKOUT" >>"$FAKE/calls"; exit "\${INSTALL_RC:-0}"\n`);
  // The real roll back, where the update and health check look for it.
  const usrbin = dir("usrbin");
  cpSync(path.join(TOOLS, "rollback.sh"), path.join(usrbin, "ultimatetv-rollback"));
  chmodSync(path.join(usrbin, "ultimatetv-rollback"), 0o755);
  writeFileSync(path.join(fake, "head"), `${opts.head ?? OLD}\n`);
  writeFileSync(path.join(etc, "update.env"), `APP_DIR=${path.join(root, "app")}\nBRANCH=main\nTV_USER=tv\n`);
  writeFileSync(path.join(etc, "box.env"), "HUB_URL=http://hub:8095\nHEALTH_WAIT=0\n");
  writeFileSync(path.join(root, "boot/vmlinuz-linux"), "old kernel");
  const state = path.join(root, "state");
  return {
    root,
    state,
    calls: () => (existsSync(path.join(fake, "calls")) ? readFileSync(path.join(fake, "calls"), "utf8").trim().split("\n") : []),
    file: (name) => readFileSync(path.join(root, name), "utf8"),
    write: (name, text) => {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), text);
    },
    run: (script, args = [], env = {}) => {
      const r = spawnSync("bash", [path.join(TOOLS, script), ...args], {
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: root,
          FAKE: fake,
          REMOTE: opts.remote ?? NEW,
          UTV_ETC: etc,
          UTV_STATE: state,
          UTV_BOOT: path.join(root, "boot"),
          UTV_DEV: path.join(root, "dev"),
          UTV_BIN: usrbin,
          UTV_LOCK: path.join(root, "lock"),
          UTV_KEEP: path.join(root, "keep"),
          UTV_HEARTBEAT: path.join(root, "heartbeat"),
          UTV_CLIP: path.join(root, "no-clip.mkv"),
          UTV_POLL: "0",
          ...env,
        },
      });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    },
  };
}

const keyValues = (text: string) => Object.fromEntries(text.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

describe("the box's update", () => {
  it("snapshots, keeps the kernel, installs, then restarts the app and starts the health check", () => {
    const b = box();
    b.write("dev/cec0", "");
    const r = b.run("update.sh");
    expect(r.status, r.out).toBe(0);
    const calls = b.calls();
    expect(calls).toContain("snapper -c root create --description before UltimateTV update --cleanup-algorithm number --print-number");
    expect(calls.indexOf("pacman -Syu --noconfirm")).toBeGreaterThan(calls.findIndex((c) => c.includes("--print-number")));
    expect(calls).toContain("install KEEP_CHECKOUT=1");
    expect(calls.slice(-2)).toEqual(["systemctl restart sddm", "systemctl start --no-block ultimatetv-healthcheck.service"]);
    const last = keyValues(b.file("state/last.env"));
    expect(last).toMatchObject({ status: "checking", snapshot: "42", from: OLD, to: NEW, auto: "0", cec: "1" });
    expect(Number(last.done)).toBeGreaterThan(0);
    expect(b.file("state/boot/vmlinuz-linux")).toBe("old kernel");
  });

  it("skips a commit that was rolled back, on the weekly run only", () => {
    const b = box();
    b.write("state/bad-commits", `${NEW}\n`);
    const weekly = b.run("update.sh", ["--auto"]);
    expect(weekly.status).toBe(0);
    expect(weekly.out).toContain("Skipped");
    expect(b.calls().some((c) => c.startsWith("pacman"))).toBe(false);
    const asked = b.run("update.sh");
    expect(asked.status, asked.out).toBe(0);
    expect(b.calls()).toContain("install KEEP_CHECKOUT=1");
  });

  it("rolls back at once when the new version doesn't install", () => {
    const b = box();
    const r = b.run("update.sh", ["--auto"], { INSTALL_RC: "1" });
    expect(r.status).toBe(1);
    expect(b.calls()).toContain("snapper -c root undochange 42..0");
    expect(b.calls()).toContain("systemctl reboot");
    expect(b.calls()).not.toContain("systemctl restart sddm");
    expect(b.file("state/bad-commits").trim()).toBe(NEW);
    expect(keyValues(b.file("state/rollback.env"))).toMatchObject({ from: NEW, to: OLD, how: "snapshot", manual: "0", ok: "1" });
    expect(existsSync(path.join(b.state, "last.env"))).toBe(false);
  });

  it("leaves the box alone when the system updates fail before anything changed", () => {
    const b = box();
    const r = b.run("update.sh", [], { PACMAN_RC: "1" });
    expect(r.status).toBe(1);
    expect(b.calls().some((c) => c.includes("undochange"))).toBe(false);
    expect(keyValues(b.file("state/last.env")).status).toBe("failed");
  });
});

describe("the health check after an update", () => {
  const checking = (b: Box, cec = 0) => b.write("state/last.env", `status=checking\nsnapshot=42\nfrom=${OLD}\nto=${NEW}\ndone=1000\ncec=${cec}\n`);

  it("does nothing unless an update is waiting to be checked", () => {
    const b = box();
    expect(b.run("healthcheck.sh").status).toBe(0);
    expect(b.calls()).toEqual([]);
  });

  it("keeps an update when the app started, reaches the Hub and mpv plays", () => {
    const b = box();
    checking(b);
    b.write("heartbeat", "at=2000\npage=app\nhub=1\n");
    const r = b.run("healthcheck.sh");
    expect(r.status, r.out).toBe(0);
    expect(keyValues(b.file("state/last.env")).status).toBe("ok");
    const health = keyValues(b.file("state/health.env"));
    expect(health).toMatchObject({ ok: "1", "check.app": "1 The TV app started", "check.mpv": "1 mpv plays a test clip" });
    expect(b.calls()).not.toContain("systemctl reboot");
  });

  it("rolls back when the app didn't start after the update", () => {
    const b = box();
    checking(b);
    b.write("heartbeat", "at=500\nhub=1\n"); // from before the update
    b.write("boot/vmlinuz-linux", "new kernel");
    b.write("state/boot/vmlinuz-linux", "old kernel");
    const r = b.run("healthcheck.sh");
    expect(r.status, r.out).toBe(0);
    expect(b.calls()).toContain("snapper -c root undochange 42..0");
    expect(b.file("boot/vmlinuz-linux")).toBe("old kernel");
    expect(b.calls()).toContain("systemctl reboot");
    const rb = keyValues(b.file("state/rollback.env"));
    expect(rb.reason).toBe("After the update the TV app didn't start");
    expect(keyValues(b.file("state/health.env")).ok).toBe("0");
    expect(b.file("state/bad-commits").trim()).toBe(NEW);
    expect(b.file("state/update.log")).toContain("health: Failed");
  });

  it("doesn't blame the update for a Hub that isn't answering anyone", () => {
    const b = box();
    checking(b);
    b.write("heartbeat", "at=2000\nhub=0\n");
    expect(b.run("healthcheck.sh", [], { CURL_RC: "7" }).status).toBe(0);
    expect(keyValues(b.file("state/last.env")).status).toBe("ok");
    expect(b.run("healthcheck.sh").status).toBe(0); // already checked: nothing more
  });

  it("fails when the app can't reach a Hub the box can, mpv can't play, or the CEC adapter went", () => {
    const b = box();
    checking(b, 1);
    b.write("heartbeat", "at=2000\nhub=0\n");
    b.run("healthcheck.sh", [], { MPV_RC: "1" });
    const health = keyValues(b.file("state/health.env"));
    expect(health.summary).toBe("After the update the app can't reach the Hub, mpv couldn't play a test clip, the CEC adapter has gone");
    expect(b.calls()).toContain("systemctl reboot");
  });

  it("only reports it with AUTO_ROLLBACK=0", () => {
    const b = box();
    checking(b);
    b.write("etc/box.env", "HUB_URL=http://hub:8095\nHEALTH_WAIT=0\nAUTO_ROLLBACK=0\n");
    const r = b.run("healthcheck.sh");
    expect(keyValues(b.file("state/last.env")).status, r.out).toBe("failed");
    expect(b.calls().some((c) => c.includes("undochange"))).toBe(false);
  });
});

describe("rolling back by hand", () => {
  it("needs an update to undo", () => {
    const b = box();
    const r = b.run("rollback.sh", ["--manual"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Nothing to roll back");
  });

  it("puts only the app back when there's no snapshot, and can't be done twice", () => {
    const b = box({ head: NEW });
    b.write("state/last.env", `status=ok\nsnapshot=\nfrom=${OLD}\nto=${NEW}\n`);
    b.write("state/update.log", "earlier lines\n");
    const r = b.run("rollback.sh", ["--manual"]);
    expect(r.status, r.out).toBe(0);
    expect(b.calls()).toContain(`git -C ${path.join(b.root, "app")} reset --hard ${OLD}`);
    expect(b.calls()).toContain("install KEEP_CHECKOUT=1");
    expect(b.file("fake/head").trim()).toBe(OLD);
    expect(keyValues(b.file("state/rollback.env"))).toMatchObject({ how: "app", manual: "1", reason: "Asked for in Settings", ok: "1" });
    expect(b.file("state/update.log")).toContain("earlier lines");
    expect(b.run("rollback.sh", ["--manual"]).status).toBe(1);
  });

  it("keeps its own records when the snapshot undoes everything else", () => {
    const b = box();
    b.write("state/last.env", `status=ok\nsnapshot=42\nfrom=${OLD}\nto=${NEW}\n`);
    b.write("state/bad-commits", "3333333333333333333333333333333333333333\n");
    // snapper undochange wiping the state folder, as it would files made after the snapshot.
    b.write("fakebin/snapper", `#!/usr/bin/env bash\necho "snapper $*" >>"$FAKE/calls"\nrm -rf "$UTV_STATE"\n`);
    chmodSync(path.join(b.root, "fakebin/snapper"), 0o755);
    const r = b.run("rollback.sh", ["--manual", "--no-reboot"]);
    expect(r.status, r.out).toBe(0);
    expect(b.file("state/bad-commits").trim().split("\n")).toEqual(["3333333333333333333333333333333333333333", NEW]);
    expect(b.calls()).not.toContain("systemctl reboot");
  });
});

describe("what Settings and the phone show", () => {
  const last = `status=ok\nsnapshot=42\nfrom=${OLD}\nto=${NEW}\n`;
  const health = "at=2026-11-02T04:10:00Z\nok=0\nsummary=After the update the TV app didn't start\ncheck.app=0 The TV app didn't start within 4 minutes\ncheck.mpv=1 mpv plays a test clip\n";

  it("offers to roll back an update that passed, and shows its check", () => {
    const r = updateRecords({ last, health: health.replace("ok=0", "ok=1") });
    expect(r).toMatchObject({ canRollBack: true, rollbackTo: OLD, health: { status: "ok", at: "2026-11-02T04:10:00Z" } });
    expect(r.health?.checks).toEqual([
      { name: "app", ok: false, detail: "The TV app didn't start within 4 minutes" },
      { name: "mpv", ok: true, detail: "mpv plays a test clip" },
    ]);
  });

  it("doesn't show the previous check while a new one runs, nor offer a roll back mid-update", () => {
    expect(updateRecords({ last: last.replace("status=ok", "status=checking"), health }).health).toEqual({ status: "checking" });
    expect(updateRecords({ last: last.replace("status=ok", "status=updating") })).toMatchObject({ canRollBack: false });
  });

  it("explains an automatic roll back with the check that caused it", () => {
    const r = updateRecords({ health, rollback: `at=2026-11-02T04:11:00Z\nreason=After the update the TV app didn't start\nfrom=${NEW}\nto=${OLD}\nhow=snapshot\nmanual=0\nok=1\n` });
    expect(r.canRollBack).toBeUndefined();
    expect(r.rollback).toEqual({ at: "2026-11-02T04:11:00Z", reason: "After the update the TV app didn't start", from: NEW, to: OLD, how: "snapshot", manual: false, ok: true });
    expect(r.health?.status).toBe("failed");
  });

  it("writes the heartbeat the check reads, in whole seconds", () => {
    expect(heartbeatText({ at: 1_700_000_000_999, page: "offline", hub: false, version: "0.2.0" })).toBe("at=1700000000\npage=offline\nhub=0\nversion=0.2.0\n");
  });
});
