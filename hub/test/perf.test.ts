// The UI timings (issue #108): the shape the TV sends, and the Hub's copy of the last run.
//
// The point of these tests is that the Hub only ever keeps numbers it can read back and never
// arbitrary text from a TV: a report is a diagnostic, not a way to put a line of nonsense in front
// of a household on the Stats page.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERF_TARGETS, type PerfReport } from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { cleanPerfReport, PerfStore } from "../src/perf.js";
import { renderDiagnostics } from "../src/diagnostics.js";

const at = "2026-11-03T18:00:00.000Z";

/** A run with every measurement taken, all inside their targets. */
function report(over: Partial<PerfReport> = {}): PerfReport {
  return {
    at,
    width: 3840,
    height: 2160,
    pixelRatio: 1,
    refreshHz: 60,
    appVersion: "0.10.0",
    device: "tvbox",
    samples: [
      { id: "boot", label: "Boot to \"Who's watching?\"", detail: "", ms: 2400, samples: 1, targetMs: PERF_TARGETS.boot },
      { id: "home", label: "Home, ready to take a key press", detail: "", ms: 420, samples: 1, targetMs: PERF_TARGETS.home },
      { id: "guide", label: "A guide step, key press to frame", detail: "", ms: 16, worstMs: 29, samples: 12, targetMs: PERF_TARGETS.guide },
      { id: "playback", label: "A frame while a film plays", detail: "", ms: 17, worstMs: 33, samples: 60, targetMs: PERF_TARGETS.playback },
    ],
    ...over,
  };
}

describe("cleaning what a TV sends", () => {
  it("keeps a real report as it was sent", () => {
    const cleaned = cleanPerfReport(report())!;
    expect(cleaned.at).toBe(at);
    expect(cleaned.width).toBe(3840);
    expect(cleaned.refreshHz).toBe(60);
    expect(cleaned.device).toBe("tvbox");
    expect(cleaned.samples.map((s) => s.id)).toEqual(["boot", "home", "guide", "playback"]);
  });

  it("always takes the target from the Hub's own table, never from the body", () => {
    const body = report();
    body.samples = body.samples.map((s) => ({ ...s, targetMs: 999_999 }));
    const cleaned = cleanPerfReport(body)!;
    expect(cleaned.samples.find((s) => s.id === "boot")!.targetMs).toBe(15_000);
    expect(cleaned.samples.find((s) => s.id === "guide")!.targetMs).toBe(20);
  });

  it("rejects anything that isn't a report", () => {
    expect(cleanPerfReport(null)).toBeNull();
    expect(cleanPerfReport("hello")).toBeNull();
    expect(cleanPerfReport({})).toBeNull();
    expect(cleanPerfReport({ at: "not a date", samples: [] })).toBeNull();
    expect(cleanPerfReport({ at })).not.toBeNull();
  });

  it("drops a measurement it doesn't know rather than storing a made-up name", () => {
    const body = report() as unknown as Record<string, unknown>;
    body.samples = [
      { id: "boot", label: "Boot", ms: 2000, samples: 1 },
      { id: "nonsense", label: "I made this up", ms: 5000, samples: 1 },
      { id: "home", label: "Home", ms: "soon", samples: 1 },
    ];
    const cleaned = cleanPerfReport(body)!;
    expect(cleaned.samples.map((s) => s.id)).toEqual(["boot"]);
  });

  it("clamps absurd numbers and tidies text", () => {
    const cleaned = cleanPerfReport({
      at,
      width: 99_999,
      height: -5,
      refreshHz: 0,
      appVersion: `  a\nvery   long\u0000 name  `.repeat(6),
      device: "x".repeat(500),
      notes: ["  a   note ", 42, "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"],
    })!;
    expect(cleaned.width).toBeUndefined();
    expect(cleaned.height).toBeUndefined();
    expect(cleaned.refreshHz).toBeUndefined();
    expect(cleaned.device!.length).toBe(100);
    expect(cleaned.appVersion!.length).toBeLessThanOrEqual(40);
    expect(cleaned.appVersion).not.toContain("\n");
    expect(cleaned.notes!.length).toBe(8);
    expect(cleaned.notes![0]).toBe("a note");
    // A sample with no measurement at all is dropped — there is nothing to clamp.
    expect(cleaned.samples).toEqual([]);
  });

  it("caps how many measurements and notes it will keep", () => {
    const many = Array.from({ length: 40 }, () => ({ id: "guide", label: "A guide step", ms: 10, samples: 3 }));
    const cleaned = cleanPerfReport({ at, samples: many, notes: Array.from({ length: 40 }, (_, i) => `note ${i}`) })!;
    expect(cleaned.samples.length).toBe(12);
    expect(cleaned.notes!.length).toBe(8);
  });
});

describe("the Hub's copy of the last run", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-perf-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("remembers the last run across a restart and can forget it", async () => {
    const db = new Db(path.join(tmp, "hub.db"));
    const store = new PerfStore(db);
    expect(store.get()).toBeNull();
    store.save(report());
    db.close();
    const again = new Db(path.join(tmp, "hub.db"));
    expect(new PerfStore(again).get()!.at).toBe(at);
    new PerfStore(again).clear();
    expect(new PerfStore(again).get()).toBeNull();
    again.close();
  });
});

describe("the timings in the diagnostics text", () => {
  const hub = { version: "0.10.0", uptimeS: 10, log: [], advertScan: { marked: 0, scanned: 0 } as never };

  it("has a section that says what was measured and what missed", () => {
    const text = renderDiagnostics(hub, null, null, report());
    expect(text).toContain("== How the TV app feels ==");
    expect(text).toContain(`${at} on tvbox (app 0.10.0) · 3840×2160 at 60 Hz · All 4 measurements are inside their targets.`);
    expect(text).toContain("ok: Home, ready to take a key press 420 ms (target 1500 ms, 1 sample)");
    expect(text).toContain("== Hub log ==");
  });

  it("says so plainly when no run has been made", () => {
    const text = renderDiagnostics(hub, null, null, null);
    expect(text).toContain("No timing run yet: Settings › About › Measure the UI.");
  });

  it("prints the notes, which is where a missing measurement is explained", () => {
    const text = renderDiagnostics(hub, null, null, report({ notes: ["Not measured: playing something hasn't happened since the TV app started."] }));
    expect(text).toContain("note: Not measured: playing something hasn't happened since the TV app started.");
  });
});

describe("the timings on the wire", () => {
  let tmp = "";
  let app!: Awaited<ReturnType<typeof import("../src/server.js").buildServer>>;

  const options = () => ({
    port: 0,
    host: "127.0.0.1",
    dataDir: path.join(tmp, "data"),
    clipsDir: path.join(tmp, "clips"),
    probeDir: path.join(tmp, "probe"),
    uiDir: path.join(tmp, "ui"),
    setupDir: path.join(tmp, "setup"),
    mediaRoot: tmp,
    demo: true,
  });

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-perf-routes-"));
  });
  afterEach(async () => {
    if (app) await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  /** A server with a paired TV, the way the real TV sends its report. */
  const start = async () => {
    const { HubContext } = await import("../src/context.js");
    const { buildServer } = await import("../src/server.js");
    const { silentLogger } = await import("../src/log.js");
    const { pairAsTv } = await import("./helpers.js");
    const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch, ytdlp: null });
    app = await buildServer(options(), { systemReport: async () => ({}) as never, context });
    await pairAsTv(app);
    return context;
  };

  it("takes a report from the TV and hands it back", async () => {
    const context = await start();
    const posted = await app.inject({ method: "POST", url: "/api/perf", payload: report() });
    expect(posted.statusCode).toBe(200);
    expect(posted.json<{ ok: true; report: PerfReport }>().report.device).toBe("tvbox");
    const got = await app.inject({ method: "GET", url: "/api/perf" });
    expect(got.json<{ report: PerfReport | null }>().report!.samples.length).toBe(4);
    expect(context.perf.get()!.at).toBe(at);
  });

  it("refuses a body that isn't a report", async () => {
    await start();
    const bad = await app.inject({ method: "POST", url: "/api/perf", payload: { hello: "there" } });
    expect(bad.statusCode).toBe(400);
  });

  it("forgets the last run when asked", async () => {
    const context = await start();
    await app.inject({ method: "POST", url: "/api/perf", payload: report() });
    expect(context.perf.get()).not.toBeNull();
    const gone = await app.inject({ method: "DELETE", url: "/api/perf" });
    expect(gone.statusCode).toBe(200);
    expect(context.perf.get()).toBeNull();
  });

  it("puts the run in the diagnostics, both as text and as JSON", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/perf", payload: report({ notes: ["measured on the TV in the front room"] }) });
    const text = await app.inject({ method: "GET", url: "/api/diagnostics?format=text" });
    expect(text.body).toContain("== How the TV app feels ==");
    expect(text.body).toContain("measured on the TV in the front room");
    const json = await app.inject({ method: "GET", url: "/api/diagnostics" });
    expect(json.json<{ perf: PerfReport | null }>().perf!.samples.length).toBe(4);
  });

  it("puts the run on the phone's Stats page", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/perf", payload: report() });
    const stats = await app.inject({ method: "GET", url: "/api/stats" });
    const body = stats.json<{ perf: PerfReport | null }>();
    expect(body.perf!.at).toBe(at);
    expect(body.perf!.samples.map((s) => s.id)).toContain("guide");
  });
});
