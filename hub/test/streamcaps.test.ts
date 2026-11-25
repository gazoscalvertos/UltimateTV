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

  it("skips HDR and Dolby Vision files a phone without 10-bit or DV decoding cannot show", () => {
    const hdr = { ...s("hdr", 1080, "hevc"), quality: { height: 1080, hdr: "hdr10" as const, codec: "hevc" as const, audio: "aac" as const } };
    const dv5 = { ...s("dv5", 1080, "hevc"), quality: { height: 1080, hdr: "dv" as const, dvProfile: 5, codec: "hevc" as const, audio: "aac" as const } };
    const sdr = s("sdr", 1080, "h264");
    expect(chooseForDevice([hdr, dv5, sdr], { maxHeight: 2160, features: [] }).chosen?.id).toBe("sdr");
    expect(chooseForDevice([hdr, dv5, sdr], { maxHeight: 2160, features: ["10bit"] }).chosen?.id).toBe("hdr");
    expect(chooseForDevice([dv5, sdr], { maxHeight: 2160, features: ["10bit"] }).chosen?.id).toBe("sdr");
    expect(chooseForDevice([hdr], undefined).chosen?.id).toBe("hdr");
    expect(capsFromHeaders({ "x-max-height": "1080", "x-features": "10bit,dv" })?.features).toEqual(["10bit", "dv"]);
  });

  it("falls back to the first version, marked as not fitting, when nothing does", () => {
    const r = chooseForDevice([list[0]!], { maxHeight: 1080 }, 120);
    expect(r).toEqual({ chosen: list[0], fits: false });
  });
});
