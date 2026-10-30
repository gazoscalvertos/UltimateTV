// The weather: where the household lives, today's and the week's forecast from Open-Meteo (free,
// no key), and the words and pictures the TV and phone show for it. Temperatures and wind are
// kept in °C and km/h and turned into the household's units only when shown, so changing units
// needs no new forecast.

export interface WeatherPlace {
  /** "Leeds", "LS6 2AB". */
  name: string;
  /** Where it is, to tell two Newports apart: "West Yorkshire, United Kingdom". */
  detail?: string;
  lat: number;
  lon: number;
}

export type TemperatureUnit = "c" | "f";
export type WindUnit = "mph" | "kmh";

export interface WeatherSettings {
  place: WeatherPlace | null;
  temperature: TemperatureUnit;
  wind: WindUnit;
  /** A card with today's weather on Home. */
  onHome: boolean;
  /** The temperature next to the clock along the top. */
  inTopBar: boolean;
  /** Under the clock on the screensaver. */
  onScreensaver: boolean;
}

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = { place: null, temperature: "c", wind: "mph", onHome: true, inTopBar: true, onScreensaver: true };

export interface WeatherNow {
  at: number;
  tempC: number;
  feelsC: number;
  code: number;
  isDay: boolean;
  humidity: number;
  windKmh: number;
  gustKmh: number;
  /** Where the wind comes from, in degrees. */
  windDeg: number;
  /** Rain in the last hour. */
  rainMm: number;
}

export interface WeatherHour {
  at: number;
  tempC: number;
  code: number;
  isDay: boolean;
  /** Chance of rain, 0-100. */
  rainChance: number;
  windKmh: number;
}

export interface WeatherDay {
  /** Midnight at the start of the day. */
  date: number;
  code: number;
  maxC: number;
  minC: number;
  rainChance: number;
  rainMm: number;
  sunrise: number;
  sunset: number;
  uv: number;
  windKmh: number;
}

export interface WeatherReport {
  place: WeatherPlace;
  fetchedAt: number;
  now: WeatherNow;
  /** Every hour of the week ahead, from the start of today. */
  hours: WeatherHour[];
  days: WeatherDay[];
}

export interface WeatherState {
  settings: WeatherSettings;
  report?: WeatherReport;
  /** Why the forecast couldn't be fetched last time (the report, if any, is then older). */
  error?: string;
  /** For pages without the shared code (the phone remote): asked for with ?words=1. */
  words?: WeatherWords;
}

export interface WeatherWords {
  headline: string;
  /** What each code in the report says and looks like, by `${code}-${isDay ? 1 : 0}`. */
  codes: Record<string, { label: string; icon: WeatherIconName }>;
}

/** The words for a report, for a page that can't work them out itself. */
export function weatherWords(report: WeatherReport, now: number, wind: WindUnit): WeatherWords {
  const codes: WeatherWords["codes"] = {};
  const add = (code: number, isDay: boolean) => (codes[`${code}-${isDay ? 1 : 0}`] ??= describeWeather(code, isDay));
  add(report.now.code, report.now.isDay);
  for (const h of report.hours) add(h.code, h.isDay);
  for (const d of report.days) add(d.code, true);
  return { headline: weatherHeadline(report, now, wind), codes };
}

// ---------------------------------------------------------------------------
// Pictures and words

export type WeatherIconName = "sun" | "moon" | "partly" | "partly-night" | "cloud" | "fog" | "drizzle" | "rain" | "heavy-rain" | "sleet" | "snow" | "thunder";

/** What a WMO weather code (as Open-Meteo gives) looks like, and says. */
export function describeWeather(code: number, isDay = true): { label: string; icon: WeatherIconName } {
  const sky = (day: WeatherIconName, night: WeatherIconName) => (isDay ? day : night);
  switch (code) {
    case 0:
      return { label: isDay ? "Sunny" : "Clear", icon: sky("sun", "moon") };
    case 1:
      return { label: isDay ? "Mostly sunny" : "Mostly clear", icon: sky("sun", "moon") };
    case 2:
      return { label: "Partly cloudy", icon: sky("partly", "partly-night") };
    case 3:
      return { label: "Cloudy", icon: "cloud" };
    case 45:
    case 48:
      return { label: "Fog", icon: "fog" };
    case 51:
    case 53:
    case 55:
      return { label: "Drizzle", icon: "drizzle" };
    case 56:
    case 57:
      return { label: "Freezing drizzle", icon: "sleet" };
    case 61:
      return { label: "Light rain", icon: "drizzle" };
    case 63:
      return { label: "Rain", icon: "rain" };
    case 65:
      return { label: "Heavy rain", icon: "heavy-rain" };
    case 66:
    case 67:
      return { label: "Freezing rain", icon: "sleet" };
    case 71:
      return { label: "Light snow", icon: "snow" };
    case 73:
      return { label: "Snow", icon: "snow" };
    case 75:
      return { label: "Heavy snow", icon: "snow" };
    case 77:
      return { label: "Snow grains", icon: "snow" };
    case 80:
      return { label: "Showers", icon: "rain" };
    case 81:
      return { label: "Heavy showers", icon: "heavy-rain" };
    case 82:
      return { label: "Torrential showers", icon: "heavy-rain" };
    case 85:
    case 86:
      return { label: "Snow showers", icon: "snow" };
    case 95:
      return { label: "Thunderstorms", icon: "thunder" };
    case 96:
    case 99:
      return { label: "Thunderstorms with hail", icon: "thunder" };
    default:
      return { label: "Cloudy", icon: "cloud" };
  }
}

/** Codes that mean something is falling from the sky. */
export const isWet = (code: number) => code >= 51;
const isSnow = (code: number) => (code >= 71 && code <= 77) || code === 85 || code === 86;

export const formatTemp = (c: number, unit: TemperatureUnit) => `${Math.round(unit === "f" ? (c * 9) / 5 + 32 : c)}°`;
export const windSpeed = (kmh: number, unit: WindUnit) => Math.round(unit === "mph" ? kmh / 1.609344 : kmh);
export const formatWind = (kmh: number, unit: WindUnit) => `${windSpeed(kmh, unit)} ${unit === "mph" ? "mph" : "km/h"}`;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** "SW" for a wind from 225°. */
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

const hourWord = (t: number) => {
  const d = new Date(t);
  const h = d.getHours();
  if (h === 0) return "midnight";
  if (h === 12) return "midday";
  return `${h % 12}${h < 12 ? "am" : "pm"}`;
};

/** "Today", "Tomorrow", "Saturday". */
export function dayName(date: number, now: number, short = false): string {
  const start = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((start(date) - start(now)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Date(date).toLocaleDateString("en-GB", { weekday: short ? "short" : "long" });
}

/** The day's entry for the hour `t` falls in. */
export function dayOf(report: WeatherReport, t: number): WeatherDay | undefined {
  return report.days.find((d) => t >= d.date && t < d.date + 86_400_000) ?? report.days[0];
}

/** The hours from `from` on, up to `count` of them. */
export function hoursFrom(report: WeatherReport, from: number, count: number): WeatherHour[] {
  const start = Math.floor(from / 3600_000) * 3600_000;
  return report.hours.filter((h) => h.at >= start).slice(0, count);
}

/**
 * The one thing worth knowing about the next twelve hours, the way a person would say it: "Rain
 * from 4pm", "Dry until 6pm, then rain", "Snow until about 3pm", "Frost tonight", "Dry all day".
 */
export function weatherHeadline(report: WeatherReport, now: number, wind: WindUnit = "mph"): string {
  const next = hoursFrom(report, now, 12);
  const wet = (h: WeatherHour) => isWet(h.code) && h.rainChance >= 40;
  const what = (h: WeatherHour) => (isSnow(h.code) ? "Snow" : h.code >= 95 ? "Thunderstorms" : "Rain");
  const nowWet = isWet(report.now.code) || (next[0] ? wet(next[0]) : false);
  if (nowWet) {
    const dry = next.findIndex((h) => !wet(h) && !isWet(h.code));
    const kind = isSnow(report.now.code) ? "Snow" : report.now.code >= 95 ? "Thunderstorms" : "Rain";
    return dry > 0 ? `${kind} until about ${hourWord(next[dry]!.at)}` : `${kind} for the next few hours`;
  }
  const first = next.find(wet);
  if (first) return `${what(first)} from ${hourWord(first.at)}`;
  const gust = report.now.gustKmh;
  if (gust >= 65) return `Windy, gusts up to ${formatWind(gust, wind)}`;
  const evening = new Date(now).getHours() >= 15;
  if (Math.min(...next.map((h) => h.tempC)) <= 0) return evening ? "Frost tonight" : "Frosty out there";
  return new Date(now).getHours() >= 17 ? "Dry tonight" : "Dry all day";
}

// ---------------------------------------------------------------------------
// Settings

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export function cleanPlace(v: unknown): WeatherPlace | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<WeatherPlace>;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = String(p.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  const detail = String(p.detail ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  return { name, ...(detail ? { detail } : {}), lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

export function cleanWeatherSettings(patch: Partial<WeatherSettings>, base: WeatherSettings = DEFAULT_WEATHER_SETTINGS): WeatherSettings {
  const bool = (v: unknown, fallback: boolean) => (v === undefined ? fallback : Boolean(v));
  return {
    place: patch.place === undefined ? base.place : cleanPlace(patch.place),
    temperature: patch.temperature === "c" || patch.temperature === "f" ? patch.temperature : base.temperature,
    wind: patch.wind === "mph" || patch.wind === "kmh" ? patch.wind : base.wind,
    onHome: bool(patch.onHome, base.onHome),
    inTopBar: bool(patch.inTopBar, base.inTopBar),
    onScreensaver: bool(patch.onScreensaver, base.onScreensaver),
  };
}

/** A UK postcode ("LS6 2AB") or just its first half ("LS6"), which postcodes.io can place. */
export const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(?:\s*(\d[A-Z]{2}))?$/i;

/** "53.8, -1.55" typed in: a place with no name lookup needed. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
