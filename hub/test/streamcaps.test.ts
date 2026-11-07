// Choosing a version the device can play (a 1080p Fire stick must not get the 4K remux).

import type { StreamCandidate } from "@ultimatetv/shared";
import { describe, expect, it } from "vitest";
import { capsFromHeaders, chooseForDevice, misfit } from "../src/streamcaps.js";

const s = (id: string, height: number, codec: "hevc" | "h264", sizeBytes?: number, ready = true): StreamCandidate => ({
  id,
  kind: "jellyfin",
  label: id,
  quality: { height, hdr: "sdr", codec, audio: "aac", ...(sizeBytes ? { sizeBytes } : {}) },
  ready,
  url: `/x/${id}`,
});

describe("device caps", () => {
  it("reads the headers and ignores rubbish", () => {
    expect(capsFromHeaders({ "x-max-height": "1080", "x-max-bitrate": "20000", "x-codecs": "h264, HEVC" })).toEqual({ maxHeight: 1080, maxBitrateKbps: 20000, codecs: ["h264", "hevc"] });
    expect(capsFromHeaders({ "x-max-height": "banana" })).toBeUndefined();
    expect(capsFromHeaders({})).toBeUndefined();
  });

  const list = [s("remux4k", 2160, "hevc", 60e9), s("hd", 1080, "hevc", 8e9), s("sd", 720, "h264", 2e9)];

  it("takes the top of the ranking when nothing is known", () => {
    expect(chooseForDevice(list, undefined).chosen?.id).toBe("remux4k");
  });

  it("skips a 4K remux on a 1080p device", () => {
    expect(chooseForDevice(list, { maxHeight: 1080 }, 120).chosen?.id).toBe("hd");
  });

  it("skips a codec the device does not decode, and a bitrate it cannot stream", () => {
    expect(chooseForDevice(list, { maxHeight: 1080, codecs: ["h264"] }, 120).chosen?.id).toBe("sd");
    expect(misfit(list[1]!, { maxBitrateKbps: 5000 }, 120)).toMatch(/Mbit/);
  });

  it("falls back to the first version, marked as not fitting, when nothing does", () => {
    const r = chooseForDevice([list[0]!], { maxHeight: 1080 }, 120);
    expect(r).toEqual({ chosen: list[0], fits: false });
  });
});
