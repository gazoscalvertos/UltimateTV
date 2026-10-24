// The TV's picture mode, through KDE's kscreen-doctor: match the refresh rate to each film's
// frame rate (no judder on 24p), and turn HDR on for HDR video so the TV switches into its HDR
// picture mode. Everything is put back when playback stops.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Mode {
  id: string;
  width: number;
  height: number;
  refreshRate: number;
}

export interface Output {
  name: string;
  enabled: boolean;
  connected: boolean;
  currentModeId: string;
  modes: Mode[];
  hdr?: boolean;
  hdrCapable?: boolean;
  /** Variable refresh rate (FreeSync/VRR), and KWin's policy for it: never, always or automatic. */
  vrrCapable?: boolean;
  vrrPolicy?: VrrPolicy;
}

export type VrrPolicy = "never" | "always" | "automatic";
const VRR_POLICIES: VrrPolicy[] = ["never", "always", "automatic"];
/** libkscreen's capability flags, when kscreen-doctor gives them as a number. */
const CAP_VRR = 0x2;
const CAP_HDR = 0x8;

/** Reads `kscreen-doctor -j`. Shapes vary a little between Plasma releases, so this is forgiving. */
export function parseOutputs(json: string): Output[] {
  const data = JSON.parse(json) as { outputs?: Record<string, unknown>[] };
  return (data.outputs ?? []).map((o) => {
    const modes = ((o.modes as Record<string, unknown>[]) ?? []).map((m) => {
      const size = (m.size as { width?: number; height?: number }) ?? {};
      return { id: String(m.id), width: Number(size.width ?? 0), height: Number(size.height ?? 0), refreshRate: Number(m.refreshRate ?? 0) };
    });
    const out: Output = { name: String(o.name), enabled: Boolean(o.enabled), connected: Boolean(o.connected), currentModeId: String(o.currentModeId ?? ""), modes };
    if (typeof o.hdr === "boolean") out.hdr = o.hdr;
    else if (o.hdr && typeof o.hdr === "object" && "enabled" in o.hdr) out.hdr = Boolean((o.hdr as { enabled: unknown }).enabled);
    // Capabilities come as a list of names or as libkscreen's bit flags, depending on the release.
    if (Array.isArray(o.capabilities) && o.capabilities.length) {
      const caps = (o.capabilities as unknown[]).map(String);
      out.hdrCapable = caps.some((c) => /hdr|highdynamicrange/i.test(c));
      out.vrrCapable = caps.some((c) => /vrr|variablerefresh|adaptivesync/i.test(c));
    } else if (typeof o.capabilities === "number") {
      out.hdrCapable = Boolean(o.capabilities & CAP_HDR);
      out.vrrCapable = Boolean(o.capabilities & CAP_VRR);
    }
    const policy = o.vrrPolicy ?? o.vrrpolicy;
    if (typeof policy === "number" && VRR_POLICIES[policy]) out.vrrPolicy = VRR_POLICIES[policy];
    else if (typeof policy === "string" && VRR_POLICIES.includes(policy.toLowerCase() as VrrPolicy)) out.vrrPolicy = policy.toLowerCase() as VrrPolicy;
    return out;
  });
}

type OutputCaps = Pick<Output, "vrrCapable" | "vrrPolicy" | "hdrCapable" | "hdr">;

/**
 * Variable refresh and HDR as `kscreen-doctor -o` lists them ("Vrr: incapable", "Vrr: Automatic",
 * "HDR: enabled"). Some Plasma releases leave both out of the JSON, so this fills the gaps.
 */
export function parseOutputText(text: string): Map<string, OutputCaps> {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  const out = new Map<string, OutputCaps>();
  for (const block of plain.split(/(?=^Output:)/m)) {
    const name = /^Output:\s+\S+\s+(\S+)/.exec(block)?.[1];
    if (!name) continue;
    const info: OutputCaps = {};
    const vrr = /\bVrr:\s*(\w+)/i.exec(block)?.[1]?.toLowerCase();
    if (vrr === "incapable") info.vrrCapable = false;
    else if (vrr && VRR_POLICIES.includes(vrr as VrrPolicy)) {
      info.vrrCapable = true;
      info.vrrPolicy = vrr as VrrPolicy;
    }
    const hdr = /\bHDR:\s*(\w+)/.exec(block)?.[1]?.toLowerCase();
    if (hdr === "incapable") info.hdrCapable = false;
    else if (hdr === "enabled" || hdr === "disabled") {
      info.hdrCapable = true;
      info.hdr = hdr === "enabled";
    }
    out.set(name, info);
  }
  return out;
}

/**
 * The best mode for a frame rate at the current resolution: an exact multiple of the frame rate,
 * preferring 23.976/24 Hz for film and 50/59.94 Hz for TV-rate video. Null when nothing fits.
 */
export function pickMode(modes: Mode[], current: Mode, fps: number): Mode | null {
  const same = modes.filter((m) => m.width === current.width && m.height === current.height);
  const fits = same
    .map((m) => ({ m, k: m.refreshRate / fps }))
    .filter(({ k }) => k >= 0.999 && Math.abs(k - Math.round(k)) < 0.001 * Math.round(k));
  if (!fits.length) return null;
  const film = fps < 24.5;
  fits.sort((a, b) => score(a.m.refreshRate, film) - score(b.m.refreshRate, film));
  return fits[0]!.m;
}

/**
 * A refresh rate to add as a custom mode when the screen has none that fits a frame rate: the
 * lowest whole multiple of it within the range of the modes the screen already has at this size,
 * so the screen is known to take its timing and the signal stays within what it and the cable
 * carry. 24p on a 50/60/100 Hz monitor gets 71.928 Hz, three refreshes a frame; a 60 Hz-only TV
 * gets nothing. Null when no multiple fits.
 */
export function customRate(modes: Mode[], current: Mode, fps: number): number | null {
  const rates = modes.filter((m) => m.width === current.width && m.height === current.height).map((m) => m.refreshRate);
  if (!rates.length) return null;
  const min = Math.min(...rates) - 0.01;
  const max = Math.max(...rates) + 0.01;
  for (let k = 1; fps * k <= max; k++) if (fps * k >= min) return Math.round(fps * k * 1000) / 1000;
  return null;
}

function score(hz: number, film: boolean): number {
  // Film: the frame rate itself (24p). TV-rate video: 50 or 59.94/60 is what TVs handle best,
  // then the lowest multiple above that.
  if (film) return hz;
  return hz >= 48 && hz <= 61 ? 0 : hz > 61 ? hz : 1000 - hz;
}

export class Display {
  private restoreMode: { output: string; modeId: string } | null = null;
  private restoreHdr: { output: string; on: boolean } | null = null;
  private restoreVrr: { output: string; policy: VrrPolicy } | null = null;

  /** Custom modes added since the box started, and those the screen wouldn't take (not tried again). */
  private readonly custom = new Set<string>();
  private readonly rejected = new Set<string>();

  /**
   * @param customModes add a custom mode when nothing fits a video and there's no variable refresh
   * (CUSTOM_MODES=0 in box.env turns it off). It stays in KWin's settings, so it's added only once.
   */
  constructor(
    private readonly log: (line: string) => void,
    private readonly customModes = true,
  ) {}

  async outputs(): Promise<Output[]> {
    const { stdout } = await run("kscreen-doctor", ["-j"], { timeout: 5000 });
    const outputs = parseOutputs(stdout);
    if (outputs.some((o) => o.vrrCapable === undefined || o.hdrCapable === undefined)) {
      const text = await run("kscreen-doctor", ["-o"], { timeout: 5000 })
        .then((r) => parseOutputText(r.stdout))
        .catch(() => new Map<string, OutputCaps>());
      for (const o of outputs) {
        const t = text.get(o.name);
        if (!t) continue;
        if (o.vrrCapable === undefined && t.vrrCapable !== undefined) o.vrrCapable = t.vrrCapable;
        if (o.vrrPolicy === undefined && t.vrrPolicy) o.vrrPolicy = t.vrrPolicy;
        if (o.hdrCapable === undefined && t.hdrCapable !== undefined) o.hdrCapable = t.hdrCapable;
        if (o.hdr === undefined && t.hdr !== undefined) o.hdr = t.hdr;
      }
    }
    return outputs;
  }

  /** The output the TV is on: the first connected, enabled one (the box has only the TV). */
  async tv(): Promise<{ output: Output; mode: Mode } | null> {
    const output = (await this.outputs().catch(() => [])).find((o) => o.connected && o.enabled);
    const mode = output?.modes.find((m) => m.id === output.currentModeId);
    return output && mode ? { output, mode } : null;
  }

  /**
   * Puts the screen in the right mode for a video. Returns how its frame rate is matched: "mode"
   * (a refresh rate that's a multiple of it), "vrr" (variable refresh, for screens with no such
   * mode, e.g. a 50/60/100 Hz monitor playing 24p film) or null (it isn't: expect judder).
   */
  async prepare(fps: number | undefined, hdr: boolean): Promise<"mode" | "vrr" | null> {
    const tv = await this.tv();
    if (!tv) return null;
    const args: string[] = [];
    let sync: "mode" | "vrr" | null = null;
    if (fps) {
      let mode = pickMode(tv.output.modes.filter((m) => !this.rejected.has(m.id)), tv.mode, fps);
      if (!mode && !tv.output.vrrCapable && this.customModes) mode = await this.addCustomMode(tv.output, tv.mode, fps);
      if (mode && mode.id !== tv.mode.id && this.custom.has(mode.id)) {
        // A new custom mode is only known to work once the screen has taken it.
        this.restoreMode ??= { output: tv.output.name, modeId: tv.mode.id };
        await this.apply([`output.${tv.output.name}.mode.${mode.id}`]);
        const now = await this.tv();
        if (now?.mode.id !== mode.id) {
          this.log(`The screen didn't take the ${mode.refreshRate} Hz mode: staying at ${tv.mode.refreshRate} Hz`);
          this.rejected.add(mode.id);
          mode = null;
        } else {
          tv.mode = now.mode;
        }
      }
      if (mode) {
        sync = "mode";
        if (mode.id !== tv.mode.id) {
          this.restoreMode ??= { output: tv.output.name, modeId: tv.mode.id };
          args.push(`output.${tv.output.name}.mode.${mode.id}`);
        }
      } else {
        const rates = [...new Set(tv.output.modes.filter((m) => m.width === tv.mode.width && m.height === tv.mode.height).map((m) => Math.round(m.refreshRate * 1000) / 1000))].join(", ");
        if (tv.output.vrrCapable) {
          sync = "vrr";
          this.log(`No mode fits ${fps} fps at ${tv.mode.width}×${tv.mode.height} (${rates} Hz): using variable refresh`);
          if (tv.output.vrrPolicy !== "always") {
            this.restoreVrr ??= { output: tv.output.name, policy: tv.output.vrrPolicy ?? "automatic" };
            args.push(`output.${tv.output.name}.vrrpolicy.always`);
          }
        } else {
          this.log(`No mode fits ${fps} fps at ${tv.mode.width}×${tv.mode.height} (${rates} Hz), and no variable refresh (capability ${tv.output.vrrCapable ?? "not reported"}): expect judder`);
        }
      }
    }
    if (tv.output.hdrCapable !== false && tv.output.hdr !== undefined && tv.output.hdr !== hdr) {
      this.restoreHdr ??= { output: tv.output.name, on: tv.output.hdr };
      args.push(`output.${tv.output.name}.hdr.${hdr ? "enable" : "disable"}`, `output.${tv.output.name}.wcg.${hdr ? "enable" : "disable"}`);
    }
    if (args.length) await this.apply(args);
    return sync;
  }

  /**
   * Adds a reduced-blanking custom mode at a whole multiple of the frame rate (see customRate) and
   * returns it, or null. Full blanking needs a faster signal, which this screen's driver refused.
   */
  private async addCustomMode(output: Output, current: Mode, fps: number): Promise<Mode | null> {
    const hz = customRate(output.modes, current, fps);
    if (!hz) return null;
    const before = new Set(output.modes.map((m) => m.id));
    this.log(`No mode fits ${fps} fps and there's no variable refresh: adding a ${hz} Hz mode`);
    await this.apply([`output.${output.name}.addCustomMode.${current.width}.${current.height}.${Math.round(hz * 1000)}.reduced`]);
    const after = (await this.outputs().catch(() => [])).find((o) => o.name === output.name);
    const added = after?.modes.find((m) => !before.has(m.id) && m.width === current.width && m.height === current.height && Math.abs(m.refreshRate - hz) / hz < 0.002);
    if (!added) {
      this.log("The custom mode didn't appear");
      return null;
    }
    this.custom.add(added.id);
    output.modes = after!.modes;
    return pickMode([added], current, fps);
  }

  async restore(): Promise<void> {
    const args: string[] = [];
    if (this.restoreVrr) args.push(`output.${this.restoreVrr.output}.vrrpolicy.${this.restoreVrr.policy}`);
    this.restoreVrr = null;
    if (this.restoreMode) args.push(`output.${this.restoreMode.output}.mode.${this.restoreMode.modeId}`);
    if (this.restoreHdr) args.push(`output.${this.restoreHdr.output}.hdr.${this.restoreHdr.on ? "enable" : "disable"}`, `output.${this.restoreHdr.output}.wcg.${this.restoreHdr.on ? "enable" : "disable"}`);
    this.restoreMode = null;
    this.restoreHdr = null;
    if (args.length) await this.apply(args);
  }

  private async apply(args: string[]): Promise<void> {
    this.log(`kscreen-doctor ${args.join(" ")}`);
    await run("kscreen-doctor", args, { timeout: 10_000 }).catch((e: Error) => this.log(`kscreen-doctor failed: ${e.message}`));
  }
}
