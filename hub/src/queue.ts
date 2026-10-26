// The play queue: films, episodes and recordings lined up to play one after another, added on
// the TV or the phone. One queue for the TV, kept in the database so a restart doesn't lose it.
// The TV plays the first item when what's on ends, ahead of the next episode, and takes it off
// the queue as it starts.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlaybackRequest, QueueItem, TitleRef } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import type { Db } from "./db.js";
import { newId } from "./db.js";
import type { EventBus } from "./events.js";
import type { ContentFilter } from "./profiles.js";

const KEY = "queue";
const MAX_ITEMS = 50;
/** Live channels never end, so there's nothing to play after them. */
const QUEUEABLE = new Set<PlaybackRequest["kind"]>(["title", "recording", "catchup"]);

export class QueueError extends Error {}

export interface QueueInput {
  req?: Partial<PlaybackRequest>;
  title?: TitleRef;
  name?: string;
  subtitle?: string;
  image?: string;
  /** Put it at the front, to play next. */
  next?: boolean;
}

const sameReq = (a: PlaybackRequest, b: PlaybackRequest) => a.kind === b.kind && a.id === b.id && (a.episodeId ?? "") === (b.episodeId ?? "");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export class PlayQueue {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  list(): QueueItem[] {
    return this.db.getKv<QueueItem[]>(KEY) ?? [];
  }

  /** Adds to the end (or the front). Something already queued moves rather than appearing twice. */
  add(input: QueueInput, now = Date.now()): { item: QueueItem; queue: QueueItem[] } {
    const r = input.req;
    if (!r || typeof r.id !== "string" || !r.id || !r.kind || !QUEUEABLE.has(r.kind)) throw new QueueError("Only films, episodes and recordings can be queued");
    const req: PlaybackRequest = { kind: r.kind, id: r.id };
    if (typeof r.episodeId === "string" && r.episodeId) req.episodeId = r.episodeId;
    if (typeof r.start === "number") req.start = r.start;
    if (typeof r.streamId === "string" && r.streamId) req.streamId = r.streamId;
    const name = text(input.name, 120) || text(input.title?.name, 120);
    if (!name) throw new QueueError("Say what it's called");
    const list = this.list();
    const old = list.find((i) => sameReq(i.req, req));
    const rest = list.filter((i) => i !== old);
    if (!old && rest.length >= MAX_ITEMS) throw new QueueError(`The queue holds ${MAX_ITEMS} things. Watch or remove some first.`);
    const item: QueueItem = { id: old?.id ?? newId("q"), req, name, addedAt: old?.addedAt ?? now };
    const subtitle = text(input.subtitle, 160);
    if (subtitle) item.subtitle = subtitle;
    const image = text(input.image, 1000);
    if (image) item.image = image;
    if (input.title?.id) item.title = input.title;
    const queue = input.next ? [item, ...rest] : old ? list.map((i) => (i === old ? item : i)) : [...rest, item];
    this.save(queue);
    return { item, queue };
  }

  remove(id: string): boolean {
    const list = this.list();
    const next = list.filter((i) => i.id !== id);
    if (next.length === list.length) return false;
    this.save(next);
    return true;
  }

  /** Moves an item to position `to` (0 is next to play). */
  move(id: string, to: number): QueueItem[] {
    const list = this.list();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new QueueError("That's no longer in the queue");
    const [item] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, Math.floor(to))), 0, item!);
    this.save(list);
    return list;
  }

  clear(): void {
    if (this.list().length) this.save([]);
  }

  private save(queue: QueueItem[]): void {
    this.db.setKv(KEY, queue);
    this.events.emit({ type: "queue.changed" });
  }
}

/** Kids see (and so play) only what their profile allows; everyone shares the one queue. */
function visible(ctx: HubContext, queue: QueueItem[], f: ContentFilter): QueueItem[] {
  if (!f.kids) return queue;
  return queue.filter((i) => {
    if (i.req.kind === "title") return Boolean(i.title) && f.ref(i.title!);
    const channelId = i.req.kind === "recording" ? ctx.recordings.get(i.req.id)?.channelId : ctx.guide.get(i.req.id)?.channelId;
    const channel = channelId ? ctx.channels.get(channelId) : undefined;
    return channel !== undefined && f.channel(channel);
  });
}

export function registerQueue(app: FastifyInstance, ctx: HubContext, filterOf: (req: FastifyRequest) => ContentFilter): void {
  const queue = ctx.queue;
  type Body<B> = FastifyRequest<{ Body: B; Params: { id: string } }>;
  const list = (req: FastifyRequest) => ({ queue: visible(ctx, queue.list(), filterOf(req)) });
  app.get("/api/queue", async (req) => list(req));
  app.post("/api/queue", async (req: Body<QueueInput>, reply) => {
    try {
      const { item } = queue.add(req.body ?? {});
      return { item, ...list(req) };
    } catch (err) {
      if (err instanceof QueueError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
  app.post("/api/queue/:id/move", async (req: Body<{ to?: number }>, reply) => {
    const to = Number(req.body?.to);
    if (!Number.isFinite(to)) return reply.code(400).send({ error: "Say where to move it" });
    try {
      queue.move(req.params.id, to);
      return list(req);
    } catch (err) {
      if (err instanceof QueueError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });
  app.delete("/api/queue/:id", async (req: Body<unknown>) => ({ ok: queue.remove(req.params.id), ...list(req) }));
  app.delete("/api/queue", async (req) => {
    queue.clear();
    return list(req);
  });
}
