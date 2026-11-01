#!/usr/bin/env node
// Captures the favourites screenshots (docs/screenshots/favourites-*.png) against a Hub in demo
// mode: the Favourite button on a film's page, the Favourites row on Home, the Browse filter, the
// guide's Favourites list with its hearts, the player's Options and the phone remote's button.
//
//   npm run build && node tools/screenshots/favourites.mjs

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
const port = Number(process.env.PORT ?? 18096);
const base = `http://127.0.0.1:${port}`;

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-favs-"));
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
  const tab = async (label) => {
    await page.locator(".tab", { hasText: label }).first().focus();
    await key("Enter");
    await wait(900);
  };

  await page.goto(`${base}/app/`);
  await wait(1200);
  const tvToken = (await page.context().cookies()).find((c) => c.name === "utv_device")?.value;
  if (!tvToken) throw new Error("The TV app didn't pair with the Hub");
  const asFamily = { "X-Device-Token": tvToken, "X-Profile": "family", "Content-Type": "application/json" };
  const post = (url, body, headers = asFamily) => fetch(`${base}${url}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());
  await fetch(`${base}/api/settings`, { method: "PUT", headers: asFamily, body: JSON.stringify({ theme: "default", seasonal: false }) });

  // The Family profile's favourites: a few films and shows (not Copper Sky: its page stars it with
  // Blue below), and its own channels.
  const rails = (await (await fetch(`${base}/api/home`, { headers: asFamily })).json()).rails;
  const titles = [...new Map(rails.flatMap((r) => r.items ?? []).filter((t) => (t.kind === "movie" || t.kind === "series") && t.name !== "Copper Sky" && !t.id.startsWith("programme:")).map((t) => [t.id, t])).values()];
  for (const t of titles.filter((x) => x.kind === "movie").slice(0, 3)) await post("/api/favourites", { title: t, on: true });
  for (const t of titles.filter((x) => x.kind === "series").slice(0, 2)) await post("/api/favourites", { title: t, on: true });
  const { channels } = await (await fetch(`${base}/api/channels`, { headers: asFamily })).json();
  for (const c of channels.filter((x) => x.favourite)) await post("/api/favourites", { channel: c.id, on: false });
  for (const c of channels.filter((x) => [101, 102, 104, 401, 402].includes(x.number))) await post("/api/favourites", { channel: c.id, on: true });

  await page.goto(`${base}/app/`);
  await wait(1200);
  await key("Enter");
  await wait(1500);
  // What's new pops up the first time.
  if (await page.locator(".whatsnew-dialog").count()) await key("Escape");

  // The Favourites row on Home.
  await page.locator("section.rail", { hasText: "Favourites" }).locator(".card").first().focus();
  await wait(900);
  await shot("favourites-home");

  // A film's page: Blue stars it, and the button shows it.
  await tab("Films");
  await wait(1200);
  await page.locator(".card", { hasText: "Copper Sky" }).first().focus();
  await key("Enter");
  await wait(1500);
  await key("F4");
  await wait(300);
  await page.locator(".btn-favourite").focus();
  await shot("favourites-details");

  // Browse narrowed to Favourites.
  await key("Escape");
  await wait(900);
  await page.locator(".browse-filter .chip", { hasText: "Favourites" }).focus();
  await key("Enter");
  await wait(900);
  await shot("favourites-browse");

  // The guide's Favourites list, with a heart beside each starred channel.
  await tab("TV Guide");
  await wait(1200);
  for (let i = 0; i < 12; i++) {
    if ((await page.locator(".guide .chip.active", { hasText: "Favourites" }).count()) > 0) break;
    await key("F4");
    await wait(500);
  }
  await shot("favourites-guide");

  // Live TV: Green stars the channel on the banner; Info's programme card has the button too.
  await key("Enter");
  await wait(1500);
  await shot("favourites-live-banner");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Info" })));
  await wait(900);
  await shot("favourites-programme-card");
  await key("Escape", 3);

  // The phone remote: a film's sheet has a heart button that stars it on the profile watching.
  const { code } = await (await fetch(`${base}/api/pair/code`, { headers: asFamily })).json();
  const pairing = await (await fetch(`${base}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Gary's Pixel" }) })).json();
  if (!pairing.token) throw new Error(`The phone didn't pair: ${JSON.stringify(pairing)}`);
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  phone.on("pageerror", (e) => errors.push(`phone: ${e.message}`));
  await phone.context().addCookies([{ name: "utv_device", value: pairing.token, url: base }]);
  await phone.goto(`${base}/remote/`);
  await phone.waitForTimeout(1200);
  if (await phone.locator("#news-banner:not([hidden])").count()) await phone.evaluate(() => (document.getElementById("news-banner").hidden = true));
  await phone.locator('[data-tab="browse"]').click();
  await phone.locator('[data-browse="movie"]').click();
  await phone.waitForTimeout(1200);
  await phone.locator(".poster", { hasText: "Copper Sky" }).first().click();
  await phone.waitForTimeout(2500);
  await phone.screenshot({ path: path.join(out, "favourites-phone.png") });
  console.log("  favourites-phone.png");
} finally {
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`Page errors:\n${errors.join("\n")}`);
  process.exit(1);
}
