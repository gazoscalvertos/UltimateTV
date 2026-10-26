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
      if (what === "music") await showMusic("playlists");
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
      <div class="actions">${d.kind === "movie" || !seasons.length ? `<button class="primary" id="s-play">${d.resumeMs ? `Resume from ${fmt(d.resumeMs)}` : "Play on TV"}</button>${d.resumeMs ? `<button id="s-start">From the start</button>` : ""}<button id="s-queue">Add to queue</button>` : ""}</div>
      ${seasons.length ? `<select id="s-season">${seasons.map((s, i) => `<option value="${i}">${esc(s.name || `Series ${s.season}`)}</option>`).join("")}</select><div class="list" id="s-eps"></div>` : ""}
      <button class="link" data-close>Close</button>`);
    if ($("s-play")) $("s-play").onclick = () => playOnTv({ kind: "title", id: d.id }, titleRef);
    if ($("s-start")) $("s-start").onclick = () => playOnTv({ kind: "title", id: d.id }, titleRef, true);
    const art = d.backdrop ?? d.poster;
    if ($("s-queue")) $("s-queue").onclick = () => queueIt({ req: { kind: "title", id: d.id }, title: titleRef, name: d.name, ...(d.year ? { subtitle: String(d.year) } : {}), ...(art ? { image: art } : {}) });
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
                (e, i) => `<div class="ep-row"><button class="item ep" data-ep="${i}"><span class="text"><b>${e.episode}. ${esc(e.name)}</b>${e.overview ? `<small>${esc(e.overview.slice(0, 140))}${e.overview.length > 140 ? "…" : ""}</small>` : ""}${e.progress ? `<i class="bar"><i style="width:${Math.round(e.progress * 100)}%"></i></i>` : ""}</span>${e.watched ? `<span class="tick">✓</span>` : ""}</button><button class="qbtn" data-q="${i}" aria-label="Add to queue">+</button></div>`,
              )
              .join("")
          : `<p class="empty">No episodes listed.</p>`;
        for (const b of $("s-eps").querySelectorAll("[data-ep]")) {
          const e = eps[Number(b.dataset.ep)];
          b.onclick = () => playOnTv({ kind: "title", id: d.id, episodeId: `s${e.season}e${e.episode}` }, titleRef);
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
        (r, i) => `<button class="item" data-recording="${i}"><span class="text"><b>${esc(r.programme.title)}${r.status === "recording" ? ` <em class="rec">● REC</em>` : ""}</b>
        ${r.programme.subtitle ? `<span>${esc(r.programme.subtitle)}</span>` : ""}<small>${esc(r.channelName)} · ${new Date(r.programme.start).toLocaleDateString([], { day: "numeric", month: "short" })} ${clock(r.programme.start)}${r.watched ? " · watched" : ""}</small></span></button>`,
      )
      .join("")}</div>`;
    for (const b of body.querySelectorAll("[data-recording]")) b.onclick = () => playOnTv({ kind: "recording", id: list[Number(b.dataset.recording)].id });
  }

  // Music: the Spotify library on the box.
  async function showMusic(kind) {
    body.innerHTML = `<div class="seg">${["playlists", "albums", "artists"].map((k) => `<button data-mk="${k}" class="${k === kind ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div><div id="music-list"><p class="empty">Loading…</p></div>`;
    for (const b of body.querySelectorAll("[data-mk]")) b.onclick = () => showMusic(b.dataset.mk);
    let page;
    try {
      page = await call("musicLibrary", { kind });
    } catch (e) {
      return ($("music-list").innerHTML = `<p class="empty">${esc(e.message)}</p>`);
    }
    if (!page.items.length) return ($("music-list").innerHTML = `<p class="empty">Nothing here. Sign in to Spotify in the TV's Music tab.</p>`);
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
})();
