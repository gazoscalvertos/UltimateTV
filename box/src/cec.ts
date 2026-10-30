// HDMI-CEC through cec-ctl (v4l-utils) on the Pulse-Eight adapter's /dev/cec device. The remote's
// buttons don't come through here: the kernel turns them into key presses (see
// tools/box/cec-keymap.toml). This side registers the box as a playback device, wakes the TV,
// watches for the TV going to standby or switching to another input, and hands the screen back
// to the TV's own Home (TV apps: Netflix, Disney+, Prime) when asked.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { TvAppsMethod } from "@ultimatetv/shared";

const run = promisify(execFile);

export type CecMessage = { opcode: string; from: string; physAddr?: string; status?: string };

/**
 * Turns `cec-ctl --monitor` output into messages. A message is a "Received from …: NAME (0x..)"
 * line, followed by indented "key: value" lines.
 */
export class CecParser {
  private pending: CecMessage | null = null;

  /** Feeds one line; returns the previous message once it is complete. */
  line(text: string): CecMessage | null {
    const head = /^(?:Received|Transmitted) from (.+?) to .*?: ([A-Z_]+) \(0x[0-9a-f]+\)/i.exec(text);
    if (head) {
      const done = this.pending;
      this.pending = { opcode: head[2]!.toUpperCase(), from: head[1]!.trim() };
      return done;
    }
    const field = /^\s+([a-z-]+): (.+)$/i.exec(text);
    if (field && this.pending) {
      if (field[1] === "phys-addr" || field[1] === "new-phys-addr") this.pending.physAddr = field[2]!.trim();
      if (field[1] === "pwr-state") this.pending.status = field[2]!.trim();
      return null;
    }
    const done = this.pending;
    this.pending = null;
    return done;
  }

  flush(): CecMessage | null {
    const done = this.pending;
    this.pending = null;
    return done;
  }
}

/** What a message means for the box: the TV is now showing us (true), or not (false). */
export function powerFrom(msg: CecMessage, ours: string | null): boolean | null {
  switch (msg.opcode) {
    case "STANDBY":
      return false;
    case "SET_STREAM_PATH":
    case "ROUTING_CHANGE":
    case "ROUTING_INFORMATION":
    case "ACTIVE_SOURCE":
      if (!ours || !msg.physAddr) return null;
      return msg.physAddr === ours;
    case "REPORT_POWER_STATUS":
      if (msg.from.startsWith("TV") && msg.status) return /^on/i.test(msg.status) ? null : /standby/i.test(msg.status) ? false : null;
      return null;
    default:
      return null;
  }
}

/** The cec-ctl calls (after `-d <device>`) that hand the screen back to the TV. */
export function tvAppsCommands(method: TvAppsMethod, physAddr: string | null): string[][] {
  const out: string[][] = [];
  // <Inactive Source>: most TVs go back to their own Home or last app when the active source steps down.
  if (method !== "home" && physAddr) out.push(["--to", "0", "--inactive-source", `phys-addr=${physAddr}`]);
  // The TV's Home ("Root Menu") key, pressed and let go, for TVs that stay on the box's input.
  if (method !== "inactive") out.push(["--to", "0", "--user-control-pressed", "ui-cmd=root-menu"], ["--to", "0", "--user-control-released"]);
  return out;
}

export class Cec {
  private monitor: ChildProcess | null = null;
  private physAddr: string | null = null;
  private listeners = new Set<(active: boolean) => void>();
  connected = false;
  tvOn: boolean | undefined;
  /** The box handed the screen to the TV's apps and hasn't been picked again yet (so it mustn't suspend). */
  handedOver = false;

  constructor(
    private readonly device: string,
    private readonly log: (line: string) => void,
  ) {}

  async start(): Promise<void> {
    try {
      // Register as a playback device called UltimateTV, so the TV lists the box by name.
      const { stdout } = await run("cec-ctl", ["-d", this.device, "--playback", "--osd-name", "UltimateTV"], { timeout: 10_000 });
      this.physAddr = /Physical Address\s*:\s*([0-9a-f.]+)/i.exec(stdout)?.[1] ?? null;
      this.connected = true;
      this.log(`CEC ready on ${this.device} at ${this.physAddr ?? "unknown address"}`);
    } catch (e) {
      this.connected = false;
      this.log(`No CEC on ${this.device}: ${(e as Error).message}`);
      return;
    }
    this.watch();
  }

  private watch(): void {
    const proc = spawn("cec-ctl", ["-d", this.device, "--monitor"], { stdio: ["ignore", "pipe", "ignore"] });
    this.monitor = proc;
    const parser = new CecParser();
    const handle = (msg: CecMessage | null) => {
      if (!msg) return;
      const active = powerFrom(msg, this.physAddr);
      if (msg.opcode === "STANDBY") {
        this.tvOn = false;
        this.handedOver = false;
      }
      if (msg.opcode === "SET_STREAM_PATH" || msg.opcode === "ACTIVE_SOURCE") this.tvOn = true;
      if (active === null) return;
      if (active) this.handedOver = false;
      this.log(`CEC ${msg.opcode} → ${active ? "showing the box" : "not showing the box"}`);
      for (const l of this.listeners) l(active);
      // The TV asked for us: say we're the active source so it switches input and stays there.
      if (active && msg.opcode === "SET_STREAM_PATH") void this.activeSource();
    };
    createInterface({ input: proc.stdout! }).on("line", (l) => handle(parser.line(l)));
    proc.on("exit", () => {
      handle(parser.flush());
      this.monitor = null;
      setTimeout(() => this.watch(), 5000);
    });
  }

  onPower(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Switches the TV on and over to the box. */
  async wakeTv(): Promise<void> {
    if (!this.connected) return;
    await run("cec-ctl", ["-d", this.device, "--to", "0", "--image-view-on"], { timeout: 5000 }).catch((e: Error) => this.log(e.message));
    await this.activeSource();
  }

  /** Puts the TV into standby (the sleep timer). */
  async standby(): Promise<void> {
    if (!this.connected) return;
    await run("cec-ctl", ["-d", this.device, "--to", "0", "--standby"], { timeout: 5000 }).catch((e: Error) => this.log(e.message));
  }

  /**
   * Gives the screen back to the TV's own Home, for its apps. Returns false when there's no CEC
   * adapter, so the TV app can say to press Home on the TV's remote instead.
   */
  async tvApps(method: TvAppsMethod = "both"): Promise<boolean> {
    if (!this.connected) return false;
    this.handedOver = true;
    let ok = false;
    for (const args of tvAppsCommands(method, this.physAddr)) {
      ok = (await run("cec-ctl", ["-d", this.device, ...args], { timeout: 5000 }).then(() => true, (e: Error) => (this.log(e.message), false))) || ok;
    }
    this.log(`CEC: handed the screen to the TV's apps (${method})${ok ? "" : ", but cec-ctl failed"}`);
    return ok;
  }

  private async activeSource(): Promise<void> {
    if (!this.physAddr) return;
    await run("cec-ctl", ["-d", this.device, "--to", "15", "--active-source", `phys-addr=${this.physAddr}`], { timeout: 5000 }).catch((e: Error) => this.log(e.message));
  }

  stop(): void {
    this.monitor?.removeAllListeners("exit");
    this.monitor?.kill();
  }
}
