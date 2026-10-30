// The forecast: now on the left with the next hours under it, the week down the right. Moving
// through the days shows each day's hours. Opened from the temperature in the top bar, by voice
// ("what's the weather like") or from the phone.

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { compass, dayName, describeWeather, formatTemp, formatWind, hoursFrom, weatherHeadline, type WeatherDay, type WeatherHour } from "@ultimatetv/shared";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { WeatherIcon } from "../components/WeatherIcon";
import { useHints } from "../hints";
import { nav, now } from "../store";
import { loadWeather, weather } from "../weather";

const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const hourLabel = (t: number, first: boolean) => (first ? "Now" : clock(t));

export function Weather() {
  onMount(() => void loadWeather());
  useHints(() => [{ key: "updown", label: "Another day" }, { key: "back", label: "Back" }]);
  const st = () => weather();
  const report = () => st()?.report;
  const units = () => st()?.settings ?? { temperature: "c" as const, wind: "mph" as const };
  const t = (c: number) => formatTemp(c, units().temperature);
  const [day, setDay] = createSignal(0);

  const days = () => report()?.days ?? [];
  /** The hours along the bottom: from now for today, the whole day (every other hour) for the rest. */
  const hours = createMemo((): WeatherHour[] => {
    const r = report();
    if (!r) return [];
    const d = days()[day()];
    if (!d || day() === 0) return hoursFrom(r, now(), 12);
    return r.hours.filter((h) => h.at >= d.date && h.at < d.date + 86_400_000 && new Date(h.at).getHours() % 2 === 0);
  });
  const week = createMemo(() => {
    const list = days();
    return { lo: Math.min(...list.map((d) => d.minC)), hi: Math.max(...list.map((d) => d.maxC)) };
  });
  const bar = (d: WeatherDay) => {
    const span = Math.max(1, week().hi - week().lo);
    return { left: `${((d.minC - week().lo) / span) * 100}%`, width: `${Math.max(6, ((d.maxC - d.minC) / span) * 100)}%` };
  };
  const ago = (at: number) => {
    const mins = Math.round((now() - at) / 60_000);
    return mins < 2 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  };

  return (
    <div class="screen weather-screen" data-layer>
      <TopBar />
      <div class="page weather-page">
        <Show when={st()} fallback={<div class="spinner" />}>
          {(s) => (
            <Show
              when={report()}
              fallback={
                <div class="weather-empty">
                  <WeatherIcon name="partly" class="wx-huge" />
                  <h1>{s().settings.place ? "The forecast isn't here yet" : "Where do you live?"}</h1>
                  <p>{s().settings.place ? (s().error ?? "It's on its way.") : "Tell the TV your town or postcode, and the weather shows on Home, along the top and on the screensaver."}</p>
                  <button class="btn btn-primary btn-large" data-focus data-autofocus onClick={() => nav.push({ name: "settings", section: "weather" })}>
                    <Icon name="edit" />
                    {s().settings.place ? "Weather settings" : "Set your town or postcode"}
                  </button>
                </div>
              }
            >
              {(r) => {
                const sel = () => days()[day()] ?? days()[0];
                return (
                  <div class="weather-layout">
                    <section class="wx-now">
                      <div class="wx-place">
                        {r().place.name}
                        <Show when={r().place.detail}>
                          <small>{r().place.detail}</small>
                        </Show>
                      </div>
                      <Show
                        when={day() === 0}
                        fallback={
                          <div class="wx-now-main">
                            <WeatherIcon code={sel()!.code} class="wx-huge" />
                            <span class="wx-temp">{t(sel()!.maxC)}</span>
                            <div class="wx-now-text">
                              <b>{dayName(sel()!.date, now())}</b>
                              <span>{describeWeather(sel()!.code).label}</span>
                              <span>Low {t(sel()!.minC)}</span>
                            </div>
                          </div>
                        }
                      >
                        <div class="wx-now-main">
                          <WeatherIcon code={r().now.code} isDay={r().now.isDay} class="wx-huge" />
                          <span class="wx-temp">{t(r().now.tempC)}</span>
                          <div class="wx-now-text">
                            <b>{describeWeather(r().now.code, r().now.isDay).label}</b>
                            <span>Feels like {t(r().now.feelsC)}</span>
                            <Show when={days()[0]}>{(d) => <span>High {t(d().maxC)} · Low {t(d().minC)}</span>}</Show>
                          </div>
                        </div>
                        <p class="wx-headline">{weatherHeadline(r(), now(), units().wind)}</p>
                      </Show>
                      <div class="wx-facts">
                        <span>
                          <small>Wind</small>
                          {day() === 0 ? `${formatWind(r().now.windKmh, units().wind)} ${compass(r().now.windDeg)}` : formatWind(sel()!.windKmh, units().wind)}
                        </span>
                        <Show when={day() === 0} fallback={<span><small>Rain</small>{sel()!.rainChance}%{sel()!.rainMm >= 0.5 ? ` · ${sel()!.rainMm.toFixed(1)} mm` : ""}</span>}>
                          <span>
                            <small>Gusts</small>
                            {formatWind(r().now.gustKmh, units().wind)}
                          </span>
                          <span>
                            <small>Humidity</small>
                            {Math.round(r().now.humidity)}%
                          </span>
                        </Show>
                        <span>
                          <small>Sunrise</small>
                          {clock(sel()!.sunrise)}
                        </span>
                        <span>
                          <small>Sunset</small>
                          {clock(sel()!.sunset)}
                        </span>
                        <span>
                          <small>UV</small>
                          {Math.round(sel()!.uv)}
                        </span>
                      </div>
                      <h2 class="wx-section-title">{day() === 0 ? "The next 12 hours" : dayName(sel()!.date, now())}</h2>
                      <div class="wx-hours">
                        <For each={hours()}>
                          {(h, i) => (
                            <div class="wx-hour" classList={{ wet: h.rainChance >= 40 }}>
                              <span class="wx-hour-time">{hourLabel(h.at, day() === 0 && i() === 0)}</span>
                              <WeatherIcon code={h.code} isDay={h.isDay} />
                              <b>{t(h.tempC)}</b>
                              <small>{h.rainChance >= 10 ? `${h.rainChance}%` : " "}</small>
                            </div>
                          )}
                        </For>
                      </div>
                      <p class="wx-updated">
                        Updated {ago(r().fetchedAt)} · Open-Meteo
                        <Show when={s().error}> · {s().error}</Show>
                      </p>
                    </section>
                    <section class="wx-week" data-focus-group>
                      <For each={days()}>
                        {(d, i) => (
                          <button class="wx-day" classList={{ active: day() === i() }} data-focus data-autofocus={i() === 0 ? "" : undefined} onFocus={() => setDay(i())} onClick={() => setDay(i())}>
                            <span class="wx-day-name">{dayName(d.date, now())}</span>
                            <WeatherIcon code={d.code} />
                            <span class="wx-day-rain">{d.rainChance >= 20 ? `${d.rainChance}%` : ""}</span>
                            <span class="wx-day-lo">{t(d.minC)}</span>
                            <span class="wx-range">
                              <i style={bar(d)} />
                            </span>
                            <span class="wx-day-hi">{t(d.maxC)}</span>
                          </button>
                        )}
                      </For>
                    </section>
                  </div>
                );
              }}
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}
