#!/usr/bin/env node
// Captures the box's Hub-down screen (box/offline) with a stand-in for the box shell, into
// docs/screenshots/offline-box.png. No Hub needed.
//
//   node tools/screenshots/offline.mjs

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const poster = (a, b, label) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><text x="100" y="250" fill="#fff" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle">${label}</text></svg>`)}`;

const fake = {
  status: {
    hubUrl: "http://192.168.0.19:8095",
    appName: "UltimateTV",
    reason: "The Hub stopped answering",
    since: Date.parse("2026-10-30T19:42:00"),
    addresses: ["192.168.0.70"],
    profile: { name: "Family", kids: false },
  },
  downloads: {
    items: [
      { id: "1", status: "done", name: "Paddington 2", subtitle: "Film · 1h 43m", req: { kind: "title", id: "a" }, artwork: poster("#c0392b", "#2c3e50", "Paddington 2"), positionMs: 1_900_000, durationMs: 6_180_000, addedAt: 3 },
      { id: "2", status: "done", name: "Bluey", subtitle: "S3 E12 · Cricket", req: { kind: "title", id: "b" }, artwork: poster("#3498db", "#1abc9c", "Bluey"), addedAt: 2 },
      { id: "3", status: "done", name: "The Great British Bake Off", subtitle: "Channel 4 · Tue 29 Oct", req: { kind: "recording", id: "c" }, artwork: poster("#e67e22", "#8e44ad", "Bake Off"), addedAt: 1 },
      { id: "4", status: "done", name: "Dune: Part Two", subtitle: "Film · 2h 46m", req: { kind: "title", id: "d" }, artwork: poster("#b9770e", "#1c1c1c", "Dune"), addedAt: 0 },
    ],
  },
  cast: {
    airplay: { installed: true, enabled: true, running: true, connected: false, name: "UltimateTV" },
    apps: [
      { id: "retroarch", name: "Retro games", detail: "RetroArch: classic consoles from your own game files", installed: true },
      { id: "moonlight", name: "Games from your PC", detail: "Moonlight: play the games on a gaming PC", installed: true },
      { id: "steamlink", name: "Steam Link", detail: "Play your Steam library from a PC in the house", installed: false },
    ],
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript((f) => {
  const ok = (v) => async () => v;
  window.ultimatetv = {
    hubStatus: ok(f.status),
    downloads: ok(f.downloads),
    cast: ok(f.cast),
    retryHub: ok(undefined),
    tvStandby: ok(undefined),
    onState: () => () => undefined,
    onDownloads: () => () => undefined,
    onCast: () => () => undefined,
  };
  // A fixed evening, so the clock in the picture doesn't change.
  const at = Date.parse("2026-10-30T19:47:00");
  const RealDate = Date;
  window.Date = class extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [at]));
    }
    static now() {
      return at;
    }
  };
}, fake);
await page.goto(pathToFileURL(path.join(root, "box/offline/index.html")).href);
await page.waitForTimeout(500);
const file = path.join(root, "docs/screenshots/offline-box.png");
await page.screenshot({ path: file });
await browser.close();
console.log(`Saved ${path.relative(root, file)}`);
