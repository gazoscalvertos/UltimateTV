import { describe, expect, it } from "vitest";
import { CODEC_CHECKS, chromiumVersion, renderMatrix, validateReport } from "../src/index.js";
import { sampleReport } from "./fixtures.js";

describe("validateReport", () => {
  it("accepts a well-formed report", () => {
    expect(validateReport(sampleReport())).toEqual([]);
  });

  it("rejects non-objects and missing fields", () => {
    expect(validateReport(null)).toEqual(["report must be an object"]);
    const problems = validateReport({ schema: 2, codecs: "x" });
    expect(problems).toContain("schema must be 1");
    expect(problems).toContain("codecs must be an array");
    expect(problems).toContain("device is required");
  });

  it("rejects unknown support values", () => {
    const report = sampleReport();
    (report.codecs[0] as { mse: string }).mse = "yes";
    expect(validateReport(report)).toContain("codecs entries need mse and canPlayType support values");
  });
});

describe("chromiumVersion", () => {
  it("reads Chrome and Chromium versions", () => {
    expect(chromiumVersion("Mozilla/5.0 Chrome/108.0.5359.215 Safari/537.36")).toBe("108.0.5359.215");
    expect(chromiumVersion("Mozilla/5.0 Chromium/87.0 Safari")).toBe("87.0");
    expect(chromiumVersion("Mozilla/5.0 Firefox/120")).toBeNull();
  });
});

describe("renderMatrix", () => {
  it("renders codec labels, skipped keys and clip results", () => {
    const md = renderMatrix(sampleReport());
    expect(md).toContain("# Capability matrix: Living room 85U7");
    expect(md).toContain("| HEVC Main10 (MKV) | Yes | Yes |");
    expect(md).toContain("| AV1 Main 10-bit L5.1 | No | No |");
    expect(md).toContain("| Guide | not received | - |");
    expect(md).toContain("| Back | click only (cursor mode) | - |");
    expect(md).toContain("keydown 13 Enter");
    expect(md).toContain("| dv-p8.mkv | Yes | 3840×2160 | - | dolby-vision | smooth | atmos |");
  });
});

describe("CODEC_CHECKS", () => {
  it("has unique ids", () => {
    const ids = CODEC_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
