// Cast and games: how to put a phone, tablet or laptop on the TV, and the games the box can open.
// Blue on Home comes here. Everything that needs typing (the laptop's address) is a QR code.

import { For, onCleanup, onMount, Show } from "solid-js";
import type { GameApp } from "@ultimatetv/shared";
import { backToTv, canCast, castSettings, castState, gamesAllowed, openGame, refreshCast, setAirplay, shareUrl } from "../cast";
import { choose } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { useHints } from "../hints";
import { useKeys } from "../keys";
import { appName, errorToast, isKids, toast } from "../store";

export function CastScreen() {
  onMount(() => void refreshCast());
  // Something installed by hand (a Flatpak, say) shows up without leaving the screen.
  const timer = window.setInterval(() => void refreshCast(), 15_000);
  onCleanup(() => window.clearInterval(timer));

  useHints(() => [
    { key: "ok", label: "Open" },
    ...(canCast() && !isKids() ? [{ key: "yellow" as const, label: castState().airplay.enabled ? "Turn AirPlay off" : "Turn AirPlay on" }] : []),
  ]);
  useKeys((a) => {
    if (a !== "yellow" || !canCast() || isKids()) return false;
    void toggleAirplay();
    return true;
  });

  const toggleAirplay = async () => {
    try {
      const s = await setAirplay(!castState().airplay.enabled);
      toast(s.airplay.enabled ? `AirPlay on: look for “${s.airplay.name}”` : "AirPlay off", "good");
    } catch (err) {
      errorToast(err);
    }
  };

  const open = async (g: GameApp) => {
    if (!g.installed) {
      await choose({ title: `${g.name} isn't on the box yet`, message: `${g.detail}. ${g.howTo}.`, options: [{ label: "OK", value: "ok" }] });
      return;
    }
    if (g.controller) toast(`${g.name} works best with a game controller`);
    try {
      await openGame(g.id);
    } catch (err) {
      errorToast(err);
    }
  };

  const air = () => castState().airplay;
  const shown = () => !isKids();

  return (
    <div class="screen cast-screen" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="120">
        <h1 class="page-title">Cast and games</h1>
        <Show when={castState().foreground}>
          {(fg) => (
            <section class="cast-now" data-row data-focus-group>
              <Icon name={fg().kind === "app" ? "gamepad" : "cast"} />
              <span>{fg().kind === "app" ? `${fg().name} is open` : "A screen is being mirrored over AirPlay"}</span>
              <button class="btn btn-primary" data-focus data-autofocus onClick={() => void backToTv().catch(errorToast)}>
                Back to the TV app
              </button>
            </section>
          )}
        </Show>

        <Show when={shown()}>
          <h2 class="rail-title">Show another screen</h2>
          <section class="cast-cards" data-row data-focus-group>
            <button class="cast-card" data-focus data-autofocus={castState().foreground ? undefined : ""} onClick={() => canCast() && air().installed && void toggleAirplay()}>
              <Icon name="phone" />
              <h3>iPhone, iPad or Mac</h3>
              <Show
                when={canCast() && air().installed}
                fallback={<p>AirPlay runs on the TV box. {canCast() ? "Run the box installer again to add it." : ""}</p>}
              >
                <p>
                  Open Control Centre, choose <b>Screen Mirroring</b> and pick <b>“{air().name || appName()}”</b>. In a video app, the AirPlay button sends just the video.
                </p>
                <span class="cast-status" classList={{ ok: air().enabled && air().running }}>
                  {air().connected ? "Connected now" : !air().enabled ? "Off: OK turns it on" : air().running ? "Ready" : air().error ?? "Starting…"}
                </span>
              </Show>
            </button>
            <div class="cast-card" data-focus tabindex="0">
              <Icon name="laptop" />
              <h3>Laptop or PC</h3>
              <Show when={castSettings().screenShare && shareUrl()} fallback={<p>Screen sharing from a laptop is turned off (Settings › Cast and games), or the Hub isn't serving it.</p>}>
                <p>
                  In Chrome or Edge on the laptop, go to <b>{shareUrl()}</b> and choose <b>Share my screen</b>. The TV asks before it shows anything.
                </p>
                <img class="cast-qr" src={`/api/qr.svg?text=${encodeURIComponent(shareUrl()!)}`} alt="" />
              </Show>
            </div>
            <div class="cast-card" data-focus tabindex="0">
              <Icon name="cast" />
              <h3>Android phone</h3>
              <p>
                In the {appName()} phone remote, open <b>Cast</b> to send a YouTube link, a video or your photos to the TV. Sharing a link to the remote from any app works too.
              </p>
            </div>
          </section>
        </Show>

        <h2 class="rail-title">Games</h2>
        <Show when={gamesAllowed()} fallback={<p class="hint">Games are turned off on the Kids profile. A grown-up can turn them on in Settings › Cast and games.</p>}>
          <Show when={canCast()} fallback={<p class="hint">Games open on the TV box, not in a browser.</p>}>
            <section class="game-grid" data-row data-focus-group>
              <For each={castState().apps}>
                {(g) => (
                  <button class="game-tile" classList={{ missing: !g.installed }} data-focus onClick={() => void open(g)}>
                    <span class={`game-art game-${g.id}`}>
                      <Icon name="gamepad" />
                    </span>
                    <h3>{g.name}</h3>
                    <p>{g.installed ? g.detail : `Not installed. ${g.howTo}`}</p>
                  </button>
                )}
              </For>
            </section>
          </Show>
          <p class="hint cast-tip">
            Controllers: an Xbox, PlayStation or 8BitDo pad pairs with the box over Bluetooth once (hold its pairing button; see docs/casting-and-games.md). When you close a game, or press the Back to the TV app button on the phone remote, the TV app comes back.
          </p>
        </Show>
      </div>
    </div>
  );
}
