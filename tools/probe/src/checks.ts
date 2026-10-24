// Automatic browser checks: codecs, DRM, display and feature support.

import {
  CODEC_CHECKS,
  DRM_SYSTEMS,
  chromiumVersion,
  type CodecResult,
  type ProbeReport,
  type Support,
} from "@ultimatetv/shared";

const MEDIA_QUERIES = [
  "(dynamic-range: high)",
  "(video-dynamic-range: high)",
  "(color-gamut: p3)",
  "(color-gamut: rec2020)",
];

function mseSupport(mime: string): Support {
  try {
    if (typeof MediaSource === "undefined") return "no";
    return MediaSource.isTypeSupported(mime) ? "probably" : "no";
  } catch {
    return "error";
  }
}

function canPlay(video: HTMLVideoElement, mime: string): Support {
  try {
    const answer = video.canPlayType(mime);
    return answer === "probably" || answer === "maybe" ? answer : "no";
  } catch {
    return "error";
  }
}

export function checkCodecs(): CodecResult[] {
  const video = document.createElement("video");
  return CODEC_CHECKS.map((check) => ({
    id: check.id,
    mse: check.kind === "stream" ? "no" : mseSupport(check.mime),
    canPlayType: canPlay(video, check.mime),
  }));
}

export async function checkDrm(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  const config: MediaKeySystemConfiguration[] = [
    {
      initDataTypes: ["cenc"],
      videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"' }],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
    },
  ];
  for (const system of DRM_SYSTEMS) {
    try {
      if (!navigator.requestMediaKeySystemAccess) {
        results[system] = false;
        continue;
      }
      await withTimeout(navigator.requestMediaKeySystemAccess(system, config), 4000);
      results[system] = true;
    } catch {
      results[system] = false;
    }
  }
  return results;
}

function webgl(): ProbeReport["device"]["webgl"] {
  const canvas = document.createElement("canvas");
  const gl2 = canvas.getContext("webgl2");
  const gl = gl2 ?? canvas.getContext("webgl");
  let renderer: string | null = null;
  if (gl) {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }
  return { webgl1: gl !== null, webgl2: gl2 !== null, renderer };
}

function features(): Record<string, boolean> {
  let storage = false;
  try {
    localStorage.setItem("utv-probe", "1");
    localStorage.removeItem("utv-probe");
    storage = true;
  } catch {
    storage = false;
  }
  return {
    "Service worker": "serviceWorker" in navigator,
    "Local storage": storage,
    IndexedDB: typeof indexedDB !== "undefined",
    "Media Source Extensions": typeof MediaSource !== "undefined",
    "Encrypted Media Extensions": typeof navigator.requestMediaKeySystemAccess === "function",
    "Picture-in-picture": "pictureInPictureEnabled" in document,
    "Web Workers": typeof Worker !== "undefined",
    WebAssembly: typeof WebAssembly === "object",
    "CSS backdrop-filter": typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "blur(4px)"),
  };
}

/** Animates a box for `ms` and counts frames, a rough measure of how smooth UI motion can be. */
export function measureFps(host: HTMLElement, ms = 2000): Promise<number> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "fps-box";
    host.appendChild(box);
    let frames = 0;
    const start = performance.now();
    const tick = (now: number) => {
      frames += 1;
      const t = (now - start) / ms;
      box.style.transform = `translateX(${Math.round(Math.sin(t * Math.PI * 4) * 200)}px)`;
      if (now - start < ms) {
        requestAnimationFrame(tick);
      } else {
        box.remove();
        resolve(Math.round((frames * 1000) / (now - start)));
      }
    };
    requestAnimationFrame(tick);
  });
}

export function deviceInfo(fps: number | null): ProbeReport["device"] {
  const mediaQueries: Record<string, boolean> = {};
  for (const query of MEDIA_QUERIES) mediaQueries[query] = window.matchMedia(query).matches;
  return {
    userAgent: navigator.userAgent,
    chromiumVersion: chromiumVersion(navigator.userAgent),
    screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    mediaQueries,
    webgl: webgl(),
    features: features(),
    fps,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
