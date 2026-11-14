/* Remote keys and spatial focus. Every focusable thing is an element with class "f"; the arrow
   keys move to the nearest one in that direction (UTV.pickNext), and the screen that is showing
   gets first refusal on every key. */
(function (UTV) {
  "use strict";

  var handler = null; // function(action, event) -> true when handled
  var lastFocus = null;

  function registerKeys() {
    try {
      if (window.tizen && tizen.tvinputdevice) {
        UTV.MEDIA_KEYS.forEach(function (k) {
          try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* this set doesn't have that key */ }
        });
      }
    } catch (e) { /* in a desktop browser */ }
  }

  function focusables(root) {
    var list = (root || document).querySelectorAll(".f:not(.off)");
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i].offsetWidth > 0 || list[i].offsetHeight > 0) out.push(list[i]);
    return out;
  }

  /** Moves a scrolling container so `el` is comfortably inside it. */
  function reveal(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      var cls = p.className || "";
      if (/\bscroll-x\b/.test(cls)) {
        var r = el.getBoundingClientRect(), c = p.getBoundingClientRect();
        var margin = c.width * 0.08;
        if (r.left < c.left + margin) p.scrollLeft -= c.left + margin - r.left;
        else if (r.right > c.right - margin) p.scrollLeft += r.right - (c.right - margin);
      }
      if (/\bscroll-y\b/.test(cls)) {
        var r2 = el.getBoundingClientRect(), c2 = p.getBoundingClientRect();
        var m2 = c2.height * 0.12;
        if (r2.top < c2.top + m2) p.scrollTop -= c2.top + m2 - r2.top;
        else if (r2.bottom > c2.bottom - m2) p.scrollTop += r2.bottom - (c2.bottom - m2);
      }
      p = p.parentNode;
    }
  }

  function focus(el) {
    if (!el) return false;
    lastFocus = el;
    el.focus();
    reveal(el);
    var rail = el.closest ? el.closest("[data-rail]") : null;
    if (rail && UTV.onRailFocus) UTV.onRailFocus(rail);
    if (el.onfocusitem) el.onfocusitem();
    return true;
  }

  function move(dir) {
    var all = focusables();
    var cur = document.activeElement;
    var idx = all.indexOf(cur);
    if (idx < 0) return focus(all[0]);
    var rects = all.map(function (e) { var r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
    var next = UTV.pickNext(rects, idx, dir);
    return next >= 0 ? focus(all[next]) : false;
  }

  function onKey(e) {
    var action = UTV.keyAction(e.keyCode);
    if (!action) return;
    if (UTV.activity) UTV.activity();
    if (handler && handler(action, e) === true) { e.preventDefault(); return; }
    if (action === "left" || action === "right" || action === "up" || action === "down") { move(action); e.preventDefault(); }
    else if (action === "enter") {
      var el = document.activeElement;
      if (el && el.classList && el.classList.contains("f") && el.onactivate) { el.onactivate(); e.preventDefault(); }
    }
  }

  UTV.Nav = {
    init: function () { registerKeys(); document.addEventListener("keydown", onKey, true); },
    /** The screen's key handler: returns true when it used the key. */
    handle: function (fn) { handler = fn; },
    focus: focus,
    focusFirst: function (root) { var a = focusables(root); return focus(a[0]); },
    focusables: focusables,
    /** Puts focus back where it was, or on the first thing, after a screen is redrawn. */
    restore: function () { if (lastFocus && document.body.contains(lastFocus)) focus(lastFocus); else this.focusFirst(); },
  };
})(window.UTV = window.UTV || {});
