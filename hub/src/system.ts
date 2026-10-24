import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface SystemReport {
  ffmpeg: string | null;
  hwaccels: string[];
  /** Device node for the iGPU (Quick Sync), present when /dev/dri is passed into the container. */
  renderNode: string | null;
  vaapi: {
    available: boolean;
    driver: string | null;
    /** e.g. "VAProfileAV1Profile0 : VAEntrypointVLD" — decode AV1 in hardware. */
    profiles: string[];
  };
  /** Plain answers to the Phase 0 questions. */
  checks: {
    av1HardwareDecode: boolean;
    hevcHardwareEncode: boolean;
    hevc10HardwareEncode: boolean;
  };
}

type Runner = (cmd: string, args: string[]) => Promise<string>;

const defaultRunner: Runner = async (cmd, args) => {
  const { stdout, stderr } = await run(cmd, args, { timeout: 10_000 });
  return `${stdout}\n${stderr}`;
};

const RENDER_NODES = ["/dev/dri/renderD128", "/dev/dri/renderD129"];

/** Checks ffmpeg and Quick Sync (VA-API) inside the container. Every probe tolerates the tool being missing. */
export async function systemReport(runner: Runner = defaultRunner): Promise<SystemReport> {
  const ffmpeg = await runner("ffmpeg", ["-hide_banner", "-version"]).then(
    (out) => out.split("\n")[0]?.trim() || null,
    () => null,
  );
  const hwaccels = await runner("ffmpeg", ["-hide_banner", "-hwaccels"]).then(
    (out) => out.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("Hardware acceleration methods")),
    () => [] as string[],
  );

  let renderNode: string | null = null;
  for (const node of RENDER_NODES) {
    if (await access(node).then(() => true, () => false)) {
      renderNode = node;
      break;
    }
  }

  const vainfoOut = renderNode
    ? await runner("vainfo", ["--display", "drm", "--device", renderNode]).catch(() => null)
    : null;
  const { profiles, driver } = parseVainfo(vainfoOut ?? "");

  const has = (profile: string, entrypoint: RegExp) =>
    profiles.some((p) => p.startsWith(`${profile} `) && entrypoint.test(p));

  return {
    ffmpeg,
    hwaccels,
    renderNode,
    vaapi: { available: profiles.length > 0, driver, profiles },
    checks: {
      av1HardwareDecode: has("VAProfileAV1Profile0", /VAEntrypointVLD/),
      hevcHardwareEncode: has("VAProfileHEVCMain", /VAEntrypointEncSlice/),
      hevc10HardwareEncode: has("VAProfileHEVCMain10", /VAEntrypointEncSlice/),
    },
  };
}

/** Pulls the driver name and "VAProfile… : VAEntrypoint…" lines out of vainfo output. */
export function parseVainfo(output: string): { driver: string | null; profiles: string[] } {
  const profiles = output
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter((l) => l.startsWith("VAProfile"));
  const driver = /Driver version:\s*(.+)/.exec(output)?.[1]?.trim() ?? null;
  return { driver, profiles };
}
