#!/usr/bin/env node
// Captures the Coming up screenshots (docs/screenshots/coming-up/*.png) against a Hub in demo
// mode: Home's New episodes row, the Coming up screen, and the Follow button on a series page.
//
//   npm run build && node tools/screenshots/coming-up.mjs

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "docs/screenshots/coming-up");
const port = Number(process.env.PORT ?? 18097);
const base = `http://127.0.0.1:${port}`;

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-cu-"));
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

  // The Family profile follows a few of the demo series (Northern Line is already in Continue watching).
  const rails = (await (await fetch(`${base}/api/home`, { headers: asFamily })).json()).rails;
  const all = [...new Map(rails.flatMap((r) => r.items ?? []).filter((t) => t.kind === "series").map((t) => [t.id, t])).values()];
  const search = async (q) => (await (await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`, { headers: asFamily })).json());
  for (const name of ["Harbour Lights", "Wild Islands", "Kitchen Rivals"]) {
    let t = all.find((x) => x.name === name);
    if (!t) t = (await search(name)).results?.find((r) => r.title?.name === name)?.title;
    if (!t) throw new Error(`No demo series called ${name}`);
    await fetch(`${base}/api/following`, { method: "POST", headers: asFamily, body: JSON.stringify({ title: t }) });
  }

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

  // Home: the New episodes row.
  await page.locator("section.rail", { hasText: "New episodes" }).locator(".card").first().focus();
  await wait(900);
  await shot("home-new-episodes");

  // The Coming up screen.
  await page.locator("button.chip", { hasText: "Coming up" }).first().focus();
  await key("Enter");
  await wait(1500);
  await shot("coming-up");

  // OK on an air date.
  await page.locator(".coming-up .list-row", { hasText: "S3 E3" }).first().focus();
  await key("Enter");
  await wait(800);
  await shot("coming-up-options");
  // Close the choices, then Back to Home.
  await key("Escape");
  await key("Escape");
  await wait(1200);
  await page.locator("section.rail", { hasText: "New episodes" }).locator(".card", { hasText: "Harbour Lights" }).first().focus();
  await key("Enter");
  await wait(1500);
  await page.locator("button.btn", { hasText: "Following" }).focus({ timeout: 5000 });
  await shot("series-follow");
} finally {
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error("Page errors:", errors);
  process.exitCode = 1;
}
