import { describe, expect, it } from "vitest";
import type { StreamCandidate } from "../src/domain.js";
import { actionForKey } from "../src/keys.js";
import { languageTag, parseQuality, qualityBadges, rankStreams } from "../src/ranking.js";
import { normaliseChannelName, normaliseTitle } from "../src/text.js";

const c = (detail: string, extra: Partial<StreamCandidate> = {}): StreamCandidate => ({
  id: detail, kind: "torbox", label: "TorBox", detail, quality: parseQuality(detail), ready: true, url: "x", downloadable: true, ...extra,
});

describe("parseQuality", () => {
  it("reads resolution, HDR, codec, audio and size", () => {
    expect(parseQuality("Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.Atmos.7.1-GRP 61.2 GB")).toMatchObject({
      height: 2160, hdr: "dv", dvProfile: 8, codec: "hevc", audio: "truehd", channels: 8, remux: true, sizeBytes: Math.round(61.2 * 1024 ** 3),
    });
    expect(parseQuality("Movie 2023 2160p WEB-DL DV DDP5.1 Atmos H 265")).toMatchObject({ hdr: "dv", dvProfile: 5, audio: "atmos", channels: 6 });
    expect(parseQuality("Show S01E01 1080p WEB h264 AAC")).toMatchObject({ height: 1080, hdr: "sdr", codec: "h264", audio: "aac" });
    expect(parseQuality("Film HDCAM x264")).toMatchObject({ cam: true });
    expect(parseQuality("[TB⚡] 4K HDR10+ 💾 12.5 GB")).toMatchObject({ height: 2160, hdr: "hdr10plus", sizeBytes: Math.round(12.5 * 1024 ** 3) });
  });
});

describe("rankStreams", () => {
  const prefs = { maxSizeGb: 60, avoidDvProfile5: true };

  it("prefers a playable 4K HDR10 with Atmos over DV profile 5 and over 1080p", () => {
    const ranked = rankStreams([c("1080p WEB DDP5.1"), c("2160p WEB DV DDP5.1 Atmos"), c("2160p WEB HDR10 DDP5.1 Atmos")], prefs);
    expect(ranked.map((r) => r.detail)).toEqual(["2160p WEB HDR10 DDP5.1 Atmos", "2160p WEB DV DDP5.1 Atmos", "1080p WEB DDP5.1"]);
  });

  it("puts the local library and cached streams first and CAMs last", () => {
    const ranked = rankStreams([c("2160p HDR10 Atmos", { ready: false }), c("1080p DDP5.1", { kind: "jellyfin" }), c("2160p CAM")], prefs);
    expect(ranked[0]!.kind).toBe("jellyfin");
    expect(ranked.at(-1)!.detail).toBe("2160p CAM");
  });

  it("penalises files over the size limit", () => {
    const ranked = rankStreams([c("2160p REMUX HDR10 TrueHD 80 GB"), c("2160p HDR10 DDP5.1 Atmos 20 GB")], prefs);
    expect(ranked[0]!.detail).toContain("20 GB");
  });

  it("gives friendly badges", () => {
    expect(qualityBadges(parseQuality("2160p DV HDR10 TrueHD Atmos"))).toEqual(["4K", "Dolby Vision", "Atmos"]);
    expect(qualityBadges(parseQuality("1080p DDP5.1"))).toEqual(["HD", "5.1"]);
  });
});

describe("keys", () => {
  it("maps CEC-translated keys, keyboard keys and TV key codes", () => {
    expect(actionForKey({ key: "ArrowUp" })).toBe("up");
    expect(actionForKey({ key: "Enter" })).toBe("ok");
    expect(actionForKey({ key: "Escape" })).toBe("back");
    expect(actionForKey({ key: "F1" })).toBe("red");
    expect(actionForKey({ key: "F2" })).toBe("green");
    expect(actionForKey({ key: "7" })).toBe("digit7");
    expect(actionForKey({ key: "Unidentified", keyCode: 403 })).toBe("red");
    expect(actionForKey({ key: "PageUp" })).toBe("channelUp");
    expect(actionForKey({ key: "r", ctrlKey: true })).toBeNull();
  });
});

describe("text", () => {
  it("normalises titles and channel names", () => {
    expect(normaliseTitle("The Office (UK)")).toBe("office");
    expect(normaliseTitle("New: Silent Witness")).toBe("silent witness");
    expect(normaliseChannelName("UK: BBC 1 FHD")).toBe("bbc one");
    expect(normaliseChannelName("UK | Channel4 HD")).toBe("channel 4");
  });
});

describe("IPTV language tags", () => {
  it("reads the tag from the prefix only", () => {
    expect(languageTag("4K-FR-HDR - Une bataille après l'autre (2025)")).toBe("fre");
    expect(languageTag("|DE| Der Film")).toBe("ger");
    expect(languageTag("EN - One Battle After Another")).toBe("eng");
    expect(languageTag("FR | Films 4K")).toBe("fre");
    expect(languageTag("One Battle After Another (2025)")).toBeUndefined();
    expect(languageTag("The Batman - Part Two")).toBeUndefined();
  });

  it("ranks a dubbed 4K copy below an English 1080p one", () => {
    const base = { kind: "xtream" as const, label: "IPTV", ready: true, url: "u", downloadable: true };
    const fr = { ...base, id: "fr", detail: "4K-FR-HDR - Une bataille", quality: { height: 2160, hdr: "hdr10" as const, codec: "hevc" as const, audio: "unknown" as const } };
    const en = { ...base, id: "en", detail: "One Battle After Another", quality: { height: 1080, hdr: "sdr" as const, codec: "unknown" as const, audio: "unknown" as const } };
    expect(rankStreams([fr, en], { maxSizeGb: 0, avoidDvProfile5: true, preferredLang: "eng" })[0]!.id).toBe("en");
  });
});
