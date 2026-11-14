/* UltimateTV for Samsung TVs: the screens. Same look and the same Hub calls as the other TV
   clients (docs/samsung.md). Plain ES2015, because the 2018 sets run Chromium 56. */
(function (UTV) {
  "use strict";

  var Hub = UTV.Hub;
  var Nav = UTV.Nav;
  var VERSION = "0.1.0";
  var app = document.getElementById("app");
  var host = document.getElementById("av-host");

  // ------------------------------------------------------------------ helpers

  /** h("div", {class: "x", onclick: fn}, [children or text]) */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "style") e.setAttribute("style", v);
      else e.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  /** A focusable element: the arrow keys reach it and OK runs `act`. */
  function focusable(el, act) {
    el.className += " f";
    el.setAttribute("tabindex", "-1");
    el.onactivate = act;
    el.onclick = act;
    return el;
  }
  function button(label, act, primary) { return focusable(h("button", { class: "btn" + (primary ? " primary" : ""), text: label }), act); }

  var toastTimer = 0;
  function toast(message, ms) {
    var old = document.querySelector(".toast");
    if (old) old.parentNode.removeChild(old);
    var t = h("div", { class: "toast", text: message });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 4500);
  }

  function setRem() {
    document.documentElement.style.fontSize = (window.innerWidth / 120) + "px";
  }
  window.addEventListener("resize", setRem);
  setRem();

  function applyTheme() {
    return Hub.theme().then(function (t) {
      UTV.applyPalette(document.documentElement.style, t.palette);
      try { localStorage.setItem("utv.samsung.theme", JSON.stringify(t.palette)); } catch (e) { /* fine */ }
    }, function () {
      try { UTV.applyPalette(document.documentElement.style, JSON.parse(localStorage.getItem("utv.samsung.theme") || "{}")); } catch (e) { /* default dark */ }
    });
  }

  // ------------------------------------------------------------------ router

  var current = null; // {name, params, el, key}
  var stack = [];
  var baseKey = null;

  function render(name, params) {
    if (current && current.destroy) current.destroy();
    var s = SCREENS[name](params || {});
    s.name = name;
    s.params = params || {};
    current = s;
    app.innerHTML = "";
    app.appendChild(s.el);
    baseKey = s.key || null;
    Nav.handle(onScreenKey);
    if (s.start) s.start();
    setTimeout(function () { if (s.focus) s.focus(); else Nav.focusFirst(app); }, 0);
    return s;
  }
  function onScreenKey(action, e) {
    if (current && current.key && current.key(action, e) === true) return true;
    if (action === "back") { back(); return true; }
    if (action === "exit") { exitApp(); return true; }
    return false;
  }
  function go(name, params) {
    if (current && !current.root) stack.push({ name: current.name, params: current.params });
    else if (current && current.root) stack.push({ name: current.name, params: current.params });
    render(name, params);
  }
  /** Replace the screen without leaving a way back to it (the top-bar tabs, signing in). */
  function swap(name, params, fresh) {
    if (fresh) stack = [];
    render(name, params);
  }
  function back() {
    var prev = stack.pop();
    if (prev) render(prev.name, prev.params);
    else exitApp();
  }
  function exitApp() {
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* in a desktop browser */ }
  }

  function failed(e) {
    if (e && e.status === 401 && e.code === "pair") {
      Hub.state.token = "";
      swap("connect", {}, true);
      return;
    }
    toast((e && e.message) || "Something went wrong");
  }

  // ------------------------------------------------------------------ top bar

  var TABS = [
    { label: "Home", name: "home" },
    { label: "TV Guide", name: "guide" },
    { label: "Films", name: "browse", params: { kind: "movie" } },
    { label: "TV Shows", name: "browse", params: { kind: "series" } },
    { label: "Recordings", name: "recordings" },
    { label: "Search", name: "search" },
    { label: "Settings", name: "settings" },
  ];
  var profileCache = { name: "", colour: "" };

  function topbar(active) {
    var tabs = h("div", { class: "tabs" });
    TABS.forEach(function (t) {
      var on = t.name === active.name && (!t.params || t.params.kind === active.kind);
      var el = focusable(h("button", { class: "tab" + (on ? " active" : ""), text: t.label }), function () {
        if (!on) swap(t.name, t.params, true);
      });
      el.setAttribute("data-tab", on ? "1" : "");
      tabs.appendChild(el);
    });
    var who = focusable(h("button", { class: "who", text: (profileCache.name || "?").charAt(0).toUpperCase(), style: profileCache.colour ? "background:" + profileCache.colour : "" }), function () { go("profiles", {}); });
    var clock = h("div", { class: "clock", text: UTV.clock(Date.now()) });
    return h("div", { class: "topbar" }, [
      h("div", { class: "brand" }, [h("div", { class: "brand-mark", text: "▶" }), h("span", { text: "UltimateTV" })]),
      tabs,
      h("div", { class: "topbar-right" }, [clock, who]),
    ]);
  }
  setInterval(function () {
    var c = document.querySelector(".clock");
    if (c) c.textContent = UTV.clock(Date.now());
  }, 20000);

  /** A screen with the top bar over `body`; ArrowUp from the first row of the body reaches the tabs. */
  function withBar(active, body) {
    return h("div", { class: "page" }, [topbar(active), body]);
  }

  // ------------------------------------------------------------------ cards and rails

  function imgFor(url) { return Hub.img(url); }

  function loadImages(root) {
    var imgs = root.querySelectorAll("img[data-src]");
    for (var i = 0; i < imgs.length; i++) { imgs[i].src = imgs[i].getAttribute("data-src"); imgs[i].removeAttribute("data-src"); }
  }
  UTV.onRailFocus = function (rail) {
    loadImages(rail);
    var next = rail.nextElementSibling;
    if (next && next.hasAttribute("data-rail")) loadImages(next);
  };

  function art(url, fallbackText, eager) {
    var box = h("div", { class: "card-art" }, [h("div", { class: "card-fallback", text: UTV.clip(fallbackText, 40) })]);
    if (url) {
      var img = h("img", { alt: "" });
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
      if (eager) img.src = imgFor(url); else img.setAttribute("data-src", imgFor(url));
      box.appendChild(img);
    }
    return box;
  }

  function titleCard(t, wide, eager) {
    var image = wide ? (t.backdrop || t.poster) : t.poster;
    var a = art(image, t.name, eager);
    if (t.progress > 0 && t.progress < 1) a.appendChild(h("div", { class: "bar" }, [h("i", { style: "width:" + Math.round(t.progress * 100) + "%" })]));
    var card = h("button", { class: "card " + (wide ? "card-wide" : "card-poster") }, [a, h("div", { class: "card-label" }, [h("div", { class: "card-title", text: t.name }), h("div", { class: "card-sub", text: UTV.titleSub(t) })])]);
    return focusable(card, function () { openTitle(t); });
  }
  function channelCard(n, eager) {
    var c = n.channel;
    var a = h("div", { class: "card-art" }, [h("div", { class: "card-fallback", text: c.name })]);
    if (c.logo) {
      var img = h("img", { alt: "" });
      if (eager) img.src = imgFor(c.logo); else img.setAttribute("data-src", imgFor(c.logo));
      a.appendChild(h("div", { class: "logo-card" }, [img]));
    }
    a.appendChild(h("div", { class: "card-badge live", text: "LIVE" }));
    var pr = n.now;
    if (pr) a.appendChild(h("div", { class: "bar" }, [h("i", { style: "width:" + Math.max(0, Math.min(100, ((Date.now() - pr.start) / (pr.end - pr.start)) * 100)) + "%" })]));
    var card = h("button", { class: "card card-wide" }, [a, h("div", { class: "card-label" }, [h("div", { class: "card-title", text: (c.number ? c.number + "  " : "") + c.name }), h("div", { class: "card-sub", text: n.now ? n.now.title : "" })])]);
    return focusable(card, function () { playChannel(c.id); });
  }
  function recordingCard(r, eager) {
    var a = art(r.programme && r.programme.image, r.programme ? r.programme.title : "Recording", eager);
    var card = h("button", { class: "card card-wide" }, [a, h("div", { class: "card-label" }, [h("div", { class: "card-title", text: r.programme ? r.programme.title : "Recording" }), h("div", { class: "card-sub", text: r.channelName || "" })])]);
    return focusable(card, function () { playRecording(r); });
  }

  function rail(title, cards, idx) {
    var track = h("div", { class: "rail-track scroll-x" }, cards);
    var r = h("div", { class: "rail", "data-rail": String(idx) }, [h("div", { class: "rail-title", text: title }), track]);
    if (idx < 2) loadImages(r);
    return r;
  }

  function railFor(r, idx) {
    var wide = r.id === "continue" || r.id === "nextup" || r.id === "new-episodes";
    var eager = idx < 2;
    var cards = [];
    if (r.kind === "channels") (r.channels || []).slice(0, 30).forEach(function (n) { cards.push(channelCard(n, eager)); });
    else if (r.kind === "recordings") (r.recordings || []).slice(0, 30).forEach(function (x) { cards.push(recordingCard(x, eager)); });
    else if (r.kind === "titles") (r.items || []).slice(0, 30).forEach(function (t) { cards.push(titleCard(t, wide, eager)); });
    return cards.length ? rail(r.title, cards, idx) : null;
  }

  function openTitle(t) {
    if (t.kind === "series" && t.episodeId && t.progress > 0) {
      // Continue watching on a series: the details page names the episode that carries on.
    }
    go("details", { id: t.id });
  }

  // ------------------------------------------------------------------ screens

  var SCREENS = {};

  function busy(message) {
    return h("div", { class: "center" }, [h("div", { class: "spinner" }), h("p", { text: message || "", style: "margin-top:1.6rem" })]);
  }

  /** The scrolling body most screens hang off the top bar. */
  function scroller() { return h("div", { class: "screen scroll-y" }); }

  // ---- connect / pair
  SCREENS.connect = function () {
    var title = h("h1", { text: "Connecting to your Hub" });
    var msg = h("p", { text: Hub.hub });
    var code = h("div", { class: "code hidden" });
    var err = h("div", { class: "err" });
    var actions = h("div", { class: "row-actions", style: "display:flex" });
    var el = h("div", { class: "center" }, [title, msg, code, err, actions]);
    var cancelled = false;
    function addButtons() {
      actions.innerHTML = "";
      actions.appendChild(button("Try again", function () { attempt(); }, true));
      actions.appendChild(button("Change Hub address", function () { go("hubaddress", {}); }));
      Nav.focusFirst(actions);
    }
    function attempt() {
      actions.innerHTML = "";
      err.textContent = "";
      msg.textContent = Hub.hub;
      Hub.health().then(function () {
        if (Hub.paired) return done();
        return Hub.pair("Samsung TV", function (c) {
          title.textContent = "Let this TV in";
          code.textContent = c;
          code.className = "code";
          msg.textContent = "On the main TV open Settings › Phones and remotes and allow “Samsung TV”. Check it shows this code.";
        }, function () { return cancelled; }).then(done);
      }).then(null, function (e) {
        if (cancelled) return;
        title.textContent = "Can't connect";
        code.className = "code hidden";
        err.textContent = e.message;
        msg.textContent = "Check that the Hub is running and this TV is on the same network.";
        addButtons();
      });
    }
    function done() { cancelled = true; swap("profiles", { first: true }, true); }
    return { el: el, start: attempt, destroy: function () { cancelled = true; }, key: function (a) { return a === "back" ? true : false; } };
  };

  // ---- Hub address
  SCREENS.hubaddress = function () {
    return textEntry({ title: "Hub address", hint: "For example 192.168.0.19:8095", value: Hub.hub.replace(/^http:\/\//, ""), kind: "url", done: function (v) {
      var u = UTV.normaliseHub(v);
      if (!u) { toast("That isn't an address"); return false; }
      Hub.setHub(u);
      swap("connect", {}, true);
      return true;
    } });
  };

  // ---- on-screen keyboard
  var KB_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm.:-"];

  function keyboard(opts) {
    var value = opts.value || "";
    var input = h("div", { class: "kb-input" });
    function paint() {
      input.textContent = value || opts.placeholder || "";
      input.className = "kb-input" + (value ? "" : " dim");
    }
    function set(v) { value = v; paint(); if (opts.onChange) opts.onChange(value); }
    var el = h("div", { class: "kb" }, [input]);
    KB_ROWS.forEach(function (row) {
      var r = h("div", { class: "kb-row" });
      row.split("").forEach(function (c) { r.appendChild(focusable(h("button", { class: "key", text: c }), function () { set(value + c); })); });
      el.appendChild(r);
    });
    var last = h("div", { class: "kb-row" }, [
      focusable(h("button", { class: "key wider", text: "Space" }), function () { if (value && value.slice(-1) !== " ") set(value + " "); }),
      focusable(h("button", { class: "key wide", text: "⌫" }), function () { set(value.slice(0, -1)); }),
      focusable(h("button", { class: "key wide", text: "Clear" }), function () { set(""); }),
    ]);
    el.appendChild(last);
    if (opts.extra) el.appendChild(h("div", { class: "kb-row" }, opts.extra));
    paint();
    return { el: el, get value() { return value; }, set: set };
  }

  function textEntry(o) {
    var kb = keyboard({ value: o.value });
    var ok = focusable(h("button", { class: "key wider", text: "Done" }), function () { if (o.done(kb.value) !== false && o.after) o.after(); });
    ok.className += " hidden-key";
    kb.el.appendChild(h("div", { class: "kb-row" }, [ok]));
    var el = h("div", { class: "center" }, [h("h1", { text: o.title }), h("p", { text: o.hint || "" }), kb.el]);
    return { el: el };
  }

  // ---- who's watching
  SCREENS.profiles = function (p) {
    var box = h("div", { class: "profiles" });
    var title = h("h1", { text: "Who's watching?" });
    var err = h("div", { class: "err" });
    var el = h("div", { class: "center" }, [title, err, box]);
    function pick(profile) {
      if (profile.hasPin) { go("pin", { profile: profile }); return; }
      Hub.chooseProfile(profile).then(function () { enter(profile); }, failed);
    }
    function enter(profile) {
      profileCache = { name: profile.name, colour: profile.colour };
      swap("home", {}, true);
    }
    SCREENS.profiles.enter = enter;
    return {
      el: el,
      start: function () {
        Hub.profiles().then(function (r) {
          var list = r.profiles || [];
          if (!list.length) { swap("home", {}, true); return; }
          // Carry on as the profile last used, unless it needs its PIN.
          var mine = null;
          list.forEach(function (x) { if (x.id === Hub.profileId) mine = x; });
          if (p.first && mine && (!mine.hasPin || Hub.state.profileToken)) { enter(mine); return; }
          if (p.first && list.length === 1 && !list[0].hasPin) { pick(list[0]); return; }
          list.forEach(function (x) {
            box.appendChild(focusable(h("button", { class: "profile" }, [h("div", { class: "avatar", text: x.name.charAt(0).toUpperCase(), style: "background:" + (x.colour || "var(--accent)") }), h("div", { class: "pname", text: x.name })]), function () { pick(x); }));
          });
          Nav.focusFirst(box);
        }, function (e) { if (e.status === 401) failed(e); else { err.textContent = e.message; box.appendChild(button("Try again", function () { swap("profiles", p, true); }, true)); Nav.focusFirst(box); } });
      },
      focus: function () {},
    };
  };

  SCREENS.pin = function (p) {
    var digits = "";
    var dots = h("div", { class: "pin" });
    var err = h("div", { class: "err" });
    function paint() { dots.innerHTML = ""; for (var i = 0; i < 4; i++) dots.appendChild(h("i", { class: i < digits.length ? "on" : "" })); }
    function submit() {
      Hub.chooseProfile(p.profile, digits).then(function () {
        profileCache = { name: p.profile.name, colour: p.profile.colour };
        swap("home", {}, true);
      }, function (e) { digits = ""; paint(); err.textContent = e.message || "That PIN isn't right"; });
    }
    function add(d) { if (digits.length >= 8) return; digits += d; paint(); err.textContent = ""; if (digits.length === 4) submit(); }
    var grid = h("div", { class: "kb pad-grid" });
    [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["⌫", "0", "OK"]].forEach(function (row) {
      var r = h("div", { class: "kb-row" });
      row.forEach(function (c) {
        r.appendChild(focusable(h("button", { class: "key", text: c }), function () {
          if (c === "⌫") { digits = digits.slice(0, -1); paint(); } else if (c === "OK") { if (digits) submit(); } else add(c);
        }));
      });
      grid.appendChild(r);
    });
    paint();
    var el = h("div", { class: "center" }, [h("h1", { text: p.profile.name }), h("p", { text: "Enter your PIN" }), dots, err, grid]);
    return { el: el, key: function (a, e) { if (a === "back") { back(); return true; } var d = e && e.keyCode >= 48 && e.keyCode <= 57 ? String(e.keyCode - 48) : null; if (d) { add(d); return true; } return false; }, focus: function () { Nav.focus(grid.querySelector(".f")); } };
  };

  // ---- Home
  SCREENS.home = function () {
    var body = scroller();
    var page = withBar({ name: "home" }, body);
    body.appendChild(busy("Loading…"));
    var scroll = h("div", {});
    return {
      el: page, root: true,
      start: function () {
        applyTheme();
        Hub.home().then(function (home) {
          body.innerHTML = "";
          if (home.hero) body.appendChild(heroBlock(home.hero));
          var idx = 0;
          (home.rails || []).forEach(function (r) { var el = railFor(r, idx); if (el) { body.appendChild(el); idx++; } });
          if (!body.children.length) body.appendChild(h("div", { class: "empty", text: "Nothing to show yet. Check the Hub has a library or TV channels set up." }));
          void scroll;
          Nav.focusFirst(body);
        }, function (e) { body.innerHTML = ""; body.appendChild(h("div", { class: "empty", text: e.message })); failed(e); });
      },
      focus: function () {},
      key: function (a) { return a === "back" ? (exitApp(), true) : false; },
    };
  };

  function heroBlock(hero) {
    var label = hero.action === "resume" ? "Resume" : hero.action === "live" ? "Watch live" : "Watch";
    var more = hero.action === "live" ? null : button("More info", function () { go("details", { id: hero.id }); });
    var primary = button(label, function () {
      if (hero.action === "live") playChannel(hero.id);
      else if (hero.episodeId) playTitle(hero.id, hero.episodeId);
      else playTitle(hero.id);
    }, true);
    var bg = hero.backdrop || hero.poster;
    return h("div", { class: "hero" }, [
      bg ? h("div", { class: "hero-img", style: "background-image:url('" + imgFor(bg).replace(/'/g, "%27") + "')" }) : null,
      h("div", { class: "hero-shade" }),
      h("div", { class: "hero-body" }, [
        h("div", { class: "hero-kicker", text: hero.action === "resume" ? "Continue watching" : hero.action === "live" ? "On now" : "Featured" }),
        h("div", { class: "hero-title", text: hero.name }),
        h("div", { class: "hero-text", text: UTV.clip(hero.overview || hero.subtitle || "", 220) }),
        h("div", {}, [primary, more]),
      ]),
    ]);
  }

  // ---- Films / TV Shows
  SCREENS.browse = function (p) {
    var body = scroller();
    var page = withBar({ name: "browse", kind: p.kind }, body);
    body.appendChild(busy("Loading…"));
    return {
      el: page, root: true,
      start: function () {
        Hub.browse(p.kind).then(function (r) {
          body.innerHTML = "";
          var idx = 0;
          (r.rails || []).forEach(function (x) { var el = railFor(x, idx); if (el) { body.appendChild(el); idx++; } });
          if (!idx) body.appendChild(h("div", { class: "empty", text: "Nothing here yet." }));
          Nav.focusFirst(body);
        }, function (e) { body.innerHTML = ""; failed(e); });
      },
      focus: function () {}, key: function (a) { return a === "back" ? (swap("home", {}, true), true) : false; },
    };
  };

  // ---- Guide
  SCREENS.guide = function () {
    var body = scroller();
    var page = withBar({ name: "guide" }, body);
    body.appendChild(busy("Loading the guide…"));
    var items = [];
    var cat = "All";
    function draw() {
      body.innerHTML = "";
      var cats = ["All"];
      if (items.some(function (n) { return n.channel.favourite; })) cats.push("Favourites");
      items.forEach(function (n) { var c = n.channel.userCategory || n.channel.category; if (c && cats.indexOf(c) < 0) cats.push(c); });
      var chips = h("div", { class: "chips scroll-x" });
      cats.forEach(function (c) { chips.appendChild(focusable(h("button", { class: "chip" + (c === cat ? " on" : ""), text: c }), function () { cat = c; draw(); setTimeout(function () { Nav.focusFirst(body); }, 0); })); });
      body.appendChild(chips);
      var list = h("div", { class: "list" });
      var shown = items.filter(function (n) { return cat === "All" || (cat === "Favourites" ? n.channel.favourite : (n.channel.userCategory || n.channel.category) === cat); }).slice(0, 150);
      UTV.liveList = shown.map(function (n) { return n.channel; });
      shown.forEach(function (n) {
        var now = n.now;
        var pct = now ? Math.max(0, Math.min(100, ((Date.now() - now.start) / (now.end - now.start)) * 100)) : 0;
        var row = h("button", { class: "row" }, [
          h("div", { class: "num", text: n.channel.number || "" }),
          h("div", { class: "logo" }, n.channel.logo ? [h("img", { src: imgFor(n.channel.logo), alt: "" })] : []),
          h("div", { class: "name", text: n.channel.name }),
          h("div", { class: "now" }, [h("b", { text: now ? now.title : "No guide data" }), now ? h("div", { class: "pbar" }, [h("i", { style: "width:" + pct + "%" })]) : null]),
          h("div", { class: "next", text: n.next ? UTV.clock(n.next.start) + "  " + n.next.title : "" }),
        ]);
        list.appendChild(focusable(row, function () { playChannel(n.channel.id); }));
      });
      if (!shown.length) list.appendChild(h("div", { class: "empty", text: "No channels in this list." }));
      body.appendChild(list);
    }
    return {
      el: page, root: true,
      start: function () {
        Hub.nowNext().then(function (r) { items = r.items || []; draw(); var first = body.querySelector(".list .f"); Nav.focus(first || body.querySelector(".f")); }, failed);
      },
      focus: function () {}, key: function (a) { return a === "back" ? (swap("home", {}, true), true) : false; },
    };
  };

  // ---- Recordings
  SCREENS.recordings = function () {
    var body = scroller();
    var page = withBar({ name: "recordings" }, body);
    body.appendChild(busy("Loading…"));
    var LABEL = { completed: "", recording: "Recording now", scheduled: "Scheduled", processing: "Finishing", "waiting-catchup": "Waiting for catch-up", failed: "Failed" };
    return {
      el: page, root: true,
      start: function () {
        Hub.recordings().then(function (r) {
          body.innerHTML = "";
          var list = h("div", { class: "list" });
          var recs = (r.recordings || []).slice().sort(function (a, b) { return (b.programme ? b.programme.start : 0) - (a.programme ? a.programme.start : 0); });
          recs.forEach(function (x) {
            var pr = x.programme || {};
            var ok = x.status === "completed" || x.status === "recording";
            var row = h("button", { class: "row ep" }, [
              h("div", { class: "still", style: pr.image ? "background-image:url('" + imgFor(pr.image).replace(/'/g, "%27") + "')" : "" }),
              h("div", { class: "now" }, [h("b", { text: pr.title || "Recording" }), h("span", { text: [x.channelName, pr.start ? new Date(pr.start).toLocaleDateString() + " " + UTV.clock(pr.start) : "", LABEL[x.status] || ""].filter(Boolean).join("  ·  ") })]),
            ]);
            list.appendChild(focusable(row, function () { if (ok) playRecording(x); else toast(LABEL[x.status] || "Not ready yet"); }));
          });
          if (!recs.length) list.appendChild(h("div", { class: "empty", text: "No recordings yet. Record from the TV Guide on the main TV or your phone." }));
          body.appendChild(list);
          Nav.focusFirst(list);
        }, failed);
      },
      focus: function () {}, key: function (a) { return a === "back" ? (swap("home", {}, true), true) : false; },
    };
  };

  // ---- Search
  SCREENS.search = function () {
    var results = h("div", { class: "results" });
    var timer = 0;
    var seq = 0;
    function run(q) {
      clearTimeout(timer);
      if (!q || q.length < 2) { results.innerHTML = ""; return; }
      timer = setTimeout(function () {
        var mine = ++seq;
        Hub.search(q).then(function (r) {
          if (mine !== seq) return;
          results.innerHTML = "";
          var cards = [];
          (r.results || []).slice(0, 24).forEach(function (x) {
            var card = null;
            if (x.kind === "title" && x.title) card = titleCard(x.title, false, true);
            else if (x.kind === "recording" && x.recording) card = recordingCard(x.recording, true);
            else if ((x.kind === "channel" || x.kind === "on-now") && x.channel) card = channelCard({ channel: x.channel, now: x.programme }, true);
            if (card) cards.push(card);
          });
          if (!cards.length) results.appendChild(h("div", { class: "empty", style: "padding-left:0", text: "Nothing found for “" + q + "”" }));
          else results.appendChild(h("div", { class: "rail-track" }, cards));
        }, failed);
      }, 450);
    }
    var kb = keyboard({ placeholder: "Search films, shows, channels…", onChange: run });
    var body = h("div", { class: "screen" }, [h("div", { class: "search" }, [kb.el, results])]);
    return { el: withBar({ name: "search" }, body), root: true, focus: function () { Nav.focus(kb.el.querySelector(".f")); }, key: function (a) { return a === "back" ? (swap("home", {}, true), true) : false; } };
  };

  // ---- Details
  SCREENS.details = function (p) {
    var area = h("div", { class: "details" });
    var el = h("div", { class: "page" }, [topbar({ name: "" }), area]);
    area.appendChild(busy("Loading…"));
    var season = 0;
    var details = null;
    function paint() {
      var t = details;
      area.innerHTML = "";
      area.style.top = "6.5rem";
      var bg = t.backdrop || t.poster;
      var series = t.kind === "series" && t.seasons && t.seasons.length;
      area.appendChild(h("div", { class: "details-bg", style: bg ? "background-image:url('" + imgFor(bg).replace(/'/g, "%27") + "')" : "" }));
      area.appendChild(h("div", { class: "details-shade" }));
      var facts = [t.year, t.certification ? h("b", { text: t.certification }) : null, t.runtimeMin ? UTV.runtime(t.runtimeMin) : null, (t.genres || []).slice(0, 3).join(", "), t.rating ? "★ " + t.rating.toFixed(1) : null].filter(function (x) { return x != null && x !== ""; });
      var factsEl = h("div", { class: "facts" });
      facts.forEach(function (f, i) { if (i) factsEl.appendChild(document.createTextNode("   ·   ")); factsEl.appendChild(typeof f === "object" ? f : document.createTextNode(String(f))); });
      var play = playButton(t);
      var buttons = h("div", {}, [play]);
      area.appendChild(h("div", { class: "details-main" }, [
        h("div", { class: "details-poster", style: t.poster ? "background-image:url('" + imgFor(t.poster).replace(/'/g, "%27") + "')" : "" }),
        h("div", { class: "details-info" }, [h("h1", { text: t.name }), factsEl, h("div", { class: "overview", text: t.overview || "" }), buttons]),
      ]));
      if (series) {
        var sa = h("div", { class: "seasons-area" });
        var chips = h("div", { class: "chips scroll-x" });
        t.seasons.forEach(function (s, i) { chips.appendChild(focusable(h("button", { class: "chip" + (i === season ? " on" : ""), text: s.name || "Season " + s.season }), function () { season = i; paint(); setTimeout(function () { Nav.focus(area.querySelector(".chip.on")); }, 0); })); });
        sa.appendChild(chips);
        var list = h("div", { class: "list scroll-y", style: "position:absolute;left:0;right:0;top:3.6rem;bottom:0" });
        (t.seasons[season].episodes || []).forEach(function (ep) {
          var row = h("button", { class: "row ep" }, [
            h("div", { class: "still", style: ep.still ? "background-image:url('" + imgFor(ep.still).replace(/'/g, "%27") + "')" : "" }, ep.progress > 0 && ep.progress < 1 ? [h("div", { class: "bar" }, [h("i", { style: "width:" + Math.round(ep.progress * 100) + "%" })])] : []),
            h("div", { class: "now" }, [h("b", { text: ep.episode + ". " + ep.name + (ep.watched ? "  ✓" : "") }), h("span", { text: UTV.clip(ep.overview || "", 160) })]),
          ]);
          list.appendChild(focusable(row, function () { playTitle(t.id, "s" + ep.season + "e" + ep.episode); }));
        });
        sa.appendChild(list);
        area.appendChild(sa);
      }
    }
    function playButton(t) {
      var episode = t.kind === "series" ? (t.episodeId || (t.seasons && t.seasons[0] && t.seasons[0].episodes[0] ? "s" + t.seasons[0].episodes[0].season + "e" + t.seasons[0].episodes[0].episode : undefined)) : undefined;
      var label = t.resumeMs > 5000 ? "Resume from " + UTV.duration(t.resumeMs / 1000) : t.kind === "series" && t.episodeId ? "Play " + t.episodeId.toUpperCase().replace("S", "S").replace("E", " E") : "Play";
      return button(label, function () { playTitle(t.id, episode); }, true);
    }
    return {
      el: el,
      start: function () {
        Hub.title(p.id).then(function (t) {
          details = t;
          if (t.seasons && t.episodeId) { var m = /^s(\d+)e/.exec(t.episodeId); if (m) t.seasons.forEach(function (s, i) { if (s.season === Number(m[1])) season = i; }); }
          paint();
          Nav.focus(area.querySelector(".btn"));
        }, function (e) { area.innerHTML = ""; area.appendChild(h("div", { class: "empty", text: e.status === 403 ? "This isn't available on this profile." : e.message })); failed(e); });
      },
      focus: function () {},
    };
  };

  // ---- Settings
  SCREENS.settings = function () {
    var body = scroller();
    var page = withBar({ name: "settings" }, body);
    var list = h("div", { class: "settings" });
    function row(label, small, act) { var r = focusable(h("button", { class: "setting" }, [h("span", { text: label }), h("small", { text: small || "" })]), act); list.appendChild(r); return r; }
    row("Hub address", Hub.hub, function () { go("hubaddress", {}); });
    row("Who's watching", profileCache.name, function () { go("profiles", {}); });
    var q = row("Picture quality", Hub.state.maxHeight === 1080 ? "Up to 1080p" : "Up to 4K", function () {
      Hub.setMaxHeight(Hub.state.maxHeight === 1080 ? 2160 : 1080);
      q.lastChild.textContent = Hub.state.maxHeight === 1080 ? "Up to 1080p" : "Up to 4K";
    });
    row("Check the Hub", "", function () { Hub.health().then(function (r) { toast("Hub " + (r.version || "") + (r.status ? " · " + r.status : " · reachable")); }, failed); });
    row("Unpair this TV", "", function () { Hub.forget().then(function () { swap("connect", {}, true); }); });
    row("About", "UltimateTV for Samsung TVs " + VERSION, function () { toast("UltimateTV for Samsung TVs " + VERSION + (window.webapis && webapis.avplay ? " · AVPlay" : " · desktop browser")); });
    body.appendChild(list);
    return { el: page, root: true, focus: function () { Nav.focus(list.querySelector(".f")); }, key: function (a) { return a === "back" ? (swap("home", {}, true), true) : false; } };
  };

  // ------------------------------------------------------------------ playing

  var playing = false;

  function playChannel(id) { startPlay({ kind: "channel", id: id }, { live: true, channelId: id }); }
  function playTitle(id, episodeId) { startPlay(episodeId ? { kind: "title", id: id, episodeId: episodeId } : { kind: "title", id: id }, {}); }
  function playRecording(r) { startPlay({ kind: "recording", id: r.id }, {}); }

  function startPlay(request, meta, force) {
    if (playing) return;
    toast("Starting…", 20000);
    Hub.play(force ? Object.assign({ force: true }, request) : request).then(function (info) {
      var t = document.querySelector(".toast");
      if (t && t.parentNode) t.parentNode.removeChild(t);
      if (info.warning && !force) { askWarning(info.warning, function () { startPlay(request, meta, true); }); return; }
      runPlayer(info, request, meta);
    }, function (e) { var t = document.querySelector(".toast"); if (t && t.parentNode) t.parentNode.removeChild(t); failed(e); });
  }

  function askWarning(text, yes) {
    toast(text + "  Press OK again to go ahead.", 6000);
    var armed = Nav.handle;
    void armed;
    pendingConfirm = yes;
    setTimeout(function () { pendingConfirm = null; }, 6000);
  }
  var pendingConfirm = null;

  function runPlayer(info, request, meta) {
    playing = true;
    var prevScreen = current;
    document.documentElement.classList.add("playing");
    app.classList.add("hidden");
    var root = h("div", { id: "player" });
    document.body.appendChild(root);
    var player = UTV.makePlayer(host);
    var top = h("div", { class: "p-top" }, [h("h2", { text: info.title || "" }), h("div", { text: info.subtitle || (info.source ? info.source.label : "") })]);
    var fill = h("i");
    var tPos = h("span", { text: "0:00" });
    var tEnd = h("span", { text: info.live ? "LIVE" : "" });
    var bottom = h("div", { class: "p-bottom" }, [h("div", { class: "p-bar" }, [fill]), h("div", { class: "p-times" }, [tPos, tEnd]), h("div", { class: "p-hint", text: info.live ? "▲ Info    ▼ Audio and subtitles    CH ↕ Change channel    Back to leave" : "◄ ► Skip 10 s    ▼ Audio and subtitles    Back to leave" })]);
    var state = h("div", { class: "p-state hidden", text: "❚❚" });
    var skipBox = h("div", { class: "p-skip hidden" });
    var subEl = h("div", { class: "p-sub" });
    var spin = h("div", { class: "spinner", style: "position:absolute;left:50%;top:50%;margin:-2rem 0 0 -2rem" });
    [top, bottom, state, skipBox, subEl, spin].forEach(function (n) { root.appendChild(n); });
    var menu = null;
    var hideTimer = 0;
    var overlayOn = true;
    var ticker = 0;
    var lastReport = 0;
    var skipNow = null;
    var subTimer = 0;
    var ended = false;
    var finished = false;

    function overlay(on) {
      overlayOn = on;
      top.style.opacity = bottom.style.opacity = on ? "1" : "0";
      clearTimeout(hideTimer);
      if (on) hideTimer = setTimeout(function () { if (!menu) overlay(false); }, 4500);
    }
    function paint() {
      var pos = player.positionMs, dur = player.durationMs || info.durationMs || 0;
      tPos.textContent = UTV.duration(pos / 1000);
      if (!info.live) { tEnd.textContent = dur ? UTV.duration(dur / 1000) : ""; fill.style.width = dur ? Math.min(100, (pos / dur) * 100) + "%" : "0"; }
      var m = info.live ? null : UTV.skipAt(info.skip, pos);
      if (m !== skipNow) {
        skipNow = m;
        skipBox.innerHTML = "";
        if (m) { skipBox.appendChild(h("div", { class: "btn primary", text: "OK  " + (UTV.SKIP_LABEL[m.kind] || "Skip") })); skipBox.className = "p-skip"; }
        else skipBox.className = "p-skip hidden";
      }
    }
    function report(event) {
      if (info.live || !info.progressKey) return;
      Hub.progress(info.progressKey, player.positionMs, player.durationMs || info.durationMs, event, player.paused);
    }
    function leave(reason) {
      if (finished) return;
      finished = true;
      clearInterval(ticker);
      clearTimeout(hideTimer);
      report("stop");
      player.close();
      if (root.parentNode) root.parentNode.removeChild(root);
      document.documentElement.classList.remove("playing");
      app.classList.remove("hidden");
      playing = false;
      Nav.handle(onScreenKey);
      if (prevScreen && prevScreen === current) Nav.restore();
      if (reason) toast(reason);
    }
    function playNext(req) {
      leave();
      startPlay({ kind: req.kind || "title", id: req.id, episodeId: req.episodeId }, {});
    }
    function seek(deltaMs) {
      if (info.live) return;
      var to = Math.max(0, player.positionMs + deltaMs);
      player.seekTo(to);
      overlay(true);
    }
    function setPaused(p) {
      if (p) player.pause(); else player.resume();
      state.className = "p-state" + (p ? "" : " hidden");
      state.textContent = "❚❚";
      overlay(true);
      report("progress");
    }
    function closeMenu() { if (menu && menu.parentNode) menu.parentNode.removeChild(menu); menu = null; overlay(true); Nav.handle(keys); }
    function openMenu() {
      var tr = player.tracks();
      menu = h("div", { class: "p-menu" });
      function item(label, small, act, on) {
        var r = focusable(h("button", { class: "setting" + (on ? " on" : "") }, [h("span", { text: label }), h("small", { text: small || "" })]), function () { act(); closeMenu(); });
        menu.appendChild(r);
      }
      menu.appendChild(h("h3", { text: "Subtitles" }));
      item("Off", "", function () { player.subtitlesOff(); subEl.textContent = ""; });
      tr.text.forEach(function (t, i) { item("Subtitles " + (i + 1), t.lang, function () { player.selectTrack("text", t.index); }); });
      (info.externalSubtitles || []).forEach(function (s) { item(s.label || s.lang, s.lang, function () { if (!player.externalSubtitle(s.url)) toast("This TV couldn't load that subtitle file"); }); });
      if (tr.audio.length > 1) {
        menu.appendChild(h("h3", { text: "Audio" }));
        tr.audio.forEach(function (t, i) { item("Track " + (i + 1), t.lang, function () { player.selectTrack("audio", t.index); }); });
      }
      root.appendChild(menu);
      overlay(true);
      Nav.focus(menu.querySelector(".f"));
      Nav.handle(function (a) { if (a === "back") { closeMenu(); return true; } return false; });
    }
    function channelStep(dir) {
      var list = UTV.liveList || [];
      var i = -1;
      list.forEach(function (c, n) { if (c.id === meta.channelId) i = n; });
      var next = list[i + dir];
      if (!next) return;
      leave();
      playChannel(next.id);
    }

    function keys(action) {
      switch (action) {
        case "back": case "stop": case "exit": leave(); return true;
        case "enter":
          if (skipNow) { player.seekTo(skipNow.endMs); overlay(true); return true; }
          setPaused(!player.paused); return true;
        case "playpause": setPaused(!player.paused); return true;
        case "play": setPaused(false); return true;
        case "pause": setPaused(true); return true;
        case "left": seek(-10000); return true;
        case "right": seek(10000); return true;
        case "rw": seek(-60000); return true;
        case "ff": seek(60000); return true;
        case "up": case "info": overlay(!overlayOn); return true;
        case "down": case "blue": openMenu(); return true;
        case "yellow": if (skipNow) { player.seekTo(skipNow.endMs); return true; } return true;
        case "chup": if (meta.live) channelStep(-1); return true;
        case "chdown": if (meta.live) channelStep(1); return true;
        default: return true;
      }
    }
    Nav.handle(keys);

    player.on("time", function () { paint(); });
    player.on("buffering", function (b) { spin.className = "spinner" + (b ? "" : " hidden"); spin.setAttribute("style", "position:absolute;left:50%;top:50%;margin:-2rem 0 0 -2rem"); });
    player.on("subtitle", function (text) { subEl.textContent = text || ""; clearTimeout(subTimer); subTimer = setTimeout(function () { subEl.textContent = ""; }, 5000); });
    player.on("error", function (e) { if (!ended) leave("This TV couldn't play that (" + e + "). Try another version on the main TV, or set Picture quality to 1080p."); });
    player.on("ended", function () {
      ended = true;
      report("stop");
      if (!info.live && info.next && info.next.id) playNext(info.next);
      else leave();
    });

    spin.setAttribute("style", "position:absolute;left:50%;top:50%;margin:-2rem 0 0 -2rem");
    player.load(info.url, info.live ? 0 : info.startMs || 0).then(function () {
      spin.className = "spinner hidden";
      overlay(true);
      report("start");
      ticker = setInterval(function () {
        paint();
        var now = Date.now();
        if (now - lastReport > 10000 && !player.paused) { lastReport = now; report("progress"); }
      }, 1000);
    }, function (e) { leave("This TV couldn't start that (" + (e && e.message ? e.message : e) + "). Try another version on the main TV, or set Picture quality to 1080p."); });
  }

  // ------------------------------------------------------------------ start

  UTV.start = function () {
    Nav.init();
    Nav.handle(onScreenKey);
    // Press OK a second time to confirm a Hub warning (a recording that would stop, say).
    document.addEventListener("keydown", function (e) { if (pendingConfirm && e.keyCode === 13 && !playing) { var f = pendingConfirm; pendingConfirm = null; f(); e.preventDefault(); } }, true);
    applyTheme();
    swap("connect", {}, true);
  };
  UTV.go = go;
})(window.UTV = window.UTV || {});
