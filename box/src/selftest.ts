// The box's half of the on-box self-test (issue #105).
//
// Nothing is shipped as a binary: `tools/box/install.sh` already makes one test clip with ffmpeg for
// the update health check, so the same trick makes the self-test's clips on first use. Each clip is
// four seconds, 1080p or smaller and under a megabyte, and is regenerated only when missing — so a
// box with no network and no repo checkout can still run the whole thing after an update.
//
// The box does not decide pass or fail. It plays the clip, waits for mpv to settle, and reports the
// mode, the picture and the sound path it ended up in; the household answers the question and the UI
// records both. That keeps the judgement with the person watching the TV, which is the point: the
// same box can be right on one TV and wrong on another.

import { spawn } from "node:child_process";
import os from "node:os";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { type SelfTestId, type SelfTestPlayed, type SelfTestStep, SELF_TEST_STEPS } from "@ultimatetv/shared";
import type { Display } from "./display.js";
import type { Mpv } from "./mpv.js";
import type { Player } from "./player.js";

/** Where a box keeps its self-test clips when nothing else says where state lives. */
export function defaultSelftestDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(env.XDG_STATE_HOME || path.join(home, ".local/state"), "ultimatetv", "selftest");
}

/** Where the generated clips live: with the other box data, so a reinstall regenerates them. */
export function selftestDir(dataDir: string): string {
  return path.join(dataDir, "selftest");
}

/** The path of a step's clip. */
export function clipPath(dir: string, step: Pick<SelfTestStep, "clip">): string {
  return path.join(dir, step.clip ?? "selftest.mkv");
}

/**
 * The ffmpeg arguments that make one step's clip. Kept separate and pure so the arguments can be
 * asserted in tests without an ffmpeg binary (there isn't one in CI, and there isn't one on a box
 * that has never been updated either).
 */
export function ffmpegArgs(id: SelfTestId, out: string): string[] {
  const base = ["-loglevel", "error", "-y"];
  const picture = (w: number, h: number, rate: string) => `testsrc2=duration=4:size=${w}x${h}:rate=${rate}`;
  switch (id) {
    case "hdr10":
      return [
        ...base,
        "-f", "lavfi", "-i", picture(3840, 2160, "25"),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p10le",
        "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
        "-x264-params", "hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400",
        out,
      ];
    case "hlg":
      return [
        ...base,
        "-f", "lavfi", "-i", picture(1920, 1080, "25"),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p10le",
        "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc",
        "-x264-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
        out,
      ];
    case "fps-23976":
      return [...base, "-f", "lavfi", "-i", picture(1920, 1080, "24000/1001"), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out];
    case "fps-50":
      return [...base, "-f", "lavfi", "-i", picture(1920, 1080, "50"), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out];
    case "sound-surround":
      // A tone in every channel of Dolby Digital Plus 5.1: mpv passes eac3 and ac3 straight through
      // (`--audio-spdif=ac3,eac3,dts`), so this exercises the real HDMI path rather than a downmix.
      return [
        ...base,
        "-f", "lavfi", "-i", picture(1280, 720, "25"),
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000",
        "-af", "pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "eac3", "-b:a", "384k", "-shortest",
        out,
      ];
    case "sound-stereo":
      // Left for the first two seconds, then right, so a swapped pair is obvious.
      return [
        ...base,
        "-f", "lavfi", "-i", picture(1280, 720, "25"),
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000",
        "-af", "pan=stereo|FL='if(lt(t,2),c0,0)'|FR='if(lt(t,2),0,c0)'",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-shortest",
        out,
      ];
    case "keys":
      // The key test needs no picture.
      return [];
  }
}

/** Runs ffmpeg once, resolving true only when it exited cleanly within the time limit. */
function makeClip(args: string[], log: (line: string) => void, timeoutMs = 120_000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      log(`selftest: couldn't run ffmpeg (${String(err)})`);
      return finish(false);
    }
    const timer = setTimeout(() => {
      log("selftest: ffmpeg took too long; giving up on this clip");
      child.kill("SIGKILL");
      finish(false);
    }, timeoutMs);
    child.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) log(`selftest: ffmpeg: ${line}`);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      log(`selftest: couldn't start ffmpeg (${String(err)})`);
      finish(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

/** Whether a clip is there and not obviously empty. */
function clipReady(dir: string, step: Pick<SelfTestStep, "clip">): boolean {
  try {
    return statSync(clipPath(dir, step)).size > 1024;
  } catch {
    return false;
  }
}

/**
 * Makes any missing clips. Never throws: a box without ffmpeg simply reports which steps have no
 * clip, and the UI offers those steps as skipped rather than failing the whole run.
 */
export async function ensureClips(dir: string, log: (line: string) => void): Promise<SelfTestId[]> {
  const missing: SelfTestId[] = [];
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    log(`selftest: couldn't make ${dir} (${String(err)})`);
    return SELF_TEST_STEPS.map((s) => s.id);
  }
  for (const step of SELF_TEST_STEPS) {
    if (!step.clip) continue;
    if (clipReady(dir, step)) continue;
    const out = clipPath(dir, step);
    log(`selftest: making ${step.clip}`);
    const ok = await makeClip(ffmpegArgs(step.id, out), log);
    if (!ok) {
      log(`selftest: couldn't make ${step.clip}`);
      missing.push(step.id);
    }
  }
  return missing;
}

/**
 * Plays one clip and reports what mpv and the screen were doing. The wait matters: mpv reports the
 * mode and the decoder a moment after `loadfile`, and asking too early records "nothing playing" for
 * every step.
 */
export class SelfTester {
  constructor(
    private readonly deps: { player: Player; mpv: Mpv; display: Display; dir: string; log: (line: string) => void },
  ) {}

  /** The steps that have a usable clip right now. */
  ready(): SelfTestId[] {
    return SELF_TEST_STEPS.filter((s) => !s.clip || clipReady(this.deps.dir, s)).map((s) => s.id);
  }

  /** Plays a step's clip, waits for it to settle, and says what the box ended up in. */
  async play(id: SelfTestId, settleMs = 1_500): Promise<SelfTestPlayed> {
    const step = SELF_TEST_STEPS.find((s) => s.id === id);
    if (!step) throw new Error(`No self-test step called ${id}`);
    if (!step.clip) throw new Error("The key test has no picture to play");
    if (!clipReady(this.deps.dir, step)) throw new Error(`The ${step.label} clip hasn't been made yet`);
    const file = clipPath(this.deps.dir, step);
    this.deps.log(`selftest: playing ${step.clip}`);
    // `fps` is what makes the box pick a matching screen mode, which is the point of the frame-rate steps.
    await this.deps.player.play({ url: `file://${file}`, live: false, ...(step.fps ? { fps: step.fps } : {}), title: `Self-test: ${step.label}` });
    await new Promise((r) => setTimeout(r, settleMs));
    return this.observe(id);
  }

  private async observe(id: SelfTestId): Promise<SelfTestPlayed> {
    const out: SelfTestPlayed = { id };
    const ask = async <T>(name: string): Promise<T | undefined> => this.deps.mpv.get<T>(name).catch(() => undefined);
    const video = await ask<{ w?: number; h?: number; pixelformat?: string }>("video-params");
    if (video && typeof video === "object") {
      if (typeof video.w === "number") out.width = video.w;
      if (typeof video.h === "number") out.height = video.h;
      if (typeof video.pixelformat === "string") out.codec = video.pixelformat;
    }
    const audio = await ask<string>("audio-codec-name");
    if (typeof audio === "string" && audio !== "no") out.codec = out.codec ? `${out.codec}/${audio}` : audio;
    const hwdec = await ask<string>("hwdec-current");
    if (typeof hwdec === "string" && hwdec !== "no") out.hwdec = hwdec;
    try {
      const tv = await this.deps.display.tv();
      if (tv) {
        out.display = tv.output.name;
        out.refreshHz = tv.mode.refreshRate;
        if (typeof tv.output.hdr === "boolean") out.hdr = tv.output.hdr;
      }
    } catch (err) {
      this.deps.log(`selftest: couldn't read the screen mode (${String(err)})`);
    }
    return out;
  }

  /** Stops the clip and puts the screen back. */
  async stop(): Promise<void> {
    await this.deps.player.stop();
  }
}
