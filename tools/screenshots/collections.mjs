#!/usr/bin/env node
// Captures the Sport tonight screenshots (docs/screenshots/collections/*.png) against a Hub in demo
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
const out = path.join(root, "docs/screenshots/collections");
const port = Number(process.env.PORT ?? 18099);
const base = `http://127.0.0.1:${port}`;

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-collections-"));
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

  // Home: the Collections row.
  const row = page.locator("section.rail", { hasText: "Collections" });
  await row.locator(".card").first().focus();
  await wait(900);
  await shot("home-collections");

  // OK on a collection: its films in release order.
  await key("Enter");
  await wait(1200);
  await shot("collection");
  await page.keyboard.press("Escape");
  await wait(800);

  // Films: the Collections chip.
  await page.goto(`${base}/app/`);
  await wait(1500);
  await page.locator("button, a", { hasText: /^Films$/ }).first().focus();
  await key("Enter");
  await wait(1500);
  await page.locator("button.chip", { hasText: "Collections" }).first().focus();
  await key("Enter");
  await wait(1000);
  await shot("films-collections");

  // A film's page: Part of the collection, and Next in collection.
  await page.goto(`${base}/app/`);
  await wait(1500);
  await page.locator("button, a", { hasText: /^Films$/ }).first().focus();
  await key("Enter");
  await wait(1500);
  await page.locator(".card", { hasText: "Copper Sky" }).first().focus();
  await key("Enter");
  await wait(2000);
  await page.locator("section.rail", { hasText: "Part of the Copper Sky" }).locator(".card").first().focus();
  await wait(900);
  await shot("film-page");
} finally {
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error("Page errors:", errors);
  process.exitCode = 1;
}
