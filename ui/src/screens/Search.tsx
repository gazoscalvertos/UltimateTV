// Search everything at once: channels, what's on TV this week, recordings, films and series.
// An on-screen keyboard for the remote; a real keyboard types straight in.

import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js";
import type { SearchResult } from "@ultimatetv/shared";
import { digitOf } from "@ultimatetv/shared";
import { hub } from "../api";
import { featureOn, titleShown } from "../features";
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
  const [results] = createResource(query, (q) => (q.length >= 2 ? hub.search(q).then((r) => r.results) : Promise.resolve([] as SearchResult[])));
  const groups = createMemo(() => {
    const r = results() ?? [];
    return [
      // Only what's switched on on this screen (features.ts).
      { title: "Channels", items: featureOn("live") ? r.filter((x) => x.kind === "channel" && (!x.channel?.mix || featureOn("mix"))) : [] },
      { title: "On TV", items: featureOn("live") ? r.filter((x) => x.kind === "on-now" || x.kind === "upcoming") : [] },
      { title: "Recordings", items: featureOn("recordings") ? r.filter((x) => x.kind === "recording") : [] },
      { title: "Films and TV", items: r.filter((x) => x.kind === "title" && (!x.title || titleShown(x.title))) },
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
          <Show when={query().length >= 2} fallback={<p class="empty">Search for a channel, a programme, a film or a series.</p>}>
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
                              <Poster title={r.title} />
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
