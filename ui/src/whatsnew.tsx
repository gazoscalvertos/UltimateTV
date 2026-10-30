// What's new: after an update, Home pops up the changes this TV hasn't shown yet (from the Hub's
// CHANGELOG.md, GET /api/changelog). Settings › What's new lists all of them.

import { createEffect, For, on, Show } from "solid-js";
import type { ChangeEntry, Changelog } from "@ultimatetv/shared";
import { unseenChanges } from "@ultimatetv/shared";
import { hub } from "./api";
import { DialogFrame } from "./components/Dialog";
import { nowPlaying } from "./player";
import { dialogs, isKids, nav, openDialog } from "./store";

const SEEN_KEY = "utv-changelog-seen";
/** The pop-up lists this many; the rest are a button away. */
const SHOW_AT_MOST = 8;

export function seenChange(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markChangesSeen(log: Changelog): void {
  if (!log.latest) return;
  try {
    localStorage.setItem(SEEN_KEY, log.latest);
  } catch {
    // No storage: it shows again next time, which is harmless.
  }
}

function WhatsNewDialog(props: { entries: ChangeEntry[]; close: (all?: boolean) => void }) {
  const more = () => props.entries.length - SHOW_AT_MOST;
  return (
    <DialogFrame close={() => props.close()} wide class="whatsnew-dialog">
      <h2>What's new</h2>
      <p class="dialog-message">
        {props.entries.length === 1 ? "One change since you last looked." : `${props.entries.length} changes since you last looked.`}
      </p>
      <div class="dialog-options whatsnew-list" data-scroll-y="0">
        <For each={props.entries.slice(0, SHOW_AT_MOST)}>
          {(e) => (
            <button class="whatsnew-item" data-focus>
              <strong>{e.title}</strong>
              <Show when={e.text}>
                <span>{e.text}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <div class="whatsnew-actions">
        <button class="btn btn-primary" data-focus data-autofocus onClick={() => props.close()}>
          Got it
        </button>
        <button class="btn" data-focus onClick={() => props.close(true)}>
          {more() > 0 ? `See all (${more()} more)` : "See all changes"}
        </button>
      </div>
    </DialogFrame>
  );
}

let showing = false;
let checkedAt = 0;

/** Pops up what's new once, on Home, when nothing else is on screen. */
async function check(): Promise<void> {
  if (showing || isKids() || Date.now() - checkedAt < 10 * 60_000) return;
  checkedAt = Date.now();
  const log = await hub.changelog().catch(() => null);
  if (!log?.latest) return;
  const entries = unseenChanges(log, seenChange());
  if (!entries.length) {
    markChangesSeen(log);
    return;
  }
  // Something else came up while asking the Hub.
  if (nav.current().name !== "home" || dialogs().length || nowPlaying()) return;
  showing = true;
  const all = await openDialog<boolean>((close) => <WhatsNewDialog entries={entries} close={(v) => close(v)} />);
  showing = false;
  markChangesSeen(log);
  if (all) nav.push({ name: "settings", section: "whatsnew" });
}

export function startWhatsNew(): void {
  createEffect(
    on(
      () => nav.current().name === "home",
      (home) => {
        if (home) void check();
      },
    ),
  );
  // A TV left on Home for days still hears about a Hub update.
  window.setInterval(() => nav.current().name === "home" && void check(), 60 * 60_000);
}
