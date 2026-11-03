// The box's own screen, and Limited mode (#78): the reduced TV app that works with the Hub down.
// Everything goes through window.ultimatetv, the same bridge the TV app uses (box/src/preload.ts),
// so none of this needs the network except the streams themselves: the channels' own URLs, the
// Jellyfin server and this box's downloads, all of which the box saved or owns.
//
// What is here comes from agent.limitedView(), which the box builds from its cached snapshot and
// already filtered for the profile on the TV. A Kids profile therefore sees only what it may see,
// even though nobody can ask the Hub: see shared/src/limited.ts (allowsChannel/allowsTitle), which
// is the one copy of those rules the Hub and the box both use.
"use strict";

const agent = window.ultimatetv;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? h + ":" : ""}${m}:${String(s % 60).padStart(2, "0")}`;
};
const time = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayName = (ms, today = Date.now()) => {
  const a = new Date(ms);
  const b = new Date(today);
  const days = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return a.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};
const remaining = (positionMs, durationMs) => (durationMs ? `${Math.max(0, Math.round((durationMs - positionMs) / 60_000))} min left` : "");

// ---------------------------------------------------------------------------
// The time, and what's wrong

function tick() {
  const now = new Date();
  $("time").textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

let status = null;
let profile = null;
let hubBack = false;

async function showStatus() {
  const s = await agent.hubStatus().catch(() => null);
  if (!s) return;
  status = s;
  profile = s.profile;
  hubBack = s.hubBack === true;
  document.title = s.appName;
  $("brand").replaceChildren(document.createTextNode(s.appName), el("b", "", " · Limited mode"));
  const host = (() => {
    try {
      return new URL(s.hubUrl).host;
    } catch {
      return s.hubUrl;
    }
  })();
  const nonet = !s.addresses.length;
  $("status").classList.toggle("nonet", nonet);
  $("status").classList.toggle("back", hubBack);
  $("headline").textContent = hubBack ? "The Hub is back" : nonet ? "This box isn't connected to the network" : `Can't reach the Hub at ${host}`;
  const since = s.since ? ` (since ${new Date(s.since).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })})` : "";
  $("detail").textContent = hubBack
    ? "The TV app comes back by itself the moment nothing is playing."
    : `${s.reason ? s.reason + since + ". " : ""}Trying again every few seconds: the TV app comes back by itself as soon as the Hub answers.`;
  $("network").textContent = nonet
    ? "Check the network cable or Wi-Fi. Live TV, downloads and films below still work."
    : `This box is on the network (${s.addresses.join(", ")}). If the server is restarting, give it a minute.`;
}

// ---------------------------------------------------------------------------
// Live TV and the guide, from the week the box saved

let view = null;
let guideDay = 0;

function channelCard(c) {
  const card = el("div", "card channel");
  card.dataset.focus = "";
  const art = el("div", "art", c.logo ? "" : String(c.number));
  if (c.logo) art.style.backgroundImage = `url("${c.logo}")`;
  const text = el("div", "text");
  const sub = c.now ? `${time(c.now.start)} ${c.now.title}` : c.playable ? "Live now" : "No stream saved";
  text.append(el("b", "", c.name), el("small", "", sub));
  card.append(art, text);
  if (!c.playable) {
    card.classList.add("off");
    card.onclick = () => void say(`${c.name} has no stream this box can play with the Hub off.`);
  } else {
    card.onclick = () => void playChannel(c);
  }
  return card;
}

function renderLive() {
  const rail = $("live");
  rail.replaceChildren();
  const channels = (view ? view.channels : []).slice(0, 40);
  for (const c of channels) rail.append(channelCard(c));
  const any = channels.filter((c) => c.playable).length;
  if (!channels.length) rail.append(el("p", "empty", "No channels saved yet. They fill up while the Hub is on."));
  const saved = view ? `saved ${ago(view.at)}` : "";
  $("live-note").textContent = any === channels.length ? `${saved} · ${any} channel${any === 1 ? "" : "s"}` : `${saved} · ${any} of ${channels.length} can play`;
  $("live-section").hidden = !channels.length;
}

function renderDays() {
  const rail = $("days");
  rail.replaceChildren();
  const from = view ? view.guideFrom : Date.now();
  const to = view ? view.guideTo : Date.now();
  const seen = new Set();
  for (let at = startOfDay(Math.max(from, Date.now())); at < to; at += 86_400_000) {
    const days = Math.round((at - startOfDay(Date.now())) / 86_400_000);
    if (seen.has(days)) continue;
    seen.add(days);
    const pill = el("div", days === guideDay ? "pill on" : "pill", dayName(at));
    pill.dataset.focus = "";
    pill.onclick = () => {
      guideDay = days;
      renderDays();
      renderGuide();
      keepFocus();
    };
    rail.append(pill);
  }
}

function renderGuide() {
  const grid = $("grid");
  grid.replaceChildren();
  if (!view || !view.channels.length) {
    $("guide-section").hidden = true;
    return;
  }
  const dayStart = startOfDay(Date.now()) + guideDay * 86_400_000;
  const dayEnd = dayStart + 86_400_000;
  let rows = 0;
  for (const c of view.channels) {
    const rows4 = c.programmes.filter((p) => p.end > dayStart && p.start < dayEnd);
    if (!rows4.length) continue;
    rows += 1;
    const row = el("div", "grow");
    const ch = el("div", "ch");
    ch.append(el("b", "", c.name), el("small", "", c.now ? `now: ${c.now.title}` : ""));
    const cells = el("div", "cells");
    for (const p of rows4) {
      const cell = el("div", "cell");
      cell.dataset.focus = "";
      cell.append(el("b", "", p.title), el("small", "", time(p.start)));
      cell.onclick = () => void playChannel(c);
      cells.append(cell);
    }
    row.append(ch, cells);
    grid.append(row);
  }
  if (!rows) grid.append(el("p", "empty", guideDay === 0 ? "Nothing on this channel today." : "The box saved no guide this far ahead."));
  $("guide-note").textContent = view.kids ? `saved for ${view.profile}` : `saved ${ago(view.at)} · 7 days`;
  $("guide-section").hidden = false;
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

function ago(at) {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

// ---------------------------------------------------------------------------
// Jellyfin: it plays straight from the server, and the box tells Jellyfin where it got to

function renderJellyfin() {
  const rail = $("jellyfin");
  rail.replaceChildren();
  const jf = view ? view.jellyfin : null;
  const items = jf ? jf.items : [];
  for (const i of items) {
    const card = el("div", "card");
    card.dataset.focus = "";
    const art = el("div", "art", i.poster ? "" : "▶");
    if (i.poster) art.style.backgroundImage = `url("${i.poster}")`;
    const text = el("div", "text");
    const left = i.positionMs && i.runtimeMs ? remaining(i.positionMs, i.runtimeMs) : i.subtitle || "";
    text.append(el("b", "", i.name), el("small", "", left || "Film"));
    card.append(art);
    if (i.positionMs && i.runtimeMs) {
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.width = `${Math.min(100, (i.positionMs / i.runtimeMs) * 100)}%`;
      bar.append(fill);
      card.append(bar);
    }
    card.append(text);
    card.onclick = () => void playJellyfin(i);
    rail.append(card);
  }
  if (jf) $("jellyfin-title").firstChild.textContent = jf.serverName;
  $("jellyfin-section").hidden = !items.length;
}

// ---------------------------------------------------------------------------
// Downloads and games

let downloads = [];
let games = [];
let airplay = null;

function renderDownloads() {
  const rail = $("downloads");
  rail.replaceChildren();
  // Kids see only the downloads the Hub said this profile may have: the same list ui/src/downloads.ts
  // pushes to the box, kept in offline-profile.json. With no profile known, show nothing for kids.
  const done = downloads.filter((d) => d.status === "done" && (!profile || !profile.kids || (profile.allowedDownloads || []).includes(d.id)));
  for (const d of done) {
    const card = el("div", "card");
    card.dataset.focus = "";
    card.onclick = () => void playDownload(d);
    const art = el("div", "art", d.artwork ? "" : "▶");
    if (d.artwork) art.style.backgroundImage = `url("${d.artwork}")`;
    const text = el("div", "text");
    text.append(el("b", "", d.name), el("small", "", d.subtitle || (d.positionMs && d.durationMs ? `${clock(d.durationMs - d.positionMs)} left` : "Downloaded")));
    card.append(art);
    if (d.positionMs && d.durationMs) {
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.width = `${Math.min(100, (d.positionMs / d.durationMs) * 100)}%`;
      bar.append(fill);
      card.append(bar);
    }
    card.append(text);
    rail.append(card);
  }
  if (!done.length) rail.append(el("p", "empty", profile && profile.kids ? "Nothing downloaded for this profile." : "Nothing downloaded. Next time, download a few films from their page in the TV app to watch when the Hub's away."));
  $("downloads-note").textContent = profile ? `for ${profile.name}` : "";
}

function renderGames() {
  const rail = $("games");
  rail.replaceChildren();
  // Games follow the household's setting on the Kids profile, which lives on the Hub: offline, they stay grown-ups only.
  const shown = profile && !profile.kids ? games.filter((a) => a.installed) : [];
  for (const a of shown) {
    const card = el("div", "card");
    card.dataset.focus = "";
    const art = el("div", "art", "🎮");
    const text = el("div", "text");
    text.append(el("b", "", a.name), el("small", "", a.detail || ""));
    card.append(art, text);
    card.onclick = () => void agent.launchApp(a.id).catch(() => undefined);
    rail.append(card);
  }
  $("games-section").hidden = !shown.length;
}

// ---------------------------------------------------------------------------
// Present but off. Each of these is a real thing in the TV app; with the Hub down the box can't do
// it, so it stays on the screen with one plain sentence instead of quietly disappearing.

const OFF = [
  ["Recording", "Recording needs the Hub. It'll come back when the Hub is on."],
  ["Series links", "Series links need the Hub. They'll come back when it's on."],
  ["TorBox and saves", "TorBox and saved films need the Hub. They'll come back when it's on."],
  ["Settings", "Settings need the Hub. They'll come back when it's on."],
];

function renderOff() {
  const rail = $("off");
  rail.replaceChildren();
  for (const [name, why] of OFF) {
    const card = el("div", "card off");
    card.dataset.focus = "";
    const art = el("div", "art", "Off");
    const text = el("div", "text");
    text.append(el("b", "", name), el("small", "", why));
    card.append(art, text);
    card.onclick = () => void say(why);
    rail.append(card);
  }
  $("off-section").hidden = false;
}

// ---------------------------------------------------------------------------
// A line of plain words, for when a press can't do anything

let sayTimer;
function say(text) {
  $("detail").textContent = text;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(showStatus, 6000);
}

// ---------------------------------------------------------------------------
// Playing

let playing = null;
let saveTimer;
let osdTimer;
let last = { positionMs: 0 };

// A box that predates Limited mode has neither method: say so rather than throwing at a key press.
const limitedPlay = (request) =>
  agent.limitedPlay
    ? agent.limitedPlay(request).catch((e) => ({ ok: false, reason: String(e && e.message ? e.message : e) }))
    : Promise.resolve({ ok: false, reason: "This box's shell is too old for Limited mode. Update the box to use it." });

async function playChannel(c) {
  const answer = await limitedPlay({ kind: "channel", id: c.id });
  if (!answer.ok) return say(answer.reason);
  playing = { title: answer.title, live: true };
  document.body.classList.add("playing");
  await agent.setLayout({ mode: "fullscreen" }).catch(() => undefined);
  $("osd-title").textContent = answer.title;
  $("osd-bar").style.width = "0";
  $("osd-pos").textContent = "Live";
  $("osd-dur").textContent = "";
  osd();
}

async function playJellyfin(i) {
  const answer = await limitedPlay({ kind: "jellyfin", id: i.id });
  if (!answer.ok) return say(answer.reason);
  playing = { title: answer.title, durationMs: answer.durationMs };
  document.body.classList.add("playing");
  await agent.setLayout({ mode: "fullscreen" }).catch(() => undefined);
  $("osd-title").textContent = answer.title;
  osd();
}

async function playDownload(d) {
  const info = await agent.localCopy(d.req).catch(() => null);
  if (!info) return say("This download isn't on the box any more.");
  playing = { id: info.downloadId, title: info.title || d.name, durationMs: info.durationMs };
  document.body.classList.add("playing");
  await agent.play({
    url: info.url,
    live: false,
    startMs: info.startMs || 0,
    ...(info.fps ? { fps: info.fps } : {}),
    title: playing.title,
    ...(info.artwork ? { artwork: info.artwork } : {}),
    subtitles: (info.externalSubtitles || []).map((t) => ({ url: t.url, lang: t.lang, label: t.label })),
  });
  await agent.setLayout({ mode: "fullscreen" }).catch(() => undefined);
  $("osd-title").textContent = playing.title;
  osd();
  clearInterval(saveTimer);
  saveTimer = setInterval(savePosition, 10_000);
}

function savePosition() {
  if (playing && playing.id && last.positionMs) void agent.downloadPosition(playing.id, last.positionMs, last.durationMs || playing.durationMs).catch(() => undefined);
}

async function stop() {
  savePosition();
  clearInterval(saveTimer);
  playing = null;
  document.body.classList.remove("playing", "osd-on");
  await agent.stop().catch(() => undefined);
  downloads = (await agent.downloads().catch(() => ({ items: downloads }))).items;
  renderDownloads();
}

function osd() {
  document.body.classList.add("osd-on");
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => document.body.classList.remove("osd-on"), 4000);
}

agent.onState((s) => {
  last = s;
  if (!playing) return;
  if (playing.live) {
    // A live channel has no end: mpv says "ended" when the stream drops, and that is a stop.
    if (s.status === "error" || s.status === "ended") void stop();
    else if (s.status === "paused") osd();
    return;
  }
  const dur = s.durationMs || playing.durationMs || 0;
  $("osd-pos").textContent = clock(s.positionMs);
  $("osd-dur").textContent = dur ? clock(dur) : "";
  $("osd-bar").style.width = dur ? `${Math.min(100, (s.positionMs / dur) * 100)}%` : "0";
  if (s.status === "paused") osd();
  if (s.status === "ended" || s.status === "error") void stop();
});

// ---------------------------------------------------------------------------
// The remote: arrows move between cards, OK picks, Back stops a film

let focused = null;
function items() {
  return [...document.querySelectorAll("[data-row]")].filter((r) => !r.closest("[hidden]")).map((r) => [...r.querySelectorAll("[data-focus]")]).filter((r) => r.length);
}
function focus(e) {
  if (focused) focused.classList.remove("focus");
  focused = e;
  if (e) {
    e.classList.add("focus");
    e.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
function keepFocus() {
  if (focused && document.contains(focused)) return;
  // A channel first, when there is one: with the Hub off, live TV is the thing worth doing.
  const first = document.querySelector("#live [data-focus]") || document.querySelector("#jellyfin [data-focus]") || document.querySelector("#downloads [data-focus]") || document.querySelector("[data-focus]");
  focus(first || null);
}
function move(dx, dy) {
  const rows = items();
  let r = rows.findIndex((row) => row.includes(focused));
  if (r < 0) return focus(rows[0] ? rows[0][0] : null);
  let c = rows[r].indexOf(focused);
  if (dy) {
    r = Math.max(0, Math.min(rows.length - 1, r + dy));
    c = Math.min(c, rows[r].length - 1);
  } else c = Math.max(0, Math.min(rows[r].length - 1, c + dx));
  focus(rows[r][c]);
}

document.addEventListener("keydown", (e) => {
  const k = e.key;
  if (playing) {
    if (k === "Escape" || k === "Backspace" || k === "BrowserBack" || k === "MediaStop" || k === "GoBack") void stop();
    else if (k === "Enter" || k === " " || k === "MediaPlayPause") void agent.pause(last.status !== "paused");
    else if (k === "ArrowLeft" || k === "F7" || k === "MediaRewind") void agent.seek(-10_000, "relative");
    else if (k === "ArrowRight" || k === "F8" || k === "MediaFastForward") void agent.seek(30_000, "relative");
    osd();
    e.preventDefault();
    return;
  }
  if (k === "ArrowLeft") move(-1, 0);
  else if (k === "ArrowRight") move(1, 0);
  else if (k === "ArrowUp") move(0, -1);
  else if (k === "ArrowDown") move(0, 1);
  else if (k === "Enter" && focused) focused.click();
  else return;
  e.preventDefault();
});

$("retry").onclick = () => {
  $("detail").textContent = "Trying the Hub now…";
  void agent.retryHub().catch(() => undefined).finally(() => setTimeout(showStatus, 4500));
};
$("standby").onclick = () => void agent.tvStandby().catch(() => undefined);

// ---------------------------------------------------------------------------
// Putting it on the screen

function render() {
  renderLive();
  renderDays();
  renderGuide();
  renderJellyfin();
  renderDownloads();
  renderGames();
  renderOff();
  // Said out loud, because with the Hub off nobody can check the rules anywhere else: Limited mode
  // enforces the profile's Kids rules from the copy the box saved (shared/src/limited.ts).
  const kids = view ? view.kids : profile ? profile.kids : false;
  $("limited").textContent = view && view.channels.length
    ? kids
      ? `Limited mode: only what ${view.profile} may watch, from the box's saved list. A grown-up can unlock the TV when the Hub is back.`
      : "Limited mode: live TV and films from what this box saved. Everything else comes back with the Hub."
    : "Limited mode: this box hasn't saved anything to play yet. It fills up while the Hub is on, so leave it on for a few minutes.";
  $("footer").textContent = airplay && airplay.running ? `iPhones, iPads and Macs can still mirror to “${airplay.name}” with Screen Mirroring.` : "";
  keepFocus();
}

async function loadView() {
  const next = agent.limitedView ? await agent.limitedView().catch(() => null) : null;
  view = next;
  // A day that has rolled over while the box sat on this screen: keep the guide on today.
  if (guideDay < 0) guideDay = 0;
  render();
}

async function start() {
  tick();
  setInterval(tick, 10_000);
  await showStatus();
  setInterval(showStatus, 15_000);
  const [d, c] = await Promise.all([agent.downloads().catch(() => null), agent.cast().catch(() => null)]);
  downloads = d ? d.items : [];
  if (c) ({ apps: games, airplay } = c);
  await loadView();
  // The guide's "now" lines and the "saved 5 min ago" note are worth keeping honest, and the box
  // refreshes its snapshot on its own whenever it is asked. Neither touches the Hub.
  setInterval(() => {
    if (!playing) void loadView();
  }, 60_000);
  agent.onDownloads((x) => {
    downloads = x.items;
    if (!playing) renderDownloads();
  });
  agent.onCast((x) => {
    ({ apps: games, airplay } = x);
    if (!playing) {
      renderGames();
      $("footer").textContent = airplay && airplay.running ? `iPhones, iPads and Macs can still mirror to “${airplay.name}” with Screen Mirroring.` : "";
    }
  });
}
void start();
