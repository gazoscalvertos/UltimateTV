// The box side of the BoxAgent contract: plays with mpv, follows its properties into a
// PlayerState for the UI, and puts the TV in the right picture mode for each video.

import type { AudioTrack, PlaybackStats, PlayerState, PlayOptions, SubTrack, VideoLayout } from "@ultimatetv/shared";
import type { Display } from "./display.js";
import type { Mpv } from "./mpv.js";

type MpvTrack = {
  id: number;
  type: "video" | "audio" | "sub";
  lang?: string;
  title?: string;
  codec?: string;
  "demux-channel-count"?: number;
  selected?: boolean;
  external?: boolean;
};

type VideoParams = { w?: number; h?: number; gamma?: string; primaries?: string; colormatrix?: string; pixelformat?: string; "hw-pixelformat"?: string } | null;

const WATCHED = ["time-pos", "duration", "pause", "paused-for-cache", "core-idle", "eof-reached", "idle-active", "track-list", "video-params", "container-fps", "hwdec-current", "audio-codec-name", "audio-params", "demuxer-cache-state", "current-ao"];

/** Whether mpv's video parameters describe HDR (PQ or HLG transfer). */
export function isHdr(params: VideoParams): boolean {
  return Boolean(params?.gamma && /^(pq|hlg)$/i.test(params.gamma));
}

/** mpv's track list as the UI's audio and subtitle lists. */
export function tracksFrom(list: MpvTrack[]): { audio: AudioTrack[]; subs: SubTrack[] } {
  const audio: AudioTrack[] = [];
  const subs: SubTrack[] = [];
  for (const t of list) {
    if (t.type === "audio") {
      const a: AudioTrack = { id: t.id, selected: Boolean(t.selected) };
      if (t.lang) a.lang = t.lang;
      if (t.title) a.title = t.title;
      if (t.codec) a.codec = t.codec;
      if (t["demux-channel-count"]) a.channels = t["demux-channel-count"];
      audio.push(a);
    } else if (t.type === "sub") {
      const s: SubTrack = { id: t.id, external: Boolean(t.external), selected: Boolean(t.selected) };
      if (t.lang) s.lang = t.lang;
      if (t.title) s.title = t.title;
      subs.push(s);
    }
  }
  return { audio, subs };
}

/** mpv's margins that put the video in a rectangle of the screen (the guide's preview). */
export function marginsFor(layout: VideoLayout, screen: { width: number; height: number }): [number, number, number, number] {
  if (layout.mode !== "window") return [0, 0, 0, 0];
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  return [clamp(layout.x / screen.width), clamp(1 - (layout.x + layout.width) / screen.width), clamp(layout.y / screen.height), clamp(1 - (layout.y + layout.height) / screen.height)];
}

/** The mpv properties the stats overlay reads. */
export const STATS_PROPS = [
  "video-codec", "video-params", "hwdec-current", "container-fps", "estimated-vf-fps", "video-bitrate",
  "display-fps", "video-sync", "frame-drop-count", "decoder-frame-drop-count", "vo-delayed-frame-count", "mistimed-frame-count", "avsync",
  "audio-codec", "audio-params", "audio-out-params", "current-ao", "audio-device", "audio-bitrate", "af",
  "demuxer-cache-state", "cache-speed", "file-format",
] as const;

const bits = (bps: unknown) => (typeof bps === "number" && bps > 0 ? (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbit/s` : `${Math.round(bps / 1e3)} kbit/s`) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The overlay's sections from mpv's properties, the TV's current mode and the stream's address
 * (only its host is shown: IPTV addresses carry the account's username and password).
 */
export function statsFrom(p: Record<string, unknown>, extra: { url?: string; display?: { width: number; height: number; refreshHz: number; hdr: boolean } | null }): PlaybackStats {
  const rows = (list: [string, string | undefined][]) => list.filter((r): r is [string, string] => Boolean(r[1]));
  const vp = p["video-params"] as VideoParams;
  const fps = num(p["container-fps"]);
  const est = num(p["estimated-vf-fps"]);
  const hdr = vp?.gamma === "pq" ? "HDR10 (PQ)" : vp?.gamma === "hlg" ? "HLG" : vp?.gamma ? `SDR (${vp.gamma})` : undefined;
  const ap = p["audio-params"] as { format?: string; samplerate?: number; "channel-count"?: number; "hr-channels"?: string } | undefined;
  const out = p["audio-out-params"] as { format?: string; "channel-count"?: number } | undefined;
  const passthrough = Boolean(out?.format?.startsWith("spdif"));
  const cache = p["demuxer-cache-state"] as { "cache-duration"?: number; "fw-bytes"?: number; "raw-input-rate"?: number } | undefined;
  let host: string | undefined;
  try {
    if (extra.url) host = new URL(extra.url).host;
  } catch {
    host = undefined;
  }
  const d = extra.display;
  const drops = [num(p["frame-drop-count"]), num(p["decoder-frame-drop-count"])];
  const avsync = num(p["avsync"]);
  return {
    sections: [
      {
        title: "Video",
        rows: rows([
          ["Codec", typeof p["video-codec"] === "string" ? p["video-codec"] : undefined],
          ["Resolution", vp?.w && vp.h ? `${vp.w}×${vp.h}${vp.pixelformat ? ` · ${vp["hw-pixelformat"] ? `${vp["hw-pixelformat"]}/` : ""}${vp.pixelformat}` : ""}` : undefined],
          ["Frame rate", fps ? `${fps.toFixed(3)} fps${est && Math.abs(est - fps) > 0.05 ? ` (measured ${est.toFixed(2)})` : ""}` : undefined],
          ["Colour", hdr ? `${hdr}${vp?.primaries ? ` · ${vp.primaries}` : ""}${vp?.colormatrix ? ` · ${vp.colormatrix}` : ""}` : undefined],
          ["Decoder", vp ? (typeof p["hwdec-current"] === "string" && p["hwdec-current"] && p["hwdec-current"] !== "no" ? `GPU (${p["hwdec-current"]})` : "CPU (software)") : undefined],
          ["Bitrate", bits(p["video-bitrate"])],
        ]),
      },
      {
        title: "Display",
        rows: rows([
          ["TV mode", d ? `${d.width}×${d.height} @ ${d.refreshHz.toFixed(3)} Hz${d.hdr ? " · HDR on" : " · HDR off"}` : undefined],
          ["Sync", typeof p["video-sync"] === "string" ? `${p["video-sync"]}${num(p["display-fps"]) ? ` at ${num(p["display-fps"])!.toFixed(3)} Hz` : ""}` : undefined],
          ["Dropped frames", drops.some((x) => x !== undefined) ? `${drops[0] ?? 0} by the display · ${drops[1] ?? 0} by the decoder` : undefined],
          ["Late frames", num(p["vo-delayed-frame-count"]) !== undefined ? `${num(p["vo-delayed-frame-count"])} delayed · ${num(p["mistimed-frame-count"]) ?? 0} mistimed` : undefined],
          ["A/V sync", avsync !== undefined ? `${Math.round(avsync * 1000)} ms` : undefined],
        ]),
      },
      {
        title: "Audio",
        rows: rows([
          ["Codec", typeof p["audio-codec"] === "string" ? p["audio-codec"] : undefined],
          ["Channels", ap ? `${ap["hr-channels"] ?? `${ap["channel-count"] ?? "?"} channels`}${ap.samplerate ? ` · ${ap.samplerate / 1000} kHz` : ""}` : undefined],
          ["Output", out ? (passthrough ? `Passthrough to the TV (${out.format!.replace(/^spdif-/, "")})` : `Decoded (${out.format ?? "PCM"}, ${out["channel-count"] ?? "?"} channels)`) : undefined],
          ["Device", typeof p["current-ao"] === "string" ? `${p["current-ao"]}${typeof p["audio-device"] === "string" && p["audio-device"] !== "auto" ? ` · ${p["audio-device"]}` : ""}` : undefined],
          ["Bitrate", bits(p["audio-bitrate"])],
          ["Night mode", Array.isArray(p["af"]) && p["af"].length ? "On" : undefined],
        ]),
      },
      {
        title: "Network",
        rows: rows([
          ["Source", host],
          ["Container", typeof p["file-format"] === "string" ? p["file-format"] : undefined],
          ["Buffer", cache?.["cache-duration"] !== undefined ? `${cache["cache-duration"].toFixed(1)} s${cache["fw-bytes"] ? ` · ${(cache["fw-bytes"] / 1024 ** 2).toFixed(1)} MB` : ""}` : undefined],
          ["Download speed", bits((cache?.["raw-input-rate"] ?? num(p["cache-speed"]) ?? 0) * 8)],
        ]),
      },
    ].filter((s) => s.rows.length),
  };
}

export class Player {
  private props: Record<string, unknown> = {};
  private listeners = new Set<(s: PlayerState) => void>();
  private live = false;
  private options: PlayOptions | null = null;
  private error: string | undefined;
  private loading = false;
  private timer: NodeJS.Timeout | undefined;
  private hdrSet = false;
  private displayCache: { at: number; value: Awaited<ReturnType<Display["tv"]>> } | null = null;

  constructor(
    private readonly mpv: Mpv,
    private readonly display: Display,
    private readonly screenSize: () => { width: number; height: number },
    private readonly log: (line: string) => void,
  ) {}

  async start(): Promise<void> {
    this.mpv.on("property", (name: string, value: unknown) => {
      this.props[name] = value;
      if (name === "video-params" && this.options && !this.hdrSet && value) {
        // Switch the TV into HDR once we know the video is HDR.
        this.hdrSet = true;
        void this.display.prepare(undefined, isHdr(value as VideoParams));
      }
      this.schedule();
    });
    this.mpv.on("event", (event: string, msg: { reason?: string; file_error?: string }) => {
      if (event === "start-file") this.loading = true;
      if (event === "file-loaded" || event === "playback-restart") this.loading = false;
      if (event === "end-file" && msg.reason === "error") {
        this.error = msg.file_error ?? "The stream didn't play";
        this.loading = false;
      }
      this.schedule();
    });
    for (const p of WATCHED) await this.mpv.observe(p);
  }

  /** Coalesces mpv's many property changes into a few state updates a second. */
  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const s = this.state();
      for (const l of this.listeners) l(s);
    }, 100);
  }

  state(): PlayerState {
    const p = this.props;
    const { audio, subs } = tracksFrom((p["track-list"] as MpvTrack[]) ?? []);
    let status: PlayerState["status"];
    if (!this.options) status = "idle";
    else if (this.error) status = "error";
    else if (this.loading) status = "loading";
    else if (p["eof-reached"] && !this.live) status = "ended";
    else if (p["pause"]) status = "paused";
    else if (p["paused-for-cache"] || (p["core-idle"] && !p["pause"])) status = "buffering";
    else status = "playing";
    const pos = Number(p["time-pos"] ?? 0);
    const state: PlayerState = { status, positionMs: Math.round(pos * 1000), audioTracks: audio, subtitleTracks: subs };
    const duration = Number(p["duration"]);
    if (!this.live && Number.isFinite(duration) && duration > 0) state.durationMs = Math.round(duration * 1000);
    const cache = p["demuxer-cache-state"] as { "cache-end"?: number; "cache-duration"?: number } | undefined;
    if (cache?.["cache-duration"] !== undefined) state.bufferedMs = Math.round(cache["cache-duration"] * 1000);
    if (this.live && cache?.["cache-end"] !== undefined) state.behindLiveMs = Math.max(0, Math.round((cache["cache-end"] - pos) * 1000));
    const vp = p["video-params"] as VideoParams;
    if (vp?.w && vp.h) {
      state.video = { width: vp.w, height: vp.h, hdr: vp.gamma === "pq" ? "HDR10" : vp.gamma === "hlg" ? "HLG" : "SDR" };
      const fps = Number(p["container-fps"]);
      if (Number.isFinite(fps) && fps > 0) state.video.fps = Math.round(fps * 1000) / 1000;
      const hw = p["hwdec-current"];
      if (typeof hw === "string" && hw) state.video.hwdec = hw;
    }
    const ap = p["audio-params"] as { "channel-count"?: number; format?: string } | undefined;
    if (p["audio-codec-name"] || ap) {
      state.audio = { passthrough: Boolean(ap?.format?.startsWith("spdif")) };
      if (typeof p["audio-codec-name"] === "string") state.audio.codec = p["audio-codec-name"];
      if (ap?.["channel-count"]) state.audio.channels = ap["channel-count"];
    }
    if (this.error) state.error = this.error;
    return state;
  }

  async stats(): Promise<PlaybackStats | null> {
    if (!this.options) return null;
    const values = await Promise.all(STATS_PROPS.map((name) => this.mpv.get(name).catch(() => undefined)));
    const props = Object.fromEntries(STATS_PROPS.map((name, i) => [name, values[i]]));
    // kscreen-doctor is slow to ask every second, and the mode only changes when playback starts.
    if (!this.displayCache || Date.now() - this.displayCache.at > 5000) this.displayCache = { at: Date.now(), value: await this.display.tv() };
    const tv = this.displayCache.value;
    return statsFrom(props, { url: this.options.url, display: tv ? { width: tv.mode.width, height: tv.mode.height, refreshHz: tv.mode.refreshRate, hdr: Boolean(tv.output.hdr) } : null });
  }

  onState(listener: (s: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async play(o: PlayOptions): Promise<void> {
    this.options = o;
    this.live = o.live;
    this.error = undefined;
    this.loading = true;
    this.hdrSet = false;
    this.schedule();
    // Match the TV's refresh rate before the first frame, so the switch happens on a black screen.
    // With variable refresh the screen follows mpv's frames, so mpv times them to the audio rather
    // than resampling to a fixed display rate.
    const sync = o.fps ? await this.display.prepare(o.fps, false) : null;
    await this.mpv.set("video-sync", sync === "vrr" ? "audio" : "display-resample").catch(() => undefined);
    const opts: string[] = [];
    if (o.startMs) opts.push(`start=${(o.startMs / 1000).toFixed(3)}`);
    if (o.headers && Object.keys(o.headers).length) opts.push(`http-header-fields=${Object.entries(o.headers).map(([k, v]) => `${k}: ${v.replace(/,/g, "\\,")}`).join(",")}`);
    if (o.preferredAudioLang) opts.push(`alang=${o.preferredAudioLang}`);
    if (o.preferredSubtitleLang) opts.push(`slang=${o.preferredSubtitleLang}`);
    opts.push(`sid=${o.subtitlesByDefault ? "auto" : "no"}`);
    opts.push(`cache-secs=${o.live ? 3600 : 60}`);
    await this.setNightMode(Boolean(o.nightMode));
    await this.mpv.command("loadfile", o.url, "replace", -1, opts.join(","));
    for (const s of o.subtitles ?? []) await this.mpv.command("sub-add", s.url, "auto", s.label, s.lang).catch(() => undefined);
    await this.mpv.set("pause", false);
  }

  async stop(): Promise<void> {
    this.options = null;
    this.error = undefined;
    this.loading = false;
    await this.mpv.command("stop").catch(() => undefined);
    await this.display.restore();
    this.schedule();
  }

  async pause(paused: boolean): Promise<void> {
    await this.mpv.set("pause", paused);
  }

  async seek(ms: number, mode: "absolute" | "relative"): Promise<void> {
    await this.mpv.command("seek", ms / 1000, mode === "absolute" ? "absolute+exact" : "relative+exact");
  }

  async goLive(): Promise<void> {
    const cache = this.props["demuxer-cache-state"] as { "cache-end"?: number } | undefined;
    if (cache?.["cache-end"] !== undefined) await this.mpv.command("seek", cache["cache-end"] - 1, "absolute");
    await this.mpv.set("pause", false);
  }

  async setAudioTrack(id: number): Promise<void> {
    await this.mpv.set("aid", id);
  }

  async setSubtitleTrack(id: number | null): Promise<void> {
    await this.mpv.set("sid", id ?? "no");
  }

  /** Night mode decodes the audio (no passthrough) and evens out loud and quiet parts. */
  async setNightMode(on: boolean): Promise<void> {
    await this.mpv.set("audio-spdif", on ? "" : "ac3,eac3,dts").catch(() => undefined);
    await this.mpv.set("af", on ? "lavfi=[acompressor=threshold=-24dB:ratio=4:attack=5:release=200:makeup=6dB],lavfi=[dynaudnorm=f=250:g=15]" : "").catch(() => undefined);
  }

  async setLayout(layout: VideoLayout): Promise<void> {
    const [l, r, t, b] = marginsFor(layout, this.screenSize());
    await Promise.all([this.mpv.set("video-margin-ratio-left", l), this.mpv.set("video-margin-ratio-right", r), this.mpv.set("video-margin-ratio-top", t), this.mpv.set("video-margin-ratio-bottom", b)]).catch((e: Error) => this.log(e.message));
  }
}
