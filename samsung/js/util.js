/* Small pure helpers for the Samsung TV app. Written in plain ES2015 because the 2018 sets
   (Tizen 4.0) run a Chromium 56 engine: no object spread, no optional chaining, no flex gap,
   no CSS grid. The same file is loaded by the tests in Node (module.exports at the bottom). */
(function (root) {
  "use strict";

  var DEFAULT_HUB = "http://192.168.0.19:8095";

  /** What someone typed for the Hub's address, made into `http://host:port`. Empty when it can't be one. */
  function normaliseHub(input) {
    var s = String(input == null ? "" : input).trim().replace(/\s+/g, "");
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "http://" + s;
    s = s.replace(/\/+$/, "");
    var m = /^(https?:\/\/)([^\/:?#]+)(:\d+)?(\/.*)?$/i.exec(s);
    if (!m) return "";
    var host = m[2];
    if (!/^[A-Za-z0-9.-]+$/.test(host)) return "";
    var port = m[3] || (m[1].toLowerCase() === "http://" ? ":8095" : "");
    return m[1].toLowerCase() + host + port;
  }

  /** A Hub path (`/api/art/...`) as an address the TV can load; a full address is left alone. */
  function absolute(hub, url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return url.charAt(0) === "/" ? hub + url : "";
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /** 14:05 */
  function clock(ms) {
    var d = new Date(ms);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /** 1:02:03 or 2:03 */
  function duration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /** "1 h 35 min", "42 min" */
  function runtime(min) {
    min = Math.round(min || 0);
    if (min <= 0) return "";
    return min >= 60 ? Math.floor(min / 60) + " h" + (min % 60 ? " " + (min % 60) + " min" : "") : min + " min";
  }

  function clip(text, max) {
    text = String(text == null ? "" : text);
    return text.length <= max ? text : text.slice(0, max - 1).replace(/\s+$/, "") + "…";
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * The Samsung remote's key codes (Tizen's `keyCode`), turned into what they mean. Arrow, Enter and
   * Back come with every app; the media and colour keys have to be registered (see nav.js).
   */
  var KEYS = {
    37: "left", 38: "up", 39: "right", 40: "down", 13: "enter", 10009: "back", 27: "back", 8: "back",
    415: "play", 19: "pause", 10252: "playpause", 413: "stop", 417: "ff", 412: "rw",
    403: "red", 404: "green", 405: "yellow", 406: "blue", 427: "chup", 428: "chdown",
    10182: "exit", 457: "info", 10135: "info",
    // Keyboard shortcuts for trying it in a desktop browser.
    80: "playpause", 83: "stop", 70: "ff", 66: "rw", 73: "info",
  };
  var MEDIA_KEYS = ["MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "MediaFastForward", "MediaRewind", "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue", "ChannelUp", "ChannelDown", "Info"];

  function keyAction(code) {
    return KEYS[code] || null;
  }

  /**
   * Spatial navigation: of `rects` (each `{left, top, right, bottom}`), which is the best next
   * focus from `from` going `dir`? Candidates must lie in that direction; the nearest along the
   * direction wins, with a heavy penalty for being off to the side. Returns an index or -1.
   */
  function pickNext(rects, fromIndex, dir) {
    var f = rects[fromIndex];
    if (!f) return -1;
    var fcx = (f.left + f.right) / 2;
    var fcy = (f.top + f.bottom) / 2;
    var best = -1;
    var bestScore = Infinity;
    for (var i = 0; i < rects.length; i++) {
      if (i === fromIndex) continue;
      var r = rects[i];
      var cx = (r.left + r.right) / 2;
      var cy = (r.top + r.bottom) / 2;
      var along;
      var across;
      var overlap;
      if (dir === "left") {
        if (cx >= fcx - 1 || r.right > f.left + 4) continue;
        along = f.left - r.right; across = Math.abs(cy - fcy); overlap = Math.min(f.bottom, r.bottom) - Math.max(f.top, r.top);
      } else if (dir === "right") {
        if (cx <= fcx + 1 || r.left < f.right - 4) continue;
        along = r.left - f.right; across = Math.abs(cy - fcy); overlap = Math.min(f.bottom, r.bottom) - Math.max(f.top, r.top);
      } else if (dir === "up") {
        if (cy >= fcy - 1 || r.bottom > f.top + 4) continue;
        along = f.top - r.bottom; across = Math.abs(cx - fcx); overlap = Math.min(f.right, r.right) - Math.max(f.left, r.left);
      } else {
        if (cy <= fcy + 1 || r.top < f.bottom - 4) continue;
        along = r.top - f.bottom; across = Math.abs(cx - fcx); overlap = Math.min(f.right, r.right) - Math.max(f.left, r.left);
      }
      var score = Math.max(0, along) + across * (overlap > 0 ? 1.5 : 6);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /** The skip button to show at `ms`, if one of the Hub's markers covers it. */
  function skipAt(markers, ms) {
    for (var i = 0; i < (markers || []).length; i++) {
      var m = markers[i];
      if (ms >= m.startMs && ms < m.endMs - 1000) return m;
    }
    return null;
  }

  var SKIP_LABEL = { intro: "Skip intro", recap: "Skip recap", credits: "Skip credits", adverts: "Skip adverts" };

  /** What the Hub is told about this TV so it sends a version the set can play (docs/samsung.md). */
  function deviceHeaders(maxHeight) {
    var h = maxHeight === 1080 ? 1080 : 2160;
    return { "X-Max-Height": String(h), "X-Max-Bitrate": h === 2160 ? "40000" : "20000", "X-Codecs": h === 2160 ? "h264,hevc,vp9" : "h264,hevc" };
  }

  /** The body for POST /api/progress. */
  function progressBody(key, posMs, durMs, event, paused) {
    return { key: key, positionMs: Math.max(0, Math.round(posMs || 0)), durationMs: Math.max(0, Math.round(durMs || 0)), event: event, paused: paused === true };
  }

  /** A card's caption for a title: year, or the Hub's own subtitle (an episode, "On Film4 · Sat 21:00"). */
  function titleSub(t) {
    return t.subtitle || (t.year ? String(t.year) : "");
  }

  /** The Hub's palette as CSS custom properties on `style`. Only the keys that start with `--`. */
  function applyPalette(style, palette) {
    for (var k in palette) if (Object.prototype.hasOwnProperty.call(palette, k) && k.indexOf("--") === 0) style.setProperty(k, palette[k]);
  }

  var api = { DEFAULT_HUB: DEFAULT_HUB, normaliseHub: normaliseHub, absolute: absolute, clock: clock, duration: duration, runtime: runtime, clip: clip, esc: esc, keyAction: keyAction, MEDIA_KEYS: MEDIA_KEYS, pickNext: pickNext, skipAt: skipAt, SKIP_LABEL: SKIP_LABEL, deviceHeaders: deviceHeaders, progressBody: progressBody, titleSub: titleSub, applyPalette: applyPalette };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UTV = Object.assign(root.UTV || {}, api);
})(typeof window !== "undefined" ? window : globalThis);
