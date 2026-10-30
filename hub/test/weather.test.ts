// The weather: finding where the household lives, fetching and keeping the forecast, and
// opening it on the TV by voice or from the phone.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HubEvent, WeatherState } from "@ultimatetv/shared";
import { HubContext } from "../src/context.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server.js";
import { parseVoice } from "../src/voice.js";
import { demoReport, DEMO_PLACE, forecastUrl, toReport } from "../src/weather.js";
import { pairAsTv } from "./helpers.js";

let tmp: string;
let app: FastifyInstance & { hub: HubContext };
let requests: string[];
let answers: Record<string, () => Response>;
let forecasts = 0;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Open-Meteo's answer for two hours and one day, in unix seconds. */
const FORECAST = {
  current: { time: 1_793_350_800, temperature_2m: 11.2, apparent_temperature: 9.1, relative_humidity_2m: 81, is_day: 1, precipitation: 0, weather_code: 3, wind_speed_10m: 16, wind_direction_10m: 230, wind_gusts_10m: 35 },
  hourly: { time: [1_793_350_800, 1_793_354_400], temperature_2m: [11.2, 12], precipitation_probability: [10, 70], weather_code: [3, 61], is_day: [1, 1], wind_speed_10m: [16, 18] },
  daily: { time: [1_793_318_400], weather_code: [61], temperature_2m_max: [13], temperature_2m_min: [5], precipitation_probability_max: [70], precipitation_sum: [2.5], sunrise: [1_793_344_000], sunset: [1_793_380_000], uv_index_max: [1.4], wind_speed_10m_max: [24] },
};

const fakeFetch = (async (url: string | URL | Request) => {
  const u = String(url);
  requests.push(u);
  if (u.startsWith("https://api.open-meteo.com/v1/forecast?")) {
    forecasts++;
    return answers.forecast ? answers.forecast() : json(FORECAST);
  }
  const answer = Object.entries(answers).find(([k]) => u.startsWith(k))?.[1];
  return answer ? answer() : json({ error: "not here" }, 404);
}) as typeof fetch;

const options = () => ({ port: 0, host: "127.0.0.1", dataDir: path.join(tmp, "data"), clipsDir: path.join(tmp, "clips"), probeDir: path.join(tmp, "probe"), uiDir: path.join(tmp, "ui"), setupDir: path.join(tmp, "setup"), mediaRoot: tmp, demo: false });

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "utv-weather-"));
  requests = [];
  answers = {};
  forecasts = 0;
  const context = new HubContext({ dataDir: path.join(tmp, "data"), mediaRoot: tmp, log: silentLogger, fetchImpl: fakeFetch, ytdlp: null });
  app = (await buildServer(options(), { systemReport: async () => ({}) as never, context })) as never;
  await pairAsTv(app);
});

afterEach(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

const LEEDS = { name: "Leeds", detail: "West Yorkshire, United Kingdom", lat: 53.7965, lon: -1.5478 };

describe("where the household lives", () => {
  it("finds towns by name", async () => {
    answers["https://geocoding-api.open-meteo.com/v1/search?"] = () =>
      json({ results: [{ name: "Leeds", latitude: 53.79648, longitude: -1.54786, admin1: "England", admin2: "West Yorkshire", country: "United Kingdom" }, { name: "Leeds", latitude: 33.5482, longitude: -86.5444, admin1: "Alabama", country: "United States" }] });
    const res = await app.inject("/api/weather/places?q=leeds");
    expect(res.statusCode).toBe(200);
    expect(res.json().places).toEqual([
      { name: "Leeds", detail: "West Yorkshire, United Kingdom", lat: 53.7965, lon: -1.5479 },
      { name: "Leeds", detail: "Alabama, United States", lat: 33.5482, lon: -86.5444 },
    ]);
    expect(requests[0]).toContain("name=leeds");
  });

  it("places UK postcodes and their first half with postcodes.io", async () => {
    answers["https://api.postcodes.io/postcodes/LS62AB"] = () => json({ result: { postcode: "LS6 2AB", latitude: 53.81, longitude: -1.57, admin_district: "Leeds", country: "England" } });
    answers["https://api.postcodes.io/outcodes/LS6"] = () => json({ result: { outcode: "LS6", latitude: 53.82, longitude: -1.58, admin_district: ["Leeds"], country: ["England"] } });
    expect((await app.inject("/api/weather/places?q=LS6%202AB")).json().places).toEqual([{ name: "LS6 2AB", detail: "Leeds, England", lat: 53.81, lon: -1.57 }]);
    expect((await app.inject("/api/weather/places?q=LS6")).json().places).toEqual([{ name: "LS6", detail: "Leeds, England", lat: 53.82, lon: -1.58 }]);
  });

  it("tries a postcode-like word as a name when it isn't a postcode", async () => {
    answers["https://geocoding-api.open-meteo.com/v1/search?"] = () => json({ results: [{ name: "E4", latitude: 1, longitude: 2, country: "Somewhere" }] });
    expect((await app.inject("/api/weather/places?q=E4")).json().places).toHaveLength(1);
    expect(requests[0]).toContain("postcodes.io/outcodes/E4");
  });

  it("takes a latitude and longitude as they are", async () => {
    expect((await app.inject("/api/weather/places?q=53.8,%20-1.55")).json().places).toEqual([{ name: "53.8, -1.55", lat: 53.8, lon: -1.55 }]);
    expect(requests).toEqual([]);
  });

  it("says so when the lookup fails", async () => {
    answers["https://geocoding-api.open-meteo.com/v1/search?"] = () => json({}, 500);
    expect((await app.inject("/api/weather/places?q=leeds")).statusCode).toBe(502);
  });
});

describe("the forecast", () => {
  it("has nothing until a place is set", async () => {
    const st: WeatherState = (await app.inject("/api/weather")).json();
    expect(st.settings.place).toBeNull();
    expect(st.report).toBeUndefined();
    expect(forecasts).toBe(0);
  });

  it("fetches for the place, keeps it, and tells the TV", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    const saved = await app.inject({ method: "PUT", url: "/api/weather/settings", payload: { place: LEEDS, temperature: "f" } });
    expect(saved.statusCode).toBe(200);
    const st: WeatherState = saved.json();
    expect(st.settings).toMatchObject({ place: LEEDS, temperature: "f", wind: "mph" });
    expect(st.report?.now).toMatchObject({ tempC: 11.2, feelsC: 9.1, code: 3, isDay: true, windDeg: 230 });
    expect(st.report?.hours.map((h) => h.rainChance)).toEqual([10, 70]);
    expect(st.report?.days[0]).toMatchObject({ maxC: 13, minC: 5, rainMm: 2.5, sunrise: 1_793_344_000_000 });
    expect(requests.find((u) => u.includes("open-meteo.com/v1/forecast"))).toContain("latitude=53.7965");
    expect(events.filter((e) => e.type === "weather.changed").length).toBeGreaterThanOrEqual(2);
    // Fresh for half an hour: asking again doesn't fetch again.
    await app.inject("/api/weather");
    expect(forecasts).toBe(1);
  });

  it("gives the words to pages that ask", async () => {
    await app.inject({ method: "PUT", url: "/api/weather/settings", payload: { place: LEEDS } });
    const st: WeatherState = (await app.inject("/api/weather?words=1")).json();
    expect(st.words?.codes["3-1"]).toEqual({ label: "Cloudy", icon: "cloud" });
    expect(st.words?.codes["61-1"]).toEqual({ label: "Light rain", icon: "drizzle" });
    expect(typeof st.words?.headline).toBe("string");
  });

  it("keeps the last forecast when Open-Meteo is away", async () => {
    await app.inject({ method: "PUT", url: "/api/weather/settings", payload: { place: LEEDS } });
    answers.forecast = () => json({}, 503);
    expect((await app.inject({ method: "POST", url: "/api/weather/refresh" })).statusCode).toBe(502);
    const st: WeatherState = (await app.inject("/api/weather")).json();
    expect(st.report?.now.tempC).toBe(11.2);
    expect(st.error).toMatch(/Couldn't get the forecast/);
  });

  it("forgets the forecast with the place", async () => {
    await app.inject({ method: "PUT", url: "/api/weather/settings", payload: { place: LEEDS } });
    const st: WeatherState = (await app.inject({ method: "PUT", url: "/api/weather/settings", payload: { place: null } })).json();
    expect(st.settings.place).toBeNull();
    expect(st.report).toBeUndefined();
  });

  it("needs the grown-ups' PIN to change", async () => {
    await app.inject({ method: "PATCH", url: "/api/profiles/family", payload: { pin: "1234" } });
    const kids = await app.inject({ method: "PUT", url: "/api/weather/settings", headers: { "x-profile": "kids" }, payload: { place: LEEDS } });
    expect(kids.statusCode).toBe(403);
  });

  it("turns Open-Meteo's answer into a report", () => {
    const r = toReport(LEEDS, FORECAST as never, 5);
    expect(r.fetchedAt).toBe(5);
    expect(r.now.at).toBe(1_793_350_800_000);
    expect(forecastUrl(LEEDS)).toContain("timeformat=unixtime");
    const demo = demoReport(DEMO_PLACE, Date.now());
    expect(demo.hours).toHaveLength(168);
    expect(demo.days).toHaveLength(7);
  });
});

describe("asking for the weather", () => {
  it("understands it by voice", () => {
    for (const said of ["what's the weather like", "weather", "show me the weather", "weather forecast for tomorrow", "will it rain tomorrow", "is it going to be cold"]) {
      expect(parseVoice(said, []).kind, said).toBe("weather");
    }
    expect(parseVoice("watch the weather channel", []).kind).not.toBe("weather");
  });

  it("opens it on the TV from voice or the phone", async () => {
    const events: HubEvent[] = [];
    app.hub.events.on((e) => events.push(e));
    expect((await app.inject({ method: "POST", url: "/api/remote/voice", payload: { text: "What's the weather like?" } })).json().kind).toBe("weather");
    expect((await app.inject({ method: "POST", url: "/api/weather/show" })).statusCode).toBe(200);
    expect(events.filter((e) => e.type === "weather.show")).toHaveLength(2);
  });
});
