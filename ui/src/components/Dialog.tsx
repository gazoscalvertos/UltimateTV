// Dialogs: a modal layer that owns the remote while it's open. `choose` is the everyday one
// (pick an option); `askPin` shows a number pad that works with the remote's digit keys too.

import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import type { Action } from "@ultimatetv/shared";
import { digitOf } from "@ultimatetv/shared";
import { current, focusFirst, move } from "../focus";
import { useKeys } from "../keys";
import { dialogs, openDialog } from "../store";
import { Icon } from "./Icon";

export function DialogHost() {
  return <For each={dialogs()}>{(d) => d.render((v) => d.resolve(v))}</For>;
}

/**
 * The frame every dialog sits in. It takes all keys while open: arrows move within it, OK
 * presses, Back closes. `onKey` sees keys first.
 */
export function DialogFrame(props: { close: () => void; class?: string; children: JSX.Element; onKey?: (a: Action) => boolean | void; wide?: boolean }) {
  let el!: HTMLDivElement;
  onMount(() => requestAnimationFrame(() => focusFirst(el)));
  useKeys((a) => {
    if (props.onKey?.(a) === true) return true;
    if (a === "up" || a === "down" || a === "left" || a === "right") move(a);
    else if (a === "ok") current()?.click();
    else if (a === "back") props.close();
    return true;
  });
  return (
    <div class="dialog-backdrop" data-layer ref={el}>
      <div class={`dialog ${props.wide ? "dialog-wide" : ""} ${props.class ?? ""}`} role="dialog">
        {props.children}
      </div>
    </div>
  );
}

export interface ChoiceOption<T> {
  label: string;
  value: T;
  icon?: string;
  tone?: "danger" | "primary";
  detail?: string;
}

export function choose<T>(o: { title: string; message?: string; image?: string; options: ChoiceOption<T>[] }): Promise<T | undefined> {
  return openDialog<T>((close) => (
    <DialogFrame close={() => close()}>
      <Show when={o.image}>
        <img class="dialog-image" src={o.image} alt="" />
      </Show>
      <h2>{o.title}</h2>
      <Show when={o.message}>
        <p class="dialog-message">{o.message}</p>
      </Show>
      <div class="dialog-options" data-scroll-y="0">
        <For each={o.options}>
          {(opt, i) => (
            <button class={`btn ${opt.tone === "danger" ? "btn-danger" : ""} ${i() === 0 ? "btn-primary" : ""}`} data-focus data-autofocus={i() === 0 ? "" : undefined} onClick={() => close(opt.value)}>
              <Show when={opt.icon}>
                <Icon name={opt.icon!} />
              </Show>
              <span>{opt.label}</span>
              <Show when={opt.detail}>
                <small>{opt.detail}</small>
              </Show>
            </button>
          )}
        </For>
      </div>
    </DialogFrame>
  ));
}

export function confirm(title: string, message: string, yes = "Yes", danger = false): Promise<boolean> {
  return choose({ title, message, options: [{ label: yes, value: true, ...(danger ? { tone: "danger" as const } : {}) }, { label: "Cancel", value: false }] }).then((v) => v === true);
}

/** Asks for a 4-digit PIN. `check` returns an error message to shake and try again, or null when right. */
export function askPin(title: string, check: (pin: string) => Promise<string | null>): Promise<boolean> {
  return openDialog<boolean>((close) => {
    const [pin, setPin] = createSignal("");
    const [error, setError] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const press = async (d: string) => {
      if (busy()) return;
      if (d === "del") return setPin((p) => p.slice(0, -1));
      const next = (pin() + d).slice(0, 4);
      setPin(next);
      setError("");
      if (next.length === 4) {
        setBusy(true);
        const err = await check(next);
        setBusy(false);
        if (err) {
          setError(err);
          setPin("");
        } else close(true);
      }
    };
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
    return (
      <DialogFrame
        close={() => close(false)}
        class="pin-dialog"
        onKey={(a) => {
          const d = digitOf(a);
          if (d !== null) {
            void press(String(d));
            return true;
          }
          return false;
        }}
      >
        <Icon name="lock" class="pin-lock" />
        <h2>{title}</h2>
        <div class={`pin-dots ${error() ? "shake" : ""}`}>
          <For each={[0, 1, 2, 3]}>{(i) => <span classList={{ filled: pin().length > i }} />}</For>
        </div>
        <p class="pin-error">{error() || " "}</p>
        <div class="pin-pad">
          <For each={keys}>
            {(k) => (
              <button class="pin-key" data-focus data-autofocus={k === "1" ? "" : undefined} onClick={() => (k === "ok" ? close(false) : void press(k))}>
                {k === "del" ? "⌫" : k === "ok" ? "Cancel" : k}
              </button>
            )}
          </For>
        </div>
      </DialogFrame>
    );
  }).then((v) => v === true);
}

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890".split("");

/** Asks for a short piece of text (a profile name) with an on-screen keyboard. */
export function askText(title: string, initial = ""): Promise<string | undefined> {
  return openDialog<string>((close) => {
    const [text, setText] = createSignal(initial);
    return (
      <DialogFrame close={() => close()} class="text-dialog">
        <h2>{title}</h2>
        <div class="text-value">{text() || " "}</div>
        <div class="keyboard keyboard-compact">
          <For each={KEYS}>
            {(k, i) => (
              <button class="key" data-focus data-autofocus={i() === 0 ? "" : undefined} onClick={() => setText((t) => (t.length ? t + k.toLowerCase() : k))}>
                {k}
              </button>
            )}
          </For>
          <button class="key key-wide" data-focus onClick={() => setText((t) => t + " ")}>
            Space
          </button>
          <button class="key key-wide" data-focus onClick={() => setText((t) => t.slice(0, -1))}>
            Delete
          </button>
          <button class="key key-wide key-done" data-focus onClick={() => close(text().trim() || undefined)}>
            Done
          </button>
        </div>
      </DialogFrame>
    );
  });
}
