// What a playing device can show and decode, and picking the stream that fits it.
//
// The Android client (a Fire TV stick above all) sends X-Max-Height, X-Max-Bitrate (kbit/s) and
// X-Codecs on every request. Without them the Hub picked the first ready version in its ranking,
// which prefers the biggest: a 1080p-only stick got a 60 GB 4K HEVC remux, which either would not
// decode, ran on a software decoder, or direct-played 80 Mbit/s over Wi-Fi and took a minute to
// fill its buffer. With them the Hub takes the best version the device can actually play.

import type { StreamCandidate } from "@ultimatetv/shared";

export interface DeviceCaps {
  /** Tallest picture the screen and decoder show, in pixels. */
  maxHeight?: number;
  /** Highest video bitrate, in kbit/s. */
  maxBitrateKbps?: number;
  /** Hardware-decoded video codecs ("h264", "hevc", ...). Empty or absent means no limit. */
  codecs?: string[];
}

const int = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 240 && n <= 100_000 ? Math.round(n) : undefined;
};

/** Reads the three headers; anything missing or odd is left out rather than guessed. */
export function capsFromHeaders(h: Record<string, string | string[] | undefined>): DeviceCaps | undefined {
  const one = (k: string) => (Array.isArray(h[k]) ? h[k]![0] : (h[k] as string | undefined));
  const maxHeight = int(one("x-max-height"));
  const maxBitrateKbps = int(one("x-max-bitrate"));
  const codecs = (one("x-codecs") ?? "")
    .toLowerCase()
    .split(",")
    .map((c) => c.trim())
    .filter((c) => /^[a-z0-9]{2,8}$/.test(c));
  if (!maxHeight && !maxBitrateKbps && !codecs.length) return undefined;
  return { ...(maxHeight ? { maxHeight } : {}), ...(maxBitrateKbps ? { maxBitrateKbps } : {}), ...(codecs.length ? { codecs } : {}) };
}

/** Average video bitrate in kbit/s from the file size and runtime, when both are known. */
export function bitrateKbps(s: StreamCandidate, runtimeMin: number | undefined): number | undefined {
  const bytes = s.quality?.sizeBytes;
  if (!bytes || !runtimeMin) return undefined;
  return Math.round((bytes * 8) / (runtimeMin * 60) / 1000);
}

/** Why this version will not play well on the device, or undefined when it fits. */
export function misfit(s: StreamCandidate, caps: DeviceCaps, runtimeMin?: number): string | undefined {
  const q = s.quality;
  if (!q) return undefined;
  if (caps.maxHeight && q.height > caps.maxHeight + 16) return `${q.height}p is taller than the ${caps.maxHeight}p this device shows`;
  if (caps.codecs?.length && q.codec !== "unknown" && !caps.codecs.includes(q.codec)) return `${q.codec} is not decoded in hardware here`;
  const rate = bitrateKbps(s, runtimeMin);
  if (caps.maxBitrateKbps && rate && rate > caps.maxBitrateKbps) return `about ${Math.round(rate / 1000)} Mbit/s is more than this device can stream`;
  return undefined;
}

/**
 * The version to start: the first ready one in the Hub's ranking that fits the device, so the
 * household's order of preference still decides among the ones that will play. Where nothing fits
 * the first ready one is returned with `fits: false` and the playback code can transcode it.
 */
export function chooseForDevice(streams: StreamCandidate[], caps: DeviceCaps | undefined, runtimeMin?: number): { chosen?: StreamCandidate; fits: boolean } {
  const ready = streams.filter((s) => s.ready);
  const first = ready[0] ?? streams[0];
  if (!caps) return first ? { chosen: first, fits: true } : { fits: true };
  const fit = ready.find((s) => !misfit(s, caps, runtimeMin));
  if (fit) return { chosen: fit, fits: true };
  return first ? { chosen: first, fits: false } : { fits: true };
}
