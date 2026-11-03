// Driving the TV app the way the remote does: keys only, never a click. Every key press is
// followed by a check that the screen still has something focused, which is the failure this
// suite exists to catch — a TV app with no focus is a TV app nobody can use.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const FAILURES = path.join(ROOT, "e2e", ".failures");

/** The keys of a Sky-style remote, as Playwright names them. */
const KEYS = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  ok: "Enter",
  back: "Escape",
  red: "F1",
  green: "F2",
  yellow: "F3",
  blue: "F4",
  guide: "F5",
  info: "F6",
  rewind: "F7",
  fastForward: "F8",
  record: "F9",
  channelUp: "PageUp",
  channelDown: "PageDown",
  home: "Home",
  play: "MediaPlay",
  pause: "MediaPause",
  ...Object.fromEntries([...Array(10).keys()].map((n) => [`digit${n}`, String(n)])),
};

/** How long to wait after a key for the app to settle, in ms. A TV UI animates. */
const SETTLE = 260;
/** Where a failure screenshot has to be on disk before CI can upload it. */
export const FAILURE_DIR = FAILURES;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until `check` returns something truthy, or throws with what it saw instead. */
export async function until(check, what, { timeout = 8000, every = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await check();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`Waited ${timeout} ms for ${what}`);
    await sleep(every);
  }
}

/**
 * A TV screen pointed at `hub`, paired as its first screen (which the Hub lets in at once), so no
 * phone has to press anything. `on(key)` records problems; `close()` reports them.
 */
export async function startTv(hub, { name = "e2e-tv", viewport = { width: 1920, height: 1080 } } = {}) {
  const pair = await (
    await fetch(hub.url("/api/pair/screen"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
  ).json();
  if (!pair.token) throw new Error(`The Hub didn't pair the screen: ${JSON.stringify(pair)}`);

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  // The cookie goes in before the first load: the app asks the Hub for things while it starts, and
  // an unpaired screen gets a 401 for the weather, which would look like a console error.
  await context.addCookies([{ name: "utv_device", value: pair.token, url: hub.base }]);
  const page = await context.newPage();

  /**
   * Everything that went wrong in the page: errors, and requests the Hub refused. A journey fails
   * on any of these, so the two things the demo Hub can't provide are filtered out on purpose —
   * see `playbackProblems` in the filters below.
   */
  const problems = [];
  /** The demo Hub has no media files, so the player falls back to its fake clock. That 404 is expected. */
  const missingClip = (url) => /\/clips\//.test(url);
  page.on("pageerror", (e) => problems.push(`page error: ${e.message ?? e}`));
  page.on("console", (m) => {
    // "Failed to load resource" says no more than the response listener below, which names the URL.
    if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) problems.push(`console error: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    if (missingClip(r.url())) return;
    problems.push(`${r.status()} ${r.request().method()} ${r.url().replace(hub.base, "")}`);
  });

  const go = async (p = "/app/") => {
    await page.goto(hub.url(p), { waitUntil: "domcontentloaded" });
    await until(() => page.evaluate(() => document.querySelector("[data-layer]") !== null), "the app to draw");
    await sleep(600);
  };

  /** Focus is only missing if the screen has something to focus and nothing is focused. */
  const focusState = () =>
    page.evaluate(() => {
      const layer = [...document.querySelectorAll("[data-layer]")].at(-1) ?? document.body;
      const a = document.activeElement;
      return {
        layer: layer.className,
        focusables: layer.querySelectorAll("[data-focus]").length,
        tag: a?.tagName ?? null,
        cls: (a?.className ?? "").toString(),
        text: (a?.getAttribute?.("aria-label") || a?.textContent || "").trim().slice(0, 60),
        focused: a !== document.body && a !== null && a.hasAttribute("data-focus"),
      };
    });

  let step = "start";
  const tv = {
    page,
    problems,
    /** Marks the current step, so a failure screenshot is named after it. */
    at(label) {
      step = label;
      return tv;
    },
    /** Presses one remote key, then makes sure the screen is still usable. */
    async press(action, times = 1) {
      const key = KEYS[action];
      if (!key) throw new Error(`No such remote key: ${action}`);
      for (let i = 0; i < times; i++) {
        await page.keyboard.press(key);
        await sleep(SETTLE);
        const f = await focusState();
        // Screens with nothing to focus (a playing film, the box's own screen) are not a failure.
        if (f.focusables > 0 && !f.focused) {
          throw new Error(
            `Nothing is focused on "${f.layer}" after ${action} (was "${f.text}"${f.cls ? ` .${f.cls}` : ""})`,
          );
        }
      }
      return tv;
    },
    /**
     * Fails if the page complained while the journey ran. A console error means something on the
     * screen broke even if the journey got where it was going, so it counts as a failure.
     */
    clean() {
      if (problems.length) throw new Error(`The page reported ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
      return tv;
    },
    /** The text of whatever the remote would press OK on. */
    focusText: () => page.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim()),
    /** The classes of the layer on top, e.g. ["screen home", "dialog-backdrop"]. */
    layers: () => page.evaluate(() => [...document.querySelectorAll("[data-layer]")].map((e) => e.className)),
    /** The screen on top, e.g. "home", "profiles-screen", or "dialog" for a dialog. */
    async screen() {
      const layers = await tv.layers();
      return (layers.at(-1) ?? "").replace(/\bscreen\b/, "").replace("dialog-backdrop", "dialog").replace(/\s+/g, " ").trim();
    },
    /**
     * Waits for a screen to be drawn. Any layer counts, because a dialog on top of Home still means
     * Home is there — a journey then dismisses the dialog rather than failing to find Home at all.
     */
    waitForScreen(name) {
      return until(
        async () => (await tv.layers()).some((l) => l.includes(name)),
        `the ${name} screen`,
        { timeout: 10_000 },
      );
    },
    /** The options of an open dialog, in the order the remote walks them. */
    dialogOptions: () => page.evaluate(() => [...document.querySelectorAll(".dialog .dialog-options button")].map((b) => b.textContent?.trim() ?? "")),
    /** The title above an open dialog's options. */
    dialogTitle: () => page.evaluate(() => document.querySelector(".dialog h2, .dialog h3, .dialog .dialog-title")?.textContent?.trim() ?? ""),
    /** Toast messages on screen right now. */
    toasts: () => page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent?.trim() ?? "")),
    /** Waits for a toast containing `text`. */
    waitForToast(text) {
      return until(async () => (await tv.toasts()).some((t) => t.includes(text)) || false, `a toast saying "${text}"`);
    },
    /** The tabs along the top, in order. */
    tabs: () => page.evaluate(() => [...document.querySelectorAll("button.tab")].map((b) => b.textContent?.trim() ?? "")),
    /** Picks a profile by its name, as the profiles screen lists it. */
    async pickProfile(name) {
      await tv.waitForScreen("profiles");
      for (let i = 0; i < 12; i++) {
        const text = await tv.focusText();
        if (text.includes(name)) return tv.press("ok");
        await tv.press("right");
      }
      throw new Error(`No profile called "${name}"`);
    },
    /** The dialog the app pops about what's new, if it did. */
    async dismissWhatsNew() {
      const open = await page.evaluate(() => document.querySelector(".whatsnew-dialog") !== null);
      if (open) {
        await tv.press("back");
        await until(() => page.evaluate(() => document.querySelector(".whatsnew-dialog") === null), "what's new to close");
      }
      return tv;
    },
    /** Writes a PNG and the page's state beside it, for CI to upload. */
    async screenshot(label) {
      mkdirSync(FAILURES, { recursive: true });
      const file = path.join(FAILURES, `${label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const state = await page.evaluate(() => ({
        url: location.href,
        screens: [...document.querySelectorAll("[data-layer]")].map((e) => e.className),
        focused: document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 80),
        text: document.body.innerText.slice(0, 2000),
      }));
      writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify({ ...state, problems }, null, 1));
      return file;
    },
    /** Called when a journey throws: a screenshot named after the step that failed. */
    async failed(label, err) {
      mkdirSync(FAILURES, { recursive: true });
      const shot = await tv.screenshot(`${label}-${step}`).catch(() => null);
      writeFileSync(
        path.join(FAILURES, `${label.replace(/[^a-z0-9]+/gi, "-")}.txt`),
        `Failed at: ${step}\nScreenshot: ${shot ?? "none"}\n\n${err?.stack ?? err}\n\nProblems seen in the page:\n${problems.join("\n") || "none"}\n`,
      );
    },
    async close() {
      await browser.close();
    },
    focusState,
  };

  await go("/app/");
  return tv;
}
