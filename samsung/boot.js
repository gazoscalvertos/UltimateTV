/* The shell: everything the TV needs to start, and nothing that has to be reinstalled to change.
   It asks the Hub which version of the app's screens it has (/tv/samsung/manifest.json), runs those,
   and keeps a copy for next time. If the Hub can't be reached it runs the last copy it kept, and
   failing that the screens packaged in this install. docs/tv-updates.md. Plain ES2015. */
(function () {
  "use strict";

  var PLATFORM = "samsung";
  var APP_STORE = "utv.samsung.v1";
  var CACHE = "utv.samsung.shell";
  var BAD = "utv.samsung.shellbad";
  var DEFAULT_HUB = "http://192.168.0.19:8095";
  var LOCAL_STYLES = ["css/app.css"];
  var LOCAL_SCRIPTS = ["js/util.js", "js/hub.js", "js/nav.js", "js/player.js", "js/app.js"];

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage full or off: the shell still works, it just fetches again */ }
    return null;
  }

  function hubAddress() {
    var s = store(APP_STORE);
    return (s && s.hub) || DEFAULT_HUB;
  }

  function fetchText(url, ms, done) {
    var x = new XMLHttpRequest();
    var over = false;
    function end(err, text) { if (over) return; over = true; done(err, text); }
    x.open("GET", url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now());
    x.timeout = ms;
    x.onload = function () { if (x.status >= 200 && x.status < 300) end(null, x.responseText); else end(new Error("HTTP " + x.status)); };
    x.onerror = function () { end(new Error("no answer")); };
    x.ontimeout = function () { end(new Error("timed out")); };
    x.send();
  }

  function finish(source) {
    var b = document.getElementById("boot");
    if (b && b.parentNode) b.parentNode.removeChild(b);
    window.UTV = window.UTV || {};
    window.UTV.bootSource = source;
  }

  /** The screens packaged with this install: the fallback that always works. */
  function runLocal() {
    var i = 0;
    LOCAL_STYLES.forEach(function (href) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      document.head.appendChild(l);
    });
    (function next() {
      if (i >= LOCAL_SCRIPTS.length) { finish("packaged"); window.UTV.start(); return; }
      var s = document.createElement("script");
      s.src = LOCAL_SCRIPTS[i++];
      s.onload = next;
      s.onerror = function () { var b = document.getElementById("boot"); if (b) b.textContent = "UltimateTV could not start: " + s.src; };
      document.body.appendChild(s);
    })();
  }

  /** Runs screens that came from the Hub (or its saved copy). False when they would not start. */
  function runFetched(manifest, files) {
    store(BAD, manifest.version);
    try {
      manifest.styles.forEach(function (p) {
        var st = document.createElement("style");
        st.textContent = files[p];
        document.head.appendChild(st);
      });
      manifest.scripts.forEach(function (p) { (new Function(files[p]))(); });
      finish("Hub " + manifest.version);
      window.UTV.start();
    } catch (e) {
      return false;
    }
    store(BAD, null);
    return true;
  }

  function usable(c) {
    return c && c.manifest && c.files && c.manifest.scripts.concat(c.manifest.styles).every(function (p) { return typeof c.files[p] === "string"; });
  }

  function start() {
    var base = hubAddress() + "/tv/" + PLATFORM + "/";
    var cached = store(CACHE);
    function fallback() {
      // A saved copy that has already failed to start is not tried again.
      if (usable(cached) && store(BAD) !== cached.manifest.version && runFetched(cached.manifest, cached.files)) return;
      if (store(BAD)) { store(BAD, null); }
      runLocal();
    }
    fetchText(base + "manifest.json", 4000, function (err, text) {
      var m = null;
      if (!err) { try { m = JSON.parse(text); } catch (e) { m = null; } }
      if (!m || !m.version || !m.scripts) { fallback(); return; }
      if (store(BAD) === m.version) { runLocal(); return; } // this version failed here before: use the packaged screens
      if (usable(cached) && cached.manifest.version === m.version) {
        if (!runFetched(cached.manifest, cached.files)) { runLocal(); }
        return;
      }
      var paths = m.styles.concat(m.scripts);
      var files = {};
      var left = paths.length;
      var failed = false;
      paths.forEach(function (p) {
        fetchText(base + p, 15000, function (e2, body) {
          if (failed) return;
          if (e2) { failed = true; fallback(); return; }
          files[p] = body;
          if (--left === 0) {
            store(CACHE, { manifest: m, files: files });
            if (!runFetched(m, files)) { store(CACHE, null); runLocal(); }
          }
        });
      });
    });
  }

  start();
})();
