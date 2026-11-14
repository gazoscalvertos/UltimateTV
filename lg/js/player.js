/* The player. webOS decodes <video> in hardware, so this is an HTML5 video element under the page
   (HLS, MP4 and MKV play natively on LG sets). Audio tracks come from video.audioTracks when the
   set offers them. Subtitles are fetched from the Hub, read as SRT or WebVTT and drawn by the app's
   own caption line, so they work on every webOS version. */
(function (UTV) {
  "use strict";

  /** SRT or WebVTT text into [{start, end, text}] (seconds). */
  function parseCues(text) {
    var cues = [];
    var blocks = String(text || "").replace(/\r/g, "").replace(/^﻿/, "").split(/\n\n+/);
    var stamp = /(\d+:)?(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+:)?(\d+):(\d+)[.,](\d+)/;
    function secs(h, m, s, f) { return (h ? parseInt(h, 10) : 0) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(f, 10) / Math.pow(10, String(f).length); }
    blocks.forEach(function (b) {
      var lines = b.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var m = stamp.exec(lines[i]);
        if (!m) continue;
        var body = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "").trim();
        if (body) cues.push({ start: secs(m[1], m[2], m[3], m[4]), end: secs(m[5], m[6], m[7], m[8]), text: body });
        break;
      }
    });
    return cues;
  }

  function VideoPlayer(host) {
    var v = document.createElement("video");
    v.className = "html-video";
    v.setAttribute("autoplay", "");
    host.appendChild(v);
    var handlers = {};
    var cues = [];
    var shown = null;
    this.on = function (name, fn) { handlers[name] = fn; };
    function emit(name, arg) { if (handlers[name]) handlers[name](arg); }
    this.kind = "webos";
    Object.defineProperty(this, "positionMs", { get: function () { return v.currentTime * 1000; } });
    Object.defineProperty(this, "durationMs", { get: function () { return isFinite(v.duration) ? v.duration * 1000 : 0; } });
    Object.defineProperty(this, "paused", { get: function () { return v.paused; } });
    v.addEventListener("timeupdate", function () {
      emit("time", v.currentTime * 1000);
      if (cues.length) {
        var t = v.currentTime, now = null;
        for (var i = 0; i < cues.length; i++) if (t >= cues[i].start && t < cues[i].end) { now = cues[i].text; break; }
        if (now !== shown) { shown = now; emit("subtitle", now || "", true); }
      }
    });
    v.addEventListener("ended", function () { emit("ended"); });
    v.addEventListener("waiting", function () { emit("buffering", true); });
    v.addEventListener("seeking", function () { emit("buffering", true); });
    v.addEventListener("playing", function () { emit("buffering", false); });
    v.addEventListener("seeked", function () { emit("buffering", false); });
    this.load = function (url, startMs) {
      return new Promise(function (resolve, reject) {
        var done = false;
        v.onloadedmetadata = function () {
          if (startMs > 5000) { try { v.currentTime = startMs / 1000; } catch (e) { /* live */ } }
          var p = v.play();
          if (p && p.then) p.then(function () { done = true; resolve(); }, function () { done = true; resolve(); });
          else { done = true; resolve(); }
        };
        v.onerror = function () {
          var code = v.error ? v.error.code : 0;
          if (done) emit("error", "media error " + code); else reject(new Error("media error " + code));
        };
        v.src = url;
      });
    };
    this.pause = function () { v.pause(); };
    this.resume = function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); };
    this.seekTo = function (ms) {
      var dur = v.duration;
      var to = Math.max(0, ms / 1000);
      if (isFinite(dur) && dur > 4) to = Math.min(dur - 3, to);
      v.currentTime = to;
    };
    this.tracks = function () {
      var out = { audio: [], text: [] };
      var at = v.audioTracks;
      if (at && at.length > 1) for (var i = 0; i < at.length; i++) out.audio.push({ index: i, lang: at[i].language || at[i].label || "" });
      return out;
    };
    this.selectTrack = function (type, index) {
      if (type !== "audio" || !v.audioTracks) return;
      for (var i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = i === index;
    };
    this.externalSubtitle = function (url) {
      // Reads the file in the background; true means "asked", the caption line fills in when it arrives.
      var x = new XMLHttpRequest();
      x.open("GET", url);
      x.onload = function () { cues = x.status < 400 ? parseCues(x.responseText) : []; shown = null; if (!cues.length) emit("subtitle", ""); };
      x.onerror = function () { cues = []; };
      x.send();
      return true;
    };
    this.subtitlesOff = function () { cues = []; shown = null; emit("subtitle", ""); };
    this.close = function () { v.onerror = null; v.pause(); v.removeAttribute("src"); try { v.load(); } catch (e) { /* none */ } if (v.parentNode) v.parentNode.removeChild(v); };
  }

  UTV.parseCues = parseCues;
  UTV.makePlayer = function (host) { return new VideoPlayer(host); };
})(window.UTV = window.UTV || {});
