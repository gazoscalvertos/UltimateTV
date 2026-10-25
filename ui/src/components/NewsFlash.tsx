// The phone's news flash: a "breaking news" bar along the bottom of the TV, over whatever is on,
// in the style of the BBC News channel. The text scrolls when it's too long to fit.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { NewsFlash as Flash } from "@ultimatetv/shared";
import { api } from "../api";
import { onHubEvent } from "../events";

const clockText = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function NewsFlash() {
  const [flash, setFlash] = createSignal<Flash | null>(null);
  const [clock, setClock] = createSignal(clockText());
  const [scroll, setScroll] = createSignal(0);
  let hideTimer: number | undefined;
  let strip: HTMLDivElement | undefined;
  let line: HTMLSpanElement | undefined;

  const show = (f: Flash | null) => {
    window.clearTimeout(hideTimer);
    // Timed by what the Hub says is left, not by `until`: the box's clock may not match the Hub's.
    if (f && f.leftMs !== null && f.leftMs <= 0) f = null;
    setFlash(f);
    if (f && f.leftMs !== null) hideTimer = window.setTimeout(() => setFlash(null), f.leftMs);
    // Scroll only when the words don't fit: the distance is measured once they're on screen.
    requestAnimationFrame(() => setScroll(strip && line ? Math.max(0, line.scrollWidth - strip.clientWidth + 48) : 0));
  };
  const load = () => void api<{ flash: Flash | null }>("/api/flash").then((r) => show(r.flash), () => undefined);

  onMount(load);
  const off = onHubEvent((e) => {
    if (e.type === "flash") show(e.flash);
    if (e.type === "hello") load();
  });
  const tick = window.setInterval(() => setClock(clockText()), 10_000);
  onCleanup(() => {
    off();
    window.clearInterval(tick);
    window.clearTimeout(hideTimer);
  });

  return (
    <Show when={flash()}>
      {(f) => (
        <div class="newsflash" role="alert">
          <div class="newsflash-label">{f().label}</div>
          <div class="newsflash-tag">BREAKING NEWS</div>
          <div class="newsflash-strip" ref={strip}>
            <span
              class="newsflash-text"
              classList={{ scrolling: scroll() > 0 }}
              style={scroll() > 0 ? { "--scroll": `-${scroll()}px`, "--scroll-time": `${Math.max(8, scroll() / 60)}s` } : {}}
              ref={line}
            >
              {f().text}
            </span>
          </div>
          <div class="newsflash-clock">{clock()}</div>
        </div>
      )}
    </Show>
  );
}
