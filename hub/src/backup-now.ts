// Backs the Hub up now, alongside the running Hub (tools/hub/update.sh runs it before an update):
//   docker compose exec hub node hub/dist/backup-now.js

import path from "node:path";
import { Backups } from "./backup.js";
import { Db } from "./db.js";

const dataDir = process.env.DATA_DIR ?? "/data";
const db = new Db(path.join(dataDir, "hub.db"));
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const backups = new Backups({ db, dataDir, mediaRoot: process.env.MEDIA_ROOT ?? "/mnt/nas", log: quiet, env: { ...process.env, BACKUP: "on" } });
try {
  const done = await backups.run();
  console.log(`Backed up to ${path.join(backups.dir, done.name)} (${Math.round(done.bytes / 1024)} KB)${backups.onNas ? "" : ". The NAS isn't mounted in the Hub, so it's beside the Hub's data"}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
