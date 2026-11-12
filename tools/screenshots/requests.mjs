#!/usr/bin/env node
// Captures the Request a title screenshots (docs/screenshots/requests/*.png) against a Hub in demo
// mode, with a tiny pretend Jellyseerr standing in for the real one: the setup page, a search
// result with Request, the details page, a Kids request waiting for a grown-up, Your requests, and
// the Home row once a title is ready.
//
//   npm run build && node tools/screenshots/requests.mjs

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "docs/screenshots/requests");
const port = Number(process.env.PORT ?? 18098);
const seerrPort = port + 1;
const base = `http://127.0.0.1:${port}`;

// The pretend Jellyseerr: says every film it was asked for is "processing" until told it has arrived.
const asked = new Set();
let arrived = false;
const seerr = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/v1/status") return res.end(JSON.stringify({ version: "2.5.2" }));
  if (url.pathname === "/api/v1/auth/me") return res.end(JSON.stringify({ id: 1, displayName: "admin" }));
  if (url.pathname === "/api/v1/request" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      asked.add(String(JSON.parse(body).mediaId));
      res.end(JSON.stringify({ id: asked.size }));
    });
    return;
  }
  const id = /\/api\/v1\/(?:movie|tv)\/(\d+)/.exec(url.pathname)?.[1];
  if (id && asked.has(id)) return res.end(JSON.stringify({ mediaInfo: { status: arrived ? 5 : 3, requests: [{ status: 2 }] } }));
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => seerr.listen(seerrPort, "127.0.0.1", r));

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-rq-"));
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
  const shot = async (name, p = page) => {
    await wait(500);
    await p.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`  ${name}.png`);
  };

  await page.goto(`${base}/app/`);
  await wait(1200);
  const tvToken = (await page.context().cookies()).find((c) => c.name === "utv_device")?.value;
  if (!tvToken) throw new Error("The TV app didn't pair with the Hub");
  const asFamily = { "X-Device-Token": tvToken, "X-Profile": "family", "Content-Type": "application/json" };
  const call = (method, url, body, headers = asFamily) => fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());
  await call("POST", "/api/profiles/me/toured", {});
  await call("PUT", "/api/settings", { theme: "default", seasonal: false, requests: { jellyseerr: { url: `http://127.0.0.1:${seerrPort}`, apiKey: "demo-key" } } });
  // The film "arrives" as soon as it is asked for; the Hub's first look is about 90 seconds after it starts.
  arrived = true;
  const test = await call("POST", "/api/requests/test", { app: "jellyseerr" });
  if (!test.ok) throw new Error(`The pretend Jellyseerr didn't pass Test: ${JSON.stringify(test)}`);

  // The phone's setup page.
  const setup = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await setup.context().addCookies([{ name: "utv_device", value: tvToken, url: base }]);
  await setup.goto(`${base}/setup/#requests`);
  await setup.waitForTimeout(1500);
  await setup.locator("[data-req-test=jellyseerr]").click();
  await setup.waitForTimeout(800);
  await setup.locator("#requests").scrollIntoViewIfNeeded();
  await shot("setup-requests", setup);
  await setup.close();

  await page.goto(`${base}/app/`);
  await wait(1200);
  await key("Enter");
  await wait(2500);
  for (let i = 0; i < 4; i++) {
    await wait(1200);
    const gone = page.getByText("Got it", { exact: true });
    const skip = page.getByText("Skip the tour", { exact: true });
    if (await gone.count()) await gone.focus();
    else if (await skip.count()) await skip.focus();
    else break;
    await key("Enter");
  }

  // Search finds a film nobody has, and says Request on it.
  await page.locator(".tab[aria-label=Search]").focus();
  await key("Enter");
  await wait(900);
  await page.locator("input").first().fill("glass harbour");
  await wait(2500);
  await shot("search-request");

  // Its page: Request.
  await page.locator(".card", { hasText: "Glass Harbour" }).first().focus();
  await key("Enter");
  await wait(1500);
  await page.locator("button.btn", { hasText: "Request" }).first().focus();
  await shot("details-request");
  await key("Enter");
  await wait(1500);
  await shot("details-requested");

  // A Kids profile asks for a series: it waits for a grown-up, who gets asked on the TV.
  const kids = await call("POST", "/api/profiles", { name: "Mia", kind: "kids", colour: "#f78fb3" });
  const kidsId = kids.id ?? kids.profile?.id;
  const asMia = { "X-Device-Token": tvToken, "X-Profile": kidsId, "Content-Type": "application/json" };
  await call("POST", "/api/requests", { title: { id: "tmdb:series:9003", kind: "series", name: "Lighthouse Row", year: 2025 } }, asMia);
  await wait(1500);
  await shot("approve-popup");
  await page.getByText("Approve", { exact: true }).first().focus();
  await key("Enter");
  await wait(1200);

  // Your requests.
  await page.locator(".tab", { hasText: "Home" }).first().focus();
  await key("Enter");
  await wait(1500);
  await page.locator("button.chip", { hasText: "Requests" }).first().focus();
  await key("Enter");
  await wait(1500);
  await shot("your-requests");

  // The film arrives: the Hub looks every five minutes, the first time after a minute and a half.
  console.log("  waiting for the Hub to notice the film has arrived…");
  await page.getByText("Glass Harbour is ready").first().waitFor({ timeout: 150_000 }).catch(() => undefined);
  await shot("ready-popup");
  await key("Escape");
  await wait(800);
  await page.locator("section.rail", { hasText: "Your requests" }).locator(".card").first().focus();
  await wait(900);
  await shot("home-requests");
} finally {
  await browser.close();
  hub.kill();
  seerr.close();
  await rm(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error("Page errors:", errors);
  process.exitCode = 1;
}
