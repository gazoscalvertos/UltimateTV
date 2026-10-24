// The player. On the box, the Electron shell exposes `window.ultimatetv`, which drives mpv in its
// own window under this transparent UI. In a normal browser (development, screenshots) a <video>
// element stands in; streams it can't decode (MPEG-TS, HEVC) show their artwork instead.

import type { BoxAgent, BoxInfo, BoxSoftware, PlaybackStats, PlayerState, PlayOptions, VideoLayout } from "@ultimatetv/shared";

class BrowserAgent implements BoxAgent {
  private video: HTMLVideoElement;
  private still: HTMLDivElement;
  private listeners = new Set<(s: PlayerState) => void>();
  private state: PlayerState = { status: "idle", positionMs: 0, audioTracks: [], subtitleTracks: [] };
  /** When the video can't play, a clock stands in so the UI behaves as it would on the box. */
  private fake: { startedAt: number; offsetMs: number; paused: boolean; durationMs?: number } | null = null;
  private timer: number | undefined;
  private live = false;

  constructor() {
    const stage = document.createElement("div");
    stage.id = "stage";
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.still = document.createElement("div");
    this.still.className = "stage-still";
    stage.append(this.video, this.still);
    document.body.prepend(stage);
    // While faking playback the video element is empty, so its events would undo the fake state.
    const sync = () => (this.fake ? undefined : this.emit(this.fromVideo()));
    for (const ev of ["playing", "pause", "waiting", "timeupdate", "ended", "loadedmetadata"]) this.video.addEventListener(ev, sync);
    this.video.addEventListener("error", () => this.fallback());
    this.setLayout({ mode: "hidden" });
  }

  private fromVideo(): PlayerState {
    const v = this.video;
    const status: PlayerState["status"] = v.ended ? "ended" : v.paused ? "paused" : v.readyState < 3 ? "buffering" : "playing";
    const state: PlayerState = { ...this.state, status, positionMs: Math.round(v.currentTime * 1000) };
    if (Number.isFinite(v.duration) && !this.live) state.durationMs = Math.round(v.duration * 1000);
    if (v.videoWidth) state.video = { width: v.videoWidth, height: v.videoHeight };
    return state;
  }

  private fallback(): void {
    this.video.removeAttribute("src");
    this.video.load();
    this.still.classList.add("show");
    // A pretend running time so films show progress; the real length comes from mpv on the box.
    if (!this.live && !this.state.durationMs) this.state = { ...this.state, durationMs: Math.max(60 * 60_000, this.state.positionMs + 30 * 60_000) };
    this.fake = { startedAt: Date.now(), offsetMs: this.state.positionMs, paused: false, ...(this.state.durationMs ? { durationMs: this.state.durationMs } : {}) };
    this.tickFake();
  }

  private tickFake(): void {
    clearInterval(this.timer);
    const tick = () => {
      const f = this.fake;
      if (!f) return;
      const pos = f.paused ? f.offsetMs : f.offsetMs + (Date.now() - f.startedAt);
      const ended = f.durationMs !== undefined && pos >= f.durationMs;
      this.emit({ ...this.state, status: ended ? "ended" : f.paused ? "paused" : "playing", positionMs: Math.min(pos, f.durationMs ?? pos), video: { width: 3840, height: 2160, fps: 25, hdr: "SDR", hwdec: "browser" } });
    };
    tick();
    this.timer = window.setInterval(tick, 500);
  }

  private emit(state: PlayerState): void {
    this.state = state;
    for (const l of this.listeners) l(state);
  }

  async info(): Promise<BoxInfo> {
    return { kind: "browser", version: "browser", display: { name: "Browser", width: screen.width, height: screen.height, refreshHz: 60, hdr: false } };
  }

  async play(o: PlayOptions): Promise<void> {
    clearInterval(this.timer);
    this.fake = null;
    this.live = o.live;
    this.still.style.backgroundImage = o.artwork ? `url("${o.artwork}")` : "";
    this.still.classList.toggle("show", Boolean(o.artwork));
    this.emit({ status: "loading", positionMs: o.startMs ?? 0, audioTracks: [{ id: 1, lang: "eng", title: "English", codec: "eac3", channels: 6, selected: true }], subtitleTracks: (o.subtitles ?? []).map((s, i) => ({ id: i + 1, lang: s.lang, title: s.label, external: true, selected: false })) });
    // The browser can't play MPEG-TS or most IPTV streams; show the artwork with a running clock.
    if (/\.ts(\?|$)|\/api\/stream\//.test(o.url) || /\.mkv(\?|$)/.test(o.url)) {
      this.fallback();
      return;
    }
    this.video.src = o.url;
    if (o.startMs) this.video.currentTime = o.startMs / 1000;
    await this.video.play().catch(() => this.fallback());
    if (!this.fake) this.still.classList.remove("show");
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.fake = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.still.classList.remove("show");
    this.emit({ status: "idle", positionMs: 0, audioTracks: [], subtitleTracks: [] });
  }

  async pause(paused: boolean): Promise<void> {
    if (this.fake) {
      const f = this.fake;
      if (paused && !f.paused) f.offsetMs += Date.now() - f.startedAt;
      if (!paused && f.paused) f.startedAt = Date.now();
      f.paused = paused;
      this.tickFake();
      return;
    }
    if (paused) this.video.pause();
    else await this.video.play().catch(() => undefined);
  }

  async seek(ms: number, mode: "absolute" | "relative"): Promise<void> {
    if (this.fake) {
      const f = this.fake;
      const now = f.paused ? f.offsetMs : f.offsetMs + (Date.now() - f.startedAt);
      f.offsetMs = Math.max(0, mode === "absolute" ? ms : now + ms);
      f.startedAt = Date.now();
      this.tickFake();
      return;
    }
    this.video.currentTime = Math.max(0, mode === "absolute" ? ms / 1000 : this.video.currentTime + ms / 1000);
  }

  async goLive(): Promise<void> {
    if (this.fake) {
      this.fake.offsetMs = 0;
      this.fake.startedAt = Date.now();
      this.fake.paused = false;
    }
  }

  async setAudioTrack(id: number): Promise<void> {
    this.emit({ ...this.state, audioTracks: this.state.audioTracks.map((t) => ({ ...t, selected: t.id === id })) });
  }

  async setSubtitleTrack(id: number | null): Promise<void> {
    this.emit({ ...this.state, subtitleTracks: this.state.subtitleTracks.map((t) => ({ ...t, selected: t.id === id })) });
  }

  async setNightMode(): Promise<void> {}

  async setLayout(layout: VideoLayout): Promise<void> {
    const stage = this.video.parentElement!;
    stage.className = `stage-${layout.mode}`;
    if (layout.mode === "window") Object.assign(stage.style, { left: `${layout.x}px`, top: `${layout.y}px`, width: `${layout.width}px`, height: `${layout.height}px` });
    else stage.removeAttribute("style");
  }

  async stats(): Promise<PlaybackStats | null> {
    if (this.state.status === "idle") return null;
    const v = this.state.video;
    return {
      sections: [
        { title: "Video", rows: [["Resolution", v ? `${v.width}×${v.height}` : "unknown"], ["Decoder", this.fake ? "none (the browser can't play this stream)" : "browser"]] },
        { title: "Network", rows: [["Buffer", this.video.buffered.length ? `${(this.video.buffered.end(this.video.buffered.length - 1) - this.video.currentTime).toFixed(1)} s` : "0 s"]] },
      ],
    };
  }

  onState(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onPower(): () => void {
    return () => undefined;
  }

  async wakeTv(): Promise<void> {}

  async reload(): Promise<void> {
    location.reload();
  }

  async software(): Promise<BoxSoftware | null> {
    return null;
  }

  async update(): Promise<void> {}
}

export const agent: BoxAgent = window.ultimatetv ?? new BrowserAgent();
/**
 * Whether the box shell has a method. The UI comes from the Hub and can be newer than the shell
 * installed on the box, so methods added later may be missing until the box is updated.
 */
export const agentHas = (method: keyof BoxAgent): boolean => typeof (agent as unknown as Record<string, unknown>)[method] === "function";
export const onBox = Boolean(window.ultimatetv);
