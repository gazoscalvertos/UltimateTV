// Bluetooth on the box: headphones, speakers and game controllers, through BlueZ's bluetoothctl.
//
// Sound to headphones is decoded (PCM): Dolby and DTS passthrough needs the HDMI output held open
// for mpv alone, and nothing can travel over Bluetooth that way. So connecting a pair of headphones
// moves the sound to it and takes passthrough off; disconnecting puts both back. Controllers are
// just trusted devices — RetroArch and Moonlight find them on their own.
//
// The box has no battery to save, so a cheap poll every 15 s is what notices a headset being
// switched on; nothing polls while no audio device is paired.

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { BT_SCAN_MS, cleanBtDelay, btKind, type BtAction, type BtDevice, type BtState } from "@ultimatetv/shared";

const run = promisify(execFile);

/** How often the box looks for a headset being switched on or off. */
export const POLL_MS = 15_000;
/** A bluetoothctl call that hangs is given up on after this long. */
const CALL_TIMEOUT_MS = 15_000;

export interface Runner {
  (cmd: string, args: string[], opts: { timeout: number }): Promise<{ stdout: string; stderr: string }>;
}

/** One device's "bluetoothctl info" block. */
export interface BtInfo {
  address?: string;
  name?: string;
  icon?: string;
  paired?: boolean;
  connected?: boolean;
  trusted?: boolean;
  battery?: number;
}

/** One line of "bluetoothctl devices": "Device AA:BB:CC:DD:EE:FF Living room TV". */
const DEVICE_LINE = /^Device ([0-9A-F]{2}(?::[0-9A-F]{2}){5}) ?(.*)$/i;

/** Every "Device AA:BB:CC:DD:EE:FF Name" line in a listing. */
export function parseDevices(text: string): { address: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = DEVICE_LINE.exec(line.trim());
    if (!m) continue;
    const address = m[1]!.toUpperCase();
    const name = (m[2] ?? "").trim() || address;
    if (!seen.has(address)) seen.set(address, name);
  }
  return [...seen].map(([address, name]) => ({ address, name }));
}

/** A "bluetoothctl info" block, which is a "Device AA:.." line then indented "Key: value" lines. */
export function parseInfo(text: string): BtInfo {
  const info: BtInfo = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = DEVICE_LINE.exec(line);
    if (head) {
      info.address = head[1]!.toUpperCase();
      // bluetoothctl puts the address type there, not a name: "Device A4:C1:..:3D (public)".
      const rest = (head[2] ?? "").trim();
      if (rest && !/^\((public|random|le|bredr)\)$/i.test(rest)) info.name = rest;
      continue;
    }
    const m = /^([A-Za-z][A-Za-z ]*?): (.+)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    const yes = value.toLowerCase() === "yes";
    if (key === "name" || key === "alias") info.name = info.name ?? value;
    else if (key === "icon") info.icon = value;
    else if (key === "paired") info.paired = info.paired || yes;
    else if (key === "connected") info.connected = info.connected || yes;
    else if (key === "trusted") info.trusted = info.trusted || yes;
    else if (key.startsWith("battery percentage")) {
      // Newer BlueZ: "Battery Percentage: 0x64 (100)"; older: "Battery Percentage: 0x64 (100)" too,
      // but a few versions print just the percentage.
      const pct = /\((\d+)\)/.exec(value)?.[1] ?? (/^\d+$/.test(value) ? value : undefined);
      if (pct !== undefined) info.battery = Math.max(0, Math.min(100, Number(pct)));
    }
  }
  return info;
}

/** The controller's own state from "bluetoothctl show". */
export function parseController(text: string): { available: boolean; powered: boolean; discovering: boolean; reason?: string } {
  if (/no default controller/i.test(text) || !/controller /i.test(text)) {
    return { available: false, powered: false, discovering: false, reason: "No Bluetooth adapter on the box" };
  }
  return {
    available: true,
    powered: /^\s*Powered: yes$/im.test(text),
    discovering: /^\s*Discovering: yes$/im.test(text),
  };
}

/**
 * The PipeWire/PulseAudio sink a connected device's sound comes out of, from "pactl list short
 * sinks". BlueZ's PipeWire sink is named after the address with underscores: bluez_output.A4_C1_38_1B_2C_3D.1
 */
export function bluezSink(address: string, sinks: string[]): string | null {
  const want = `bluez_output.${address.replace(/:/g, "_")}`.toUpperCase();
  return sinks.find((name) => name.toUpperCase().startsWith(want)) ?? null;
}

/** Turns what the box knows into a device with a kind and a state. */
export function btDevice(address: string, name: string, info: BtInfo): BtDevice {
  return {
    address,
    name: info.name ?? name,
    kind: btKind(info.icon, info.name ?? name),
    paired: Boolean(info.paired),
    connected: Boolean(info.connected),
    trusted: Boolean(info.trusted),
    ...(info.icon ? { icon: info.icon } : {}),
    ...(info.battery !== undefined ? { battery: info.battery } : {}),
  };
}

/** What the box has saved about Bluetooth between runs: the audio delay only. */
interface SavedBluetooth {
  delayMs?: number;
}

export interface BluetoothOptions {
  /** Where the audio delay is kept (a small JSON file on the box). */
  stateFile: string;
  log: (line: string) => void;
  /** Switches the sound to a PipeWire sink, or back to the TV's HDMI output (null). */
  useSink: (sink: string | null) => Promise<void>;
  /** Tells the player to decode for headphones (true) or hand Dolby and DTS back to the TV (false). */
  setPcm: (on: boolean) => void;
  /** Lines the sound up with the picture, in seconds (mpv's --audio-delay). */
  setAudioDelay: (seconds: number) => void;
  /** Called whenever the devices or the sound output change (the TV and phone screens refresh). */
  onChange?: (state: BtState) => void;
  exec?: Runner;
  /** The poll interval, overridden by tests. */
  pollMs?: number;
  now?: () => number;
}

/**
 * The Bluetooth side of the box. Every bluetoothctl call goes through one runner so the parsers and
 * the routing rules can be tested without any Bluetooth hardware.
 */
export class Bluetooth {
  private scanning = false;
  private scanChild: { kill: () => void } | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private devices: BtDevice[] = [];
  private available = true;
  private powered = false;
  private reason: string | undefined;
  private delayMs = 0;
  private output: BtState["output"] = { kind: "tv" };
  private previousSink: string | null = null;
  /** The household asked for the TV's own sound while headphones are still connected: keep it there. */
  private forcedTv = false;
  private stopped = false;
  private lastSignature = "";

  constructor(private readonly opts: BluetoothOptions) {
    try {
      const saved = JSON.parse(readFileSync(opts.stateFile, "utf8")) as SavedBluetooth;
      this.delayMs = cleanBtDelay(saved.delayMs);
    } catch {
      this.delayMs = 0;
    }
    opts.setAudioDelay(this.delayMs / 1000);
  }

  /** Starts watching for headphones being switched on and off. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.refresh().catch(() => undefined);
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.stopScan();
  }

  private schedule(): void {
    if (this.stopped || this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.refresh()
        .catch(() => undefined)
        .finally(() => this.schedule());
    }, this.opts.pollMs ?? POLL_MS);
    this.pollTimer.unref?.();
  }

  /** The bluetoothctl runner. Tests replace it with a fake. */
  private async call(args: string[]): Promise<string> {
    const exec = this.opts.exec ?? run;
    const { stdout } = await exec("bluetoothctl", args, { timeout: CALL_TIMEOUT_MS });
    return stdout;
  }

  private async sinkNames(): Promise<string[]> {
    const exec = this.opts.exec ?? run;
    const { stdout } = await exec("pactl", ["list", "short", "sinks"], { timeout: 5000 }).catch(() => ({ stdout: "", stderr: "" }));
    return stdout
      .split("\n")
      .map((line) => line.split("\t")[1]?.trim())
      .filter((name): name is string => Boolean(name));
  }

  private async readDevices(): Promise<BtDevice[]> {
    const listed = parseDevices(await this.call(["devices"]));
    const devices: BtDevice[] = [];
    for (const { address, name } of listed) {
      const info = parseInfo(await this.call(["info", address]).catch(() => ""));
      // A paired device is always listed; trust and pair come from info, which needs the call.
      devices.push(btDevice(address, name, info));
    }
    return devices;
  }

  /** What the screen shows: the controller, the devices and where the sound is. */
  async state(): Promise<BtState> {
    return {
      available: this.available,
      powered: this.powered,
      scanning: this.scanning,
      devices: this.devices,
      output: this.output,
      delayMs: this.delayMs,
      ...(this.reason ? { reason: this.reason } : {}),
    };
  }

  /** Reads the adapter and the devices, and moves the sound if headphones came or went. */
  async refresh(): Promise<BtState> {
    const controller = parseController(await this.call(["show"]).catch(() => ""));
    this.available = controller.available;
    this.powered = controller.powered;
    this.reason = controller.available ? undefined : controller.reason;
    if (!controller.available) {
      this.devices = [];
      await this.routeToTv().catch(() => undefined);
      return this.settle();
    }
    this.devices = await this.readDevices().catch(() => [] as BtDevice[]);
    const audio = this.devices.find((d) => d.connected && (d.kind === "headphones" || d.kind === "speaker"));
    // Nothing on Bluetooth carries sound any more, so whatever was asked for is over.
    if (!audio) this.forcedTv = false;
    if (audio && !this.forcedTv) await this.routeTo(audio).catch(() => undefined);
    else if (!audio) await this.routeToTv().catch(() => undefined);
    return this.settle();
  }

  /** Moves the sound to a connected pair of headphones or speaker, decoding it to PCM. */
  private async routeTo(device: BtDevice): Promise<void> {
    if (this.output.kind === "bluetooth" && this.output.address === device.address) return;
    const sink = bluezSink(device.address, await this.sinkNames());
    this.opts.log(`Sound: ${device.name} (${device.kind}) is connected, so it goes there`);
    // Passthrough can't cross Bluetooth, so decode from here on; done before the switch so the
    // first sounds don't try to push Dolby at a headset.
    this.opts.setPcm(true);
    if (sink) {
      if (!this.previousSink) this.previousSink = await this.defaultSink();
      await this.opts.useSink(sink);
    }
    this.output = { kind: "bluetooth", address: device.address, name: device.name };
  }

  /** Puts the sound back on the TV once nothing that carries sound is connected. */
  private async routeToTv(): Promise<void> {
    if (this.output.kind === "tv") return;
    this.opts.log("Sound: no headphones or speaker connected, so it goes back to the TV");
    this.opts.setPcm(false);
    await this.opts.useSink(this.previousSink);
    this.previousSink = null;
    this.output = { kind: "tv" };
  }

  private async defaultSink(): Promise<string | null> {
    const exec = this.opts.exec ?? run;
    const { stdout } = await exec("pactl", ["get-default-sink"], { timeout: 5000 }).catch(() => ({ stdout: "", stderr: "" }));
    return stdout.trim() || null;
  }

  /** Tells the screens what changed, only when something actually did. */
  private settle(): BtState {
    const state: BtState = {
      available: this.available,
      powered: this.powered,
      scanning: this.scanning,
      devices: this.devices,
      output: this.output,
      delayMs: this.delayMs,
      ...(this.reason ? { reason: this.reason } : {}),
    };
    const signature = JSON.stringify({ a: state.available, p: state.powered, s: state.scanning, d: state.devices, o: state.output, m: state.delayMs });
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      try {
        this.opts.onChange?.(state);
      } catch (e) {
        this.opts.log(`Bluetooth listener failed: ${(e as Error).message}`);
      }
    }
    return state;
  }

  /** Starts or stops a scan. The scan stops on its own after BT_SCAN_MS. */
  async scan(on: boolean): Promise<void> {
    if (on) {
      if (this.scanning) return;
      // Clear any scan already running first: stopScan also drops the flag, so it is set after.
      this.stopScan();
      this.scanning = true;
      const exec = this.opts.exec ?? run;
      void exec("bluetoothctl", ["--timeout", String(Math.round(BT_SCAN_MS / 1000)), "scan", "on"], { timeout: BT_SCAN_MS + 10_000 })
        .then(() => this.stopScan())
        .catch(() => this.stopScan());
      this.scanTimer = setTimeout(() => this.stopScan(), BT_SCAN_MS + 1000);
      this.scanTimer.unref?.();
    } else {
      await this.call(["scan", "off"]).catch(() => "");
      this.stopScan();
    }
    this.settle();
  }

  private stopScan(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this.scanChild?.kill();
    this.scanChild = null;
    this.scanning = false;
  }

  /** Pair and trust in one press: paired so the box remembers it, trusted so it reconnects by itself. */
  private async pair(address: string): Promise<void> {
    await this.call(["pair", address]);
    await this.call(["trust", address]).catch(() => "");
    // Controllers and headphones both want connecting now; a device that refuses keeps its pairing.
    await this.call(["connect", address]).catch(() => "");
  }

  /** Does what the TV or the phone asked, then reports the state it left behind. */
  async act(action: BtAction): Promise<BtState> {
    switch (action.do) {
      case "status":
        return this.state();
      case "power":
        await this.call(["power", action.on ? "on" : "off"]).catch((e: Error) => this.opts.log(`Bluetooth power: ${e.message}`));
        break;
      case "scan":
        await this.scan(action.on);
        break;
      case "pair":
        await this.pair(action.address).catch((e: Error) => this.opts.log(`Couldn't pair ${action.address}: ${e.message}`));
        break;
      case "connect":
        await this.call(["connect", action.address]).catch((e: Error) => this.opts.log(`Couldn't connect ${action.address}: ${e.message}`));
        break;
      case "disconnect":
        await this.call(["disconnect", action.address]).catch((e: Error) => this.opts.log(`Couldn't disconnect ${action.address}: ${e.message}`));
        break;
      case "forget":
        await this.call(["remove", action.address]).catch((e: Error) => this.opts.log(`Couldn't forget ${action.address}: ${e.message}`));
        break;
      case "useTv":
        // The headphones stay connected, so without this the next poll would move the sound back.
        this.forcedTv = true;
        await this.routeToTv().catch(() => undefined);
        break;
      case "delay":
        this.delayMs = cleanBtDelay(action.ms);
        this.opts.setAudioDelay(this.delayMs / 1000);
        this.save();
        break;
    }
    return this.refresh().catch(() => this.state());
  }

  private save(): void {
    try {
      writeFileSync(this.opts.stateFile, JSON.stringify({ delayMs: this.delayMs } satisfies SavedBluetooth));
    } catch (e) {
      this.opts.log(`Couldn't save the audio delay: ${(e as Error).message}`);
    }
  }
}
