// Weather pictures, drawn like the other icons but in colour: a yellow sun, a cloud in the theme's
// own shade, blue rain. They sit on any theme and over the screensaver's photos.

import { Match, Switch } from "solid-js";
import { describeWeather, type WeatherIconName } from "@ultimatetv/shared";

const CLOUD = "M7.5 18h9.5a3.75 3.75 0 0 0 .4-7.48 5.25 5.25 0 0 0-10.1-1.1A4.3 4.3 0 0 0 7.5 18z";

const Sun = (p: { x?: number; y?: number; r?: number }) => {
  const x = p.x ?? 12;
  const y = p.y ?? 12;
  const r = p.r ?? 4.2;
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const rad = (a * Math.PI) / 180;
    return `M${x + Math.cos(rad) * (r + 1.8)} ${y + Math.sin(rad) * (r + 1.8)}L${x + Math.cos(rad) * (r + 3.4)} ${y + Math.sin(rad) * (r + 3.4)}`;
  });
  return (
    <g class="wx-sun">
      <circle cx={x} cy={y} r={r} />
      <path d={rays.join("")} fill="none" />
    </g>
  );
};

const Moon = (p: { scale?: number; x?: number; y?: number }) => <path class="wx-moon" transform={`translate(${p.x ?? 0} ${p.y ?? 0}) scale(${p.scale ?? 1})`} d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />;

const Cloud = (p: { up?: boolean }) => <path class="wx-cloud" d={CLOUD} transform={p.up ? "translate(0 -3)" : undefined} />;

export function WeatherIcon(props: { code?: number; isDay?: boolean; name?: WeatherIconName; class?: string }) {
  const name = () => props.name ?? describeWeather(props.code ?? 3, props.isDay ?? true).icon;
  return (
    <svg class={`wx-icon ${props.class ?? ""}`} viewBox="0 0 24 24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <Switch fallback={<Cloud />}>
        <Match when={name() === "sun"}>
          <Sun />
        </Match>
        <Match when={name() === "moon"}>
          <Moon />
        </Match>
        <Match when={name() === "partly"}>
          <Sun x={8.5} y={8} r={3.2} />
          <path class="wx-cloud" d={CLOUD} transform="translate(1.5 2)" />
        </Match>
        <Match when={name() === "partly-night"}>
          <Moon scale={0.62} x={1} y={0.5} />
          <path class="wx-cloud" d={CLOUD} transform="translate(1.5 2)" />
        </Match>
        <Match when={name() === "fog"}>
          <Cloud up />
          <path class="wx-mist" d="M4 18.5h16M6 21.5h12" fill="none" />
        </Match>
        <Match when={name() === "drizzle"}>
          <Cloud up />
          <path class="wx-rain" d="M9 18.5l-.6 1.6M13 18.5l-.6 1.6M17 18.5l-.6 1.6" fill="none" />
        </Match>
        <Match when={name() === "rain"}>
          <Cloud up />
          <path class="wx-rain" d="M9 18l-1.2 3.2M13 18l-1.2 3.2M17 18l-1.2 3.2" fill="none" />
        </Match>
        <Match when={name() === "heavy-rain"}>
          <Cloud up />
          <path class="wx-rain" d="M7.5 17.5l-1.5 4M11 17.5l-1.5 4M14.5 17.5l-1.5 4M18 17.5l-1.5 4" fill="none" />
        </Match>
        <Match when={name() === "sleet"}>
          <Cloud up />
          <path class="wx-rain" d="M9 18l-1.2 3.2M17 18l-1.2 3.2" fill="none" />
          <path class="wx-snow" d="M13 18.6v2.8M11.8 20h2.4" fill="none" />
        </Match>
        <Match when={name() === "snow"}>
          <Cloud up />
          <path class="wx-snow" d="M8.5 18.4v2.8M7.3 19.8h2.4M12.5 18.4v2.8M11.3 19.8h2.4M16.5 18.4v2.8M15.3 19.8h2.4" fill="none" />
        </Match>
        <Match when={name() === "thunder"}>
          <Cloud up />
          <path class="wx-bolt" d="M12.8 16l-2.6 3.6h2.4l-1.4 3.4 3.8-4.6h-2.5l1.3-2.4z" />
        </Match>
      </Switch>
    </svg>
  );
}
