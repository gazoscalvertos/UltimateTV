// Builds a custom guide: every channel on the left, the guide's own channels on the right in the
// order it shows them. OK on the left adds or takes away a channel; on the right, OK picks a
// channel up so up/down moves it, and Red takes it out. Blue steps the left list through the
// categories, Yellow adds everything it shows, and digits jump to a channel number.

import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Channel, ChannelCategory } from "@ultimatetv/shared";
import { digitOf } from "@ultimatetv/shared";
import { hub } from "../api";
import { askText, confirm } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { focus, move } from "../focus";
import { useHints } from "../hints";
import { useKeys } from "../keys";
import { setGuideList } from "../player";
import { errorToast, nav, profile, toast } from "../store";

const FILTERS: { id: "" | ChannelCategory; label: string }[] = [
  { id: "", label: "All channels" },
  { id: "entertainment", label: "Entertainment" },
  { id: "films", label: "Films" },
  { id: "sport", label: "Sport" },
  { id: "news", label: "News" },
  { id: "documentaries", label: "Documentaries" },
  { id: "kids", label: "Kids" },
  { id: "music", label: "Music" },
  { id: "other", label: "Other" },
];
const ROW_REM = 3.6;

export function GuideEditor(props: { id?: string }) {
  const [all] = createResource(() => hub.channels().then((r) => r.channels));
  const [existing] = createResource(
    () => props.id ?? false,
    (id) => hub.guides().then((g) => g.custom.find((x) => x.id === id) ?? null),
  );
  const [name, setName] = createSignal("");
  const [picked, setPicked] = createSignal<string[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  createEffect(
    on(existing, (g) => {
      if (!g) return;
      setName(g.name);
      setPicked(g.channels);
    }),
  );

  const byId = createMemo(() => new Map((all() ?? []).map((c) => [c.id, c])));
  const pickedSet = createMemo(() => new Set(picked()));
  const mine = createMemo(() => picked().map((id) => byId().get(id)).filter((c): c is Channel => c !== undefined));

  // Only categories that have channels, so Blue never lands on an empty list.
  const filters = createMemo(() => FILTERS.filter((f) => !f.id || (all() ?? []).some((c) => c.category === f.id)));
  const [filter, setFilter] = createSignal<(typeof FILTERS)[number]>(FILTERS[0]!);
  const left = createMemo(() => (filter().id ? (all() ?? []).filter((c) => c.category === filter().id) : (all() ?? [])));

  const [pane, setPane] = createSignal<"left" | "right">("left");
  const [li, setLi] = createSignal(0);
  const [ri, setRi] = createSignal(0);
  const [moving, setMoving] = createSignal(false);
  const [rows, setRows] = createSignal(10);
  const [lTop, setLTop] = createSignal(0);
  const [rTop, setRTop] = createSignal(0);
  const keepInView = (i: number, top: () => number, setTop: (n: number) => void) => {
    if (i < top()) setTop(i);
    else if (i >= top() + rows()) setTop(i - rows() + 1);
  };
  createEffect(on([li, rows], ([i]) => keepInView(i, lTop, setLTop)));
  createEffect(on([ri, rows], ([i]) => keepInView(i, rTop, setRTop)));
  createEffect(on(left, (l) => li() >= l.length && setLi(Math.max(0, l.length - 1))));
  createEffect(on(mine, (m) => ri() >= m.length && setRi(Math.max(0, m.length - 1))));

  let leftEl!: HTMLDivElement;
  let rightEl!: HTMLDivElement;
  const fitRows = (el: HTMLDivElement) => {
    const fit = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const n = Math.floor(el.clientHeight / (ROW_REM * rem));
      if (n > 0) setRows(n);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  const change = (ids: string[]) => {
    setPicked(ids);
    setDirty(true);
  };
  const toggle = (c: Channel) => change(pickedSet().has(c.id) ? picked().filter((id) => id !== c.id) : [...picked(), c.id]);
  const shift = (delta: -1 | 1) => {
    const list = mine().map((c) => c.id);
    const i = ri();
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    change(list);
    setRi(j);
  };
  const removeAt = (i: number) => {
    const c = mine()[i];
    if (!c) return;
    change(picked().filter((id) => id !== c.id));
    setMoving(false);
  };

  const save = async () => {
    if (busy()) return;
    if (!picked().length) {
      toast("Add some channels first", "bad");
      return;
    }
    setBusy(true);
    try {
      const body = { ...(name().trim() ? { name: name().trim() } : {}), channels: mine().map((c) => c.id) };
      const g = props.id ? await hub.updateGuide(props.id, body) : await hub.createGuide(body);
      setGuideList({ profileId: profile()?.id ?? null, id: g.id });
      toast(`${g.name} saved`, "good");
      setDirty(false);
      nav.back() || nav.reset({ name: "guide" });
    } catch (err) {
      errorToast(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!props.id || !(await confirm(`Delete ${name() || "this guide"}?`, "The channels stay; only this guide goes.", "Delete", true))) return;
    try {
      await hub.deleteGuide(props.id);
      setGuideList({ profileId: profile()?.id ?? null, id: "" });
      nav.back() || nav.reset({ name: "guide" });
    } catch (err) {
      errorToast(err);
    }
  };
  const leave = async () => {
    if (dirty() && !(await confirm("Leave without saving?", "Your changes to this guide will be lost.", "Leave", true))) return;
    nav.back() || nav.reset({ name: "guide" });
  };
  const rename = async () => {
    const t = await askText("Name this guide", name());
    if (t) {
      setName(t);
      setDirty(true);
    }
  };

  let digits = "";
  let digitTimer: number | undefined;

  useHints(() => [
    { key: "ok", label: "Add or remove" },
    { key: "red", label: "Remove" },
    { key: "yellow", label: "Add all shown" },
    { key: "blue", label: "Filter" },
  ]);
  useKeys((a) => {
    const el = document.activeElement;
    const inLeft = el === leftEl;
    const inRight = el === rightEl;
    if (!inLeft && !inRight) {
      if (a === "back") return void leave(), true;
      return false;
    }
    const d = digitOf(a);
    if (d !== null && inLeft) {
      digits = (digits + d).slice(-4);
      clearTimeout(digitTimer);
      digitTimer = window.setTimeout(() => {
        const n = Number(digits);
        const list = left();
        const exact = list.findIndex((c) => c.number === n);
        const i = exact >= 0 ? exact : list.findIndex((c) => c.number >= n);
        if (i >= 0) setLi(i);
        digits = "";
      }, 1200);
      return true;
    }
    const len = inLeft ? left().length : mine().length;
    const idx = inLeft ? li : ri;
    const setIdx = inLeft ? setLi : setRi;
    switch (a) {
      case "up":
        if (inRight && moving()) return shift(-1), true;
        if (idx() === 0) return move("up"), true;
        setIdx(idx() - 1);
        return true;
      case "down":
        if (inRight && moving()) return shift(1), true;
        setIdx(Math.min(len - 1, idx() + 1));
        return true;
      case "channelUp":
        setIdx(Math.max(0, idx() - rows()));
        return true;
      case "channelDown":
        setIdx(Math.max(0, Math.min(len - 1, idx() + rows())));
        return true;
      case "right":
        if (inLeft) {
          setPane("right");
          focus(rightEl);
        }
        return true;
      case "left":
        if (inRight && !moving()) {
          setPane("left");
          focus(leftEl);
        }
        return true;
      case "ok": {
        if (inLeft) {
          const c = left()[li()];
          if (c) toggle(c);
        } else if (mine().length) setMoving(!moving());
        return true;
      }
      case "red":
        if (inRight) removeAt(ri());
        return true;
      case "blue":
        if (inLeft) {
          const list = filters();
          const i = list.findIndex((f) => f.id === filter().id);
          setFilter(list[(i + 1) % list.length]!);
          setLi(0);
          setLTop(0);
        }
        return true;
      case "yellow":
        if (inLeft) change([...picked(), ...left().filter((c) => !pickedSet().has(c.id)).map((c) => c.id)]);
        return true;
      case "back":
        if (moving()) setMoving(false);
        else void leave();
        return true;
    }
    return false;
  });

  const Row = (p: { c: Channel; on: boolean; selected: boolean; position?: number }) => (
    <div class="ge-row" classList={{ selected: p.selected, "ge-moving": p.selected && moving() && p.position !== undefined }}>
      <span class="ge-pos">{p.position ?? ""}</span>
      <span class="ge-number">{p.c.number}</span>
      <Show when={p.c.logo}>
        <img class="ge-logo" src={p.c.logo} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
      </Show>
      <span class="ge-name">{p.c.name}</span>
      <Show when={p.position === undefined && p.on}>
        <Icon name="check" class="ge-check" />
      </Show>
      <Show when={p.selected && moving() && p.position !== undefined}>
        <Icon name="move" class="ge-check" />
      </Show>
    </div>
  );

  return (
    <div class="screen guide-editor" data-layer>
      <header class="ge-header" data-focus-group>
        <div class="ge-title">
          <span class="ge-kicker">{props.id ? "Edit guide" : "New guide"}</span>
          <h1>{name() || "My guide"}</h1>
        </div>
        <button class="btn" data-focus onClick={() => void rename()}>
          <Icon name="edit" />
          Rename
        </button>
        <button class="btn btn-primary" data-focus disabled={busy()} onClick={() => void save()}>
          <Icon name="check" />
          Save
        </button>
        <Show when={props.id}>
          <button class="btn btn-danger" data-focus onClick={() => void remove()}>
            <Icon name="trash" />
            Delete
          </button>
        </Show>
        <button class="btn" data-focus onClick={() => void leave()}>
          Cancel
        </button>
      </header>

      <div class="ge-panes">
        <section class="ge-pane" classList={{ active: pane() === "left" }}>
          <h2>
            {filter().label}
            <span class="ge-sub">{left().length} channels · OK adds or removes</span>
          </h2>
          <div class="ge-list" tabindex="-1" data-focus data-autofocus ref={leftEl} onFocus={() => setPane("left")}>
            <div class="ge-rows" ref={fitRows}>
              <Show when={!all.loading} fallback={<div class="spinner" />}>
                <For each={left().slice(lTop(), lTop() + rows())}>{(c, i) => <Row c={c} on={pickedSet().has(c.id)} selected={pane() === "left" && lTop() + i() === li()} />}</For>
              </Show>
            </div>
          </div>
        </section>
        <section class="ge-pane" classList={{ active: pane() === "right" }}>
          <h2>
            In this guide
            <span class="ge-sub">{mine().length} channels · {moving() ? "up and down move it, OK puts it down" : "OK picks one up to move it"}</span>
          </h2>
          <div class="ge-list" tabindex="-1" data-focus ref={rightEl} onFocus={() => setPane("right")}>
            <div class="ge-rows">
              <Show when={mine().length} fallback={<p class="ge-empty">Pick channels on the left. They appear here in the order the guide will show them.</p>}>
                <For each={mine().slice(rTop(), rTop() + rows())}>{(c, i) => <Row c={c} on position={rTop() + i() + 1} selected={pane() === "right" && rTop() + i() === ri()} />}</For>
              </Show>
            </div>
          </div>
        </section>
      </div>

      <footer class="legend">
        <span>
          <kbd>OK</kbd> Add or move
        </span>
        <span>
          <kbd class="key-red" /> Take out
        </span>
        <span>
          <kbd class="key-yellow" /> Add all shown
        </span>
        <span>
          <kbd class="key-blue" /> Category
        </span>
        <span>
          <kbd>0–9</kbd> Channel number
        </span>
      </footer>
    </div>
  );
}
