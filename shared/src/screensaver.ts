// Dimming and the screensaver: what can be shown when the TV is left on with nothing playing.

export interface ScreensaverSettings {
  /** Minutes with no key pressed before the screen dims; 0 never dims. */
  dimAfterMin: number;
  /** How dark the dimmed screen gets, in percent. */
  dimPercent: number;
  /** Minutes with no key pressed before the screensaver starts; 0 never starts it. */
  startAfterMin: number;
  /** A theme id from SCREENSAVER_THEMES. */
  theme: ScreensaverThemeId;
  /** The NAS folder of the household's own photos (and short videos) for the "photos" theme. */
  photosPath: string;
  /** Seconds each picture or photo stays up. */
  photoSeconds: number;
  /** A small clock on the screensaver, moving now and then. */
  clock: boolean;
}

export type ScreensaverThemeId =
  | "off"
  | "shuffle"
  | "photos"
  | "black"
  | "aurora"
  | "fireplace"
  | "aquarium"
  | "space"
  | "snow"
  | "rain"
  | "ocean"
  | "lava"
  | "fireworks"
  | "halloween"
  | "christmas"
  | "bounce"
  | "landscapes"
  | "art";

export interface ScreensaverTheme {
  id: ScreensaverThemeId;
  name: string;
  detail: string;
  /** "moving" scenes are drawn live, like a looping video; "pictures" are still pictures that slowly pan. */
  kind: "special" | "moving" | "pictures";
  /** Months (1–12) a seasonal theme joins Shuffle in; others are always in it. */
  months?: number[];
}

export const SCREENSAVER_THEMES: readonly ScreensaverTheme[] = [
  { id: "off", name: "None", detail: "Just dim the screen", kind: "special" },
  { id: "shuffle", name: "Shuffle", detail: "A different one every 10 minutes", kind: "special" },
  { id: "photos", name: "Your photos", detail: "Photos and short videos from a folder on the NAS", kind: "special" },
  { id: "black", name: "Black screen", detail: "Turns the picture off until a button is pressed", kind: "special" },
  { id: "aurora", name: "Northern lights", detail: "The aurora rippling over snowy mountains", kind: "moving" },
  { id: "fireplace", name: "Fireplace", detail: "A log fire crackling away", kind: "moving" },
  { id: "aquarium", name: "Aquarium", detail: "Tropical fish, bubbles and swaying weed", kind: "moving" },
  { id: "space", name: "Deep space", detail: "Drifting through stars and nebulae", kind: "moving" },
  { id: "snow", name: "Snowy night", detail: "A log cabin in the snow under the moon", kind: "moving" },
  { id: "rain", name: "Rainy window", detail: "Rain running down the glass over city lights", kind: "moving" },
  { id: "ocean", name: "Sunset sea", detail: "Waves rolling under a setting sun", kind: "moving" },
  { id: "lava", name: "Lava lamp", detail: "Slow, warm blobs rising and falling", kind: "moving" },
  { id: "fireworks", name: "Fireworks", detail: "Fireworks over the city", kind: "moving" },
  { id: "halloween", name: "Halloween", detail: "Bats, pumpkins and a ghost under the full moon", kind: "moving", months: [10] },
  { id: "christmas", name: "Christmas", detail: "A twinkling tree, presents and snow", kind: "moving", months: [12] },
  { id: "bounce", name: "Bouncing logo", detail: "The app's name bouncing round, like an old DVD player", kind: "moving" },
  { id: "landscapes", name: "Landscapes", detail: "Mountains, dunes, hills and coasts at every time of day", kind: "pictures" },
  { id: "art", name: "Modern art", detail: "Bold shapes and soft colour, a new piece each time", kind: "pictures" },
];

export const DEFAULT_SCREENSAVER: ScreensaverSettings = {
  dimAfterMin: 10,
  dimPercent: 70,
  startAfterMin: 20,
  theme: "shuffle",
  photosPath: "",
  photoSeconds: 20,
  clock: true,
};

export const isScreensaverTheme = (id: unknown): id is ScreensaverThemeId => SCREENSAVER_THEMES.some((t) => t.id === id);

/** The themes Shuffle picks from this month (photos too, when a folder is set). */
export function shuffleThemes(month: number, withPhotos: boolean): ScreensaverThemeId[] {
  const out = SCREENSAVER_THEMES.filter((t) => t.kind !== "special" && (!t.months || t.months.includes(month))).map((t) => t.id);
  return withPhotos ? [...out, "photos"] : out;
}

/** Settings as sent, made safe: numbers in range, a known theme. The folder is checked by the Hub. */
export function cleanScreensaver(s: Partial<ScreensaverSettings>, base: ScreensaverSettings = DEFAULT_SCREENSAVER): ScreensaverSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
  return {
    dimAfterMin: num(s.dimAfterMin, base.dimAfterMin, 0, 240),
    dimPercent: num(s.dimPercent, base.dimPercent, 20, 95),
    startAfterMin: num(s.startAfterMin, base.startAfterMin, 0, 240),
    theme: isScreensaverTheme(s.theme) ? s.theme : base.theme,
    photosPath: typeof s.photosPath === "string" ? s.photosPath.trim() : base.photosPath,
    photoSeconds: num(s.photoSeconds, base.photoSeconds, 5, 600),
    clock: typeof s.clock === "boolean" ? s.clock : base.clock,
  };
}

/** A photo or video in the screensaver's folder. */
export interface ScreensaverPhoto {
  id: string;
  kind: "image" | "video";
}

export interface ScreensaverInfo {
  themes: readonly ScreensaverTheme[];
  /** How many photos and videos are in the folder (undefined when none is set or it can't be read). */
  photoCount?: number;
  photoError?: string;
}
