#!/usr/bin/env node
// Captures the Sport tonight screenshots (docs/screenshots/sport/*.png) against a Hub in demo
// mode: Home's Sport today row, the Sport screen and the options on a game.
//
//   npm run build && node tools/screenshots/sport.mjs

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "docs/screenshots/sport");
const port = Number(process.env.PORT ?? 18098);
const base = `http://127.0.0.1:${port}`;

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-sport-"));
  const hub = spawn(process.execPath, [path.join(root, "hub/dist/index.js")], {
    env: { ...process.env, DEMO: "1", PORT: String(port), HOST: "127.0.0.1", DATA_DIR: path.join(tmp, "data"), CLIPS_DIR: path.join(tmp, "clips"), MEDIA_ROOT: path.join(tmp, "media"), BACKUP: "off" },
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

  await page.goto(`${base}/app/`);
  await wait(1200);
  const tvToken = (await page.context().cookies()).find((c) => c.name === "utv_device")?.value;
  if (!tvToken) throw new Error("The TV app didn't pair with the Hub");
  const asFamily = { "X-Device-Token": tvToken, "X-Profile": "family", "Content-Type": "application/json" };
  // The first-run tour has been seen.
  await fetch(`${base}/api/profiles/me/toured`, { method: "POST", headers: asFamily, body: "{}" });
  await fetch(`${base}/api/settings`, { method: "PUT", headers: asFamily, body: JSON.stringify({ theme: "default", seasonal: false }) });

  // The Family profile follows Arsenal and Formula 1, with automatic reminders.
  await fetch(`${base}/api/sport/settings`, { method: "PUT", headers: asFamily, body: JSON.stringify({ teams: ["Arsenal", "Formula 1"], remind: true }) });

  await page.goto(`${base}/app/`);
  await wait(1200);
  await key("Enter");
  await wait(2500);
  // What's new and the first-run tour pop up the first time, in either order.
  for (let i = 0; i < 4; i++) {
    await wait(1200);
    const gone = page.getByText("Got it", { exact: true });
    const skip = page.getByText("Skip the tour", { exact: true });
    if (await gone.count()) await gone.focus();
    else if (await skip.count()) await skip.focus();
    else break;
    await key("Enter");
  }

  // Home: the Sport today row.
  await page.locator("section.rail", { hasText: "Sport today" }).locator(".card").first().focus();
  await wait(900);
  await shot("home-sport-today");

  // OK on a game.
  await key("Enter");
  await wait(800);
  await shot("game-options");
  await key("Escape");
  await wait(500);

  // The Sport screen.
  await page.locator("button.chip", { hasText: "Sport" }).first().focus();
  await key("Enter");
  await wait(1500);
  await shot("sport-tonight");
  await page.locator(".sport .list-row", { hasText: "Follow a team" }).focus();
  await wait(600);
  await shot("sport-favourites");
} finally {
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error("Page errors:", errors);
  process.exitCode = 1;
}
