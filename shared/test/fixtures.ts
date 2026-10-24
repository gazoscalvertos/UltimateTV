import type { ProbeReport } from "../src/index.js";

export function sampleReport(): ProbeReport {
  return {
    schema: 1,
    createdAt: "2026-10-24T12:00:00.000Z",
    label: "Living room 85U7",
    device: {
      userAgent: "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.215 Safari/537.36 VIDAA/9.0",
      chromiumVersion: "108.0.5359.215",
      screen: { width: 1920, height: 1080, devicePixelRatio: 1 },
      viewport: { width: 1920, height: 1080 },
      mediaQueries: { "(dynamic-range: high)": true },
      webgl: { webgl1: true, webgl2: true, renderer: "Mali-G57" },
      features: { serviceWorker: false },
      fps: 59,
    },
    codecs: [
      { id: "hevc-mkv", mse: "probably", canPlayType: "probably" },
      { id: "av1-10bit", mse: "no", canPlayType: "no" },
    ],
    drm: { "com.widevine.alpha": true },
    keys: [
      { name: "OK", keyCode: 13, key: "Enter" },
      { name: "Guide", keyCode: null },
      { name: "Back", keyCode: null, via: "click" },
    ],
    eventLog: ["keydown 13 Enter", "click"],
    clips: [{ clip: "dv-p8.mkv", played: true, videoWidth: 3840, videoHeight: 2160, hdrBadge: "dolby-vision", motion: "smooth", audio: "atmos" }],
  };
}
