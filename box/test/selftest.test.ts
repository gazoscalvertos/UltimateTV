// The box's half of the self-test (#105): the clips it generates and what it reports back.
// There is no ffmpeg or mpv in CI, so these test the arguments and the bookkeeping rather than a
// real encode or a real picture.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SELF_TEST_STEPS } from "@ultimatetv/shared";
import { clipPath, defaultSelftestDir, ensureClips, ffmpegArgs, SelfTester, selftestDir } from "../src/selftest.js";

describe("the self-test clips", () => {
  it("makes an ffmpeg command for every step that has a clip", () => {
    for (const step of SELF_TEST_STEPS) {
      const args = ffmpegArgs(step.id, `/tmp/${step.clip}`);
      expect(args.length).toBeGreaterThan(0);
      // Never overwrite something the household put there, and never print a progress bar into the log.
      expect(args).toContain("-y");
      expect(args).toContain("-loglevel");
      // The output file is the last argument, which is how ffmpeg is read.
      expect(args[args.length - 1]).toBe(`/tmp/${step.clip}`);
    }
  });

  it("marks the HDR10 clip as HDR10 rather than as an ordinary picture", () => {
    const args = ffmpegArgs("hdr10", "/tmp/a.mkv").join(" ");
    expect(args).toContain("smpte2084");
    expect(args).toContain("bt2020");
    expect(args).toContain("yuv420p10le");
    expect(args).toContain("master-display");
    // 4K, because a 1080p HDR clip would not prove the box can do 4K HDR.
    expect(args).toContain("3840x2160");
  });

  it("marks the HLG clip with the transfer iPlayer and live TV use", () => {
    const args = ffmpegArgs("hlg", "/tmp/a.mkv").join(" ");
    expect(args).toContain("arib-std-b67");
    expect(args).toContain("yuv420p10le");
  });

  it("plays the frame-rate clips at the rate they are named after", () => {
    expect(ffmpegArgs("fps-23976", "/tmp/a.mkv").join(" ")).toContain("24000/1001");
    expect(ffmpegArgs("fps-50", "/tmp/a.mkv").join(" ")).toContain("rate=50");
  });

  it("puts the surround tone in Dolby Digital Plus so it goes down the HDMI passthrough path", () => {
    const args = ffmpegArgs("sound-surround", "/tmp/a.mkv");
    const joined = args.join(" ");
    expect(joined).toContain("eac3");
    expect(joined).toContain("pan=5.1");
    expect(joined).toContain("sine=");
  });

  it("makes the stereo clip play left, then right", () => {
    const joined = ffmpegArgs("sound-stereo", "/tmp/a.mkv").join(" ");
    expect(joined).toContain("pan=stereo");
    expect(joined).toContain("lt(t,2)");
    expect(joined).toContain("-c:a aac");
  });

  it("keeps every clip short: the whole run is meant to take a minute", () => {
    for (const step of SELF_TEST_STEPS) {
      const joined = ffmpegArgs(step.id, "/tmp/a.mkv").join(" ");
      expect(joined).toContain("duration=4");
    }
  });
});

describe("where the clips live", () => {
  it("puts them with the box's other state", () => {
    expect(selftestDir("/var/lib/ultimatetv")).toBe("/var/lib/ultimatetv/selftest");
    expect(defaultSelftestDir({ XDG_STATE_HOME: "/home/tv/.state" } as NodeJS.ProcessEnv, "/home/tv")).toBe("/home/tv/.state/ultimatetv/selftest");
    expect(defaultSelftestDir({} as NodeJS.ProcessEnv, "/home/tv")).toBe("/home/tv/.local/state/ultimatetv/selftest");
  });

  it("names each step's clip after itself", () => {
    expect(clipPath("/d", { clip: "selftest-hdr10.mkv" })).toBe("/d/selftest-hdr10.mkv");
  });
});

describe("making the clips on the box", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "utv-selftest-clips-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports every step as missing when there is no ffmpeg to make them with", async () => {
    // No ffmpeg in this environment: the promise is that it says so rather than throwing.
    const lines: string[] = [];
    const missing = await ensureClips(path.join(dir, "nope"), (l) => lines.push(l));
    expect(missing.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("selftest:");
  });

  it("skips clips that are already there", async () => {
    const lines: string[] = [];
    for (const step of SELF_TEST_STEPS) {
      if (!step.clip) continue;
      await writeFile(clipPath(dir, step), Buffer.alloc(4096, 1));
    }
    const missing = await ensureClips(dir, (l) => lines.push(l));
    expect(missing).toEqual([]);
    // Nothing was attempted, so nothing was logged.
    expect(lines).toEqual([]);
  });
});

describe("what the box reports back", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "utv-selftest-play-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A SelfTester with fake player/mpv/display, so the bookkeeping can be checked without mpv. */
  const tester = (over: { play?: () => Promise<void>; tv?: () => Promise<unknown>; get?: (name: string) => Promise<unknown> } = {}) => {
    const played: unknown[] = [];
    const log: string[] = [];
    const player = { play: over.play ?? (async (o: unknown) => void played.push(o)), stop: async () => undefined };
    const mpv = { get: over.get ?? (async () => undefined) };
    const display = { tv: over.tv ?? (async () => null) };
    const t = new SelfTester({ player: player as never, mpv: mpv as never, display: display as never, dir, log: (l) => log.push(l) });
    return { t, played, log };
  };

  it("says which steps it can run right now", async () => {
    const { t } = tester();
    // Nothing made yet except the steps with no clip, which always count as ready.
    expect(t.ready()).toEqual([]);
    await writeFile(clipPath(dir, { clip: "selftest-hdr10.mkv" }), Buffer.alloc(4096, 1));
    expect(t.ready()).toEqual(["hdr10"]);
  });

  it("refuses to play a clip it hasn't made, in words the TV can show", async () => {
    const { t, played } = tester();
    await expect(t.play("hdr10")).rejects.toThrow("hasn't been made yet");
    expect(played).toEqual([]);
  });

  it("refuses a step that doesn't exist", async () => {
    const { t } = tester();
    await expect(t.play("nonsense" as never)).rejects.toThrow("No self-test step called nonsense");
  });

  it("refuses the key test, which has no picture", async () => {
    const { t } = tester();
    await expect(t.play("keys" as never)).rejects.toThrow("No self-test step called keys");
  });

  it("plays the clip and records the mode, picture and decoder", async () => {
    await writeFile(clipPath(dir, { clip: "selftest-hdr10.mkv" }), Buffer.alloc(4096, 1));
    const values: Record<string, unknown> = {
      "video-params": { w: 3840, h: 2160, pixelformat: "yuv420p10le" },
      "audio-codec-name": "eac3",
      "hwdec-current": "vaapi",
    };
    const { t, played } = tester({
      get: async (name) => values[name],
      tv: async () => ({ output: { name: "HDMI-A-1", hdr: true }, mode: { id: "1", width: 3840, height: 2160, refreshRate: 23.976 } }),
    });
    const out = await t.play("hdr10", 0);
    expect(played.length).toBe(1);
    // The frame rate goes to mpv so the box picks a matching screen mode, which is the point.
    expect((played[0] as { fps?: number }).fps).toBe(25);
    expect((played[0] as { live?: boolean }).live).toBe(false);
    expect(out).toEqual({ id: "hdr10", width: 3840, height: 2160, codec: "yuv420p10le/eac3", hwdec: "vaapi", display: "HDMI-A-1", refreshHz: 23.976, hdr: true });
  });

  it("still reports the picture when the screen can't be read", async () => {
    await writeFile(clipPath(dir, { clip: "selftest-50.mkv" }), Buffer.alloc(4096, 1));
    const { t, log } = tester({
      get: async (name) => (name === "video-params" ? { w: 1920, h: 1080 } : undefined),
      tv: async () => {
        throw new Error("kscreen-doctor isn't installed");
      },
    });
    const out = await t.play("fps-50", 0);
    expect(out.width).toBe(1920);
    expect(out.display).toBeUndefined();
    expect(log.join("\n")).toContain("couldn't read the screen mode");
  });

  it("leaves the decoder out when there isn't one", async () => {
    await writeFile(clipPath(dir, { clip: "selftest-stereo.mkv" }), Buffer.alloc(4096, 1));
    const { t } = tester({ get: async (name) => (name === "video-params" ? { w: 1280, h: 720, pixelformat: "yuv420p" } : name === "audio-codec-name" ? "aac" : "no") });
    const out = await t.play("sound-stereo", 0);
    expect(out.hwdec).toBeUndefined();
    expect(out.codec).toBe("yuv420p/aac");
  });
});
