#!/usr/bin/env node
// Drives the Samsung TV app (samsung/) in a desktop browser against a Hub in demo mode, with the remote's
// keys only, and saves the screenshots to docs/screenshots/samsung/. It is also the app's smoke test:
// it fails on a script error or when a key press leaves focus nowhere.
//
//   npm run build && node tools/screenshots/samsung.mjs
//
// The browser is started with web security off because the TV's own Tizen runtime lets the app call the
// Hub across origins (config.xml's <access origin="*">) and a desktop browser does not.

import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "docs/screenshots/samsung");
const port = Number(process.env.PORT ?? 18097);
const hubBase = `http://127.0.0.1:${port}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-samsung-"));
const hub = spawn(process.execPath, [path.join(root, "hub/dist/index.js")], {
  env: { ...process.env, DEMO: "1", PORT: String(port), HOST: "127.0.0.1", DATA_DIR: path.join(tmp, "data"), CLIPS_DIR: path.join(tmp, "clips"), MEDIA_ROOT: path.join(tmp, "media"), BACKUP: "off" },
  stdio: ["ignore", "ignore", "inherit"],
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${hubBase}/api/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error("The Hub didn't start");
  await new Promise((r) => setTimeout(r, 200));
}

const files = http.createServer((req, res) => {
  const rel = new URL(req.url ?? "/", "http://x").pathname.replace(/^\/+/, "") || "index.html";
  const file = path.join(root, "samsung", rel);
  if (!file.startsWith(path.join(root, "samsung")) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => files.listen(0, "127.0.0.1", r));
const appUrl = `http://127.0.0.1:${files.address().port}/`;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--disable-web-security"] });
const errors = [];
let failed = false;

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => r.status() >= 400 && !/webapis/.test(r.url()) && errors.push(`${r.status()} ${r.url()}`));
  await page.addInitScript((hubUrl) => localStorage.setItem("utv.samsung.v1", JSON.stringify({ hub: hubUrl })), hubBase);
  const wait = (ms = 600) => page.waitForTimeout(ms);
  const KEY = { left: 37, up: 38, right: 39, down: 40, enter: 13, back: 10009 };
  const press = async (name, times = 1) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(String(name).length === 1 ? name : { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", enter: "Enter", back: "Escape" }[name]);
      await wait(180);
    }
  };
  void KEY;
  const focused = () => page.evaluate(() => (document.activeElement && document.activeElement.className) || "");
  const shot = async (name, noFocus = false) => {
    await wait(500);
    await page.screenshot({ path: path.join(out, name) });
    if (!noFocus && !(await focused()).includes("f")) {
      console.error(`Focus is nowhere on ${name}`);
      failed = true;
    }
  };
  const goTab = async (label) => {
    await page.evaluate((l) => [...document.querySelectorAll(".tab")].find((t) => t.textContent === l).focus(), label);
    await press("enter");
    await wait(1200);
  };

  await page.goto(appUrl);
  await page.waitForSelector(".profiles .profile, .rail, .empty", { timeout: 20000 });
  await shot("01-profiles.png");
  await press("enter");
  await page.waitForSelector(".rail", { timeout: 20000 });
  await wait(1200);
  await shot("02-home.png");
  await press("down", 2);
  await shot("03-home-rails.png");
  await goTab("TV Guide");
  await shot("04-guide.png");
  await goTab("Films");
  await shot("05-films.png");
  await press("down");
  await press("enter");
  await page.waitForSelector(".details-main", { timeout: 15000 });
  await shot("06-film-details.png");
  await press("back");
  await goTab("TV Shows");
  await press("down");
  await press("enter");
  await page.waitForSelector(".details-main", { timeout: 15000 });
  await wait(700);
  await shot("07-show-details.png");
  await press("back");
  await goTab("Search");
  for (const c of ["t", "h", "e"]) {
    await page.evaluate((k) => [...document.querySelectorAll(".key")].find((t) => t.textContent === k).focus(), c);
    await press("enter");
  }
  await wait(1500);
  await shot("08-search.png");
  // The player: starts, shows its overlay, and Back returns to the screen it came from.
  await goTab("Home");
  await page.evaluate(() => [...document.querySelectorAll(".card")].find((c) => c.querySelector(".card-badge.live")).focus());
  await press("enter");
  await page.waitForSelector("#player", { timeout: 15000 });
  await shot("11-player.png", true);
  await press("back");
  await page.waitForSelector("#player", { state: "detached", timeout: 5000 });
  await goTab("Recordings");
  await shot("09-recordings.png");
  await goTab("Settings");
  await shot("10-settings.png");
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  files.close();
  hub.kill();
}

if (errors.length) {
  console.error("Script errors:\n" + errors.join("\n"));
  failed = true;
}
process.exit(failed ? 1 : 0);
