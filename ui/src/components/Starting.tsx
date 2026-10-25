// What the TV shows while something starts: the title, what it's waiting on, a moving bar, how long
// it has been and how fast it's arriving. TorBox versions can take a minute or more when TorBox is
// still fetching the file, so after a while it says so instead of looking stuck.

import { createSignal, onCleanup, Show } from "solid-js";

export interface StartingProps {
  title?: string;
  /** Where it comes from ("TorBox", "Jellyfin", "IPTV"). */
  source?: string;
  /** What it's waiting on now. */
  step: string;
  since: number;
  downloadKbps?: number;
  bufferedMs?: number;
}

const SLOW_S = 25;

export function speedLabel(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(kbps >= 10_000 ? 0 : 1)} Mb/s` : `${Math.round(kbps)} kb/s`;
}

export function StartingCard(props: StartingProps) {
  const [tick, setTick] = createSignal(Date.now());
  const timer = window.setInterval(() => setTick(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  const seconds = () => Math.max(0, Math.floor((tick() - props.since) / 1000));
  const online = () => /torbox|aiostreams|online/i.test(props.source ?? "");

  return (
    <div class="starting" role="status">
      <Show when={props.title}>
        <h2 class="starting-title">{props.title}</h2>
      </Show>
      <p class="starting-step">
        {props.step}
        <Show when={props.source}> · {props.source}</Show>
      </p>
      <div class="starting-bar">
        <span />
      </div>
      <p class="starting-detail">
        <span>{seconds()} s</span>
        <Show when={props.downloadKbps}>
          <span>{speedLabel(props.downloadKbps!)}</span>
        </Show>
        <Show when={props.bufferedMs}>
          <span>{(props.bufferedMs! / 1000).toFixed(1)} s ready</span>
        </Show>
      </p>
      <Show when={seconds() >= SLOW_S}>
        <p class="starting-slow">
          {online()
            ? "TorBox may still be fetching this one, which can take a minute or two. Keep waiting, or press Back and choose another version."
            : "This is taking longer than usual. Keep waiting, or press Back to stop."}
        </p>
      </Show>
    </div>
  );
}
