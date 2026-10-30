// The box's Hub-down screen (index.html). Everything goes through window.ultimatetv, the same
// bridge the TV app uses (box/src/preload.ts), so nothing here needs the network.
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

// ---------------------------------------------------------------------------
// The time, and what's wrong

function tick() {
  const now = new Date();
  $("time").textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

let profile = null;
async function showStatus() {
  const s = await agent.hubStatus().catch(() => null);
  if (!s) return;
  profile = s.profile;
  document.title = s.appName;
  $("brand").textContent = s.appName;
  const host = (() => {
    try {
      return new URL(s.hubUrl).host;
    } catch {
      return s.hubUrl;
    }
  })();
  const nonet = !s.addresses.length;
  $("status").classList.toggle("nonet", nonet);
  $("headline").textContent = nonet ? "This box isn't connected to the network" : `Can't reach the Hub at ${host}`;
  const since = s.since ? ` (since ${new Date(s.since).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })})` : "";
  $("detail").textContent = `${s.reason ? s.reason + since + ". " : ""}Trying again every few seconds: the TV app comes back by itself as soon as the Hub answers.`;
  $("network").textContent = nonet
    ? "Check the network cable or Wi-Fi. Downloads and games below still work."
    : `This box is on the network (${s.addresses.join(", ")}). If the server is restarting, give it a minute.`;
}

// ---------------------------------------------------------------------------
// Downloads and games

let downloads = [];
let games = [];
let airplay = null;

function render() {
  const rail = $("downloads");
  rail.replaceChildren();
  const done = downloads.filter((d) => d.status === "done" && (!profile || !profile.kids || (profile.allowedDownloads || []).includes(d.id)));
  for (const d of done) {
    const card = el("div", "card");
    card.dataset.focus = "";
    card.onclick = () => void play(d);
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

  const g = $("games");
  g.replaceChildren();
  // Games follow the household's setting on the Kids profile, which lives on the Hub: offline, they stay grown-ups only.
  const shown = profile && !profile.kids ? games.filter((a) => a.installed) : [];
  for (const a of shown) {
    const pill = el("div", "button", `🎮 ${a.name}`);
    pill.dataset.focus = "";
    pill.onclick = () => void agent.launchApp(a.id).catch(() => undefined);
    g.append(pill);
  }
  $("games-section").hidden = !shown.length;
  $("footer").textContent = airplay && airplay.running ? `iPhones, iPads and Macs can still mirror to “${airplay.name}” with Screen Mirroring.` : "";
  keepFocus();
}

// ---------------------------------------------------------------------------
// Playing a download

let playing = null;
let saveTimer;
let osdTimer;
let last = { positionMs: 0 };

async function play(d) {
  const info = await agent.localCopy(d.req).catch(() => null);
  if (!info) return;
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
  if (playing && last.positionMs) void agent.downloadPosition(playing.id, last.positionMs, last.durationMs || playing.durationMs).catch(() => undefined);
}

async function stop() {
  savePosition();
  clearInterval(saveTimer);
  playing = null;
  document.body.classList.remove("playing", "osd-on");
  await agent.stop().catch(() => undefined);
  downloads = (await agent.downloads().catch(() => ({ items: downloads }))).items;
  render();
}

function osd() {
  document.body.classList.add("osd-on");
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => document.body.classList.remove("osd-on"), 4000);
}

agent.onState((s) => {
  last = s;
  if (!playing) return;
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
  // A download first, when there is one: it's what's most worth doing.
  const first = document.querySelector("#downloads [data-focus]") || document.querySelector("#games [data-focus]") || document.querySelector("[data-focus]");
  focus(first);
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

async function start() {
  tick();
  setInterval(tick, 10_000);
  await showStatus();
  setInterval(showStatus, 15_000);
  const [d, c] = await Promise.all([agent.downloads().catch(() => null), agent.cast().catch(() => null)]);
  downloads = d ? d.items : [];
  if (c) ({ apps: games, airplay } = c);
  render();
  agent.onDownloads((x) => {
    downloads = x.items;
    if (!playing) render();
  });
  agent.onCast((x) => {
    ({ apps: games, airplay } = x);
    if (!playing) render();
  });
}
void start();
