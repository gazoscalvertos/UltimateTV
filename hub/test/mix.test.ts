import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MixOverview, PlaybackInfo } from "@ultimatetv/shared";
import type { HubConfig } from "../src/config.js";
import { HubContext } from "../src/context.js";
import { cropFromLog } from "../src/cropdetect.js";
import { titleFromFile } from "../src/nasvideos.js";
import { nextLoop, planSlots } from "../src/mixchannels.js";
import { buildServer } from "../src/server.js";
import { cleanVideoTitle, displayTitle, judge, playlistId, songKey, YtDlp, type Run, type YtInfo } from "../src/ytdlp.js";
import { channel, pairAsTv } from "./helpers.js";

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

  it("judges an atmosphere channel on looks and length, not on being a single", () => {
    const spooky = { minHeight: 720, maxMinutes: 90, exclude: [], style: "ambience" as const };
    const long: YtInfo = { id: "a", title: "Haunted House Ambience 1 Hour | Ghosts and Whispers 4K", duration: 3600, height: 2160, uploader: "Night Atmospheres", view_count: 2e6 };
    // A music channel would throw this out twice over: "1 hour" in the title, and too long.
    expect(judge(long, { ...spooky, style: "music", maxMinutes: 10 }).rejected.length).toBeGreaterThan(0);
    expect(judge(long, spooky).rejected).toEqual([]);
    expect(judge(long, spooky, "haunted house ambience ghosts whispers").rejected).toEqual([]);
    // Still no reactions, nothing above the channel's own limit, and nothing tiny.
    expect(judge({ ...long, title: "Haunted house ambience REACTION" }, spooky).rejected[0]).toContain("reaction");
    expect(judge({ ...long, duration: 7200 }, spooky).rejected[0]).toContain("too long");
    expect(judge({ ...long, duration: 20 }, spooky).rejected).toContain("too short");
    // A proper long atmosphere clip beats a 50-second one.
    expect(judge(long, spooky).score).toBeGreaterThan(judge({ ...long, duration: 50 }, spooky).score);
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

  it("seeds the starter channels into the channel list, and an IPTV refresh keeps them", () => {
    ctx.mix.seed();
    ctx.mix.seed();
    const mixes = ctx.channels.list().filter((c) => c.mix);
    expect(mixes.map((c) => [c.number, c.name])).toEqual([
      [390, "Clubland TV"],
      [391, "House TV"],
      [392, "Halloween TV"],
      [393, "Spooky TV"],
    ]);
    // Spooky TV is the one atmosphere channel: long clips rather than music videos.
    expect(ctx.mix.store.channels().filter((c) => c.style === "ambience").map((c) => c.name)).toEqual(["Spooky TV"]);
    expect(mixes.every((c) => c.category === "music")).toBe(true);
    ctx.channels.replace([channel("bbc-one", { number: 101 })], []);
    expect(ctx.channels.list().map((c) => c.id)).toEqual(["bbc-one", "mix:clubland-tv", "mix:house-tv", "mix:halloween-tv", "mix:spooky-tv"]);
  });

  it("finds videos for a channel's picks, downloads them and schedules them", async () => {
    const c = ctx.mix.create({ name: "Test TV", brief: "x", picks: ["Alpha - One", "Beta - Two", "Gamma - Three"], target: 3 });
    expect(c.number).toBe(394);
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

describe("telling uploads of the same song apart", () => {
  it("finds the song whoever uploaded it", () => {
    expect(songKey({ title: "HUNTR/X - What It Sounds Like (Official Lyric Video) | KPop Demon Hunters" })).toBe("what it sounds like");
    expect(songKey({ title: "“What It Sounds Like” Clip | KPop Demon Hunters" })).toBe("what it sounds like");
    expect(songKey({ title: "“Takedown” Song – K-POP DEMON HUNTERS Clip (2025)" })).toBe("takedown");
    expect(songKey({ title: "anything", track: "Your Idol" })).toBe(songKey({ title: "Saja Boys - Your Idol (MV)" }));
    expect(songKey({ title: "Wham! - Last Christmas (Official 4K Video)" })).not.toBe(songKey({ title: "Mariah Carey - All I Want For Christmas Is You" }));
  });
});

describe("video files already on the NAS", () => {
  it("names a video from its file name", () => {
    expect(titleFromFile("/m/Cascada - Everytime We Touch (Official Video).mkv")).toEqual({ title: "Cascada - Everytime We Touch", artist: "Cascada", track: "Everytime We Touch" });
    expect(titleFromFile("/m/Spooky_Ghosts.Ambience [1080p].mp4")).toEqual({ title: "Spooky Ghosts Ambience" });
  });

  it("links a folder's videos onto a channel, plays them from where they are and never deletes them", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mix-nas-"));
    const media = path.join(tmp, "nas");
    const folder = path.join(media, "Halloween");
    await mkdir(path.join(folder, "More"), { recursive: true });
    for (const f of ["Ghosts - Boo.mkv", "Witches - Cackle.mp4", "More/Bats - Flap.webm", "notes.txt"]) await writeFile(path.join(folder, f), "video");
    await writeFile(path.join(tmp, "outside.mkv"), "video");
    const ctx = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: media, log: silent, ytdlp: null, mixPauseMs: 0, mixMinFreeBytes: 0, mixCropDetect: async () => "", mixProbe: async () => ({ durationS: 240, height: 1080, fps: 25 }) });
    try {
      const c = ctx.mix.create({ name: "Spooky TV", brief: "x", picks: ["x - y"], target: 3 });
      const root = await ctx.mix.browseNas();
      expect(root.folders.map((f) => f.name)).toEqual([await import("node:fs/promises").then((m) => m.realpath(media))]);
      const listing = await ctx.mix.browseNas(folder);
      expect(listing.folders.map((f) => f.name)).toEqual(["More"]);
      expect(listing.files.map((f) => f.name)).toEqual(["Ghosts - Boo.mkv", "Witches - Cackle.mp4"]);
      await expect(ctx.mix.browseNas(tmp)).rejects.toThrow(/isn't on the NAS/);

      const res = await ctx.mix.addFiles(c.id, [folder, path.join(tmp, "outside.mkv")]);
      expect(res.added).toBe(3);
      expect(res.skipped).toHaveLength(1);
      const entries = ctx.mix.store.entries(c.id);
      expect(entries.map((e) => [e.video.status, e.video.source, e.video.artist])).toEqual(
        expect.arrayContaining([
          ["ready", "nas", "Ghosts"],
          ["ready", "nas", "Witches"],
          ["ready", "nas", "Bats"],
        ]),
      );
      // Adding the same folder again changes nothing.
      expect((await ctx.mix.addFiles(c.id, [folder])).added).toBe(0);
      const tuned = ctx.mix.tuneIn(c.id);
      expect(tuned).not.toBeNull();
      expect(ctx.mix.filePath(tuned!.first.videoId)).toMatch(/Halloween/);
      // Taking one off (and so out of the store) leaves the file alone.
      const boo = entries.find((e) => e.video.artist === "Ghosts")!.video;
      await ctx.mix.removeVideo(c.id, boo.id);
      expect(existsSync(path.join(folder, "Ghosts - Boo.mkv"))).toBe(true);
    } finally {
      ctx.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("searching deeper and hung downloads", () => {
  it("carries on down a search's results over passes until the channel is full", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mix-deep-"));
    const pages: string[] = [];
    // 25 results a page, only two of them good enough (the rest are SD).
    const run: Run = async (args) => {
      if (args[0] === "--version") return { code: 0, stdout: "2026.10.01\n", stderr: "" };
      const search = args.find((a) => a.startsWith("ytsearch"));
      if (!search) return { code: 1, stdout: "", stderr: "ERROR: unexpected" };
      const items = args.includes("--playlist-items") ? args[args.indexOf("--playlist-items") + 1]! : "1:25";
      pages.push(items);
      const from = Number(items.split(":")[0]);
      const lines = Array.from({ length: 25 }, (_, i) => {
        const n = from + i;
        return JSON.stringify({ id: `vid${n}`, title: `Singer ${n} - Song ${n} (Official Video)`, duration: 200, height: n % 25 === 1 || n % 25 === 2 ? 2160 : 360 });
      });
      return { code: 0, stdout: lines.join("\n"), stderr: "" };
    };
    const ctx = new HubContext({ dataDir: tmp, mediaRoot: tmp, log: silent, ytdlp: run, mixPauseMs: 0, mixMinFreeBytes: 0 });
    try {
      const c = ctx.mix.create({ name: "Festive TV", brief: "x", queries: ["festive songs"], target: 10 });
      expect(await ctx.mix.curate(c.id)).toBeGreaterThan(0);
      expect(pages).toEqual(["1:25", "26:50", "51:75"]);
      const first = ctx.mix.store.entries(c.id).length;
      expect(first).toBeLessThan(10);
      // The next pass starts where this one stopped, and fills it.
      await ctx.mix.curate(c.id);
      expect(pages[3]).toBe("76:100");
      expect(ctx.mix.store.entries(c.id).length).toBe(10);
      expect(new Set(ctx.mix.store.entries(c.id).map((e) => e.video.id)).size).toBe(10);
    } finally {
      ctx.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("stops a download that goes quiet", async () => {
    const run: Run = (_args, opts) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    const yt = new YtDlp(run);
    yt.stallMs = 30;
    await expect(yt.download("https://example.com/v", "v", os.tmpdir(), { minHeight: 720, maxHeight: 2160 })).rejects.toThrow(/stalled/);
  });
});

describe("YouTube playlists on a channel", () => {
  it("finds the playlist in a link", () => {
    expect(playlistId("https://www.youtube.com/playlist?list=PLabcdefghijkl")).toBe("PLabcdefghijkl");
    expect(playlistId("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijkl&index=2")).toBe("PLabcdefghijkl");
    expect(playlistId("https://music.youtube.com/playlist?list=OLAK5uy_abcdefghij")).toBe("OLAK5uy_abcdefghij");
    expect(playlistId("PLabcdefghijkl")).toBe("PLabcdefghijkl");
    expect(playlistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(playlistId("https://example.com/playlist?list=PLabcdefghijkl")).toBeUndefined();
    expect(playlistId("not a link")).toBeUndefined();
  });

  /** A pretend yt-dlp whose playlist holds whatever `items` holds when it's read. */
  function playlistYtDlp() {
    const state = {
      title: "Gary's Party",
      items: [] as Record<string, unknown>[],
      broken: "",
      failDownload: new Set<string>(),
      reads: 0,
    };
    const run: Run = async (args) => {
      if (args[0] === "--version") return { code: 0, stdout: "2026.10.01\n", stderr: "" };
      if (args.includes("--flat-playlist")) {
        state.reads++;
        expect(args).toContain("--playlist-end");
        if (state.broken) return { code: 1, stdout: "", stderr: `ERROR: [youtube:tab] PLparty12345: ${state.broken}` };
        return { code: 0, stdout: JSON.stringify({ id: "PLparty12345", title: state.title, _type: "playlist", entries: state.items }) + "\n", stderr: "" };
      }
      if (args.includes("--print")) {
        const url = args[args.length - 1]!;
        const id = url.split("v=")[1]!;
        if (state.failDownload.has(id)) return { code: 1, stdout: "", stderr: "ERROR: [youtube] x: Requested format is not available" };
        const out = args[args.indexOf("-o") + 1]!.replace("%(ext)s", "mkv");
        await writeFile(out, "video");
        return { code: 0, stdout: `DONE\t${out}\t1080\t25\t210\n`, stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "ERROR: unexpected" };
    };
    const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Artist ${id} - Song ${id}`, url: `https://www.youtube.com/watch?v=${id}`, duration: 210, ...extra });
    return { run, state, item };
  }

  it("downloads every video in a playlist, keeps up with changes to it and lets go of it", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mix-playlist-"));
    const yt = playlistYtDlp();
    const ctx = new HubContext({ dataDir: tmp, mediaRoot: tmp, log: silent, ytdlp: yt.run, mixPauseMs: 0, mixMinFreeBytes: 0, mixCropDetect: async () => "" });
    try {
      yt.state.items = [yt.item("aaa"), yt.item("bbb"), yt.item("ccc"), { id: "ddd", title: "[Private video]", url: "https://www.youtube.com/watch?v=ddd" }, yt.item("eee", { duration: 3600 }), yt.item("fff", { live_status: "is_live" })];
      // A channel made from nothing but a playlist.
      expect(() => ctx.mix.create({ name: "Bad", playlist: "https://example.com/x" })).toThrow(/playlist link/);
      const c = ctx.mix.create({ name: "Party TV", playlist: "https://www.youtube.com/watch?v=aaa&list=PLparty12345" });
      expect(ctx.mix.store.channel(c.id)?.playlists?.map((p) => p.id)).toEqual(["PLparty12345"]);
      expect(ctx.mix.info(ctx.mix.store.channel(c.id)!).playlists![0]!.syncing).toBe(true);

      expect(await ctx.mix.syncPlaylist(c.id, "PLparty12345")).toEqual({ added: 3, removed: 0 });
      let info = ctx.mix.info(ctx.mix.store.channel(c.id)!);
      const pl = info.playlists![0]!;
      expect(pl.title).toBe("Gary's Party");
      expect(pl.total).toBe(6);
      expect(pl.skipped).toEqual(["1 private or deleted", "1 longer than 10 min", "1 a live stream"]);
      expect(pl.counts).toEqual({ queued: 3, downloading: 0, ready: 0, failed: 0 });
      expect(info.goal).toBe(3);
      // Queued in the playlist's order.
      const queued = ctx.mix.store.entries(c.id).map((e) => e.video);
      expect([...queued].sort((a, b) => a.addedAt - b.addedAt).map((v) => v.id)).toEqual(["aaa", "bbb", "ccc"]);
      expect(ctx.mix.store.entries(c.id)[0]!.origin).toBe("playlist: Gary's Party");
      // A playlist-only channel doesn't search YouTube for more.
      expect(await ctx.mix.curate(c.id)).toBe(0);

      yt.state.failDownload.add("ccc");
      for (const id of ["aaa", "bbb", "ccc"]) await ctx.mix.download(id);
      info = ctx.mix.info(ctx.mix.store.channel(c.id)!);
      expect(info.playlists![0]!.counts).toEqual({ queued: 0, downloading: 0, ready: 2, failed: 1 });
      expect(info.playlists![0]!.failures).toEqual([{ title: "Artist ccc – Song ccc", error: "No version at 720p or better" }]);
      expect(ctx.mix.tuneIn(c.id)).not.toBeNull();
      expect(ctx.channels.get(c.id)?.mix).toEqual({ ready: 2, target: 2 });

      // Later: a video added to the playlist and one taken out of it. Reading it again with
      // `retry` (Sync now) gives the failed one another go.
      yt.state.items = [yt.item("bbb"), yt.item("ccc"), yt.item("ggg")];
      yt.state.failDownload.clear();
      const aaaFile = ctx.mix.filePath("aaa")!;
      expect(await ctx.mix.syncPlaylist(c.id, "PLparty12345", true)).toEqual({ added: 1, removed: 1 });
      expect(ctx.mix.store.entries(c.id).map((e) => e.video.id).sort()).toEqual(["bbb", "ccc", "ggg"]);
      expect(existsSync(aaaFile)).toBe(false);
      expect(ctx.mix.store.video("ccc")?.status).toBe("queued");
      expect(ctx.guide.onChannel(c.id, Date.now(), 50).some((p) => p.videoId === "aaa")).toBe(false);

      // A video taken off by hand isn't put back by the next read.
      await ctx.mix.removeVideo(c.id, "ggg");
      await ctx.mix.syncPlaylist(c.id, "PLparty12345");
      expect(ctx.mix.store.entries(c.id).map((e) => e.video.id)).not.toContain("ggg");
      expect(ctx.mix.info(ctx.mix.store.channel(c.id)!).playlists![0]!.skipped).toEqual(["1 taken off by hand"]);

      // A playlist that's gone private says so, and its videos stay.
      yt.state.broken = "This playlist is private";
      await ctx.mix.syncPlaylist(c.id, "PLparty12345");
      expect(ctx.mix.store.channel(c.id)!.playlists![0]!.error).toMatch(/private.*public or unlisted/);
      expect(ctx.mix.store.entries(c.id)).toHaveLength(2);
      yt.state.broken = "";
      await ctx.mix.syncPlaylist(c.id, "PLparty12345");
      expect(ctx.mix.store.channel(c.id)!.playlists![0]!.error).toBeUndefined();

      // Followed again: no second copy, just another read.
      ctx.mix.followPlaylist(c.id, "https://www.youtube.com/playlist?list=PLparty12345");
      expect(ctx.mix.store.channel(c.id)!.playlists).toHaveLength(1);
      await expect(ctx.mix.addVideo(c.id, { url: "https://www.youtube.com/playlist?list=PLparty12345" })).rejects.toThrow(/playlist link/);

      // Letting go takes its videos (and their files) away.
      for (const id of ["bbb", "ccc"]) await ctx.mix.download(id);
      const bbbFile = ctx.mix.filePath("bbb")!;
      expect(existsSync(bbbFile)).toBe(true);
      await ctx.mix.unfollowPlaylist(c.id, "PLparty12345");
      expect(ctx.mix.store.entries(c.id)).toEqual([]);
      expect(ctx.mix.store.channel(c.id)!.playlists).toBeUndefined();
      expect(existsSync(bbbFile)).toBe(false);
    } finally {
      ctx.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("puts playlist videos on top of a searching channel's target, and can keep them when unfollowed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mix-playlist2-"));
    const yt = playlistYtDlp();
    const fake = fakeYtDlp();
    const run: Run = (args, opts) => (args.includes("--flat-playlist") || args.includes("--print") ? yt.run(args, opts) : fake.run(args, opts));
    const ctx = new HubContext({ dataDir: tmp, mediaRoot: tmp, log: silent, ytdlp: run, mixPauseMs: 0, mixMinFreeBytes: 0, mixCropDetect: async () => "" });
    try {
      yt.state.items = [yt.item("p1"), yt.item("p2")];
      const c = ctx.mix.create({ name: "Mixed TV", brief: "x", picks: ["Alpha - One", "Beta - Two"], target: 2 });
      ctx.mix.followPlaylist(c.id, "PLparty12345");
      await ctx.mix.syncPlaylist(c.id, "PLparty12345");
      // The playlist doesn't fill the target: the Hub still finds its two.
      expect(await ctx.mix.curate(c.id)).toBe(2);
      expect(ctx.mix.store.entries(c.id)).toHaveLength(4);
      // The target (at least 5) plus the playlist's two.
      expect(ctx.mix.info(ctx.mix.store.channel(c.id)!).goal).toBe(7);
      await ctx.mix.unfollowPlaylist(c.id, "PLparty12345", true);
      expect(ctx.mix.store.entries(c.id)).toHaveLength(4);
      expect(ctx.mix.store.video("p1")).toBeDefined();
    } finally {
      ctx.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("reads a followed playlist from the work loop when it's added", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-mix-playlist3-"));
    const yt = playlistYtDlp();
    yt.state.items = [yt.item("x1"), yt.item("x2")];
    const ctx = new HubContext({ dataDir: tmp, mediaRoot: tmp, log: silent, ytdlp: yt.run, mixPauseMs: 0, mixMinFreeBytes: 0, mixCropDetect: async () => "" });
    try {
      await ctx.mix.start();
      const c = ctx.mix.create({ name: "Loop TV", playlist: "PLparty12345" });
      for (let i = 0; i < 200 && ctx.mix.store.entries(c.id).filter((e) => e.video.status === "ready").length < 2; i++) await new Promise((r) => setTimeout(r, 20));
      expect(ctx.mix.store.entries(c.id).map((e) => e.video.status)).toEqual(["ready", "ready"]);
      expect(yt.state.reads).toBe(1);
      // Read again once six hours have gone by, not before.
      ctx.mix.queuePlaylistSyncs(Date.now() + 60_000);
      ctx.mix.queuePlaylistSyncs(Date.now() + 7 * 3_600_000);
      for (let i = 0; i < 100 && yt.state.reads < 2; i++) await new Promise((r) => setTimeout(r, 20));
      expect(yt.state.reads).toBe(2);
    } finally {
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
    await pairAsTv(app);
  });
  afterAll(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("lists the demo channels and plays one as a queue of videos", async () => {
    const list = (await app.inject({ url: "/api/mix-channels", headers: family })).json<MixOverview>();
    expect(list.channels.map((c) => c.name)).toEqual(["Clubland TV", "House TV", "Halloween TV", "Spooky TV"]);
    expect(list.channels[0]!.counts.ready).toBeGreaterThan(20);
    // Storage per channel and in total; a video on two channels counts once.
    expect(list.channels[0]!.readyBytes).toBeGreaterThan(0);
    expect(list.totals.ready).toBeLessThanOrEqual(list.channels.reduce((n, c) => n + c.counts.ready, 0));
    expect(list.totals.bytes).toBeGreaterThanOrEqual(list.channels[0]!.readyBytes);
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

  it("follows and lets go of a playlist over the API", async () => {
    const id = encodeURIComponent("mix:house-tv");
    const bad = await app.inject({ method: "POST", url: `/api/mix-channels/${id}/playlists`, headers: family, payload: { url: "https://www.youtube.com/watch?v=abc" } });
    expect(bad.statusCode).toBe(400);
    const kids = await app.inject({ method: "POST", url: `/api/mix-channels/${id}/playlists`, headers: { "x-profile": "kids" }, payload: { url: "PLabcdefghijkl" } });
    expect(kids.statusCode).toBe(403);
    const res = await app.inject({ method: "POST", url: `/api/mix-channels/${id}/playlists`, headers: family, payload: { url: "https://www.youtube.com/playlist?list=PLabcdefghijkl" } });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ id: string }>().id).toBe("PLabcdefghijkl");
    const one = (await app.inject({ url: `/api/mix-channels/${id}`, headers: family })).json<{ channel: { playlists?: { id: string; counts: unknown }[] } }>();
    expect(one.channel.playlists?.map((p) => p.id)).toEqual(["PLabcdefghijkl"]);
    expect((await app.inject({ method: "POST", url: `/api/mix-channels/${id}/playlists/PLabcdefghijkl/sync`, headers: family })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/mix-channels/${id}/playlists/PLabcdefghijkl?keep=1`, headers: family })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/mix-channels/${id}/playlists/PLabcdefghijkl`, headers: family })).statusCode).toBe(404);
  });
});
