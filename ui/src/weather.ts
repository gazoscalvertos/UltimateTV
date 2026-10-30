// The weather the Hub fetched, for the top bar, Home, the forecast page and the screensaver. Loaded
// once and again whenever the Hub says there's a new forecast (every half hour).

import { createSignal } from "solid-js";
import { describeWeather, formatTemp, weatherHeadline, type WeatherState } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { nowPlaying } from "./player";
import { nav, toast } from "./store";

const [weather, setWeather] = createSignal<WeatherState | null>(null);
export { weather };

/** Today's weather in a line, for a toast or a caption: "12° Light rain · Rain until about 4pm". */
export function weatherLine(st: WeatherState, now = Date.now()): string {
  const r = st.report;
  if (!r) return "";
  return `${formatTemp(r.now.tempC, st.settings.temperature)} ${describeWeather(r.now.code, r.now.isDay).label} · ${weatherHeadline(r, now, st.settings.wind)}`;
}

export function loadWeather(): Promise<void> {
  return hub.weather().then(
    (st) => void setWeather(st),
    () => undefined,
  );
}

export function setWeatherState(st: WeatherState): void {
  setWeather(st);
}

export function startWeather(): void {
  void loadWeather();
  // The Hub fetches every half hour and says so; this catches a missed event.
  window.setInterval(() => void loadWeather(), 20 * 60_000);
  onHubEvent((e) => {
    if (e.type === "weather.changed" || e.type === "hello") void loadWeather();
    if (e.type === "weather.show") {
      const st = weather();
      // Don't pull the picture away from a film: say it instead.
      if (nowPlaying() && st?.report) toast(`${st.settings.place?.name ?? "Weather"}: ${weatherLine(st)}`);
      else if (nav.current().name !== "weather" && nav.current().name !== "profiles") nav.push({ name: "weather" });
    }
  });
}
