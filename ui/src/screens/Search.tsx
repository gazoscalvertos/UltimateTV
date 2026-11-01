// Search everything at once: channels, what's on TV this week, recordings, films and series.
// An on-screen keyboard for the remote; a real keyboard types straight in. Recent searches (kept
// per profile on the Hub) show before anything is typed and as suggestions while typing, since
// typing with a remote is slow; OK on one runs it.

import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { RecentSearch, SearchResult } from "@ultimatetv/shared";
import { digitOf, matchSearches } from "@ultimatetv/shared";
import { hub } from "../api";
import { onHubEvent } from "../events";
import { focus, focusFirst } from "../focus";
import { Icon } from "../components/Icon";
import { openProgramme, timeRange } from "../components/ProgrammeCard";
import { Poster } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { useKeys } from "../keys";
import { play } from "../player";
import { remoteText } from "../remote";
import { nav } from "../store";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890".split("");

export function Search() {
  const [text, setText] = createSignal("");
  const [query, setQuery] = createSignal("");
  let timer: number | undefined;
  const update = (t: string) => {
    setText(t);
    clearTimeout(timer);
    timer = window.setTimeout(() => setQuery(t.trim()), 350);
  };
  /** Runs a search straight away (a recent one picked), without waiting for more typing. */
  const runNow = (t: string) => {
    clearTimeout(timer);
    setText(t);
    setQuery(t.trim());
  };
  const [recent, setRecent] = createSignal<RecentSearch[]>([]);
  const loadRecent = () => hub.recentSearches().then((r) => setRecent(r.searches), () => undefined);
  void loadRecent();
  // Cleared or added on the phone remote or another screen on the same profile.
  onCleanup(onHubEvent((e) => (e.type === "search.history.changed" ? void loadRecent() : undefined)));
  const keep = (p: Promise<{ searches: RecentSearch[] }>) => void p.then((r) => setRecent(r.searches), () => undefined);
  /** A search counts once one of its results is opened. */
  const remember = () => {
    if (query().length >= 2) keep(hub.rememberSearch(query()));
  };
  const suggestions = createMemo(() => matchSearches(recent(), text(), text().trim() ? 3 : 8));
  let recentList: HTMLDivElement | undefined;
  /** Clear on one entry: focus moves to the next one's Clear (or the keyboard when none is left). */
  const forget = (q: string, index: number) =>
    void hub.forgetSearch(q).then(
      (r) => {
        setRecent(r.searches);
        requestAnimationFrame(() => {
          const left = recentList?.querySelectorAll<HTMLElement>(".recent-clear") ?? [];
          if (!focus(left[Math.min(index, left.length - 1)])) focusFirst();
        });
      },
      () => undefined,
    );
  const clearAll = () =>
    void hub.clearSearches().then(
      (r) => {
        setRecent(r.searches);
        requestAnimationFrame(() => focusFirst());
      },
      () => undefined,
    );

  const [results] = createResource(query, (q) => (q.length >= 2 ? hub.search(q).then((r) => r.results) : Promise.resolve([] as SearchResult[])));
  const groups = createMemo(() => {
    const r = results() ?? [];
    return [
      { title: "Channels", items: r.filter((x) => x.kind === "channel") },
      { title: "On TV", items: r.filter((x) => x.kind === "on-now" || x.kind === "upcoming") },
      { title: "Recordings", items: r.filter((x) => x.kind === "recording") },
      { title: "Films and TV", items: r.filter((x) => x.kind === "title") },
    ].filter((g) => g.items.length);
  });

  // Typed on the phone remote.
  createEffect(on(remoteText, (t) => t && update(t.text), { defer: false }));

  useKeys((a) => {
    const d = digitOf(a);
    if (d !== null) {
      update(text() + d);
      return true;
    }
    return false;
  });

  const open = (r: SearchResult) => {
    remember();
    switch (r.kind) {
      case "channel":
        void play({ kind: "channel", id: r.id });
        break;
      case "on-now":
      case "upcoming":
        if (r.programme) void openProgramme(r.programme);
        break;
      case "recording":
        void play({ kind: "recording", id: r.id });
        break;
      case "title":
        nav.push({ name: "details", id: r.id });
        break;
    }
  };

  return (
    <div class="screen search" data-layer>
      <TopBar />
      <div class="search-layout">
        <div class="search-left">
          <div class="search-box">
            <Icon name="search" />
            <input
              value={text()}
              placeholder="Search"
              data-focus
              onInput={(e) => update(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              }}
            />
          </div>
          <div class="keyboard" data-focus-group>
            <For each={LETTERS}>
              {(l, i) => (
                <button class="key" data-focus data-autofocus={i() === 0 ? "" : undefined} onClick={() => update(text() + l.toLowerCase())}>
                  {l}
                </button>
              )}
            </For>
            <button class="key key-wide" data-focus onClick={() => update(text() + " ")}>
              Space
            </button>
            <button class="key key-wide" data-focus onClick={() => update(text().slice(0, -1))}>
              Delete
            </button>
            <button class="key key-wide" data-focus onClick={() => update("")}>
              Clear
            </button>
          </div>
        </div>
        <div class="search-results page" data-scroll-y="40">
          <Show when={suggestions().length}>
            <section class="recent-searches">
              <div class="recent-head">
                <h3 class="rail-title">{text().trim() ? "Searched before" : "Recent searches"}</h3>
                <Show when={!text().trim()}>
                  <button class="btn recent-clear-all" data-focus onClick={clearAll}>
                    <Icon name="trash" /> Clear all
                  </button>
                </Show>
              </div>
              <div class="recent-list" data-focus-group ref={recentList}>
                <For each={suggestions()}>
                  {(s, i) => (
                    <div class="recent-item" data-row>
                      <button class="recent-q" data-focus onClick={() => runNow(s.q)}>
                        <Icon name="search" />
                        <span>{s.q}</span>
                      </button>
                      <button class="recent-clear" data-focus aria-label={`Clear ${s.q}`} onClick={() => forget(s.q, i())}>
                        Clear
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>
          <Show when={query().length >= 2} fallback={<Show when={!recent().length}><p class="empty">Search for a channel, a programme, a film or a series.</p></Show>}>
            <Show when={!results.loading || results()} fallback={<div class="spinner" />}>
              <Show when={groups().length} fallback={<p class="empty">Nothing found for “{query()}”.</p>}>
                <For each={groups()}>
                  {(g) => (
                    <section class="rail" data-row>
                      <h3 class="rail-title">{g.title}</h3>
                      <div class="rail-track" data-scroll-x="40" data-focus-group>
                        <For each={g.items}>
                          {(r) =>
                            r.kind === "title" && r.title ? (
                              <Poster
                                title={r.title}
                                onSelect={() => {
                                  remember();
                                  nav.push({ name: "details", id: r.title!.id });
                                }}
                              />
                            ) : (
                              <button class="result" data-focus onClick={() => open(r)}>
                                <Show when={r.image ?? r.programme?.image ?? r.recording?.programme.image ?? r.channel?.logo} fallback={<div class="result-art card-fallback">{r.name}</div>}>
                                  <img class="result-art" src={r.image ?? r.programme?.image ?? r.recording?.programme.image ?? r.channel?.logo} alt="" />
                                </Show>
                                <span class="result-title">{r.name}</span>
                                <span class="result-sub">{r.programme ? `${timeRange(r.programme)} · ${r.channel?.name ?? ""}` : r.subtitle}</span>
                              </button>
                            )
                          }
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
