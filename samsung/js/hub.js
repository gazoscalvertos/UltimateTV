/* The Hub client: pairing, who's watching, and every call the screens make. */
(function (UTV) {
  "use strict";

  var STORE = "utv.samsung.v1";
  var state = { hub: UTV.DEFAULT_HUB, token: "", profileId: "", profileToken: "", maxHeight: 2160 };

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE) || "{}");
      for (var k in saved) if (Object.prototype.hasOwnProperty.call(state, k)) state[k] = saved[k];
    } catch (e) { /* private window or storage cleared: start fresh */ }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* nothing to do */ }
  }
  load();

  function HubError(message, status, code, body) {
    this.name = "HubError";
    this.message = message;
    this.status = status;
    this.code = code;
    this.body = body;
  }
  HubError.prototype = Object.create(Error.prototype);

  /** One request. Resolves with the parsed JSON (or {}), rejects with a HubError. */
  function request(method, path, body, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, state.hub + path, true);
      xhr.timeout = opts.timeout || 20000;
      xhr.setRequestHeader("Accept", "application/json");
      if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
      if (state.token) xhr.setRequestHeader("X-Device-Token", state.token);
      if (state.profileId) xhr.setRequestHeader("X-Profile", state.profileId);
      if (state.profileToken) xhr.setRequestHeader("X-Profile-Token", state.profileToken);
      var caps = UTV.deviceHeaders(state.maxHeight);
      for (var h in caps) xhr.setRequestHeader(h, caps[h]);
      xhr.onload = function () {
        var json = {};
        try { json = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (e) { json = {}; }
        if (xhr.status >= 200 && xhr.status < 300) {
          json.__status = xhr.status;
          resolve(json);
        } else reject(new HubError(json.error || "The Hub answered " + xhr.status, xhr.status, json.code, json));
      };
      xhr.onerror = function () { reject(new HubError("Can't reach the Hub at " + state.hub, 0)); };
      xhr.ontimeout = function () { reject(new HubError("The Hub didn't answer in time", 0)); };
      xhr.send(body === undefined ? null : JSON.stringify(body));
    });
  }

  var Hub = {
    get state() { return state; },
    get hub() { return state.hub; },
    get paired() { return !!state.token; },
    setHub: function (url) { state.hub = url; state.token = ""; state.profileId = ""; state.profileToken = ""; save(); },
    setMaxHeight: function (h) { state.maxHeight = h === 1080 ? 1080 : 2160; save(); },
    img: function (url) { return UTV.absolute(state.hub, url); },
    get: function (path, opts) { return request("GET", path, undefined, opts); },
    post: function (path, body, opts) { return request("POST", path, body === undefined ? {} : body, opts); },
    health: function () { return request("GET", "/api/health", undefined, { timeout: 6000 }); },

    /**
     * Pairing, as the TV box does it: the first screen is let in at once, any other shows a
     * four-letter code and waits for a yes on the TV (Settings › Phones and remotes).
     * `onCode(code)` is called while waiting. Resolves once paired.
     */
    pair: function (name, onCode, cancelled) {
      var self = this;
      return request("POST", "/api/pair/screen", { name: name }).then(function (r) {
        if (r.token) { state.token = r.token; save(); return r; }
        if (!r.pending) throw new HubError("The Hub didn't say how to pair", 0);
        var id = r.pending.id, secret = r.secret;
        if (onCode) onCode(r.pending.code);
        return new Promise(function (resolve, reject) {
          (function poll() {
            if (cancelled && cancelled()) return reject(new HubError("Cancelled", 0));
            request("POST", "/api/pair/screen/" + id, { secret: secret }).then(function (p) {
              if (p.token) { state.token = p.token; save(); resolve(p); }
              else setTimeout(poll, 2000);
            }, function (e) {
              if (e.status === 404) reject(new HubError("That request ran out or was turned down. Try again.", 404));
              else setTimeout(poll, 3000);
            });
          })();
        });
      });
    },
    forget: function () {
      var done = function () { state.token = ""; state.profileId = ""; state.profileToken = ""; save(); };
      return request("POST", "/api/pair/forget", {}).then(done, done);
    },

    profiles: function () { return request("GET", "/api/profiles"); },
    chooseProfile: function (profile, pin) {
      if (!profile.hasPin) { state.profileId = profile.id; state.profileToken = ""; save(); return Promise.resolve(); }
      return request("POST", "/api/profiles/" + encodeURIComponent(profile.id) + "/unlock", { pin: pin }).then(function (r) {
        state.profileId = profile.id; state.profileToken = r.token || ""; save();
      });
    },
    get profileId() { return state.profileId; },

    theme: function () { return request("GET", "/api/theme", undefined, { timeout: 6000 }); },
    home: function () { return request("GET", "/api/home"); },
    browse: function (kind) { return request("GET", "/api/browse/" + kind); },
    title: function (id) { return request("GET", "/api/titles/" + encodeURIComponent(id)); },
    nowNext: function () { return request("GET", "/api/nownext"); },
    recordings: function () { return request("GET", "/api/recordings"); },
    search: function (q) { return request("GET", "/api/search?q=" + encodeURIComponent(q)); },
    play: function (req) { return request("POST", "/api/play", req, { timeout: 45000 }); },
    progress: function (key, posMs, durMs, event, paused) {
      return request("POST", "/api/progress", UTV.progressBody(key, posMs, durMs, event, paused), { timeout: 8000 }).catch(function () { /* the next report will do */ });
    },
  };

  UTV.HubError = HubError;
  UTV.Hub = Hub;
})(window.UTV = window.UTV || {});
