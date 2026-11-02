// The on-box self-test (issue #105): the catalogue the TV walks, and the Hub's copy of the last run.
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SELF_TEST_KEYS,
  SELF_TEST_KEY_LABELS,
  SELF_TEST_STEPS,
  selfTestSummary,
  selfTestTally,
  type SelfTestReport,
} from "@ultimatetv/shared";
import { Db } from "../src/db.js";
import { cleanSelfTestReport, SelfTestStore } from "../src/selftest.js";

const at = "2026-11-02T20:15:00.000Z";

/** A finished run with every step answered yes. */
function run(over: Partial<SelfTestReport> = {}): SelfTestReport {
  return {
    at,
    hostname: "tvbox",
    appVersion: "0.9.0",
    results: SELF_TEST_STEPS.map((s) => ({ id: s.id, label: s.label, answer: "yes", observed: { display: "HDMI-A-1", width: 3840, height: 2160, refreshHz: 23.976, hdr: true, codec: "yuv420p10le/eac3", hwdec: "vaapi" } })),
    missingKeys: [],
    ...over,
  };
}

describe("the self-test catalogue", () => {
  it("lists the steps in the order they are watched, each with a question", () => {
    expect(SELF_TEST_STEPS.map((s) => s.id)).toEqual(["hdr10", "hlg", "fps-23976", "fps-50", "sound-surround", "sound-stereo"]);
    for (const s of SELF_TEST_STEPS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(0);
      expect(s.ask).toMatch(/\?$/);
      expect(s.clip).toMatch(/^selftest-.+\.mkv$/);
    }
  });

  it("plays the frame-rate steps at the rates they are named after", () => {
    const byId = new Map(SELF_TEST_STEPS.map((s) => [s.id, s]));
    expect(byId.get("fps-23976")!.fps).toBe(23.976);
    expect(byId.get("fps-50")!.fps).toBe(50);
    // The HDR steps are about the transfer, not the rate, so they play at 25 like live TV.
    expect(byId.get("hdr10")!.fps).toBe(25);
  });

  it("asks for every button the app can act on, with a name for each", () => {
    expect(SELF_TEST_KEYS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SELF_TEST_KEYS).size).toBe(SELF_TEST_KEYS.length);
    for (const k of SELF_TEST_KEYS) expect(SELF_TEST_KEY_LABELS[k], k).toBeTruthy();
    expect(SELF_TEST_KEYS).toContain("up");
    expect(SELF_TEST_KEYS).toContain("ok");
    expect(SELF_TEST_KEYS).toContain("red");
    expect(SELF_TEST_KEYS).toContain("digit9");
  });
});

describe("summarising a run", () => {
  it("counts yes, no, skipped and missing keys", () => {
    const report = run({
      results: [
        { id: "hdr10", label: "4K HDR10", answer: "yes", observed: {} },
        { id: "hlg", label: "HLG", answer: "no", observed: {}, note: "picture went grey" },
        { id: "fps-23976", label: "23.976", answer: "skipped", observed: {} },
        { id: "fps-50", label: "50", answer: "yes", observed: {} },
      ],
      missingKeys: ["record", "blue"],
    });
    expect(selfTestTally(report)).toEqual({ yes: 2, no: 1, skipped: 1, missing: 2 });
    expect(selfTestSummary(report)).toBe("2 of 4 said yes · 1 said no · 1 skipped · 2 keys missing");
  });

  it("says nothing about problems when there are none", () => {
    expect(selfTestSummary(run())).toBe("6 of 6 said yes");
  });

  it("speaks of one key in the singular", () => {
    expect(selfTestSummary(run({ missingKeys: ["record"] }))).toContain("1 key missing");
  });
});

describe("the Hub's copy of a run", () => {
  let dir = "";
  let db: Db;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "utv-selftest-"));
    db = new Db(":memory:");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps the last run and hands it back", () => {
    const store = new SelfTestStore(db);
    expect(store.get()).toBeNull();
    store.save(run());
    expect(store.get()!.results.length).toBe(SELF_TEST_STEPS.length);
    // Only the last one is kept: after a change of setting, an older pass would mislead.
    store.save(run({ at: "2026-11-03T08:00:00.000Z", missingKeys: ["record"] }));
    expect(store.get()!.at).toBe("2026-11-03T08:00:00.000Z");
    expect(store.get()!.missingKeys).toEqual(["record"]);
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("survives a restart, because it is in the database", () => {
    new SelfTestStore(db).save(run());
    expect(new SelfTestStore(db).get()!.hostname).toBe("tvbox");
  });
});

describe("cleaning a report sent by the TV", () => {
  it("keeps a real one as it is", () => {
    const cleaned = cleanSelfTestReport(run())!;
    expect(cleaned.at).toBe(at);
    expect(cleaned.hostname).toBe("tvbox");
    expect(cleaned.appVersion).toBe("0.9.0");
    expect(cleaned.results.length).toBe(SELF_TEST_STEPS.length);
    expect(cleaned.results[0]!.observed).toEqual({ display: "HDMI-A-1", width: 3840, height: 2160, refreshHz: 23.976, hdr: true, codec: "yuv420p10le/eac3", hwdec: "vaapi" });
  });

  it("refuses anything without a real time", () => {
    expect(cleanSelfTestReport(null)).toBeNull();
    expect(cleanSelfTestReport("hello")).toBeNull();
    expect(cleanSelfTestReport({})).toBeNull();
    expect(cleanSelfTestReport({ at: "not a date", results: [] })).toBeNull();
  });

  it("drops steps it doesn't know and answers it doesn't understand", () => {
    const cleaned = cleanSelfTestReport({
      at,
      results: [
        { id: "hdr10", label: "4K HDR10", answer: "yes", observed: {} },
        { id: "nonsense", answer: "yes", observed: {} },
        { id: "hlg", answer: "maybe", observed: {} },
        { id: "fps-50", answer: "no", observed: {}, note: "  juddered   badly  " },
      ],
    })!;
    expect(cleaned.results.map((r) => r.id)).toEqual(["hdr10", "hlg", "fps-50"]);
    // An answer that isn't yes/no is treated as skipped, not as a pass.
    expect(cleaned.results[1]!.answer).toBe("skipped");
    expect(cleaned.results[2]!.note).toBe("juddered badly");
    // The label always comes from the catalogue, never from the sender.
    expect(cleaned.results[0]!.label).toBe("4K HDR10");
  });

  it("keeps only shared keys, once each", () => {
    const cleaned = cleanSelfTestReport(run({ missingKeys: ["record", "record", "nonsense", "blue"] as never }))!;
    expect(cleaned.missingKeys).toEqual(["record", "blue"]);
  });

  it("throws away nonsense in the observation rather than storing it", () => {
    const cleaned = cleanSelfTestReport({
      at,
      results: [{ id: "hdr10", answer: "yes", observed: { display: 42, width: -3, height: "big", refreshHz: 1e9, hdr: "yes", codec: 7 } }],
    })!;
    expect(cleaned.results[0]!.observed).toEqual({});
  });

  it("cuts a very long note rather than growing without end", () => {
    const cleaned = cleanSelfTestReport({ at, results: [{ id: "hdr10", answer: "no", observed: {}, note: "x".repeat(5000) }] })!;
    expect(cleaned.results[0]!.note!.length).toBe(400);
  });

  it("accepts a run with no keys asked for", () => {
    const cleaned = cleanSelfTestReport({ at, results: [] })!;
    expect(cleaned.missingKeys).toEqual([]);
    expect(cleaned.hostname).toBeUndefined();
  });
});

describe("the self-test on the wire", () => {
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
    tmp = await mkdtemp(path.join(os.tmpdir(), "utv-selftest-routes-"));
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
    const posted = await app.inject({ method: "POST", url: "/api/selftest", payload: run() });
    expect(posted.statusCode).toBe(200);
    expect(posted.json<{ ok: true; report: SelfTestReport }>().report.hostname).toBe("tvbox");
    const got = await app.inject({ method: "GET", url: "/api/selftest" });
    expect(got.json<{ report: SelfTestReport | null }>().report!.results.length).toBe(SELF_TEST_STEPS.length);
    expect(context.selfTest.get()!.at).toBe(at);
  });

  it("refuses a body that isn't a report", async () => {
    await start();
    const bad = await app.inject({ method: "POST", url: "/api/selftest", payload: { hello: "there" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: string }>().error).toBe("Not a self-test report");
  });

  it("shows the run in the text diagnostics, and says when there hasn't been one", async () => {
    await start();
    const before = await app.inject({ method: "GET", url: "/api/diagnostics?format=text" });
    expect(before.body).toContain("No self-test run yet");
    await app.inject({ method: "POST", url: "/api/selftest", payload: run({ missingKeys: ["record"] }) });
    const after = await app.inject({ method: "GET", url: "/api/diagnostics?format=text" });
    expect(after.body).toContain("== Self-test ==");
    expect(after.body).toContain("on tvbox");
    expect(after.body).toContain("6 of 6 said yes · 1 key missing");
    expect(after.body).toContain("4K HDR10");
    expect(after.body).toContain("3840×2160");
    expect(after.body).toContain("keys that never arrived: record");
  });

  it("puts the run in the phone's Stats feed", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/selftest", payload: run() });
    const stats = await app.inject({ method: "GET", url: "/api/stats" });
    const body = stats.json<{ selfTest: SelfTestReport | null }>();
    expect(body.selfTest!.hostname).toBe("tvbox");
  });

  it("forgets a run when asked", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/selftest", payload: run() });
    const cleared = await app.inject({ method: "DELETE", url: "/api/selftest" });
    expect(cleared.statusCode).toBe(200);
    const got = await app.inject({ method: "GET", url: "/api/selftest" });
    expect(got.json<{ report: SelfTestReport | null }>().report).toBeNull();
  });
});


describe("the self-test on the phone's Stats page", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const page = readFileSync(path.join(root, "hub/public/setup/stats.html"), "utf8");

  it("has a section of its own, and fills it from the Stats feed", () => {
    expect(page).toContain('<section id="selftest">');
    expect(page).toContain('<div id="selftest-body">');
    expect(page).toContain('$("selftest-body").innerHTML = selfTestHtml(stats.selfTest)');
  });

  it("says what to do when there hasn't been a run", () => {
    expect(page).toContain("No self-test run yet");
    expect(page).toContain("Settings › About › Self-test");
  });

  it("shows the answer, the mode the box was in and any button that never arrived", () => {
    expect(page).toContain("Buttons that never arrived");
    expect(page).toContain("Every button arrived.");
    // The mode line is the point: "Yes · 4K HDR10 — HDMI-A-1 · 3840×2160 · 23.976 Hz · HDR".
    expect(page).toContain("o?.hdr === undefined ? \"\" : o.hdr ? \"HDR\" : \"SDR\"");
    expect(page).toContain("${o.width}×${o.height}");
  });
});
