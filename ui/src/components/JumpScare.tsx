// Jump scares: a short clip cut in full screen over whatever is on, then gone. The Hub keeps the
// settings and the clips (see hub/src/scares.ts); the TV decides when a random one lands, because
// only it knows what's playing. The phone's Scares sheet can also set one off at once.
//
// Never on a Kids profile, and never while the app is in the background.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { DEFAULT_SCARE_SETTINGS, type Scare, type ScareSettings, type ScareClip } from "@ultimatetv/shared";
import { hub } from "../api";
import { onHubEvent } from "../events";
import { addOverlayKeys } from "../keys";
import { isLive, playerState } from "../player";
import { isKids } from "../store";

/** How often the TV asks itself whether it's time for a scare. */
const TICK_MS = 60_000;

// A screech for a scare with no clip, or one that's only a picture: a scream of noise and a
// falling tone, made rather than shipped.
let audio: AudioContext | null = null;
function screech(volume: number): void {
  if (volume <= 0) return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const ctx = audio;
    const at = ctx.currentTime + 0.02;
    // Noise, like a violin stab.
    const frames = Math.floor(ctx.sampleRate * 1.1);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2200;
    band.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5 * volume, at);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    noise.connect(band).connect(noiseGain).connect(ctx.destination);
    noise.start(at);
    // And a tone sliding down under it.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(900, at);
    osc.frequency.exponentialRampToValueAtTime(70, at + 1);
    gain.gain.setValueAtTime(0.3 * volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 1.1);
  } catch {
    // No sound device: the picture does the work.
  }
}

export function JumpScare() {
  const [settings, setSettings] = createSignal<ScareSettings>(DEFAULT_SCARE_SETTINGS);
  const [clips, setClips] = createSignal<ScareClip[]>([]);
  const [showing, setShowing] = createSignal<Scare | null>(null);
  let lastAt = 0;
  let hideTimer: number | undefined;

  const load = () =>
    void hub.scares().then(
      (s) => {
        setSettings(s.settings);
        setClips(s.clips);
      },
      () => undefined,
    );

  const hide = () => {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
    setShowing(null);
  };

  const show = (scare: Scare) => {
    if (isKids() || document.hidden) return;
    lastAt = Date.now();
    setShowing(scare);
    if (!scare.clip || scare.clip.kind === "image") screech(scare.volume);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, Math.max(1, scare.seconds) * 1000);
  };

  /** True when a random scare would be welcome right now. */
  const dueNow = (): boolean => {
    const s = settings();
    if (!s.enabled || isKids() || showing() || document.hidden) return false;
    if (Date.now() - lastAt < s.minGapMinutes * 60_000) return false;
    const playing = playerState().status === "playing";
    if (s.whilePlayingOnly && !playing) return false;
    if (playing && isLive() && !s.duringLive) return false;
    return Math.random() * 100 < s.chancePercent;
  };

  onMount(() => {
    load();
    // The first scare of an evening waits out the gap, so turning it on isn't an instant fright.
    lastAt = Date.now();
  });

  const off = onHubEvent((e) => {
    if (e.type === "scare") show(e.scare);
    if (e.type === "scares.changed" || e.type === "hello") load();
  });

  const tick = window.setInterval(() => {
    if (!dueNow()) return;
    const list = clips();
    const clip = list[Math.floor(Math.random() * list.length)];
    const s = settings();
    show({ id: `local-${Date.now()}`, ...(clip ? { clip } : {}), seconds: s.seconds, volume: s.volume, byHand: false });
  }, TICK_MS);

  // OK or Back makes it go, like a pop-up; it goes by itself anyway.
  const offKeys = addOverlayKeys((action) => {
    if (!showing() || (action !== "ok" && action !== "back")) return false;
    hide();
    return true;
  });

  onCleanup(() => {
    off();
    window.clearInterval(tick);
    window.clearTimeout(hideTimer);
    offKeys();
  });

  return (
    <Show when={showing()}>
      {(scare) => (
        <div class="jump-scare" role="presentation">
          <Show
            when={scare().clip}
            fallback={
              // Nothing uploaded yet: the TV draws its own face so a scare still works.
              <svg class="scare-face" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                <defs>
                  <radialGradient id="scare-glow" cx="50%" cy="45%" r="60%">
                    <stop offset="0" stop-color="#3a0610" />
                    <stop offset="1" stop-color="#000" />
                  </radialGradient>
                  <radialGradient id="scare-eye" cx="50%" cy="50%" r="50%">
                    <stop offset="0" stop-color="#fff2a8" />
                    <stop offset="0.35" stop-color="#ff2a1a" />
                    <stop offset="1" stop-color="#2a0000" stop-opacity="0" />
                  </radialGradient>
                </defs>
                <rect width="640" height="360" fill="url(#scare-glow)" />
                <path d="M320 18c-92 0-150 70-150 160 0 70 30 120 64 150 18 16 40 26 86 26s68-10 86-26c34-30 64-80 64-150 0-90-58-160-150-160z" fill="#d9d2c3" />
                <path d="M222 140l78 26-8 34c-30 4-58-8-74-30zM418 140l-78 26 8 34c30 4 58-8 74-30z" fill="#0b0204" />
                <circle cx="262" cy="172" r="22" fill="url(#scare-eye)" />
                <circle cx="378" cy="172" r="22" fill="url(#scare-eye)" />
                <path d="M306 214l14-26 14 26z" fill="#0b0204" />
                <path d="M244 246c20-10 132-10 152 0l-14 84c-20 14-104 14-124 0z" fill="#0b0204" />
                <path d="M256 250l12 26 12-24 14 28 12-28 14 28 12-28 14 26 12-26 12 26 12-24" fill="none" stroke="#d9d2c3" stroke-width="6" stroke-linejoin="round" />
                <path d="M262 324l10-30 12 32 12-34 12 36 12-36 12 34 12-32 10 30" fill="none" stroke="#d9d2c3" stroke-width="6" stroke-linejoin="round" />
                <path d="M300 330v18M342 332v12" stroke="#7a0a12" stroke-width="5" stroke-linecap="round" />
              </svg>
            }
          >
            {(clip) => (
              <Show
                when={clip().kind === "video"}
                fallback={<img class="scare-media" src={clip().url} alt="" />}
              >
                <video
                  class="scare-media"
                  src={clip().url}
                  autoplay
                  playsinline
                  ref={(el) => {
                    el.volume = Math.max(0, Math.min(1, scare().volume));
                    // A clip shorter than the setting ends the scare when it finishes.
                    el.onended = hide;
                    void el.play().catch(() => undefined);
                  }}
                />
              </Show>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
