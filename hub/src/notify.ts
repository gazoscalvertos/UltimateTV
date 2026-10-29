// Pop-ups on the TV from anything on the home network: a doorbell showing who's at the door, a
// meeting reminder, an alarm. A notice is any mix of a title, text, a picture and a video, placed
// where the sender asks for as long as it asks. Pictures given by address are fetched by the Hub
// at once, so the TV shows the moment the bell rang and needn't reach (or sign in to) the camera.

import { randomBytes } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { NOTICE_KINDS, NOTICE_POSITIONS, NOTICE_SIZES, NOTICE_SOUNDS, type NoticeKind, type NoticePosition, type NoticeSize, type NoticeSound, type TvNotice } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import { sendFile } from "./streaming.js";

/** What each kind looks like when the sender doesn't say. */
const DEFAULTS: Record<NoticeKind, { position: NoticePosition; size: NoticeSize; sound: NoticeSound; seconds: number; wake: boolean }> = {
  info: { position: "bottom-right", size: "medium", sound: "ping", seconds: 15, wake: false },
  doorbell: { position: "center", size: "large", sound: "chime", seconds: 30, wake: false },
  meeting: { position: "top-right", size: "medium", sound: "chime", seconds: 60, wake: false },
  warning: { position: "top", size: "medium", sound: "chime", seconds: 30, wake: false },
  alarm: { position: "center", size: "large", sound: "alarm", seconds: 0, wake: true },
};

const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};
const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_FETCHED_IMAGE = 20 * 1024 * 1024;
/** Notices on screen at once; the oldest goes first. */
const MAX_NOTICES = 8;
/** Uploaded pictures and videos kept; older ones are deleted. */
const MAX_MEDIA = 30;

/** The request body (JSON) or, with a picture or video as the body, the query string. */
export interface NoticeInput {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  text?: unknown;
  message?: unknown;
  image?: unknown;
  video?: unknown;
  /** Sent with the Hub's fetch of `image`, such as a Home Assistant token. */
  headers?: unknown;
  muted?: unknown;
  position?: unknown;
  size?: unknown;
  sound?: unknown;
  pause?: unknown;
  wake?: unknown;
  seconds?: unknown;
}

type Req = FastifyRequest<{ Params: { id?: string }; Querystring: Record<string, string | undefined>; Body: unknown }>;

class BadNotice extends Error {
  readonly statusCode = 400;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const v = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
  const alias = v === "centre" || v === "middle" ? "center" : v === "fullscreen" || v === "full-screen" ? "full" : v;
  return (allowed as readonly string[]).includes(alias) ? (alias as T) : fallback;
};
const flag = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string" && value.trim()) return !/^(0|false|no|off)$/i.test(value.trim());
  return fallback;
};
const line = (value: unknown, max: number): string | undefined => {
  const v = typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "";
  return v || undefined;
};

/** Works out what a body is when it says nothing better than "application/octet-stream". */
function sniff(b: Buffer): string | undefined {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return b.subarray(8, 10).toString("latin1") === "qt" ? "video/quicktime" : "video/mp4";
  if (b.subarray(0, 4).toString("hex") === "1a45dfa3") return "video/webm";
  return undefined;
}

/** Puts a notice on the TV from inside the Hub (alerts, the sleep timer). */
export type ShowNotice = (input: NoticeInput) => TvNotice | null;

export async function registerNotices(app: FastifyInstance, ctx: HubContext, dataDir: string): Promise<ShowNotice> {
  const mediaDir = path.join(dataDir, "notify-media");
  // Pictures from before a restart belong to notices that are gone.
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });
  const media = new Map<string, string>();
  const notices = new Map<string, TvNotice>();

  const keep = async (body: Buffer, type: string): Promise<{ url: string; kind: "image" | "video" }> => {
    const real = MEDIA_TYPES[type] ? type : sniff(body);
    const ext = real && MEDIA_TYPES[real];
    if (!real || !ext) throw new BadNotice("Send a JPEG, PNG, GIF or WebP picture, or an MP4, WebM or MOV video");
    const id = randomBytes(9).toString("base64url");
    const file = `${id}${ext}`;
    await writeFile(path.join(mediaDir, file), body);
    media.set(id, file);
    while (media.size > MAX_MEDIA) {
      const [oldest, name] = media.entries().next().value as [string, string];
      media.delete(oldest);
      await unlink(path.join(mediaDir, name)).catch(() => undefined);
    }
    return { url: `/api/notify/media/${id}`, kind: real.startsWith("video/") ? "video" : "image" };
  };

  /** A picture or video given as a data: address is kept by the Hub; a web picture is fetched now. */
  const resolveMedia = async (value: unknown, want: "image" | "video", headers: unknown, warnings: string[]): Promise<string | undefined> => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const v = value.trim();
    const data = /^data:([\w/+.-]+)?(;base64)?,(.*)$/s.exec(v);
    if (data) {
      const body = data[2] ? Buffer.from(data[3]!, "base64") : Buffer.from(decodeURIComponent(data[3]!));
      return (await keep(body, data[1] ?? "")).url;
    }
    if (v.startsWith("/api/notify/media/")) return v;
    if (!/^https?:\/\//i.test(v)) throw new BadNotice(`The ${want} must be a web address (http://…) or a data: address`);
    // Videos may be long or live, so the TV plays them from where they are.
    if (want === "video") return v;
    try {
      const res = await ctx.fetchImpl(v, {
        headers: headers && typeof headers === "object" ? Object.fromEntries(Object.entries(headers).map(([k, h]) => [k, String(h)])) : {},
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_FETCHED_IMAGE) throw new Error("it's over 20 MB");
      return (await keep(body, (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase())).url;
    } catch (e) {
      // The words still matter more than the picture: the TV tries the address itself.
      warnings.push(`The Hub couldn't fetch the picture (${e instanceof Error ? e.message : String(e)}), so the TV loads it from the address itself`);
      return v;
    }
  };

  const live = (): TvNotice[] => {
    const now = Date.now();
    for (const [id, n] of notices) if (n.until !== null && n.until <= now) notices.delete(id);
    return [...notices.values()].map((n) => ({ ...n, leftMs: n.until === null ? null : n.until - now }));
  };

  /** Puts a notice up (or replaces the one with the same id); null when there's nothing to show. */
  const show = (input: NoticeInput, image?: string, video?: string): TvNotice | null => {
    const kind = pick(input.kind, NOTICE_KINDS, "info");
    const d = DEFAULTS[kind];
    const title = line(input.title, 120);
    const text = line(input.text ?? input.message, 1000);
    if (!title && !text && !image && !video) return null;
    const seconds = input.seconds === undefined || input.seconds === "" ? d.seconds : Number(input.seconds);
    const now = Date.now();
    const id = typeof input.id === "string" && /^[\w.-]{1,60}$/.test(input.id) ? input.id : randomBytes(6).toString("hex");
    const notice: TvNotice = {
      id,
      kind,
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(image ? { image } : {}),
      ...(video ? { video } : {}),
      muted: flag(input.muted, false),
      position: pick(input.position, NOTICE_POSITIONS, d.position),
      size: pick(input.size, NOTICE_SIZES, d.size),
      sound: pick(input.sound, NOTICE_SOUNDS, d.sound),
      pause: flag(input.pause, false),
      wake: flag(input.wake, d.wake),
      until: Number.isFinite(seconds) && seconds > 0 ? now + Math.min(seconds, 24 * 3600) * 1000 : null,
      leftMs: null,
      at: now,
    };
    // The same id replaces the old one (a second ring of the doorbell), and moves it to the front.
    notices.delete(id);
    notices.set(id, notice);
    while (notices.size > MAX_NOTICES) notices.delete(notices.keys().next().value as string);
    const sent = live().find((n) => n.id === id)!;
    ctx.events.emit({ type: "notice", notice: sent });
    return sent;
  };

  await app.register(async (scope) => {
    // Pictures and videos can be the request body itself (curl --data-binary @snapshot.jpg).
    scope.addContentTypeParser(/^(image|video)\/|^application\/octet-stream/, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

    scope.get("/api/notify", async () => ({ notices: live() }));

    scope.post("/api/notify", { bodyLimit: MAX_UPLOAD }, async (req: Req, reply) => {
      const warnings: string[] = [];
      let input: NoticeInput;
      let image: string | undefined;
      let video: string | undefined;
      if (Buffer.isBuffer(req.body)) {
        input = req.query;
        const kept = await keep(req.body, String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase());
        if (kept.kind === "video") video = kept.url;
        else image = kept.url;
      } else {
        input = req.body && typeof req.body === "object" ? (req.body as NoticeInput) : req.query;
      }
      image ??= await resolveMedia(input.image, "image", input.headers, warnings);
      video ??= await resolveMedia(input.video, "video", input.headers, warnings);
      const sent = show(input, image, video);
      if (!sent) return reply.code(400).send({ error: "Send a title, some text, a picture or a video" });
      return { notice: sent, ...(warnings.length ? { warnings } : {}) };
    });

    /** Uploads a picture or video for a notice sent after; answers with the address to use. */
    scope.post("/api/notify/media", { bodyLimit: MAX_UPLOAD }, async (req: Req, reply) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: "Send the picture or video as the request body" });
      return keep(req.body, String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase());
    });

    scope.get("/api/notify/media/:id", async (req: Req, reply) => {
      const file = media.get(req.params.id ?? "");
      if (!file) return reply.code(404).send({ error: "That picture has gone" });
      reply.header("Cache-Control", "private, max-age=86400");
      return sendFile(req, reply, path.join(mediaDir, file));
    });

    scope.delete("/api/notify/:id", async (req: Req) => {
      notices.delete(req.params.id ?? "");
      ctx.events.emit({ type: "notice.clear", id: req.params.id! });
      return { ok: true };
    });

    scope.delete("/api/notify", async () => {
      notices.clear();
      ctx.events.emit({ type: "notice.clear" });
      return { ok: true };
    });
  });
  return (input) => show(input);
}
