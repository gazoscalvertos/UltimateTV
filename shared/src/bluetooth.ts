// Bluetooth on the TV box: headphones, speakers and game controllers (#102). The box talks to
// BlueZ through bluetoothctl; this file is what the TV and the phone both agree on.
//
// Two rules shape it. Sound to headphones is decoded PCM, because Dolby and DTS passthrough need
// the HDMI output held open for mpv alone and nothing can travel over Bluetooth that way. And
// controllers are just another trusted device: once paired and trusted, RetroArch and Moonlight
// pick them up themselves, so nothing here has to know about games.

/** What a Bluetooth device is, to pick its icon and decide whether it carries sound. */
export type BtKind = "headphones" | "speaker" | "controller" | "keyboard" | "mouse" | "phone" | "other";

/** One device the box has seen, nearby or remembered. */
export interface BtDevice {
  /** The address Bluetooh knows it by, upper case with colons ("A4:C1:38:1B:2C:3D"). */
  address: string;
  /** The name it advertises, as the box shows it. */
  name: string;
  kind: BtKind;
  /** The box remembers it (it will reconnect on its own). */
  paired: boolean;
  /** It's connected to the box right now. */
  connected: boolean;
  /** It's allowed to connect on its own (what "pair and trust in one press" adds). */
  trusted: boolean;
  /** Bluetooth's own icon name, kept so a wrong guess can be seen ("audio-card", "input-gaming"). */
  icon?: string;
  /** The battery percentage, when the device reports one. */
  battery?: number;
}

/** Everything the Bluetooth screen shows. */
export interface BtState {
  /** The box has a Bluetooth adapter and can use it. */
  available: boolean;
  /** The adapter is switched on. */
  powered: boolean;
  /** A scan is running now. */
  scanning: boolean;
  /** Devices near the box, and devices it remembers (connected first, then paired, then the rest). */
  devices: BtDevice[];
  /** Where the sound is going: the TV, or a pair of headphones or a speaker. */
  output: { kind: "tv" } | { kind: "bluetooth"; address: string; name: string };
  /** The audio delay, in milliseconds, that lines the sound up with the picture (#102's lip-sync setting). */
  delayMs: number;
  /** Why Bluetooth can't be used, when it can't ("No Bluetooth adapter on the box"). */
  reason?: string;
}

/** What the TV and the phone ask the box to do. */
export type BtAction =
  | { do: "status" }
  | { do: "power"; on: boolean }
  | { do: "scan"; on: boolean }
  | { do: "pair"; address: string }
  | { do: "connect"; address: string }
  | { do: "disconnect"; address: string }
  | { do: "forget"; address: string }
  /** Send the sound back to the TV, leaving the headphones connected. */
  | { do: "useTv" }
  /** Line the sound up with the picture: negative plays it earlier. */
  | { do: "delay"; ms: number };

/** How far the audio delay can be moved either way. */
export const BT_DELAY_LIMIT_MS = 5_000;
/** How long a scan runs before it stops on its own. */
export const BT_SCAN_MS = 20_000;
/** Where "pair and trust in one press" puts a device, so it reconnects by itself next time. */
export const BT_CONTROLLER_KINDS: BtKind[] = ["controller", "keyboard", "mouse"];
/** Devices that carry sound: connecting one moves the sound to it. */
export const BT_AUDIO_KINDS: BtKind[] = ["headphones", "speaker"];

/** Bluetooth addresses are upper case with colons, so two spellings of one device match. */
export function cleanBtAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const address = raw.trim().toUpperCase();
  return /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(address) ? address : null;
}

/**
 * What a device is, from Bluetooth's icon name and its advertised name. The icon is the better
 * clue; the name catches a device that advertises nothing useful ("Xbox Wireless Controller").
 */
export function btKind(icon: string | undefined, name: string): BtKind {
  const i = (icon ?? "").toLowerCase();
  const n = name.toLowerCase();
  if (i === "input-gaming" || /\b(controller|gamepad|joy-?con|xbox|dualsense|dualshock|switch pro)\b/.test(n)) return "controller";
  if (i === "input-keyboard" || /\bkeyboard\b/.test(n)) return "keyboard";
  if (i === "input-mouse" || /\bmouse\b/.test(n)) return "mouse";
  if (i === "audio-headphones" || i === "audio-headset" || /\b(headphones?|headset|earbuds?|airpods|buds)\b/.test(n)) return "headphones";
  if (i === "audio-card" || i === "audio-speakers" || /\b(speaker|soundbar|sound ?bar|boombox)\b/.test(n)) return "speaker";
  if (i === "phone" || /\b(phone|iphone|android|pixel|galaxy)\b/.test(n)) return "phone";
  return "other";
}

/** Whether a device carries sound, so connecting it should move the sound to it. */
export function btCarriesSound(d: BtDevice): boolean {
  return BT_AUDIO_KINDS.includes(d.kind);
}

/** The sound device: a connected device that carries sound, if there is one. */
export function btAudioDevice(devices: BtDevice[]): BtDevice | null {
  return devices.find((d) => d.connected && btCarriesSound(d)) ?? null;
}

/**
 * The order the list is shown in: what's connected, then what the box remembers, then the rest,
 * each sorted by name so a scan doesn't make the list jump about.
 */
export function btSort(devices: BtDevice[]): BtDevice[] {
  const rank = (d: BtDevice) => (d.connected ? 0 : d.paired ? 1 : 2);
  return [...devices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

/** What the action row for a device offers, as labels the TV and the phone both use. */
export function btActions(d: BtDevice): { do: "pair" | "connect" | "disconnect" | "forget"; label: string }[] {
  if (d.connected) return [{ do: "disconnect", label: "Disconnect" }, { do: "forget", label: "Forget" }];
  if (d.paired) return [{ do: "connect", label: "Connect" }, { do: "forget", label: "Forget" }];
  return [{ do: "pair", label: "Pair" }];
}

/** The line under a device's name in a list. */
export function btSubtitle(d: BtDevice): string {
  const kind = d.kind === "other" ? "Device" : d.kind.charAt(0).toUpperCase() + d.kind.slice(1);
  const state = d.connected ? (btCarriesSound(d) ? "Connected · sound is here" : "Connected") : d.paired ? "Paired" : "Nearby";
  const battery = d.battery !== undefined ? ` · ${d.battery}%` : "";
  return `${kind} · ${state}${battery}`;
}

/** Clamp and round an audio delay to whole milliseconds within what mpv can take. */
export function cleanBtDelay(raw: unknown): number {
  const ms = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 0;
  return Math.max(-BT_DELAY_LIMIT_MS, Math.min(BT_DELAY_LIMIT_MS, ms));
}

/** A delay as it's said out loud: "No delay", "80 ms later", "60 ms earlier". */
export function btDelayLabel(ms: number): string {
  if (!ms) return "No delay";
  return ms > 0 ? `${ms} ms later` : `${-Math.abs(ms)} ms earlier`;
}

/** An action as the phone sends it, checked before the box acts on it. */
export function cleanBtAction(raw: unknown): BtAction | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const address = cleanBtAddress(o.address);
  switch (o.do) {
    case "status":
      return { do: "status" };
    case "power":
      return { do: "power", on: Boolean(o.on) };
    case "scan":
      return { do: "scan", on: Boolean(o.on) };
    case "pair":
    case "connect":
    case "disconnect":
    case "forget":
      return address ? { do: o.do, address } : null;
    case "useTv":
      return { do: "useTv" };
    case "delay":
      return { do: "delay", ms: cleanBtDelay(o.ms) };
    default:
      return null;
  }
}
