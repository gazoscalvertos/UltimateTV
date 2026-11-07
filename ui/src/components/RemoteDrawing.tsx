// The TV remote drawn in CSS, for the help screen and the first-time tour. `lit` rings the button
// a tour step is talking about.

import { For } from "solid-js";

export type RemoteKey = "ok" | "arrows" | "back" | "home" | "info" | "colours";

export function RemoteDrawing(props: { lit?: RemoteKey }) {
  const lit = (k: RemoteKey) => props.lit === k;
  return (
    <div class="help-remote" aria-hidden="true">
      <div class="remote-body">
        <div class="remote-row">
          <span class="remote-btn small">Power</span>
        </div>
        <div class="remote-pad" classList={{ lit: lit("arrows") }}>
          <span class="remote-btn up">▲</span>
          <span class="remote-btn left">◀</span>
          <span class="remote-btn ok" classList={{ lit: lit("ok") }}>
            OK
          </span>
          <span class="remote-btn right">▶</span>
          <span class="remote-btn down">▼</span>
        </div>
        <div class="remote-row">
          <span class="remote-btn" classList={{ lit: lit("back") }}>
            Back
          </span>
          <span class="remote-btn" classList={{ lit: lit("home") }}>
            Home
          </span>
          <span class="remote-btn" classList={{ lit: lit("info") }}>
            Info
          </span>
        </div>
        <div class="remote-row colours" classList={{ lit: lit("colours") }}>
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
  );
}
