import { describe, expect, it } from "vitest";
import { parseVainfo, systemReport } from "../src/system.js";

describe("systemReport", () => {
  it("returns empty results when ffmpeg is missing", async () => {
    const report = await systemReport(async () => {
      throw new Error("ENOENT");
    });
    expect(report.ffmpeg).toBeNull();
    expect(report.hwaccels).toEqual([]);
    expect(report.checks).toEqual({ av1HardwareDecode: false, hevcHardwareEncode: false, hevc10HardwareEncode: false });
  });

  it("parses ffmpeg hwaccels", async () => {
    const report = await systemReport(async (_cmd, args) =>
      args.includes("-hwaccels")
        ? "Hardware acceleration methods:\nvaapi\nqsv\n"
        : "ffmpeg version 5.1.6-0+deb12u1 Copyright (c)\nbuilt with gcc",
    );
    expect(report.ffmpeg).toBe("ffmpeg version 5.1.6-0+deb12u1 Copyright (c)");
    expect(report.hwaccels).toEqual(["vaapi", "qsv"]);
  });
});

describe("parseVainfo", () => {
  it("reads the driver and profiles from N150-style output", () => {
    const out = [
      "Trying display: drm",
      "vainfo: VA-API version: 1.17 (libva 2.12.0)",
      "vainfo: Driver version: Intel iHD driver for Intel(R) Gen Graphics - 23.1.1 ()",
      "vainfo: Supported profile and entrypoints",
      "      VAProfileHEVCMain               :\tVAEntrypointEncSlice",
      "      VAProfileHEVCMain10             :\tVAEntrypointVLD",
      "      VAProfileAV1Profile0            :\tVAEntrypointVLD",
    ].join("\n");
    const { driver, profiles } = parseVainfo(out);
    expect(driver).toBe("Intel iHD driver for Intel(R) Gen Graphics - 23.1.1 ()");
    expect(profiles).toEqual([
      "VAProfileHEVCMain : VAEntrypointEncSlice",
      "VAProfileHEVCMain10 : VAEntrypointVLD",
      "VAProfileAV1Profile0 : VAEntrypointVLD",
    ]);
  });
});
