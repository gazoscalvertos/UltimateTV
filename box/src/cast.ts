// Other screens and games on the box. Two kinds of thing can have the screen instead of the TV app:
//
// - AirPlay: UxPlay runs in the background as a receiver named after the app, so an iPhone, iPad
//   or Mac finds the TV in Screen Mirroring. UxPlay writes a small file (-dacp) only while
//   something is connected, which is how we tell. The TV app stays on top but draws nothing, so
//   its full-screen window shows through and the remote's Back still asks to stop it.
// - Game apps (RetroArch, Moonlight, Steam Link, GeForce NOW, Steam): launched full screen; the
//   TV app's window hides so the game gets the keyboard and controllers, and comes back when the
//   game closes.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { GAME_APPS, type CastState, type GameApp, type GameAppId } from "@ultimatetv/shared";

const run = promisify(execFile);

/** How each app starts: a command on the PATH, or a Flatpak. */
export const APP_COMMANDS: Record<GameAppId, { bins: string[][]; flatpak?: string }> = {
  retroarch: { bins: [["retroarch", "--fullscreen"]], flatpak: "org.libretro.RetroArch" },
  moonlight: { bins: [["moonlight"]], flatpak: "com.moonlight_stream.Moonlight" },
  steamlink: { bins: [["steamlink"]], flatpak: "com.valvesoftware.SteamLink" },
  geforcenow: { bins: [], flatpak: "com.nvidia.geforcenow" },
  steam: { bins: [["steam", "-gamepadui"]], flatpak: "com.valvesoftware.Steam" },
};

/** Finds a program on the PATH. */
export function which(bin: string, pathEnv = process.env.PATH ?? ""): string | null {
  for (const dir of pathEnv.split(":").filter(Boolean)) {
    const full = path.join(dir, bin);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** The arguments UxPlay runs with: named after the app, full screen, with cover art for music. */
export function uxplayArgs(name: string, dacpFile: string, extra: string[] = []): string[] {
  return ["-n", name, "-nh", "-fs", "-dacp", dacpFile, "-ca", "-nofreeze", "-reset", "15", ...extra];
}

interface Saved {
  airplay: boolean;
}

export class Cast {
  private uxplay: ChildProcess | null = null;
  private uxplayBin: string | null;
  private restartDelay = 2000;
  private restartTimer: NodeJS.Timeout | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private app: { id: GameAppId; proc: ChildProcess } | null = null;
  private listeners = new Set<(s: CastState) => void>();
  private connected = false;
  private since = 0;
  private error: string | undefined;
  private flatpaks = new Set<string>();
  private saved: Saved;
  private stopped = false;

  constructor(
    private readonly opts: {
      runtimeDir: string;
      configFile: string;
      name: () => string;
      log: (line: string) => void;
      /** Something took the screen (true) or gave it back (false). */
      onForeground: (kind: "airplay" | "app" | null) => void;
      extraUxplayArgs?: string[];
    },
  ) {
    this.uxplayBin = which("uxplay");
    try {
      this.saved = { airplay: true, ...(JSON.parse(readFileSync(opts.configFile, "utf8")) as Partial<Saved>) };
    } catch {
      this.saved = { airplay: true };
    }
  }

  private get dacpFile(): string {
    return path.join(this.opts.runtimeDir, "ultimatetv-airplay.dacp");
  }

  async start(): Promise<void> {
    await this.refreshFlatpaks();
    if (this.saved.airplay) this.startAirplay();
    // UxPlay's -dacp file only exists while a phone or Mac is connected.
    this.pollTimer = setInterval(() => this.poll(), 1000);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.restartTimer);
    this.stopAirplay();
    this.app?.proc.kill("SIGTERM");
  }

  private async refreshFlatpaks(): Promise<void> {
    if (!which("flatpak")) return;
    try {
      const { stdout } = await run("flatpak", ["list", "--app", "--columns=application"], { timeout: 10_000 });
      this.flatpaks = new Set(stdout.split(/\s+/).filter(Boolean));
    } catch {
      this.flatpaks = new Set();
    }
  }

  private command(id: GameAppId): string[] | null {
    const spec = APP_COMMANDS[id];
    for (const cmd of spec.bins) if (which(cmd[0]!)) return cmd;
    if (spec.flatpak && this.flatpaks.has(spec.flatpak)) return ["flatpak", "run", spec.flatpak];
    return null;
  }

  state(): CastState {
    const apps: GameApp[] = GAME_APPS.map((a) => ({ ...a, installed: this.command(a.id) !== null }));
    const foreground: CastState["foreground"] = this.app
      ? { kind: "app", id: this.app.id, name: GAME_APPS.find((a) => a.id === this.app!.id)?.name ?? this.app.id, since: this.since }
      : this.connected
        ? { kind: "airplay", id: "airplay", name: "AirPlay", since: this.since }
        : null;
    return {
      airplay: { installed: Boolean(this.uxplayBin), enabled: this.saved.airplay, running: Boolean(this.uxplay), connected: this.connected, name: this.opts.name(), ...(this.error ? { error: this.error } : {}) },
      apps,
      foreground,
    };
  }

  onChange(listener: (s: CastState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  async settings(patch: { airplay?: boolean; name?: string }): Promise<CastState> {
    if (patch.airplay !== undefined && patch.airplay !== this.saved.airplay) {
      this.saved.airplay = patch.airplay;
      try {
        writeFileSync(this.opts.configFile, JSON.stringify(this.saved));
      } catch (e) {
        this.opts.log(`Couldn't save the cast settings: ${(e as Error).message}`);
      }
      if (patch.airplay) this.startAirplay();
      else this.stopAirplay();
    }
    // A new name: UxPlay announces the name it started with, so start it again.
    if (patch.name !== undefined && this.uxplay) {
      this.stopAirplay();
      this.startAirplay();
    }
    this.changed();
    return this.state();
  }

  private startAirplay(): void {
    if (this.stopped || this.uxplay) return;
    if (!this.uxplayBin) this.uxplayBin = which("uxplay");
    if (!this.uxplayBin) {
      this.error = "UxPlay isn't installed (the box installer adds it)";
      return;
    }
    const args = uxplayArgs(this.opts.name(), this.dacpFile, this.opts.extraUxplayArgs);
    const proc = spawn(this.uxplayBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.uxplay = proc;
    this.error = undefined;
    const startedAt = Date.now();
    let lastLine = "";
    const keep = (chunk: Buffer) => {
      const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
      if (lines.length) lastLine = lines[lines.length - 1]!.slice(0, 200);
    };
    proc.stdout?.on("data", keep);
    proc.stderr?.on("data", keep);
    proc.on("error", (e) => {
      this.error = `UxPlay didn't start: ${e.message}`;
      this.opts.log(this.error);
    });
    proc.on("exit", (code) => {
      if (this.uxplay !== proc) return;
      this.uxplay = null;
      this.setConnected(false);
      if (this.stopped || !this.saved.airplay) return;
      // Ran for a while: start again quickly. Keeps dying: back off up to a minute.
      this.restartDelay = Date.now() - startedAt > 60_000 ? 2000 : Math.min(60_000, this.restartDelay * 2);
      this.error = `UxPlay stopped (${code ?? "signal"})${lastLine ? `: ${lastLine}` : ""}`;
      this.opts.log(`${this.error}; starting it again in ${this.restartDelay / 1000} s`);
      this.restartTimer = setTimeout(() => this.startAirplay(), this.restartDelay);
      this.changed();
    });
    this.opts.log(`AirPlay receiver on as "${this.opts.name()}"`);
    this.changed();
  }

  private stopAirplay(): void {
    clearTimeout(this.restartTimer);
    const proc = this.uxplay;
    this.uxplay = null;
    proc?.kill("SIGTERM");
    this.setConnected(false);
  }

  private poll(): void {
    this.setConnected(Boolean(this.uxplay) && existsSync(this.dacpFile));
  }

  private setConnected(on: boolean): void {
    if (on === this.connected) return;
    this.connected = on;
    if (!this.app) {
      this.since = Date.now();
      this.opts.log(on ? "AirPlay: a phone or Mac connected" : "AirPlay: disconnected");
      this.opts.onForeground(on ? "airplay" : null);
    }
    this.changed();
  }

  async launch(id: GameAppId): Promise<CastState> {
    if (this.app) {
      if (this.app.id === id) return this.state();
      throw new Error("Close the game that's open first");
    }
    await this.refreshFlatpaks();
    const cmd = this.command(id);
    if (!cmd) throw new Error(`${GAME_APPS.find((a) => a.id === id)?.name ?? id} isn't installed on the box. ${GAME_APPS.find((a) => a.id === id)?.howTo ?? ""}`);
    // AirPlay mirroring and a game can't share the screen.
    if (this.connected) this.restartAirplay();
    const proc = spawn(cmd[0]!, cmd.slice(1), { stdio: "ignore" });
    this.app = { id, proc };
    this.since = Date.now();
    this.opts.log(`Opened ${id}`);
    this.opts.onForeground("app");
    proc.on("error", (e) => this.opts.log(`${id} didn't start: ${e.message}`));
    proc.on("exit", (code) => {
      if (this.app?.proc !== proc) return;
      this.app = null;
      this.opts.log(`${id} closed (${code ?? "signal"})`);
      this.opts.onForeground(null);
      this.changed();
    });
    this.changed();
    return this.state();
  }

  /** Drops an AirPlay connection by starting the receiver again. */
  private restartAirplay(): void {
    if (!this.uxplay) return;
    this.stopAirplay();
    this.startAirplay();
  }

  /** Closes the game, or ends AirPlay mirroring, and gives the screen back to the TV app. */
  async stopForeground(): Promise<CastState> {
    const app = this.app;
    if (app) {
      app.proc.kill("SIGTERM");
      setTimeout(() => {
        if (this.app?.proc === app.proc) app.proc.kill("SIGKILL");
      }, 5000).unref();
    } else if (this.connected) {
      this.restartAirplay();
    }
    return this.state();
  }
}
