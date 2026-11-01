// The mouse, for the app on a desktop (the AppImage, docs/desktop.md) and in a browser. The TV box
// has no mouse and its pointer stays hidden, so none of this runs there.
//
//   hover      moves the focus, as the arrows would, so OK, the colour keys and the screen's own
//              keys act on what's under the pointer. A key press wins: the pointer has to move
//              again before hover takes the focus back.
//   click      presses the thing (they're buttons already); a `data-key` element presses that
//              remote key (the strip of key hints, "OK to close" on a pop-up).
//   right-click, the mouse's back button   Back.
//   wheel      scrolls the page; sideways (or with Shift) scrolls a row. Arrows at a row's ends
//              scroll it too. Lists that scroll themselves (the guide) take the wheel as up/down.
//   pointer    hidden after a few seconds still, or as soon as the keyboard is used.

import type { Action } from "@ultimatetv/shared";
import { onBox, onDesktop } from "./agent";
import { activeLayer } from "./focus";
import { dispatch } from "./keys";

/** Whether this copy of the app takes the mouse: everywhere but the TV box. */
export const mouseMode = onDesktop || !onBox;

const IDLE_MS = 3000;
const listeners = new Set<() => void>();

/** Told whenever the mouse is used (moved or clicked), e.g. to show the player's controls. */
export function onMouse(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let moved = false;
/**
 * Whether the mousemove being handled is the pointer really moving, not the page changing under a
 * still one (after a key press scrolled it, say). Hover handlers check it so the keys keep the focus.
 */
export const pointerMoved = (): boolean => moved;

const isTyping = (el: Element | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

const KEYS = new Set<string>(["ok", "back", "red", "green", "yellow", "blue", "guide", "info", "play", "pause", "playPause", "stop", "rewind", "fastForward", "record", "channelUp", "channelDown", "home", "up", "down", "left", "right"]);

/** The remote key a `data-key` element stands for, if it's one the app knows. */
export function keyOf(el: Element | null): Action | null {
  const name = el?.closest<HTMLElement>("[data-key]")?.dataset.key;
  return name && KEYS.has(name) ? (name as Action) : null;
}

/**
 * Wheel movement as whole steps: a mouse wheel's notch is one, a touchpad's many small deltas add
 * up to one every so often instead of racing through the list.
 */
export function wheelSteps(): (e: WheelEvent) => { x: number; y: number } {
  let ax = 0;
  let ay = 0;
  let last = 0;
  return (e) => {
    const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
    if (e.timeStamp - last > 400) ax = ay = 0;
    last = e.timeStamp;
    const horizontal = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
    ax += horizontal * scale;
    ay += (e.shiftKey ? 0 : e.deltaY) * scale;
    const x = Math.trunc(ax / 50);
    const y = Math.trunc(ay / 50);
    ax -= x * 50;
    ay -= y * 50;
    return { x, y };
  };
}

function scrollable(el: HTMLElement, axis: "x" | "y"): boolean {
  return axis === "x" ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
}

/** The pair of arrows over the ends of the row under the pointer. */
function rowArrows(): { update: (target: Element | null) => void } {
  let row: HTMLElement | null = null;
  const make = (dir: -1 | 1) => {
    const b = document.createElement("button");
    b.className = `row-arrow row-arrow-${dir < 0 ? "left" : "right"}`;
    b.tabIndex = -1;
    b.setAttribute("aria-label", dir < 0 ? "Scroll left" : "Scroll right");
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${dir < 0 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}"/></svg>`;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (row) row.scrollBy({ left: dir * row.clientWidth * 0.75, behavior: "smooth" });
      window.setTimeout(place, 400);
    });
    document.body.append(b);
    return b;
  };
  const left = make(-1);
  const right = make(1);
  const place = () => {
    const r = row?.getBoundingClientRect();
    const show = row && r && row.isConnected && scrollable(row, "x");
    left.classList.toggle("show", Boolean(show && row!.scrollLeft > 2));
    right.classList.toggle("show", Boolean(show && row!.scrollLeft + row!.clientWidth < row!.scrollWidth - 2));
    if (!show) return;
    for (const b of [left, right]) {
      b.style.top = `${r.top}px`;
      b.style.height = `${r.height}px`;
    }
    left.style.left = `${Math.max(0, r.left)}px`;
    right.style.left = `${Math.min(window.innerWidth, r.right) - right.offsetWidth}px`;
  };
  return {
    update(target) {
      if (target === left || target === right || left.contains(target) || right.contains(target)) return;
      const next = target?.closest<HTMLElement>("[data-scroll-x]") ?? null;
      row = next && activeLayer().contains(next) ? next : null;
      place();
    },
  };
}

export function installMouse(): void {
  if (!mouseMode) return;
  const html = document.documentElement;
  html.classList.add("mouse", "mouse-idle");
  let idleTimer: number | undefined;
  let lastX = -1;
  let lastY = -1;
  const arrows = rowArrows();
  const used = () => {
    html.classList.remove("mouse-idle");
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => html.classList.add("mouse-idle"), IDLE_MS);
    for (const fn of listeners) fn();
  };

  window.addEventListener(
    "mousemove",
    (e) => {
      // Chromium sends a move when the page scrolls or changes under a still pointer: not a move.
      moved = Math.abs(e.clientX - lastX) >= 3 || Math.abs(e.clientY - lastY) >= 3;
      if (!moved) return;
      lastX = e.clientX;
      lastY = e.clientY;
      used();
      const target = e.target as Element | null;
      arrows.update(target);
      const el = target?.closest?.<HTMLElement>("[data-focus]");
      if (!el || el === document.activeElement || el.hasAttribute("disabled") || !activeLayer().contains(el)) return;
      // Typing in a box keeps the focus until something is clicked; boxes themselves take a click.
      if (isTyping(document.activeElement) || isTyping(el)) return;
      el.focus({ preventScroll: true });
    },
    // Capture, so a screen's own onMouseMove can ask pointerMoved() about the same event.
    { passive: true, capture: true },
  );

  // The keyboard (or remote) takes over: hide the pointer until it moves.
  window.addEventListener(
    "keydown",
    () => {
      clearTimeout(idleTimer);
      html.classList.add("mouse-idle");
    },
    true,
  );

  window.addEventListener(
    "click",
    (e) => {
      used();
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const layer = activeLayer();
      // A remote key drawn on screen.
      const key = keyOf(target);
      if (key) {
        e.preventDefault();
        e.stopPropagation();
        dispatch(key);
        return;
      }
      // Clicking beside a dialog closes it, as Back does.
      if (target === layer && layer.classList.contains("dialog-backdrop")) {
        e.stopPropagation();
        dispatch("back");
        return;
      }
      // Under an open dialog: not clickable, as the remote can't reach it either.
      const el = target.closest<HTMLElement>("[data-focus]");
      if (el && !layer.contains(el)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // Right-click is Back (a text box keeps its menu).
  window.addEventListener("contextmenu", (e) => {
    if (isTyping(e.target as Element)) return;
    e.preventDefault();
    used();
    dispatch("back");
  });
  // The mouse's side buttons: back is Back; neither moves the page's history.
  const side = (e: MouseEvent) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.type === "mouseup" && e.button === 3) {
      used();
      dispatch("back");
    }
  };
  window.addEventListener("mousedown", side, true);
  window.addEventListener("mouseup", side, true);

  // The wheel: a screen's own handler (onWheel) goes first; otherwise scroll what's under the pointer.
  window.addEventListener(
    "wheel",
    (e) => {
      used();
      if (e.defaultPrevented || e.ctrlKey) return;
      const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
      const delta = (sideways ? (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) : e.deltaY) * scale;
      const layer = activeLayer();
      for (let el = e.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (!layer.contains(el)) return;
        // Rows and pages hide their scroll bars (overflow: hidden, for the remote), so scroll them by hand.
        const managed = sideways ? el.hasAttribute("data-scroll-x") : el.hasAttribute("data-scroll-y");
        if (managed && scrollable(el, sideways ? "x" : "y")) {
          e.preventDefault();
          if (sideways) el.scrollLeft += delta;
          else el.scrollTop += delta;
          arrows.update(e.target as Element);
          return;
        }
        // Anything that scrolls by itself does so.
        const style = getComputedStyle(el);
        const overflow = sideways ? style.overflowX : style.overflowY;
        if ((overflow === "auto" || overflow === "scroll") && scrollable(el, sideways ? "x" : "y")) return;
      }
    },
    { passive: false },
  );
}
