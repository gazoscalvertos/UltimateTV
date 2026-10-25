// The phone's Stats page: the Hub's and the box's health in one answer, with plain warnings for
// anything that looks wrong (a hot CPU, a full disk, dropped frames, a broken IPTV login).

import type { HostStats, IptvSourceStatus, PlaybackSample, StatsWarning } from "@ultimatetv/shared";
import type { StoredBoxReport } from "./diagnostics.js";

export interface WarningInput {
  now: number;
  hub: HostStats;
  box: StoredBoxReport | null;
  sources: { name: string; status?: IptvSourceStatus }[];
  connections: { used: number; limit: number };
  hardwareTranscode: boolean | null;
  hubErrors: string[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);

function hostWarnings(h: HostStats, where: "box" | "hub", name: string): StatsWarning[] {
  const out: StatsWarning[] = [];
  const memUsed = pct(h.memory.totalMb - h.memory.availableMb, h.memory.totalMb);
  if (memUsed >= 90) out.push({ level: "warn", where, text: `${name} memory is ${memUsed}% used` });
  if ((h.cpu.usagePct ?? 0) >= 90) out.push({ level: "warn", where, text: `${name} CPU is busy (${h.cpu.usagePct}%)` });
  const hot = h.temperatures.filter((t) => t.celsius >= 90);
  if (hot.length) out.push({ level: "bad", where, text: `${name} is running hot: ${hot.map((t) => `${t.name} ${t.celsius}°C`).join(", ")}` });
  for (const d of h.disks) {
    if (d.totalGb > 0 && d.freeGb / d.totalGb < 0.1) out.push({ level: d.freeGb / d.totalGb < 0.03 ? "bad" : "warn", where, text: `${name} ${d.label} disk is nearly full (${d.freeGb} GB free)` });
  }
  return out;
}

/** Frame and sync problems, from the change across the box's last few playback samples. */
function playbackWarnings(now: PlaybackSample | null, samples: PlaybackSample[]): StatsWarning[] {
  if (!now || now.status !== "playing") return [];
  const out: StatsWarning[] = [];
  const first = samples.slice(-6)[0];
  const dropped = (now.frames?.dropped ?? 0) - (first?.frames?.dropped ?? 0);
  const late = (now.frames?.decoderDropped ?? 0) - (first?.frames?.decoderDropped ?? 0);
  if (dropped > 5) out.push({ level: "warn", where: "playback", text: `${dropped} frames dropped in the last minute (the screen couldn't keep up)` });
  if (late > 5) out.push({ level: "warn", where: "playback", text: `${late} frames dropped by the decoder in the last minute (the box couldn't decode fast enough)` });
  if (now.avsyncMs !== undefined && Math.abs(now.avsyncMs) > 100) out.push({ level: "warn", where: "playback", text: `Sound and picture are ${Math.abs(now.avsyncMs)} ms apart` });
  if (now.bufferS !== undefined && now.bufferS < 2) out.push({ level: "warn", where: "playback", text: `Only ${now.bufferS} s buffered: the stream is arriving slowly` });
  if (now.video?.hwdec === "no") out.push({ level: "warn", where: "playback", text: "Decoding in software, not on the graphics chip" });
  if (now.match === null && now.video?.fps && now.display?.refreshHz && Math.abs(now.display.refreshHz / now.video.fps - Math.round(now.display.refreshHz / now.video.fps)) > 0.01) {
    out.push({ level: "info", where: "playback", text: `The screen (${now.display.refreshHz} Hz) isn't matched to the video (${now.video.fps} fps), so motion may judder` });
  }
  return out;
}

export function statsWarnings(input: WarningInput): StatsWarning[] {
  const out: StatsWarning[] = [];
  const report = input.box?.report;
  if (!input.box) out.push({ level: "warn", where: "box", text: "The box hasn't reported to the Hub yet" });
  else {
    const ageMin = Math.round((input.now - Date.parse(input.box.receivedAt)) / 60_000);
    if (ageMin > 10) out.push({ level: "warn", where: "box", text: `The box last reported ${ageMin} minutes ago. Is it on?` });
  }
  if (report?.host) out.push(...hostWarnings(report.host, "box", "The box's"));
  const info = report?.info as { cec?: { connected?: boolean } } | undefined;
  if (info && info.cec && !info.cec.connected) out.push({ level: "info", where: "box", text: "The TV remote (HDMI-CEC) isn't connected" });
  if (report) out.push(...playbackWarnings(report.now, report.samples));

  out.push(...hostWarnings(input.hub, "hub", "The Hub's"));
  for (const s of input.sources) {
    if (s.status && !s.status.ok) out.push({ level: "bad", where: "hub", text: `${s.name}: ${s.status.error ?? "the last channel load failed"}` });
  }
  if (input.connections.limit > 0 && input.connections.used >= input.connections.limit) {
    out.push({ level: "info", where: "hub", text: `All ${input.connections.limit} IPTV connection${input.connections.limit === 1 ? " is" : "s are"} in use` });
  }
  if (input.hardwareTranscode === false) out.push({ level: "info", where: "hub", text: "The Hub can't use the graphics chip (no /dev/dri), so recordings can't be converted in hardware" });
  if (input.hubErrors.length) out.push({ level: "warn", where: "hub", text: `${input.hubErrors.length} error${input.hubErrors.length === 1 ? "" : "s"} in the Hub's recent log` });
  const order = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
