// Pop-ups sent to the TV through the Hub's /api/notify: a doorbell showing who's at the door, a
// meeting reminder, an alarm. Each is any mix of a title, text, a picture and a video, placed where
// the sender asked, over whatever is on. Ones in the middle (and alarms) close with OK or Back;
// small ones in a corner leave the remote alone and go by themselves.

import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { NoticeKind, NoticePosition, NoticeSound, TvNotice } from "@ultimatetv/shared";
import { agent } from "../agent";
import { api } from "../api";
import { onHubEvent } from "../events";
import { addOverlayKeys } from "../keys";
import { playerState } from "../player";

const ICONS: Record<NoticeKind, () => JSX.Element> = {
  info: () => <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01" />,
  doorbell: () => <path d="M4 11.5 12 4l8 7.5M6.5 9.5V20h11V9.5M10 20v-5.5h4V20" />,
  meeting: () => <path d="M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4M8.5 14h3" />,
  alarm: () => <path d="M12 20.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 9v4l2.5 2M4 6l3-2.5M20 6l-3-2.5" />,
  warning: () => <path d="M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01" />,
};
const LABELS: Record<NoticeKind, string> = { info: "Message", doorbell: "Doorbell", meeting: "Meeting", alarm: "Alarm", warning: "Warning" };
const POSITIONS: NoticePosition[] = ["top-left", "top", "top-right", "center", "bottom-left", "bottom", "bottom-right", "full"];

/** Ones that take OK and Back until closed, because they cover what's on or must be seen. */
const blocking = (n: TvNotice) => n.position === "center" || n.position === "full" || n.kind === "alarm" || n.until === null;

// Sounds are made rather than shipped: the TV's speakers are all there is, so they're kept short.
let audio: AudioContext | null = null;
function tone(at: number, freq: number, length: number, type: OscillatorType, volume: number) {
  const ctx = audio!;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}
function playSound(sound: NoticeSound) {
  if (sound === "none") return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const t = audio.currentTime + 0.05;
    if (sound === "ping") tone(t, 880, 0.5, "sine", 0.25);
    if (sound === "chime") {
      // Ding-dong, with a little of the octave above for a bell's ring.
      for (const [start, f] of [[0, 659.3], [0.55, 523.3]] as const) {
        tone(t + start, f, 1.4, "sine", 0.3);
        tone(t + start, f * 2, 0.6, "sine", 0.06);
      }
    }
    if (sound === "alarm") for (let i = 0; i < 4; i++) tone(t + i * 0.16, 1050, 0.11, "square", 0.12);
  } catch {
    // No sound device: the picture still shows.
  }
}

export function Notices() {
  const [list, setList] = createSignal<TvNotice[]>([]);
  const timers = new Map<string, number>();
  let alarmTimer: number | undefined;
  /** Notices that paused playback, so it carries on once the last of them goes. */
  const pausedBy = new Set<string>();
  let resumeAfter = false;

  const updateAlarm = () => {
    const ringing = list().some((n) => n.sound === "alarm");
    if (ringing && alarmTimer === undefined) alarmTimer = window.setInterval(() => playSound("alarm"), 1400);
    if (!ringing && alarmTimer !== undefined) {
      window.clearInterval(alarmTimer);
      alarmTimer = undefined;
    }
  };
  const drop = (id?: string) => {
    for (const [key, t] of timers) {
      if (id === undefined || key === id) {
        window.clearTimeout(t);
        timers.delete(key);
      }
    }
    setList((l) => (id === undefined ? [] : l.filter((n) => n.id !== id)));
    if (id === undefined) pausedBy.clear();
    else pausedBy.delete(id);
    if (pausedBy.size === 0 && resumeAfter) {
      resumeAfter = false;
      void agent.pause(false).catch(() => undefined);
    }
    updateAlarm();
  };

  const add = (n: TvNotice, fresh: boolean) => {
    // Timed by what the Hub says is left, not by `until`: the box's clock may not match the Hub's.
    if (n.leftMs !== null && n.leftMs <= 0) return;
    window.clearTimeout(timers.get(n.id));
    if (n.leftMs !== null) timers.set(n.id, window.setTimeout(() => drop(n.id), n.leftMs));
    setList((l) => [...l.filter((x) => x.id !== n.id), n]);
    if (!fresh) return updateAlarm();
    if (n.wake) void agent.wakeTv().catch(() => undefined);
    if (n.pause) {
      pausedBy.add(n.id);
      if (playerState().status === "playing") {
        resumeAfter = true;
        void agent.pause(true).catch(() => undefined);
      }
    }
    playSound(n.sound);
    updateAlarm();
  };
  /** Closed on the TV: tell the Hub, so the phone's list and a reconnecting TV agree. */
  const dismiss = (id: string) => {
    drop(id);
    void api(`/api/notify/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  };
  const load = () =>
    void api<{ notices: TvNotice[] }>("/api/notify").then(
      (r) => {
        const ids = new Set(r.notices.map((n) => n.id));
        for (const n of list()) if (!ids.has(n.id)) drop(n.id);
        for (const n of r.notices) add(n, false);
      },
      () => undefined,
    );

  onMount(load);
  const off = onHubEvent((e) => {
    if (e.type === "notice") add(e.notice, true);
    if (e.type === "notice.clear") drop(e.id);
    if (e.type === "hello") load();
  });
  const offKeys = addOverlayKeys((action) => {
    const top = [...list()].reverse().find(blocking);
    if (!top || (action !== "ok" && action !== "back")) return false;
    dismiss(top.id);
    return true;
  });
  onCleanup(() => {
    off();
    offKeys();
    for (const t of timers.values()) window.clearTimeout(t);
    window.clearInterval(alarmTimer);
  });

  return (
    <For each={POSITIONS}>
      {(pos) => (
        <Show when={list().some((n) => n.position === pos)}>
          <div class={`notices notices-${pos}`}>
            <For each={list().filter((n) => n.position === pos)}>{(n) => <NoticeCard notice={n} />}</For>
          </div>
        </Show>
      )}
    </For>
  );
}

function NoticeCard(props: { notice: TvNotice }) {
  const n = () => props.notice;
  const words = () => Boolean(n().title || n().text);
  return (
    <div class={`notice notice-${n().kind} notice-${n().size}`} classList={{ "notice-media-only": !words() }} role="alert">
      <Show when={n().video} fallback={<Show when={n().image}>{(src) => <img class="notice-media" src={src()} alt="" />}</Show>}>
        {(src) => <video class="notice-media" src={src()} autoplay loop playsinline muted={n().muted} poster={n().image} />}
      </Show>
      <Show when={words() || blocking(n())}>
        <div class="notice-body">
          <div class="notice-head">
            <svg class="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              {ICONS[n().kind]()}
            </svg>
            <span class="notice-kind">{LABELS[n().kind]}</span>
            <Show when={blocking(n())}>
              <span class="notice-hint">
                <kbd>OK</kbd> to close
              </span>
            </Show>
          </div>
          <Show when={n().title}>
            <div class="notice-title">{n().title}</div>
          </Show>
          <Show when={n().text}>
            <div class="notice-text">{n().text}</div>
          </Show>
        </div>
      </Show>
      <Show when={n().leftMs}>{(ms) => <div class="notice-timer" style={{ "animation-duration": `${ms()}ms` }} />}</Show>
    </div>
  );
}
