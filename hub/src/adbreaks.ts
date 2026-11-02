// Finding the advert breaks when comskip finds none (issue #73). comskip's defaults miss on some
// UK channels and IPTV re-encodes, and then ad skipping silently does nothing. As a fallback the
// Hub asks ffmpeg where the black frames and the silence are, and keeps the stretches that look
// like an advert break: between 1 and 6 minutes, black at both ends and silent across the middle.
//
// This is deliberately conservative. A wrong break skips part of the programme, so anything that
// isn't clearly a break is left alone, and the fallback only runs on a long recording that comskip
// found nothing in.

import type { AdBreak } from "@ultimatetv/shared";

/** A recording has to be at least this long before the fallback is worth trying. */
export const FALLBACK_MIN_RECORDING_MS = 20 * 60_000;
/** A break is never shorter than this. */
export const MIN_BREAK_MS = 60_000;
/** ...or longer than this. */
export const MAX_BREAK_MS = 6 * 60_000;
/** Black frames closer together than this are the same in/out point, not two. */
const MAX_BLACK_MS = 5_000;

export interface Span {
  startMs: number;
  endMs: number;
}

/** ffmpeg's `-vf blackdetect` lines: "black_start:598.5 black_end:599.2 black_duration:0.7". */
export function parseBlackdetect(stderr: string): Span[] {
  const out: Span[] = [];
  const re = /black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g;
  for (const m of stderr.matchAll(re)) {
    const startMs = Math.round(Number(m[1]) * 1000);
    const endMs = Math.round(Number(m[2]) * 1000);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    out.push({ startMs, endMs });
  }
  return out;
}

/**
 * ffmpeg's `-af silencedetect` lines: "silence_start: 598.2" then "silence_end: 954.8 | ...".
 * Silence still running when the file ends is ignored: it has no end, so nothing can bound it.
 */
export function parseSilencedetect(stderr: string): Span[] {
  const out: Span[] = [];
  let start: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      const ms = Math.round(Number(s[1]) * 1000);
      start = Number.isFinite(ms) ? Math.max(0, ms) : undefined;
      continue;
    }
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (!e || start === undefined) continue;
    const endMs = Math.round(Number(e[1]) * 1000);
    if (Number.isFinite(endMs) && endMs > start) out.push({ startMs: start, endMs });
    start = undefined;
  }
  return out;
}

/** The stretch between two black frames, if it is a break: silent across it, and the right length. */
function qualify(from: Span, to: Span, silence: readonly Span[]): AdBreak | null {
  const startMs = from.endMs;
  const endMs = to.startMs;
  const length = endMs - startMs;
  if (length < MIN_BREAK_MS || length > MAX_BREAK_MS) return null;
  // The whole middle has to be quiet: a fade to black has silence at one end, not across it.
  const covered = silence.some((s) => s.startMs <= startMs + 1000 && s.endMs >= endMs - 1000);
  return covered ? { startMs, endMs } : null;
}

/**
 * The advert breaks ffmpeg's detections add up to: black frames at both ends of a stretch that is
 * silent across the middle and between one and six minutes long. Sorted, and never overlapping.
 */
export function breaksFromBlackAndSilence(black: readonly Span[], silence: readonly Span[]): AdBreak[] {
  const frames = [...black].sort((a, b) => a.startMs - b.startMs);
  const out: AdBreak[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const from = frames[i]!;
    const to = frames[i + 1]!;
    // Only the black frames directly around a gap can bound it; a stray one inside is noise.
    if (to.startMs - from.endMs > MAX_BLACK_MS && to.startMs - from.endMs > MAX_BREAK_MS) continue;
    const found = qualify(from, to, silence);
    if (!found) continue;
    const last = out[out.length - 1];
    if (last && found.startMs < last.endMs) last.endMs = Math.max(last.endMs, found.endMs);
    else out.push(found);
  }
  return out;
}

/** The ffmpeg arguments that find black frames and silence, quiet enough to leave the box alone. */
export function detectArgs(file: string): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-nostdin",
    "-i",
    file,
    "-map",
    "0:v:0",
    "-vf",
    "blackdetect=d=0.4:pix_th=0.10",
    "-an",
    "-f",
    "null",
    "-",
  ];
}

/** The audio pass is separate so the video pass can run without decoding sound. */
export function detectAudioArgs(file: string): string[] {
  return ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0", "-af", "silencedetect=n=-35dB:d=2", "-vn", "-f", "null", "-"];
}
