// The menu along the top of every main screen, with the clock and who's watching.

import { For, Show } from "solid-js";
import { clockTime } from "@ultimatetv/shared";
import { appName, isKids, nav, now, profile, type Route } from "../store";
import { Icon } from "./Icon";

type Tab = { label: string; route: Route; match: Route["name"]; adults?: boolean };

const TABS: Tab[] = [
  { label: "Home", route: { name: "home" }, match: "home" },
  { label: "TV Guide", route: { name: "guide" }, match: "guide" },
  { label: "Films", route: { name: "browse", kind: "movie" }, match: "browse" },
  { label: "TV Shows", route: { name: "browse", kind: "series" }, match: "browse" },
  // Kids don't get the grown-ups' Spotify account (or its explicit songs).
  { label: "Music", route: { name: "music" }, match: "music", adults: true },
  { label: "Recordings", route: { name: "planner" }, match: "planner" },
];

function isActive(t: Tab): boolean {
  const cur = nav.current();
  if (t.match !== cur.name) return false;
  return cur.name !== "browse" || (t.route.name === "browse" && t.route.kind === cur.kind);
}

export function TopBar() {
  return (
    <header class="topbar" data-focus-group data-focus-only="up">
      <div class="brand">
        <span class="brand-mark">{appName().slice(0, 1).toUpperCase()}</span>
        <span class="brand-name">{appName()}</span>
      </div>
      <nav class="tabs">
        <For each={TABS.filter((t) => !(t.adults && isKids()))}>
          {(t) => (
            <button class="tab" classList={{ active: isActive(t) }} data-focus data-tab onClick={() => !isActive(t) && nav.replace(t.route)}>
              {t.label}
            </button>
          )}
        </For>
        <button class="tab tab-icon" classList={{ active: nav.current().name === "search" }} data-focus aria-label="Search" onClick={() => nav.current().name !== "search" && nav.replace({ name: "search" })}>
          <Icon name="search" />
        </button>
        <Show when={!isKids()}>
          <button class="tab" classList={{ active: nav.current().name === "settings" }} data-focus onClick={() => nav.current().name !== "settings" && nav.replace({ name: "settings" })}>
            Settings
          </button>
        </Show>
      </nav>
      <div class="topbar-right">
        <span class="clock">{clockTime(now())}</span>
        <Show when={profile()}>
          {(p) => (
            <button class="avatar avatar-small" style={{ "--c": p().colour }} data-focus aria-label={`Switch profile (${p().name})`} onClick={() => nav.reset({ name: "profiles" })}>
              {p().name.slice(0, 1)}
            </button>
          )}
        </Show>
      </div>
    </header>
  );
}
