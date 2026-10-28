// "Your queue" on Home: what plays next, in order. Selecting one plays it, moves it to the
// front, or takes it off.

import { For, Show } from "solid-js";
import type { QueueItem } from "@ultimatetv/shared";
import { play } from "../player";
import { clearQueue, moveInQueue, queue, removeFromQueue } from "../queue";
import { choose } from "./Dialog";

async function queueActions(item: QueueItem, at: number): Promise<void> {
  const pick = await choose({
    title: item.name,
    ...(item.subtitle ? { message: item.subtitle } : {}),
    ...(item.image ? { image: item.image } : {}),
    options: [
      { label: "Play now", value: "play", icon: "play", ...(queue().length > 1 ? { detail: "The rest of the queue follows" } : {}) },
      ...(at > 0 ? [{ label: "Play next", value: "first", icon: "move" as const }] : []),
      ...(at < queue().length - 1 ? [{ label: "Move to the end", value: "last", icon: "move" as const }] : []),
      { label: "Remove from the queue", value: "remove", icon: "trash" },
      ...(queue().length > 1 ? [{ label: "Clear the whole queue", value: "clear", icon: "close" as const, tone: "danger" as const }] : []),
    ],
  });
  if (pick === "play") void play(item.req, item.title ? { title: item.title } : {});
  else if (pick === "first") void moveInQueue(item.id, 0);
  else if (pick === "last") void moveInQueue(item.id, queue().length - 1);
  else if (pick === "remove") void removeFromQueue(item.id);
  else if (pick === "clear") void clearQueue();
}

export function QueueRow() {
  return (
    <Show when={queue().length}>
      <section class="rail" data-row>
        <h3 class="rail-title">Your queue</h3>
        <div class="rail-track" data-scroll-x="96" data-focus-group>
          <For each={queue()}>
            {(item, i) => (
              <button class="card card-wide" data-focus onClick={() => void queueActions(item, i())}>
                <div class="card-art">
                  <Show when={item.image} fallback={<div class="card-fallback">{item.name}</div>}>
                    <img src={item.image} alt="" loading="lazy" />
                  </Show>
                  <span class="card-badge">{i() === 0 ? "Next" : `${i() + 1}`}</span>
                </div>
                <div class="card-label">
                  <span class="card-title">{item.name}</span>
                  <Show when={item.subtitle}>
                    <span class="card-sub">{item.subtitle}</span>
                  </Show>
                </div>
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
