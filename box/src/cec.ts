// HDMI-CEC through cec-ctl (v4l-utils) on the Pulse-Eight adapter's /dev/cec device. The remote's
// buttons don't come through here: the kernel turns them into key presses (see
// tools/box/cec-keymap.toml). This side registers the box as a playback device, wakes the TV,
// watches for the TV going to standby or switching to another input (and asks the TV now and then,
// as not every TV says when it goes to standby).

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

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
      // Only "off" counts: the TV being on doesn't mean it's showing the box.
      if (msg.from.startsWith("TV") && msg.status) return tvPowerOn(msg.status) === false ? false : null;
      return null;
    default:
      return null;
  }
}

/**
 * The TV's power from a pwr-state value ("on (0x00)", "standby (0x01)", "in transition standby to
 * on (0x02)", "in transition on to standby (0x03)"): true on or coming on, false off or going off,
 * null when it can't tell.
 */
export function tvPowerOn(state: string): boolean | null {
  const code = /\(0x0?([0-3])\)/.exec(state)?.[1];
  if (code) return code === "0" || code === "2";
  const s = state.toLowerCase();
  if (/standby to on/.test(s)) return true;
  if (/on to standby/.test(s) || /^standby/.test(s)) return false;
  if (/^on\b/.test(s)) return true;
  return null;
}

/** The TV's answer in the output of `cec-ctl --give-device-power-status`, or null when it didn't answer. */
export function powerFromReply(stdout: string): boolean | null {
  const state = /pwr-state:\s*(.+)/i.exec(stdout)?.[1];
  return state ? tvPowerOn(state.trim()) : null;
}

/**
 * The cec-ctl that can watch the bus. Watching (--monitor) needs CAP_NET_ADMIN, which the TV user
 * hasn't got, so the installer keeps a copy of cec-ctl with just that capability, for the TV user only.
 */
export const MONITOR_CTL = "/usr/local/lib/ultimatetv/cec-monitor";

/** How often the box asks the TV whether it's on, for TVs that go to standby without saying so. */
export const POLL_MS = 20_000;

/**
 * The HDMI physical address ("2.0.0.0") the TV gave this HDMI input, from the TV's EDID: the HDMI
 * vendor block (IEEE OUI 00-0C-03) in a CTA-861 extension. Null when the EDID has none.
 */
export function physAddrFromEdid(edid: Uint8Array): string | null {
  for (let block = 128; block + 128 <= edid.length; block += 128) {
    if (edid[block] !== 0x02) continue; // not a CTA-861 extension
    const dtdStart = edid[block + 2]!;
    let i = block + 4;
    const end = block + (dtdStart >= 4 ? dtdStart : 127);
    while (i < end) {
      const tag = edid[i]! >> 5;
      const len = edid[i]! & 0x1f;
      if (tag === 3 && len >= 5 && edid[i + 1] === 0x03 && edid[i + 2] === 0x0c && edid[i + 3] === 0x00) {
        const a = edid[i + 4]!;
        const b = edid[i + 5]!;
        return [a >> 4, a & 0xf, b >> 4, b & 0xf].map((n) => n.toString(16)).join(".");
      }
      i += len + 1;
    }
  }
  return null;
}

/** The physical address of the first connected HDMI output whose EDID has one. */
async function physAddrFromDrm(dir = "/sys/class/drm"): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => /^card\d+-HDMI-/.test(n)).sort()) {
    const status = await readFile(`${dir}/${name}/status`, "utf8").catch(() => "");
    if (status.trim() !== "connected") continue;
    const edid = await readFile(`${dir}/${name}/edid`).catch(() => null);
    const addr = edid ? physAddrFromEdid(edid) : null;
    if (addr && addr !== "f.f.f.f") return addr;
  }
  return null;
}

/** The cec-ctl call that registers the box, with its physical address when known. */
export function setupArgs(device: string, physAddr: string | null): string[] {
  return ["-d", device, ...(physAddr ? ["--phys-addr", physAddr] : []), "--playback", "--osd-name", "UltimateTV"];
}

export class Cec {
  private monitor: ChildProcess | null = null;
  private physAddr: string | null = null;
  private listeners = new Set<(active: boolean) => void>();
  connected = false;
  tvOn: boolean | undefined;

  constructor(
    private readonly device: string,
    private readonly log: (line: string) => void,
  ) {}

  private retry: NodeJS.Timeout | null = null;
  private poller: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastError = "";
  /** Watching the bus isn't allowed (no CAP_NET_ADMIN): asking the TV every POLL_MS has to do. */
  private monitorRefused = false;

  /**
   * Sets the adapter up, and keeps trying every 10 s until it's plugged in (or after it's pulled
   * out and put back, which forgets its setup).
   */
  async start(): Promise<void> {
    if (this.stopped) return;
    try {
      // The Pulse-Eight can't read the TV's EDID itself, so until it's told the box's HDMI address
      // it can't claim a CEC address and the TV never sends it the remote's keys. Take the address
      // from the EDID the TV gives the box's HDMI output (CEC_PHYS_ADDR overrides it).
      const addr = process.env.CEC_PHYS_ADDR?.trim() || (await physAddrFromDrm());
      // Register as a playback device called UltimateTV, so the TV lists the box by name.
      const { stdout } = await run("cec-ctl", setupArgs(this.device, addr), { timeout: 10_000 });
      this.physAddr = /Physical Address\s*:\s*([0-9a-f.]+)/i.exec(stdout)?.[1] ?? addr ?? null;
      if (this.physAddr === "f.f.f.f") this.physAddr = null;
      this.connected = true;
      this.lastError = "";
      this.log(
        this.physAddr
          ? `CEC ready on ${this.device} at ${this.physAddr}`
          : `CEC adapter on ${this.device}, but no HDMI address yet (TV off or not connected?), so the TV won't send remote keys. Set CEC_PHYS_ADDR in box.env if this lasts.`,
      );
      if (!this.physAddr) {
        this.later(30_000);
        return;
      }
    } catch (e) {
      this.connected = false;
      const msg = (e as Error).message.split("\n")[0] ?? "";
      if (msg !== this.lastError) this.log(`No CEC on ${this.device} yet: ${msg}`);
      this.lastError = msg;
      this.later(10_000);
      return;
    }
    this.watch();
    this.startPolling();
  }

  /**
   * Asks the TV for its power state now and then. Many TVs (Hisense among them, unless "Device auto
   * power off" is on) go to standby without telling the other devices, and watching the bus needs a
   * capability the box may not have, so this is what notices the TV going off.
   */
  private startPolling(): void {
    if (this.poller || this.stopped) return;
    this.poller = setInterval(() => void this.poll(), POLL_MS);
  }

  /** Asks the TV once; tells the listeners when it has gone off. */
  async poll(): Promise<boolean | null> {
    if (!this.connected) return null;
    if (!existsSync(this.device)) {
      // Pulled out: set it up again once it's back.
      this.connected = false;
      this.later(10_000);
      return null;
    }
    const { stdout } = await run("cec-ctl", ["-d", this.device, "--to", "0", "--give-device-power-status"], { timeout: 5000 }).catch(() => ({ stdout: "" }));
    const on = powerFromReply(stdout);
    if (on === null) return null;
    const was = this.tvOn;
    this.tvOn = on;
    // Only the change to off: the TV coming on doesn't say it's showing the box (the TV says that itself).
    if (!on && was !== false) this.tell(false, "TV power status: standby");
    return on;
  }

  private tell(active: boolean, why: string): void {
    this.log(`CEC ${why} → ${active ? "showing the box" : "not showing the box"}`);
    for (const l of this.listeners) l(active);
  }

  private later(ms: number): void {
    if (this.retry || this.stopped) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.start();
    }, ms);
  }

  private watch(): void {
    if (this.monitor || this.monitorRefused) return;
    const ctl = existsSync(MONITOR_CTL) ? MONITOR_CTL : "cec-ctl";
    const proc = spawn(ctl, ["-d", this.device, "--monitor"], { stdio: ["ignore", "pipe", "pipe"] });
    this.monitor = proc;
    let stderr = "";
    proc.stderr!.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-500)));
    proc.on("error", (e) => (stderr = e.message));
    const parser = new CecParser();
    const handle = (msg: CecMessage | null) => {
      if (!msg) return;
      const active = powerFrom(msg, this.physAddr);
      if (msg.opcode === "STANDBY") this.tvOn = false;
      if (msg.opcode === "SET_STREAM_PATH" || msg.opcode === "ACTIVE_SOURCE") this.tvOn = true;
      const was = this.tvOn;
      if (msg.opcode === "REPORT_POWER_STATUS" && msg.from.startsWith("TV") && msg.status) {
        const on = tvPowerOn(msg.status);
        if (on !== null) this.tvOn = on;
        // The answer to our own poll shows up here too: only a change is news.
        if (was === false) return;
      }
      if (active === null) return;
      this.tell(active, msg.opcode);
      // The TV asked for us: say we're the active source so it switches input and stays there.
      if (active && msg.opcode === "SET_STREAM_PATH") void this.activeSource();
    };
    createInterface({ input: proc.stdout! }).on("line", (l) => handle(parser.line(l)));
    proc.on("exit", () => {
      handle(parser.flush());
      this.monitor = null;
      // No CAP_NET_ADMIN: say so once and get by on asking the TV (startPolling), rather than
      // starting the adapter over every few seconds.
      if (/root|permission|not permitted|EPERM/i.test(stderr)) {
        this.monitorRefused = true;
        this.log(`Can't watch the CEC bus (${stderr.trim().split("\n")[0]}); asking the TV for its power every ${POLL_MS / 1000} s instead. Run the box update to fix.`);
        return;
      }
      // The adapter may have been unplugged: set it up again once it's back.
      this.connected = false;
      this.later(5000);
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

  private async activeSource(): Promise<void> {
    if (!this.physAddr) return;
    await run("cec-ctl", ["-d", this.device, "--to", "15", "--active-source", `phys-addr=${this.physAddr}`], { timeout: 5000 }).catch((e: Error) => this.log(e.message));
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.poller) clearInterval(this.poller);
    this.monitor?.removeAllListeners("exit");
    this.monitor?.kill();
  }
}
