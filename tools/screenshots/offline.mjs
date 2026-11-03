#!/usr/bin/env node
// Captures Limited mode (box/offline: the box's own TV app with the Hub down) with a stand-in for
// the box shell, into docs/screenshots/offline-box.png. No Hub and no cache needed.
//
//   node tools/screenshots/offline.mjs
//
// The fixed evening is a Wednesday in late October 2026, so the day pills read Today … next Tuesday.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const poster = (a, b, label) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><text x="100" y="250" fill="#fff" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle">${label}</text></svg>`)}`;

const AT = Date.parse("2026-10-28T19:47:00");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const midnight = (offset = 0) => {
  const at = new Date(AT + offset * DAY);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
};

const slot = (id, title, start, mins, extra = {}) => ({ id, title, start, end: start + mins * MIN, ...extra });

// What the box would have saved: a handful of channels with a day or two of guide each, and one
// Jellyfin film half-watched.
const guide = (rows) => rows;

const channels = [
  {
    id: "bbc-one",
    number: 101,
    name: "BBC One",
    logo: poster("#1b3a6b", "#0b1a33", "BBC One"),
    category: "entertainment",
    playable: true,
    now: slot("a", "The One Show", midnight() + 19 * HOUR, 30),
    next: slot("b", "EastEnders", midnight() + 19.5 * HOUR, 30),
    programmes: guide([
      slot("a", "The One Show", midnight() + 19 * HOUR, 30),
      slot("b", "EastEnders", midnight() + 19.5 * HOUR, 30),
      slot("c", "Ambulance", midnight() + 20 * HOUR, 60),
      slot("d", "The Repair Shop", midnight(1) + 20 * HOUR, 60),
    ]),
  },
  {
    id: "bbc-two",
    number: 102,
    name: "BBC Two",
    logo: poster("#2c3e50", "#101820", "BBC Two"),
    category: "entertainment",
    playable: true,
    now: slot("e", "Only Connect", midnight() + 19 * HOUR, 30),
    next: slot("f", "Grand Tours of Scotland", midnight() + 19.5 * HOUR, 30),
    programmes: guide([
      slot("e", "Only Connect", midnight() + 19 * HOUR, 30),
      slot("f", "Grand Tours of Scotland", midnight() + 19.5 * HOUR, 30),
      slot("g", "Later with Jools Holland", midnight() + 22 * HOUR, 60),
    ]),
  },
  {
    id: "cbeebies",
    number: 201,
    name: "CBeebies",
    logo: poster("#2e8b57", "#123b25", "CBeebies"),
    category: "kids",
    playable: true,
    now: slot("h", "Bluey", midnight() + 18 * HOUR, 15),
    next: slot("i", "Nick Cope's Popcast", midnight() + 18.25 * HOUR, 15),
    programmes: guide([
      slot("h", "Bluey", midnight() + 18 * HOUR, 15),
      slot("i", "Nick Cope's Popcast", midnight() + 18.25 * HOUR, 15),
      slot("j", "Bedtime Stories", midnight() + 18.75 * HOUR, 15),
    ]),
  },
  {
    id: "film-four",
    number: 301,
    name: "Film4",
    logo: poster("#8e44ad", "#2c0f3a", "Film4"),
    category: "films",
    playable: true,
    now: slot("k", "Paddington 2", midnight() + 18 * HOUR, 120),
    next: slot("l", "The Italian Job", midnight() + 20 * HOUR, 120),
    programmes: guide([
      slot("k", "Paddington 2", midnight() + 18 * HOUR, 120),
      slot("l", "The Italian Job", midnight() + 20 * HOUR, 120),
      slot("m", "Dune: Part Two", midnight(1) + 20 * HOUR, 166),
    ]),
  },
  {
    id: "more-four",
    number: 302,
    name: "More4",
    logo: poster("#16a085", "#0b3b33", "More4"),
    category: "entertainment",
    // A channel the box has in its saved list but with no URL it can play: the card says so.
    playable: false,
    programmes: guide([slot("n", "Location, Location, Location", midnight() + 19 * HOUR, 60)]),
  },
];

const view = {
  at: AT - 4 * MIN,
  profile: "Family",
  kids: false,
  channels,
  jellyfin: {
    serverName: "Jellyfin",
    items: [
      { id: "jf1", name: "Paddington 2", subtitle: "Film", poster: poster("#c0392b", "#2c3e50", "Paddington 2"), positionMs: 32 * MIN, runtimeMs: 103 * MIN },
      { id: "jf2", name: "Bluey", subtitle: "S3 E12 · Cricket", poster: poster("#3498db", "#1abc9c", "Bluey") },
      { id: "jf3", name: "Dune: Part Two", subtitle: "Film", poster: poster("#b9770e", "#1c1c1c", "Dune"), positionMs: 12 * MIN, runtimeMs: 166 * MIN },
    ],
  },
  guideFrom: midnight() - 4 * HOUR,
  guideTo: midnight() + 7 * DAY,
};

const fake = {
  status: {
    hubUrl: "http://192.168.0.19:8095",
    appName: "UltimateTV",
    reason: "The Hub stopped answering",
    since: AT - 5 * MIN,
    addresses: ["192.168.0.70"],
    profile: { name: "Family", kids: false },
    hubBack: false,
  },
  view,
  downloads: {
    items: [
      { id: "1", status: "done", name: "Paddington 2", subtitle: "Film · 1h 43m", req: { kind: "title", id: "a" }, artwork: poster("#c0392b", "#2c3e50", "Paddington 2"), positionMs: 1_900_000, durationMs: 6_180_000, addedAt: 3 },
      { id: "2", status: "done", name: "Bluey", subtitle: "S3 E12 · Cricket", req: { kind: "title", id: "b" }, artwork: poster("#3498db", "#1abc9c", "Bluey"), addedAt: 2 },
      { id: "3", status: "done", name: "The Great British Bake Off", subtitle: "Channel 4 · Tue 27 Oct", req: { kind: "recording", id: "c" }, artwork: poster("#e67e22", "#8e44ad", "Bake Off"), addedAt: 1 },
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
    limitedView: ok(f.view),
    limitedPlay: ok({ ok: true, title: "The One Show", live: true }),
    localCopy: ok(null),
    play: ok(undefined),
    stop: ok(undefined),
    pause: ok(undefined),
    seek: ok(undefined),
    setLayout: ok(undefined),
    downloads: ok(f.downloads),
    cast: ok(f.cast),
    launchApp: ok(undefined),
    retryHub: ok(undefined),
    tvStandby: ok(undefined),
    onState: () => () => undefined,
    onDownloads: () => () => undefined,
    onCast: () => () => undefined,
  };
  // A fixed evening, so the clock in the picture doesn't change.
  const at = f.view.at + 4 * 60_000;
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
await page.waitForTimeout(700);
const file = path.join(root, "docs/screenshots/offline-box.png");
await page.screenshot({ path: file });
await browser.close();
console.log(`Saved ${path.relative(root, file)}`);
