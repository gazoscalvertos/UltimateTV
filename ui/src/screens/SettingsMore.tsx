// The newer Settings pages: alerts, advert skipping on recordings, seasonal clips, casting, the weather
// and what's new.
// Typing an address on the TV is slow, so the alert URLs can be set from the phone too.

import { createResource, For, Show } from "solid-js";
import type { AlertSettings, ProjectionSettings, SeasonId, WeatherSettings } from "@ultimatetv/shared";
import { daysFromNow, formatBytes, releaseLabel, SEASONS } from "@ultimatetv/shared";
import { hub } from "../api";
import { canCast, castSettings, castState, refreshCast, saveCastSettings, setAirplay, shareUrl } from "../cast";
import { askText, choose } from "../components/Dialog";
import { cycle, Row, Status } from "../components/SettingRow";
import { onHubEvent } from "../events";
import { setWeatherState, weather, weatherLine } from "../weather";
import { errorToast, nav, toast } from "../store";
import { markChangesSeen } from "../whatsnew";
import { onCleanup } from "solid-js";

const onOff = (b: boolean) => (b ? "On" : "Off");
const seasonName = (id: SeasonId | "any" | "auto" | null) => (id === "auto" ? "Follow the calendar" : id === "any" ? "Any season" : (SEASONS.find((s) => s.id === id)?.name ?? "None"));
const ago = (t: number) => {
  const mins = Math.round((Date.now() - t) / 60_000);
  return mins < 2 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
};

export function AlertsSection() {
  const [state, { mutate, refetch }] = createResource(() => hub.alerts());
  onCleanup(onHubEvent((e) => e.type === "alerts.changed" && void refetch()));
  const save = async (patch: Partial<AlertSettings>) => {
    try {
      mutate(await hub.saveAlerts(patch));
    } catch (err) {
      errorToast(err);
    }
  };
  const askUrl = async (label: string, key: "webhookUrl" | "ntfyUrl") => {
    const v = await askText(label, state()?.settings[key] ?? "");
    if (v !== undefined) await save({ [key]: v.trim() });
  };
  return (
    <>
      <h2>Alerts</h2>
      <p class="hint">
        The Hub keeps an eye on the things that stop TV working: the IPTV and TorBox subscriptions running out, the guide going stale, recordings failing, the NAS filling up and live TV not starting. It tells you before
        they break, here and on your phone through Home Assistant or ntfy.
      </p>
      <Show when={state()} fallback={<div class="spinner" />}>
        {(st) => (
          <>
            <Show when={st().alerts.length} fallback={<Row label="Everything looks fine" value={<Status ok text={st().checkedAt ? `Checked ${ago(st().checkedAt!)}` : "Not checked yet"} />} />}>
              <For each={st().alerts}>{(a) => <Row label={a.title} hint={a.message} value={<Status ok={a.level === "info"} text={a.level === "bad" ? "Needs fixing" : a.level === "warn" ? "Soon" : "Note"} />} />}</For>
            </Show>
            <For each={st().expiries}>{(x) => <Row label={x.name} value={daysFromNow(x.at, Date.now())} hint="When the subscription runs out" />}</For>
            <Row label="Home Assistant webhook" hint={st().settings.webhookUrl || "A webhook URL from a Home Assistant automation (or anything taking a JSON POST). Easier to paste from the phone's Settings page"} value={st().settings.webhookUrl ? "Set" : "Not set"} icon="link" onSelect={() => void askUrl("Webhook URL", "webhookUrl")} />
            <HaRows />
            <Row label="Phone notifications (ntfy)" hint={st().settings.ntfyUrl || "An ntfy topic address, such as https://ntfy.sh/your-own-topic, for alerts on a phone without Home Assistant"} value={st().settings.ntfyUrl ? "Set" : "Not set"} icon="phone" onSelect={() => void askUrl("ntfy topic URL", "ntfyUrl")} />
            <Row label="Warn before a subscription runs out" value={`${st().settings.expiryDays} days`} onSelect={() => void save({ expiryDays: cycle([3, 7, 14, 30], st().settings.expiryDays) })} />
            <Row label="Warn when the NAS has less than" value={`${st().settings.diskFreeGb} GB free`} onSelect={() => void save({ diskFreeGb: cycle([10, 20, 50, 100, 250], st().settings.diskFreeGb) })} />
            <Row label="Show them on the TV" hint="A friendly note on the grown-ups' profiles, never on Kids" value={onOff(st().settings.onTv)} onSelect={() => void save({ onTv: !st().settings.onTv })} />
            <Row label="Check now" icon="restart" onSelect={() => void hub.checkAlerts().then(mutate, errorToast)} />
            <Show when={st().configured}>
              <Row label="Send a test alert" icon="bell" onSelect={() => void hub.testAlert().then(() => toast("Test alert sent", "good"), errorToast)} />
            </Show>
          </>
        )}
      </Show>
    </>
  );
}

/** Home Assistant's playback events: lights that dim when a film starts. */
function HaRows() {
  const [ha, { mutate }] = createResource(() => hub.haSettings().catch(() => null));
  const ask = async () => {
    const v = await askText("Playback events webhook", ha()?.settings.webhookUrl ?? "");
    if (v !== undefined) await hub.saveHa({ webhookUrl: v.trim() }).then(mutate, errorToast);
  };
  return (
    <Show when={ha()}>
      {(h) => (
        <>
          <Row
            label="Playback events for Home Assistant"
            hint={h().settings.webhookUrl || "A second webhook, told when a film starts, pauses, stops or reaches the credits, so the lights can follow. Easier to paste from the phone's Settings page"}
            value={h().settings.webhookUrl ? "Set" : "Not set"}
            icon="link"
            onSelect={() => void ask()}
          />
          <Show when={h().settings.webhookUrl}>
            <Row label="Send a test playback event" icon="bell" onSelect={() => void hub.testHa().then(() => toast("Test event sent", "good"), errorToast)} />
          </Show>
        </>
      )}
    </Show>
  );
}

/** Advert skipping, under Settings › Recording. */
export function AdvertRows() {
  const [ads, { mutate }] = createResource(() => hub.adskip().catch(() => null));
  const save = (patch: Parameters<typeof hub.saveAdskip>[0]) => void hub.saveAdskip(patch).then(mutate, errorToast);
  return (
    <Show when={ads()}>
      {(a) => (
        <>
          <Row
            label="Find the adverts in recordings"
            hint={a().installed === false ? "comskip isn't on the Hub: update the Hub to get it" : "comskip looks through each new recording for the breaks, which takes a few minutes"}
            value={a().installed === false ? <Status ok={false} text="Not installed" /> : onOff(a().settings.enabled)}
            onSelect={() => save({ enabled: !a().settings.enabled })}
          />
          <Show when={a().settings.enabled}>
            <Row label="Adverts in a recording" hint="Like Skip intro: a button, or straight past them" value={a().settings.mode === "auto" ? "Skip them" : "Show a Skip button"} onSelect={() => save({ mode: a().settings.mode === "auto" ? "button" : "auto" })} />
          </Show>
        </>
      )}
    </Show>
  );
}

export function SeasonalSection() {
  const [state, { mutate, refetch }] = createResource(() => hub.projections());
  const [library, { refetch: refetchLibrary }] = createResource(() => hub.community().catch(() => null));
  onCleanup(onHubEvent((e) => e.type === "projections.changed" && void refetch()));
  const save = async (patch: Partial<ProjectionSettings>) => {
    try {
      mutate(await hub.saveProjections(patch));
    } catch (err) {
      errorToast(err);
    }
  };
  const download = async (id: string, name: string) => {
    toast(`Downloading ${name}…`);
    try {
      await hub.downloadCommunity(id);
      toast(`${name} is on the Hub`, "good");
      void refetch();
      void refetchLibrary();
    } catch (err) {
      errorToast(err);
    }
  };
  return (
    <>
      <h2>Seasonal clips</h2>
      <p class="hint">
        Like the projections people put in their windows: now and then, something friendly drifts across the TV for the season. A sleigh at Christmas, a bunny at Easter, fireworks for New Year and Bonfire Night,
        ghosts at Halloween. Upload your own from the phone remote, or download ones others have shared.
      </p>
      <Show when={state()} fallback={<div class="spinner" />}>
        {(st) => {
          const s = () => st().settings;
          return (
            <>
              <Row label="Seasonal clips" value={onOff(s().enabled)} hint={st().season ? `It's ${seasonName(st().season)} now` : "No season on today's date: they come back for the next one"} onSelect={() => void save({ enabled: !s().enabled })} />
              <Row label="Season" value={seasonName(s().season)} hint="Pick one to keep it on whatever the date, for a birthday party say" onSelect={() => void save({ season: cycle(["auto", ...SEASONS.map((x) => x.id)] as const, s().season) })} />
              <Row label="At most one every" value={`${s().minGapMinutes} min`} onSelect={() => void save({ minGapMinutes: cycle([10, 20, 30, 45, 60, 120, 240], s().minGapMinutes) })} />
              <Row label="How likely" hint="The chance in each minute once that gap has passed" value={`${s().chancePercent}%`} onSelect={() => void save({ chancePercent: cycle([5, 10, 20, 50, 100], s().chancePercent) })} />
              <Row label="On screen for" value={`${s().seconds} sec`} onSelect={() => void save({ seconds: cycle([5, 8, 10, 15, 20], s().seconds) })} />
              <Row label="How loud" hint="For clips with sound; the TV's own are silent" value={`${Math.round(s().volume * 100)}%`} onSelect={() => void save({ volume: cycle([0, 0.2, 0.4, 0.7, 1], s().volume) })} />
              <Row label="On the Kids profile" value={onOff(s().kids)} onSelect={() => void save({ kids: !s().kids })} />
              <Row label="During live TV too" value={onOff(s().duringLive)} onSelect={() => void save({ duringLive: !s().duringLive })} />
              <Row label="Only while something is playing" value={onOff(s().whilePlayingOnly)} onSelect={() => void save({ whilePlayingOnly: !s().whilePlayingOnly })} />
              <Row label="The TV's own drawings" hint="Mix in the TV's drawn ones as well as uploaded clips" value={onOff(s().drawn)} onSelect={() => void save({ drawn: !s().drawn })} />
              <Row label="Your clips" value={st().clips.length ? String(st().clips.length) : "None yet"} hint={st().clips.map((c) => `${c.name} (${seasonName(c.season)})`).join(" · ") || "Upload them from the phone remote's Scares and clips tab"} />
              <Row label="Try one now" icon="sparkle" hint="Shows one on this TV straight away" onSelect={() => void hub.projectionNow(st().season ? {} : { season: "christmas" }).catch(errorToast)} />
              <h3>Shared by others</h3>
              <Show when={library()} fallback={<p class="hint">The community library couldn't be reached.</p>}>
                {(lib) => (
                  <Show when={lib().clips.length} fallback={<p class="hint">{lib().error ? `The community library couldn't be read: ${lib().error}` : "Nothing in the community library yet. Share yours: see community/clips in the project on GitHub."}</p>}>
                    <For each={lib().clips}>
                      {(c) => (
                        <Row
                          label={c.name}
                          hint={[c.use === "scare" ? "Jump scare" : seasonName(c.season), c.author ? `by ${c.author}` : "", c.sizeBytes ? formatBytes(c.sizeBytes) : ""].filter(Boolean).join(" · ")}
                          icon={c.downloaded ? "check" : "download"}
                          value={c.downloaded ? "On the Hub" : "Download"}
                          onSelect={() => !c.downloaded && void download(c.id, c.name)}
                        />
                      )}
                    </For>
                  </Show>
                )}
              </Show>
            </>
          );
        }}
      </Show>
    </>
  );
}

export function CastSection() {
  void refreshCast();
  const save = (patch: Parameters<typeof saveCastSettings>[0]) => void saveCastSettings(patch).catch(errorToast);
  return (
    <>
      <h2>Cast and games</h2>
      <p class="hint">Who may put other screens on the TV. The TV always asks before showing a laptop's screen, and nothing can be cast onto the Kids profile.</p>
      <Row label="Open Cast and games" icon="cast" onSelect={() => nav.push({ name: "cast" })} />
      <Show when={canCast()}>
        <Row
          label="AirPlay (iPhone, iPad and Mac)"
          hint={castState().airplay.installed ? `Shows up as “${castState().airplay.name}” in Screen Mirroring` : "UxPlay isn't on the box yet: run the box installer again"}
          value={castState().airplay.installed ? onOff(castState().airplay.enabled) : <Status ok={false} text="Not installed" />}
          onSelect={() => castState().airplay.installed && void setAirplay(!castState().airplay.enabled).catch(errorToast)}
        />
      </Show>
      <Row label="Laptops can share their screen" hint={shareUrl() ? `From a browser at ${shareUrl()}` : "From a browser on the same network"} value={onOff(castSettings().screenShare)} onSelect={() => save({ screenShare: !castSettings().screenShare })} />
      <Row label="Phones can send links and photos" value={onOff(castSettings().links)} onSelect={() => save({ links: !castSettings().links })} />
      <Row label="Games on the Kids profile" hint="Retro games, Moonlight and the rest open from the Kids profile too" value={onOff(castSettings().gamesForKids)} onSelect={() => save({ gamesForKids: !castSettings().gamesForKids })} />
    </>
  );
}

/** Where the household lives and how the weather shows. Typing a postcode is quicker on the phone's Settings page. */
export function WeatherSection() {
  const st = weather;
  const save = async (patch: Partial<WeatherSettings>) => {
    try {
      setWeatherState(await hub.saveWeather(patch));
    } catch (err) {
      errorToast(err);
    }
  };
  const pickPlace = async () => {
    const q = await askText("Town or postcode", "");
    if (!q) return;
    try {
      const { places } = await hub.weatherPlaces(q);
      if (!places.length) return toast(`Couldn't find “${q}”. Try the nearest town, or a postcode.`, "bad");
      const place = places.length === 1 ? places[0] : await choose({ title: "Which one?", options: places.map((p) => ({ label: p.name, value: p, ...(p.detail ? { detail: p.detail } : {}) })) });
      if (place) {
        await save({ place });
        toast(`The weather is for ${place.name} now`, "good");
      }
    } catch (err) {
      errorToast(err);
    }
  };
  return (
    <>
      <h2>Weather</h2>
      <p class="hint">Today's weather on Home, the temperature along the top and on the screensaver, and the week ahead when you choose the temperature. From Open-Meteo, free and with no account.</p>
      <Show when={st()} fallback={<div class="spinner" />}>
        {(s) => (
          <>
            <Row label="Where" icon="edit" value={s().settings.place?.name ?? <Status ok={false} text="Not set" />} hint={s().settings.place?.detail ?? "A town or a postcode (the phone's Settings page takes a latitude and longitude too)"} onSelect={() => void pickPlace()} />
            <Show when={s().report}>
              <Row label="Now" value={weatherLine(s())} hint={s().error ?? "Opens the forecast"} icon="info" onSelect={() => nav.push({ name: "weather" })} />
            </Show>
            <Show when={!s().report && s().error}>
              <Row label="The forecast" value={<Status ok={false} text="Not reaching Open-Meteo" />} hint={s().error!} icon="restart" onSelect={() => void hub.refreshWeather().then(setWeatherState, errorToast)} />
            </Show>
            <Row label="Temperature in" value={s().settings.temperature === "c" ? "°C" : "°F"} onSelect={() => void save({ temperature: s().settings.temperature === "c" ? "f" : "c" })} />
            <Row label="Wind in" value={s().settings.wind === "mph" ? "mph" : "km/h"} onSelect={() => void save({ wind: s().settings.wind === "mph" ? "kmh" : "mph" })} />
            <Row label="On Home" hint="Today's weather in the top corner" value={onOff(s().settings.onHome)} onSelect={() => void save({ onHome: !s().settings.onHome })} />
            <Row label="Along the top" hint="The temperature next to the clock; choose it for the week ahead" value={onOff(s().settings.inTopBar)} onSelect={() => void save({ inTopBar: !s().settings.inTopBar })} />
            <Row label="On the screensaver" hint="Under the clock" value={onOff(s().settings.onScreensaver)} onSelect={() => void save({ onScreensaver: !s().settings.onScreensaver })} />
            <Show when={s().settings.place}>
              <Row label="Forget where we live" icon="trash" onSelect={() => void save({ place: null })} />
            </Show>
          </>
        )}
      </Show>
    </>
  );
}

/** Every change, newest first, from the Hub's CHANGELOG.md. Opening it counts as having seen them. */
export function WhatsNewSection() {
  const [log] = createResource(() =>
    hub.changelog().then((l) => {
      markChangesSeen(l);
      return l;
    }),
  );
  return (
    <>
      <h2>What's new</h2>
      <p class="hint">What has changed in the app, newest first. After an update, Home shows the new things once.</p>
      <Show when={log()} fallback={<Show when={log.error} fallback={<div class="spinner" />}><p class="hint">Couldn't ask the Hub.</p></Show>}>
        <Show when={log()!.releases.length} fallback={<p class="hint">This Hub doesn't have a change log.</p>}>
          <For each={log()!.releases}>
            {(r) => (
              <>
                <h3 class="whatsnew-date">{releaseLabel(r)}</h3>
                <Show when={r.note}>
                  <p class="hint">{r.note}</p>
                </Show>
                <For each={r.entries}>{(e) => <Row label={e.title} {...(e.text ? { hint: e.text } : {})} />}</For>
              </>
            )}
          </For>
        </Show>
      </Show>
    </>
  );
}
