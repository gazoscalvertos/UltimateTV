// The advert-break fallback (issue #73): when comskip finds nothing in a long recording, ffmpeg's
// black frames and silence are used instead, and the recording says which method found the breaks.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Recording } from "@ultimatetv/shared";
import { AdSkipper } from "../src/adskip.js";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { FALLBACK_MIN_RECORDING_MS } from "../src/adbreaks.js";

let tmp: string;
let ctx: HubContext;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-adfallback-"));
  ctx = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, ytdlp: null });
});

afterEach(async () => {
  ctx.close();
  await rm(tmp, { recursive: true, force: true });
});

const recording = (extra: Partial<Recording> = {}): Recording => ({
  id: "r1",
  programme: { id: "p1", channelId: "itv", start: 0, end: 3600_000, title: "Quiz Night", categories: [], isNew: false, isRepeat: false, isFilm: false },
  channelId: "itv",
  channelName: "ITV1",
  status: "completed",
  method: "live",
  start: 0,
  end: 3600_000,
  incomplete: false,
  path: path.join(tmp, "Quiz Night.mkv"),
  watched: false,
  positionMs: 0,
  createdAt: 0,
  ...extra,
});

/** comskip found nothing: exit code 1 and an empty EDL. */
const comskipFoundNothing = async (args: string[]) => {
  const out = args.find((a) => a.startsWith("--output="))!.slice(9);
  await writeFile(path.join(out, "Quiz Night.edl"), "");
  return { code: 1, stdout: "", stderr: "" };
};

/** ffmpeg's two passes: black frames from the video, silence from the audio. */
const ffmpegDetecting = (log: string[]) => async (args: string[]) => {
  log.push(args.includes("-af") ? "audio" : "video");
  if (args.includes("-af")) return { code: 0, stdout: "", stderr: "silence_start: 598.2\nsilence_end: 954.8 | silence_duration: 356.6\n" };
  return { code: 0, stdout: "", stderr: "black_start:598.5 black_end:599.2 black_duration:0.7\nblack_start:953.1 black_end:954 black_duration:0.9\n" };
};

describe("the fallback when comskip finds nothing", () => {
  it("uses ffmpeg's black frames and silence, and says so", async () => {
    ctx.recordings.save(recording());
    const log: string[] = [];
    const skipper = new AdSkipper(ctx, path.join(tmp, "data"), comskipFoundNothing, ffmpegDetecting(log));
    const r = await skipper.scan("r1");
    expect(r?.adScan).toBe("done");
    expect(r?.adScanMethod).toBe("ffmpeg");
    expect(r?.adBreaks).toEqual([{ startMs: 599_200, endMs: 953_100 }]);
    expect(log).toEqual(["video", "audio"]);
  });

  it("leaves a short recording alone, because a 10 minute clip has no advert breaks to find", async () => {
    ctx.recordings.save(recording({ end: 10 * 60_000 }));
    const log: string[] = [];
    const skipper = new AdSkipper(ctx, path.join(tmp, "data"), comskipFoundNothing, ffmpegDetecting(log));
    const r = await skipper.scan("r1");
    expect(r?.adScan).toBe("done");
    expect(r?.adBreaks).toEqual([]);
    expect(r?.adScanMethod).toBe("comskip");
    expect(log).toEqual([]);
  });

  it("still says comskip when comskip found the breaks", async () => {
    ctx.recordings.save(recording());
    const log: string[] = [];
    const skipper = new AdSkipper(ctx, path.join(tmp, "data"), async (args) => {
      const out = args.find((a) => a.startsWith("--output="))!.slice(9);
      await writeFile(path.join(out, "Quiz Night.edl"), "600.00\t780.50\t0\n");
      return { code: 0, stdout: "", stderr: "" };
    }, ffmpegDetecting(log));
    const r = await skipper.scan("r1");
    expect(r?.adScanMethod).toBe("comskip");
    expect(log).toEqual([]);
  });

  it("looks no further when ffmpeg is missing, and still keeps the recording", async () => {
    ctx.recordings.save(recording());
    const skipper = new AdSkipper(ctx, path.join(tmp, "data"), comskipFoundNothing, async () => {
      throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    });
    const r = await skipper.scan("r1");
    // comskip did its job and found nothing, so the scan is done; only the fallback was unavailable.
    expect(r?.adScan).toBe("done");
    expect(r?.adBreaks).toEqual([]);
    expect(r?.adScanMethod).toBe("comskip");
  });

  it("keeps comskip's own breaks untouched when the fallback isn't needed", async () => {
    ctx.recordings.save(recording());
    const skipper = new AdSkipper(ctx, path.join(tmp, "data"), async (args) => {
      const out = args.find((a) => a.startsWith("--output="))!.slice(9);
      await writeFile(path.join(out, "Quiz Night.edl"), "600.00\t780.50\t0\n783.00\t800.00\t0\n");
      return { code: 0, stdout: "", stderr: "" };
    }, async () => {
      throw new Error("ffmpeg should not be asked");
    });
    const r = await skipper.scan("r1");
    expect(r?.adBreaks).toEqual([{ startMs: 600_000, endMs: 800_000 }]);
  });

  it("only tries the fallback on recordings at least 20 minutes long", async () => {
    expect(FALLBACK_MIN_RECORDING_MS).toBe(20 * 60_000);
  });
});

describe("saying which method found the breaks, for diagnostics", () => {
  it("counts the recordings each method looked at", async () => {
    ctx.recordings.save(recording({ id: "a", adScan: "done", adScanMethod: "comskip", adBreaks: [{ startMs: 600_000, endMs: 780_000 }] }));
    ctx.recordings.save(recording({ id: "b", adScan: "done", adScanMethod: "ffmpeg", adBreaks: [{ startMs: 599_200, endMs: 953_100 }] }));
    ctx.recordings.save(recording({ id: "c", adScan: "done", adScanMethod: "comskip", adBreaks: [] }));
    ctx.recordings.save(recording({ id: "d", adScan: "unavailable" }));
    const skipper = new AdSkipper(ctx, path.join(tmp, "data"), comskipFoundNothing);
    // "c" was looked at and no breaks were found, which is its own answer, not a comskip win.
    expect(skipper.summary()).toEqual({ comskip: 1, ffmpeg: 1, none: 1, unavailable: 1, pending: 0, failed: 0 });
  });
});

describe("the advert-search counts in the diagnostics text", () => {
  it("says how the breaks were found", async () => {
    const { renderDiagnostics } = await import("../src/diagnostics.js");
    const text = renderDiagnostics(
      { version: "0.2.0", uptimeS: 60, log: [], advertScan: { comskip: 4, ffmpeg: 2, none: 1, unavailable: 0, pending: 0, failed: 0 } },
      null,
    );
    expect(text).toContain("adverts: 4 by comskip · 2 by ffmpeg · 1 with none");
  });

  it("says nothing when no recording has been looked at", async () => {
    const { renderDiagnostics } = await import("../src/diagnostics.js");
    expect(renderDiagnostics({ version: "0.2.0", uptimeS: 60, log: [] }, null)).not.toContain("adverts:");
  });
});
