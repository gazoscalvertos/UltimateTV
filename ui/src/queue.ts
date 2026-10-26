// The play queue, kept by the Hub so the phone can add to it too. What's queued plays when what's
// on ends, ahead of the next episode; an item comes off the queue as it starts.

import { createEffect, createRoot, createSignal, on } from "solid-js";
import type { PlaybackRequest, QueueItem, TitleRef } from "@ultimatetv/shared";
import { api } from "./api";
import { onHubEvent } from "./events";
import { errorToast, profile, toast } from "./store";

export const [queue, setQueue] = createSignal<QueueItem[]>([]);

type QueueAnswer = { queue: QueueItem[]; item?: QueueItem };
const enc = encodeURIComponent;

async function load(): Promise<void> {
  const r = await api<QueueAnswer>("/api/queue").catch(() => null);
  if (r) setQueue(r.queue);
}

let started = false;
export function startQueue(): void {
  if (started) return;
  started = true;
  onHubEvent((e) => (e.type === "queue.changed" || e.type === "hello" ? void load() : undefined));
  // Kids see only what their profile allows, so look again on switching.
  createRoot(() => createEffect(on(() => profile()?.id, () => void load())));
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

export interface QueueAdd {
  req: PlaybackRequest;
  name: string;
  title?: TitleRef;
  subtitle?: string;
  image?: string;
  /** Put it at the front, to play next. */
  next?: boolean;
}

export async function addToQueue(add: QueueAdd): Promise<void> {
  try {
    const r = await api<QueueAnswer>("/api/queue", { method: "POST", body: add });
    setQueue(r.queue);
    const at = r.queue.findIndex((i) => i.id === r.item?.id) + 1;
    const what = add.subtitle ? `${add.name} (${add.subtitle})` : add.name;
    toast(at <= 1 ? `${what} plays next` : `${what} is ${ordinal(at)} in your queue`, "good");
  } catch (err) {
    errorToast(err);
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  const r = await api<QueueAnswer>(`/api/queue/${enc(id)}`, { method: "DELETE" }).catch(() => null);
  if (r) setQueue(r.queue);
}

export async function moveInQueue(id: string, to: number): Promise<void> {
  const r = await api<QueueAnswer>(`/api/queue/${enc(id)}/move`, { method: "POST", body: { to } }).catch((err: unknown) => (errorToast(err), null));
  if (r) setQueue(r.queue);
}

export async function clearQueue(): Promise<void> {
  const r = await api<QueueAnswer>("/api/queue", { method: "DELETE" }).catch(() => null);
  if (r) setQueue(r.queue);
}

const sameReq = (a: PlaybackRequest, b: PlaybackRequest) => a.kind === b.kind && a.id === b.id && (a.episodeId ?? "") === (b.episodeId ?? "");

/** Something started playing: if it was queued, it's off the queue now. */
export function startedPlaying(req: PlaybackRequest): void {
  const item = queue().find((i) => sameReq(i.req, req));
  if (!item) return;
  setQueue((q) => q.filter((i) => i !== item));
  void removeFromQueue(item.id);
}
