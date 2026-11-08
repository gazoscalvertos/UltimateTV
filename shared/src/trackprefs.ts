// Remembering the audio and subtitle choice for a series (issue #228), and the delay controls
// (issue #223). The choice is stored as a language and a kind, never a track number, so it still
// fits the next episode whichever source (Jellyfin, TorBox, a recording) it comes from.

/** What a profile picked while watching a series (or a film). */
export interface TrackPref {
  /** Sound: a language, and whether it is the audio description track. */
  audio?: { lang: string; description?: boolean };
  /** Subtitles: off, or a language. */
  subtitle?: "off" | { lang: string };
  at: number;
}

export const MAX_TRACK_PREFS = 300;
/** How far the sound or subtitles can be moved either way, and the step the control uses. */
export const DELAY_LIMIT_MS = 10_000;
export const DELAY_STEP_MS = 50;

const lang2 = (l: unknown): string => (typeof l === "string" ? l.trim().toLowerCase().slice(0, 3) : "");
/** "eng" and "en" are the same language. */
const TO_TWO: Record<string, string> = { eng: "en", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", ita: "it", pol: "pl", por: "pt", nld: "nl", dut: "nl", swe: "sv", dan: "da", nor: "no", fin: "fi", rus: "ru", jpn: "ja", kor: "ko", chi: "zh", zho: "zh", ara: "ar", hin: "hi", tur: "tr" };
export const trackLang = (l: unknown): string => {
  const c = lang2(l);
  return TO_TWO[c] ?? c.slice(0, 2);
};

/** A request body, checked: only known shapes get in. Null when it holds nothing to remember. */
export function cleanTrackPref(raw: unknown, now = Date.now()): TrackPref | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pref: TrackPref = { at: now };
  const a = o.audio as { lang?: unknown; description?: unknown } | undefined;
  if (a && typeof a === "object" && trackLang(a.lang)) pref.audio = { lang: trackLang(a.lang), ...(a.description ? { description: true } : {}) };
  if (o.subtitle === "off") pref.subtitle = "off";
  else if (o.subtitle && typeof o.subtitle === "object" && trackLang((o.subtitle as { lang?: unknown }).lang)) pref.subtitle = { lang: trackLang((o.subtitle as { lang: unknown }).lang) };
  return pref.audio || pref.subtitle ? pref : null;
}

/** The sound track a remembered choice means: same language (and description or not), by language, never by number. */
export function rememberedAudio(tracks: { id: number; lang?: string; selected: boolean; audioDescription?: boolean }[], pref: TrackPref | null | undefined): number | undefined {
  if (!pref?.audio) return undefined;
  const want = pref.audio;
  const same = tracks.filter((t) => trackLang(t.lang) === want.lang);
  const pick = same.find((t) => Boolean(t.audioDescription) === Boolean(want.description)) ?? (want.description ? undefined : same[0]);
  if (!pick || pick.selected) return undefined;
  return pick.id;
}

/** The subtitle a remembered choice means: null for off, a track id, or undefined when nothing fits (leave it be). */
export function rememberedSubtitle(tracks: { id: number; lang?: string; selected: boolean }[], pref: TrackPref | null | undefined): number | null | undefined {
  if (!pref?.subtitle) return undefined;
  if (pref.subtitle === "off") return tracks.some((t) => t.selected) ? null : undefined;
  const want = pref.subtitle.lang;
  const pick = tracks.find((t) => trackLang(t.lang) === want);
  if (!pick || pick.selected) return undefined;
  return pick.id;
}

/** Keeps a delay inside what's sensible and on the 50 ms grid. */
export function cleanDelayMs(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(-DELAY_LIMIT_MS, Math.min(DELAY_LIMIT_MS, Math.round(n / DELAY_STEP_MS) * DELAY_STEP_MS));
}

/** "+150 ms", "-50 ms", "0 ms". */
export function delayLabel(ms: number): string {
  return `${ms > 0 ? "+" : ""}${ms} ms`;
}
