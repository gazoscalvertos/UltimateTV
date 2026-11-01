#!/usr/bin/env node
// Captures the screenshots in docs/screenshots by driving the TV UI with key presses against a
// Hub in demo mode, the same way the remote would.
//
//   npm run build && npm run screenshots
//
// Needs Playwright with Chromium (`npx playwright install chromium` if it isn't already there).

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "docs/screenshots");
const port = Number(process.env.PORT ?? 18095);
const base = `http://127.0.0.1:${port}`;

/** A made-up doorbell camera picture for the pop-up screenshot. */
const DOORBELL_SNAPSHOT = `<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".75"/></radialGradient></defs>
  <rect width="1280" height="720" fill="#5d6b5a"/><rect y="470" width="1280" height="250" fill="#8a8478"/><rect x="0" y="0" width="1280" height="140" fill="#a9c4d8"/>
  <rect x="80" y="120" width="300" height="360" fill="#3d4a3a" rx="30"/><rect x="900" y="160" width="300" height="320" fill="#3f4c3d" rx="30"/>
  <rect x="560" y="300" width="160" height="12" fill="#6f6556"/>
  <path d="M520 720c10-150 60-250 120-260s110 110 120 260z" fill="#c45a1c"/><rect x="560" y="470" width="160" height="22" fill="#2a2a2a"/>
  <circle cx="640" cy="390" r="62" fill="#e0b48f"/><path d="M578 380c0-50 30-75 62-75s62 25 62 75c-10-25-30-40-62-40s-52 15-62 40z" fill="#3b2a1e"/>
  <rect x="690" y="500" width="150" height="110" fill="#b88a55" stroke="#8c6638" stroke-width="4"/><path d="M690 540h150" stroke="#d8c39f" stroke-width="10"/>
  <rect width="1280" height="720" fill="url(#v)"/>
  <text x="34" y="56" font-family="monospace" font-size="30" fill="#fff">FRONT DOOR</text><text x="1246" y="56" text-anchor="end" font-family="monospace" font-size="30" fill="#fff">25/10/2026 18:42:07</text>
</svg></body>`;

/** A ghost on a transparent background, for the built jump scare's screenshot. */
const GHOST_PICTURE = `<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="400" height="520" viewBox="0 0 100 130">
  <path d="M50 6c22 0 36 17 36 40v72c0 5-6 7-9 3l-7-9-8 10c-3 4-8 4-11 0l-7-9-8 9c-3 4-9 2-9-3V46C27 23 28 6 50 6z" fill="#f4f7ff" opacity="0.92"/>
  <ellipse cx="38" cy="46" rx="6" ry="8" fill="#1b1030"/><ellipse cx="62" cy="46" rx="6" ry="8" fill="#1b1030"/><ellipse cx="50" cy="70" rx="9" ry="12" fill="#1b1030"/>
</svg></body>`;

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-shots-"));
  const hub = spawn(process.execPath, [path.join(root, "hub/dist/index.js")], {
    env: { ...process.env, DEMO: "1", PORT: String(port), HOST: "127.0.0.1", DATA_DIR: path.join(tmp, "data"), CLIPS_DIR: path.join(tmp, "clips"), MEDIA_ROOT: path.join(tmp, "media"), BACKUP_DIR: path.join(tmp, "nas-backups") },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { hub, tmp };
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  hub.kill();
  throw new Error("The Hub didn't start");
}

const { hub, tmp } = await startHub();
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => errors.push(e.message));
  const wait = (ms = 700) => page.waitForTimeout(ms);
  const key = async (name, times = 1) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(name);
      await wait(180);
    }
    await wait(400);
  };
  const shot = async (name) => {
    await wait(500);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`  ${name}.png`);
  };
  const tab = async (label) => {
    await page.locator(".tab", { hasText: label }).first().focus();
    await key("Enter");
    await wait(900);
  };

  // A clock that runs as normal but can jump ahead, for the end of a music video.
  await page.clock.install();
  await page.goto(`${base}/app/`);
  await wait(1200);
  // The TV paired itself (the first screen is trusted); the phone's calls below send its key.
  const tvToken = (await page.context().cookies()).find((c) => c.name === "utv_device")?.value;
  if (!tvToken) throw new Error("The TV app didn't pair with the Hub");
  const asTv = { "X-Device-Token": tvToken };
  // The plain dark theme for the screenshots, whatever the season is on the day they're taken.
  await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ theme: "default", seasonal: false }) });
  await page.goto(`${base}/app/`);
  await wait(1200);
  await shot("01-profiles");

  await key("Enter");
  await wait(1500);
  // A TV that has never shown What's new pops up the newest day's changes on Home, once.
  await page.waitForSelector(".whatsnew-dialog", { timeout: 5000 });
  await shot("113-whats-new");
  await key("Escape");
  await wait(600);
  await shot("02-home");
  await key("ArrowDown", 2);
  await shot("03-home-rails");

  await tab("TV Guide");
  await wait(1200);
  await shot("04-guide");
  await key("ArrowRight", 2);
  await key("ArrowDown");
  await key("F6");
  await wait(900);
  await shot("05-programme-card");
  await key("Escape");
  await key("F1");
  await wait(600);
  await shot("06-record-series-link");
  await key("Escape");

  // Live TV with the banner, then browse to another channel's now and next.
  await key("Escape");
  await key("Escape");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" })));
  await wait(1500);
  await shot("07-live-banner");
  await key("ArrowUp");
  await shot("08-live-browse");
  await key("Escape");
  await key("Escape");
  await key("Escape");
  await wait(800);

  await page.goto(`${base}/app/`);
  await wait(1500);
  await tab("Films");
  await wait(1200);
  await shot("09-films");

  await page.locator(".card", { hasText: "Copper Sky" }).first().focus();
  await key("Enter");
  await wait(1500);
  await shot("10-film-details");
  await key("F3");
  await wait(1000);
  await shot("11-versions");
  await key("Escape");
  // Green queues the film.
  await key("F2");
  await wait(300);
  await shot("54-film-queued");
  await key("Escape");

  await tab("TV Shows");
  await wait(1200);
  await page.locator(".card", { hasText: "Harbour Lights" }).first().focus();
  await key("Enter");
  await wait(1500);
  await key("ArrowDown", 2);
  await shot("12-series-details");
  // Green on an episode queues it, after the film.
  await key("ArrowRight");
  await key("F2");
  await key("Escape");

  // The queue on Home, and what selecting something in it offers.
  await tab("Home");
  await wait(1200);
  await key("ArrowDown");
  await wait(600);
  await shot("55-home-queue");
  await key("Enter");
  await wait(600);
  await shot("56-queue-actions");
  await key("Escape");

  // A few recent searches on each profile, newest last.
  for (const p of (await (await fetch(`${base}/api/profiles`, { headers: asTv })).json()).profiles ?? []) {
    for (const q of ["Lakeside", "football", "bake off", "bbc one", "Harbour Lights"]) {
      await fetch(`${base}/api/search/history`, { method: "POST", headers: { ...asTv, "X-Profile": p.id, "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
    }
  }
  await page.locator(".tab-icon").first().focus();
  await key("Enter");
  await wait(600);
  await page.locator(".search-box input").focus();
  await page.keyboard.type("harb");
  await wait(400);
  await page.locator(".key").first().focus();
  await wait(1500);
  await shot("13-search");
  // Recent searches before anything is typed, with Clear on each and Clear all.
  await page.locator(".search-box input").fill("");
  await page.locator(".search-box input").dispatchEvent("input");
  await wait(400);
  await page.locator(".recent-clear").nth(1).focus();
  await wait(600);
  await shot("124-search-recent");

  await page.goto(`${base}/app/`);
  await wait(1500);
  await tab("Recordings");
  await wait(1000);
  await shot("14-recordings");
  await key("ArrowRight", 2);
  await wait(600);
  await shot("15-series-links");

  await tab("Settings");
  await wait(1000);
  await shot("16-settings-profiles");
  await key("ArrowRight");
  await key("Enter");
  await wait(600);
  await shot("17-profile-menu");
  await key("Escape");
  await key("ArrowLeft");
  // A phone pairs with the TV's code, so the list shows it.
  const { code } = await (await fetch(`${base}/api/pair/code`, { headers: asTv })).json();
  const phonePairing = await (await fetch(`${base}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Gary's Pixel" }) })).json();
  if (!phonePairing.token) throw new Error(`The phone didn't pair: ${JSON.stringify(phonePairing)}`);
  await key("ArrowDown", 5);
  await wait(1200);
  await shot("18-settings-phone-remote");
  // The QR codes and links for downloading the two Android apps.
  await page.locator(".settings-nav-item", { hasText: "Android apps" }).first().focus();
  await wait(1200);
  await shot("63-settings-android-apps");

  // Music video channels: the list in Settings, one channel, watching it and its guide.
  await page.locator(".settings-nav-item", { hasText: "Music channels" }).first().focus();
  await wait(1200);
  await shot("32-settings-music");
  await key("ArrowRight");
  await key("ArrowDown");
  await key("Enter");
  await wait(1500);
  await shot("33-music-channel");
  // Halloween TV also follows a YouTube playlist that's still downloading.
  await key("Escape");
  await wait(1200);
  await page.locator(".setting-row", { hasText: "Halloween TV" }).first().focus();
  await key("Enter");
  await wait(1500);
  await shot("108-music-playlist");
  await key("Escape");
  await wait(1200);
  await page.locator(".setting-row", { hasText: "Clubland TV" }).first().focus();
  await key("Enter");
  await wait(1500);
  await key("Enter");
  await wait(2000);
  await shot("34-music-live");
  // Once the banner goes, the song's caption; then, near the end of the video, what's next.
  await wait(6000);
  await shot("41-music-caption");
  const nn = await (await fetch(`${base}/api/nownext?ids=mix:clubland-tv`)).json();
  const end = nn.items[0]?.now?.end;
  if (end) await page.clock.fastForward(Math.max(0, end - (await page.evaluate(() => Date.now())) - 3500));
  await wait(1200);
  await shot("42-music-caption-next");
  await key("Escape");
  await key("Escape");
  await page.goto(`${base}/app/`);
  await wait(1500);
  await tab("TV Guide");
  await wait(1200);
  await page.locator(".guide-lists .chip", { hasText: "Music" }).first().focus();
  await key("Enter");
  await wait(1200);
  await shot("35-music-guide");

  // Custom guides: pick one from the lists above the grid, then build one.
  await page.goto(`${base}/app/`);
  await wait(1500);
  await tab("TV Guide");
  await wait(1200);
  await page.locator(".guide-lists .chip", { hasText: "Evenings" }).first().focus();
  await key("Enter");
  await wait(1000);
  await shot("25-custom-guide");
  await page.locator(".guide-lists .chip", { hasText: "Edit" }).first().focus();
  await key("Enter");
  await wait(1200);
  await key("ArrowDown", 3);
  await key("Enter");
  await key("ArrowRight");
  await key("ArrowDown", 2);
  await key("Enter");
  await key("ArrowUp");
  await shot("26-guide-builder");
  await key("Escape");
  await key("Escape");
  await key("Enter");
  await wait(800);

  // Channels by name in search, with what's on them now.
  await page.goto(`${base}/app/`);
  await wait(1500);
  await page.locator(".tab-icon").first().focus();
  await key("Enter");
  await wait(600);
  await page.locator(".search-box input").focus();
  await page.keyboard.type("bbc");
  await wait(400);
  await page.locator(".key").first().focus();
  await wait(1500);
  await shot("27-search-channels");

  // Music: what's playing, the Spotify library, then a playlist's songs.
  await page.goto(`${base}/app/`);
  await wait(1500);
  await tab("Music");
  await wait(1500);
  await shot("28-music");
  await key("ArrowDown", 2);
  await shot("29-music-library");
  await page.locator(".card", { hasText: "Clubland Classics" }).first().focus();
  await key("Enter");
  await wait(1500);
  await key("ArrowDown", 3);
  await shot("30-music-playlist");
  await key("Escape");
  // Spotify before anyone has signed in on the box: from the Spotify app, or with a code.
  await page.goto(`${base}/app/?demo-music=phone`);
  await wait(1500);
  await tab("Music");
  await wait(1500);
  await key("ArrowDown");
  await shot("31-music-spotify-sign-in");
  await page.goto(`${base}/app/?demo-music=pair`);
  await wait(1500);
  await tab("Music");
  await wait(1500);
  await key("ArrowDown");
  await shot("31-music-spotify-code");

  // Play a film for the on-screen display.
  await page.goto(`${base}/app/`);
  await wait(1500);
  await key("Enter");
  await wait(2000);
  await key("ArrowUp");
  await shot("19-film-playing");
  // The playback stats overlay (blue button).
  await key("b");
  await wait(1500);
  await shot("24-playback-stats");
  await key("b");
  // A news flash from the phone, over the film.
  await fetch(`${base}/api/flash`, { method: "POST", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ text: "Dinner is ready: pause the film and come to the table", seconds: 60 }) });
  await wait(1200);
  await shot("43-news-flash");
  await fetch(`${base}/api/flash`, { method: "DELETE", headers: asTv });
  // Pop-ups: the doorbell camera's picture in the middle (OK closes it), then two in the corners.
  const camera = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await camera.setContent(DOORBELL_SNAPSHOT);
  const snapshot = await camera.screenshot({ type: "jpeg", quality: 85 });
  await camera.close();
  await fetch(`${base}/api/notify?kind=doorbell&title=${encodeURIComponent("Someone's at the front door")}&text=${encodeURIComponent("Parcel delivery")}&seconds=60`, { method: "POST", headers: { ...asTv, "Content-Type": "image/jpeg" }, body: snapshot });
  await wait(1200);
  await shot("45-notice-doorbell");
  await key("Enter");
  if (await page.locator(".notice").count()) errors.push("OK didn't close the doorbell pop-up");
  const notify = (body) => fetch(`${base}/api/notify`, { method: "POST", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await notify({ kind: "meeting", title: "Team call in 5 minutes", text: "Weekly planning, Teams link on your laptop", sound: "none" });
  await notify({ kind: "info", title: "Washing machine finished", text: "Time to hang it out", size: "small", sound: "none" });
  await wait(1200);
  await shot("46-notice-corners");
  await fetch(`${base}/api/notify`, { method: "DELETE", headers: asTv });
  await key("Escape");

  // A jump scare cut into the film (no clips uploaded, so the TV draws its own). Halloween's
  // clips, whatever the date the screenshots are taken.
  const scares = (p, body) => fetch(`${base}/api/scares${p}`, { method: body === undefined ? "GET" : "POST", headers: { ...asTv, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then((r) => r.json());
  await fetch(`${base}/api/scares`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ season: "halloween" }) });
  await fetch(`${base}/api/scares/now`, { method: "POST", headers: { ...asTv, "Content-Type": "application/json" }, body: "{}" });
  await wait(900);
  await shot("49-jump-scare");
  await key("Enter");
  if (await page.locator(".jump-scare").count()) errors.push("OK didn't close the jump scare");
  // A built scare: a transparent ghost placed bottom right over the film.
  const ghostPage = await browser.newPage({ viewport: { width: 400, height: 520 } });
  await ghostPage.setContent(GHOST_PICTURE);
  const ghost = await ghostPage.screenshot({ type: "png", omitBackground: true });
  await ghostPage.close();
  const { clip: ghostClip } = await (await fetch(`${base}/api/scares/clips?name=Ghost`, { method: "POST", headers: { ...asTv, "Content-Type": "image/png" }, body: ghost })).json();
  const { mix } = await (await fetch(`${base}/api/scares/mixes`, { method: "POST", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Ghost in the corner", visualId: ghostClip.id, spot: "bottom-right", size: "medium" }) })).json();
  await fetch(`${base}/api/scares/now`, { method: "POST", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ mixId: mix.id }) });
  await wait(900);
  await shot("61-jump-scare-placed");
  await key("Enter");
  // Projected clips from the starter packs: a snowman walking by, snow over the film, the Easter bunny.
  for (const id of ["christmas-starter", "easter-starter", "birthday-starter"]) await scares("/library/install", { id, from: "starter" });
  const clipState = await scares("");
  const showClip = async (name, file) => {
    const m = clipState.mixes.find((x) => x.name === name);
    await scares("/now", { mixId: m.id });
    await wait(1200);
    await shot(file);
    await key("Enter");
  };
  await showClip("Snowman walks by", "87-clip-snowman");
  await showClip("Let it snow", "88-clip-snowfall");
  await showClip("Bunny hops across", "89-clip-bunny");
  await showClip("Happy Birthday banner", "90-clip-birthday");
  await key("Escape");
  await key("Escape");

  // The Halloween theme, Spooky TV and the jump scare settings.
  await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ theme: "halloween" }) });
  // The profile is already picked by now, so a reload lands straight on Home.
  await page.goto(`${base}/app/`);
  await wait(1800);
  await shot("50-halloween-home");
  await tab("Settings");
  await wait(1000);
  // A key press first, or the screen puts focus back on its first section as it loads.
  await key("ArrowDown");
  await page.locator(".settings-nav-item", { hasText: "Music channels" }).first().focus();
  await wait(1500);
  await page.locator(".setting-row", { hasText: "Spooky TV" }).first().focus();
  await key("Enter");
  await wait(1500);
  await shot("51-spooky-tv");
  await key("Escape");
  await wait(800);
  await page.locator(".settings-nav-item", { hasText: "Projected clips" }).first().focus();
  await wait(1200);
  await shot("52-settings-jump-scares");
  // The theme picker: moving over a tile tries the theme on the whole app.
  await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ theme: "default", seasonal: true }) });
  await page.goto(`${base}/app/`);
  await wait(1800);
  await tab("Settings");
  await wait(1000);
  await key("ArrowDown");
  await page.locator(".settings-nav-item", { hasText: "Theme" }).first().focus();
  await wait(1000);
  await page.locator(".theme-tile", { hasText: "Cyberpunk" }).first().focus();
  await wait(900);
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "cyberpunk") errors.push("Moving over a theme didn't try it on");
  await shot("63-settings-theme");
  await page.locator(".settings-nav-item", { hasText: "Theme" }).first().focus();
  await wait(600);
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) === "cyberpunk") errors.push("Leaving the theme picker didn't put the theme back");
  await page.locator(".theme-tile", { hasText: "Light" }).first().focus();
  await key("Enter");
  await wait(800);
  if ((await (await fetch(`${base}/api/settings`)).json()).theme !== "light") errors.push("OK on a theme didn't keep it");
  // Home in each theme, with the decorations moving.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const looks = [];
  for (const theme of ["default", "light", "slick", "cyberpunk", "ocean", "forest", "sunset", "halloween", "christmas", "easter", "valentine"]) {
    await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ theme, seasonal: false }) });
    await page.goto(`${base}/app/`);
    await wait(theme === "halloween" ? 1800 : 3000);
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme) errors.push(`The ${theme} theme didn't go on`);
    const png = await page.screenshot();
    looks.push({ theme, png });
    if (["light", "cyberpunk", "christmas", "easter"].includes(theme)) {
      await (await import("node:fs/promises")).writeFile(path.join(out, `64-theme-${theme}.png`), png);
      console.log(`  64-theme-${theme}.png`);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const themeSheet = await browser.newPage({ viewport: { width: 1920, height: 900 } });
  await themeSheet.setContent(
    `<body style="margin:0;padding:16px;background:#05070d;color:#fff;font:600 22px system-ui;display:grid;grid-template-columns:repeat(4,1fr);align-items:start;gap:12px">${looks
      .map((f) => `<figure style="margin:0;position:relative"><img style="width:100%;display:block;border-radius:6px" src="data:image/png;base64,${f.png.toString("base64")}"><figcaption style="position:absolute;left:10px;bottom:8px;padding:2px 8px;border-radius:6px;background:rgba(0,0,0,.6)">${f.theme}</figcaption></figure>`)
      .join("")}</body>`,
  );
  await themeSheet.screenshot({ path: path.join(out, "65-themes.png"), fullPage: true });
  await themeSheet.close();
  console.log("  65-themes.png");
  // Back to the plain theme for the screenshots that follow.
  await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ theme: "default", seasonal: false }) });
  await page.goto(`${base}/app/`);
  await wait(1800);

  // Dimming and the screensaver: the settings, then each theme through "Try it now", put
  // together on one contact sheet (and a few full size).
  await tab("Settings");
  await key("ArrowDown");
  await page.locator(".settings-nav-item", { hasText: "Screensaver" }).first().focus();
  await wait(1200);
  await shot("58-settings-screensaver");
  const themes = ["aurora", "fireplace", "aquarium", "space", "snow", "rain", "ocean", "lava", "fireworks", "halloween", "christmas", "bounce", "landscapes", "art"];
  const frames = [];
  for (const theme of themes) {
    const res = await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ screensaver: { theme, clock: theme !== "bounce" } }) });
    if (!res.ok) throw new Error(`Couldn't choose the ${theme} screensaver: ${await res.text()}`);
    await wait(900);
    await page.locator(".setting-row", { hasText: "Try it now" }).first().focus();
    await key("Enter");
    await wait(theme === "fireworks" ? 5000 : 3500);
    if (!(await page.locator(".screensaver").count())) errors.push(`The ${theme} screensaver didn't start`);
    const png = await page.screenshot();
    frames.push({ theme, png });
    if (["aurora", "fireplace", "halloween", "landscapes"].includes(theme)) {
      await (await import("node:fs/promises")).writeFile(path.join(out, `59-screensaver-${theme}.png`), png);
      console.log(`  59-screensaver-${theme}.png`);
    }
    await key("Escape");
    if (await page.locator(".screensaver").count()) errors.push(`A key didn't close the ${theme} screensaver`);
  }
  const sheet = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await sheet.setContent(`<body style="margin:0;background:#070b14;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px;box-sizing:border-box;height:1080px;font:600 18px system-ui;color:#fff">${frames
    .map((f) => `<figure style="margin:0;position:relative"><img style="width:100%;display:block;border-radius:6px" src="data:image/png;base64,${f.png.toString("base64")}"><figcaption style="position:absolute;left:10px;bottom:8px;text-shadow:0 1px 4px #000">${f.theme}</figcaption></figure>`)
    .join("")}</body>`);
  await sheet.waitForTimeout(500);
  await sheet.screenshot({ path: path.join(out, "60-screensavers.png") });
  console.log("  60-screensavers.png");
  await sheet.close();
  await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ screensaver: { theme: "shuffle", clock: true } }) });

  // Button hints, help, Save for later, Cast and games, a laptop asking to share, the sleep timer,
  // seasonal projections, advert skipping and their settings.
  await page.goto(`${base}/app/?demo-cast`);
  await wait(1800);
  const json = (url, body, method = "POST") => fetch(`${base}${url}`, { method, headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  // Two films saved for later (not Copper Sky: its page saves it with the red button below).
  const rails = (await (await fetch(`${base}/api/home`, { headers: asTv })).json()).rails;
  const films = [...new Map(rails.flatMap((r) => r.items ?? []).filter((t) => t.kind === "movie" && t.name !== "Copper Sky").map((t) => [t.id, t])).values()];
  for (const f of films.slice(0, 3)) await json("/api/watchlist", { title: f });
  await json("/api/watchlist", { name: "The Long Field", from: "voice" });
  await page.goto(`${base}/app/?demo-cast`);
  await wait(1800);
  await shot("70-home-key-hints");
  await key("F6");
  await wait(600);
  await shot("71-help-buttons");
  await key("Escape");
  await key("ArrowDown", 2);
  await shot("72-home-saved-for-later");
  await page.goto(`${base}/app/?demo-cast`);
  await wait(1500);
  await tab("Films");
  await wait(1200);
  await page.locator(".card", { hasText: "Copper Sky" }).first().focus();
  await key("Enter");
  await wait(1500);
  await key("F1");
  await wait(300);
  await shot("73-details-save-for-later");
  // More like this, at the bottom of the same page.
  await page.locator(".details .rail .card").first().focus();
  await wait(1200);
  await shot("105-more-like-this");
  // The subtitle rows in Settings › Picture and sound.
  await tab("Settings");
  await wait(1200);
  await key("ArrowDown");
  await wait(1000);
  await shot("107-settings-subtitles");
  await page.goto(`${base}/app/?demo-cast`);
  await wait(1500);
  await key("F4");
  await wait(1500);
  await shot("74-cast-and-games");
  // A laptop asks to share its screen: a real WebRTC offer from another page.
  const laptop = await browser.newPage();
  const offer = await laptop.evaluate(async () => {
    const pc = new RTCPeerConnection();
    pc.addTransceiver("video", { direction: "sendonly" });
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => (pc.iceGatheringState === "complete" ? r() : (pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(), setTimeout(r, 2000))));
    return pc.localDescription.sdp;
  });
  await laptop.close();
  await json("/api/cast/share", { name: "Gary's laptop", sdp: offer, surface: "monitor" });
  await wait(1200);
  await shot("75-screen-share-ask");
  await key("Escape");
  // The sleep timer over a film, a minute before it goes off.
  await page.goto(`${base}/app/?demo-cast`);
  await wait(1500);
  await key("Enter");
  await wait(2000);
  await json("/api/tv/sleep", { minutes: 1 });
  await wait(1500);
  await shot("76-sleep-still-watching");
  await key("Escape");
  await key("F3");
  await wait(600);
  await page.locator(".option-list .option", { hasText: "Off: set one" }).first().focus().catch(() => undefined);
  await shot("77-options-sleep-timer");
  await key("Escape");
  // Seasonal projections over the film.
  await json("/api/projections/now", { drawn: "sleigh", season: "christmas" });
  await wait(4200);
  await shot("78-projection-sleigh");
  await key("Escape");
  await json("/api/projections/now", { drawn: "bunny", season: "easter" });
  await wait(3500);
  await shot("79-projection-bunny");
  await key("Escape");
  await key("Escape");
  await key("Escape");
  // A recording with its adverts found.
  await json("/api/tv/call/play", { req: { kind: "recording", id: "demo-done-wild-islands-5" } });
  await wait(2500);
  await json("/api/tv/call/seek", { ms: 2 * 60_000, mode: "absolute" });
  await wait(1500);
  await shot("80-skip-adverts");
  await key("Escape");
  await key("Escape");
  await page.goto(`${base}/app/?demo-cast`);
  await wait(1500);
  await tab("Settings");
  await key("ArrowDown");
  for (const [section, name] of [["Seasonal clips", "81-settings-seasonal-clips"], ["Cast and games", "82-settings-cast"], ["Alerts", "83-settings-alerts"]]) {
    await page.locator(".settings-nav-item", { hasText: section }).first().focus();
    await wait(1500);
    await shot(name);
  }
  // The weather (demo mode makes it up for Leeds): Home's corner, the forecast, a day ahead, its settings.
  await page.goto(`${base}/app/`);
  await wait(1800);
  await shot("97-home-weather");
  await page.locator(".weather-chip").focus();
  await key("Enter");
  await wait(1200);
  await shot("98-weather");
  await key("ArrowDown", 2);
  await shot("99-weather-day");
  await key("Escape");
  await tab("Settings");
  await key("ArrowDown");
  await page.locator(".settings-nav-item", { hasText: "Weather" }).first().focus();
  await wait(1200);
  await shot("100-settings-weather");

  // The Hub's nightly backup in Settings › About, after a couple of backups.
  for (let i = 0; i < 2; i++) await fetch(`${base}/api/backup`, { method: "POST", headers: asTv });
  await page.locator(".settings-nav-item", { hasText: "About" }).first().focus();
  await wait(1500);
  await shot("103-settings-backup");
  // Every change, from the Hub's CHANGELOG.md.
  await page.locator(".settings-nav-item", { hasText: "What's new" }).first().focus();
  await wait(1500);
  await shot("114-settings-whats-new");

  // Accessibility for the Family profile: 150% text and the bold focus ring, on Settings, Home,
  // the guide and a film's page (the screens most likely to break with bigger text).
  await json("/api/profiles/family", { accessibility: { textScale: 150, highContrast: true, reducedMotion: true } }, "PATCH");
  await page.goto(`${base}/app/`);
  await wait(1500);
  if ((await page.evaluate(() => document.documentElement.dataset.textScale)) !== "150") errors.push("The profile's text size wasn't put on");
  await tab("Settings");
  await key("ArrowDown");
  await page.locator(".settings-nav-item", { hasText: "Accessibility" }).first().focus();
  await wait(1200);
  await key("ArrowRight");
  await key("ArrowDown");
  await shot("118-settings-accessibility");
  await page.goto(`${base}/app/`);
  await wait(1500);
  await shot("119-home-large-text");
  await tab("TV Guide");
  await wait(1500);
  await key("ArrowRight");
  await shot("120-guide-large-text");
  await page.goto(`${base}/app/`);
  await wait(1500);
  await tab("Films");
  await wait(1200);
  await page.locator(".card", { hasText: "Copper Sky" }).first().focus();
  await key("Enter");
  await wait(1500);
  await shot("121-details-large-text");
  await json("/api/profiles/family", { accessibility: null }, "PATCH");
  await page.goto(`${base}/app/`);
  await wait(1500);

  // Kids profile.
  await page.locator(".avatar-small").first().focus();
  await key("Enter");
  await wait(800);
  await key("ArrowRight");
  await key("Enter");
  await wait(1800);
  await shot("20-kids-home");
  await tab("TV Guide");
  await wait(1500);
  await shot("21-kids-guide");

  // Phone remote and phone setup.
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  phone.on("pageerror", (e) => errors.push(`phone: ${e.message}`));
  // Unpaired, the remote asks for the TV's code first.
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.fill(".utv-pair .code", "K7QM-4XPD");
  await phone.screenshot({ path: path.join(out, "48-phone-pair.png") });
  console.log("  48-phone-pair.png");
  await phone.context().addCookies([{ name: "utv_device", value: phonePairing.token, url: base }]);
  // The first time, the remote says what's new; tapping the banner lists it.
  await phone.goto(`${base}/remote/`);
  await phone.waitForSelector("#news-banner:not([hidden])", { timeout: 5000 });
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: path.join(out, "115-phone-whats-new.png") });
  console.log("  115-phone-whats-new.png");
  await phone.click("#news-banner");
  await phone.waitForTimeout(600);
  await phone.screenshot({ path: path.join(out, "116-phone-whats-new-list.png") });
  console.log("  116-phone-whats-new-list.png");
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "22-phone-remote.png") });
  console.log("  22-phone-remote.png");
  // Voice control, as the Android app hands over what it heard.
  await phone.evaluate(() => window.utvVoiceResult("watch BBC One"));
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "25-phone-voice.png") });
  console.log("  25-phone-voice.png");
  // The queue from the phone: what plays next on the TV.
  // The TV is on the Kids profile now, which hides the films queued earlier: queue two CBBC
  // programmes from earlier today, to watch on catch-up.
  const { channels: all } = await (await fetch(`${base}/api/channels`, { headers: asTv })).json();
  const cbbc = all.find((c) => c.name === "CBBC");
  const { programmes } = await (await fetch(`${base}/api/channels/${cbbc.id}/programmes?from=${Date.now() - 4 * 3600_000}&limit=6`, { headers: asTv })).json();
  for (const p of programmes.filter((x) => x.end < Date.now()).slice(-2)) {
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { ...asTv, "Content-Type": "application/json" },
      body: JSON.stringify({ req: { kind: "catchup", id: p.id, start: p.start }, name: p.title, subtitle: `CBBC · ${new Date(p.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`, ...(p.image ? { image: p.image } : {}) }),
    });
  }
  await phone.locator('[data-tab="browse"]').click();
  await phone.locator('[data-browse="queue"]').click();
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "57-phone-queue.png") });
  console.log("  57-phone-queue.png");
  await phone.goto(`${base}/music-login/`);
  await phone.waitForTimeout(600);
  await phone.screenshot({ path: path.join(out, "36-phone-deezer-login.png") });
  console.log("  36-phone-deezer-login.png");
  // Browsing on the phone and playing on the TV.
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click('[data-tab="browse"]');
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "37-phone-guide.png") });
  console.log("  37-phone-guide.png");
  await phone.click('[data-browse="movie"]');
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "38-phone-films.png") });
  console.log("  38-phone-films.png");
  await phone.locator(".poster").first().click();
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "39-phone-title.png") });
  console.log("  39-phone-title.png");
  await phone.locator("#sheet [data-close]").first().click();
  // The phone's Music page before Spotify is signed in on the TV.
  await page.goto(`${base}/app/?demo-music=phone`);
  await wait(2000);
  await phone.click('[data-browse="music"]');
  await phone.waitForTimeout(2000);
  await phone.screenshot({ path: path.join(out, "36-phone-music-sign-in.png") });
  console.log("  36-phone-music-sign-in.png");
  // The phone's Search shows the same recent searches as the TV.
  await phone.click('[data-browse="search"]');
  await phone.waitForSelector(".recent-row", { timeout: 5000 });
  await phone.screenshot({ path: path.join(out, "125-phone-search-recent.png") });
  console.log("  125-phone-search-recent.png");
  await page.goto(`${base}/app/`);
  await wait(1500);
  await phone.click('[data-tab="remote"]');
  // Stats for the box and the Hub.
  await phone.goto(`${base}/setup/stats.html`);
  await phone.waitForTimeout(3000);
  await phone.screenshot({ path: path.join(out, "40-phone-stats.png"), fullPage: true });
  console.log("  40-phone-stats.png");
  // Writing a news flash.
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click("#news-btn");
  await phone.waitForTimeout(600);
  await phone.fill("#fl-text", "Dinner is ready: pause the film and come to the table");
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: path.join(out, "44-phone-news.png") });
  console.log("  44-phone-news.png");
  // Sending a pop-up.
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click("#notify-btn");
  await phone.waitForTimeout(600);
  await phone.click('#pu-kind [data-v="doorbell"]');
  await phone.fill("#pu-title", "Someone's at the front door");
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: path.join(out, "47-phone-popup.png") });
  console.log("  47-phone-popup.png");
  // Jump scares from the phone.
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click("#scare-btn");
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "53-phone-scares.png") });
  console.log("  53-phone-scares.png");
  await phone.click("#sc-build");
  await phone.waitForTimeout(600);
  await phone.click('#bd-where [data-v="bottom-right"]');
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: path.join(out, "62-phone-build-scare.png") });
  console.log("  62-phone-build-scare.png");
  // Cast from the phone, and the sleep timer.
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click("#cast-btn");
  await phone.waitForTimeout(1500);
  await phone.fill("#ca-url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await phone.screenshot({ path: path.join(out, "84-phone-cast.png") });
  console.log("  84-phone-cast.png");
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.evaluate(() => document.getElementById("np-sleep").click());
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: path.join(out, "85-phone-sleep-timer.png") });
  console.log("  85-phone-sleep-timer.png");
  // The remote turned sideways: d-pad in the middle, the tab bar down the side.
  await phone.setViewportSize({ width: 915, height: 412 });
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "110-phone-remote-landscape.png") });
  console.log("  110-phone-remote-landscape.png");
  await phone.click("#num-toggle");
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: path.join(out, "111-phone-remote-landscape-numbers.png") });
  console.log("  111-phone-remote-landscape-numbers.png");
  await phone.click('[data-tab="browse"]');
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "112-phone-guide-landscape.png") });
  console.log("  112-phone-guide-landscape.png");
  // Every remote button has to be on screen sideways, on big and small phones alike, numbers open or not.
  for (const [width, height] of [[915, 412], [844, 390], [640, 360]]) {
    await phone.setViewportSize({ width, height });
    await phone.goto(`${base}/remote/`);
    await phone.waitForTimeout(600);
    for (const numbers of [false, true]) {
      if (numbers) await phone.click("#num-toggle");
      const off = await phone.evaluate(() => [...document.querySelectorAll("#tab-remote button, #tab-remote input, .tabbar > *")]
        .filter((el) => el.offsetParent)
        .filter((el) => { const r = el.getBoundingClientRect(); return r.top < 0 || r.left < 0 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5; })
        .map((el) => el.getAttribute("aria-label") || el.dataset.key || el.textContent.trim() || el.id));
      if (off.length) errors.push(`phone ${width}x${height}${numbers ? " with numbers" : ""}: off screen: ${off.join(", ")}`);
    }
  }
  await phone.setViewportSize({ width: 412, height: 915 });
  // The laptop's screen-share page.
  await phone.setViewportSize({ width: 1280, height: 800 });
  await phone.goto(`${base}/cast/`);
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "86-laptop-share-page.png") });
  console.log("  86-laptop-share-page.png");
  await phone.setViewportSize({ width: 412, height: 915 });
  // Projected clips: the sheet at Christmas, packs to browse, a walking clip being built, a share link.
  await fetch(`${base}/api/scares`, { method: "PUT", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ season: "christmas" }) });
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click("#scare-btn");
  await phone.waitForTimeout(900);
  await phone.screenshot({ path: path.join(out, "91-phone-clips.png") });
  console.log("  91-phone-clips.png");
  await phone.locator("#sc-packs").scrollIntoViewIfNeeded();
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(out, "92-phone-clip-packs.png") });
  console.log("  92-phone-clip-packs.png");
  await phone.click("#sc-browse");
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "93-phone-browse-packs.png") });
  console.log("  93-phone-browse-packs.png");
  await phone.click("#br-back");
  await phone.waitForTimeout(900);
  await phone.click("#sc-build");
  await phone.waitForTimeout(600);
  await phone.click('#bd-theme [data-v="christmas"]');
  await phone.locator("#bd-visual .row-btn", { hasText: "Snowman" }).first().click();
  await phone.click('#bd-where [data-v="bottom"]');
  await phone.click('#bd-motion [data-v="walk-right"]');
  await phone.locator("#bd-where").scrollIntoViewIfNeeded();
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(out, "94-phone-build-clip.png") });
  console.log("  94-phone-build-clip.png");
  await phone.click("#bd-back");
  await phone.waitForTimeout(900);
  await phone.click("#sc-share");
  await phone.waitForTimeout(600);
  await phone.fill("#sh-name", "Our Christmas clips");
  await phone.click("#sh-link");
  await phone.waitForTimeout(1200);
  await phone.locator("#sh-out").scrollIntoViewIfNeeded();
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: path.join(out, "95-phone-share-pack.png") });
  console.log("  95-phone-share-pack.png");
  const shareUrl = await phone.inputValue("#sh-url");
  await phone.goto(shareUrl.replace(/^https?:\/\/[^/]+/, base));
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "96-clip-share-page.png") });
  console.log("  96-clip-share-page.png");
  // The weather on the phone: the Watch tab's Weather, and where it's set.
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click('[data-tab="browse"]');
  await phone.click('[data-browse="weather"]');
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: path.join(out, "101-phone-weather.png") });
  console.log("  101-phone-weather.png");
  await phone.goto(`${base}/setup/#weather`);
  await phone.waitForTimeout(1500);
  await phone.locator("#weather").screenshot({ path: path.join(out, "102-phone-setup-weather.png") });
  console.log("  102-phone-setup-weather.png");
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click("#settings");
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "23-phone-setup.png"), fullPage: true });
  console.log("  23-phone-setup.png");
  await phone.locator("#apps").screenshot({ path: path.join(out, "64-phone-android-apps.png") });
  console.log("  64-phone-android-apps.png");
  await phone.locator("#backup").screenshot({ path: path.join(out, "104-phone-backup.png") });
  console.log("  104-phone-backup.png");
  await phone.locator("#whatsnew").screenshot({ path: path.join(out, "117-phone-setup-whats-new.png") });
  console.log("  117-phone-setup-whats-new.png");
  // A profile's accessibility on the phone's setup page.
  await fetch(`${base}/api/profiles/family`, { method: "PATCH", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ accessibility: { audioDescription: true, textScale: 125 } }) });
  await phone.reload();
  await phone.waitForTimeout(1500);
  await phone.locator("#profiles-list .a11y summary").first().click();
  await phone.waitForTimeout(400);
  await phone.locator("#profiles").screenshot({ path: path.join(out, "122-phone-setup-accessibility.png") });
  console.log("  122-phone-setup-accessibility.png");
  await fetch(`${base}/api/profiles/family`, { method: "PATCH", headers: { ...asTv, "Content-Type": "application/json" }, body: JSON.stringify({ accessibility: null }) });
  // A music channel's videos on the phone: the playlist it follows, with its progress and the one that failed.
  const halloween = phone.locator("#mix-list .profile", { hasText: "Halloween TV" });
  await halloween.locator("button", { hasText: "Videos" }).click();
  await phone.waitForTimeout(1200);
  const box = await halloween.boundingBox();
  await phone.screenshot({ path: path.join(out, "109-phone-music-playlist.png"), fullPage: true, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 860) } });
  console.log("  109-phone-music-playlist.png");
  // Guide lists, custom guides and channels on the phone settings page.
  await phone.goto(`${base}/setup/#lists`);
  await phone.waitForTimeout(1500);
  await phone.locator("#cg-list button", { hasText: "Edit" }).first().click();
  await phone.waitForTimeout(400);
  await phone.selectOption("#ch-filter", "sport");
  await phone.evaluate(() => (document.getElementById("toast").hidden = true));
  await phone.waitForTimeout(400);
  await phone.locator("#lists").screenshot({ path: path.join(out, "63-phone-guide-lists.png") });
  console.log("  63-phone-guide-lists.png");
  // The theme on the phone: tapping a tile wears it on the page (and the TV) straight away.
  await phone.click('#themes [data-id="easter"]');
  // Long enough for the "Easter theme on" toast to go.
  await phone.waitForTimeout(4500);
  if ((await phone.evaluate(() => document.documentElement.dataset.theme)) !== "easter") errors.push("Tapping a theme on the phone didn't put it on");
  await phone.locator("#theme").screenshot({ path: path.join(out, "66-phone-theme.png") });
  console.log("  66-phone-theme.png");
  await phone.click('#themes [data-id="cyberpunk"]');
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(1000);
  await phone.screenshot({ path: path.join(out, "67-phone-remote-cyberpunk.png") });
  console.log("  67-phone-remote-cyberpunk.png");
} finally {
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`Page errors:\n${errors.join("\n")}`);
  process.exit(1);
}
