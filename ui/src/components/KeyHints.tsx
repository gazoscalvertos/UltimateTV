// The strip along the bottom saying what the colour keys (and a few others) do on this screen,
// and the help screen Info opens: the remote drawn with every button labelled.

import { For, Show } from "solid-js";
import { currentHints, everywhere, type Hint, type HintKey } from "../hints";
import { appName, nav, openDialog } from "../store";
import { DialogFrame } from "./Dialog";
import { RemoteDrawing } from "./RemoteDrawing";
import { runTour } from "./Tour";

/** The key a hint stands for when clicked (mouse.ts); arrows and digits aren't one key. */
export function hintAction(k: HintKey): string | undefined {
  return k === "play" ? "playPause" : ["arrows", "updown", "leftright", "digits"].includes(k) ? undefined : k;
}

const LABELS: Partial<Record<HintKey, string>> = { ok: "OK", back: "Back", info: "Info", guide: "Guide", play: "▶❙❙", record: "●", arrows: "◀▲▼▶", updown: "▲▼", leftright: "◀▶", digits: "0–9" };

export function Key(props: { k: HintKey }) {
  return (
    <Show when={["red", "green", "yellow", "blue"].includes(props.k)} fallback={<kbd>{LABELS[props.k]}</kbd>}>
      <kbd class={`key-${props.k}`} />
    </Show>
  );
}

/** Hidden over full-screen video, which has its own banner, and when a screen says nothing. */
export function KeyHints() {
  const shown = () => (nav.current().name === "player" || nav.current().name === "profiles" ? [] : currentHints());
  return (
    <Show when={shown().length}>
      <div class="key-hints" aria-hidden="true">
        <For each={shown()}>
          {(h) => (
            <span data-key={hintAction(h.key)}>
              <Key k={h.key} />
              {h.label}
            </span>
          )}
        </For>
        <span class="key-hints-help" data-key="info">
          <kbd>Info</kbd>
          Help
        </span>
      </div>
    </Show>
  );
}

function HintList(props: { hints: Hint[] }) {
  return (
    <ul class="help-list">
      <For each={props.hints}>
        {(h) => (
          <li>
            <span class="help-key">
              <Key k={h.key} />
            </span>
            {h.label}
          </li>
        )}
      </For>
    </ul>
  );
}

/** "What do the buttons do?": this screen's keys, the ones that work everywhere, and the remote drawn. */
export function openHelp(): Promise<unknown> {
  const here = currentHints();
  return openDialog((close) => (
    <DialogFrame close={() => close()} class="help-dialog" wide onKey={(a) => (a === "info" ? (close(), true) : false)}>
      <h2>What the buttons do</h2>
      <div class="help-layout">
        <RemoteDrawing />
        <div class="help-text">
          <Show when={here.length}>
            <h4>On this screen</h4>
            <HintList hints={here} />
          </Show>
          <h4>Everywhere</h4>
          <HintList hints={everywhere()} />
          <p class="hint">Lost? Press Home to go back to the start. The {appName()} phone remote does everything this remote does, and you can talk to it.</p>
        </div>
      </div>
      <div class="dialog-options">
        <button class="btn btn-primary" data-focus data-autofocus onClick={() => close()}>
          Got it
        </button>
        <button
          class="btn"
          data-focus
          onClick={() => {
            close();
            void runTour();
          }}
        >
          Show me around
        </button>
      </div>
    </DialogFrame>
  ));
}
