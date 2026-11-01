// The TV guide, Sky-style: live TV keeps playing in the corner, details of the highlighted
// programme beside it, and a grid of channels against time. Left/right walk through programmes,
// up/down through channels, digits jump to a channel number, Record records. Above the grid, the
// channel lists: all channels, favourites, custom guides and categories (Blue steps through them).

import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { Channel, GuideChoice, GuideWindow, Programme, ProgrammeMark } from "@ultimatetv/shared";
import { clockTime, dayLabel, digitOf, episodeLabel } from "@ultimatetv/shared";
import { agent } from "../agent";
import { hub } from "../api";
import { Icon } from "../components/Icon";
import { openProgramme, recordFlow, timeRange } from "../components/ProgrammeCard";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { focus, move } from "../focus";
import { useHints } from "../hints";
import { featureOn } from "../features";
import { useKeys } from "../keys";
import { channels as allChannels, guideList, liveChannelId, nowPlaying, play, setGuideList, setListChannels, stopPlayback } from "../player";
import { errorToast, isKids, nav, now, profile, toast } from "../store";

const SLOT = 30 * 60_000;
const SPAN = 2 * 3_600_000; // Two hours across the grid, as on Sky.
/** Channel rows shown at most; fewer when the screen is too short for them all. */
const MAX_ROWS = 7;
const floorSlot = (ms: number) => Math.floor(ms / SLOT) * SLOT;

export function Guide() {
  const [lists, { refetch: refetchLists }] = createResource(() => hub.guides());
  const choices = (): GuideChoice[] => lists()?.choices ?? [{ id: "", label: "All channels", kind: "all", count: 0 }];
  // The list this profile last looked at in this session, else its saved default. Null until known,
  // so the grid doesn't load all channels first and then jump.
  const remembered = guideList();
  const [category, setCategoryRaw] = createSignal<string | null>(remembered && remembered.profileId === (profile()?.id ?? null) ? remembered.id : null);
  const setCategory = (id: string) => {
    setCategoryRaw(id);
    setGuideList({ profileId: profile()?.id ?? null, id });
  };
  createEffect(() => {
    const l = lists();
    if (!l) return;
    const c = category();
    // First visit, or the list shown has been deleted: open on the profile's default.
    if (c === null || !l.choices.some((x) => x.id === c)) setCategory(l.default);
  });
  const [winStart, setWinStart] = createSignal(floorSlot(Date.now()));
  const [anchor, setAnchor] = createSignal(Date.now());
  const [row, setRow] = createSignal(0);
  const [top, setTop] = createSignal(0);
  const [digits, setDigits] = createSignal("");
  const [rows, setRows] = createSignal(MAX_ROWS);
  const [loadRange, setLoadRange] = createSignal({ from: floorSlot(Date.now()) - 3 * 3_600_000, to: floorSlot(Date.now()) + 9 * 3_600_000 });
  const [guide, { refetch }] = createResource(
    () => {
      // If the lists can't load, fall back to all channels rather than an empty guide.
      const c = category() ?? (lists.error ? "" : null);
      return c === null ? false : { ...loadRange(), category: c };
    },
    (k) => hub.guide(k.from, k.to, k.category || undefined),
  );
  // Keep the last good window while a new one loads, so the grid never blanks.
  const [data, setData] = createSignal<GuideWindow | null>(null);
  createEffect(() => {
    const g = guide();
    if (g) setData(g);
  });
  onCleanup(
    onHubEvent((e) => {
      if (e.type === "recordings.changed" || e.type === "guide.updated") void refetch();
      if (e.type === "guide.updated" || e.type === "profiles.changed") void refetchLists();
    }),
  );

  // Music video channels leave the guide when they're switched off on this screen (features.ts).
  const channels = createMemo<Channel[]>(() => (data()?.channels ?? []).filter((c) => !c.mix || featureOn("mix")));
  createEffect(() => setListChannels(channels()));
  const currentChoice = () => choices().find((c) => c.id === category());
  const isDefault = () => (lists()?.default ?? "") === category();
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
    // A custom guide has its own order, so look for the exact number before the nearest one above.
    const exact = channels().findIndex((c) => c.number === n);
    const i = exact >= 0 ? exact : channels().findIndex((c) => c.number >= n);
    if (i >= 0) setRow(i);
  };

  const pickList = (id: string) => {
    if (id !== category()) {
      setCategory(id);
      setRow(0);
      setTop(0);
    }
    focus(grid);
  };
  const makeDefault = async () => {
    const c = currentChoice();
    if (!c) return;
    try {
      await hub.setDefaultGuide(c.id);
      await refetchLists();
      toast(`The guide will open on ${c.label} for ${profile()?.name ?? "this profile"}`, "good");
    } catch (err) {
      errorToast(err);
    }
  };

  useHints(() => [
    { key: "red", label: "Record" },
    { key: "green", label: "Day before" },
    { key: "yellow", label: "Next day" },
    { key: "blue", label: "Channel list" },
    { key: "info", label: "About the programme" },
  ]);
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
        const list = choices();
        const i = list.findIndex((c) => c.id === category());
        pickList(list[(i + 1) % list.length]!.id);
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

      <div class="guide-lists" data-focus-group data-scroll-x="40">
        <For each={choices()}>
          {(c) => (
            <button class="chip" classList={{ active: c.id === category(), "chip-custom": c.kind === "custom" }} data-focus onClick={() => pickList(c.id)}>
              <Show when={c.kind === "custom"}>
                <Icon name="list" />
              </Show>
              {c.label}
              <span class="gl-count">{c.count}</span>
              <Show when={(lists()?.default ?? "") === c.id}>
                <Icon name="star" class="gl-default" />
              </Show>
            </button>
          )}
        </For>
        <Show when={lists() && !isDefault()}>
          <button class="chip chip-action" data-focus onClick={() => void makeDefault()}>
            <Icon name="star" />
            Make default
          </button>
        </Show>
        <Show when={!isKids()}>
          <Show when={currentChoice()?.kind === "custom"}>
            <button class="chip chip-action" data-focus onClick={() => nav.push({ name: "guide-edit", id: category()! })}>
              <Icon name="edit" />
              Edit
            </button>
          </Show>
          <button class="chip chip-action" data-focus onClick={() => nav.push({ name: "guide-edit" })}>
            <Icon name="plus" />
            New guide
          </button>
        </Show>
      </div>

      <div class="guide-grid" tabindex="-1" data-focus data-autofocus ref={grid}>
        <div class="gg-header">
          <div class="gg-day">
            <span>{dayLabel(anchor())}</span>
            <span class="gg-category">{currentChoice()?.label ?? ""}</span>
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
                    <Show when={c.logo}>
                      <img class="gg-logo" src={c.logo} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
                    </Show>
                    <span class="gg-title">
                      <span class="gg-name">{c.name}</span>
                      <Show when={qualityLabel(c.maxHeight)}>
                        {(label) => <span class="gg-quality" classList={{ "gg-quality-4k": c.maxHeight >= 2160 }}>{label()}</span>}
                      </Show>
                    </span>
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
          <Show when={data() && !channels().length}>
            <p class="gg-none">No channels in {currentChoice()?.label ?? "this list"} yet.</p>
          </Show>
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
          <kbd class="key-blue" /> Next list
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

/**
 * The best quality a channel has, from its feeds' names ("FHD", "4K"). Untagged feeds aren't
 * labelled: the provider didn't say, and guessing SD would often be wrong.
 */
export function qualityLabel(maxHeight: number): string | undefined {
  if (maxHeight >= 2160) return "4K";
  if (maxHeight >= 1080) return "FHD";
  if (maxHeight >= 720) return "HD";
  return undefined;
}
