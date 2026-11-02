import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BT_DELAY_LIMIT_MS, btActions, btAudioDevice, btDelayLabel, btKind, btSort, btSubtitle, cleanBtAction, cleanBtAddress, cleanBtDelay } from "@ultimatetv/shared";
import { Bluetooth, bluezSink, parseController, parseDevices, parseInfo, type Runner } from "../src/bluetooth.js";

describe("reading bluetoothctl's output", () => {
  it("lists the devices, ignoring the heading and keeping an unknown name", () => {
    const out = [
      "Controller A4:C1:38:00:00:01 box (public)",
      "",
      "Device A4:C1:38:1B:2C:3D WH-1000XM4",
      "Device 6C:19:C0:AA:BB:CC ",
    ].join("\n");
    expect(parseDevices(out)).toEqual([
      { address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4" },
      { address: "6C:19:C0:AA:BB:CC", name: "6C:19:C0:AA:BB:CC" },
    ]);
  });

  it("puts addresses in upper case so two spellings of one device match", () => {
    expect(parseDevices("Device a4:c1:38:1b:2c:3d Headphones")[0]!.address).toBe("A4:C1:38:1B:2C:3D");
  });

  it("reads one device's info block", () => {
    const info = parseInfo(
      [
        "Device A4:C1:38:1B:2C:3D (public)",
        "\tName: WH-1000XM4",
        "\tAlias: WH-1000XM4",
        "\tClass: 0x00240408",
        "\tIcon: audio-headphones",
        "\tPaired: yes",
        "\tTrusted: yes",
        "\tConnected: yes",
        "\tBattery Percentage: 0x64 (100)",
      ].join("\n"),
    );
    expect(info).toEqual({ address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4", icon: "audio-headphones", paired: true, trusted: true, connected: true, battery: 100 });
  });

  it("reads a controller's info, where only some fields are there", () => {
    const info = parseInfo(["Device 6C:19:C0:AA:BB:CC (public)", "\tName: Xbox Wireless Controller", "\tIcon: input-gaming", "\tPaired: yes", "\tTrusted: no", "\tConnected: no"].join("\n"));
    expect(info.paired).toBe(true);
    expect(info.trusted).toBe(false);
    expect(info.connected).toBe(false);
    expect(info.icon).toBe("input-gaming");
    expect(info.battery).toBeUndefined();
  });

  it("falls back to the alias when BlueZ prints no name", () => {
    expect(parseInfo("Device A4:C1:38:1B:2C:3D (public)\n\tAlias: Kitchen speaker").name).toBe("Kitchen speaker");
  });

  it("reads the controller, and says so when the box has no adapter", () => {
    expect(parseController("Controller A4:C1:38:00:00:01 (public)\n\tPowered: yes\n\tDiscovering: no")).toEqual({ available: true, powered: true, discovering: false });
    expect(parseController("Controller A4:C1:38:00:00:01 (public)\n\tPowered: no\n\tDiscovering: yes")).toEqual({ available: true, powered: false, discovering: true });
    expect(parseController("No default controller available")).toEqual({ available: false, powered: false, discovering: false, reason: "No Bluetooth adapter on the box" });
  });

  it("names the PipeWire sink BlueZ creates for a device", () => {
    const sinks = ["alsa_output.pci-0000_00_1f.3.hdmi-stereo", "bluez_output.A4_C1_38_1B_2C_3D.1"];
    expect(bluezSink("A4:C1:38:1B:2C:3D", sinks)).toBe("bluez_output.A4_C1_38_1B_2C_3D.1");
    expect(bluezSink("00:11:22:33:44:55", sinks)).toBeNull();
  });
});

describe("what a device is", () => {
  it("goes by the icon first", () => {
    expect(btKind("audio-headphones", "WH-1000XM4")).toBe("headphones");
    expect(btKind("audio-card", "Kitchen")).toBe("speaker");
    expect(btKind("input-gaming", "Wireless Controller")).toBe("controller");
    expect(btKind("input-keyboard", "MX Keys")).toBe("keyboard");
    expect(btKind("input-mouse", "MX Master")).toBe("mouse");
    expect(btKind("phone", "Pixel 8")).toBe("phone");
  });

  it("falls back to the name when there's no useful icon", () => {
    expect(btKind(undefined, "Xbox Wireless Controller")).toBe("controller");
    expect(btKind("", "Sony WH-1000XM4 Headphones")).toBe("headphones");
    expect(btKind(undefined, "Living Room Speaker")).toBe("speaker");
    expect(btKind(undefined, "DualSense Wireless Controller")).toBe("controller");
  });

  it("calls anything else a device", () => {
    expect(btKind(undefined, "Mystery")).toBe("other");
    expect(btKind("computer", "Laptop")).toBe("other");
  });

  it("moves the sound only for headphones and speakers", () => {
    const headphones = { address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4", kind: "headphones" as const, paired: true, connected: true, trusted: true };
    const controller = { address: "6C:19:C0:AA:BB:CC", name: "Xbox", kind: "controller" as const, paired: true, connected: true, trusted: true };
    expect(btAudioDevice([controller, headphones])).toBe(headphones);
    expect(btAudioDevice([controller])).toBeNull();
    expect(btAudioDevice([])).toBeNull();
  });

  it("shows connected devices first, then remembered ones, then nearby ones by name", () => {
    const d = (name: string, connected: boolean, paired: boolean) => ({ address: `AA:BB:CC:DD:EE:${name.length.toString().padStart(2, "0")}`, name, kind: "other" as const, connected, paired, trusted: false });
    const sorted = btSort([d("Nearby B", false, false), d("Remembered", false, true), d("Connected", true, true), d("Nearby A", false, false)]);
    expect(sorted.map((x) => x.name)).toEqual(["Connected", "Remembered", "Nearby A", "Nearby B"]);
  });
});

describe("what a device's row says and offers", () => {
  const base = { address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4" };
  it("offers connect and forget for a remembered device, pair for a new one", () => {
    expect(btActions({ ...base, kind: "headphones", paired: false, connected: false, trusted: false }).map((a) => a.do)).toEqual(["pair"]);
    expect(btActions({ ...base, kind: "headphones", paired: true, connected: false, trusted: true }).map((a) => a.do)).toEqual(["connect", "forget"]);
    expect(btActions({ ...base, kind: "headphones", paired: true, connected: true, trusted: true }).map((a) => a.do)).toEqual(["disconnect", "forget"]);
  });

  it("says where the sound is when headphones are connected", () => {
    expect(btSubtitle({ ...base, kind: "headphones", paired: true, connected: true, trusted: true })).toBe("Headphones · Connected · sound is here");
    expect(btSubtitle({ ...base, kind: "controller", paired: true, connected: true, trusted: true })).toBe("Controller · Connected");
    expect(btSubtitle({ ...base, kind: "speaker", paired: true, connected: false, trusted: true, battery: 60 })).toBe("Speaker · Paired · 60%");
    expect(btSubtitle({ ...base, kind: "other", paired: false, connected: false, trusted: false })).toBe("Device · Nearby");
  });
});

describe("the audio delay", () => {
  it("stays within what mpv takes", () => {
    expect(cleanBtDelay(-99_999)).toBe(-BT_DELAY_LIMIT_MS);
    expect(cleanBtDelay(99_999)).toBe(BT_DELAY_LIMIT_MS);
    expect(cleanBtDelay(83.6)).toBe(84);
    expect(cleanBtDelay("80")).toBe(0);
    expect(cleanBtDelay(Number.NaN)).toBe(0);
  });

  it("is said out loud", () => {
    expect(btDelayLabel(0)).toBe("No delay");
    expect(btDelayLabel(80)).toBe("80 ms later");
    expect(btDelayLabel(-60)).toBe("-60 ms earlier");
  });
});

describe("an action from the phone", () => {
  it("is checked before the box acts on it", () => {
    expect(cleanBtAction({ do: "pair", address: "a4:c1:38:1b:2c:3d" })).toEqual({ do: "pair", address: "A4:C1:38:1B:2C:3D" });
    expect(cleanBtAction({ do: "pair", address: "not an address" })).toBeNull();
    expect(cleanBtAction({ do: "delay", ms: 99_999 })).toEqual({ do: "delay", ms: BT_DELAY_LIMIT_MS });
    expect(cleanBtAction({ do: "useTv" })).toEqual({ do: "useTv" });
    expect(cleanBtAction({ do: "scan", on: 1 })).toEqual({ do: "scan", on: true });
    expect(cleanBtAction({ do: "explode" })).toBeNull();
    expect(cleanBtAction(null)).toBeNull();
  });

  it("only accepts real addresses", () => {
    expect(cleanBtAddress("a4:c1:38:1b:2c:3d")).toBe("A4:C1:38:1B:2C:3D");
    expect(cleanBtAddress("A4-C1-38-1B-2C-3D")).toBeNull();
    expect(cleanBtAddress(42)).toBeNull();
  });
});

// A fake bluetoothctl/pactl: the box's devices are whatever the test sets.
class FakeRun implements Runner {
  controller = "Controller A4:C1:38:00:00:01 (public)\n\tPowered: yes\n\tDiscovering: no";
  devices: Record<string, string> = {};
  info: Record<string, string> = {};
  sinks = ["alsa_output.pci-0000_00_1f.3.hdmi-stereo"];
  defaultSink = "alsa_output.pci-0000_00_1f.3.hdmi-stereo";
  calls: string[] = [];
  fail: Record<string, string> = {};
  /** While this is set, a scan runs until it's released (a real one runs for 20 s). */
  holdScan: { promise: Promise<void>; release: () => void } | null = null;

  /** A callable runner: the module takes the function itself, not an object with `run` on it. */
  run: Runner = async (cmd, args, _opts) => {
    this.calls.push(`${cmd} ${args.join(" ")}`.trim());
    const verb = args[0] ?? "";
    if (this.fail[verb]) throw new Error(this.fail[verb]);
    if (cmd === "pactl") {
      if (verb === "list") return { stdout: this.sinks.map((s, i) => `${i}\t${s}\tmodule\tidle`).join("\n"), stderr: "" };
      if (verb === "get-default-sink") return { stdout: `${this.defaultSink}\n`, stderr: "" };
      if (verb === "set-default-sink") {
        this.defaultSink = args[1]!;
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }
    if (args.includes("scan") && args.includes("on") && this.holdScan) await this.holdScan.promise;
    if (verb === "show") return { stdout: this.controller, stderr: "" };
    if (verb === "devices") return { stdout: Object.entries(this.devices).map(([a, n]) => `Device ${a} ${n}`).join("\n"), stderr: "" };
    if (verb === "info") return { stdout: this.info[args[1]!] ?? `Device ${args[1]}\n\tPaired: no\n\tConnected: no\n`, stderr: "" };
    return { stdout: "", stderr: "" };
  };
}

describe("the box's Bluetooth module", () => {
  let dir: string;
  let fake: FakeRun;
  let sinks: (string | null)[];
  let pcm: boolean[];
  let delays: number[];
  let changes: number;

  const make = () =>
    new Bluetooth({
      stateFile: path.join(dir, "bluetooth.json"),
      log: () => undefined,
      useSink: async (sink) => void sinks.push(sink),
      setPcm: (on) => void pcm.push(on),
      setAudioDelay: (s) => void delays.push(s),
      onChange: () => void changes++,
      exec: fake.run,
      pollMs: 0,
    });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "utv-bt-"));
    fake = new FakeRun();
    sinks = [];
    pcm = [];
    delays = [];
    changes = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("says the box has no adapter when bluetoothctl does not", async () => {
    fake.controller = "No default controller available";
    const state = await make().refresh();
    expect(state.available).toBe(false);
    expect(state.reason).toBe("No Bluetooth adapter on the box");
    expect(state.devices).toEqual([]);
  });

  it("lists remembered and nearby devices", async () => {
    fake.devices = { "A4:C1:38:1B:2C:3D": "WH-1000XM4", "6C:19:C0:AA:BB:CC": "Xbox" };
    fake.info = {
      "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tTrusted: yes\n\tConnected: no",
      "6C:19:C0:AA:BB:CC": "Device 6C:19:C0:AA:BB:CC\n\tIcon: input-gaming\n\tPaired: no\n\tConnected: no",
    };
    const state = await make().refresh();
    expect(state.available).toBe(true);
    expect(state.powered).toBe(true);
    expect(state.devices.map((d) => [d.name, d.kind, d.paired])).toEqual([
      ["WH-1000XM4", "headphones", true],
      ["Xbox", "controller", false],
    ]);
  });

  it("moves the sound to headphones when they connect, and decodes it", async () => {
    fake.devices = { "A4:C1:38:1B:2C:3D": "WH-1000XM4" };
    fake.info = { "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tConnected: yes" };
    fake.sinks.push("bluez_output.A4_C1_38_1B_2C_3D.1");
    const state = await make().refresh();
    expect(state.output).toEqual({ kind: "bluetooth", address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4" });
    expect(sinks).toEqual(["bluez_output.A4_C1_38_1B_2C_3D.1"]);
    expect(pcm).toEqual([true]);
  });

  it("puts the sound back on the TV when the headphones go, and hands Dolby back", async () => {
    fake.devices = { "A4:C1:38:1B:2C:3D": "WH-1000XM4" };
    fake.info = { "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tConnected: yes" };
    fake.sinks.push("bluez_output.A4_C1_38_1B_2C_3D.1");
    const bt = make();
    await bt.refresh();
    sinks = [];
    pcm = [];
    fake.info = { "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tConnected: no" };
    const state = await bt.refresh();
    expect(state.output).toEqual({ kind: "tv" });
    expect(pcm).toEqual([false]);
    // Back to the sink that was the default before the headphones came.
    expect(sinks).toEqual(["alsa_output.pci-0000_00_1f.3.hdmi-stereo"]);
  });

  it("does not move the sound for a controller", async () => {
    fake.devices = { "6C:19:C0:AA:BB:CC": "Xbox" };
    fake.info = { "6C:19:C0:AA:BB:CC": "Device 6C:19:C0:AA:BB:CC\n\tIcon: input-gaming\n\tPaired: yes\n\tConnected: yes" };
    const state = await make().refresh();
    expect(state.output).toEqual({ kind: "tv" });
    expect(sinks).toEqual([]);
  });

  it("pairs, trusts and connects in one press", async () => {
    fake.devices = { "6C:19:C0:AA:BB:CC": "Xbox" };
    fake.info = { "6C:19:C0:AA:BB:CC": "Device 6C:19:C0:AA:BB:CC\n\tIcon: input-gaming\n\tPaired: yes\n\tTrusted: yes\n\tConnected: yes" };
    await make().act({ do: "pair", address: "6C:19:C0:AA:BB:CC" });
    expect(fake.calls).toContain("bluetoothctl pair 6C:19:C0:AA:BB:CC");
    expect(fake.calls).toContain("bluetoothctl trust 6C:19:C0:AA:BB:CC");
    expect(fake.calls).toContain("bluetoothctl connect 6C:19:C0:AA:BB:CC");
  });

  it("forgets a device", async () => {
    await make().act({ do: "forget", address: "6C:19:C0:AA:BB:CC" });
    expect(fake.calls).toContain("bluetoothctl remove 6C:19:C0:AA:BB:CC");
  });

  it("sends the sound back to the TV on request, leaving the headphones connected", async () => {
    fake.devices = { "A4:C1:38:1B:2C:3D": "WH-1000XM4" };
    fake.info = { "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tConnected: yes" };
    fake.sinks.push("bluez_output.A4_C1_38_1B_2C_3D.1");
    const bt = make();
    await bt.refresh();
    // The household asks for the TV's own sound, and the headphones stay connected: the sound
    // stays on the TV rather than the next poll moving it back.
    const state = await bt.act({ do: "useTv" });
    expect(sinks).toContain("alsa_output.pci-0000_00_1f.3.hdmi-stereo");
    expect(state.output).toEqual({ kind: "tv" });
    await bt.refresh();
    expect(sinks.at(-1)).toBe("alsa_output.pci-0000_00_1f.3.hdmi-stereo");
  });

  it("moves the sound to headphones that reconnect after the TV was asked for", async () => {
    fake.devices = { "A4:C1:38:1B:2C:3D": "WH-1000XM4" };
    fake.info = { "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tConnected: yes" };
    fake.sinks.push("bluez_output.A4_C1_38_1B_2C_3D.1");
    const bt = make();
    await bt.refresh();
    await bt.act({ do: "useTv" });
    // They go away, then come back: they asked for the TV once, not for ever.
    fake.info = { "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tConnected: no" };
    await bt.refresh();
    fake.info = { "A4:C1:38:1B:2C:3D": "Device A4:C1:38:1B:2C:3D\n\tIcon: audio-headphones\n\tPaired: yes\n\tConnected: yes" };
    const state = await bt.refresh();
    expect(state.output).toEqual({ kind: "bluetooth", address: "A4:C1:38:1B:2C:3D", name: "WH-1000XM4" });
  });

  it("keeps the audio delay, and remembers it next time", async () => {
    const bt = make();
    await bt.act({ do: "delay", ms: 120 });
    expect(bt.state ? (await bt.state()).delayMs : 0).toBe(120);
    expect(delays).toContain(0.12);
    const saved = JSON.parse(readFileSync(path.join(dir, "bluetooth.json"), "utf8")) as { delayMs: number };
    expect(saved.delayMs).toBe(120);
    const again = make();
    expect((await again.state()).delayMs).toBe(120);
    expect(delays.at(-1)).toBe(0.12);
  });

  it("starts a scan and stops it again", async () => {
    const bt = make();
    let release = () => undefined as void;
    fake.holdScan = { promise: new Promise<void>((r) => (release = r)), release: () => release() };
    await bt.scan(true);
    expect(fake.calls.some((c) => c.includes("scan on"))).toBe(true);
    expect((await bt.state()).scanning).toBe(true);
    expect(fake.calls.some((c) => c.includes("scan off") || c.includes("scan on"))).toBe(true);
    fake.holdScan.release();
    fake.holdScan = null;
    await bt.scan(false);
    expect((await bt.state()).scanning).toBe(false);
    bt.stop();
  });

  it("turns the adapter on and off", async () => {
    await make().act({ do: "power", on: false });
    expect(fake.calls).toContain("bluetoothctl power off");
  });

  it("says what changed only when something did", async () => {
    fake.devices = { "6C:19:C0:AA:BB:CC": "Xbox" };
    fake.info = { "6C:19:C0:AA:BB:CC": "Device 6C:19:C0:AA:BB:CC\n\tIcon: input-gaming" };
    const bt = make();
    await bt.refresh();
    const first = changes;
    await bt.refresh();
    expect(changes).toBe(first);
  });

  it("carries on when bluetoothctl fails", async () => {
    fake.fail = { devices: "Failed to connect to bus" };
    const state = await make().refresh();
    expect(state.available).toBe(true);
    expect(state.devices).toEqual([]);
  });
});
