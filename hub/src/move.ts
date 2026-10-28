// Moving the Hub to the TV box for a trip, and back again (tools/hub/travel.sh drives it).
//
//   GET    /api/hub/move-out  the Hub's data as a .tar.gz. The Hub then stands by ("moved away"):
//                            no recordings, guide refreshes or music downloads, so the two Hubs
//                            don't fight over the IPTV connection. The answer's X-Move-Key header
//                            is the only key that brings it back.
//   POST   /api/hub/move-in   the data from the trip (a .tar.gz, X-Move-Key) replaces this Hub's,
//                            and the Hub restarts with it.
//   DELETE /api/hub/move      (X-Move-Key) the trip's off: carry on with the data it already has.
//   GET    /api/hub/move-files       (X-Move-Key) the music video files the channels play, so the
//   GET    /api/hub/move-file?path=  box can take copies; PUT sends back a file made on the trip
//   PUT    /api/hub/move-file?path=  (a recording, a new music video) that isn't here yet.
//
// Taking the data needs a phone or script paired in the last 15 minutes, so someone must have just
// read the code off the TV. A restore is unpacked at the next start (applyPendingRestore), before
// the database opens; what it replaces is kept in data/before-restore-<time>.

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PairedDevice } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import type { Logger } from "./log.js";
import { nasRoots } from "./nasvideos.js";
import { sendFile } from "./streaming.js";

/** What travels with the Hub besides the database. Logs, caches and temp files stay behind. */
const MOVED_DIRS = ["scare-clips", "notify-media", "probe-reports"];
const DB_FILES = ["hub.db", "hub.db-wal", "hub.db-shm"];
const RESTORE_FILE = "restore.tar.gz";
const FRESH_PAIRING_MS = 15 * 60_000;
const KV = "hub-moved";

export interface MovedAway {
  at: string;
  /** Where the data went (the address that asked for it). */
  to?: string;
  keyHash: string;
}

export function movedAway(db: Db): MovedAway | undefined {
  return db.getKv<MovedAway>(KV);
}

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
function keyMatches(moved: MovedAway, key: unknown): boolean {
  if (typeof key !== "string" || !key) return false;
  const a = Buffer.from(hashKey(key), "hex");
  const b = Buffer.from(moved.keyHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Unpacks data/restore.tar.gz, if a move-in left one, over the Hub's data. Run before the database
 * opens. A bad archive is set aside and the Hub carries on with what it had.
 */
export function applyPendingRestore(dataDir: string, log: Pick<Logger, "info" | "error"> = console): boolean {
  const archive = path.join(dataDir, RESTORE_FILE);
  if (!existsSync(archive)) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    const listed = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).split("\n");
    if (!listed.some((f) => f.replace(/^\.\//, "") === "hub.db")) throw new Error("there's no hub.db in it");
    const keep = path.join(dataDir, `before-restore-${stamp}`);
    mkdirSync(keep, { recursive: true });
    for (const name of [...DB_FILES, ...MOVED_DIRS]) {
      const p = path.join(dataDir, name);
      if (existsSync(p)) renameSync(p, path.join(keep, name));
    }
    execFileSync("tar", ["-xzf", archive, "-C", dataDir, "--no-same-owner"], { stdio: ["ignore", "pipe", "pipe"] });
    rmSync(archive);
    log.info(`Moved-in data unpacked; the Hub's old data is in ${keep}`);
    return true;
  } catch (err) {
    const bad = path.join(dataDir, `restore-failed-${stamp}.tar.gz`);
    renameSync(archive, bad);
    log.error(`Couldn't unpack the moved-in data (${(err as Error).message}); it's kept as ${bad}`);
    return false;
  }
}

export interface MoveDeps {
  db: Db;
  dataDir: string;
  log: Logger;
  /** The paired device asking, when pairing is on. */
  deviceAsking: (req: FastifyRequest) => PairedDevice | undefined;
  pairingEnforced: boolean;
  /** Restarts the Hub (Docker starts it again), so it comes back standing by or with the new data. */
  restart: () => void;
  /** The music video files (and stills) the channels play. */
  travelFiles?: () => string[];
  /** Where the NAS shares are mounted, for files sent back from a trip. */
  mediaRoot?: string;
  now?: () => number;
}

export async function registerMove(app: FastifyInstance, d: MoveDeps): Promise<void> {
  const now = d.now ?? Date.now;
  const header = (req: FastifyRequest, name: string) => {
    const v = req.headers[name];
    return typeof v === "string" ? v : undefined;
  };

  await app.register(async (scope) => {
    // Archives and files are streamed to disk by the routes, after they've checked the key.
    scope.addContentTypeParser(/^application\/(gzip|x-gzip|x-tar|octet-stream)/, { bodyLimit: 50 * 1024 ** 3 }, (_req, payload, done) => done(null, payload));
    const saveTo = async (body: unknown, file: string) => {
      if (!body || typeof (body as Readable).pipe !== "function") throw Object.assign(new Error("Send the file as the request body (Content-Type: application/octet-stream)"), { statusCode: 400 });
      const part = `${file}.part`;
      try {
        await pipeline(body as Readable, createWriteStream(part));
        await rename(part, file);
      } catch (err) {
        await rm(part, { force: true });
        throw err;
      }
    };
    const checkKey = (req: FastifyRequest) => {
      const moved = movedAway(d.db);
      if (!moved || !keyMatches(moved, header(req, "x-move-key"))) {
        throw Object.assign(new Error(moved ? "That isn't the key this Hub gave out when it moved" : "This Hub hasn't moved out"), { statusCode: 403, code: "move-key" });
      }
    };

    scope.get("/api/hub/move", async () => {
      const moved = movedAway(d.db);
      return moved ? { movedAway: true, at: moved.at, to: moved.to } : { movedAway: false };
    });

    scope.get("/api/hub/move-out", async (req, reply) => {
      if (d.pairingEnforced) {
        const device = d.deviceAsking(req);
        if (!device || now() - device.pairedAt > FRESH_PAIRING_MS) {
          return reply.code(403).send({ error: "Pair again with the code from the TV (Settings › Phones and remotes) to take the Hub's data", code: "pair" });
        }
      }
      const moved = movedAway(d.db);
      if (moved) return reply.code(409).send({ error: `This Hub already moved out on ${moved.at}. Bring it back first, or call off the move.`, code: "moved" });

      // A consistent copy of the database, taken before the "moved away" mark so the copy hasn't got it.
      const staging = path.join(d.dataDir, "move-out");
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
      d.db.sql.exec(`VACUUM INTO '${path.join(staging, "hub.db").replace(/'/g, "''")}'`);
      const key = randomBytes(24).toString("base64url");
      d.db.setKv(KV, { at: new Date(now()).toISOString(), to: req.ip, keyHash: hashKey(key) } satisfies MovedAway);
      d.log.info({ to: req.ip }, "The Hub's data is moving out; standing by after this");

      const dirs = MOVED_DIRS.filter((n) => existsSync(path.join(d.dataDir, n)) && readdirSync(path.join(d.dataDir, n)).length);
      const tar = spawn("tar", ["-cz", "-C", staging, "hub.db", ...(dirs.length ? ["-C", d.dataDir, ...dirs] : [])], { stdio: ["ignore", "pipe", "pipe"] });
      tar.stderr.on("data", (b: Buffer) => d.log.warn({ tar: b.toString().trim() }, "Packing the Hub's data"));
      tar.on("close", (code) => {
        rmSync(staging, { recursive: true, force: true });
        if (code !== 0) d.log.error({ code }, "Packing the Hub's data failed");
      });
      reply.raw.on("close", () => {
        if (movedAway(d.db)) d.restart();
      });
      return reply
        .header("Content-Type", "application/gzip")
        .header("Content-Disposition", `attachment; filename="ultimatetv-hub-${new Date(now()).toISOString().slice(0, 10)}.tar.gz"`)
        .header("X-Move-Key", key)
        .header("Cache-Control", "no-store")
        .send(tar.stdout);
    });

    scope.post("/api/hub/move-in", async (req, reply) => {
      checkKey(req);
      const file = path.join(d.dataDir, `${RESTORE_FILE}.in`);
      await saveTo(req.body, file);
      try {
        const listed = execFileSync("tar", ["-tzf", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).split("\n");
        if (!listed.some((f) => f.replace(/^\.\//, "") === "hub.db")) throw new Error("no hub.db");
      } catch {
        rmSync(file, { force: true });
        return reply.code(400).send({ error: "That isn't the Hub's data (a .tar.gz with hub.db in it)" });
      }
      renameSync(file, path.join(d.dataDir, RESTORE_FILE));
      d.log.info("The Hub's data is back from its trip; restarting with it");
      reply.raw.on("close", () => d.restart());
      return { ok: true, restarting: true };
    });

    scope.get("/api/hub/move-files", async (req) => {
      checkKey(req);
      const files: { path: string; size: number }[] = [];
      for (const f of new Set(d.travelFiles?.() ?? [])) {
        const info = await stat(f).catch(() => null);
        if (info?.isFile()) files.push({ path: f, size: info.size });
      }
      return { files };
    });

    scope.get("/api/hub/move-file", async (req: FastifyRequest<{ Querystring: { path?: string } }>, reply) => {
      checkKey(req);
      const file = String(req.query.path ?? "");
      if (!(d.travelFiles?.() ?? []).includes(file)) return reply.code(404).send({ error: "That isn't one of the music video files" });
      return sendFile(req, reply, file);
    });

    scope.put("/api/hub/move-file", async (req: FastifyRequest<{ Querystring: { path?: string } }>, reply) => {
      checkKey(req);
      const file = path.normalize(String(req.query.path ?? ""));
      const roots = await nasRoots(d.mediaRoot ?? "/mnt/nas");
      const root = roots.find((r) => file.startsWith(`${r}/`));
      if (!path.isAbsolute(file) || !root) return reply.code(400).send({ error: "Files can only come back to the NAS shares" });
      if (existsSync(file)) return { ok: true, kept: true };
      await mkdir(path.dirname(file), { recursive: true });
      const dir = await realpath(path.dirname(file));
      if (!dir.startsWith(`${root}/`) && dir !== root) return reply.code(400).send({ error: "Files can only come back to the NAS shares" });
      await saveTo(req.body, file);
      d.log.info({ file }, "A file came back from the trip");
      return { ok: true };
    });

    scope.delete("/api/hub/move", async (req, reply) => {
      const moved = movedAway(d.db);
      if (!moved) return { ok: true, movedAway: false };
      if (!keyMatches(moved, header(req, "x-move-key"))) return reply.code(403).send({ error: "That isn't the key this Hub gave out when it moved", code: "move-key" });
      d.db.run("DELETE FROM kv WHERE key = ?", KV);
      d.log.info("The move was called off; carrying on here");
      reply.raw.on("close", () => d.restart());
      return { ok: true, restarting: true };
    });
  });
}
