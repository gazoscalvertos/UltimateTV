// Reads quality from free-form stream names (file names, AIOStreams descriptions, Jellyfin
// media info) and ranks candidates for one-press Play. The box outputs HDR10 (Linux can't send a
// Dolby Vision signal), so DV only helps when the file also carries an HDR10 base layer.

import type { AudioFormat, HdrFormat, SourceKind, StreamCandidate, StreamQuality, VideoCodec } from "./domain.js";

export function parseQuality(text: string): StreamQuality {
  const t = ` ${text.replace(/[._\[\]()|]/g, " ")} `;
  const has = (re: RegExp) => re.test(t);

  let height = 0;
  if (has(/\b(2160p|4k|uhd)\b/i)) height = 2160;
  else if (has(/\b1440p\b/i)) height = 1440;
  else if (has(/\b(1080p|1080i|fhd)\b/i)) height = 1080;
  else if (has(/\b(720p|hd ?ready)\b/i)) height = 720;
  else if (has(/\b(576p|576i|480p|sd)\b/i)) height = 576;

  const dv = has(/\b(dv|dovi|dolby ?vision)\b/i);
  const hdr10plus = has(/\b(hdr10\+|hdr10 ?plus|hdr10p)/i);
  const hdr10 = hdr10plus || has(/\bhdr(10)?\b/i);
  let hdr: HdrFormat = "sdr";
  if (dv) hdr = "dv";
  else if (hdr10plus) hdr = "hdr10plus";
  else if (hdr10) hdr = "hdr10";
  else if (has(/\bhlg\b/i)) hdr = "hlg";

  let dvProfile: number | undefined;
  const profile = /\b(?:dv|dovi)[ -]?p(?:rofile)? ?([578])(?:\.\d)?\b/i.exec(t) ?? /\bprofile ?([578])\b/i.exec(t);
  if (profile?.[1]) dvProfile = Number(profile[1]);
  else if (dv && hdr10) dvProfile = 8; // "DV HDR10" releases carry an HDR10 base layer.
  else if (dv && has(/\bremux\b/i)) dvProfile = 7;
  else if (dv) dvProfile = 5;

  let codec: VideoCodec = "unknown";
  if (has(/\b(x265|h ?265|hevc)\b/i)) codec = "hevc";
  else if (has(/\bav1\b/i)) codec = "av1";
  else if (has(/\b(x264|h ?264|avc)\b/i)) codec = "h264";
  else if (has(/\bvp9\b/i)) codec = "vp9";
  else if (has(/\bmpeg-?2\b/i)) codec = "mpeg2";

  let audio: AudioFormat = "unknown";
  if (has(/\batmos\b/i)) audio = has(/\btrue ?hd\b/i) ? "truehd" : "atmos";
  else if (has(/\btrue ?hd\b/i)) audio = "truehd";
  else if (has(/\bdts[ :-]?x\b/i)) audio = "dtsx";
  else if (has(/\bdts[ -]?hd( ?ma)?\b/i)) audio = "dtshd";
  else if (has(/\bdts\b/i)) audio = "dts";
  else if (has(/\b(ddp|dd\+|e-?ac-?3|eac3)/i)) audio = "eac3";
  else if (has(/\b(ac-?3|dd ?[257]\.?[01]|dd)\b/i)) audio = "ac3";
  else if (has(/\bflac\b/i)) audio = "flac";
  else if (has(/\baac\b/i)) audio = "aac";
  else if (has(/\bopus\b/i)) audio = "opus";
  else if (has(/\bmp3\b/i)) audio = "mp3";

  const ch = /(?<![0-9.])([257])[ .]([01])(?![0-9])/.exec(t);
  const channels = ch ? Number(ch[1]) + Number(ch[2]) : undefined;

  let sizeBytes: number | undefined;
  const size = /(\d+(?:[.,]\d+)?) ?(TB|GB|GiB|MB|MiB)\b/i.exec(text);
  if (size?.[1] && size[2]) {
    const n = Number(size[1].replace(",", "."));
    const unit = size[2].toUpperCase();
    const mult = unit.startsWith("T") ? 1024 ** 4 : unit.startsWith("G") ? 1024 ** 3 : 1024 ** 2;
    sizeBytes = Math.round(n * mult);
  }

  const result: StreamQuality = { height, hdr, codec, audio };
  if (dvProfile !== undefined) result.dvProfile = dvProfile;
  if (channels !== undefined) result.channels = channels;
  if (sizeBytes !== undefined) result.sizeBytes = sizeBytes;
  if (has(/\bremux\b/i)) result.remux = true;
  if (has(/\b(cam|hdcam|camrip|telesync|hdts|ts ?rip|telecine)\b/i)) result.cam = true;
  return result;
}

export interface RankingPrefs {
  maxSizeGb: number;
  avoidDvProfile5: boolean;
  /** ISO 639-2 audio language the household prefers ("eng"); IPTV copies tagged for another language rank last. */
  preferredLang?: string;
}

/** IPTV language tags and the ISO 639-2 language they mean. */
const LANG_TAGS: Record<string, string> = {
  EN: "eng", UK: "eng", GB: "eng", US: "eng", ENG: "eng",
  FR: "fre", FRA: "fre", VF: "fre", VOSTFR: "fre",
  DE: "ger", GER: "ger", ES: "spa", SPA: "spa", LAT: "spa", IT: "ita", ITA: "ita",
  PT: "por", BR: "por", NL: "dut", PL: "pol", TR: "tur", AR: "ara", RU: "rus",
  SE: "swe", NO: "nor", DK: "dan", FI: "fin", GR: "gre", RO: "rum", HU: "hun", CZ: "cze",
  IN: "hin", HIN: "hin", SC: "sco", ALB: "alb", AL: "alb", EX: "yug", EXYU: "yug",
};

/**
 * The language an IPTV title is tagged with, from its prefix ("4K-FR-HDR - Title", "|DE| Title",
 * "EN: Title"). Only the prefix is read, so a film called "IT" isn't taken for Italian.
 */
export function languageTag(name: string): string | undefined {
  const m = /^\s*\|([A-Z]{2,6})\|/.exec(name) ?? /^\s*((?:[A-Z0-9+]{1,6}[-_ ]){0,3}[A-Z0-9+]{1,6})\s*[-:|]\s+\S/.exec(name);
  if (!m) return undefined;
  for (const token of m[1]!.split(/[-_ |]/)) {
    const lang = LANG_TAGS[token];
    if (lang) return lang;
  }
  return undefined;
}

const KIND_SCORE: Record<SourceKind, number> = {
  nas: 40,
  recording: 40,
  jellyfin: 40,
  torbox: 20,
  addon: 15,
  xtream: 5,
};

const AUDIO_SCORE: Record<AudioFormat, number> = {
  atmos: 30, // DD+ Atmos goes to the TV untouched.
  truehd: 24, // Decoded on the box: full surround, no height channels on TV speakers anyway.
  dtsx: 22,
  dtshd: 22,
  eac3: 20,
  ac3: 14,
  dts: 14,
  flac: 12,
  opus: 8,
  aac: 8,
  mp3: 2,
  unknown: 6,
};

/** Higher is better. Exposed for tests and the "More options" list. */
export function scoreStream(c: StreamCandidate, prefs: RankingPrefs): number {
  const q = c.quality;
  let score = KIND_SCORE[c.kind];
  if (c.ready) score += 50;

  score += q.height >= 2160 ? 60 : q.height >= 1440 ? 45 : q.height >= 1080 ? 40 : q.height >= 720 ? 20 : q.height > 0 ? 5 : 15;

  switch (q.hdr) {
    case "hdr10plus":
    case "hdr10":
      score += 30;
      break;
    case "dv":
      // P7/P8 play their HDR10 base layer. P5 has none and needs converting by mpv.
      score += q.dvProfile === 5 ? (prefs.avoidDvProfile5 ? 5 : 22) : 30;
      break;
    case "hlg":
      score += 25;
      break;
    case "sdr":
      break;
  }

  score += AUDIO_SCORE[q.audio];
  if (q.remux) score += 5;
  if (q.cam) score -= 500;
  // A dubbed copy in another language is never what was wanted, however good the picture.
  const lang = prefs.preferredLang ? (c.lang ?? languageTag(c.detail ?? "")) : undefined;
  if (lang && lang !== prefs.preferredLang) score -= 200;
  if (q.sizeBytes && prefs.maxSizeGb > 0 && q.sizeBytes > prefs.maxSizeGb * 1024 ** 3) score -= 80;
  return score;
}

export function rankStreams(candidates: StreamCandidate[], prefs: RankingPrefs): StreamCandidate[] {
  return candidates
    .map((c) => ({ ...c, score: scoreStream(c, prefs) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/** Short badges for the UI ("4K", "HDR", "Dolby Vision", "Atmos"). */
export function qualityBadges(q: StreamQuality): string[] {
  const badges: string[] = [];
  if (q.height >= 2160) badges.push("4K");
  else if (q.height >= 1080) badges.push("HD");
  if (q.hdr === "dv") badges.push("Dolby Vision");
  else if (q.hdr === "hdr10plus") badges.push("HDR10+");
  else if (q.hdr === "hdr10") badges.push("HDR");
  else if (q.hdr === "hlg") badges.push("HLG");
  if (q.audio === "atmos" || q.audio === "truehd" || q.audio === "dtsx") badges.push(q.audio === "dtsx" ? "DTS:X" : "Atmos");
  else if (q.channels && q.channels >= 6) badges.push(`${q.channels - 1}.1`);
  return badges;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
