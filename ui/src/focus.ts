// Spatial navigation for the remote. Anything with `data-focus` can take focus; arrows move to
// the nearest one in that direction within the top layer (a dialog, or else the screen).
// A `data-focus-group` (a rail, a menu) remembers its last focused item, so coming back to a
// rail lands where you left it, as on Sky and Netflix. A group with `data-focus-only="up"` (the
// top menu) is only entered by pressing that direction.

import { reducedMotion } from "./store";

export type Direction = "up" | "down" | "left" | "right";

const lastInGroup = new WeakMap<Element, HTMLElement>();

/** The topmost layer: the last open dialog, else the current screen. */
export function activeLayer(): HTMLElement {
  const layers = document.querySelectorAll<HTMLElement>("[data-layer]");
  return layers[layers.length - 1] ?? document.body;
}

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

export function focusables(root: HTMLElement = activeLayer()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-focus]")].filter((el) => !el.hasAttribute("disabled") && visible(el));
}

export function current(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  return el && el.hasAttribute("data-focus") && activeLayer().contains(el) ? el : null;
}

export function focus(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  el.focus({ preventScroll: true });
  reveal(el);
  return true;
}

/** Focus the layer's `data-autofocus` item, or its first focusable. */
export function focusFirst(root: HTMLElement = activeLayer()): boolean {
  const auto = root.querySelector<HTMLElement>("[data-autofocus]");
  if (auto && visible(auto)) return focus(auto);
  return focus(focusables(root)[0]);
}

export function move(dir: Direction): boolean {
  const from = current();
  if (!from) return focusFirst();
  const a = from.getBoundingClientRect();
  const fromGroup = from.closest("[data-focus-group]");
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of focusables()) {
    if (el === from) continue;
    // Some groups (the top menu) are only entered in one direction.
    const only: HTMLElement | null = el.closest<HTMLElement>("[data-focus-only]");
    if (only && !only.contains(from) && only.dataset.focusOnly !== dir) continue;
    const b = el.getBoundingClientRect();
    // Distance along the direction of travel, edge to edge; candidates behind us are skipped.
    let main: number;
    let cross: number;
    if (dir === "right" || dir === "left") {
      main = dir === "right" ? b.left - a.right : a.left - b.right;
      // Only things that start beyond our edge (a little overlap allowed), so a wide menu bar
      // above doesn't count as being to the right of a side menu.
      if (main < -16) continue;
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      cross = overlap > 0 ? 0 : Math.abs(b.top + b.height / 2 - (a.top + a.height / 2));
    } else {
      main = dir === "down" ? b.top - a.bottom : a.top - b.bottom;
      if (main < -16) continue;
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      cross = overlap > 0 ? 0 : Math.abs(b.left + b.width / 2 - (a.left + a.width / 2));
    }
    const score = Math.max(main, 0) + cross * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;

  // Entering another group: go back to where we were in it.
  const toGroup = best.closest("[data-focus-group]");
  if (toGroup && toGroup !== fromGroup) {
    const remembered = lastInGroup.get(toGroup);
    if (remembered && remembered.isConnected && visible(remembered)) best = remembered;
  }
  return focus(best);
}

/** Records the last focused item of each group. */
document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  const group = el.closest?.("[data-focus-group]");
  if (group) lastInGroup.set(group, el);
});

/** Scrolls rails sideways and pages up and down so the focused item is on screen. */
export function reveal(el: HTMLElement): void {
  const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
  const row = el.closest<HTMLElement>("[data-scroll-x]");
  if (row) {
    const pad = Number(row.dataset.scrollX) || 0;
    const r = el.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (r.left < box.left + pad || r.right > box.right - pad) {
      const target = row.scrollLeft + (r.left - box.left) - pad;
      row.scrollTo({ left: Math.max(0, target), behavior });
    }
  }
  const page = el.closest<HTMLElement>("[data-scroll-y]");
  if (page) {
    const anchor = el.closest<HTMLElement>("[data-row]") ?? el;
    const r = anchor.getBoundingClientRect();
    const box = page.getBoundingClientRect();
    const top = Number(page.dataset.scrollY) || 0;
    if (r.top < box.top + top || r.bottom > box.bottom - 24) {
      const target = page.scrollTop + (r.top - box.top) - top;
      page.scrollTo({ top: Math.max(0, target), behavior });
    }
  }
}
