// The phone remote's Now Playing card and Browse tab. What the TV is doing comes from the TV app
// through the Hub (/api/tv/call/now); lists come straight from the Hub, filtered like the TV's
// profile when that's a Kids profile. Playing something asks the TV app to play it, so the TV's own
// profile rules still apply.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (ms) => {
    if (!(ms >= 0)) return "–";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let tv = null;
  let polledAt = 0;
  let kidsProfile = null;

  const toastEl = document.createElement("div");
  toastEl.className = "ptoast";
  document.body.append(toastEl);
  const toast = (msg, bad) => {
    toastEl.textContent = msg;
    toastEl.className = "ptoast show" + (bad ? " bad" : "");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => (toastEl.className = "ptoast"), 3000);
  };

  async function call(method, args) {
    const r = await fetch(`/api/tv/call/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args ?? {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || r.statusText), { code: d.code });
    return d;
  }
  async function get(path) {
    const r = await fetch(path, { headers: kidsProfile ? { "X-Profile": kidsProfile } : {} });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  }
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  }
  async function del(path) {
    const r = await fetch(path, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  }
  const key = (action) => post("/api/remote/key", { action }).catch(() => toast("Can't reach the Hub", true));

  // Downloads to the TV box: the TV app adds them (with its profile's rules) and the box fetches them.
  async function downloadToBox(args) {
    toast("Asking the TV box…");
    try {
      await call("download", args);
      if (current === "downloads") void showDownloads();
    } catch (e) {
      toast(e.message, true);
    }
  }
  // Save to NAS: kept for good on the NAS and added to Jellyfin. Asked through the TV, so its profile decides.
  async function saveToNas(args) {
    toast("Saving to the NAS…");
    try {
      await call("saveToNas", args);
      toast("Saving to the NAS. It goes into Jellyfin when it's done.");
    } catch (e) {
      toast(e.message, true);
    }
  }
  const size = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round((b || 0) / 1024 ** 2)} MB`);

  async function playOnTv(req, title, fromStart) {
    toast("Starting on the TV…");
    closeSheet();
    try {
      await call("play", { req, ...(title ? { title } : {}), ...(fromStart ? { fromStart: true } : {}) });
      setTimeout(poll, 800);
    } catch (e) {
      toast(e.message, true);
    }
  }

  // The TV's play queue: it plays in order when what's on ends, ahead of the next episode.
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
  async function queueIt(item) {
    try {
      const r = await post("/api/queue", item);
      const at = r.queue.findIndex((i) => i.id === r.item.id) + 1;
      toast(at <= 1 ? `${item.name} plays next` : `${item.name} is ${ordinal(at)} in the queue`);
      if (current === "queue") void showQueue();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Now playing

  let dragging = false;
  async function poll() {
    if (document.visibilityState !== "visible") return;
    try {
      tv = await call("now");
      polledAt = Date.now();
      const p = tv.profile;
      kidsProfile = p && p.kind === "kids" ? p.id : null;
    } catch {
      tv = null;
    }
    renderNow();
  }

  function position() {
    const st = tv?.player;
    if (!st) return 0;
    return st.positionMs + (st.status === "playing" ? Date.now() - polledAt : 0);
  }
  function musicPosition(s) {
    return Math.min(s.track?.durationMs ?? Infinity, s.positionMs + (s.status === "playing" ? Date.now() - polledAt : 0));
  }

  function renderNow() {
    const card = $("np");
    const p = tv?.playing;
    const st = tv?.player;
    const sp = tv?.spotify;
    const web = tv?.webApp?.nowPlaying;
    let mode = null;
    if (p && st && st.status !== "idle") mode = "video";
    else if (sp && sp.track) mode = "spotify";
    else if (web) mode = "web";
    card.hidden = !mode;
    card.dataset.mode = mode || "";
    $("np-sleep-at").textContent = tv?.sleep?.at ? clock(tv.sleep.at) : "";
    if (!mode) return;

    const range = $("np-range");
    if (mode === "video") {
      $("np-art").style.backgroundImage = p.artwork ? `url("${p.artwork}")` : "";
      // On a channel, the programme is the headline and the channel goes underneath.
      const onChannel = p.channel && p.subtitle;
      $("np-title").textContent = onChannel ? p.subtitle : p.title;
      const bits = [];
      if (p.channel) bits.push(`${p.channel.number} ${p.channel.name}`);
      if (p.subtitle && !onChannel) bits.push(p.subtitle);
      if (p.source) bits.push(p.source);
      $("np-sub").textContent = bits.join(" · ");
      const q = [];
      if (st.video) q.push(`${st.video.width >= 3800 ? "4K" : st.video.height >= 1000 ? "HD 1080" : st.video.height >= 700 ? "HD 720" : "SD"}${st.video.hdr && st.video.hdr !== "sdr" ? " " + st.video.hdr.toUpperCase() : ""}`);
      if (st.audio?.codec) q.push(`${st.audio.codec.toUpperCase()}${st.audio.channels ? " " + (st.audio.channels > 6 ? "7.1" : st.audio.channels > 2 ? "5.1" : "stereo") : ""}`);
      if (st.status !== "playing") q.push(st.status === "paused" ? "Paused" : st.status === "buffering" || st.status === "loading" ? "Loading…" : st.status);
      $("np-quality").textContent = q.join(" · ");
      $("np-play").dataset.state = st.status === "playing" ? "playing" : "paused";
      $("np-tracks").hidden = !(st.audioTracks?.length > 1 || st.subtitleTracks?.length);
      $("np-live").hidden = !p.live;
      $("np-save").hidden = !p.savable;
      if (p.live) {
        range.hidden = true;
        const behind = st.behindLiveMs ?? 0;
        $("np-time").textContent = behind > 3000 ? `${fmt(behind)} behind live` : "Live";
        $("np-left").textContent = "";
      } else {
        range.hidden = !st.durationMs;
        if (!dragging && st.durationMs) {
          range.max = String(st.durationMs);
          range.value = String(position());
        }
        $("np-time").textContent = fmt(dragging ? Number(range.value) : position());
        $("np-left").textContent = st.durationMs ? `-${fmt(st.durationMs - (dragging ? Number(range.value) : position()))}` : "";
      }
    } else if (mode === "spotify") {
      const t = sp.track;
      $("np-art").style.backgroundImage = t.cover ? `url("${t.cover}")` : "";
      $("np-title").textContent = t.name;
      $("np-sub").textContent = [t.artists.join(", "), sp.context?.name].filter(Boolean).join(" · ");
      $("np-quality").textContent = "Spotify" + (sp.status === "paused" ? " · Paused" : "");
      $("np-play").dataset.state = sp.status === "playing" ? "playing" : "paused";
      $("np-tracks").hidden = true;
      $("np-live").hidden = true;
      $("np-save").hidden = true;
      range.hidden = false;
      if (!dragging) {
        range.max = String(t.durationMs);
        range.value = String(musicPosition(sp));
      }
      $("np-time").textContent = fmt(dragging ? Number(range.value) : musicPosition(sp));
      $("np-left").textContent = `-${fmt(t.durationMs - (dragging ? Number(range.value) : musicPosition(sp)))}`;
    } else {
      $("np-art").style.backgroundImage = web.artwork ? `url("${web.artwork}")` : "";
      $("np-title").textContent = web.title;
      $("np-sub").textContent = [web.artist, web.album].filter(Boolean).join(" · ");
      $("np-quality").textContent = "Deezer" + (web.playing ? "" : " · Paused");
      $("np-play").dataset.state = web.playing ? "playing" : "paused";
      $("np-tracks").hidden = true;
      $("np-live").hidden = true;
      $("np-save").hidden = true;
      range.hidden = true;
      $("np-time").textContent = "";
      $("np-left").textContent = "";
    }
  }

  const mode = () => $("np").dataset.mode;
  const seekBy = (ms) => {
    if (mode() === "spotify") return call("musicControl", { cmd: "seek", ms: Math.max(0, musicPosition(tv.spotify) + ms) }).then(poll, (e) => toast(e.message, true));
    if (mode() === "video") return call("seek", { ms, mode: "relative" }).then(() => setTimeout(poll, 400), (e) => toast(e.message, true));
  };
  $("np-back").onclick = () => (mode() === "video" ? seekBy(-30_000) : mode() === "spotify" ? call("musicControl", { cmd: "prev" }).then(poll) : key("rewind"));
  $("np-fwd").onclick = () => (mode() === "video" ? seekBy(30_000) : mode() === "spotify" ? call("musicControl", { cmd: "next" }).then(poll) : key("fastForward"));
  $("np-play").onclick = () => {
    if (mode() === "spotify") call("musicControl", { cmd: "playPause" }).then(poll);
    else key("playPause").then(() => setTimeout(poll, 400));
  };
  $("np-stop").onclick = () => (mode() === "spotify" ? call("musicControl", { cmd: "pause" }).then(poll) : key("stop").then(() => setTimeout(poll, 600)));
  $("np-save").onclick = () => saveToNas({ playing: true });
  $("np-live").onclick = () => call("seek", { ms: 0, mode: "live" }).then(() => setTimeout(poll, 400), (e) => toast(e.message, true));
  const range = $("np-range");
  range.addEventListener("input", () => {
    dragging = true;
    renderNow();
  });
  range.addEventListener("change", () => {
    const ms = Number(range.value);
    dragging = false;
    const done = () => setTimeout(poll, 500);
    if (mode() === "spotify") call("musicControl", { cmd: "seek", ms }).then(done, (e) => toast(e.message, true));
    else call("seek", { ms, mode: "absolute" }).then(done, (e) => toast(e.message, true));
  });
  $("np-tracks").onclick = () => {
    const st = tv?.player;
    if (!st) return;
    const label = (t) => [t.title, t.lang?.toUpperCase(), t.codec?.toUpperCase(), t.channels ? `${t.channels} ch` : ""].filter(Boolean).join(" · ") || `Track ${t.id}`;
    openSheet(
      `<h3>Sound</h3>${st.audioTracks.map((t) => `<button class="row-btn${t.selected ? " on" : ""}" data-audio="${t.id}">${esc(label(t))}</button>`).join("")}
       <h3>Subtitles</h3><button class="row-btn${st.subtitleTracks.some((t) => t.selected) ? "" : " on"}" data-sub="off">Off</button>
       ${st.subtitleTracks.map((t) => `<button class="row-btn${t.selected ? " on" : ""}" data-sub="${t.id}">${esc(label(t))}</button>`).join("")}`,
    );
    for (const b of document.querySelectorAll("[data-audio]")) b.onclick = () => call("track", { audio: Number(b.dataset.audio) }).then(() => (closeSheet(), poll()), (e) => toast(e.message, true));
    for (const b of document.querySelectorAll("[data-sub]")) b.onclick = () => call("track", { subtitle: b.dataset.sub === "off" ? null : Number(b.dataset.sub) }).then(() => (closeSheet(), poll()), (e) => toast(e.message, true));
  };

  setInterval(() => {
    if (!$("np").hidden && !dragging) renderNow();
  }, 1000);
  setInterval(poll, 2500);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && poll());
  poll();

  // ---------------------------------------------------------------------------
  // Sheets (details and choices slide up from the bottom)

  function openSheet(html) {
    $("sheet-body").innerHTML = html;
    $("sheet").hidden = false;
    $("sheet-body").scrollTop = 0;
  }
  function closeSheet() {
    $("sheet").hidden = true;
  }
  $("sheet").addEventListener("click", (e) => {
    if (e.target === $("sheet") || e.target.closest("[data-close]")) closeSheet();
  });

  // ---------------------------------------------------------------------------
  // What's new: after an update, a banner with the changes this phone hasn't shown (the Hub works
  // them out from CHANGELOG.md); tapping it lists them, and "Everything" lists every change.

  const SEEN_KEY = "utv-changelog-seen";
  const changeHtml = (e) => `<div class="change"><b>${esc(e.title)}</b>${e.text ? `<small>${esc(e.text)}</small>` : ""}</div>`;
  const dayLabel = (r) => {
    const when = r.date ? new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
    return r.version ? (when ? `${r.version} · ${when}` : r.version) : when;
  };
  function markSeen(latest) {
    $("news-banner").hidden = true;
    try {
      if (latest) localStorage.setItem(SEEN_KEY, latest);
    } catch {}
  }
  async function showAllChanges() {
    try {
      const log = await get("/api/changelog");
      markSeen(log.latest);
      openSheet(`<h2>What's new</h2>${log.releases.map((r) => `<h3>${esc(dayLabel(r))}</h3>${r.note ? `<p class="meta">${esc(r.note)}</p>` : ""}<div class="changes">${r.entries.map(changeHtml).join("")}</div>`).join("")}<button class="link" data-close>Close</button>`);
    } catch (e) {
      toast(e.message, true);
    }
  }
  (async () => {
    let seen = "";
    try {
      seen = localStorage.getItem(SEEN_KEY) || "";
    } catch {}
    const log = await get(`/api/changelog?seen=${encodeURIComponent(seen)}`).catch(() => null);
    if (!log?.latest) return;
    const fresh = log.unseen ?? [];
    if (!fresh.length) return markSeen(log.latest);
    $("news-banner-text").innerHTML = `<b>What's new</b>: ${esc(fresh.slice(0, 2).map((e) => e.title).join(", "))}${fresh.length > 2 ? ` and ${fresh.length - 2} more` : ""}. Tap to see.`;
    $("news-banner").hidden = false;
    $("news-banner").onclick = (ev) => {
      ev.preventDefault();
      markSeen(log.latest);
      openSheet(`<h2>What's new</h2><p class="meta">${fresh.length === 1 ? "One change" : `${fresh.length} changes`} since you last looked.</p><div class="changes">${fresh.map(changeHtml).join("")}</div><div class="actions"><button class="primary" data-close>Got it</button><button id="s-all-changes">Everything</button></div>`);
      $("s-all-changes").onclick = showAllChanges;
    };
    $("news-banner-x").onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      markSeen(log.latest);
    };
  })();

  // ---------------------------------------------------------------------------
  // Tabs

  const tabs = { remote: $("tab-remote"), browse: $("tab-browse") };
  for (const b of document.querySelectorAll("[data-tab]")) {
    b.addEventListener("click", () => {
      for (const [name, el] of Object.entries(tabs)) el.hidden = name !== b.dataset.tab;
      for (const x of document.querySelectorAll("[data-tab]")) x.classList.toggle("on", x === b);
      if (b.dataset.tab === "browse" && !browsed) show(current);
    });
  }

  // ---------------------------------------------------------------------------
  // News flash: a "breaking news" bar along the bottom of the TV, over anything.

  const FLASH_TIMES = [[30, "30 sec"], [60, "1 min"], [300, "5 min"], [900, "15 min"], [0, "Until I clear it"]];
  let flashLabel = "BBC NEWS";
  let flashSeconds = 60;
  try {
    flashLabel = localStorage.getItem("utv-flash-label") || flashLabel;
    flashSeconds = Number(localStorage.getItem("utv-flash-seconds") ?? flashSeconds);
  } catch {}
  async function newsSheet() {
    const { flash } = await get("/api/flash").catch(() => ({ flash: null }));
    openSheet(`<h2>Breaking news</h2>
      <p class="meta">Shows along the bottom of the TV, over whatever is on.</p>
      <div class="flash-preview"><b id="fl-pl"></b><i>BREAKING NEWS</i><span id="fl-pt"></span></div>
      <textarea id="fl-text" maxlength="280" placeholder="Type the news…"></textarea>
      <input class="field" id="fl-label" maxlength="24" placeholder="Channel name" autocomplete="off">
      <h3>Show it for</h3>
      <div class="seg" id="fl-time">${FLASH_TIMES.map(([s, l]) => `<button type="button" data-s="${s}" class="${s === flashSeconds ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      <div class="actions"><button class="primary" id="fl-send">Show on the TV</button>${flash ? `<button id="fl-clear">Take it down</button>` : ""}</div>
      ${flash ? `<p class="meta">On now: ${esc(flash.text)}</p>` : ""}
      <button class="link" data-close>Close</button>`);
    const text = $("fl-text");
    const label = $("fl-label");
    label.value = flashLabel;
    if (flash) text.value = flash.text;
    const preview = () => {
      $("fl-pl").textContent = label.value.trim() || "BBC NEWS";
      $("fl-pt").textContent = text.value.trim() || "Your news here";
    };
    text.oninput = label.oninput = preview;
    preview();
    for (const b of $("fl-time").querySelectorAll("button")) {
      b.onclick = () => {
        flashSeconds = Number(b.dataset.s);
        for (const x of $("fl-time").querySelectorAll("button")) x.classList.toggle("on", x === b);
      };
    }
    $("fl-send").onclick = async () => {
      if (!text.value.trim()) return toast("Type the news first", true);
      flashLabel = label.value.trim() || "BBC NEWS";
      try {
        localStorage.setItem("utv-flash-label", flashLabel);
        localStorage.setItem("utv-flash-seconds", String(flashSeconds));
      } catch {}
      try {
        await post("/api/flash", { text: text.value, label: flashLabel, seconds: flashSeconds });
        closeSheet();
        toast("On the TV now");
      } catch (e) {
        toast(e.message, true);
      }
    };
    if (flash) {
      $("fl-clear").onclick = async () => {
        const r = await fetch("/api/flash", { method: "DELETE" }).catch(() => null);
        if (!r?.ok) return toast("Can't reach the Hub", true);
        closeSheet();
        toast("Taken down");
      };
    }
    text.focus();
  }
  $("news-btn").addEventListener("click", () => void newsSheet());

  // ---------------------------------------------------------------------------
  // Pop-ups: a message, picture or video on the TV, where you choose (POST /api/notify).

  const NP_KINDS = [["info", "Message"], ["doorbell", "Doorbell"], ["meeting", "Meeting"], ["alarm", "Alarm"], ["warning", "Warning"]];
  const NP_SPOTS = [["top-left", "↖"], ["top", "Top"], ["top-right", "↗"], [null, ""], ["center", "Middle"], [null, ""], ["bottom-left", "↙"], ["bottom", "Bottom"], ["bottom-right", "↘"]];
  const NP_SIZES = [["small", "Small"], ["medium", "Medium"], ["large", "Large"]];
  const NP_TIMES = [[10, "10 sec"], [30, "30 sec"], [60, "1 min"], [300, "5 min"], [0, "Until closed"]];
  const NP_SOUNDS = [["none", "Silent"], ["ping", "Ping"], ["chime", "Chime"], ["alarm", "Alarm"]];
  // What each kind starts with, as the Hub does (a message gets 10 seconds rather than 15, to match the buttons).
  const NP_DEFAULTS = {
    info: { position: "bottom-right", size: "medium", sound: "ping", seconds: 10 },
    doorbell: { position: "center", size: "large", sound: "chime", seconds: 30 },
    meeting: { position: "top-right", size: "medium", sound: "chime", seconds: 60 },
    warning: { position: "top", size: "medium", sound: "chime", seconds: 30 },
    alarm: { position: "center", size: "large", sound: "alarm", seconds: 0 },
  };
  async function notifySheet() {
    const { notices } = await get("/api/notify").catch(() => ({ notices: [] }));
    const np = { kind: "info", ...NP_DEFAULTS.info, pause: false, file: null };
    const seg = (id, items, value) => `<div class="seg" id="${id}">${items.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
    openSheet(`<h2>Pop-up on the TV</h2>
      <p class="meta">A message, photo or video over whatever is on.</p>
      ${seg("pu-kind", NP_KINDS, np.kind)}
      <input class="field" id="pu-title" maxlength="120" placeholder="Title (Someone's at the door)" autocomplete="off">
      <textarea id="pu-text" maxlength="1000" placeholder="Message (optional)"></textarea>
      <div class="pu-media" id="pu-media"><button type="button" id="pu-pick">Add photo or video</button></div>
      <input type="file" id="pu-file" accept="image/*,video/*" hidden>
      <h3>Where</h3>
      <div class="where" id="pu-where">${NP_SPOTS.map(([v, l]) => (v ? `<button type="button" data-v="${v}">${esc(l)}</button>` : "<span></span>")).join("")}</div>
      <button type="button" class="where-full" id="pu-full">Full screen</button>
      <h3>Size</h3>
      ${seg("pu-size", NP_SIZES, np.size)}
      <h3>Show it for</h3>
      ${seg("pu-time", NP_TIMES, np.seconds)}
      <h3>Sound</h3>
      ${seg("pu-sound", NP_SOUNDS, np.sound)}
      <label class="check"><input type="checkbox" id="pu-pause"> Pause what's playing while it shows</label>
      <div class="actions"><button class="primary" id="pu-send">Show on the TV</button></div>
      ${notices.length ? `<h3>On the TV now</h3>${notices.map((n) => `<div class="pu-on"><span>${esc(n.title || n.text || (n.video ? "Video" : "Photo"))}</span><button type="button" data-id="${esc(n.id)}">Take down</button></div>`).join("")}` : ""}
      <button class="link" data-close>Close</button>`);
    const mark = (box, value) => {
      for (const b of box.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === String(value));
    };
    const showWhere = () => {
      mark($("pu-where"), np.position);
      $("pu-full").classList.toggle("on", np.position === "full");
    };
    const refresh = () => {
      showWhere();
      mark($("pu-size"), np.size);
      mark($("pu-time"), np.seconds);
      mark($("pu-sound"), np.sound);
    };
    refresh();
    const onSeg = (id, apply) => {
      for (const b of $(id).querySelectorAll("button")) b.onclick = () => (apply(b.dataset.v), refresh());
    };
    onSeg("pu-kind", (v) => {
      np.kind = v;
      Object.assign(np, NP_DEFAULTS[v]);
      mark($("pu-kind"), v);
    });
    onSeg("pu-where", (v) => (np.position = v));
    onSeg("pu-size", (v) => (np.size = v));
    onSeg("pu-time", (v) => (np.seconds = Number(v)));
    onSeg("pu-sound", (v) => (np.sound = v));
    $("pu-full").onclick = () => ((np.position = "full"), refresh());
    $("pu-pause").onchange = (e) => (np.pause = e.target.checked);
    const showMedia = () => {
      const f = np.file;
      const url = f && URL.createObjectURL(f);
      $("pu-media").innerHTML = f
        ? `${f.type.startsWith("video/") ? `<video src="${url}" muted playsinline></video>` : `<img src="${url}" alt="">`}<button type="button" id="pu-pick">Change</button><button type="button" id="pu-drop">Remove</button>`
        : `<button type="button" id="pu-pick">Add photo or video</button>`;
      $("pu-pick").onclick = () => $("pu-file").click();
      if (f) $("pu-drop").onclick = () => ((np.file = null), showMedia());
    };
    showMedia();
    $("pu-file").onchange = (e) => {
      np.file = e.target.files[0] || null;
      e.target.value = "";
      showMedia();
    };
    $("pu-send").onclick = async () => {
      const title = $("pu-title").value.trim();
      const text = $("pu-text").value.trim();
      if (!title && !text && !np.file) return toast("Write something or add a photo", true);
      const send = $("pu-send");
      send.disabled = true;
      try {
        const body = { kind: np.kind, title, text, position: np.position, size: np.size, seconds: np.seconds, sound: np.sound, pause: np.pause };
        if (np.file) {
          send.textContent = "Sending the photo…";
          const r = await fetch("/api/notify/media", { method: "POST", headers: { "Content-Type": np.file.type || "application/octet-stream" }, body: np.file });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || r.statusText);
          body[d.kind] = d.url;
        }
        await post("/api/notify", body);
        closeSheet();
        toast("On the TV now");
      } catch (e) {
        toast(e.message, true);
        send.disabled = false;
        send.textContent = "Show on the TV";
      }
    };
    for (const b of document.querySelectorAll(".pu-on button")) {
      b.onclick = async () => {
        const r = await fetch(`/api/notify/${encodeURIComponent(b.dataset.id)}`, { method: "DELETE" }).catch(() => null);
        if (!r?.ok) return toast("Can't reach the Hub", true);
        b.closest(".pu-on").remove();
        toast("Taken down");
      };
    }
  }
  $("notify-btn").addEventListener("click", () => void notifySheet());

  // ---------------------------------------------------------------------------
  // Cast: a link or photo to the TV, the laptop's screen-share page, AirPlay, and the games on the
  // box. Sharing a link to the installed remote from YouTube or a browser opens this too.

  const MOTIONS = [["across-top", "Across the top"], ["across-bottom", "Along the bottom"], ["fall", "Falling"], ["rise", "Rising"], ["corner", "In a corner"]];
  const SEASON_LIST = [["any", "Any"], ["christmas", "Christmas"], ["newyear", "New Year"], ["valentines", "Valentine's"], ["easter", "Easter"], ["halloween", "Halloween"], ["bonfire", "Bonfire Night"], ["birthday", "Birthday"]];

  async function sendLink(url, title) {
    if (!url) return toast("Paste a link first", true);
    toast("Sending to the TV…");
    try {
      await post("/api/cast/link", { url, ...(title ? { title } : {}) });
      closeSheet();
      toast("Playing on the TV");
      setTimeout(poll, 1500);
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function showPhoto(file) {
    toast(file.type.startsWith("video/") ? "Sending the video…" : "Sending the photo…");
    try {
      const r = await fetch("/api/notify/media", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || r.statusText);
      await post("/api/notify", { kind: "info", position: "full", size: "large", seconds: d.kind === "video" ? 0 : 60, sound: "none", pause: true, [d.kind]: d.url });
      toast("On the TV now. Back on the TV remote closes it");
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function castSheet(shared) {
    let info = null;
    try {
      info = await call("cast");
    } catch {
      // The TV app isn't answering: links and photos still go through the Hub.
    }
    const st = info?.state;
    const fg = st?.foreground;
    const games = (st?.apps ?? []).filter((a) => a.installed);
    const air = st?.airplay;
    openSheet(`<h2>Cast to the TV</h2>
      ${fg ? `<div class="actions"><button class="primary" id="ca-back">Back to the TV app (close ${esc(fg.name)})</button></div>` : ""}
      <h3>Netflix, Prime and the TV's other apps</h3>
      <div class="actions"><button id="ca-tvapps">Go to the TV's apps</button></div>
      <h3>Play a link</h3>
      <p class="meta">A YouTube video, or a link to a video file or stream.</p>
      <input class="field" id="ca-url" type="url" placeholder="https://…" autocomplete="off" value="${esc(shared?.url ?? "")}">
      <div class="actions"><button class="primary" id="ca-send">Play on the TV</button><button id="ca-paste">Paste</button></div>
      <h3>Photos and videos from this phone</h3>
      <div class="actions"><button id="ca-photo">Show a photo or video full screen</button></div>
      <input type="file" id="ca-file" accept="image/*,video/*" hidden>
      ${info?.shareUrl ? `<h3>A laptop's screen</h3><p class="meta">On the laptop, open this in Chrome or Edge and choose Share my screen. The TV asks first.</p><div class="copy"><code>${esc(info.shareUrl)}</code><button id="ca-copy">Copy</button></div>` : ""}
      ${air?.installed ? `<h3>iPhone, iPad or Mac (AirPlay)</h3><p class="meta">Control Centre › Screen Mirroring › “${esc(air.name)}”.</p><div class="seg" id="ca-air"><button type="button" data-v="1" class="${air.enabled ? "on" : ""}">On</button><button type="button" data-v="0" class="${air.enabled ? "" : "on"}">Off</button></div>` : ""}
      ${info?.box && info.gamesAllowed && games.length ? `<h3>Games</h3><div class="games">${games.map((g) => `<button type="button" data-game="${esc(g.id)}">${esc(g.name)}<small>${esc(g.detail)}</small></button>`).join("")}</div>` : ""}
      <h3>Seasonal clips</h3>
      <div class="actions"><button id="ca-proj">Show one on the TV now</button><button id="ca-proj-add">Add your own</button></div>
      <button class="link" data-close>Close</button>`);
    $("ca-send").onclick = () => void sendLink($("ca-url").value.trim(), shared?.title);
    $("ca-paste").onclick = async () => {
      try {
        $("ca-url").value = (await navigator.clipboard.readText()).trim();
      } catch {
        toast("Long-press the box and choose Paste", true);
      }
    };
    $("ca-tvapps").onclick = () => void call("tvApps").then((r) => (closeSheet(), toast(r?.ok ? "Over to the TV's apps. Input on the TV remote comes back" : "Press Home on the TV remote")), (e) => toast(e.message, true));
    $("ca-photo").onclick = () => $("ca-file").click();
    $("ca-file").onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) void showPhoto(f);
    };
    if ($("ca-copy")) $("ca-copy").onclick = () => void navigator.clipboard?.writeText(info.shareUrl).then(() => toast("Copied"), () => toast("Couldn't copy", true));
    if ($("ca-back")) $("ca-back").onclick = () => void call("castApp", { stop: true }).then(() => (closeSheet(), toast("Back to the TV app")), (e) => toast(e.message, true));
    for (const b of document.querySelectorAll("#ca-air button")) b.onclick = () => void call("castAirplay", { on: b.dataset.v === "1" }).then(() => castSheet(), (e) => toast(e.message, true));
    for (const b of document.querySelectorAll("[data-game]")) b.onclick = () => void call("castApp", { id: b.dataset.game }).then(() => (closeSheet(), toast("Opening on the TV")), (e) => toast(e.message, true));
    $("ca-proj").onclick = () => void post("/api/projections/now", {}).then(() => toast("On the TV now"), (e) => toast(e.message, true));
    $("ca-proj-add").onclick = () => projectionUpload();
  }

  function projectionUpload() {
    const seg = (id, items, value) => `<div class="seg" id="${id}">${items.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
    const pick = { season: "christmas", motion: "across-top", file: null };
    openSheet(`<h2>Add a seasonal clip</h2>
      <p class="meta">A GIF, a short video or a picture with a see-through background works best. It drifts across the TV now and then while its season lasts.</p>
      <h3>Season</h3>${seg("pj-season", SEASON_LIST, pick.season)}
      <h3>How it moves</h3>${seg("pj-motion", MOTIONS, pick.motion)}
      <input type="file" id="pj-file" accept="image/*,video/*" hidden>
      <div class="actions"><button class="primary" id="pj-add">Choose the clip</button></div>
      <button class="link" data-close>Close</button>`);
    const mark = (id, v) => {
      for (const b of $(id).querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === v);
    };
    for (const b of $("pj-season").querySelectorAll("button")) b.onclick = () => ((pick.season = b.dataset.v), mark("pj-season", pick.season));
    for (const b of $("pj-motion").querySelectorAll("button")) b.onclick = () => ((pick.motion = b.dataset.v), mark("pj-motion", pick.motion));
    $("pj-add").onclick = () => $("pj-file").click();
    $("pj-file").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      toast("Sending…");
      try {
        const q = new URLSearchParams({ name: file.name.replace(/\.[^.]+$/, ""), projection: "1", season: pick.season, motion: pick.motion });
        const r = await fetch(`/api/scares/clips?${q}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || r.statusText);
        await post("/api/projections/now", { clipId: d.clip.id }).catch(() => undefined);
        closeSheet();
        toast("Added, and showing on the TV now");
      } catch (err) {
        toast(err.message, true);
      }
    };
  }
  $("cast-btn").addEventListener("click", () => void castSheet());

  // Shared from another app to the installed remote (manifest share_target): straight to Cast.
  {
    const q = new URLSearchParams(location.search);
    const text = [q.get("share_url"), q.get("share_text")].filter(Boolean).join(" ");
    if (text) {
      const url = (/https?:\/\/\S+/i.exec(text) || [""])[0];
      history.replaceState(null, "", location.pathname);
      void castSheet({ url, title: q.get("share_title") || "" });
    }
  }

  // ---------------------------------------------------------------------------
  // Sleep timer: the TV fades out, stops and turns off.

  function sleepSheet() {
    const s = tv?.sleep;
    const mins = [[15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1½ hours"], [120, "2 hours"]];
    openSheet(`<h2>Sleep timer</h2>
      <p class="meta">${s?.at ? `Set: ${esc(s.label)}.` : "Off."} When it goes off the sound fades, playback stops and the TV turns off.</p>
      ${tv?.playing ? `<button class="row-btn" data-sleep="end">At the end of this</button>` : ""}
      ${mins.map(([m, l]) => `<button class="row-btn" data-sleep="${m}">${l}</button>`).join("")}
      ${s?.at ? `<button class="row-btn" data-sleep="off">Turn it off</button>` : ""}
      <button class="link" data-close>Close</button>`);
    for (const b of document.querySelectorAll("[data-sleep]")) {
      b.onclick = async () => {
        const v = b.dataset.sleep;
        try {
          await post("/api/tv/sleep", v === "off" ? { off: true } : v === "end" ? { end: true } : { minutes: Number(v) });
          closeSheet();
          toast(v === "off" ? "Sleep timer off" : "Sleep timer set");
          setTimeout(poll, 800);
        } catch (e) {
          toast(e.message, true);
        }
      };
    }
  }
  $("np-sleep").onclick = () => sleepSheet();

  // ---------------------------------------------------------------------------
  // Jump scares and projected clips: a clip cut in over whatever is on. The settings, clips, packs
  // and built clips live on the Hub (/api/scares), so the TV and every phone agree; the TV picks
  // the moment for a random one. Only the occasion's clips come up: Halloween's in October, a
  // snowman in December.

  const SC_GAPS = [[10, "10 min"], [20, "20 min"], [30, "30 min"], [60, "1 hour"], [120, "2 hours"]];
  const SC_CHANCE = [[5, "Rare"], [10, "Now and then"], [25, "Often"], [50, "Very often"], [100, "Every time"]];
  const SC_SECONDS = [[2, "2 sec"], [3, "3 sec"], [4, "4 sec"], [6, "6 sec"], [10, "10 sec"]];
  const THEMES = { halloween: ["Halloween", "🎃"], christmas: ["Christmas", "🎄"], newyear: ["New Year", "🥂"], valentines: ["Valentine's", "💘"], easter: ["Easter", "🐰"], bonfire: ["Bonfire Night", "🎆"], birthday: ["Birthday", "🎂"], everyday: ["Any time", "✨"] };
  const themeName = (t) => (THEMES[t] || THEMES.halloween)[0];
  const themeIcon = (t) => (THEMES[t] || THEMES.halloween)[1];
  const mixThemeOf = (m) => m.theme || "halloween";
  const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const segHtml = (id, items, value, cls = "") => `<div class="seg ${cls}" id="${id}">${items.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(v) === String(value) ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
  /** Sends a request whose answer is JSON, saying what went wrong if it didn't work. */
  async function send(path, init) {
    const r = await fetch(path, init).catch(() => null);
    if (!r) throw new Error("Can't reach the Hub");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  }

  async function scareSheet() {
    const state = await get("/api/scares").catch(() => null);
    if (!state) return toast("Can't reach the Hub", true);
    const sc = state.settings;
    const season = state.season || "halloween";
    const scary = season === "halloween";
    openSheet(`<h2>${scary ? "Jump scares and clips" : "Projected clips"}</h2>
      <p class="meta">Cuts a clip in over whatever is on: a jump scare at Halloween, a snowman walking by at Christmas, a bunny hopping across at Easter. Only the occasion's clips come up. Never on a Kids profile.</p>
      <h3>Occasion</h3>
      ${segHtml("sc-season", [["auto", `Auto: ${themeIcon(clipSeasonForDate())} ${themeName(clipSeasonForDate())}`], ...Object.entries(THEMES).map(([v, [l, i]]) => [v, `${i} ${l}`])], sc.season || "auto", "wrap")}
      <div class="actions"><button class="primary${scary ? " scare-now" : ""}" id="sc-now">${scary ? "Scare them now" : `Show one now ${themeIcon(season)}`}</button><button id="sc-loop">${state.looping ? "Stop the loop" : "Play on a loop"}</button></div>
      <p class="meta">A loop plays the occasion's clips one after another until you stop it: a window projector for the party.</p>
      <h3>Random clips</h3>
      ${segHtml("sc-on", [[1, "On"], [0, "Off"]], sc.enabled ? 1 : 0)}
      <h3>At most one every</h3>
      ${segHtml("sc-gap", SC_GAPS, sc.minGapMinutes)}
      <h3>How likely, once that gap has passed</h3>
      ${segHtml("sc-chance", SC_CHANCE, sc.chancePercent)}
      <h3>On screen for (when a clip doesn't say)</h3>
      ${segHtml("sc-secs", SC_SECONDS, sc.seconds)}
      <h3>How loud</h3>
      <input type="range" id="sc-vol" min="0" max="100" step="5" value="${Math.round(sc.volume * 100)}" aria-label="How loud">
      <h3>When</h3>
      ${segHtml("sc-live", [[1, "Live TV too"], [0, "Films and episodes only"]], sc.duringLive ? 1 : 0)}
      ${segHtml("sc-playing", [[1, "Only while watching"], [0, "Menus as well"]], sc.whilePlayingOnly ? 1 : 0)}
      <h3>Built clips</h3>
      <p class="meta" id="sc-mixes-none"${(state.mixes || []).length ? " hidden" : ""}>Build one from your clips, or add a pack below: a picture or GIF, a video, a sound, or a picture with a sound, placed where you like and perhaps walking across.</p>
      <div id="sc-mixes"></div>
      <div class="actions"><button id="sc-build">Build one</button><button id="sc-share">Share as a pack</button></div>
      <h3>Packs</h3>
      <div id="sc-packs"></div>
      <div class="actions"><button class="primary" id="sc-browse">Browse packs</button><button id="sc-pack-file">Add a pack file</button></div>
      <input type="file" id="sc-pack-input" accept=".utvpack,application/json,application/octet-stream" hidden>
      <div class="link-row"><input class="field" id="sc-pack-url" placeholder="Or paste a pack's link" autocomplete="off" inputmode="url"><button id="sc-pack-link">Add</button></div>
      <h3>Your uploads</h3>
      <p class="meta" id="sc-none">No uploads yet${scary ? ", so with no packs either the TV draws (and screams) its own scare" : ""}. Add a short video, a picture (a transparent GIF, PNG or SVG works best) or a sound from your phone.</p>
      <div id="sc-clips"></div>
      <div class="actions"><button id="sc-add">Add a clip</button></div>
      <input type="file" id="sc-file" accept="video/*,image/*,audio/*" hidden>
      <button class="link" data-close>Close</button>`);

    const put = async (patch) => {
      try {
        await send("/api/scares", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      } catch (e) {
        toast(e.message, true);
      }
    };
    const onSeg = (id, apply) => {
      for (const b of $(id).querySelectorAll("button")) {
        b.onclick = () => {
          for (const x of $(id).querySelectorAll("button")) x.classList.toggle("on", x === b);
          void apply(b.dataset.v);
        };
      }
    };
    onSeg("sc-season", async (v) => {
      await put({ season: v });
      void scareSheet();
    });
    onSeg("sc-on", (v) => put({ enabled: v === "1" }));
    onSeg("sc-gap", (v) => put({ minGapMinutes: Number(v) }));
    onSeg("sc-chance", (v) => put({ chancePercent: Number(v) }));
    onSeg("sc-secs", (v) => put({ seconds: Number(v) }));
    onSeg("sc-live", (v) => put({ duringLive: v === "1" }));
    onSeg("sc-playing", (v) => put({ whilePlayingOnly: v === "1" }));
    // Only saved when the finger comes off the slider, not on every pixel.
    $("sc-vol").onchange = (e) => void put({ volume: Number(e.target.value) / 100 });

    $("sc-now").onclick = async () => {
      try {
        await post("/api/scares/now", {});
        toast(scary ? "Boo!" : "On the TV now");
      } catch (e) {
        toast(e.message, true);
      }
    };
    $("sc-loop").onclick = async () => {
      try {
        const s = await post("/api/scares/loop", state.looping ? { theme: null } : { theme: season });
        state.looping = s.looping;
        $("sc-loop").textContent = s.looping ? "Stop the loop" : "Play on a loop";
        toast(s.looping ? `${themeName(s.looping)} clips on a loop. Back on the TV remote stops it too.` : "Loop stopped");
      } catch (e) {
        toast(e.message, true);
      }
    };

    const showMixes = (mixes) => {
      state.mixes = mixes;
      // The occasion's first, then the rest.
      const sorted = mixes.slice().sort((a, b) => Number(mixThemeOf(b) === season) - Number(mixThemeOf(a) === season));
      $("sc-mixes").innerHTML = sorted.map((m) => mixHtml(m, state.clips)).join("");
      $("sc-mixes-none").hidden = mixes.length > 0;
      for (const b of $("sc-mixes").querySelectorAll("[data-play]")) b.onclick = () => void post("/api/scares/now", { mixId: b.dataset.play }).then(() => toast("On the TV now"), (e) => toast(e.message, true));
      for (const b of $("sc-mixes").querySelectorAll("[data-drop]")) {
        b.onclick = async () => {
          try {
            const d = await send(`/api/scares/mixes/${encodeURIComponent(b.dataset.drop)}`, { method: "DELETE" });
            showMixes(d.mixes || []);
            toast("Deleted");
          } catch (e) {
            toast(e.message, true);
          }
        };
      }
    };
    showMixes(state.mixes || []);
    $("sc-build").onclick = () => {
      if (!state.clips.length) return toast("Add a clip or a pack first", true);
      buildSheet(state.clips, season, () => void scareSheet());
    };
    $("sc-share").onclick = () => {
      if (!(state.mixes || []).length) return toast("Build one or add a pack first", true);
      shareSheet(state, season, () => void scareSheet());
    };

    const showPacks = (packs) => {
      $("sc-packs").innerHTML = packs.length
        ? packs.map((p) => `<div class="clip"><span>${themeIcon(p.theme)} ${esc(p.name)}<br><small>${p.mixIds.length} clip${p.mixIds.length === 1 ? "" : "s"} · ${kb(p.sizeBytes)}${p.source === "community" ? " · community" : ""}</small></span><button type="button" data-unpack="${esc(p.id)}">Remove</button></div>`).join("")
        : `<p class="meta">No packs yet. Christmas, Easter, Valentine's, birthday, Halloween and fireworks starter packs come with the app: Browse packs.</p>`;
      for (const b of $("sc-packs").querySelectorAll("[data-unpack]")) {
        b.onclick = async () => {
          try {
            await send(`/api/scares/packs/${encodeURIComponent(b.dataset.unpack)}`, { method: "DELETE" });
            toast("Pack removed");
            void scareSheet();
          } catch (e) {
            toast(e.message, true);
          }
        };
      }
    };
    showPacks(state.packs || []);
    $("sc-browse").onclick = () => void browseSheet(() => void scareSheet());
    $("sc-pack-file").onclick = () => $("sc-pack-input").click();
    $("sc-pack-input").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        toast("Adding the pack…");
        const d = await send("/api/scares/packs", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
        toast(`Added ${d.pack.name}`);
        void scareSheet();
      } catch (err) {
        toast(err.message, true);
      }
    };
    $("sc-pack-link").onclick = async () => {
      const url = $("sc-pack-url").value.trim();
      if (!url) return toast("Paste the pack's link first", true);
      try {
        toast("Downloading the pack…");
        const d = await post("/api/scares/packs/link", { url });
        toast(`Added ${d.pack.name}`);
        void scareSheet();
      } catch (err) {
        toast(err.message, true);
      }
    };

    const showClips = (clips) => {
      state.clips = clips;
      // A pack's own files are managed with the pack, so only uploads are listed here.
      const own = clips.filter((c) => !c.packId);
      $("sc-clips").innerHTML = own.map(clipHtml).join("");
      $("sc-none").hidden = own.length > 0;
      for (const b of $("sc-clips").querySelectorAll("[data-play]")) b.onclick = () => void post("/api/scares/now", { clipId: b.dataset.play }).then(() => toast("On the TV now"), (e) => toast(e.message, true));
      for (const b of $("sc-clips").querySelectorAll("[data-drop]")) {
        b.onclick = async () => {
          try {
            const d = await send(`/api/scares/clips/${encodeURIComponent(b.dataset.drop)}`, { method: "DELETE" });
            showClips(d.clips || []);
            if (d.mixes) showMixes(d.mixes);
            toast("Clip deleted");
          } catch (e) {
            toast(e.message, true);
          }
        };
      }
    };
    showClips(state.clips);
    $("sc-add").onclick = () => $("sc-file").click();
    $("sc-file").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const add = $("sc-add");
      add.disabled = true;
      add.textContent = "Sending…";
      try {
        const d = await send(`/api/scares/clips?name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ""))}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        showClips(d.clips || []);
        toast("Clip added");
      } catch (err) {
        toast(err.message, true);
      }
      add.disabled = false;
      add.textContent = "Add a clip";
    };
  }
  /** The occasion the date picks, the same way the Hub does (for the Auto button's label). */
  function clipSeasonForDate(d = new Date()) {
    const m = d.getMonth();
    const day = d.getDate();
    if ((m === 9 && day >= 25) || (m === 10 && day <= 1)) return "halloween";
    if (m === 10 && day >= 4 && day <= 6) return "bonfire";
    if (m === 11 && day <= 26) return "christmas";
    if ((m === 11 && day === 31) || (m === 0 && day === 1)) return "newyear";
    if (m === 1 && day >= 10 && day <= 14) return "valentines";
    const y = d.getFullYear();
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
    const easter = new Date(y, Math.floor((h + l - 7 * mm + 114) / 31) - 1, ((h + l - 7 * mm + 114) % 31) + 1).getTime();
    const today = new Date(y, m, day).getTime();
    return today >= easter - 7 * 864e5 && today <= easter + 1.5 * 864e5 ? "easter" : "everyday";
  }
  const KIND_NAMES = { video: "Video", image: "Picture", audio: "Sound" };
  const SPOT_NAMES = { "top-left": "top left", top: "top", "top-right": "top right", left: "left", center: "middle", right: "right", "bottom-left": "bottom left", bottom: "bottom", "bottom-right": "bottom right", full: "full screen", overlay: "over everything" };
  const MOTION_NAMES = { still: "", "walk-left": "walks left", "walk-right": "walks right", "hop-left": "hops left", "hop-right": "hops right", "fly-left": "flies left", "fly-right": "flies right", rise: "floats up", drop: "drops in", peek: "peeks up" };
  function clipHtml(c) {
    return `<div class="clip"><span>${esc(c.name)}<br><small>${KIND_NAMES[c.kind] || "Clip"} · ${kb(c.sizeBytes)}</small></span><button type="button" data-play="${esc(c.id)}">${c.kind === "audio" ? "Play" : "Show"}</button><button type="button" data-drop="${esc(c.id)}">Delete</button></div>`;
  }
  function mixHtml(m, clips) {
    const name = (id) => clips.find((c) => c.id === id)?.name;
    const parts = [name(m.visualId), name(m.audioId) && `🔊 ${name(m.audioId)}`].filter(Boolean).join(" + ");
    const where = m.visualId ? ` · ${SPOT_NAMES[m.spot] || m.spot}${m.spot === "full" || m.spot === "overlay" ? "" : `, ${m.size}`}${m.motion && m.motion !== "still" ? `, ${MOTION_NAMES[m.motion]}` : ""}` : "";
    const drop = m.packId ? "" : `<button type="button" data-drop="${esc(m.id)}">Delete</button>`;
    return `<div class="clip"><span>${themeIcon(mixThemeOf(m))} ${esc(m.name)}<br><small>${esc(parts)}${esc(where)}</small></span><button type="button" data-play="${esc(m.id)}">Show</button>${drop}</div>`;
  }

  // Building a clip: a picture or video and a sound from the clips, placed on the screen, perhaps moving.
  const BUILD_SPOTS = [["top-left", "↖"], ["top", "Top"], ["top-right", "↗"], ["left", "Left"], ["center", "Middle"], ["right", "Right"], ["bottom-left", "↙"], ["bottom", "Bottom"], ["bottom-right", "↘"]];
  const BUILD_SIZES = [["small", "Small"], ["medium", "Medium"], ["large", "Large"]];
  const BUILD_SECONDS = [[0, "As set"], [4, "4 sec"], [8, "8 sec"], [12, "12 sec"], [20, "20 sec"]];
  const BUILD_MOTIONS = [["still", "Stays put"], ["walk-left", "Walks ←"], ["walk-right", "Walks →"], ["hop-left", "Hops ←"], ["hop-right", "Hops →"], ["fly-left", "Flies ←"], ["fly-right", "Flies →"], ["rise", "Floats up"], ["drop", "Drops in"], ["peek", "Peeks up"]];
  function buildSheet(clips, season, back) {
    const visuals = clips.filter((c) => c.kind !== "audio");
    const sounds = clips.filter((c) => c.kind === "audio");
    const b = { visualId: visuals[0]?.id || "", audioId: "", spot: "full", size: "medium", motion: "still", muteVideo: false, seconds: 0, theme: season };
    const pick = (id, items, value) => `<div class="list" id="${id}">${items.map(([v, l]) => `<button type="button" class="row-btn${v === value ? " on" : ""}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;
    openSheet(`<h2>Build a clip</h2>
      <p class="meta">A transparent GIF in a corner with a scream, a snowman walking along the bottom with sleigh bells, or just a sound in the dark.</p>
      <h3>For</h3>
      ${segHtml("bd-theme", Object.entries(THEMES).map(([v, [l, i]]) => [v, `${i} ${l}`]), b.theme, "wrap")}
      <h3>Picture or video</h3>
      ${pick("bd-visual", [["", "None (just the sound)"], ...visuals.map((c) => [c.id, `${c.name} · ${KIND_NAMES[c.kind]}`])], b.visualId)}
      <h3>Sound</h3>
      ${pick("bd-audio", [["", sounds.length ? "None" : "None (add a sound clip to use one)"], ...sounds.map((c) => [c.id, c.name])], b.audioId)}
      <label class="check" id="bd-mute-row"><input type="checkbox" id="bd-mute"> Play the video without its own sound</label>
      <div id="bd-place">
        <h3>Where on the screen</h3>
        <div class="where" id="bd-where">${BUILD_SPOTS.map(([v, l]) => `<button type="button" data-v="${v}">${esc(l)}</button>`).join("")}</div>
        <button type="button" class="where-full" id="bd-full">Full screen, on black</button>
        <button type="button" class="where-full" id="bd-overlay">Over everything, see-through</button>
        <div id="bd-size-row"><h3>Size</h3>${segHtml("bd-size", BUILD_SIZES, b.size)}</div>
        <div id="bd-motion-row"><h3>Moving</h3>${segHtml("bd-motion", BUILD_MOTIONS, b.motion, "wrap")}<p class="meta">Walking, hopping and flying go across the row you picked; floating up, dropping in and peeking stay in its column.</p></div>
      </div>
      <h3>On screen for</h3>
      ${segHtml("bd-secs", BUILD_SECONDS, b.seconds)}
      <input class="field" id="bd-name" maxlength="60" placeholder="Name it (optional)" autocomplete="off">
      <div class="actions"><button class="primary" id="bd-save">Save and try it</button><button id="bd-only">Save</button></div>
      <button class="link" id="bd-back">Back</button>`);
    const mark = (box, value) => {
      for (const x of $(box).querySelectorAll("button")) x.classList.toggle("on", x.dataset.v === String(value));
    };
    const refresh = () => {
      const visual = visuals.find((c) => c.id === b.visualId);
      const whole = b.spot === "full" || b.spot === "overlay";
      if (whole) b.motion = "still";
      mark("bd-theme", b.theme);
      mark("bd-visual", b.visualId);
      mark("bd-audio", b.audioId);
      mark("bd-where", b.spot);
      $("bd-full").classList.toggle("on", b.spot === "full");
      $("bd-overlay").classList.toggle("on", b.spot === "overlay");
      mark("bd-size", b.size);
      mark("bd-motion", b.motion);
      mark("bd-secs", b.seconds);
      $("bd-place").hidden = !visual;
      $("bd-size-row").hidden = whole;
      $("bd-motion-row").hidden = whole;
      $("bd-mute-row").hidden = visual?.kind !== "video";
    };
    const on = (box, apply) => {
      for (const x of $(box).querySelectorAll("button")) x.onclick = () => (apply(x.dataset.v), refresh());
    };
    on("bd-theme", (v) => (b.theme = v));
    on("bd-visual", (v) => (b.visualId = v));
    on("bd-audio", (v) => (b.audioId = v));
    on("bd-where", (v) => (b.spot = v));
    on("bd-size", (v) => (b.size = v));
    on("bd-motion", (v) => {
      b.motion = v;
      // Something walking across needs longer than a jump scare's few seconds.
      if (v !== "still" && b.seconds < 8) b.seconds = 12;
    });
    on("bd-secs", (v) => (b.seconds = Number(v)));
    $("bd-full").onclick = () => ((b.spot = "full"), refresh());
    $("bd-overlay").onclick = () => ((b.spot = "overlay"), refresh());
    $("bd-mute").onchange = (e) => (b.muteVideo = e.target.checked);
    $("bd-back").onclick = back;
    const save = async (andShow) => {
      if (!b.visualId && !b.audioId) return toast("Pick a picture, a video or a sound", true);
      try {
        const body = { ...b, name: $("bd-name").value.trim() };
        if (!body.visualId) delete body.visualId;
        if (!body.audioId) delete body.audioId;
        const { mix } = await post("/api/scares/mixes", body);
        if (andShow) await post("/api/scares/now", { mixId: mix.id });
        toast(andShow ? "Saved, and on the TV now" : "Saved");
        back();
      } catch (e) {
        toast(e.message, true);
      }
    };
    $("bd-save").onclick = () => void save(true);
    $("bd-only").onclick = () => void save(false);
    refresh();
  }

  // Packs: the starter packs that come with the app, and the community list.
  async function browseSheet(back) {
    openSheet(`<h2>Browse packs</h2><div class="spinner"></div><button class="link" id="br-back">Back</button>`);
    $("br-back").onclick = back;
    let lib;
    try {
      lib = await get("/api/scares/library");
    } catch (e) {
      toast(e.message, true);
      return back();
    }
    const row = (p, from) =>
      `<div class="clip pack"><span>${themeIcon(p.theme)} ${esc(p.name)}${p.scary ? ` <small class="tag">scary</small>` : ""}<br><small>${esc(p.description || "")}</small><br><small>${p.count ? `${p.count} clip${p.count === 1 ? "" : "s"} · ` : ""}${kb(p.sizeBytes)}${p.author ? ` · by ${esc(p.author)}` : ""}</small></span><button type="button" data-install="${esc(p.id)}" data-from="${from}">${p.installed ? "Update" : "Add"}</button></div>`;
    const community = lib.community.packs || [];
    openSheet(`<h2>Browse packs</h2>
      <p class="meta">Pictures, sounds and ready-built clips for an occasion. Adding one never shows anything on a Kids profile; remove a pack and its clips go with it.</p>
      <h3>Comes with the app</h3>
      ${lib.starter.map((p) => row(p, "starter")).join("") || `<p class="meta">None here.</p>`}
      <h3>From the community</h3>
      ${lib.community.error ? `<p class="meta">${esc(lib.community.error)}</p>` : community.length ? community.map((p) => row(p, "community")).join("") : `<p class="meta">Nothing on the community list yet. Made a good one? Share it as a pack and send it in (see the project's community/clips folder).</p>`}
      <button class="link" id="br-back">Back</button>`);
    $("br-back").onclick = back;
    for (const b of document.querySelectorAll("[data-install]")) {
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = "Adding…";
        try {
          const d = await post("/api/scares/library/install", { id: b.dataset.install, from: b.dataset.from });
          b.textContent = "Added";
          toast(`Added ${d.pack.name}`);
        } catch (e) {
          b.disabled = false;
          b.textContent = "Add";
          toast(e.message, true);
        }
      };
    }
  }

  // Sharing built clips as a pack: a file to send, or a link and QR code on the Hub.
  function shareSheet(state, season, back) {
    const mixes = state.mixes || [];
    const picked = new Set(mixes.filter((m) => mixThemeOf(m) === season).map((m) => m.id));
    if (!picked.size) for (const m of mixes) picked.add(m.id);
    openSheet(`<h2>Share as a pack</h2>
      <p class="meta">Puts the clips you pick, and the pictures and sounds they use, in one file for another UltimateTV: send it to a friend, keep it as a backup, or send it in for the community list.</p>
      <div id="sh-list">${mixes.map((m) => `<label class="check"><input type="checkbox" data-id="${esc(m.id)}"${picked.has(m.id) ? " checked" : ""}> ${themeIcon(mixThemeOf(m))} ${esc(m.name)}</label>`).join("")}</div>
      <input class="field" id="sh-name" maxlength="60" placeholder="Name the pack" value="${esc(`${themeName(season)} clips`)}" autocomplete="off">
      <div class="actions"><button class="primary" id="sh-link">Make a link and QR code</button><button id="sh-file">Send the file</button></div>
      <div id="sh-out"></div>
      <button class="link" id="sh-back">Back</button>`);
    $("sh-back").onclick = back;
    const chosen = () => [...$("sh-list").querySelectorAll("input:checked")].map((x) => x.dataset.id);
    const body = () => ({ name: $("sh-name").value.trim(), theme: mixThemeOf(mixes.find((m) => chosen().includes(m.id)) || {}), mixIds: chosen() });
    $("sh-link").onclick = async () => {
      if (!chosen().length) return toast("Pick at least one", true);
      try {
        const { share } = await post("/api/scares/shares", body());
        $("sh-out").innerHTML = `<div class="share-out"><img src="${esc(share.qr)}" alt="QR code for the share page"><p class="meta">Anyone on your home Wi-Fi can scan this or open the link to see the clips and download the pack.</p><input class="field" readonly value="${esc(share.url)}" id="sh-url"><div class="actions"><button id="sh-copy">Copy the link</button><a class="btn-like" href="${esc(share.packUrl)}" download>Download</a></div></div>`;
        $("sh-copy").onclick = () => {
          $("sh-url").select();
          void navigator.clipboard?.writeText(share.url).then(() => toast("Copied"), () => toast("Press and hold the link to copy it"));
        };
      } catch (e) {
        toast(e.message, true);
      }
    };
    $("sh-file").onclick = async () => {
      if (!chosen().length) return toast("Pick at least one", true);
      try {
        const r = await fetch("/api/scares/packs/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        const blob = await r.blob();
        const name = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || "clips.utvpack";
        const file = new File([blob], name, { type: "application/octet-stream" });
        // The phone's own share sheet (WhatsApp, email…) where there is one; a download where not.
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: body().name || "Clips" });
        else {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        }
      } catch (e) {
        if (e.name !== "AbortError") toast(e.message, true);
      }
    };
  }
  $("scare-btn").addEventListener("click", () => void scareSheet());

  // ---------------------------------------------------------------------------
  // Browse

  let current = "guide";
  let browsed = false;
  const body = $("browse-body");
  for (const c of document.querySelectorAll("[data-browse]")) {
    c.addEventListener("click", () => {
      for (const x of document.querySelectorAll("[data-browse]")) x.classList.toggle("on", x === c);
      show(c.dataset.browse);
    });
  }
  const loading = () => (body.innerHTML = `<p class="empty">Loading…</p>`);
  const failed = (e) => (body.innerHTML = `<p class="empty">${esc(e.message)}</p>`);

  async function show(what) {
    current = what;
    browsed = true;
    loading();
    try {
      if (what === "guide") await showGuide();
      if (what === "movie" || what === "series") await showRails(what);
      if (what === "recordings") await showRecordings();
      if (what === "queue") await showQueue();
      if (what === "downloads") await showDownloads();
      if (what === "music") await showMusic("playlists");
      if (what === "weather") await showWeather();
      if (what === "search") showSearch();
    } catch (e) {
      failed(e);
    }
  }

  // Guide: what's on now and next on each channel.
  let nowNext = [];
  async function showGuide() {
    nowNext = (await get("/api/nownext")).items;
    if (!nowNext.length) return (body.innerHTML = `<p class="empty">No channels yet.</p>`);
    const t = Date.now();
    body.innerHTML = `<div class="list">${nowNext
      .map((n, i) => {
        const pct = n.now ? Math.max(0, Math.min(100, ((t - n.now.start) / (n.now.end - n.now.start)) * 100)) : 0;
        return `<button class="item" data-nn="${i}">
          <span class="logo">${n.channel.logo ? `<img src="${esc(n.channel.logo)}" alt="" loading="lazy">` : esc(n.channel.number)}</span>
          <span class="text"><b>${esc(n.channel.number)} ${esc(n.channel.name)}</b>
          <span>${n.now ? esc(n.now.title) : "No guide"}</span>
          ${n.now ? `<i class="bar"><i style="width:${pct}%"></i></i>` : ""}
          ${n.next ? `<small>Next ${clock(n.next.start)} ${esc(n.next.title)}</small>` : ""}</span></button>`;
      })
      .join("")}</div>`;
    for (const b of body.querySelectorAll("[data-nn]")) b.onclick = () => channelSheet(nowNext[Number(b.dataset.nn)]);
  }
  function programmeHtml(p, label) {
    return `<div class="prog"><small>${label} · ${clock(p.start)}–${clock(p.end)}</small><b>${esc(p.title)}</b>${p.subtitle ? `<span>${esc(p.subtitle)}</span>` : ""}${p.description ? `<p>${esc(p.description)}</p>` : ""}</div>`;
  }
  function channelSheet(n) {
    openSheet(`<h2>${esc(n.channel.number)} ${esc(n.channel.name)}</h2>
      ${n.now ? programmeHtml(n.now, "Now") : ""}
      <div class="actions"><button class="primary" id="s-watch">Watch on TV</button>${n.now ? `<button id="s-rec-now">Record this</button>` : ""}</div>
      ${n.next ? programmeHtml(n.next, "Next") + `<div class="actions"><button id="s-rec-next">Record next</button></div>` : ""}
      <button class="link" data-close>Close</button>`);
    $("s-watch").onclick = () => playOnTv({ kind: "channel", id: n.channel.id });
    const rec = (p) => post("/api/recordings", { programmeId: p.id }).then(() => (toast(`Recording ${p.title}`), closeSheet()), (e) => toast(e.message, true));
    if (n.now) $("s-rec-now").onclick = () => rec(n.now);
    if (n.next) $("s-rec-next").onclick = () => rec(n.next);
  }

  // Films and TV: the same rails as the TV.
  async function showRails(kind) {
    const { rails } = await get(`/api/browse/${kind}`);
    const withItems = rails.filter((r) => r.items?.length);
    if (!withItems.length) return (body.innerHTML = `<p class="empty">Nothing here yet.</p>`);
    body.innerHTML = withItems
      .map(
        (r, ri) => `<h3 class="rail-title">${esc(r.title)}</h3><div class="rail">${r.items
          .map((t, i) => `<button class="poster" data-rail="${ri}" data-i="${i}">${t.poster ? `<img src="${esc(t.poster)}" alt="" loading="lazy">` : `<span>${esc(t.name)}</span>`}${t.progress ? `<i class="bar"><i style="width:${Math.round(t.progress * 100)}%"></i></i>` : ""}<small>${esc(t.name)}</small></button>`)
          .join("")}</div>`,
      )
      .join("");
    for (const b of body.querySelectorAll("[data-rail]")) b.onclick = () => titleSheet(withItems[Number(b.dataset.rail)].items[Number(b.dataset.i)]);
  }

  async function titleSheet(ref) {
    openSheet(`<p class="empty">Loading…</p>`);
    let d;
    try {
      d = await get(`/api/titles/${encodeURIComponent(ref.id)}`);
    } catch (e) {
      return openSheet(`<p class="empty">${esc(e.message)}</p><button class="link" data-close>Close</button>`);
    }
    const titleRef = { id: d.id, kind: d.kind, name: d.name, ...(d.year ? { year: d.year } : {}), ...(d.poster ? { poster: d.poster } : {}), ...(d.backdrop ? { backdrop: d.backdrop } : {}) };
    const meta = [d.year, d.certification, d.runtimeMin ? `${d.runtimeMin} min` : "", d.rating ? `★ ${d.rating.toFixed(1)}` : ""].filter(Boolean).join(" · ");
    const seasons = d.seasons ?? [];
    openSheet(`${d.backdrop ? `<div class="hero" style="background-image:url('${esc(d.backdrop)}')"></div>` : ""}
      <h2>${esc(d.name)}</h2><p class="meta">${esc(meta)}</p>
      ${d.overview ? `<p class="overview">${esc(d.overview)}</p>` : ""}
      <div class="actions">${d.kind === "movie" || !seasons.length ? `<button class="primary" id="s-play">${d.resumeMs ? `Resume from ${fmt(d.resumeMs)}` : "Play on TV"}</button>${d.resumeMs ? `<button id="s-start">From the start</button>` : ""}<button id="s-queue">Add to queue</button><button id="s-dl">Download to TV box</button>${!kidsProfile && !d.inLibrary ? `<button id="s-save">Save to NAS</button>` : ""}` : ""}<button id="s-later">Save for later</button></div>
      ${seasons.length ? `<select id="s-season">${seasons.map((s, i) => `<option value="${i}">${esc(s.name || `Series ${s.season}`)}</option>`).join("")}</select><div class="actions"><button id="s-dl-season">Download this series to the TV box</button>${!kidsProfile ? `<button id="s-save-season">Save this series to the NAS</button>` : ""}${seasons.filter((s) => s.season > 0).length > 1 ? `<button id="s-dl-all">Download every series</button>` : ""}</div><div class="list" id="s-eps"></div>` : ""}
      <button class="link" data-close>Close</button>`);
    if ($("s-play")) $("s-play").onclick = () => playOnTv({ kind: "title", id: d.id }, titleRef);
    if ($("s-start")) $("s-start").onclick = () => playOnTv({ kind: "title", id: d.id }, titleRef, true);
    const art = d.backdrop ?? d.poster;
    if ($("s-queue")) $("s-queue").onclick = () => queueIt({ req: { kind: "title", id: d.id }, title: titleRef, name: d.name, ...(d.year ? { subtitle: String(d.year) } : {}), ...(art ? { image: art } : {}) });
    if ($("s-dl")) $("s-dl").onclick = () => downloadToBox({ titleId: d.id });
    $("s-later").onclick = () =>
      void post("/api/watchlist", { title: titleRef, from: "phone" }).then(
        () => (($("s-later").textContent = "Saved for later"), ($("s-later").disabled = true), toast("Saved: it's on the TV's Home")),
        (e) => toast(e.message, true),
      );
    if ($("s-dl-season")) $("s-dl-season").onclick = () => downloadToBox({ titleId: d.id, season: seasons[Number($("s-season").value)].season });
    if ($("s-dl-all")) $("s-dl-all").onclick = () => downloadToBox({ titleId: d.id, all: true });
    if ($("s-save")) $("s-save").onclick = () => saveToNas({ titleId: d.id });
    if ($("s-save-season")) $("s-save-season").onclick = () => saveToNas({ titleId: d.id, season: seasons[Number($("s-season").value)].season });
    if (seasons.length) {
      const pick = async () => {
        const s = seasons[Number($("s-season").value)];
        let eps = s.episodes;
        if (!eps?.length) {
          $("s-eps").innerHTML = `<p class="empty">Loading…</p>`;
          eps = (await get(`/api/titles/${encodeURIComponent(d.id)}/season/${s.season}`).catch(() => ({ episodes: [] }))).episodes;
        }
        $("s-eps").innerHTML = eps.length
          ? eps
              .map(
                (e, i) => `<div class="ep-row"><button class="item ep" data-ep="${i}"><span class="text"><b>${e.episode}. ${esc(e.name)}</b>${e.overview ? `<small>${esc(e.overview.slice(0, 140))}${e.overview.length > 140 ? "…" : ""}</small>` : ""}${e.progress ? `<i class="bar"><i style="width:${Math.round(e.progress * 100)}%"></i></i>` : ""}</span>${e.watched ? `<span class="tick">✓</span>` : ""}</button><button class="qbtn" data-q="${i}" aria-label="Add to queue">+</button><button class="qbtn" data-dl="${i}" aria-label="Download to the TV box">⤓</button>${!kidsProfile ? `<button class="qbtn" data-save="${i}" aria-label="Save to NAS and Jellyfin">💾</button>` : ""}</div>`,
              )
              .join("")
          : `<p class="empty">No episodes listed.</p>`;
        for (const b of $("s-eps").querySelectorAll("[data-ep]")) {
          const e = eps[Number(b.dataset.ep)];
          b.onclick = () => playOnTv({ kind: "title", id: d.id, episodeId: `s${e.season}e${e.episode}` }, titleRef);
        }
        for (const b of $("s-eps").querySelectorAll("[data-dl]")) {
          const e = eps[Number(b.dataset.dl)];
          b.onclick = () => downloadToBox({ titleId: d.id, episodeId: `s${e.season}e${e.episode}` });
        }
        for (const b of $("s-eps").querySelectorAll("[data-save]")) {
          const e = eps[Number(b.dataset.save)];
          b.onclick = () => saveToNas({ titleId: d.id, episodeId: `s${e.season}e${e.episode}` });
        }
        for (const b of $("s-eps").querySelectorAll("[data-q]")) {
          const e = eps[Number(b.dataset.q)];
          const still = e.still ?? art;
          b.onclick = () =>
            queueIt({ req: { kind: "title", id: d.id, episodeId: `s${e.season}e${e.episode}` }, title: titleRef, name: d.name, subtitle: `S${e.season} E${e.episode} · ${e.name}`, ...(still ? { image: still } : {}) });
        }
      };
      $("s-season").onchange = pick;
      // Start on the first season with something unwatched.
      const first = seasons.findIndex((s) => s.episodes?.some((e) => !e.watched));
      $("s-season").value = String(Math.max(0, first));
      void pick();
    }
  }

  // The weather the TV shows: now, the next day hour by hour, and the week. The Hub sends the
  // words with it, so this page needn't know what each weather code means.
  const WX_EMOJI = { sun: "☀️", moon: "🌙", partly: "⛅", "partly-night": "☁️", cloud: "☁️", fog: "🌫️", drizzle: "🌦️", rain: "🌧️", "heavy-rain": "🌧️", sleet: "🌨️", snow: "❄️", thunder: "⛈️" };
  async function showWeather() {
    const st = await get("/api/weather?words=1");
    if (current !== "weather") return;
    const r = st.report;
    if (!r) {
      body.innerHTML = `<p class="empty">${st.settings.place ? esc(st.error || "The forecast is on its way.") : "Say where you live first: your town or postcode."}</p><div class="actions"><button id="wx-setup">Weather settings</button></div>`;
      $("wx-setup").onclick = () => (location.href = "/setup/#weather");
      return;
    }
    const s = st.settings;
    const word = (code, isDay) => st.words?.codes[`${code}-${isDay ? 1 : 0}`] ?? { label: "", icon: "cloud" };
    const e = (code, isDay) => WX_EMOJI[word(code, isDay).icon] ?? "☁️";
    const temp = (c) => `${Math.round(s.temperature === "f" ? (c * 9) / 5 + 32 : c)}°`;
    const wind = (k) => `${Math.round(s.wind === "mph" ? k / 1.609344 : k)} ${s.wind === "mph" ? "mph" : "km/h"}`;
    const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((d % 360) + 360) % 360) / 45) % 8];
    const from = Math.floor(Date.now() / 3600_000) * 3600_000;
    const hours = r.hours.filter((h) => h.at >= from).slice(0, 24);
    const today = new Date().setHours(0, 0, 0, 0);
    const dayName = (t) => {
      const n = Math.round((new Date(t).setHours(0, 0, 0, 0) - today) / 86_400_000);
      return n === 0 ? "Today" : n === 1 ? "Tomorrow" : new Date(t).toLocaleDateString([], { weekday: "long" });
    };
    const hh = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const d0 = r.days[0];
    body.innerHTML = `<p class="meta">${esc(r.place.name)}${r.place.detail ? ` · ${esc(r.place.detail)}` : ""}</p>
      <div class="wx-now"><span class="wx-e">${e(r.now.code, r.now.isDay)}</span><span class="wx-t">${temp(r.now.tempC)}</span>
      <div><b>${esc(word(r.now.code, r.now.isDay).label)}</b><span>Feels like ${temp(r.now.feelsC)}</span>${d0 ? `<span>High ${temp(d0.maxC)} · Low ${temp(d0.minC)}</span>` : ""}</div></div>
      ${st.words?.headline ? `<span class="wx-head">${esc(st.words.headline)}</span>` : ""}
      <p class="meta">Wind ${wind(r.now.windKmh)} ${compass(r.now.windDeg)}, gusts ${wind(r.now.gustKmh)} · humidity ${Math.round(r.now.humidity)}%${d0 ? ` · sunset ${hh(d0.sunset)}` : ""}</p>
      <h3 class="rail-title">Hour by hour</h3>
      <div class="wx-hours">${hours.map((h, i) => `<span class="${h.rainChance >= 40 ? "wet" : ""}">${i ? hh(h.at) : "Now"}<em class="e" style="font-style:normal">${e(h.code, h.isDay)}</em><b>${temp(h.tempC)}</b><i>${h.rainChance >= 10 ? `${h.rainChance}%` : "&nbsp;"}</i></span>`).join("")}</div>
      <h3 class="rail-title">The week</h3>
      <div class="list">${r.days.map((d) => `<div class="wx-day"><span>${esc(dayName(d.date))}<small>${esc(word(d.code, true).label)}</small></span><span class="e">${e(d.code, true)}</span><span class="rain">${d.rainChance >= 20 ? `${d.rainChance}%` : ""}</span><span class="lo">${temp(d.minC)}</span><span class="hi">${temp(d.maxC)}</span></div>`).join("")}</div>
      <div class="actions"><button id="wx-tv">Show on the TV</button></div>
      <p class="meta">From Open-Meteo, updated ${clock(r.fetchedAt)}${st.error ? ` · ${esc(st.error)}` : ""}</p>`;
    $("wx-tv").onclick = () => post("/api/weather/show", {}).then(() => toast("On the TV"), (err) => toast(err.message, true));
  }

  // The queue: tap to play now, ↑ to play next, ✕ to take off.
  async function showQueue() {
    const { queue } = await get("/api/queue");
    if (current !== "queue") return;
    if (!queue.length) return (body.innerHTML = `<p class="empty">Nothing queued. Add films and episodes with Add to queue or +, and they play one after another on the TV.</p>`);
    body.innerHTML = `<div class="list">${queue
      .map(
        (q, i) => `<div class="ep-row"><button class="item" data-qi="${i}"><span class="logo">${q.image ? `<img src="${esc(q.image)}" alt="" loading="lazy" style="object-fit:cover;width:100%;height:100%">` : i + 1}</span><span class="text"><b>${esc(q.name)}</b>${q.subtitle ? `<span>${esc(q.subtitle)}</span>` : ""}<small>${i === 0 ? "Plays next" : ordinal(i + 1)}</small></span></button>${i ? `<button class="qbtn" data-qup="${i}" aria-label="Play next">↑</button>` : ""}<button class="qbtn danger" data-qx="${i}" aria-label="Remove">✕</button></div>`,
      )
      .join("")}</div><div class="actions"><button id="q-clear">Clear the queue</button></div>`;
    const act = (fn) => fn().then(showQueue, (e) => toast(e.message, true));
    for (const b of body.querySelectorAll("[data-qi]")) {
      const q = queue[Number(b.dataset.qi)];
      b.onclick = () => playOnTv(q.req, q.title).then(() => setTimeout(() => current === "queue" && showQueue(), 1000));
    }
    for (const b of body.querySelectorAll("[data-qup]")) b.onclick = () => act(() => post(`/api/queue/${encodeURIComponent(queue[Number(b.dataset.qup)].id)}/move`, { to: 0 }));
    for (const b of body.querySelectorAll("[data-qx]")) b.onclick = () => act(() => del(`/api/queue/${encodeURIComponent(queue[Number(b.dataset.qx)].id)}`));
    $("q-clear").onclick = () => act(() => del("/api/queue"));
  }

  // Recordings: finished ones to watch, and what's recording now.
  async function showRecordings() {
    const { recordings } = await get("/api/recordings");
    const list = recordings.filter((r) => r.status === "completed" || r.status === "recording").sort((a, b) => b.start - a.start);
    if (!list.length) return (body.innerHTML = `<p class="empty">No recordings yet. Record from the Guide.</p>`);
    body.innerHTML = `<div class="list">${list
      .map(
        (r, i) => `<div class="ep-row"><button class="item" data-recording="${i}"><span class="text"><b>${esc(r.programme.title)}${r.status === "recording" ? ` <em class="rec">● REC</em>` : ""}</b>
        ${r.programme.subtitle ? `<span>${esc(r.programme.subtitle)}</span>` : ""}<small>${esc(r.channelName)} · ${new Date(r.programme.start).toLocaleDateString([], { day: "numeric", month: "short" })} ${clock(r.programme.start)}${r.watched ? " · watched" : ""}</small></span></button>${r.status === "completed" ? `<button class="qbtn" data-rdl="${i}" aria-label="Download to the TV box">⤓</button>` : ""}</div>`,
      )
      .join("")}</div>`;
    for (const b of body.querySelectorAll("[data-recording]")) b.onclick = () => playOnTv({ kind: "recording", id: list[Number(b.dataset.recording)].id });
    for (const b of body.querySelectorAll("[data-rdl]")) b.onclick = () => downloadToBox({ recordingId: list[Number(b.dataset.rdl)].id });
  }

  // On the box: what's downloaded to the TV box to watch away from home, and what's still coming.
  let downloadsTimer;
  async function showDownloads() {
    clearTimeout(downloadsTimer);
    const d = await call("downloads");
    if (current !== "downloads") return;
    const head = `<p class="meta">${size(d.usedBytes)} on the box · ${size(Math.max(0, d.freeBytes - d.reserveBytes))} free · kept ${d.settings.keepDays ? `${d.settings.keepDays} days` : "until deleted"}${d.settings.deleteWatched ? ", or a day after watching" : ""}</p>`;
    const status = (i) => {
      if (i.status === "done") return [size(i.bytesTotal), i.watchedAt ? "watched" : "", i.expiresAt ? `goes ${new Date(i.expiresAt).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ");
      if (i.status === "downloading") return i.bytesTotal ? `Downloading ${Math.floor((i.bytesDone / i.bytesTotal) * 100)}% of ${size(i.bytesTotal)}${i.speedBps ? ` · ${size(i.speedBps)}/s` : ""}` : `Downloading · ${size(i.bytesDone)}`;
      if (i.status === "failed") return `Didn't download: ${i.error || "it failed"}`;
      return i.error ? `Waiting: ${i.error}` : "Waiting to download";
    };
    body.innerHTML = d.items.length
      ? `${head}<div class="list">${d.items
          .map(
            (i, n) => `<div class="ep-row"><button class="item" data-dli="${n}"><span class="logo">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" style="object-fit:cover;width:100%;height:100%">` : "⤓"}</span><span class="text"><b>${esc(i.name)}</b>${i.subtitle ? `<span>${esc(i.subtitle)}</span>` : ""}<small>${esc(status(i))}</small>${i.status === "downloading" && i.bytesTotal ? `<i class="bar"><i style="width:${Math.round((i.bytesDone / i.bytesTotal) * 100)}%"></i></i>` : ""}</span>${i.status === "done" ? `<span class="tick">✓</span>` : ""}</button><button class="qbtn danger" data-dlx="${n}" aria-label="Delete from the box">✕</button></div>`,
          )
          .join("")}</div>`
      : `${head}<p class="empty">Nothing on the TV box yet. Open a film, series or recording and choose Download to TV box (or ⤓), and it plays on the TV even away from home.</p>`;
    for (const b of body.querySelectorAll("[data-dli]")) {
      const i = d.items[Number(b.dataset.dli)];
      b.onclick = () => (i.status === "done" ? playOnTv(i.req, i.title) : toast(status(i)));
    }
    for (const b of body.querySelectorAll("[data-dlx]")) {
      const i = d.items[Number(b.dataset.dlx)];
      b.onclick = () => {
        if (!confirm(`Delete ${i.name}${i.subtitle ? ` (${i.subtitle})` : ""} from the TV box?`)) return;
        call("downloadRemove", { id: i.id }).then(showDownloads, (e) => toast(e.message, true));
      };
    }
    // Keep the percentages moving while something downloads.
    if (d.items.some((i) => i.status === "downloading" || i.status === "queued")) downloadsTimer = setTimeout(() => current === "downloads" && document.visibilityState === "visible" && showDownloads().catch(() => undefined), 3000);
  }

  // Signing in to Spotify and Deezer on the TV, from the phone: the first thing the Music page shows
  // until both are done (TV apps from before musicStatus show the library straight away).
  function musicSetupHtml(st) {
    const sp = st.spotify || {};
    const name = esc(sp.deviceName || "the TV");
    let spotify = "";
    if (sp.installed === false || (!sp.available && sp.installed === undefined)) spotify = `<div class="msetup"><h3>Spotify isn't on the TV box yet</h3><p>Update the box from the TV (Settings › About), then come back here.</p></div>`;
    else if (!sp.available)
      spotify = `<div class="msetup"><h3>${sp.problem ? "Spotify isn't starting on the TV" : "Spotify is starting on the TV…"}</h3>${sp.problem ? `<p>${esc(sp.problem)}</p>` : ""}${st.setup ? `<button class="link" data-ms="restart">Restart Spotify</button>` : ""}</div>`;
    else if (!sp.signedIn && sp.signIn === "code")
      spotify = `<div class="msetup spotify"><h3>Sign in to Spotify with a code</h3>${sp.pair ? `<p>Tap below, sign in, and enter this code:</p><div class="code">${esc(sp.pair.code)}</div><a class="btn" href="${esc(sp.pair.url)}" target="_blank" rel="noopener">Open ${esc(sp.pair.url.replace(/^https?:\/\//, "").replace(/\?.*$/, ""))}</a>` : `<p>Getting a code from Spotify…</p>`}${st.setup ? `<button class="link" data-ms="phone">Sign in from the Spotify app instead</button>` : ""}</div>`;
    else if (!sp.signedIn)
      spotify = `<div class="msetup spotify"><h3>Sign in to Spotify on the TV</h3><ol><li>Open the Spotify app (on the home Wi-Fi).</li><li>Play any song and tap the devices button at the bottom of the player.</li><li>Pick <b>${name}</b>.</li></ol><p>The TV remembers you, and your playlists appear here and on the TV. Needs Spotify Premium.</p><a class="btn" href="https://open.spotify.com/" target="_blank" rel="noopener">Open Spotify</a>${st.setup ? `<button class="link" data-ms="code">${name} not listed? Sign in with a code</button>` : ""}</div>`;
    const deezer = st.deezer && st.deezer.signedIn === false ? `<div class="msetup deezer"><h3>Log in to Deezer on the TV</h3><p>Type your Deezer email and password on your phone and the TV logs in. Google or Apple sign-in doesn't work on the TV: set a Deezer password first (Forgot your password on deezer.com).</p><a class="btn" href="/music-login/">Log in to Deezer</a></div>` : "";
    return spotify + deezer;
  }
  function wireMusicSetup(kind) {
    for (const b of body.querySelectorAll("[data-ms]"))
      b.onclick = () => {
        b.disabled = true;
        const m = b.dataset.ms;
        call("musicSetup", m === "restart" ? { restart: true } : { signIn: m }).then(
          () => setTimeout(() => showMusic(kind), 1500),
          (e) => (toast(e.message, true), (b.disabled = false)),
        );
      };
  }

  // Music: the Spotify library on the box.
  async function showMusic(kind) {
    const st = await call("musicStatus").catch(() => null);
    const setup = st ? musicSetupHtml(st) : "";
    if (st && !st.spotify?.signedIn) {
      body.innerHTML = setup;
      wireMusicSetup(kind);
      // Check again while the page is open: signing in happens elsewhere.
      clearTimeout(showMusic.timer);
      showMusic.timer = setTimeout(() => current === "music" && document.visibilityState === "visible" && showMusic(kind).catch(() => undefined), 5000);
      return;
    }
    body.innerHTML = `${setup}<div class="seg">${["playlists", "albums", "artists"].map((k) => `<button data-mk="${k}" class="${k === kind ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div><div id="music-list"><p class="empty">Loading…</p></div>`;
    for (const b of body.querySelectorAll("[data-mk]")) b.onclick = () => showMusic(b.dataset.mk);
    let page;
    try {
      page = await call("musicLibrary", { kind });
    } catch (e) {
      return ($("music-list").innerHTML = `<p class="empty">${esc(e.message)}</p>`);
    }
    if (!page.items.length) return ($("music-list").innerHTML = `<p class="empty">Nothing here yet.</p>`);
    $("music-list").innerHTML = `<div class="grid">${page.items.map((m, i) => `<button class="tile" data-mi="${i}">${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : `<span class="noimg">♪</span>`}<b>${esc(m.name)}</b>${m.subtitle ? `<small>${esc(m.subtitle)}</small>` : ""}</button>`).join("")}</div>`;
    for (const b of $("music-list").querySelectorAll("[data-mi]")) b.onclick = () => musicSheet(page.items[Number(b.dataset.mi)]);
  }
  async function musicSheet(item) {
    openSheet(`${item.image ? `<img class="cover" src="${esc(item.image)}" alt="">` : ""}<h2>${esc(item.name)}</h2>${item.subtitle ? `<p class="meta">${esc(item.subtitle)}</p>` : ""}
      <div class="actions"><button class="primary" id="m-play">Play on TV</button><button id="m-shuffle">Shuffle</button></div><div class="list" id="m-tracks"></div><button class="link" data-close>Close</button>`);
    const playIt = (opts) =>
      call("musicPlay", { uri: item.uri, ...opts }).then(
        () => (toast("Playing on the TV"), closeSheet(), setTimeout(poll, 800)),
        (e) => toast(e.message, true),
      );
    $("m-play").onclick = () => playIt({});
    $("m-shuffle").onclick = () => playIt({ shuffle: true });
    if (item.kind === "artist") return;
    for (let tries = 0; tries < 6; tries++) {
      const t = await call("musicTracks", { uri: item.uri }).catch(() => null);
      if (!t || $("sheet").hidden || !$("m-tracks")) return;
      if (t.ready || tries === 5) {
        $("m-tracks").innerHTML = t.items.map((s, i) => `<button class="item" data-ti="${i}"><span class="text"><b>${esc(s.name)}</b>${s.subtitle ? `<small>${esc(s.subtitle)}</small>` : ""}</span><small>${s.durationMs ? fmt(s.durationMs) : ""}</small></button>`).join("");
        for (const b of $("m-tracks").querySelectorAll("[data-ti]")) b.onclick = () => playIt({ skipTo: t.items[Number(b.dataset.ti)].uri });
        return;
      }
      $("m-tracks").innerHTML = `<p class="empty">Fetching the songs…</p>`;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Search: films, series, channels, programmes and recordings.
  function showSearch() {
    body.innerHTML = `<form class="search" id="search-form"><input id="search-q" type="search" placeholder="Films, series, channels…" autocomplete="off" enterkeyhint="search"></form><div id="search-results"></div>`;
    const q = $("search-q");
    let timer;
    const run = async () => {
      const text = q.value.trim();
      if (text.length < 2) return ($("search-results").innerHTML = "");
      try {
        const { results } = await get(`/api/search?q=${encodeURIComponent(text)}`);
        if (q.value.trim() !== text) return;
        $("search-results").innerHTML = results.length
          ? `<div class="list">${results
              .map((r, i) => `<button class="item" data-sr="${i}">${r.image ? `<span class="logo"><img src="${esc(r.image)}" alt="" loading="lazy"></span>` : ""}<span class="text"><b>${esc(r.name)}</b>${r.subtitle ? `<small>${esc(r.subtitle)}</small>` : ""}</span></button>`)
              .join("")}</div>`
          : `<p class="empty">Nothing found.</p>`;
        for (const b of $("search-results").querySelectorAll("[data-sr]")) {
          const r = results[Number(b.dataset.sr)];
          b.onclick = () => {
            if (r.kind === "title" && r.title) return titleSheet(r.title);
            if (r.kind === "recording") return playOnTv({ kind: "recording", id: r.recording?.id ?? r.id });
            if ((r.kind === "channel" || r.kind === "on-now") && r.channel) return playOnTv({ kind: "channel", id: r.channel.id });
            if (r.kind === "upcoming" && r.programme) {
              openSheet(`${programmeHtml(r.programme, r.channel ? `${r.channel.number} ${r.channel.name}` : "Upcoming")}<div class="actions"><button class="primary" id="s-rec">Record</button></div><button class="link" data-close>Close</button>`);
              $("s-rec").onclick = () => post("/api/recordings", { programmeId: r.programme.id }).then(() => (toast(`Recording ${r.programme.title}`), closeSheet()), (e) => toast(e.message, true));
            }
          };
        }
      } catch (e) {
        $("search-results").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
      }
    };
    q.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(run, 350);
    });
    $("search-form").addEventListener("submit", (e) => {
      e.preventDefault();
      q.blur();
      run();
    });
    q.focus();
  }

  // ---------------------------------------------------------------------------
  // Features switched off on the TV (issue #124): the remote follows the TV it works, so what's
  // off there goes from here too. The TV refuses them anyway; this just doesn't offer them.

  const FEATURE_PARTS = {
    live: ['[data-key="guide"]', '[data-browse="guide"]', '[data-key="channelUp"]', '[data-key="channelDown"]'],
    films: ['[data-browse="movie"]'],
    shows: ['[data-browse="series"]'],
    recordings: ['[data-browse="recordings"]', '[data-key="record"]'],
    downloads: ['[data-browse="downloads"]'],
    music: ['[data-browse="music"]'],
    weather: ['[data-browse="weather"]'],
    search: ['[data-browse="search"]', "#text"],
    cast: ["#cast-btn"],
    clips: ["#scare-btn"],
    notifications: ["#news-btn", "#notify-btn"],
  };
  async function loadFeatures() {
    const r = await fetch("/api/features?client=remote").catch(() => null);
    if (!r || !r.ok) return;
    const off = new Set((await r.json().catch(() => ({}))).off || []);
    for (const [id, parts] of Object.entries(FEATURE_PARTS)) {
      for (const sel of parts) for (const el of document.querySelectorAll(sel)) el.toggleAttribute("data-feature-off", off.has(id));
    }
    // The Watch tab opens on the first list still showing.
    if (document.querySelector(`[data-browse="${current}"]`)?.hasAttribute("data-feature-off")) {
      const first = [...document.querySelectorAll("[data-browse]")].find((c) => !c.hasAttribute("data-feature-off"));
      if (first) {
        for (const x of document.querySelectorAll("[data-browse]")) x.classList.toggle("on", x === first);
        current = first.dataset.browse;
        if (browsed) show(current);
      }
    }
  }
  void loadFeatures();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void loadFeatures());
})();
