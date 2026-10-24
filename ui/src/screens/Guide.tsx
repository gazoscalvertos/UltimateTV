// The TV guide, Sky-style: live TV keeps playing in the corner, details of the highlighted
// programme beside it, and a grid of channels against time. Left/right walk through programmes,
// up/down through channels, digits jump to a channel number, Record records.

import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { Channel, GuideWindow, Programme, ProgrammeMark } from "@ultimatetv/shared";
import { clockTime, dayLabel, digitOf, episodeLabel } from "@ultimatetv/shared";
import { agent } from "../agent";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { openProgramme, recordFlow, timeRange } from "../components/ProgrammeCard";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { move } from "../focus";
import { useKeys } from "../keys";
import { channels as allChannels, liveChannelId, nowPlaying, play, stopPlayback } from "../player";
import { nav, now } from "../store";

const SLOT = 30 * 60_000;
const SPAN = 2 * 3_600_000; // Two hours across the grid, as on Sky.
/** Channel rows shown at most; fewer when the screen is too short for them all. */
const MAX_ROWS = 7;
const floorSlot = (ms: number) => Math.floor(ms / SLOT) * SLOT;

const CATEGORIES: { id: string; label: string }[] = [
  { id: "", label: "All channels" },
  { id: "favourites", label: "Favourites" },
  { id: "entertainment", label: "Entertainment" },
  { id: "films", label: "Films" },
  { id: "sport", label: "Sport" },
  { id: "news", label: "News" },
  { id: "documentaries", label: "Documentaries" },
  { id: "kids", label: "Kids" },
];

export function Guide() {
  const [category, setCategory] = createSignal("");
  const [winStart, setWinStart] = createSignal(floorSlot(Date.now()));
  const [anchor, setAnchor] = createSignal(Date.now());
  const [row, setRow] = createSignal(0);
  const [top, setTop] = createSignal(0);
  const [digits, setDigits] = createSignal("");
  const [rows, setRows] = createSignal(MAX_ROWS);
  const [loadRange, setLoadRange] = createSignal({ from: floorSlot(Date.now()) - 3 * 3_600_000, to: floorSlot(Date.now()) + 9 * 3_600_000 });
  const [guide, { refetch }] = createResource(
    () => ({ ...loadRange(), category: category() }),
    (k) => hub.guide(k.from, k.to, k.category || undefined),
  );
  // Keep the last good window while a new one loads, so the grid never blanks.
  const [data, setData] = createSignal<GuideWindow | null>(null);
  createEffect(() => {
    const g = guide();
    if (g) setData(g);
  });
  onCleanup(onHubEvent((e) => (e.type === "recordings.changed" || e.type === "guide.updated" ? void refetch() : undefined)));

  const channels = createMemo<Channel[]>(() => data()?.channels ?? []);
  const visible = createMemo(() => channels().slice(top(), top() + rows()));
  const channel = () => channels()[row()];

  const programmesOf = (id: string): Programme[] => data()?.programmes[id] ?? [];
  const selected = createMemo<Programme | undefined>(() => {
    const c = channel();
    if (!c) return undefined;
    const t = anchor();
    return programmesOf(c.id).find((p) => p.start <= t && p.end > t);
  });
  const markOf = (p: Programme): ProgrammeMark | undefined => data()?.marks[p.id];

  // Keep the anchor on screen and the data loaded around it.
  createEffect(
    on(anchor, (t) => {
      let w = winStart();
      while (t < w) w -= SLOT;
      while (t >= w + SPAN - SLOT) w += SLOT;
      setWinStart(w);
      const r = loadRange();
      if (w < r.from || w + SPAN > r.to) setLoadRange({ from: w - 3 * 3_600_000, to: w + 9 * 3_600_000 });
    }),
  );
  createEffect(
    on(row, (r) => {
      if (r < top()) setTop(r);
      else if (r >= top() + rows()) setTop(r - rows() + 1);
    }),
  );
  // Start on the channel that's playing.
  createEffect(
    on(channels, (list) => {
      const live = liveChannelId();
      const i = live ? list.findIndex((c) => c.id === live) : -1;
      if (i >= 0 && row() === 0) {
        setRow(i);
        setTop(Math.max(0, Math.min(i - 2, list.length - rows())));
      } else if (row() >= list.length) setRow(0);
    }),
  );

  // Live TV in the preview window.
  let preview!: HTMLDivElement;
  let grid!: HTMLDivElement;
  // As many rows as fit the space under the preview, so the selected channel never goes off screen.
  const fitRows = (el: HTMLDivElement) => {
    const fit = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const n = Math.floor(el.clientHeight / (4.6 * rem + 1));
      if (n > 0) setRows(Math.min(MAX_ROWS, n));
      if (row() >= top() + rows()) setTop(Math.max(0, row() - rows() + 1));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };
  const placePreview = () => {
    const r = preview.getBoundingClientRect();
    void agent.setLayout({ mode: "window", x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  };
  onMount(() => {
    requestAnimationFrame(() => {
      placePreview();
      grid.focus({ preventScroll: true });
      if (!nowPlaying()?.info.live) {
        const id = liveChannelId() ?? allChannels()[0]?.id;
        if (id) void play({ kind: "channel", id }, { fullscreen: false });
      }
    });
    window.addEventListener("resize", placePreview);
  });
  onCleanup(() => {
    window.removeEventListener("resize", placePreview);
    if (nav.current().name !== "player") void stopPlayback();
  });

  const left = (ms: number) => ((ms - winStart()) / SPAN) * 100;
  const cellsOf = (c: Channel) => {
    const from = winStart();
    const to = from + SPAN;
    const list = programmesOf(c.id).filter((p) => p.end > from && p.start < to);
    return list.length ? list : null;
  };

  const step = (dir: -1 | 1) => {
    const c = channel();
    if (!c) return;
    const p = selected();
    const t = anchor();
    const target = dir === 1 ? (p ? p.end : floorSlot(t) + SLOT) : (p ? p.start : floorSlot(t)) - 1;
    // Back in time only as far as the channel's catch-up goes.
    const earliest = c.catchupDays > 0 ? Date.now() - c.catchupDays * 86_400_000 : floorSlot(Date.now());
    if (target < earliest) return;
    const prog = programmesOf(c.id).find((x) => x.start <= target && x.end > target);
    setAnchor(prog ? Math.max(prog.start, earliest) : target);
  };

  const activate = (p: Programme | undefined) => {
    const c = channel();
    if (!c) return;
    const t = Date.now();
    if (!p || (p.start <= t && p.end > t)) {
      void play({ kind: "channel", id: c.id });
      return;
    }
    void openProgramme(p).then((changed) => changed && refetch());
  };

  let digitTimer: number | undefined;
  const jumpTo = (n: number) => {
    const i = channels().findIndex((c) => c.number >= n);
    if (i >= 0) setRow(i);
  };

  useKeys((a) => {
    if (document.activeElement !== grid) {
      if (a === "back") {
        nav.back() || nav.reset({ name: "home" });
        return true;
      }
      return false;
    }
    const d = digitOf(a);
    if (d !== null) {
      const next = (digits() + d).slice(-3);
      setDigits(next);
      clearTimeout(digitTimer);
      digitTimer = window.setTimeout(() => {
        jumpTo(Number(next));
        setDigits("");
      }, next.length >= 3 ? 50 : 1500);
      return true;
    }
    switch (a) {
      case "up":
        if (row() === 0) return move("up"), true;
        setRow(row() - 1);
        return true;
      case "down":
        setRow(Math.min(channels().length - 1, row() + 1));
        return true;
      case "left":
        step(-1);
        return true;
      case "right":
        step(1);
        return true;
      case "channelUp":
        setRow(Math.max(0, row() - rows()));
        return true;
      case "channelDown":
        setRow(Math.min(channels().length - 1, row() + rows()));
        return true;
      case "ok":
      case "play":
        activate(selected());
        return true;
      case "info": {
        const p = selected();
        if (p) void openProgramme(p).then((changed) => changed && refetch());
        return true;
      }
      case "record":
      case "red": {
        const p = selected();
        if (p) void recordFlow(p).then((changed) => changed && refetch());
        return true;
      }
      case "green":
        setAnchor(Math.max(floorSlot(Date.now()), anchor() - 86_400_000));
        return true;
      case "yellow":
        setAnchor(anchor() + 86_400_000);
        return true;
      case "blue": {
        const i = CATEGORIES.findIndex((c) => c.id === category());
        setCategory(CATEGORIES[(i + 1) % CATEGORIES.length]!.id);
        setRow(0);
        setTop(0);
        return true;
      }
      case "back":
        // First Back returns to now; the next leaves the guide.
        if (Math.abs(anchor() - Date.now()) > SLOT) {
          setAnchor(Date.now());
          return true;
        }
        nav.back() || nav.reset({ name: "home" });
        return true;
      case "guide":
        setAnchor(Date.now());
        return true;
    }
    return false;
  });

  const slots = createMemo(() => [0, 1, 2, 3].map((i) => winStart() + i * SLOT));
  const nowLeft = createMemo(() => left(now()));

  return (
    <div class="screen guide" data-layer>
      <TopBar />
      <div class="guide-top">
        <div class="guide-preview" ref={preview}>
          <Show when={!nowPlaying()}>
            <div class="preview-empty">Live TV</div>
          </Show>
        </div>
        <div class="guide-info">
          <Show when={selected()} fallback={<h2 class="gi-title">{channel() ? "No programme information" : ""}</h2>}>
            {(p) => (
              <>
                <h2 class="gi-title">{p().title}</h2>
                <p class="gi-meta">
                  {[timeRange(p()), channel()?.name, episodeLabel(p().season, p().episode)].filter(Boolean).join(" · ")}
                  <Show when={p().isNew}>
                    <span class="flag flag-new">New</span>
                  </Show>
                  <Show when={markOf(p())}>
                    <span class="flag flag-rec">
                      <Icon name={markOf(p()) === "series" ? "series" : markOf(p()) === "reminder" ? "bell" : "record"} />
                      {markOf(p()) === "series" ? "Series linked" : markOf(p()) === "reminder" ? "Reminder set" : markOf(p()) === "recording" ? "Recording" : "Will record"}
                    </span>
                  </Show>
                </p>
                <Show when={p().subtitle}>
                  <p class="gi-subtitle">{p().subtitle}</p>
                </Show>
                <p class="gi-description">{p().description ?? ""}</p>
              </>
            )}
          </Show>
        </div>
      </div>

      <div class="guide-grid" tabindex="-1" data-focus data-autofocus ref={grid}>
        <div class="gg-header">
          <div class="gg-day">
            <span>{dayLabel(anchor())}</span>
            <span class="gg-category">{CATEGORIES.find((c) => c.id === category())?.label}</span>
          </div>
          <div class="gg-times">
            <For each={slots()}>
              {(s) => (
                <span class="gg-time" style={{ left: `${left(s)}%` }}>
                  {clockTime(s)}
                </span>
              )}
            </For>
            <Show when={nowLeft() >= 0 && nowLeft() <= 100}>
              <span class="gg-now-label" style={{ left: `${nowLeft()}%` }} />
            </Show>
          </div>
        </div>
        <div class="gg-rows" ref={fitRows}>
          <For each={visible()}>
            {(c) => {
              const isRow = () => channel()?.id === c.id;
              return (
                <div class="gg-row" classList={{ "gg-row-active": isRow() }}>
                  <div class="gg-channel">
                    <span class="gg-number">{c.number}</span>
                    <Show when={c.logo} fallback={<span class="gg-name">{c.name}</span>}>
                      <img class="gg-logo" src={c.logo} alt={c.name} />
                    </Show>
                  </div>
                  <div class="gg-line">
                    <Show when={cellsOf(c)} fallback={<div class="gg-cell gg-empty" classList={{ selected: isRow() }} style={{ left: "0%", width: "100%" }}><span>No information</span></div>}>
                      <For each={cellsOf(c)!}>
                        {(p) => {
                          const l = () => Math.max(0, left(p.start));
                          const w = () => Math.min(100, left(p.end)) - l();
                          const mark = () => markOf(p);
                          return (
                            <div
                              class="gg-cell"
                              classList={{ selected: isRow() && selected()?.id === p.id, past: p.end <= now(), "gg-on-now": p.start <= now() && p.end > now(), continues: p.start < winStart() }}
                              style={{ left: `${l()}%`, width: `calc(${w()}% - 0.25rem)` }}
                            >
                              <span class="gg-cell-title">{p.title}</span>
                              <Show when={mark()}>
                                <Icon name={mark() === "series" ? "series" : mark() === "reminder" ? "bell" : "record"} class={`gg-mark gg-mark-${mark()}`} />
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={nowLeft() >= 0 && nowLeft() <= 100}>
            <div class="gg-now" style={{ left: `calc(var(--gg-channel-w) + (100% - var(--gg-channel-w)) * ${nowLeft() / 100})` }} />
          </Show>
        </div>
        <Show when={digits()}>
          <div class="digits-overlay">{digits()}</div>
        </Show>
      </div>

      <footer class="legend">
        <span>
          <kbd class="key-red" /> Record
        </span>
        <span>
          <kbd class="key-green" /> −24 hours
        </span>
        <span>
          <kbd class="key-yellow" /> +24 hours
        </span>
        <span>
          <kbd class="key-blue" /> Categories
        </span>
        <span>
          <kbd>OK</kbd> Watch or details
        </span>
        <span>
          <kbd>0–9</kbd> Channel number
        </span>
      </footer>
    </div>
  );
}
