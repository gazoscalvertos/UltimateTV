// A throwaway Hub for the end-to-end journeys: demo data, its own temporary directories, and a
// port nobody else is on. Every journey gets a fresh one, so a recording made in one journey can
// never change what another one sees.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** A port the operating system says is free right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts `hub/dist/index.js` with the demo data on a free port and returns it once it answers
 * `/api/health`. `stop()` kills it and removes its temporary directories.
 */
export async function startHub() {
  const dirs = mkdtempSync(path.join(tmpdir(), "utv-e2e-hub-"));
  const port = await freePort();
  const env = {
    ...process.env,
    DEMO: "1",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: path.join(dirs, "data"),
    CLIPS_DIR: path.join(dirs, "clips"),
    MEDIA_ROOT: path.join(dirs, "media"),
    BACKUP_DIR: path.join(dirs, "backups"),
    // The journeys assert on what the app draws, not on the Hub's own log.
    LOG_LEVEL: "warn",
  };
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, "hub/dist/index.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (b) => (log += b.toString()));

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The Hub stopped before it was ready:\n${log}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`The Hub didn't start within 30 seconds:\n${log}`);
    }
    await sleep(200);
  }

  return {
    base,
    port,
    /** The address the browser should use. */
    url: (p) => new URL(p, base).toString(),
    stop: () => {
      child.kill("SIGTERM");
      const gone = new Promise((r) => child.once("exit", r));
      return Promise.race([gone, sleep(2000).then(() => child.kill("SIGKILL"))]).then(() => {
        try {
          rmSync(dirs, { recursive: true, force: true });
        } catch {
          // A temporary directory left behind is harmless.
        }
      });
    },
    log: () => log,
  };
}
