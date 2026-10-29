// A row on a settings page: a label, a hint underneath, and the value on the right. OK changes it.

import { Show, type JSX } from "solid-js";
import { Icon } from "./Icon";

export function Row(props: { label: string; value?: JSX.Element; hint?: string; onSelect?: () => void; icon?: string }) {
  return (
    <button class="setting-row" data-focus onClick={() => props.onSelect?.()}>
      <Show when={props.icon}>
        <Icon name={props.icon!} class="setting-icon" />
      </Show>
      <span class="setting-label">
        {props.label}
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </span>
      <span class="setting-value">{props.value}</span>
    </button>
  );
}

export function Status(props: { ok: boolean; text: string }) {
  return (
    <span class="status" classList={{ ok: props.ok }}>
      <Show when={props.ok} fallback={<span class="status-dot" />}>
        <Icon name="check" />
      </Show>
      {props.text}
    </span>
  );
}

export const cycle = <T,>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length]!;
