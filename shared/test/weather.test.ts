import { describe, expect, it } from "vitest";
import { cleanWeatherSettings, compass, DEFAULT_WEATHER_SETTINGS, describeWeather, formatTemp, formatWind, parseLatLon, UK_POSTCODE, weatherHeadline, type WeatherReport } from "../src/weather.js";

const at = (h: number) => new Date(2026, 9, 30, h).getTime();

/** A day of weather from midnight: `codes` and `chance` by hour, 10° unless `temps` says. */
function report(codes: (h: number) => number, chance: (h: number) => number, temps: (h: number) => number = () => 10, nowHour = 9): WeatherReport {
  const hours = Array.from({ length: 48 }, (_, h) => ({ at: at(0) + h * 3600_000, tempC: temps(h), code: codes(h), isDay: true, rainChance: chance(h), windKmh: 10 }));
  const now = hours[nowHour]!;
  return {
    place: { name: "Leeds", lat: 53.8, lon: -1.55 },
    fetchedAt: now.at,
    now: { at: now.at, tempC: now.tempC, feelsC: now.tempC, code: now.code, isDay: true, humidity: 80, windKmh: 10, gustKmh: 20, windDeg: 225, rainMm: 0 },
    hours,
    days: [{ date: at(0), code: 3, maxC: 12, minC: 4, rainChance: 50, rainMm: 1, sunrise: at(7), sunset: at(17), uv: 1, windKmh: 20 }],
  };
}

describe("weather words", () => {
  it("names codes by day and night", () => {
    expect(describeWeather(0, true)).toEqual({ label: "Sunny", icon: "sun" });
    expect(describeWeather(0, false)).toEqual({ label: "Clear", icon: "moon" });
    expect(describeWeather(2, false).icon).toBe("partly-night");
    expect(describeWeather(65).label).toBe("Heavy rain");
    expect(describeWeather(95).icon).toBe("thunder");
    expect(describeWeather(1234).icon).toBe("cloud");
  });

  it("shows the household's units", () => {
    expect(formatTemp(9.6, "c")).toBe("10°");
    expect(formatTemp(10, "f")).toBe("50°");
    expect(formatWind(16.09344, "mph")).toBe("10 mph");
    expect(formatWind(16, "kmh")).toBe("16 km/h");
    expect(compass(225)).toBe("SW");
    expect(compass(-10)).toBe("N");
    expect(compass(350)).toBe("N");
  });

  it("says when the rain comes", () => {
    expect(weatherHeadline(report((h) => (h >= 16 ? 61 : 3), (h) => (h >= 16 ? 70 : 10)), at(9))).toBe("Rain from 4pm");
    expect(weatherHeadline(report((h) => (h === 12 ? 73 : 3), (h) => (h === 12 ? 80 : 0)), at(9))).toBe("Snow from midday");
  });

  it("says when the rain stops", () => {
    expect(weatherHeadline(report((h) => (h < 14 ? 63 : 2), (h) => (h < 14 ? 90 : 5)), at(9))).toBe("Rain until about 2pm");
    expect(weatherHeadline(report(() => 63, () => 90), at(9))).toBe("Rain for the next few hours");
  });

  it("ignores a small chance of rain", () => {
    expect(weatherHeadline(report((h) => (h >= 16 ? 61 : 3), () => 20), at(9))).toBe("Dry all day");
    expect(weatherHeadline(report(() => 1, () => 0), at(19), "mph")).toBe("Dry tonight");
  });

  it("warns of frost and wind", () => {
    expect(weatherHeadline(report(() => 0, () => 0, (h) => (h > 20 ? -2 : 5)), at(16))).toBe("Frost tonight");
    const windy = report(() => 3, () => 0);
    windy.now.gustKmh = 80;
    expect(weatherHeadline(windy, at(9), "mph")).toBe("Windy, gusts up to 50 mph");
  });
});

describe("weather settings", () => {
  it("keeps what's sensible", () => {
    const s = cleanWeatherSettings({ place: { name: "  Leeds  ", lat: 53.79651, lon: -1.54786 }, temperature: "k" as never, wind: "kmh", onHome: false });
    expect(s).toEqual({ ...DEFAULT_WEATHER_SETTINGS, place: { name: "Leeds", lat: 53.7965, lon: -1.5479 }, wind: "kmh", onHome: false });
    expect(cleanWeatherSettings({ place: { name: "Nowhere", lat: 200, lon: 0 } }, s).place).toBeNull();
    expect(cleanWeatherSettings({ place: null }, s).place).toBeNull();
    expect(cleanWeatherSettings({}, s).place?.name).toBe("Leeds");
  });

  it("reads latitude and longitude and UK postcodes", () => {
    expect(parseLatLon("53.8, -1.55")).toEqual({ lat: 53.8, lon: -1.55 });
    expect(parseLatLon("53.8 -1.55")).toEqual({ lat: 53.8, lon: -1.55 });
    expect(parseLatLon("Leeds")).toBeNull();
    expect(UK_POSTCODE.exec("ls6 2ab")?.slice(1)).toEqual(["ls6", "2ab"]);
    expect(UK_POSTCODE.exec("SW1A1AA")?.slice(1)).toEqual(["SW1A", "1AA"]);
    expect(UK_POSTCODE.exec("LS6")?.[1]).toBe("LS6");
    expect(UK_POSTCODE.test("Leeds")).toBe(false);
  });
});
