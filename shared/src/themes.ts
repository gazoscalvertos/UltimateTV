// The look of the app: a set of colour themes worn by the TV, the phone remote and the Hub's web
// pages alike. Each theme is a palette of CSS custom properties; the TV adds moving decorations
// for some (bats at Halloween, snow at Christmas), the phone and web pages take the colours only.
//
// "Seasonal" themes come out by themselves on their days when the household leaves seasonal
// themes on, and the everyday theme is worn the rest of the year.

export type ThemeName =
  | "default"
  | "light"
  | "slick"
  | "cyberpunk"
  | "ocean"
  | "forest"
  | "sunset"
  | "halloween"
  | "christmas"
  | "easter"
  | "valentine";

/** What can be saved. "auto" is what older TVs and phones send: dark, with the seasonal themes on. */
export type ThemeChoice = ThemeName | "auto";

/** The CSS custom properties a theme sets. Every page reads the ones it needs. */
export interface ThemePalette {
  /** The page behind everything, and a slightly lighter shade for gradients. */
  "--bg": string;
  "--bg-2": string;
  /** Cards, rows and dialogs, and the same a step lighter. */
  "--panel": string;
  "--panel-2": string;
  /** Hairlines between rows. */
  "--line": string;
  /** Text, softer text for long descriptions, and the quieter shades. */
  "--fg": string;
  "--fg-2": string;
  "--muted": string;
  "--dim": string;
  "--accent": string;
  "--accent-2": string;
  /** Text on an accent-coloured button. */
  "--on-accent": string;
  "--good": string;
  "--bad": string;
  "--amber": string;
  /** The ring round a focused card. */
  "--focus": string;
  /** A focused row or button is filled with this, its text in --on-sel. */
  "--sel": string;
  "--on-sel": string;
  "--on-sel-muted": string;
  /** "r g b" of the colour translucent surfaces are lifted with (white on dark themes). */
  "--hi": string;
  /** "r g b" of --bg and --panel, for see-through overlays. */
  "--bg-rgb": string;
  "--panel-rgb": string;
  /** The soft glow in the top corner of every TV screen. */
  "--glow": string;
}

export interface ThemeInfo {
  id: ThemeName;
  name: string;
  detail: string;
  /** Light themes want dark scrollbars and form controls. */
  light?: boolean;
  /** When a seasonal theme comes out by itself, in words. */
  season?: string;
  palette: ThemePalette;
}

const dark = (p: Partial<ThemePalette>): ThemePalette => ({
  "--bg": "#070b14",
  "--bg-2": "#0d1424",
  "--panel": "#121b2e",
  "--panel-2": "#18233a",
  "--line": "rgba(255, 255, 255, 0.1)",
  "--fg": "#f3f6fb",
  "--fg-2": "#d5dbe7",
  "--muted": "#9aa6bd",
  "--dim": "#66728a",
  "--accent": "#3d8bff",
  "--accent-2": "#00c2d1",
  "--on-accent": "#ffffff",
  "--good": "#35c27a",
  "--bad": "#ff5468",
  "--amber": "#f2b33d",
  "--focus": "#ffffff",
  "--sel": "#f3f6fb",
  "--on-sel": "#0a0f1a",
  "--on-sel-muted": "#48526a",
  "--hi": "255 255 255",
  "--bg-rgb": "7 11 20",
  "--panel-rgb": "18 27 46",
  "--glow": "#14264a",
  ...p,
});

export const THEMES: readonly ThemeInfo[] = [
  { id: "default", name: "Dark", detail: "The usual deep blue", palette: dark({}) },
  {
    id: "light",
    name: "Light",
    detail: "Bright and clean, for a sunny room",
    light: true,
    palette: dark({
      "--bg": "#e9eef6",
      "--bg-2": "#f7f9fc",
      "--panel": "#ffffff",
      "--panel-2": "#e2e8f2",
      "--line": "rgba(14, 22, 38, 0.12)",
      "--fg": "#0e1626",
      "--fg-2": "#2b3548",
      "--muted": "#56617a",
      "--dim": "#7d879c",
      "--accent": "#1f6fff",
      "--accent-2": "#0093a5",
      "--good": "#1c9a59",
      "--bad": "#d92f47",
      "--amber": "#b07400",
      "--focus": "#0e1626",
      "--sel": "#0e1626",
      "--on-sel": "#ffffff",
      "--on-sel-muted": "#c3ccdd",
      "--hi": "14 22 38",
      "--bg-rgb": "233 238 246",
      "--panel-rgb": "255 255 255",
      "--glow": "#cfdcf7",
    }),
  },
  {
    id: "slick",
    name: "Slick",
    detail: "Black glass and silver, nothing else",
    palette: dark({
      "--bg": "#000000",
      "--bg-2": "#0b0b0c",
      "--panel": "#151517",
      "--panel-2": "#1f1f22",
      "--line": "rgba(255, 255, 255, 0.08)",
      "--fg": "#f5f5f7",
      "--fg-2": "#d2d2d7",
      "--muted": "#8e8e93",
      "--dim": "#5c5c61",
      "--accent": "#e8e8ed",
      "--accent-2": "#a1a1a6",
      "--on-accent": "#000000",
      "--sel": "#f5f5f7",
      "--on-sel": "#000000",
      "--on-sel-muted": "#5c5c61",
      "--bg-rgb": "0 0 0",
      "--panel-rgb": "21 21 23",
      "--glow": "#1c1c1f",
    }),
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    detail: "Neon pink and cyan on a night city",
    palette: dark({
      "--bg": "#07040f",
      "--bg-2": "#110726",
      "--panel": "#170b2e",
      "--panel-2": "#22113f",
      "--line": "rgba(255, 43, 214, 0.22)",
      "--fg": "#f4f1ff",
      "--fg-2": "#d9d2f5",
      "--muted": "#a194d6",
      "--dim": "#6c5f9c",
      "--accent": "#ff2bd6",
      "--accent-2": "#00f0ff",
      "--good": "#39ff88",
      "--amber": "#ffe600",
      "--focus": "#00f0ff",
      "--sel": "#00f0ff",
      "--on-sel": "#07040f",
      "--on-sel-muted": "#3b2a63",
      "--bg-rgb": "7 4 15",
      "--panel-rgb": "23 11 46",
      "--glow": "#3a0d52",
    }),
  },
  {
    id: "ocean",
    name: "Ocean",
    detail: "Deep teal, calm as the sea",
    palette: dark({
      "--bg": "#03131a",
      "--bg-2": "#062029",
      "--panel": "#0a2a35",
      "--panel-2": "#0f3542",
      "--line": "rgba(120, 230, 240, 0.12)",
      "--fg": "#effbfc",
      "--fg-2": "#cfe7ea",
      "--muted": "#8db4bb",
      "--dim": "#5b818a",
      "--accent": "#1ec8c8",
      "--accent-2": "#3d8bff",
      "--sel": "#effbfc",
      "--on-sel": "#03131a",
      "--on-sel-muted": "#3f6670",
      "--bg-rgb": "3 19 26",
      "--panel-rgb": "10 42 53",
      "--glow": "#0b3d4c",
    }),
  },
  {
    id: "forest",
    name: "Forest",
    detail: "Moss green and warm wood",
    palette: dark({
      "--bg": "#080f09",
      "--bg-2": "#0e1a10",
      "--panel": "#142217",
      "--panel-2": "#1b2d1f",
      "--line": "rgba(190, 230, 160, 0.12)",
      "--fg": "#f2f6ee",
      "--fg-2": "#d6dfce",
      "--muted": "#9cae95",
      "--dim": "#677a62",
      "--accent": "#7cc35a",
      "--accent-2": "#d9a441",
      "--sel": "#f2f6ee",
      "--on-sel": "#0b140c",
      "--on-sel-muted": "#4b5c47",
      "--bg-rgb": "8 15 9",
      "--panel-rgb": "20 34 23",
      "--glow": "#1d3a1f",
    }),
  },
  {
    id: "sunset",
    name: "Sunset",
    detail: "Coral and rose, like a summer evening",
    palette: dark({
      "--bg": "#140a12",
      "--bg-2": "#1f0f1b",
      "--panel": "#2a1524",
      "--panel-2": "#361b2e",
      "--line": "rgba(255, 170, 150, 0.14)",
      "--fg": "#fff3ee",
      "--fg-2": "#f0d9d2",
      "--muted": "#c39aa6",
      "--dim": "#8a6573",
      "--accent": "#ff7a45",
      "--accent-2": "#ff4f8b",
      "--sel": "#fff3ee",
      "--on-sel": "#1c0c17",
      "--on-sel-muted": "#6a4a58",
      "--bg-rgb": "20 10 18",
      "--panel-rgb": "42 21 36",
      "--glow": "#4a1a2c",
    }),
  },
  {
    id: "halloween",
    name: "Halloween",
    detail: "Orange on deep purple, with cobwebs, fog and bats",
    season: "25 October to 1 November",
    palette: dark({
      "--bg": "#0b0613",
      "--bg-2": "#150a20",
      "--panel": "#1c0f2b",
      "--panel-2": "#261438",
      "--line": "rgba(255, 180, 90, 0.16)",
      "--fg": "#f7efe6",
      "--fg-2": "#e6d9cc",
      "--muted": "#b39bc4",
      "--dim": "#7b648c",
      "--accent": "#f07b16",
      "--accent-2": "#8a4dff",
      "--good": "#7ac74f",
      "--amber": "#ffc34d",
      "--sel": "#f7efe6",
      "--on-sel": "#1b0d29",
      "--on-sel-muted": "#6b5280",
      "--bg-rgb": "11 6 19",
      "--panel-rgb": "28 15 43",
      "--glow": "#2d1145",
    }),
  },
  {
    id: "christmas",
    name: "Christmas",
    detail: "Red and gold on pine green, with snow and fairy lights",
    season: "1 December to 5 January",
    palette: dark({
      "--bg": "#06120c",
      "--bg-2": "#0b1d14",
      "--panel": "#10281b",
      "--panel-2": "#163423",
      "--line": "rgba(255, 215, 140, 0.15)",
      "--fg": "#fbf6ec",
      "--fg-2": "#e6decd",
      "--muted": "#adbfa9",
      "--dim": "#73876e",
      "--accent": "#e3343f",
      "--accent-2": "#f2c14e",
      "--good": "#5fd17f",
      "--amber": "#f2c14e",
      "--focus": "#f2c14e",
      "--sel": "#fbf6ec",
      "--on-sel": "#0b1a11",
      "--on-sel-muted": "#4f6352",
      "--bg-rgb": "6 18 12",
      "--panel-rgb": "16 40 27",
      "--glow": "#1d3b28",
    }),
  },
  {
    id: "easter",
    name: "Easter",
    detail: "Spring pastels, with eggs and drifting blossom",
    light: true,
    season: "Palm Sunday to Easter Monday",
    palette: dark({
      "--bg": "#f6f1fb",
      "--bg-2": "#fdfbff",
      "--panel": "#ffffff",
      "--panel-2": "#efe7f8",
      "--line": "rgba(70, 45, 110, 0.12)",
      "--fg": "#2d2342",
      "--fg-2": "#4a3f60",
      "--muted": "#6f6487",
      "--dim": "#9a90ad",
      "--accent": "#8b5cf6",
      "--accent-2": "#f472b6",
      "--good": "#1f9d6c",
      "--bad": "#d92f47",
      "--amber": "#b97900",
      "--focus": "#8b5cf6",
      "--sel": "#2d2342",
      "--on-sel": "#ffffff",
      "--on-sel-muted": "#d5cbe6",
      "--hi": "45 35 66",
      "--bg-rgb": "246 241 251",
      "--panel-rgb": "255 255 255",
      "--glow": "#fde2f0",
    }),
  },
  {
    id: "valentine",
    name: "Valentine's",
    detail: "Rose and crimson, with hearts floating up",
    season: "12 to 14 February",
    palette: dark({
      "--bg": "#14060b",
      "--bg-2": "#1f0a12",
      "--panel": "#2a0f1a",
      "--panel-2": "#371424",
      "--line": "rgba(255, 150, 180, 0.15)",
      "--fg": "#fff1f5",
      "--fg-2": "#f1d6de",
      "--muted": "#c996a6",
      "--dim": "#8c6170",
      "--accent": "#ff3d77",
      "--accent-2": "#ff9db8",
      "--sel": "#fff1f5",
      "--on-sel": "#1f0a12",
      "--on-sel-muted": "#7a4a5a",
      "--bg-rgb": "20 6 11",
      "--panel-rgb": "42 15 26",
      "--glow": "#4a0f26",
    }),
  },
];

export const THEME_NAMES: readonly ThemeName[] = THEMES.map((t) => t.id);
export const THEME_CHOICES: readonly ThemeChoice[] = ["auto", ...THEME_NAMES];

export function themeInfo(name: ThemeName): ThemeInfo {
  return THEMES.find((t) => t.id === name) ?? THEMES[0]!;
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_NAMES as readonly string[]).includes(value);
}

const day = (at: number | Date) => {
  const d = at instanceof Date ? at : new Date(at);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
};

/** Halloween week: the theme comes out on 25 October and goes away after the 1st of November. */
export function isHalloweenWeek(at: number | Date = Date.now()): boolean {
  const { m, d } = day(at);
  return (m === 10 && d >= 25) || (m === 11 && d <= 1);
}

/** Easter Sunday of a year (the Gregorian computus), as a local date at midnight. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((8 * b + 13) / 25) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, date);
}

/** The seasonal theme due on a day, if any. */
export function seasonalTheme(at: number | Date = Date.now()): ThemeName | null {
  const { y, m, d } = day(at);
  if (isHalloweenWeek(at)) return "halloween";
  if (m === 12 || (m === 1 && d <= 5)) return "christmas";
  if (m === 2 && d >= 12 && d <= 14) return "valentine";
  const easter = easterSunday(y).getTime();
  const today = new Date(y, m - 1, d).getTime();
  const daysFromEaster = Math.round((today - easter) / 86_400_000);
  if (daysFromEaster >= -7 && daysFromEaster <= 1) return "easter";
  return null;
}

/** The look as saved on the Hub: the everyday theme, and whether the seasonal ones take over on their days. */
export interface ThemeLook {
  theme?: ThemeChoice;
  seasonal?: boolean;
}

/** Which theme to wear today. "auto" (from an older client) is dark with the seasons on. */
export function resolveTheme(look: ThemeLook, at: number | Date = Date.now()): ThemeName {
  const everyday = isThemeName(look.theme) ? look.theme : "default";
  const seasonal = look.theme === "auto" || look.seasonal !== false;
  return (seasonal && seasonalTheme(at)) || everyday;
}

/**
 * A saved look made sense of. Before there were many themes the choice was "auto", "default" or
 * "halloween" and nothing else: "auto" becomes dark with the seasons on, and a theme picked by hand
 * then keeps the seasons off, as it did.
 */
export function cleanLook(look: ThemeLook): { theme: ThemeName; seasonal: boolean } {
  if (look.theme === "auto" || look.theme === undefined) return { theme: "default", seasonal: look.seasonal ?? true };
  if (!isThemeName(look.theme)) return { theme: "default", seasonal: look.seasonal ?? true };
  return { theme: look.theme, seasonal: look.seasonal ?? false };
}
