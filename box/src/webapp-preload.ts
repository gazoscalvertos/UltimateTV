// Runs in a music service's web player (Deezer) before its page loads, and puts tvMode() into the
// page itself. It makes a site built for a mouse work with the TV remote: the arrows move a
// visible focus between the page's buttons and links, OK presses, Play/Pause plays. It also
// keeps the play/pause/next handlers the site gives the browser's media controls, so the app can
// pause it (when a film starts) and show what's playing. Sandboxed: only `electron` is available
// here, so this file stands alone.

import { webFrame } from "electron";

function tvMode(): void {
  const w = window as unknown as { __utv?: unknown };
  if (w.__utv) return;

  // The site's media session handlers, as it registers them.
  const handlers: Record<string, (d: { action: string }) => void> = {};
  const session = navigator.mediaSession;
  if (session) {
    const original = session.setActionHandler.bind(session);
    session.setActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      if (handler) handlers[action] = handler as (d: { action: string }) => void;
      else delete handlers[action];
      try {
        original(action, handler);
      } catch {
        // An action this browser doesn't know.
      }
    };
  }
  const media = new Set<HTMLMediaElement>();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    media.add(this);
    return play.call(this);
  };
  const playing = () => [...media].some((m) => !m.paused) || session?.playbackState === "playing";
  const call = (action: string) => {
    const h = handlers[action];
    if (!h) return false;
    h({ action });
    return true;
  };
  const pause = () => call("pause") || media.forEach((m) => m.pause());
  const control = (cmd: string) => {
    if (cmd === "pause") {
      if (playing()) pause();
    } else if (cmd === "playPause") {
      if (playing()) pause();
      else if (!call("play")) [...media].at(-1)?.play();
    } else if (cmd === "next") call("nexttrack");
    else if (cmd === "prev") call("previoustrack");
  };
  w.__utv = {
    control,
    state() {
      const md = session?.metadata;
      if (!md?.title) return null;
      const art = md.artwork.length ? md.artwork[md.artwork.length - 1]!.src : undefined;
      return { title: md.title, artist: md.artist || undefined, album: md.album || undefined, artwork: art, playing: playing() };
    },
  };

  // ---------------------------------------------------------------------------------------
  // The remote: arrows move focus to the nearest control in that direction.

  const FOCUSABLE =
    'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],[role="slider"],[tabindex]:not([tabindex="-1"])';
  const style = document.createElement("style");
  style.textContent =
    "*:focus{outline:4px solid #3d8bff!important;outline-offset:2px!important;box-shadow:0 0 0 8px rgba(61,139,255,.35)!important;border-radius:6px}*{cursor:none!important}::-webkit-scrollbar{display:none}";
  const addStyle = () => (document.head ?? document.documentElement).append(style);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addStyle);
  else addStyle();

  const usable = (el: HTMLElement) => {
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-hidden") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const onScreen = (r: DOMRect) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const candidates = () => Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(usable);
  // A dialog open on top takes the remote.
  const scope = (): ParentNode => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[aria-modal="true"],dialog[open]')).filter(usable);
    return dialogs.at(-1) ?? document;
  };

  const move = (dir: "up" | "down" | "left" | "right") => {
    const root = scope();
    const all = candidates().filter((el) => root === document || (root as HTMLElement).contains(el));
    const from = document.activeElement instanceof HTMLElement && all.includes(document.activeElement) ? document.activeElement : null;
    if (!from) {
      const first = all.find((el) => onScreen(el.getBoundingClientRect()));
      first?.focus();
      return;
    }
    const a = from.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      if (el === from || el.contains(from) || from.contains(el)) continue;
      const b = el.getBoundingClientRect();
      let main: number;
      let cross: number;
      if (dir === "left" || dir === "right") {
        main = dir === "right" ? b.left - a.right : a.left - b.right;
        if (main < -8) continue;
        const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        cross = overlap > 0 ? 0 : Math.abs(b.top + b.height / 2 - (a.top + a.height / 2));
      } else {
        main = dir === "down" ? b.top - a.bottom : a.top - b.bottom;
        if (main < -8) continue;
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        cross = overlap > 0 ? 0 : Math.abs(b.left + b.width / 2 - (a.left + a.width / 2));
      }
      const score = Math.max(main, 0) + cross * 3;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  };

  const ARROWS: Record<string, "up" | "down" | "left" | "right"> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  window.addEventListener(
    "keydown",
    (e) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable;
      const dir = ARROWS[e.key];
      if (dir) {
        // In a text box, left and right move the cursor.
        if (typing && (dir === "left" || dir === "right")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        move(dir);
        return;
      }
      if (e.key === "Enter" && el && el !== document.body && !typing && !(el instanceof HTMLButtonElement) && !(el instanceof HTMLAnchorElement)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        el.click();
        return;
      }
      if (typing) return;
      const cmd = e.key === " " || e.key === "MediaPlayPause" ? "playPause" : e.key === "F8" || e.key === "MediaTrackNext" ? "next" : e.key === "F7" || e.key === "MediaTrackPrevious" ? "prev" : null;
      if (cmd) {
        e.preventDefault();
        e.stopImmediatePropagation();
        control(cmd);
      }
    },
    true,
  );
}

void webFrame.executeJavaScript(`(${tvMode.toString()})()`);
