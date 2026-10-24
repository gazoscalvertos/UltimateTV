// Rows of cards: titles (posters), channels on now, recordings.

import { For, Match, Show, Switch } from "solid-js";
import type { NowNext, Rail as RailData, Recording, TitleRef } from "@ultimatetv/shared";
import { clockTime, dayLabel, episodeLabel } from "@ultimatetv/shared";
import { play } from "../player";
import { nav, now } from "../store";

export function Progress(props: { value: number; class?: string }) {
  return (
    <div class={`progress ${props.class ?? ""}`}>
      <div style={{ width: `${Math.max(0, Math.min(1, props.value)) * 100}%` }} />
    </div>
  );
}

export function Poster(props: { title: TitleRef; wide?: boolean; onSelect?: () => void }) {
  const t = () => props.title;
  const image = () => (props.wide ? (t().backdrop ?? t().poster) : (t().poster ?? t().backdrop));
  return (
    <button class={`card ${props.wide ? "card-wide" : "card-poster"}`} data-focus onClick={() => (props.onSelect ? props.onSelect() : nav.push({ name: "details", id: t().id }))}>
      <div class="card-art">
        <Show when={image()} fallback={<div class="card-fallback">{t().name}</div>}>
          <img src={image()} alt="" loading="lazy" />
        </Show>
        <Show when={t().badges?.length}>
          <span class="card-badge">{t().badges![0]}</span>
        </Show>
        <Show when={t().progress}>
          <Progress value={t().progress!} class="card-progress" />
        </Show>
      </div>
      <div class="card-label">
        <span class="card-title">{t().name}</span>
        <Show when={t().subtitle ?? t().year}>
          <span class="card-sub">{t().subtitle ?? t().year}</span>
        </Show>
      </div>
    </button>
  );
}

export function ChannelCard(props: { item: NowNext }) {
  const c = () => props.item.channel;
  const p = () => props.item.now;
  const progress = () => (p() ? (now() - p()!.start) / (p()!.end - p()!.start) : 0);
  return (
    <button class="card card-wide card-channel" data-focus onClick={() => void play({ kind: "channel", id: c().id })}>
      <div class="card-art">
        <Show when={p()?.image} fallback={<div class="card-fallback channel-fallback">{c().name}</div>}>
          <img src={p()!.image} alt="" loading="lazy" />
        </Show>
        <div class="channel-chip">
          <Show when={c().logo} fallback={<span>{c().name}</span>}>
            <img src={c().logo} alt={c().name} />
          </Show>
        </div>
        <span class="channel-number">{c().number}</span>
        <Progress value={progress()} class="card-progress" />
      </div>
      <div class="card-label">
        <span class="card-title">{p()?.title ?? "No information"}</span>
        <span class="card-sub">
          {c().name}
          <Show when={p()}> · until {clockTime(p()!.end)}</Show>
        </span>
      </div>
    </button>
  );
}

export function RecordingCard(props: { recording: Recording }) {
  const r = () => props.recording;
  const progress = () => (r().positionMs && r().end > r().start ? r().positionMs / (r().programme.end - r().programme.start) : 0);
  return (
    <button class="card card-wide" data-focus onClick={() => void play({ kind: "recording", id: r().id })}>
      <div class="card-art">
        <Show when={r().programme.image} fallback={<div class="card-fallback">{r().programme.title}</div>}>
          <img src={r().programme.image} alt="" loading="lazy" />
        </Show>
        <Show when={!r().watched}>
          <span class="card-badge card-badge-new">New</span>
        </Show>
        <Show when={progress() > 0}>
          <Progress value={progress()} class="card-progress" />
        </Show>
      </div>
      <div class="card-label">
        <span class="card-title">{r().programme.title}</span>
        <span class="card-sub">
          {[episodeLabel(r().programme.season, r().programme.episode), r().channelName, dayLabel(r().programme.start)].filter(Boolean).join(" · ")}
        </span>
      </div>
    </button>
  );
}

export function RailRow(props: { rail: RailData }) {
  const wide = () => props.rail.id === "continue" || props.rail.id === "nextup";
  return (
    <section class="rail" data-row>
      <h3 class="rail-title">{props.rail.title}</h3>
      <div class="rail-track" data-scroll-x="96" data-focus-group>
        <Switch>
          <Match when={props.rail.kind === "channels"}>
            <For each={props.rail.channels ?? []}>{(item) => <ChannelCard item={item} />}</For>
          </Match>
          <Match when={props.rail.kind === "recordings"}>
            <For each={props.rail.recordings ?? []}>{(r) => <RecordingCard recording={r} />}</For>
          </Match>
          <Match when={true}>
            <For each={props.rail.items}>{(t) => <Poster title={t} wide={wide()} />}</For>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
