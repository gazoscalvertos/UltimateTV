// Jump scares: a short clip cut in over whatever is on, now and then, until someone turns it off.
// The Hub keeps the settings (so the TV and every phone agree) and the clips (uploaded from the
// phone's Scares sheet), and the scares built from them: a picture or video and a sound, placed
// somewhere on the screen. The TV decides when a random one lands, because only it knows what's
// playing; the phone can also set one off at once with POST /api/scares/now.
//
// Nothing is ever shown on a Kids profile: the TV app leaves scares off there.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { cleanScareSettings, DEFAULT_SCARE_SETTINGS, SCARE_SIZES, SCARE_SPOTS, scareFrom, type ScareClip, type ScareMix, type ScareSettings, type ScareState } from "@ultimatetv/shared";
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
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/webm": ".weba",
};
const kindOf = (type: string): ScareClip["kind"] => (type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : "image");
const DEFAULT_NAMES: Record<ScareClip["kind"], string> = { video: "Clip", image: "Picture", audio: "Sound" };
/** Built scares kept. */
const MAX_MIXES = 40;
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
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (b.subarray(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  // An MP3 starts with its ID3 tag, or straight in with a frame sync.
  if (b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  return undefined;
}

export async function registerScares(app: FastifyInstance, ctx: HubContext, dataDir: string): Promise<void> {
  const clipDir = path.join(dataDir, "scare-clips");
  await mkdir(clipDir, { recursive: true });

  const settings = (): ScareSettings => cleanScareSettings(ctx.db.getKv<Partial<ScareSettings>>("scares") ?? {}, DEFAULT_SCARE_SETTINGS);
  const clips = (): StoredClip[] => (ctx.db.getKv<StoredClip[]>("scare-clips") ?? []).slice().sort((a, b) => b.addedAt - a.addedAt);
  const saveClips = (list: StoredClip[]) => ctx.db.setKv("scare-clips", list);
  const shown = (c: StoredClip): ScareClip => ({ id: c.id, name: c.name, kind: c.kind, url: c.url, sizeBytes: c.sizeBytes, addedAt: c.addedAt });
  const mixes = (): ScareMix[] => (ctx.db.getKv<ScareMix[]>("scare-mixes") ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const saveMixes = (list: ScareMix[]) => ctx.db.setKv("scare-mixes", list);
  const state = (): ScareState => ({ settings: settings(), clips: clips().map(shown), mixes: mixes() });

  // Files left behind by a Hub that was restored from a backup without its clips, and the other
  // way round: a clip whose file has gone is no use, so it's dropped from the list on start.
  const files = new Set(await readdir(clipDir).catch(() => [] as string[]));
  const kept = clips().filter((c) => files.has(c.file));
  if (kept.length !== clips().length) saveClips(kept);

  const keep = async (body: Buffer, type: string, name: string): Promise<StoredClip> => {
    const real = CLIP_TYPES[type] ? type : sniff(body);
    const ext = real && CLIP_TYPES[real];
    if (!real || !ext) throw new BadClip("Send an MP4, WebM or MOV video, a JPEG, PNG, GIF or WebP picture, or an MP3, OGG, WAV or M4A sound");
    const id = randomBytes(8).toString("hex");
    const file = `${id}${ext}`;
    await writeFile(path.join(clipDir, file), body);
    const clip: StoredClip = {
      id,
      file,
      name: name.replace(/\s+/g, " ").trim().slice(0, 60) || DEFAULT_NAMES[kindOf(real)],
      kind: kindOf(real),
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

  /** Sends a scare to the TV: the built scare or clip asked for, else one at random. */
  const fire = (want: { clipId?: string; mixId?: string }, byHand: boolean) => {
    const scare = scareFrom(state(), want, byHand);
    if (!scare) throw Object.assign(new Error(want.mixId ? "That scare has been deleted" : "That clip has gone"), { statusCode: 404 });
    ctx.events.emit({ type: "scare", scare });
    return scare;
  };

  /** A built scare as sent, checked against the clips it names. */
  const cleanMix = (input: Partial<ScareMix>): ScareMix => {
    const list = clips();
    const visual = typeof input.visualId === "string" && input.visualId ? list.find((c) => c.id === input.visualId) : undefined;
    const audio = typeof input.audioId === "string" && input.audioId ? list.find((c) => c.id === input.audioId) : undefined;
    if (input.visualId && (!visual || visual.kind === "audio")) throw new BadClip("Pick a picture or video for it");
    if (input.audioId && (!audio || audio.kind !== "audio")) throw new BadClip("Pick a sound for it");
    if (!visual && !audio) throw new BadClip("Pick a picture or video, a sound, or both");
    const seconds = Number(input.seconds);
    return {
      id: randomBytes(6).toString("hex"),
      name: String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || [visual?.name, audio?.name].filter(Boolean).join(" + "),
      ...(visual ? { visualId: visual.id } : {}),
      ...(audio ? { audioId: audio.id } : {}),
      spot: SCARE_SPOTS.includes(input.spot as ScareMix["spot"]) ? input.spot! : "full",
      size: SCARE_SIZES.includes(input.size as ScareMix["size"]) ? input.size! : "medium",
      muteVideo: Boolean(input.muteVideo),
      seconds: Number.isFinite(seconds) ? Math.min(30, Math.max(0, Math.round(seconds))) : 0,
      createdAt: Date.now(),
    };
  };

  await app.register(async (scope) => {
    // A clip can be the request body itself (the phone's file picker, or curl --data-binary @clip.mp4).
    scope.addContentTypeParser(/^(image|video|audio)\/|^application\/octet-stream/, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

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
      // Built scares lose the clip; one left with nothing in it goes too.
      const without = (m: ScareMix): ScareMix => {
        const { visualId, audioId, ...rest } = m;
        return { ...rest, ...(visualId && visualId !== clip.id ? { visualId } : {}), ...(audioId && audioId !== clip.id ? { audioId } : {}) };
      };
      saveMixes(mixes().map(without).filter((m) => m.visualId || m.audioId));
      changed();
      return { ok: true, clips: state().clips, mixes: state().mixes };
    });

    /** Saves a scare built on the phone: { name, visualId, audioId, spot, size, muteVideo, seconds }. */
    scope.post("/api/scares/mixes", async (req: Req) => {
      const body = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) as Partial<ScareMix>;
      const mix = cleanMix(body);
      const list = [mix, ...mixes()].slice(0, MAX_MIXES);
      saveMixes(list);
      changed();
      return { mix, mixes: list };
    });

    scope.delete("/api/scares/mixes/:id", async (req: Req, reply) => {
      if (!mixes().some((m) => m.id === req.params.id)) return reply.code(404).send({ error: "That scare has been deleted" });
      saveMixes(mixes().filter((m) => m.id !== req.params.id));
      changed();
      return { ok: true, mixes: mixes() };
    });

    /** Scare them now, from the phone. Works whether or not the random ones are turned on. */
    scope.post("/api/scares/now", async (req: Req) => {
      const body = (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {}) as { clipId?: unknown; mixId?: unknown };
      const pick = (v: unknown, q: string | undefined) => (typeof v === "string" && v ? v : q || undefined);
      const clipId = pick(body.clipId, req.query.clipId);
      const mixId = pick(body.mixId, req.query.mixId);
      return { scare: fire({ ...(clipId ? { clipId } : {}), ...(mixId ? { mixId } : {}) }, true) };
    });
  });
}
