// Accessibility, chosen per profile (Settings › Accessibility, or the phone's setup page): the
// audio description track, a stronger focus ring, bigger text and less movement on screen.

export type TextScale = 100 | 125 | 150;
export const TEXT_SCALES: TextScale[] = [100, 125, 150];

export interface AccessibilitySettings {
  /** Choose the audio description track (a narrator describing the picture) when there is one. */
  audioDescription: boolean;
  /** A thick yellow focus ring with a dark edge, and stronger contrast on muted text. */
  highContrast: boolean;
  /** Text size, as a percentage. */
  textScale: TextScale;
  /** No moving decorations, projected clips, jump scares, screensaver motion or animated transitions. */
  reducedMotion: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = { audioDescription: false, highContrast: false, textScale: 100, reducedMotion: false };

/** Anything sent in (a phone, an old profile) as complete settings, keeping `base` for what's missing or wrong. */
export function cleanAccessibility(input: unknown, base: AccessibilitySettings = DEFAULT_ACCESSIBILITY): AccessibilitySettings {
  const i = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof AccessibilitySettings, unknown>>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const scale = Number(i.textScale);
  return {
    audioDescription: bool(i.audioDescription, base.audioDescription),
    highContrast: bool(i.highContrast, base.highContrast),
    textScale: (TEXT_SCALES as number[]).includes(scale) ? (scale as TextScale) : base.textScale,
    reducedMotion: bool(i.reducedMotion, base.reducedMotion),
  };
}

/** All off: nothing to store on the profile. */
export const isDefaultAccessibility = (a: AccessibilitySettings) => !a.audioDescription && !a.highContrast && a.textScale === 100 && !a.reducedMotion;

// How described audio is named: the stream's own flag (ffmpeg's "visual impaired" disposition,
// which UK broadcasts and most rips set), else its title.
const AD_TITLE = /\baudio[ -]?descri|\bdescribed\b|\bdescriptive\b|visual(ly)?[ -]?impaired|\bAD\b|\bnarrat(ed|ion)\b|\bDVS\b/i;

/** Whether an audio track is the audio description one. */
export function isAudioDescription(track: { title?: string; visualImpaired?: boolean }): boolean {
  return Boolean(track.visualImpaired) || (track.title !== undefined && AD_TITLE.test(track.title));
}

/**
 * The audio track to switch to, or undefined to leave it: with audio description on, the
 * described track (in the preferred language when there's a choice); with it off, a plain track
 * in the same language when the player picked a described one by itself.
 */
export function audioTrackFor<T extends { id: number; lang?: string; selected: boolean; audioDescription?: boolean }>(tracks: T[], wantDescription: boolean, preferredLang?: string): number | undefined {
  const selected = tracks.find((t) => t.selected);
  const same = (a?: string, b?: string) => Boolean(a && b) && a!.slice(0, 2).toLowerCase() === b!.slice(0, 2).toLowerCase();
  if (wantDescription) {
    if (selected?.audioDescription) return undefined;
    const described = tracks.filter((t) => t.audioDescription);
    const pick = described.find((t) => same(t.lang, preferredLang)) ?? described.find((t) => same(t.lang, selected?.lang)) ?? described[0];
    return pick?.id;
  }
  if (!selected?.audioDescription) return undefined;
  return (tracks.find((t) => !t.audioDescription && same(t.lang, selected.lang)) ?? tracks.find((t) => !t.audioDescription))?.id;
}
