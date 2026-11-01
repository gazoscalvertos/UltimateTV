// Today's weather in the top corner of Home: how it is now, the day's high and low, and the one
// thing worth knowing ("Rain from 4pm"). The temperature in the top bar opens the full forecast.

import { Show } from "solid-js";
import { describeWeather, formatTemp, weatherHeadline } from "@ultimatetv/shared";
import { featureOn } from "../features";
import { now } from "../store";
import { weather } from "../weather";
import { WeatherIcon } from "./WeatherIcon";

export function HomeWeather() {
  const shown = () => {
    const st = weather();
    return featureOn("weather") && st?.settings.onHome && st.report ? { report: st.report, settings: st.settings } : undefined;
  };
  return (
    <Show when={shown()}>
      {(w) => {
        const t = (c: number) => formatTemp(c, w().settings.temperature);
        const today = () => w().report.days[0];
        return (
          <aside class="home-weather" aria-label="Today's weather">
            <WeatherIcon code={w().report.now.code} isDay={w().report.now.isDay} class="home-weather-icon" />
            <div class="home-weather-text">
              <div class="home-weather-top">
                <b>{t(w().report.now.tempC)}</b>
                <span>{describeWeather(w().report.now.code, w().report.now.isDay).label}</span>
              </div>
              <small>
                {w().report.place.name}
                <Show when={today()}>{(d) => <> · {t(d().maxC)} / {t(d().minC)}</>}</Show>
              </small>
              <small class="home-weather-headline">{weatherHeadline(w().report, now(), w().settings.wind)}</small>
            </div>
          </aside>
        );
      }}
    </Show>
  );
}
