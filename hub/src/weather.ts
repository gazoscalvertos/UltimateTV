// The weather on the TV and phone: the household says where it lives (a town, a postcode, or a
// latitude and longitude) and the Hub fetches the forecast from Open-Meteo every half hour. Both
// are free and need no key; UK postcodes are placed with postcodes.io. The last forecast is kept,
// so a Hub restart or a dropped connection still has something to show.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { cleanPlace, cleanWeatherSettings, DEFAULT_WEATHER_SETTINGS, parseLatLon, UK_POSTCODE, weatherWords, type WeatherPlace, type WeatherReport, type WeatherSettings, type WeatherState } from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import { fetchJson } from "./http.js";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const POSTCODES = "https://api.postcodes.io";
/** A forecast is kept this long before a new one is fetched. */
const FRESH_MS = 30 * 60_000;
/** After a failure, wait this long before trying again on a request (the timer still runs). */
const RETRY_MS = 5 * 60_000;

interface ForecastJson {
  current: Record<string, number>;
  hourly: Record<string, number[]>;
  daily: Record<string, number[]>;
}

/** Open-Meteo's answer, in unix seconds, turned into a report. */
export function toReport(place: WeatherPlace, json: ForecastJson, fetchedAt: number): WeatherReport {
  const c = json.current;
  const h = json.hourly;
  const d = json.daily;
  const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const days = (d.time ?? []).map((t, i) => ({
    date: t * 1000,
    code: n(d.weather_code?.[i]),
    maxC: n(d.temperature_2m_max?.[i]),
    minC: n(d.temperature_2m_min?.[i]),
    rainChance: n(d.precipitation_probability_max?.[i]),
    rainMm: n(d.precipitation_sum?.[i]),
    sunrise: n(d.sunrise?.[i]) * 1000,
    sunset: n(d.sunset?.[i]) * 1000,
    uv: n(d.uv_index_max?.[i]),
    windKmh: n(d.wind_speed_10m_max?.[i]),
  }));
  return {
    place,
    fetchedAt,
    now: {
      at: n(c.time) * 1000 || fetchedAt,
      tempC: n(c.temperature_2m),
      feelsC: n(c.apparent_temperature ?? c.temperature_2m),
      code: n(c.weather_code),
      isDay: c.is_day !== 0,
      humidity: n(c.relative_humidity_2m),
      windKmh: n(c.wind_speed_10m),
      gustKmh: n(c.wind_gusts_10m),
      windDeg: n(c.wind_direction_10m),
      rainMm: n(c.precipitation),
    },
    hours: (h.time ?? []).map((t, i) => ({
      at: t * 1000,
      tempC: n(h.temperature_2m?.[i]),
      code: n(h.weather_code?.[i]),
      isDay: h.is_day?.[i] !== 0,
      rainChance: n(h.precipitation_probability?.[i]),
      windKmh: n(h.wind_speed_10m?.[i]),
    })),
    days,
  };
}

export function forecastUrl(place: WeatherPlace): string {
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,precipitation_probability,weather_code,is_day,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: "7",
  });
  return `${FORECAST}?${q}`;
}

/** A made-up but believable week for demo mode (and the screenshots): no network needed. */
export function demoReport(place: WeatherPlace, now: number): WeatherReport {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const codes = [3, 61, 2, 80, 1, 0, 63];
  const hours = Array.from({ length: 7 * 24 }, (_, i) => {
    const at = midnight + i * 3600_000;
    const hour = i % 24;
    const day = Math.floor(i / 24);
    const tempC = 9 + day * 0.4 + 5 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
    // Today: cloudy, then rain in the late afternoon.
    const code = day === 0 ? (hour >= 16 && hour <= 20 ? 61 : hour >= 9 ? 3 : 2) : codes[day]!;
    return { at, tempC, code, isDay: hour >= 7 && hour < 18, rainChance: code >= 51 ? 70 : code === 3 ? 20 : 5, windKmh: 14 + (day % 3) * 6 };
  });
  const days = Array.from({ length: 7 }, (_, day) => {
    const temps = hours.slice(day * 24, day * 24 + 24).map((h) => h.tempC);
    const date = midnight + day * 86_400_000;
    return { date, code: day === 0 ? 61 : codes[day]!, maxC: Math.max(...temps), minC: Math.min(...temps), rainChance: [70, 65, 15, 55, 10, 5, 80][day]!, rainMm: [2.4, 3.1, 0, 1.2, 0, 0, 6.5][day]!, sunrise: date + 7.2 * 3600_000, sunset: date + 16.7 * 3600_000, uv: 1, windKmh: 22 + (day % 3) * 8 };
  });
  const cur = hours[Math.floor((now - midnight) / 3600_000)] ?? hours[0]!;
  return { place, fetchedAt: now, now: { at: now, tempC: cur.tempC, feelsC: cur.tempC - 2, code: cur.code, isDay: cur.isDay, humidity: 82, windKmh: cur.windKmh, gustKmh: 34, windDeg: 225, rainMm: 0 }, hours, days };
}

export const DEMO_PLACE: WeatherPlace = { name: "Leeds", detail: "West Yorkshire, United Kingdom", lat: 53.7965, lon: -1.5478 };

/** Finds places by name, UK postcode, or "lat, lon". */
export async function findPlaces(query: string, fetchImpl: typeof fetch): Promise<WeatherPlace[]> {
  const text = query.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text) return [];
  const ll = parseLatLon(text);
  if (ll) return [cleanPlace({ name: `${ll.lat}, ${ll.lon}`, ...ll })!];
  const postcode = UK_POSTCODE.exec(text);
  if (postcode) {
    const [, outward, inward] = postcode;
    try {
      if (inward) {
        const { result } = await fetchJson<{ result: { postcode: string; latitude: number; longitude: number; admin_district?: string; country?: string } | null }>(`${POSTCODES}/postcodes/${encodeURIComponent(`${outward}${inward}`)}`, fetchImpl, {}, 10_000);
        if (result?.latitude != null) return [cleanPlace({ name: result.postcode, detail: [result.admin_district, result.country].filter(Boolean).join(", "), lat: result.latitude, lon: result.longitude })!];
      } else {
        const { result } = await fetchJson<{ result: { outcode: string; latitude: number; longitude: number; admin_district?: string[]; country?: string[] } | null }>(`${POSTCODES}/outcodes/${encodeURIComponent(outward!)}`, fetchImpl, {}, 10_000);
        if (result?.latitude != null) return [cleanPlace({ name: result.outcode, detail: [result.admin_district?.[0], result.country?.[0]].filter(Boolean).join(", "), lat: result.latitude, lon: result.longitude })!];
      }
    } catch {
      // Not a real postcode after all ("E4" is a channel and a postcode): try it as a name.
    }
  }
  const q = new URLSearchParams({ name: text, count: "8", language: "en", format: "json" });
  const { results } = await fetchJson<{ results?: { name: string; latitude: number; longitude: number; admin1?: string; admin2?: string; country?: string }[] }>(`${GEOCODE}?${q}`, fetchImpl, {}, 10_000);
  return (results ?? []).map((r) => cleanPlace({ name: r.name, detail: [r.admin2 && r.admin2 !== r.name ? r.admin2 : r.admin1, r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude })).filter((p): p is WeatherPlace => p !== null);
}

const samePlace = (a: WeatherPlace, b: WeatherPlace) => a.lat === b.lat && a.lon === b.lon;

export class Weather {
  private timer: NodeJS.Timeout | undefined;
  private fetching: Promise<void> | null = null;
  private failedAt = 0;

  constructor(
    private readonly ctx: HubContext,
    private readonly demo = false,
  ) {}

  settings(): WeatherSettings {
    const saved = this.ctx.db.getKv<Partial<WeatherSettings>>("weather-settings");
    const s = cleanWeatherSettings(saved ?? {}, DEFAULT_WEATHER_SETTINGS);
    // Demo mode shows somewhere, so the weather can be seen without setting it up.
    return this.demo && !s.place ? { ...s, place: DEMO_PLACE } : s;
  }

  saveSettings(patch: Partial<WeatherSettings>): WeatherSettings {
    const before = this.settings();
    const s = cleanWeatherSettings(patch, before);
    this.ctx.db.setKv("weather-settings", s);
    this.ctx.events.emit({ type: "weather.changed" });
    if (s.place && (!before.place || !samePlace(before.place, s.place))) {
      this.failedAt = 0;
      void this.refresh().catch(() => undefined);
    }
    return s;
  }

  private report(): WeatherReport | undefined {
    const place = this.settings().place;
    const r = this.ctx.db.getKv<WeatherReport>("weather-report");
    return place && r && samePlace(r.place, place) ? { ...r, place } : undefined;
  }

  /** The settings and the forecast, fetching a new one first when there's none for this place. */
  async state(now = Date.now()): Promise<WeatherState> {
    const settings = this.settings();
    if (!settings.place) return { settings };
    let report = this.report();
    const stale = !report || now - report.fetchedAt > FRESH_MS;
    if (stale && now - this.failedAt > RETRY_MS) {
      const job = this.refresh(now).catch(() => undefined);
      // Show the old forecast straight away; the TV hears when the new one lands.
      if (!report) await job;
      report = this.report();
    }
    const error = this.ctx.db.getKv<string>("weather-error");
    return { settings, ...(report ? { report } : {}), ...(error ? { error } : {}) };
  }

  /** Fetches a new forecast (one at a time) and tells the TV and phones. */
  refresh(now = Date.now()): Promise<void> {
    if (this.fetching) return this.fetching;
    const place = this.settings().place;
    if (!place) return Promise.resolve();
    this.fetching = (async () => {
      try {
        const report = this.demo ? demoReport(place, now) : toReport(place, await fetchJson<ForecastJson>(forecastUrl(place), this.ctx.fetchImpl, {}, 15_000), now);
        this.ctx.db.setKv("weather-report", report);
        this.ctx.db.setKv("weather-error", null);
        this.failedAt = 0;
        this.ctx.events.emit({ type: "weather.changed" });
      } catch (err) {
        this.failedAt = Date.now();
        const message = err instanceof Error ? err.message : String(err);
        this.ctx.db.setKv("weather-error", "Couldn't get the forecast. It'll try again soon.");
        this.ctx.log.warn({ err: message }, "Couldn't fetch the weather");
        throw err;
      } finally {
        this.fetching = null;
      }
    })();
    return this.fetching;
  }

  places(query: string): Promise<WeatherPlace[]> {
    if (this.demo) return Promise.resolve(query.trim() ? [DEMO_PLACE, { name: "Leeds", detail: "Alabama, United States", lat: 33.5482, lon: -86.5444 }] : []);
    return findPlaces(query, this.ctx.fetchImpl);
  }

  start(): void {
    this.timer = setInterval(() => {
      if (this.settings().place) void this.refresh().catch(() => undefined);
    }, FRESH_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

export function registerWeather(app: FastifyInstance, ctx: HubContext, weather: Weather): void {
  app.get("/api/weather", async (req: FastifyRequest<{ Querystring: { words?: string } }>) => {
    const st = await weather.state();
    return req.query.words && st.report ? { ...st, words: weatherWords(st.report, Date.now(), st.settings.wind) } : st;
  });
  app.put("/api/weather/settings", async (req: FastifyRequest<{ Body: Partial<WeatherSettings> }>) => {
    weather.saveSettings(req.body ?? {});
    return weather.state();
  });
  app.get("/api/weather/places", async (req: FastifyRequest<{ Querystring: { q?: string } }>, reply) => {
    try {
      return { places: await weather.places(String(req.query.q ?? "")) };
    } catch {
      return reply.code(502).send({ error: "Couldn't look that up just now. Try again in a minute." });
    }
  });
  app.post("/api/weather/refresh", async (_req, reply) => {
    try {
      await weather.refresh();
    } catch {
      return reply.code(502).send({ error: "Couldn't get the forecast just now" });
    }
    return weather.state();
  });
  /** Opens the forecast on the TV (the phone's Show on TV). */
  app.post("/api/weather/show", async () => {
    ctx.events.emit({ type: "weather.show" });
    return { ok: true };
  });
}
