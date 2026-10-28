// Jump scares: a short clip cut in over whatever is on, now and then, until someone turns it off.
// The Hub keeps the settings (so the TV and every phone agree) and the clips (uploaded from the
// phone's Scares sheet). The TV decides when a random one lands, because only it knows what's
// playing; the phone can also set one off at once with POST /api/scares/now.
//
// Nothing is ever shown on a Kids profile: the TV app leaves scares off there.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { cleanScareSettings, DEFAULT_SCARE_SETTINGS, type Scare, type ScareClip, type ScareSettings, type ScareState } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import { sendFile } from "./streaming.js";

const CLIP_TYPES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const MAX_UPLOAD = 200 * 1024 * 1024;
/** Clips kept; the oldest goes when a new one makes it too many. */
const MAX_CLIPS = 40;

/** A clip as the Hub keeps it: what the phone sees, plus the file it's in. */
interface StoredClip extends ScareClip {
  file: string;
}

type Req = FastifyRequest<{ Params: { id?: string }; Querystring: Record<string, string | undefined>; Body: unknown }>;

class BadClip extends Error {
  readonly statusCode = 400;
}

/** Works out what an upload is when the phone says nothing better than "application/octet-stream". */
function sniff(b: Buffer): string | undefined {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return b.subarray(8, 10).toString("latin1") === "qt" ? "video/quicktime" : "video/mp4";
  if (b.subarray(0, 4).toString("hex") === "1a45dfa3") return "video/webm";
  return undefined;
}

export async function registerScares(app: FastifyInstance, ctx: HubContext, dataDir: string): Promise<void> {
  const clipDir = path.join(dataDir, "scare-clips");
  await mkdir(clipDir, { recursive: true });

  const settings = (): ScareSettings => cleanScareSettings(ctx.db.getKv<Partial<ScareSettings>>("scares") ?? {}, DEFAULT_SCARE_SETTINGS);
  const clips = (): StoredClip[] => (ctx.db.getKv<StoredClip[]>("scare-clips") ?? []).slice().sort((a, b) => b.addedAt - a.addedAt);
  const saveClips = (list: StoredClip[]) => ctx.db.setKv("scare-clips", list);
  const shown = (c: StoredClip): ScareClip => ({ id: c.id, name: c.name, kind: c.kind, url: c.url, sizeBytes: c.sizeBytes, addedAt: c.addedAt });
  const state = (): ScareState => ({ settings: settings(), clips: clips().map(shown) });

  // Files left behind by a Hub that was restored from a backup without its clips, and the other
  // way round: a clip whose file has gone is no use, so it's dropped from the list on start.
  const files = new Set(await readdir(clipDir).catch(() => [] as string[]));
  const kept = clips().filter((c) => files.has(c.file));
  if (kept.length !== clips().length) saveClips(kept);

  const keep = async (body: Buffer, type: string, name: string): Promise<StoredClip> => {
    const real = CLIP_TYPES[type] ? type : sniff(body);
    const ext = real && CLIP_TYPES[real];
    if (!real || !ext) throw new BadClip("Send an MP4, WebM or MOV video, or a JPEG, PNG, GIF or WebP picture");
    const id = randomBytes(8).toString("hex");
    const file = `${id}${ext}`;
    await writeFile(path.join(clipDir, file), body);
    const clip: StoredClip = {
      id,
      file,
      name: name.replace(/\s+/g, " ").trim().slice(0, 60) || (real.startsWith("video/") ? "Clip" : "Picture"),
      kind: real.startsWith("video/") ? "video" : "image",
      url: `/api/scares/clips/${id}`,
      sizeBytes: body.length,
      addedAt: Date.now(),
    };
    const list = [clip, ...clips()];
    for (const old of list.splice(MAX_CLIPS)) await unlink(path.join(clipDir, old.file)).catch(() => undefined);
    saveClips(list);
    return clip;
  };

  const changed = () => ctx.events.emit({ type: "scares.changed" });

  /** Sends a scare to the TV: the clip asked for, else one of the uploaded ones at random. */
  const fire = (clipId: string | undefined, byHand: boolean): Scare => {
    const s = settings();
    const list = clips();
    const chosen = clipId ? list.find((c) => c.id === clipId) : list[Math.floor(Math.random() * list.length)];
    if (clipId && !chosen) throw Object.assign(new Error("That clip has gone"), { statusCode: 404 });
    const scare: Scare = {
      id: randomBytes(5).toString("hex"),
      ...(chosen ? { clip: { id: chosen.id, name: chosen.name, kind: chosen.kind, url: chosen.url } } : {}),
      seconds: s.seconds,
      volume: s.volume,
      byHand,
    };
    ctx.events.emit({ type: "scare", scare });
    return scare;
  };

  await app.register(async (scope) => {
    // A clip can be the request body itself (the phone's file picker, or curl --data-binary @clip.mp4).
    scope.addContentTypeParser(/^(image|video)\/|^application\/octet-stream/, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

    scope.get("/api/scares", async () => state());

    scope.put("/api/scares", async (req: Req) => {
      const patch = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) as Partial<ScareSettings>;
      ctx.db.setKv("scares", cleanScareSettings(patch, settings()));
      changed();
      return state();
    });

    scope.post("/api/scares/clips", { bodyLimit: MAX_UPLOAD }, async (req: Req, reply) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: "Send the clip as the request body" });
      const clip = await keep(req.body, String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase(), String(req.query.name ?? ""));
      changed();
      return { clip: shown(clip), clips: state().clips };
    });

    scope.get("/api/scares/clips/:id", async (req: Req, reply) => {
      const clip = clips().find((c) => c.id === req.params.id);
      if (!clip) return reply.code(404).send({ error: "That clip has gone" });
      reply.header("Cache-Control", "private, max-age=86400");
      return sendFile(req, reply, path.join(clipDir, clip.file));
    });

    scope.delete("/api/scares/clips/:id", async (req: Req, reply) => {
      const clip = clips().find((c) => c.id === req.params.id);
      if (!clip) return reply.code(404).send({ error: "That clip has gone" });
      saveClips(clips().filter((c) => c.id !== clip.id));
      await unlink(path.join(clipDir, clip.file)).catch(() => undefined);
      changed();
      return { ok: true, clips: state().clips };
    });

    /** Scare them now, from the phone. Works whether or not the random ones are turned on. */
    scope.post("/api/scares/now", async (req: Req) => {
      const body = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) as { clipId?: unknown };
      const clipId = typeof body.clipId === "string" ? body.clipId : typeof req.query.clipId === "string" ? req.query.clipId : undefined;
      return { scare: fire(clipId, true) };
    });
  });
}
