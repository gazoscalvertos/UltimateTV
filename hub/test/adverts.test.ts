import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdBreak, Recording } from "@ultimatetv/shared";
import { AdvertFinder, breaksFromMarks, ffmpegDetect, parseDetectLog, parseEdl, tidy, toEdl } from "../src/adverts.js";
import { HubContext } from "../src/context.js";
import { Db } from "../src/db.js";
import { EventBus } from "../src/events.js";
import { RecordingStore } from "../src/recordings.js";
import { buildServer } from "../src/server.js";
import { defaultSettings, SettingsStore } from "../src/settings.js";
import { pairAsTv, programme } from "./helpers.js";

const MIN = 60_000;
const quiet = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe("reading the breaks", () => {
  it("reads comskip's EDL and drops idents too short to bother with", () => {
    expect(parseEdl("0.00\t3.20\t0\n754.12\t945.80\t0\n\n1680.04\t1870.00\t0\nrubbish\n")).toEqual([
      { startMs: 754_120, endMs: 945_800 },
      { startMs: 1_680_040, endMs: 1_870_000 },
    ]);
  });

  it("merges breaks that touch and drops ones too long to be adverts", () => {
    expect(tidy([{ startMs: 5 * MIN, endMs: 6 * MIN }, { startMs: 2 * MIN, endMs: 3 * MIN }, { startMs: 6 * MIN + 1000, endMs: 7 * MIN }, { startMs: 10 * MIN, endMs: 30 * MIN }])).toEqual([
      { startMs: 2 * MIN, endMs: 3 * MIN },
      { startMs: 5 * MIN, endMs: 7 * MIN },
    ]);
  });

  it("writes Kodi's EDL with the commercial break type", () => {
    expect(toEdl([{ startMs: 754_120, endMs: 945_800 }])).toBe("754.12\t945.80\t3\n");
  });

  it("reads ffmpeg's black and silence lines", () => {
    const log = `[blackdetect @ 0x1] black_start:60 black_end:60.4 black_duration:0.4
[silencedetect @ 0x2] silence_start: 59.98
[silencedetect @ 0x2] silence_end: 60.42 | silence_duration: 0.44`;
    expect(parseDetectLog(log)).toEqual({ black: [{ start: 60_000, end: 60_400 }], silence: [{ start: 59_980, end: 60_420 }] });
  });
});

describe("the fallback detector", () => {
  const at = (s: number) => ({ start: s * 1000, end: s * 1000 + 400 });

  it("finds a run of adverts between moments of black and silence", () => {
    const times = [600, 630, 650, 680, 690, 720];
    expect(breaksFromMarks(times.map(at), times.map(at))).toEqual([{ startMs: 600_200, endMs: 720_200 }]);
  });

  it("ignores a fade to black with the sound still on, and lone fades in the programme", () => {
    const times = [600, 630, 650];
    // Black without silence (a night scene with music), then lone black-and-silent fades minutes apart.
    expect(breaksFromMarks(times.map(at), [])).toEqual([]);
    expect(breaksFromMarks([at(100), at(400), at(900)], [at(100), at(400), at(900)])).toEqual([]);
  });

  const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  it.skipIf(!hasFfmpeg)(
    "finds the break in a real file",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "utv-adverts-"));
      try {
        const file = path.join(dir, "show.mkv");
        const gaps = [60, 75, 90, 105];
        const dark = gaps.map((t) => `between(t,${t},${t + 0.4})`).join("+");
        execFileSync("ffmpeg", [
          "-hide_banner", "-loglevel", "error",
          "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=25:duration=130",
          "-f", "lavfi", "-i", "sine=frequency=440:duration=130",
          "-vf", `drawbox=color=black:t=fill:enable='${dark}'`,
          "-af", `volume=0:enable='${dark}'`,
          "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", file,
        ]);
        const breaks = await ffmpegDetect()(file, new AbortController().signal);
        expect(breaks).toHaveLength(1);
        expect(breaks[0]!.startMs).toBeGreaterThan(59_000);
        expect(breaks[0]!.startMs).toBeLessThan(61_000);
        expect(breaks[0]!.endMs).toBeGreaterThan(104_000);
        expect(breaks[0]!.endMs).toBeLessThan(106_000);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe("AdvertFinder", () => {
  let dir: string;
  let store: RecordingStore;
  let settings: SettingsStore;
  let events: EventBus;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "utv-finder-"));
    const db = new Db(":memory:");
    store = new RecordingStore(db);
    settings = new SettingsStore(db, defaultSettings(dir));
    events = new EventBus();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const recording = async (id: string, extra: Partial<Recording> = {}): Promise<Recording> => {
    const file = path.join(dir, `${id}.mkv`);
    await writeFile(file, "x");
    const r: Recording = { id, programme: programme("bbc", 0, 60), channelId: "bbc", channelName: "BBC", status: "completed", method: "live", start: 0, end: 1, incomplete: false, watched: false, positionMs: 0, createdAt: 0, path: file, ...extra };
    store.save(r);
    return r;
  };
  const found: AdBreak[] = [{ startMs: 10 * MIN, endMs: 13 * MIN }];

  it("looks at recordings as they finish, one at a time, and writes an EDL beside them", async () => {
    const seen: string[] = [];
    let running = 0;
    const finder = new AdvertFinder({
      store, events, settings, log: quiet,
      detect: async (file) => {
        running++;
        expect(running).toBe(1);
        seen.push(path.basename(file));
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return found;
      },
    });
    finder.start();
    for (const id of ["a", "b"]) events.emit({ type: "recording.finished", recording: await recording(id) });
    await finder.idle();
    expect(seen).toEqual(["a.mkv", "b.mkv"]);
    expect(store.get("a")).toMatchObject({ advertScan: "done", adverts: found });
    expect(await readFile(path.join(dir, "a.edl"), "utf8")).toBe("600.00\t780.00\t3\n");
    finder.stop();
  });

  it("catches up on recordings made before it existed, and keeps what changed meanwhile", async () => {
    await recording("old");
    await recording("done", { advertScan: "done", adverts: [] });
    const finder = new AdvertFinder({
      store, events, settings, log: quiet,
      detect: async () => {
        // Watched while comskip ran.
        store.save({ ...store.get("old")!, watched: true });
        return found;
      },
    });
    finder.start();
    await finder.idle();
    expect(store.get("old")).toMatchObject({ advertScan: "done", watched: true, adverts: found });
    expect(store.get("done")!.adverts).toEqual([]);
    finder.stop();
  });

  it("marks a recording it couldn't read, and leaves them alone when turned off", async () => {
    await recording("bad");
    const finder = new AdvertFinder({ store, events, settings, log: quiet, detect: async () => Promise.reject(new Error("moov atom not found")) });
    finder.start();
    await finder.idle();
    expect(store.get("bad")!.advertScan).toBe("failed");

    settings.update({ recording: { ...settings.get().recording, findAdverts: false } });
    events.emit({ type: "recording.finished", recording: await recording("new") });
    await finder.idle();
    expect(store.get("new")!.advertScan).toBe("off");
    finder.stop();
  });

  it("looks again when turned back on", async () => {
    settings.update({ recording: { ...settings.get().recording, findAdverts: false } });
    const finder = new AdvertFinder({ store, events, settings, log: quiet, detect: async () => found });
    finder.start();
    await recording("later");
    finder.enqueue("later");
    await finder.idle();
    expect(store.get("later")!.advertScan).toBe("off");
    settings.update({ recording: { ...settings.get().recording, findAdverts: true } });
    await finder.idle();
    expect(store.get("later")).toMatchObject({ advertScan: "done", adverts: found });
    finder.stop();
  });
});

describe("advert breaks over the API", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-adverts-api-"));
    const options = { port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false };
    const context = new HubContext({ dataDir: options.dataDir, mediaRoot: tmp, env: {}, log: quiet, advertDetect: async () => [{ startMs: 5 * MIN, endMs: 7 * MIN }] });
    app = await buildServer(options, { systemReport: async () => ({}) as never, context });
    await pairAsTv(app);
  });
  afterEach(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const save = async (extra: Partial<Recording>) => {
    const file = path.join(tmp, "r.mkv");
    await writeFile(file, "x");
    app.hub.recordings.save({ id: "r1", programme: programme("bbc", 0, 60), channelId: "bbc", channelName: "BBC", status: "completed", method: "live", start: 0, end: 1, incomplete: false, watched: false, positionMs: 0, createdAt: 0, path: file, ...extra });
  };

  it("hands the player the breaks as skip markers", async () => {
    await save({ advertScan: "done", adverts: [{ startMs: 10 * MIN, endMs: 13 * MIN }] });
    const info = (await app.inject({ method: "POST", url: "/api/play", payload: { kind: "recording", id: "r1" } })).json();
    expect(info.skip).toEqual([{ kind: "adverts", startMs: 10 * MIN, endMs: 13 * MIN }]);
  });

  it("looks again when asked", async () => {
    await save({ advertScan: "failed" });
    expect((await app.inject({ method: "POST", url: "/api/recordings/r1/adverts" })).statusCode).toBe(200);
    await app.hub.adverts.idle();
    expect(app.hub.recordings.get("r1")).toMatchObject({ advertScan: "done", adverts: [{ startMs: 5 * MIN, endMs: 7 * MIN }] });
    expect((await app.inject({ method: "POST", url: "/api/recordings/nope/adverts" })).statusCode).toBe(404);
  });
});
