// Capability probe: what the TV's browser can play, and the report it sends to the Hub.

export interface CodecCheck {
  id: string;
  label: string;
  /** Full MIME type with codecs, as passed to MediaSource.isTypeSupported / canPlayType. */
  mime: string;
  kind: "video" | "audio" | "stream";
}

/** Codec strings worth testing on VIDAA. Labels are what a person reads in the matrix. */
export const CODEC_CHECKS: CodecCheck[] = [
  { id: "h264-mp4", label: "H.264 High 5.1 (MP4)", mime: 'video/mp4; codecs="avc1.640033"', kind: "video" },
  { id: "h264-ts", label: "H.264 High (MPEG-TS)", mime: 'video/mp2t; codecs="avc1.640028"', kind: "video" },
  { id: "hevc-main10-hvc1", label: "HEVC Main10 L5.1 (hvc1, MP4)", mime: 'video/mp4; codecs="hvc1.2.4.L153.B0"', kind: "video" },
  { id: "hevc-main10-hev1", label: "HEVC Main10 L5.1 (hev1, MP4)", mime: 'video/mp4; codecs="hev1.2.4.L153.B0"', kind: "video" },
  { id: "hevc-mkv", label: "HEVC Main10 (MKV)", mime: 'video/x-matroska; codecs="hev1.2.4.L153.B0"', kind: "video" },
  { id: "dv-p5", label: "Dolby Vision Profile 5 (dvhe.05)", mime: 'video/mp4; codecs="dvhe.05.06"', kind: "video" },
  { id: "dv-p7", label: "Dolby Vision Profile 7 (dvhe.07)", mime: 'video/mp4; codecs="dvhe.07.06"', kind: "video" },
  { id: "dv-p8", label: "Dolby Vision Profile 8.1 (dvh1.08)", mime: 'video/mp4; codecs="dvh1.08.06"', kind: "video" },
  { id: "av1-10bit", label: "AV1 Main 10-bit L5.1", mime: 'video/mp4; codecs="av01.0.13M.10"', kind: "video" },
  { id: "vp9-hdr", label: "VP9 Profile 2 HDR (WebM)", mime: 'video/webm; codecs="vp09.02.51.10.01.09.16.16.09.00"', kind: "video" },
  { id: "aac", label: "AAC-LC", mime: 'audio/mp4; codecs="mp4a.40.2"', kind: "audio" },
  { id: "ac3", label: "Dolby Digital (AC-3)", mime: 'audio/mp4; codecs="ac-3"', kind: "audio" },
  { id: "eac3", label: "Dolby Digital Plus (E-AC-3, incl. Atmos)", mime: 'audio/mp4; codecs="ec-3"', kind: "audio" },
  { id: "truehd", label: "Dolby TrueHD", mime: 'audio/mp4; codecs="mlpa"', kind: "audio" },
  { id: "dts", label: "DTS core", mime: 'audio/mp4; codecs="dtsc"', kind: "audio" },
  { id: "dtshd", label: "DTS-HD MA", mime: 'audio/mp4; codecs="dtsh"', kind: "audio" },
  { id: "dtsx", label: "DTS:X", mime: 'audio/mp4; codecs="dtsx"', kind: "audio" },
  { id: "flac", label: "FLAC", mime: 'audio/mp4; codecs="flac"', kind: "audio" },
  { id: "opus", label: "Opus (WebM)", mime: 'audio/webm; codecs="opus"', kind: "audio" },
  { id: "hls", label: "HLS playlist (native)", mime: "application/vnd.apple.mpegurl", kind: "stream" },
];

export const DRM_SYSTEMS = [
  "com.widevine.alpha",
  "com.microsoft.playready",
  "com.microsoft.playready.recommendation",
  "org.w3.clearkey",
] as const;

/** Remote keys the app wants to use, in the order the probe asks for them. OK comes first so it can act as "skip". */
export const REMOTE_KEYS = [
  "OK",
  "Up",
  "Down",
  "Left",
  "Right",
  "Back",
  "Red",
  "Green",
  "Yellow",
  "Blue",
  "Guide",
  "Info",
  "Channel up",
  "Channel down",
  "Play",
  "Pause",
  "Play/Pause",
  "Stop",
  "Rewind",
  "Fast forward",
  "0",
  "1",
  "9",
] as const;

export type Support = "probably" | "maybe" | "no" | "error";

export interface CodecResult {
  id: string;
  mse: Support;
  canPlayType: Support;
}

export interface KeyResult {
  name: string;
  /** null when the person skipped it because the remote has no such key. */
  keyCode: number | null;
  key?: string;
  code?: string;
}

export interface ClipResult {
  clip: string;
  played: boolean;
  errorCode?: number;
  videoWidth?: number;
  videoHeight?: number;
  droppedFrames?: number;
  totalFrames?: number;
  startupMs?: number;
  /** What the person saw and heard, answered on the TV. */
  hdrBadge?: "dolby-vision" | "hdr10" | "hdr10plus" | "hlg" | "none" | "unsure";
  motion?: "smooth" | "judder" | "unsure";
  audio?: "atmos" | "surround" | "stereo" | "silent" | "unsure";
}

export interface ProbeReport {
  schema: 1;
  createdAt: string;
  label?: string;
  device: {
    userAgent: string;
    chromiumVersion: string | null;
    screen: { width: number; height: number; devicePixelRatio: number };
    viewport: { width: number; height: number };
    mediaQueries: Record<string, boolean>;
    webgl: { webgl1: boolean; webgl2: boolean; renderer: string | null };
    features: Record<string, boolean>;
    fps: number | null;
  };
  codecs: CodecResult[];
  drm: Record<string, boolean>;
  keys: KeyResult[];
  clips: ClipResult[];
}

const SUPPORT_VALUES: Support[] = ["probably", "maybe", "no", "error"];

/** Light structural check on a report posted by the TV. Returns a list of problems, empty when valid. */
export function validateReport(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) return ["report must be an object"];
  const r = value as Partial<ProbeReport>;
  if (r.schema !== 1) problems.push("schema must be 1");
  if (typeof r.createdAt !== "string") problems.push("createdAt must be a string");
  if (typeof r.device !== "object" || r.device === null) problems.push("device is required");
  else if (typeof r.device.userAgent !== "string") problems.push("device.userAgent must be a string");
  if (!Array.isArray(r.codecs)) problems.push("codecs must be an array");
  else if (r.codecs.some((c) => !SUPPORT_VALUES.includes(c?.mse) || !SUPPORT_VALUES.includes(c?.canPlayType)))
    problems.push("codecs entries need mse and canPlayType support values");
  if (typeof r.drm !== "object" || r.drm === null) problems.push("drm is required");
  if (!Array.isArray(r.keys)) problems.push("keys must be an array");
  if (!Array.isArray(r.clips)) problems.push("clips must be an array");
  return problems;
}

/** Pull the Chromium/Chrome major.minor version out of a user agent string. */
export function chromiumVersion(userAgent: string): string | null {
  const match = /(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/.exec(userAgent);
  return match?.[1] ?? null;
}

const SUPPORT_LABEL: Record<Support, string> = {
  probably: "Yes",
  maybe: "Maybe",
  no: "No",
  error: "Error",
};

/** Render a report as the Phase 0 capability matrix in Markdown. */
export function renderMatrix(report: ProbeReport): string {
  const d = report.device;
  const lines: string[] = [];
  lines.push(`# Capability matrix${report.label ? `: ${report.label}` : ""}`, "");
  lines.push(`Probed ${report.createdAt}.`, "");
  lines.push("## Device", "");
  lines.push("| Item | Value |", "|------|-------|");
  lines.push(`| Chromium | ${d.chromiumVersion ?? "unknown"} |`);
  lines.push(`| Screen | ${d.screen.width}×${d.screen.height} @ ${d.screen.devicePixelRatio}x |`);
  lines.push(`| Viewport | ${d.viewport.width}×${d.viewport.height} |`);
  lines.push(`| WebGL | ${d.webgl.webgl2 ? "WebGL 2" : d.webgl.webgl1 ? "WebGL 1" : "none"}${d.webgl.renderer ? ` (${d.webgl.renderer})` : ""} |`);
  lines.push(`| UI frame rate | ${d.fps === null ? "not measured" : `${d.fps} fps`} |`);
  for (const [query, matches] of Object.entries(d.mediaQueries)) lines.push(`| \`${query}\` | ${matches ? "Yes" : "No"} |`);
  for (const [feature, present] of Object.entries(d.features)) lines.push(`| ${feature} | ${present ? "Yes" : "No"} |`);
  lines.push(`| User agent | \`${d.userAgent}\` |`, "");

  lines.push("## Codecs", "");
  lines.push("| Format | MediaSource | canPlayType |", "|--------|-------------|-------------|");
  for (const result of report.codecs) {
    const label = CODEC_CHECKS.find((c) => c.id === result.id)?.label ?? result.id;
    lines.push(`| ${label} | ${SUPPORT_LABEL[result.mse]} | ${SUPPORT_LABEL[result.canPlayType]} |`);
  }
  lines.push("");

  lines.push("## DRM", "");
  lines.push("| Key system | Available |", "|------------|-----------|");
  for (const [system, ok] of Object.entries(report.drm)) lines.push(`| ${system} | ${ok ? "Yes" : "No"} |`);
  lines.push("");

  lines.push("## Remote keys", "");
  lines.push("| Key | keyCode | key / code |", "|-----|---------|------------|");
  for (const k of report.keys) {
    lines.push(`| ${k.name} | ${k.keyCode ?? "not on remote"} | ${[k.key, k.code].filter(Boolean).join(" / ") || "-"} |`);
  }
  lines.push("");

  lines.push("## Test clips", "");
  if (report.clips.length === 0) {
    lines.push("No clips were played.", "");
  } else {
    lines.push("| Clip | Played | Size | Dropped frames | HDR badge | Motion | Audio |");
    lines.push("|------|--------|------|----------------|-----------|--------|-------|");
    for (const c of report.clips) {
      const size = c.videoWidth ? `${c.videoWidth}×${c.videoHeight}` : "-";
      const dropped = c.totalFrames ? `${c.droppedFrames ?? 0}/${c.totalFrames}` : "-";
      const played = c.played ? "Yes" : `No${c.errorCode ? ` (error ${c.errorCode})` : ""}`;
      lines.push(`| ${c.clip} | ${played} | ${size} | ${dropped} | ${c.hdrBadge ?? "-"} | ${c.motion ?? "-"} | ${c.audio ?? "-"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
