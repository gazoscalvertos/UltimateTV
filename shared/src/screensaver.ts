// Dimming and the screensaver: what can be shown when the TV is left on with nothing playing.

import type { ArtFrame, ArtNight, ArtOrder } from "./art.js";
import { isArtCollection } from "./art.js";

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
  /** How big the clock is. */
  clockSize: ClockSize;
  /** 24-hour (14:30) or 12-hour (2:30 pm) clock. */
  clock12: boolean;
  /** The date under the clock. */
  showDate: boolean;
  /** Seconds a picture takes to fade into the next. */
  fadeSeconds: number;
  /** Pictures and photos drift and zoom slowly (always still with Reduce motion). */
  drift: boolean;
  /** Night hours: from this hour (0–23) ... */
  nightFromHour: number;
  /** ... until this hour. Equal hours mean no night. */
  nightToHour: number;
  /** What the screensaver does in the night hours: carry on, get dimmer, or go black. */
  night: ArtNight;
  /** Art gallery: seconds each painting stays up (30 s to 1 hour). */
  artSeconds: number;
  artOrder: ArtOrder;
  /** The title, artist and year on a small card beside the painting. */
  artCaption: boolean;
  artFrame: ArtFrame;
  /** How bright the paintings are, in percent. */
  artBrightness: number;
  /** A clock over the paintings (off by default; a picture on a wall has no clock). */
  artClock: boolean;
  /** Which collections to show; none chosen means all. */
  artCollections: string[];
  /** Only paintings suitable for children. */
  artKids: boolean;
  /** How many paintings the Hub keeps ready. */
  artCount: number;
}

export type ClockSize = "small" | "medium" | "large";

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
  | "art"
  | "gallery";

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
  { id: "gallery", name: "Art gallery", detail: "Famous paintings in high resolution, one at a time, like pictures on a wall", kind: "special" },
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
  clockSize: "medium",
  clock12: false,
  showDate: true,
  fadeSeconds: 3,
  drift: true,
  nightFromHour: 22,
  nightToHour: 7,
  night: "none",
  artSeconds: 300,
  artOrder: "shuffle",
  artCaption: true,
  artFrame: "matte",
  artBrightness: 90,
  artClock: false,
  artCollections: [],
  artKids: false,
  artCount: 150,
};

/** Whether `hour` (0–23) is in the night hours. */
export function isNightHour(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export const isScreensaverTheme = (id: unknown): id is ScreensaverThemeId => SCREENSAVER_THEMES.some((t) => t.id === id);

/** The themes Shuffle picks from this month (photos too, when a folder is set). */
export function shuffleThemes(month: number, withPhotos: boolean, withGallery = false): ScreensaverThemeId[] {
  const out = SCREENSAVER_THEMES.filter((t) => t.kind !== "special" && (!t.months || t.months.includes(month))).map((t) => t.id);
  if (withPhotos) out.push("photos");
  if (withGallery) out.push("gallery");
  return out;
}

/** Settings as sent, made safe: numbers in range, a known theme. The folder is checked by the Hub. */
export function cleanScreensaver(s: Partial<ScreensaverSettings>, base: ScreensaverSettings = DEFAULT_SCREENSAVER): ScreensaverSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
  return {
    dimAfterMin: num(s.dimAfterMin, base.dimAfterMin, 0, 240),
    dimPercent: num(s.dimPercent, base.dimPercent, 20, 95),
    startAfterMin: num(s.startAfterMin, base.startAfterMin, 0, 240),
    theme: isScreensaverTheme(s.theme) ? s.theme : base.theme,
    photosPath: typeof s.photosPath === "string" ? s.photosPath.trim() : base.photosPath,
    photoSeconds: num(s.photoSeconds, base.photoSeconds, 5, 600),
    clock: typeof s.clock === "boolean" ? s.clock : base.clock,
    clockSize: pick(s.clockSize, ["small", "medium", "large"], base.clockSize),
    clock12: bool(s.clock12, base.clock12),
    showDate: bool(s.showDate, base.showDate),
    fadeSeconds: num(s.fadeSeconds, base.fadeSeconds, 1, 10),
    drift: bool(s.drift, base.drift),
    nightFromHour: num(s.nightFromHour, base.nightFromHour, 0, 23),
    nightToHour: num(s.nightToHour, base.nightToHour, 0, 23),
    night: pick(s.night, ["none", "dim", "black"], base.night),
    artSeconds: num(s.artSeconds, base.artSeconds, 30, 3600),
    artOrder: pick(s.artOrder, ["shuffle", "ordered"], base.artOrder),
    artCaption: bool(s.artCaption, base.artCaption),
    artFrame: pick(s.artFrame, ["none", "matte", "gold"], base.artFrame),
    artBrightness: num(s.artBrightness, base.artBrightness, 30, 100),
    artClock: bool(s.artClock, base.artClock),
    artCollections: Array.isArray(s.artCollections) ? [...new Set(s.artCollections.filter(isArtCollection))] : base.artCollections,
    artKids: bool(s.artKids, base.artKids),
    artCount: num(s.artCount, base.artCount, 20, 1000),
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
