// The strip along the bottom saying what the colour keys (and a few others) do on this screen,
// and the help screen Info opens: the remote drawn with every button labelled.

import { For, Show } from "solid-js";
import { currentHints, EVERYWHERE, type Hint, type HintKey } from "../hints";
import { appName, nav, openDialog } from "../store";
import { DialogFrame } from "./Dialog";

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
            <span>
              <Key k={h.key} />
              {h.label}
            </span>
          )}
        </For>
        <span class="key-hints-help">
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
        <div class="help-remote" aria-hidden="true">
          <div class="remote-body">
            <div class="remote-row">
              <span class="remote-btn small">Power</span>
            </div>
            <div class="remote-pad">
              <span class="remote-btn up">▲</span>
              <span class="remote-btn left">◀</span>
              <span class="remote-btn ok">OK</span>
              <span class="remote-btn right">▶</span>
              <span class="remote-btn down">▼</span>
            </div>
            <div class="remote-row">
              <span class="remote-btn">Back</span>
              <span class="remote-btn">Home</span>
              <span class="remote-btn">Info</span>
            </div>
            <div class="remote-row colours">
              <span class="remote-colour key-red" />
              <span class="remote-colour key-green" />
              <span class="remote-colour key-yellow" />
              <span class="remote-colour key-blue" />
            </div>
            <div class="remote-row">
              <span class="remote-btn">◀◀</span>
              <span class="remote-btn">▶❙❙</span>
              <span class="remote-btn">▶▶</span>
            </div>
            <div class="remote-digits">
              <For each={["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""]}>{(d) => <span class="remote-btn digit">{d}</span>}</For>
            </div>
          </div>
        </div>
        <div class="help-text">
          <Show when={here.length}>
            <h4>On this screen</h4>
            <HintList hints={here} />
          </Show>
          <h4>Everywhere</h4>
          <HintList hints={EVERYWHERE} />
          <p class="hint">Lost? Press Home to go back to the start. The {appName()} phone remote does everything this remote does, and you can talk to it.</p>
        </div>
      </div>
      <div class="dialog-options">
        <button class="btn btn-primary" data-focus data-autofocus onClick={() => close()}>
          Got it
        </button>
      </div>
    </DialogFrame>
  ));
}
