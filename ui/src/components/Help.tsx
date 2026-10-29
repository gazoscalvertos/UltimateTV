// Help on the TV: the colour buttons' jobs along the bottom of each screen, and a help screen
// (Info on screens that don't use it, the Help button, or Help on the phone) listing what every
// button does where you are, a few tips, and a QR code for using a phone when the remote's lost.

import { For, Show, type JSX } from "solid-js";
import { COLOUR_KEYS, currentHints, hasOwnLegend, keyHintsOn, type HintKey, type KeyHint } from "../hints";
import { idleMode } from "../idle";
import { pairStamp } from "../pairing";
import { isLive } from "../player";
import { leftLabel, chooseSleep, sleepEndsAt, sleepTimer, sleepWarning } from "../sleep";
import { dialogs, isKids, nav, now, openDialog, type Route } from "../store";
import { DialogFrame } from "./Dialog";
import { Icon } from "./Icon";

/** How a key looks in a hint: the colour buttons as dots, the rest as their label. */
export function KeyCap(props: { k: HintKey }): JSX.Element {
  const text: Partial<Record<HintKey, string>> = {
    ok: "OK",
    back: "Back",
    info: "Info",
    play: "▶❚❚",
    record: "●",
    guide: "Guide",
    updown: "▲▼",
    leftright: "◀▶",
    chupdown: "CH ±",
    digits: "0–9",
    rewff: "◀◀ ▶▶",
  };
  return (
    <Show when={!COLOUR_KEYS.includes(props.k)} fallback={<kbd class={`key-${props.k}`} />}>
      <kbd classList={{ "key-rec-cap": props.k === "record" }}>{text[props.k]}</kbd>
    </Show>
  );
}

const SCREEN_NAMES: Record<Route["name"], string> = {
  profiles: "Who's watching",
  home: "Home",
  guide: "TV Guide",
  "guide-edit": "Arranging a guide",
  player: "Watching",
  browse: "Films and TV",
  details: "A film or series",
  search: "Search",
  planner: "Recordings",
  music: "Music",
  "music-list": "Music",
  settings: "Settings",
  "mix-channel": "Music channel",
  downloads: "Downloaded",
};

function tips(route: Route): string[] {
  switch (route.name) {
    case "home":
      return ["Go up to the menu for the TV Guide, Films, TV Shows, Music and Recordings.", "Guide on the remote shows what's on from anywhere."];
    case "guide":
      return ["Red records a programme, or every episode with a series link.", "Green and yellow go back and forward 24 hours. Back returns to now.", "Blue changes the list: favourites, films, kids and your own guides."];
    case "player":
      return isLive()
        ? ["Type a channel number to go straight to it.", "Up and down show what's on other channels; OK switches to it.", "Yellow has subtitles, sound, night mode and the sleep timer."]
        : ["Left and right skip back 10 seconds and forward 30.", "Yellow has subtitles, sound, night mode and the sleep timer.", "Blue shows the picture and stream details."];
    case "details":
      return ["Yellow picks another version: 4K, a smaller file or another language.", "Green adds it to your queue, to play after what's on."];
    case "planner":
      return ["Blue moves between Recorded, Scheduled, Series links and Downloads.", "Recordings from catch-up arrive after the programme has finished."];
    case "settings":
      return ["Typing things in (logins, addresses) is easier on your phone: see Phones and remotes.", "Alerts lists anything that needs doing, like a subscription to renew."];
    case "guide-edit":
      return ["OK on the left adds a channel; on the right it picks one up to move.", "Red takes a channel out, blue filters the list, yellow adds them all."];
    default:
      return ["Back always takes you back a step, and Home goes to the home screen."];
  }
}

const ANYWHERE: KeyHint[] = [
  { key: "back", label: "Back a step" },
  { key: "guide", label: "The TV Guide" },
  { key: "chupdown", label: "Live TV, and changing channel" },
  { key: "info", label: "This help, where Info has no other job" },
];

/** Opens the help screen for the screen on top. */
export function openHelp(): void {
  const route = nav.current();
  const hints = currentHints();
  void openDialog((close) => (
    <DialogFrame close={() => close()} wide class="help-panel" onKey={(a) => (a === "help" || a === "info" ? (close(), true) : false)}>
      <h2>
        <Icon name="help" /> Help · {SCREEN_NAMES[route.name]}
      </h2>
      <div class="help-columns">
        <section>
          <h4>On this screen</h4>
          <Show when={hints.length} fallback={<p class="help-none">Arrows move, OK picks and Back goes back.</p>}>
            <ul class="help-keys">
              <For each={hints}>
                {(h) => (
                  <li>
                    <KeyCap k={h.key} />
                    <span>{h.label}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <h4>Anywhere</h4>
          <ul class="help-keys">
            <li>
              <kbd>Home</kbd>
              <span>The home screen</span>
            </li>
            <For each={ANYWHERE}>
              {(h) => (
                <li>
                  <KeyCap k={h.key} />
                  <span>{h.label}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
        <section>
          <h4>Tips</h4>
          <ul class="help-tips">
            <For each={tips(route)}>{(t) => <li>{t}</li>}</For>
          </ul>
          <Show when={!isKids()}>
            <div class="help-phone">
              <img src={`/api/remote/qr.svg?v=${pairStamp()}`} alt="" />
              <p>Lost the remote? Scan this with your phone to use it as one.</p>
            </div>
          </Show>
        </section>
      </div>
      <div class="dialog-options help-actions">
        <button class="btn btn-primary" data-focus data-autofocus onClick={() => close()}>
          Got it
        </button>
        <button class="btn" data-focus onClick={() => (close(), void chooseSleep())}>
          <Icon name="moon" /> Sleep timer{sleepTimer().mode !== "off" && sleepEndsAt() ? `: ${leftLabel(sleepEndsAt()! - now())}` : ""}
        </button>
      </div>
    </DialogFrame>
  ));
}

/** The colour buttons' jobs on this screen, along the bottom. */
export function KeyHintsBar() {
  const colours = () => currentHints().filter((h) => COLOUR_KEYS.includes(h.key));
  const helpOnInfo = () => !currentHints().some((h) => h.key === "info");
  const show = () => keyHintsOn() && !hasOwnLegend() && !sleepWarning() && idleMode() === "awake" && dialogs().length === 0 && !["player", "profiles"].includes(nav.current().name) && (colours().length > 0 || helpOnInfo());
  return (
    <Show when={show()}>
      <div class="key-hints">
        <For each={colours()}>
          {(h) => (
            <span>
              <KeyCap k={h.key} />
              {h.label}
            </span>
          )}
        </For>
        <Show when={helpOnInfo()}>
          <span class="key-hints-help">
            <kbd>Info</kbd>Help
          </span>
        </Show>
      </div>
    </Show>
  );
}
