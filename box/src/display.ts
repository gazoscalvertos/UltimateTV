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

  constructor(private readonly log: (line: string) => void) {}

  async outputs(): Promise<Output[]> {
    const { stdout } = await run("kscreen-doctor", ["-j"], { timeout: 5000 });
    return parseOutputs(stdout);
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
      const mode = pickMode(tv.output.modes, tv.mode, fps);
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
          this.log(`No mode fits ${fps} fps at ${tv.mode.width}×${tv.mode.height} (${rates} Hz), and no variable refresh: expect judder`);
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
