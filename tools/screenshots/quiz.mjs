#!/usr/bin/env node
// Captures the family quiz screenshots (docs/screenshots/quiz/*.png) against a Hub in demo mode:
// the Cast and games entry, the lobby, a question on the TV and on a phone that joined by code,
// the answer, and the podium. The TV is driven with the remote's keys (F1 to F4 are the colour keys).
//
//   npm run build && node tools/screenshots/quiz.mjs

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "docs/screenshots/quiz");
const port = Number(process.env.PORT ?? 18099);
const base = `http://127.0.0.1:${port}`;

async function startHub() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "utv-quiz-"));
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
  await fetch(`${base}/api/profiles/me/toured`, { method: "POST", headers: asFamily, body: "{}" });
  await fetch(`${base}/api/settings`, { method: "PUT", headers: asFamily, body: JSON.stringify({ theme: "default", seasonal: false }) });
  const hubCall = async (method, url, body) => (await fetch(`${base}${url}`, { method, headers: asFamily, ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}) })).json();

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

  // Blue on Home is Cast and games, which now has the quiz.
  await key("F4");
  await wait(1200);
  await page.locator(".quiz-card").focus();
  await shot("cast-and-games-quiz");

  // Open the quiz: whoever is watching is the first player; a phone joins with the code.
  await key("Enter");
  await wait(1500);
  const state = await hubCall("GET", "/api/quiz");
  const code = state.view.code;
  await hubCall("POST", "/api/quiz/players", { name: "Dad" });
  await hubCall("PUT", "/api/quiz/settings", { style: "together", rounds: ["general", "science", "geography", "animals", "entertainment", "films", "shows"], difficulty: "family", questions: 8, seconds: 20 });

  const phone = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(`${base}/quiz/?code=${code}`);
  await phone.waitForTimeout(500);
  await shot("phone-join", phone);
  await phone.fill("#name", "Mia");
  await phone.click("#joinbtn");
  await phone.waitForTimeout(1500);
  await shot("phone-waiting", phone);

  await page.locator(".quiz-style").first().focus();
  await shot("lobby");

  // Green starts it.
  await key("F2");
  await wait(2500);
  await shot("question");
  await shot("phone-question", phone);

  // Red on the remote answers for Dad; Mia taps a colour on her phone.
  await key("F1");
  await phone.locator(".answers button").nth(1).click();
  await wait(1800);
  await shot("answer");
  await shot("phone-answer", phone);

  // Play the rest quickly and show the podium.
  for (let n = 0; n < 40; n++) {
    const s = await hubCall("GET", "/api/quiz");
    if (process.env.DEBUG_QUIZ) console.log(n, s.view?.phase, s.view?.question?.number);
    if (s.view?.phase === "final") break;
    if (s.view?.phase === "reveal") await hubCall("POST", "/api/quiz/next");
    else {
      await key("F3");
      await phone.locator(".answers button").nth(n % 4).click({ timeout: 2000 }).catch(() => undefined);
    }
    await wait(600);
  }
  await wait(1500);
  await shot("podium");
  await shot("phone-final", phone);

  // A round made from the household's own films: first a blurred poster, then a description with
  // the title taken out. (The demo Hub's made-up films stand in for a media server.)
  const round = async (difficulty, name) => {
    await hubCall("DELETE", "/api/quiz");
    await wait(600);
    await hubCall("POST", "/api/quiz/open");
    await hubCall("PUT", "/api/quiz/settings", { style: "turns", rounds: ["films", "shows"], difficulty, questions: 8, seconds: 20 });
    await hubCall("POST", "/api/quiz/players", { name: "Mum" });
    await hubCall("POST", "/api/quiz/players", { name: "Sam" });
    await hubCall("POST", "/api/quiz/start");
    await wait(2000);
    await shot(`${name}`);
    await key("F2");
    await wait(1200);
    await shot(`${name}-answer`);
  };
  await round("easy", "picture-round");
  await round("tricky", "description-round");
} finally {
  await browser.close();
  hub.kill();
  await rm(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error("Page errors:", errors);
  process.exitCode = 1;
}
