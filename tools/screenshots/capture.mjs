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

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-shots-"));
  const hub = spawn(process.execPath, [path.join(root, "hub/dist/index.js")], {
    env: { ...process.env, DEMO: "1", PORT: String(port), HOST: "127.0.0.1", DATA_DIR: path.join(tmp, "data"), CLIPS_DIR: path.join(tmp, "clips"), MEDIA_ROOT: path.join(tmp, "media") },
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

  await page.goto(`${base}/app/`);
  await wait(1200);
  await shot("01-profiles");

  await key("Enter");
  await wait(1500);
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
  await key("Escape");

  await tab("TV Shows");
  await wait(1200);
  await page.locator(".card", { hasText: "Harbour Lights" }).first().focus();
  await key("Enter");
  await wait(1500);
  await key("ArrowDown", 2);
  await shot("12-series-details");
  await key("Escape");

  await page.locator(".tab-icon").first().focus();
  await key("Enter");
  await wait(600);
  await page.locator(".search-box input").focus();
  await page.keyboard.type("harb");
  await wait(400);
  await page.locator(".key").first().focus();
  await wait(1500);
  await shot("13-search");

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
  await key("ArrowDown", 5);
  await wait(800);
  await shot("18-settings-phone-remote");

  // Music video channels: the list in Settings, one channel, watching it and its guide.
  await page.locator(".settings-nav-item", { hasText: "Music channels" }).first().focus();
  await wait(1200);
  await shot("32-settings-music");
  await key("ArrowRight");
  await key("ArrowDown");
  await key("Enter");
  await wait(1500);
  await shot("33-music-channel");
  await key("Enter");
  await wait(2000);
  await shot("34-music-live");
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
  // Spotify before anyone has signed in on the box.
  await page.goto(`${base}/app/?demo-music=pair`);
  await wait(1500);
  await tab("Music");
  await wait(1500);
  await key("ArrowDown");
  await shot("31-music-spotify-sign-in");

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
  await key("Escape");

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
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "22-phone-remote.png") });
  console.log("  22-phone-remote.png");
  // Voice control, as the Android app hands over what it heard.
  await phone.evaluate(() => window.utvVoiceResult("watch BBC One"));
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: path.join(out, "25-phone-voice.png") });
  console.log("  25-phone-voice.png");
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
  await phone.click('[data-tab="remote"]');
  // Stats for the box and the Hub.
  await phone.goto(`${base}/setup/stats.html`);
  await phone.waitForTimeout(3000);
  await phone.screenshot({ path: path.join(out, "40-phone-stats.png"), fullPage: true });
  console.log("  40-phone-stats.png");
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(800);
  await phone.click("#settings");
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "23-phone-setup.png"), fullPage: true });
  console.log("  23-phone-setup.png");
} finally {
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`Page errors:\n${errors.join("\n")}`);
  process.exit(1);
}
