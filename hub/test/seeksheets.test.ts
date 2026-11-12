// Seek preview sheets for finished recordings (#227).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { trickplayFrame, type Recording } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { sheetArgs } from "../src/seeksheets.js";
import type { Run } from "../src/ytdlp.js";

let tmp: string;
let ctx: HubContext | undefined;
const calls: string[][] = [];

/** Pretends to be ffmpeg: writes `sheets` numbered JPEGs into the output folder. */
const fakeFfmpeg = (sheets: number, code = 0): Run => async (args) => {
  calls.push(args);
  const out = args[args.length - 1]!;
  for (let i = 1; i <= sheets && code === 0; i++) await writeFile(out.replace("%d", String(i)), "jpg");
  return { code, stdout: "", stderr: code ? "boom" : "" };
};

const make = (run: Run) => {
  ctx = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, ytdlp: null, sheetRun: run });
};

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

beforeEach(async () => {
  calls.length = 0;
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-sheets-"));
  await mkdir(tmp, { recursive: true });
});
afterEach(async () => {
  ctx?.close();
  await rm(tmp, { recursive: true, force: true });
});

describe("seek sheets", () => {
  it("asks ffmpeg for a tiled frame every 10 seconds, keyframes only", () => {
    const a = sheetArgs("/in.mkv", "/out/%d.jpg").join(" ");
    expect(a).toContain("fps=1/10");
    expect(a).toContain("tile=10x10");
    expect(a).toContain("-skip_frame nokey");
  });

  it("makes sheets for a finished recording and gives the player a trickplay block", async () => {
    make(fakeFfmpeg(4));
    ctx!.recordings.save(recording());
    expect(ctx!.seekSheets.trickplay("r1", "http://hub")).toBeUndefined();
    expect(await ctx!.seekSheets.make("r1")).toBe(true);
    const tp = ctx!.seekSheets.trickplay("r1", "http://hub");
    expect(tp).toMatchObject({ intervalMs: 10_000, width: 320, height: 180, tileWidth: 10, tileHeight: 10, count: 361 });
    expect(tp?.url).toBe("http://hub/api/recordings/r1/seek/{n}.jpg");
    // Sheets count from 0.
    expect(ctx!.seekSheets.sheetFile("r1", 0)).toBeDefined();
    expect(ctx!.seekSheets.sheetFile("r1", 3)).toBeDefined();
    expect(ctx!.seekSheets.sheetFile("r1", 4)).toBeUndefined();
    expect(trickplayFrame(tp!, 1_000_000)?.url).toBe("http://hub/api/recordings/r1/seek/1.jpg");
  });

  it("shows nothing when ffmpeg fails", async () => {
    make(fakeFfmpeg(0, 1));
    ctx!.recordings.save(recording());
    expect(await ctx!.seekSheets.make("r1")).toBe(false);
    expect(ctx!.seekSheets.trickplay("r1", "http://hub")).toBeUndefined();
  });

  it("shows nothing when ffmpeg isn't installed, and stops trying", async () => {
    make(async () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    });
    ctx!.recordings.save(recording());
    expect(await ctx!.seekSheets.make("r1")).toBe(false);
    expect(await ctx!.seekSheets.make("r1")).toBe(false);
    expect(ctx!.seekSheets.trickplay("r1", "http://hub")).toBeUndefined();
  });

  it("queues a recording when it finishes, and takes the sheets away with it", async () => {
    make(fakeFfmpeg(1));
    const r = recording({ programme: { ...recording().programme, end: 600_000 } });
    ctx!.recordings.save(r);
    ctx!.seekSheets.start();
    ctx!.events.emit({ type: "recording.finished", recording: r });
    await ctx!.seekSheets.idle();
    expect(calls).toHaveLength(1);
    expect(ctx!.seekSheets.trickplay("r1", "http://hub")?.count).toBe(61);
    await ctx!.seekSheets.remove("r1");
    expect(ctx!.seekSheets.trickplay("r1", "http://hub")).toBeUndefined();
  });

  it("plays a recording with the preview when sheets exist", async () => {
    make(fakeFfmpeg(1));
    ctx!.recordings.save(recording({ programme: { ...recording().programme, end: 300_000 } }));
    await ctx!.seekSheets.make("r1");
    const { Playback } = await import("../src/playback.js");
    const info = await new Playback(ctx!, {} as never).resolve({ kind: "recording", id: "r1" }, "http://hub", {} as never);
    expect(info.trickplay?.count).toBe(31);
  });
});
