/* The player. On a Samsung TV this is AVPlay (webapis.avplay): the set's own hardware decoder,
   drawn in an <object> under the page. In a desktop browser, for trying the screens, it falls
   back to an HTML5 <video> so the same code runs. */
(function (UTV) {
  "use strict";

  var hasAv = function () { return !!(window.webapis && window.webapis.avplay); };

  function AvPlayer() {
    var av = window.webapis.avplay;
    var self = this;
    var open = false;
    var dur = 0;
    var cur = 0;
    var paused = false;
    var handlers = {};
    this.on = function (name, fn) { handlers[name] = fn; };
    function emit(name, arg) { if (handlers[name]) handlers[name](arg); }
    this.kind = "avplay";
    Object.defineProperty(this, "positionMs", { get: function () { try { return av.getCurrentTime(); } catch (e) { return cur; } } });
    Object.defineProperty(this, "durationMs", { get: function () { return dur; } });
    Object.defineProperty(this, "paused", { get: function () { return paused; } });

    this.load = function (url, startMs) {
      self.close();
      return new Promise(function (resolve, reject) {
        try {
          av.open(url);
          open = true;
          av.setDisplayRect(0, 0, 1920, 1080);
          try { av.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN"); } catch (e) { /* default is fine */ }
          av.setListener({
            onbufferingstart: function () { emit("buffering", true); },
            onbufferingcomplete: function () { emit("buffering", false); },
            oncurrentplaytime: function (ms) { cur = ms; emit("time", ms); },
            onstreamcompleted: function () { emit("ended"); },
            onerror: function (type) { emit("error", String(type)); },
            onevent: function () { /* manifest and DRM events: nothing to do */ },
            onsubtitlechange: function (duration, text) { emit("subtitle", text); },
          });
          av.prepareAsync(function () {
            try { dur = av.getDuration(); } catch (e) { dur = 0; }
            var go = function () { av.play(); paused = false; resolve(); };
            if (startMs > 5000) { try { av.seekTo(startMs, go, go); } catch (e) { go(); } } else go();
          }, function (err) { reject(new Error(String(err))); });
        } catch (e) { reject(e); }
      });
    };
    this.pause = function () { try { av.pause(); paused = true; } catch (e) { /* not playing */ } };
    this.resume = function () { try { av.play(); paused = false; } catch (e) { /* not ready */ } };
    this.seekTo = function (ms) {
      ms = Math.max(0, dur ? Math.min(dur - 3000, ms) : ms);
      try { av.seekTo(ms, function () {}, function () {}); } catch (e) { /* live */ }
    };
    this.tracks = function () {
      var out = { audio: [], text: [] };
      try {
        var t = av.getTotalTrackInfo();
        for (var i = 0; i < t.length; i++) {
          var info = {};
          try { info = JSON.parse(t[i].extra_info || "{}"); } catch (e) { info = {}; }
          var item = { index: t[i].index, lang: info.language || info.track_lang || "" };
          if (t[i].type === "AUDIO") out.audio.push(item);
          else if (t[i].type === "TEXT") out.text.push(item);
        }
      } catch (e) { /* none */ }
      return out;
    };
    this.selectTrack = function (type, index) { try { av.setSelectTrack(type === "audio" ? "AUDIO" : "TEXT", index); } catch (e) { /* not available */ } };
    this.externalSubtitle = function (url) { try { av.setExternalSubtitlePath(url); av.setSilentSubtitle(false); return true; } catch (e) { return false; } };
    this.subtitlesOff = function () { try { av.setSilentSubtitle(true); } catch (e) { /* none */ } };
    this.close = function () {
      if (!open) return;
      open = false;
      try { av.stop(); } catch (e) { /* already stopped */ }
      try { av.close(); } catch (e) { /* already closed */ }
    };
  }

  function VideoPlayer(host) {
    var v = document.createElement("video");
    v.className = "html-video";
    host.appendChild(v);
    var handlers = {};
    this.on = function (name, fn) { handlers[name] = fn; };
    function emit(name, arg) { if (handlers[name]) handlers[name](arg); }
    this.kind = "html5";
    Object.defineProperty(this, "positionMs", { get: function () { return v.currentTime * 1000; } });
    Object.defineProperty(this, "durationMs", { get: function () { return isFinite(v.duration) ? v.duration * 1000 : 0; } });
    Object.defineProperty(this, "paused", { get: function () { return v.paused; } });
    v.addEventListener("timeupdate", function () { emit("time", v.currentTime * 1000); });
    v.addEventListener("ended", function () { emit("ended"); });
    v.addEventListener("waiting", function () { emit("buffering", true); });
    v.addEventListener("playing", function () { emit("buffering", false); });
    this.load = function (url, startMs) {
      return new Promise(function (resolve, reject) {
        v.onloadedmetadata = function () { if (startMs > 5000) v.currentTime = startMs / 1000; var p = v.play(); if (p && p.then) p.then(resolve, resolve); else resolve(); };
        v.onerror = function () { reject(new Error("The video wouldn't load")); };
        v.src = url;
      });
    };
    this.pause = function () { v.pause(); };
    this.resume = function () { v.play(); };
    this.seekTo = function (ms) { v.currentTime = Math.max(0, ms / 1000); };
    this.tracks = function () { return { audio: [], text: [] }; };
    this.selectTrack = function () {};
    this.externalSubtitle = function () { return false; };
    this.subtitlesOff = function () {};
    this.close = function () { v.onerror = null; v.pause(); v.removeAttribute("src"); try { v.load(); } catch (e) { /* none */ } if (v.parentNode) v.parentNode.removeChild(v); };
  }

  UTV.makePlayer = function (host) {
    return hasAv() ? new AvPlayer() : new VideoPlayer(host);
  };
})(window.UTV = window.UTV || {});
