// Things that sit over every screen: the sleep timer's "still watching?" card, a laptop's screen
// while it's shared, the AirPlay hint while a phone mirrors, and a friendly note when the Hub spots
// something about to break.

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { Alert } from "@ultimatetv/shared";
import { hub } from "../api";
import { backToTv, castState, endShare, share } from "../cast";
import { onHubEvent } from "../events";
import { addOverlayKeys } from "../keys";
import { setSleep, sleep, sleepWarning, stillWatching } from "../sleep";
import { isKids } from "../store";
import { Icon } from "./Icon";

export function SleepWarning() {
  const [tick, setTick] = createSignal(Date.now());
  createEffect(() => {
    if (!sleepWarning()) return;
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    onCleanup(() => window.clearInterval(t));
    const off = addOverlayKeys((a) => {
      if (a === "ok") stillWatching();
      else if (a === "back") void setSleep({ off: true });
      else return false;
      return true;
    });
    onCleanup(off);
  });
  const left = () => Math.max(0, Math.ceil(((sleep().at ?? 0) - tick()) / 1000));
  return (
    <Show when={sleepWarning()}>
      <div class="sleep-warning" role="alert">
        <Icon name="moon" />
        <div>
          <h3>Still watching?</h3>
          <p>The TV turns off in {left() > 50 ? "a minute" : `${left()} seconds`}.</p>
          <p class="sleep-keys">
            <kbd>OK</kbd> 15 more minutes <kbd>Back</kbd> cancel the timer
          </p>
        </div>
      </div>
    </Show>
  );
}

/** A laptop's screen, full screen. Back stops it. */
export function ScreenShareLayer() {
  const [hint, setHint] = createSignal(true);
  createEffect(() => {
    const s = share();
    if (!s) return;
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 6000);
    const off = addOverlayKeys((a) => {
      if (a === "back") endShare(true);
      else if (a === "ok" || a === "info") setHint(true);
      else return false;
      return true;
    });
    onCleanup(() => {
      window.clearTimeout(t);
      off();
    });
  });
  return (
    <Show when={share()}>
      {(s) => (
        <div class="screen-share">
          <Show when={s().stream} fallback={<div class="screen-share-wait"><div class="spinner" /><p>Connecting to {s().name}…</p></div>}>
            {(stream) => <video autoplay playsinline ref={(v) => (v.srcObject = stream())} />}
          </Show>
          <div class="cast-hint" classList={{ hidden: !hint() }}>
            <Icon name="laptop" /> Showing {s().name}'s screen · <kbd>Back</kbd> stops
          </div>
        </div>
      )}
    </Show>
  );
}

/** While AirPlay mirrors, the app draws nothing (html.mirroring) but this hint, and Back ends it. */
export function MirroringLayer() {
  const [hint, setHint] = createSignal(true);
  const mirroring = () => castState().foreground?.kind === "airplay";
  createEffect(() => {
    if (!mirroring()) return;
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 6000);
    const off = addOverlayKeys((a) => {
      if (a === "back") void backToTv();
      else if (a === "ok" || a === "info") setHint(true);
      // Everything else belongs to nobody while a phone has the screen.
      return true;
    });
    onCleanup(() => {
      window.clearTimeout(t);
      off();
    });
  });
  return (
    <Show when={mirroring()}>
      <div class="mirroring-layer">
        <div class="cast-hint" classList={{ hidden: !hint() }}>
          <Icon name="cast" /> AirPlay · <kbd>Back</kbd> stops mirroring
        </div>
      </div>
    </Show>
  );
}

/** A heads-up when the Hub spots trouble coming (never on Kids, and only if Settings › Alerts says so). */
export function AlertCard() {
  const [alert, setAlert] = createSignal<Alert | null>(null);
  let timer: number | undefined;
  const off = onHubEvent((e) => {
    if (e.type !== "alerts.changed" || !e.alert || e.alert.level === "info" || isKids()) return;
    const a = e.alert;
    void hub.alerts().then((st) => {
      if (!st.settings.onTv) return;
      setAlert(a);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAlert(null), 15_000);
    }, () => undefined);
  });
  onCleanup(() => {
    off();
    window.clearTimeout(timer);
  });
  return (
    <Show when={alert()}>
      {(a) => (
        <div class="alert-card" classList={{ bad: a().level === "bad" }} role="status">
          <Icon name="bell" />
          <div>
            <h3>{a().title}</h3>
            <p>{a().message}</p>
          </div>
        </div>
      )}
    </Show>
  );
}
