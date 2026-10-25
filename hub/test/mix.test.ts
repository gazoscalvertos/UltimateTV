import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MixOverview, PlaybackInfo } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { HubContext } from "../src/context.js";
import { cropFromLog } from "../src/cropdetect.js";
import { nextLoop, planSlots } from "../src/mixchannels.js";
import { buildServer } from "../src/server.js";
import { cleanVideoTitle, displayTitle, judge, type Run, type YtInfo } from "../src/ytdlp.js";
import { channel } from "./helpers.js";

const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } } as never;

/** A seeded random number generator, so shuffles are repeatable. */
function seeded(seed = 1) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe("shuffling a channel", () => {
  it("plays every video once per pass, never the same order twice running, never the same video back to back", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const durations = new Map(ids.map((id) => [id, 60_000]));
    const { slots } = planSlots(0, 60 * 60_000 * 4, durations, { bag: [], loop: [] }, undefined, seeded(7));
    expect(slots).toHaveLength(240);
    const passes: string[][] = [];
    for (let i = 0; i < slots.length; i += ids.length) passes.push(slots.slice(i, i + ids.length).map((s) => s.videoId));
    for (const p of passes) expect([...p].sort()).toEqual(ids);
    for (let i = 1; i < passes.length; i++) expect(passes[i]).not.toEqual(passes[i - 1]);
    for (let i = 1; i < slots.length; i++) expect(slots[i]!.videoId).not.toBe(slots[i - 1]!.videoId);
    // Back to back in time.
    for (let i = 1; i < slots.length; i++) expect(slots[i]!.start).toBe(slots[i - 1]!.end);
  });

  it("carries on a pass where it left off", () => {
    const durations = new Map([["a", 1000], ["b", 1000], ["c", 1000]]);
    const first = planSlots(0, 2000, durations, { bag: [], loop: [] }, undefined, seeded(3));
    expect(first.slots).toHaveLength(2);
    expect(first.state.bag).toHaveLength(1);
    const second = planSlots(2000, 3000, durations, first.state, first.slots[1]!.videoId, seeded(3));
    const pass = [...first.slots, ...second.slots].map((s) => s.videoId).sort();
    expect(pass).toEqual(["a", "b", "c"]);
  });

  it("skips videos that have gone and copes with one video", () => {
    expect(planSlots(0, 5000, new Map([["a", 1000]]), { bag: ["gone", "a"], loop: ["gone", "a"] }, undefined).slots.map((s) => s.videoId)).toEqual(["a", "a", "a", "a", "a"]);
    expect(planSlots(0, 5000, new Map(), { bag: [], loop: [] }, undefined).slots).toEqual([]);
    expect(nextLoop(["a", "b"], ["a", "b"], "a", seeded(2))[0]).toBe("b");
  });
});

describe("finding baked-in black bars", () => {
  const log = (crop: string) => `Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv), 3840x2160, SAR 1:1 DAR 16:9, 25 fps\n[Parsed_cropdetect_0 @ 0x1] x1:0 x2:3839 y1:0 y2:2159 w:3840 h:2160 x:0 y:0 pts:1 t:0.04 crop=3840:2160:0:0\n[Parsed_cropdetect_0 @ 0x1] x1:480 crop=${crop}\n`;
  it("crops a 4:3 video pillarboxed into 16:9, and a letterbox", () => {
    expect(cropFromLog(log("2880:2160:480:0"))).toBe("2880x2160+480+0");
    expect(cropFromLog(log("3840:1600:0:280"))).toBe("3840x1600+0+280");
  });
  it("leaves full-frame video and slivers alone", () => {
    expect(cropFromLog(log("3840:2160:0:0"))).toBe("");
    expect(cropFromLog(log("3840:2140:0:10"))).toBe("");
    expect(cropFromLog("no video here")).toBe("");
  });
});

describe("judging search results", () => {
  const rules = { minHeight: 720, maxMinutes: 10, exclude: [] };
  const base: YtInfo = { id: "x", title: "Cascada - Everytime We Touch (Official Video)", duration: 200, height: 1080, uploader: "CascadaVEVO", view_count: 1e8 };

  it("rules out lyric videos, SD, long mixes and wrong songs", () => {
    expect(judge(base, rules, "Cascada - Everytime We Touch").rejected).toEqual([]);
    expect(judge({ ...base, title: "Cascada - Everytime We Touch (Lyrics)" }, rules).rejected[0]).toContain("lyrics");
    expect(judge({ ...base, height: 480 }, rules).rejected).toContain("only 480p");
    expect(judge({ ...base, duration: 3600 }, rules).rejected[0]).toContain("too long");
    expect(judge(base, rules, "Basshunter - Now You're Gone").rejected[0]).toContain("doesn't look like");
    expect(judge({ ...base, title: "Everytime We Touch REMIX CONTEST entry" }, { ...rules, exclude: ["entry"] }).rejected).toHaveLength(1);
  });

  it("prefers the official upload", () => {
    const official = judge(base, rules, "Cascada - Everytime We Touch").score;
    const fan = judge({ ...base, title: "Cascada Everytime We Touch", uploader: "dance fan 99", view_count: 2000 }, rules, "Cascada - Everytime We Touch").score;
    expect(official).toBeGreaterThan(fan);
  });

  it("names videos for the guide", () => {
    expect(cleanVideoTitle("Darude - Sandstorm (Official Music Video) [4K]")).toBe("Darude - Sandstorm");
    expect(displayTitle({ title: "whatever", artist: "Darude, Someone", track: "Sandstorm" })).toBe("Darude – Sandstorm");
    expect(displayTitle({ title: "Darude - Sandstorm | Official Video" })).toBe("Darude – Sandstorm");
  });
});

/** A pretend yt-dlp: search finds "<query> n" videos; downloads write a small file. */
function fakeYtDlp() {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    if (args[0] === "--version") return { code: 0, stdout: "2026.10.01\n", stderr: "" };
    if (args[0] === "-U") return { code: 0, stdout: "yt-dlp is up to date", stderr: "" };
    const search = args.find((a) => a.startsWith("ytsearch"));
    if (search) {
      const q = search.replace(/^ytsearch\d+:/, "").replace(/ official (music )?video$/, "");
      const n = Number(/^ytsearch(\d+)/.exec(search)![1]);
      const lines = Array.from({ length: Math.min(n, 3) }, (_, i) =>
        JSON.stringify({ id: `${q.replace(/\W+/g, "").slice(0, 12)}${i}`, title: `${q} (Official Video)${i === 2 ? " lyrics" : ""}`, duration: 200 + i, height: i === 1 ? 480 : 2160, uploader: "SomeVEVO", view_count: 1e6 }),
      );
      return { code: 0, stdout: lines.join("\n"), stderr: "" };
    }
    if (args.includes("--print")) {
      const out = args[args.indexOf("-o") + 1]!.replace("%(ext)s", "mkv");
      await writeFile(out, "video");
      return { code: 0, stdout: `DONE\t${out}\t2160\t25\t201\n`, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "ERROR: unexpected" };
  };
  return { run, calls };
}

describe("music video channels in the Hub", () => {
  let tmp: string;
  let ctx: HubContext;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mix-"));
    ctx = new HubContext({ dataDir: tmp, mediaRoot: tmp, log: silent, ytdlp: fakeYtDlp().run, mixPauseMs: 0, mixMinFreeBytes: 0, mixCropDetect: async (f) => (f.includes("BetaTwo") ? "2880x2160+480+0" : "") });
  });
  afterAll(async () => {
    ctx.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("seeds the three starter channels into the channel list, and an IPTV refresh keeps them", () => {
    ctx.mix.seed();
    ctx.mix.seed();
    const mixes = ctx.channels.list().filter((c) => c.mix);
    expect(mixes.map((c) => [c.number, c.name])).toEqual([
      [390, "Clubland TV"],
      [391, "House TV"],
      [392, "Halloween TV"],
    ]);
    expect(mixes.every((c) => c.category === "music")).toBe(true);
    ctx.channels.replace([channel("bbc-one", { number: 101 })], []);
    expect(ctx.channels.list().map((c) => c.id)).toEqual(["bbc-one", "mix:clubland-tv", "mix:house-tv", "mix:halloween-tv"]);
  });

  it("finds videos for a channel's picks, downloads them and schedules them", async () => {
    const c = ctx.mix.create({ name: "Test TV", brief: "x", picks: ["Alpha - One", "Beta - Two", "Gamma - Three"], target: 3 });
    expect(c.number).toBe(393);
    const added = await ctx.mix.curate(c.id);
    expect(added).toBe(3);
    const entries = ctx.mix.store.entries(c.id);
    // The SD and lyric results lose out to the 4K official video.
    expect(entries.map((e) => e.video.id)).toEqual(["AlphaOne0", "BetaTwo0", "GammaThree0"]);
    expect(entries.every((e) => e.video.status === "queued")).toBe(true);
    for (const e of entries) await ctx.mix.download(e.video.id);
    const ready = ctx.mix.store.entries(c.id);
    expect(ready.map((e) => [e.video.status, e.video.error ?? ""])).toEqual(ready.map(() => ["ready", ""]));
    expect(ready.every((e) => e.video.path && existsSync(e.video.path))).toBe(true);
    expect(ctx.channels.get(c.id)?.mix).toEqual({ ready: 3, target: 5 });

    const now = Date.now();
    const tuned = ctx.mix.tuneIn(c.id, now);
    expect(tuned).not.toBeNull();
    expect(tuned!.queue.length).toBeGreaterThan(50);
    const progs = ctx.guide.onChannel(c.id, now, 9);
    expect(progs[0]!.videoId).toBe(tuned!.first.videoId);
    expect(new Set(progs.slice(0, 3).map((p) => p.videoId)).size).toBe(3);
    // The caption's titles and the per-video crops line up with what plays.
    expect(tuned!.titles.length).toBe(tuned!.queue.length + 1);
    expect(tuned!.titles[0]).toBe(progs[0]!.title);
    const order = [tuned!.first.videoId, ...tuned!.queue];
    expect(tuned!.crops).toEqual(order.map((id) => (id === "BetaTwo0" ? "2880x2160+480+0" : "")));
  });

  it("taking a video off reshuffles without it and doesn't pick it again", async () => {
    const id = "mix:test-tv";
    await ctx.mix.removeVideo(id, "BetaTwo0");
    const later = ctx.guide.onChannel(id, Date.now() + 10 * 60_000, 50);
    expect(later.some((p) => p.videoId === "BetaTwo0")).toBe(false);
    expect(ctx.mix.store.video("BetaTwo0")).toBeUndefined();
    await ctx.mix.update(id, { picks: ["Beta - Two"] });
    await ctx.mix.curate(id);
    expect(ctx.mix.store.entries(id).map((e) => e.video.id)).not.toContain("BetaTwo0");
  });
});

describe("music video channel work lanes", () => {
  it("downloads the videos already chosen while another channel is still being curated", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mix-lanes-"));
    const fake = fakeYtDlp();
    let release: () => void = () => undefined;
    let gate: Promise<void> | null = null;
    const run: Run = async (args, opts) => {
      if (gate && args.some((a) => a.startsWith("ytsearch"))) await gate;
      return fake.run(args, opts);
    };
    const ctx = new HubContext({ dataDir: tmp, mediaRoot: tmp, log: silent, ytdlp: run, mixPauseMs: 0, mixMinFreeBytes: 0 });
    try {
      const a = ctx.mix.create({ name: "Lane A", brief: "x", picks: ["Alpha - One", "Beta - Two"], target: 2 });
      await ctx.mix.curate(a.id);
      const b = ctx.mix.create({ name: "Lane B", brief: "x", picks: ["Gamma - Three"], target: 1 });
      gate = new Promise<void>((r) => (release = r));
      ctx.mix.curateSoon(b.id);
      await ctx.mix.start();
      for (let i = 0; i < 100 && !ctx.mix.store.entries(a.id).every((e) => e.video.status === "ready"); i++) await new Promise((r) => setTimeout(r, 20));
      expect(ctx.mix.store.entries(a.id).map((e) => e.video.status)).toEqual(["ready", "ready"]);
      expect(ctx.mix.store.entries(b.id)).toEqual([]);
    } finally {
      release();
      ctx.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("music video channels over the API", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const family = { "x-profile": "family" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mixapi-"));
    const config: HubConfig = {
      port: 8095,
      host: "127.0.0.1",
      dataDir: path.join(tmp, "data"),
      clipsDir: path.join(tmp, "clips"),
      probeDir: path.join(tmp, "probe"),
      uiDir: path.join(tmp, "ui"),
      setupDir: path.join(tmp, "setup"),
      mediaRoot: path.join(tmp, "media"),
      demo: true,
    };
    app = await buildServer(config, { systemReport: async () => ({ ffmpeg: null, hwaccels: [], renderNode: null, vaapi: { available: false, driver: null, profiles: [] }, checks: { av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false } }) });
  });
  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("lists the demo channels and plays one as a queue of videos", async () => {
    const list = (await app.inject({ url: "/api/mix-channels", headers: family })).json<MixOverview>();
    expect(list.channels.map((c) => c.name)).toEqual(["Clubland TV", "House TV", "Halloween TV"]);
    expect(list.channels[0]!.counts.ready).toBeGreaterThan(20);
    const res = await app.inject({ method: "POST", url: "/api/play", headers: family, payload: { kind: "channel", id: "mix:clubland-tv" } });
    expect(res.statusCode).toBe(200);
    const info = res.json<PlaybackInfo>();
    expect(info.live).toBe(true);
    expect(info.url).toMatch(/\/api\/mix\/videos\/.+\/file$/);
    expect(info.queue?.length).toBeGreaterThan(10);
    const guide = (await app.inject({ url: "/api/guide?category=music", headers: family })).json<{ channels: { id: string }[]; programmes: Record<string, unknown[]> }>();
    expect(guide.channels.map((c) => c.id)).toContain("mix:house-tv");
    // Half-hour blocks of videos.
    expect(guide.programmes["mix:house-tv"]!.length).toBeGreaterThan(5);
  });

  it("creates a channel, refuses to record one and keeps Kids out of the settings", async () => {
    const created = await app.inject({ method: "POST", url: "/api/mix-channels", headers: family, payload: { name: "90s Rock", brief: "Oasis, Blur, Pulp" } });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ id: string; number: number }>().id).toBe("mix:90s-rock");
    const kids = await app.inject({ method: "POST", url: "/api/mix-channels", headers: { "x-profile": "kids" }, payload: { name: "Mine", brief: "x" } });
    expect(kids.statusCode).toBe(403);
    const prog = (await app.inject({ url: "/api/channels/mix:clubland-tv/programmes", headers: family })).json<{ programmes: { id: string }[] }>().programmes[0]!;
    const rec = await app.inject({ method: "POST", url: "/api/recordings", headers: family, payload: { programmeId: prog.id } });
    expect(rec.statusCode).toBe(422);
    expect((await app.inject({ method: "DELETE", url: "/api/mix-channels/mix:90s-rock", headers: family })).statusCode).toBe(200);
  });
});
