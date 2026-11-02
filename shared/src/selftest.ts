// The on-box self-test (issue #105): a handful of short clips the box generates itself, each one
// looking for a particular thing the TV has to get right, plus a check that every button on the
// remote arrives. The Hub keeps no opinions about hardware: the box says what it generated, the UI
// asks the questions and records what the box reported at the time, and the answer set is sent to
// the Hub so it can be read on the phone and in /api/diagnostics.

/** What a step is asking the household to judge. */
export type SelfTestKind = "picture" | "sound" | "keys";

export type SelfTestId =
  | "hdr10"
  | "hlg"
  | "fps-23976"
  | "fps-50"
  | "sound-surround"
  | "sound-stereo"
  | "keys";

/**
 * One thing to check. `clip` is the file the box generates for it (absent for the key test, which
 * needs no picture); `fps` is passed to mpv so the box can pick a matching screen mode, which is the
 * whole point of the refresh-rate steps.
 */
export interface SelfTestStep {
  id: SelfTestId;
  kind: SelfTestKind;
  /** Short name, e.g. "4K HDR10". */
  label: string;
  /** What the clip is, in plain words, so the question makes sense. */
  detail: string;
  /** The yes/no question. */
  ask: string;
  clip?: string;
  fps?: number;
}

/**
 * Steps in the order the wizard runs them: picture first (the mode changes are visible), then sound,
 * then the remote, which is the only step that needs the household to press things rather than watch.
 */
export const SELF_TEST_STEPS: SelfTestStep[] = [
  {
    id: "hdr10",
    kind: "picture",
    label: "4K HDR10",
    detail: "A four-second 4K picture that says it is HDR10.",
    ask: "Does the TV say HDR (or HDR10) is on, with a bright, colourful picture?",
    clip: "selftest-hdr10.mkv",
    fps: 25,
  },
  {
    id: "hlg",
    kind: "picture",
    label: "HLG",
    detail: "The same picture marked as HLG, which is what iPlayer and live TV use.",
    ask: "Does the TV still show it as HDR, without the picture going grey or washed out?",
    clip: "selftest-hlg.mkv",
    fps: 25,
  },
  {
    id: "fps-23976",
    kind: "picture",
    label: "23.976 frames a second",
    detail: "A slowly moving bar at film speed, so judder is easy to spot.",
    ask: "Does the picture move smoothly, with no stutter or regular jerk?",
    clip: "selftest-23976.mkv",
    fps: 23.976,
  },
  {
    id: "fps-50",
    kind: "picture",
    label: "50 frames a second",
    detail: "A fast-moving bar at the speed British TV uses.",
    ask: "Does the box switch to a 50 Hz mode, and does the bar look smooth?",
    clip: "selftest-50.mkv",
    fps: 50,
  },
  {
    id: "sound-surround",
    kind: "sound",
    label: "Surround sound",
    detail: "A short tone in Dolby Digital Plus 5.1, passed straight through to the TV or soundbar.",
    ask: "Did you hear the tone, and does the TV or soundbar say it is receiving surround?",
    clip: "selftest-surround.mkv",
  },
  {
    id: "sound-stereo",
    kind: "sound",
    label: "Stereo sound",
    detail: "The same tone as plain stereo, which every TV handles.",
    ask: "Did you hear the tone from the left, then the right?",
    clip: "selftest-stereo.mkv",
  },
];

/** The buttons the key test waits for: every key a remote can send that the app acts on. */
export const SELF_TEST_KEYS = [
  "up",
  "down",
  "left",
  "right",
  "ok",
  "back",
  "home",
  "guide",
  "info",
  "playPause",
  "stop",
  "rewind",
  "fastForward",
  "record",
  "red",
  "green",
  "yellow",
  "blue",
  "channelUp",
  "channelDown",
  "digit0",
  "digit1",
  "digit2",
  "digit3",
  "digit4",
  "digit5",
  "digit6",
  "digit7",
  "digit8",
  "digit9",
] as const;

export type SelfTestKey = (typeof SELF_TEST_KEYS)[number];

/** How to read a key back in plain words, for the list of ones that never arrived. */
export const SELF_TEST_KEY_LABELS: Record<SelfTestKey, string> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  ok: "OK",
  back: "Back",
  home: "Home",
  guide: "Guide",
  info: "Info",
  playPause: "Play/Pause",
  stop: "Stop",
  rewind: "Rewind",
  fastForward: "Fast forward",
  record: "Record",
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
  channelUp: "Channel up",
  channelDown: "Channel down",
  digit0: "0",
  digit1: "1",
  digit2: "2",
  digit3: "3",
  digit4: "4",
  digit5: "5",
  digit6: "6",
  digit7: "7",
  digit8: "8",
  digit9: "9",
};

/** What the household said. */
export type SelfTestAnswer = "yes" | "no" | "skipped";

/** What the box reported while the clip was playing, so a wrong answer can be explained later. */
export interface SelfTestObservation {
  display?: string;
  width?: number;
  height?: number;
  refreshHz?: number;
  hdr?: boolean;
  codec?: string;
  hwdec?: string;
}

export interface SelfTestResult {
  id: SelfTestId;
  label: string;
  answer: SelfTestAnswer;
  /** The mode and picture the box was in when the question was asked. */
  observed: SelfTestObservation;
  /** Free text the household or the app added, e.g. "no sound at all". */
  note?: string;
}

/** The whole run, as the Hub stores it and the phone shows it. */
export interface SelfTestReport {
  /** ISO time the run finished. */
  at: string;
  /** The box's hostname, when the box knew it. */
  hostname?: string;
  appVersion?: string;
  results: SelfTestResult[];
  /** Keys the tests asked for that never reached the app. */
  missingKeys: SelfTestKey[];
}

/** How many answers were yes, no or skipped, for the one-line summary. */
export function selfTestTally(report: SelfTestReport): { yes: number; no: number; skipped: number; missing: number } {
  let yes = 0;
  let no = 0;
  let skipped = 0;
  for (const r of report.results) {
    if (r.answer === "yes") yes++;
    else if (r.answer === "no") no++;
    else skipped++;
  }
  return { yes, no, skipped, missing: report.missingKeys.length };
}

/** The one-line summary shown beside the report, e.g. "9 of 10 said yes · 1 said no · 2 keys missing". */
export function selfTestSummary(report: SelfTestReport): string {
  const t = selfTestTally(report);
  const parts = [`${t.yes} of ${report.results.length} said yes`];
  if (t.no) parts.push(`${t.no} said no`);
  if (t.skipped) parts.push(`${t.skipped} skipped`);
  if (t.missing) parts.push(`${t.missing} ${t.missing === 1 ? "key" : "keys"} missing`);
  return parts.join(" · ");
}

/** The day written the way the rest of the app writes it, e.g. "Sat 26 Oct 21:04". */
export function selfTestWhen(at: string, locale = "en-GB"): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at;
  return new Date(ms).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
/** What the box could see while the clip was playing, for the report. */
/** What the box could see while a clip was playing, as recorded with the answer. */
export interface SelfTestPlayed {
  id: SelfTestId;
  display?: string;
  width?: number;
  height?: number;
  refreshHz?: number;
  hdr?: boolean;
  codec?: string;
  hwdec?: string;
}


/** What the UI asks the box to do: get ready, play one step, then stop. */
export type SelfTestCall =
  | { action: "prepare" }
  | { action: "play"; id: SelfTestId }
  | { action: "stop" };

/** What `prepare` answers: the steps the box could actually make clips for. */
export interface SelfTestReady {
  ready: SelfTestId[];
  missing: SelfTestId[];
}
