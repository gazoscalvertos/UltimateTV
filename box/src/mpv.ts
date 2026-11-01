// mpv runs as its own full-screen window under the transparent UI, and is driven over its JSON
// IPC socket: one JSON object per line each way, replies matched by request_id, property changes
// pushed as events after `observe_property`.

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";

export interface MpvOptions {
  socket: string;
  /** Extra mpv arguments, e.g. from MPV_ARGS in the box's config. */
  extraArgs?: string[];
  audioDevice?: string;
  /**
   * Desktop mode (mode.ts): mpv opens its own ordinary window only while there's video, with its
   * usual on-screen controls and keys, rather than sitting full screen under the TV UI all the time.
   */
  desktop?: boolean;
  /** Desktop mode's key file (DESKTOP_INPUT_CONF), written beside the socket. */
  inputConf?: string;
  log?: (line: string) => void;
}

/**
 * Keys for desktop mode's video window, on top of mpv's own: leaving it stops playback (back to the
 * app) rather than quitting mpv, which the app would have to restart. The mouse's back button is
 * Back too, as in the app; mpv's own mouse controls (its on-screen bar, double-click for full
 * screen, right-click to pause, the wheel) stay.
 */
export const DESKTOP_INPUT_CONF = ["q stop", "Q stop", "ESC stop", "CLOSE_WIN stop", "BS stop", "MBTN_BACK stop", "MBTN_FORWARD ignore", ""].join("\n");

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** The arguments for an mpv window that sits idle until told what to play. */
export function mpvArgs(o: MpvOptions): string[] {
  const window = o.desktop
    ? [
        // A window only while there's video; full screen to start with (f toggles it).
        "--force-window=no",
        "--fullscreen",
        "--title=${?media-title:${media-title}}${!media-title:UltimateTV}",
        "--osc=yes",
        "--input-default-bindings=yes",
        "--input-vo-keyboard=yes",
        "--cursor-autohide=1000",
        ...(o.inputConf ? [`--input-conf=${o.inputConf}`] : []),
        // The computer's own GPU and screen: whatever decoder works, no resampling to the refresh rate.
        "--vo=gpu-next",
        "--hwdec=auto-safe",
        "--video-sync=audio",
      ]
    : [
        "--force-window=yes",
        "--fullscreen",
        "--title=ultimatetv-video",
        "--osc=no",
        "--osd-level=0",
        "--input-default-bindings=no",
        "--input-vo-keyboard=no",
        "--cursor-autohide=always",
        // Picture: gpu-next with VA-API decode; HDR and the TV's own colour handling are passed through.
        "--vo=gpu-next",
        "--hwdec=vaapi,auto-safe",
        "--target-colorspace-hint=yes",
        "--video-sync=display-resample",
      ];
  const args = [
    `--input-ipc-server=${o.socket}`,
    "--idle=yes",
    "--wayland-app-id=ultimatetv-video",
    "--x11-name=ultimatetv-video",
    // (Not in desktop mode, where the window only shows video: mpv before 0.38, as some distros
    // still ship, doesn't know the option and won't start.)
    ...(o.desktop ? [] : ["--background-color=#000000"]),
    "--keep-open=yes",
    ...window,
    "--interpolation=no",
    "--deband=yes",
    // spline36: sharp, and light enough for Intel UHD graphics at 4K (ewa_lanczossharp kept a
    // 3440×1440 screen's GPU near its limit).
    "--scale=spline36",
    // Sound: on the box, Dolby Digital (Plus) and DTS go to the TV untouched; everything else is
    // decoded. A desktop's speakers or headphones get everything decoded.
    ...(o.desktop ? [] : ["--audio-spdif=ac3,eac3,dts"]),
    "--audio-channels=auto",
    // Live TV: keep a few minutes behind us so live can be paused and rewound.
    "--cache=yes",
    "--demuxer-max-bytes=512MiB",
    "--demuxer-max-back-bytes=1024MiB",
    "--cache-pause-wait=2",
    "--network-timeout=20",
    "--sub-auto=fuzzy",
    "--sub-font-size=44",
    "--sub-border-size=2.5",
    "--sub-shadow-offset=1.5",
  ];
  if (o.audioDevice) args.push(`--audio-device=${o.audioDevice}`);
  return [...args, ...(o.extraArgs ?? [])];
}

export class Mpv extends EventEmitter {
  private proc: ChildProcess | null = null;
  private sock: net.Socket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private observed: string[] = [];
  private stopping = false;

  constructor(private readonly opts: MpvOptions) {
    super();
  }

  /** Starts mpv (restarting it if it dies) and connects to its socket. */
  async start(): Promise<void> {
    this.stopping = false;
    if (existsSync(this.opts.socket)) rmSync(this.opts.socket);
    if (this.opts.inputConf) writeFileSync(this.opts.inputConf, DESKTOP_INPUT_CONF);
    const proc = spawn("mpv", mpvArgs(this.opts), { stdio: ["ignore", "ignore", "pipe"] });
    this.proc = proc;
    proc.stderr?.on("data", (d: Buffer) => this.opts.log?.(`mpv: ${d.toString().trim()}`));
    proc.on("exit", (code) => {
      this.opts.log?.(`mpv exited (${code})`);
      this.sock?.destroy();
      this.sock = null;
      for (const p of this.pending.values()) p.reject(new Error("mpv exited"));
      this.pending.clear();
      this.emit("exit");
      if (!this.stopping) setTimeout(() => void this.start().catch((e: Error) => this.opts.log?.(e.message)), 1000);
    });
    await this.connect();
    for (const name of this.observed) await this.command("observe_property", 0, name);
  }

  private async connect(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (existsSync(this.opts.socket)) {
        try {
          this.sock = await new Promise<net.Socket>((resolve, reject) => {
            const s = net.connect(this.opts.socket, () => resolve(s));
            s.once("error", reject);
          });
          this.sock.setEncoding("utf8");
          this.sock.on("data", (chunk: string) => this.onData(chunk));
          this.sock.on("error", (e) => this.opts.log?.(`mpv socket: ${e.message}`));
          return;
        } catch {
          // Socket file exists but mpv isn't listening yet.
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("mpv didn't open its IPC socket");
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: { request_id?: number; error?: string; data?: unknown; event?: string; name?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.request_id !== undefined && this.pending.has(msg.request_id)) {
        const p = this.pending.get(msg.request_id)!;
        this.pending.delete(msg.request_id);
        if (msg.error && msg.error !== "success") p.reject(new Error(`mpv: ${msg.error}`));
        else p.resolve(msg.data);
      } else if (msg.event === "property-change" && msg.name) {
        this.emit("property", msg.name, msg.data);
      } else if (msg.event) {
        this.emit("event", msg.event, msg);
      }
    }
  }

  command(...args: unknown[]): Promise<unknown> {
    const sock = this.sock;
    if (!sock) return Promise.reject(new Error("mpv isn't running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      sock.write(`${JSON.stringify({ command: args, request_id: id })}\n`);
    });
  }

  get<T = unknown>(name: string): Promise<T> {
    return this.command("get_property", name) as Promise<T>;
  }

  set(name: string, value: unknown): Promise<unknown> {
    return this.command("set_property", name, value);
  }

  /** Watches a property for good, including across mpv restarts. */
  async observe(name: string): Promise<void> {
    this.observed.push(name);
    if (this.sock) await this.command("observe_property", 0, name);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.command("quit").catch(() => undefined);
    this.proc?.kill();
  }
}
