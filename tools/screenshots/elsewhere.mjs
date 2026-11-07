#!/usr/bin/env node
// Captures the Watching elsewhere and Sync play screenshots (docs/screenshots/126-128) against a
// Hub in demo mode: the TV's "On other screens" row on Home, its choices, and the phone
// remote's Watch › Elsewhere. The other screens are made up: a phone, a tablet and a bedroom TV
// report what they "play" the way the Android app and a second box do.
//
//   npm run build && node tools/screenshots/elsewhere.mjs

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
const port = Number(process.env.PORT ?? 18097);
const base = `http://127.0.0.1:${port}`;

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-elsewhere-"));
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
let reporter;

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
  await fetch(`${base}/api/settings`, { method: "PUT", headers: asFamily, body: JSON.stringify({ theme: "default", seasonal: false }) });

  // Something to be watching on the other screens, from the demo's own titles.
  const rails = (await (await fetch(`${base}/api/home`, { headers: asFamily })).json()).rails;
  const titles = [...new Map(rails.flatMap((r) => r.items ?? []).filter((t) => (t.kind === "movie" || t.kind === "series") && !t.id.startsWith("programme:")).map((t) => [t.id, t])).values()];
  const film = titles.find((t) => t.kind === "movie");
  const show = titles.find((t) => t.kind === "series");
  const other = titles.filter((t) => t.kind === "movie")[1] ?? film;
  const screens = [
    { device: "phone:pixel8", body: { req: { kind: "title", id: show.id, episodeId: "s1e3" }, name: show.name, subtitle: "S1 E3", title: show, artwork: show.backdrop ?? show.poster, live: false, positionMs: 1_234_000, durationMs: 2_820_000, paused: true, event: "progress", client: "android", deviceName: "Gary's Pixel" } },
    { device: "phone:tablet", body: { req: { kind: "title", id: film.id }, name: film.name, title: film, artwork: film.backdrop ?? film.poster, live: false, positionMs: 2_530_000, durationMs: 7_260_000, paused: false, event: "progress", client: "android", deviceName: "Kitchen tablet" } },
    { device: "phone:bedroom", body: { req: { kind: "title", id: other.id }, name: other.name, title: other, artwork: other.backdrop ?? other.poster, live: false, positionMs: 3_905_000, durationMs: 6_480_000, paused: false, event: "stop", client: "tv", deviceName: "Bedroom TV" } },
  ];
  const report = () =>
    Promise.all(
      screens.map((s) =>
        fetch(`${base}/api/watching`, { method: "POST", headers: { "Content-Type": "application/json", "X-Device": s.device }, body: JSON.stringify(s.body) }),
      ),
    );
  await report();
  // Keep them "playing" while the screenshots are taken (a stopped one just stays stopped).
  reporter = setInterval(() => void report(), 4000);

  await page.goto(`${base}/app/`);
  await wait(1200);
  await key("Enter");
  await wait(2500);
  if (await page.locator(".whatsnew-dialog").count()) await key("Escape");
  await wait(1500);

  // The row on Home.
  await page.locator("section.rail", { hasText: "On other screens" }).locator(".card").first().focus();
  await wait(900);
  await shot("126-elsewhere-home");

  // OK on the tablet's film: the choices.
  await page.locator("section.rail", { hasText: "On other screens" }).locator(".card", { hasText: film.name }).first().focus();
  await key("Enter");
  await wait(900);
  await shot("127-elsewhere-choices");
  await key("Escape");

  // The phone remote's Watch › Elsewhere.
  const { code } = await (await fetch(`${base}/api/pair/code`, { headers: asFamily })).json();
  const pairing = await (await fetch(`${base}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Gary's iPhone" }) })).json();
  if (!pairing.token) throw new Error(`The phone didn't pair: ${JSON.stringify(pairing)}`);
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  phone.on("pageerror", (e) => errors.push(`phone: ${e.message}`));
  await phone.context().addCookies([{ name: "utv_device", value: pairing.token, url: base }]);
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(1200);
  for (const id of ["news-banner", "app-banner", "ios-hint", "install"]) await phone.evaluate((x) => document.getElementById(x) && (document.getElementById(x).hidden = true), id);
  await phone.locator('[data-tab="browse"]').click();
  await phone.locator('[data-browse="elsewhere"]').click();
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: path.join(out, "128-phone-elsewhere.png") });
  console.log("  128-phone-elsewhere.png");
} finally {
  clearInterval(reporter);
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
