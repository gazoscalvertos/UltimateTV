// UltimateTV capability probe. Runs in the TV's browser, driven entirely by the remote.

import {
  CODEC_CHECKS,
  REMOTE_KEYS,
  type ClipResult,
  type KeyResult,
  type ProbeReport,
} from "@ultimatetv/shared";
import { checkCodecs, checkDrm, deviceInfo, measureFps } from "./checks";
import { directionForKey, nextIndex } from "./spatial";

interface Clip {
  file: string;
  title: string;
  tests?: string;
  sizeBytes: number;
}

type Tab = "device" | "keys" | "clips" | "send";

const KEY_ENTER = 13;
const BACK_KEYS = [8, 27, 461, 10009];

const report: ProbeReport = {
  schema: 1,
  createdAt: new Date().toISOString(),
  label: "Hisense 85U7STUK",
  device: deviceInfo(null),
  codecs: [],
  drm: {},
  keys: [],
  clips: [],
};

let tab: Tab = "device";
let keyWizard: { index: number; results: KeyResult[] } | null = null;
let playing: { clip: Clip; started: number; startupMs?: number; errorCode?: number } | null = null;

const main = document.getElementById("main") as HTMLElement;
const video = document.getElementById("player") as HTMLVideoElement;
const playerHint = document.getElementById("player-hint") as HTMLElement;

// ---------- small DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; onSelect?: () => void } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.onSelect) {
    node.classList.add("focusable");
    node.tabIndex = 0;
    node.addEventListener("click", props.onSelect);
  }
  for (const child of children) node.append(child);
  return node;
}

/** Element.replaceChildren needs Chromium 86, which older VIDAA firmware may not have. */
function setChildren(node: Element, ...children: (Node | string)[]) {
  while (node.firstChild) node.removeChild(node.firstChild);
  for (const child of children) node.append(child);
}

function button(label: string, onSelect: () => void, extraClass = ""): HTMLButtonElement {
  return el("button", { class: `btn ${extraClass}`.trim(), text: label, onSelect });
}

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".focusable")).filter((n) => n.offsetParent !== null);
}

function focusFirst(selector = "#main .focusable") {
  const target = document.querySelector<HTMLElement>(selector) ?? focusables()[0];
  target?.focus();
}

function moveFocus(keyCode: number): boolean {
  const direction = directionForKey(keyCode);
  if (!direction) return false;
  const items = focusables();
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    items[0]?.focus();
    return true;
  }
  const others = items.filter((n) => n !== current);
  const i = nextIndex(current.getBoundingClientRect(), others.map((n) => n.getBoundingClientRect()), direction);
  const target = others[i];
  if (target) {
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  }
  return true;
}

// ---------- tabs ----------

function renderTabs() {
  const nav = document.getElementById("tabs") as HTMLElement;
  setChildren(nav);
  const tabs: [Tab, string][] = [
    ["device", "1  TV check"],
    ["keys", "2  Remote keys"],
    ["clips", "3  Test clips"],
    ["send", "4  Send report"],
  ];
  for (const [id, label] of tabs) {
    const b = button(label, () => showTab(id), id === tab ? "tab active" : "tab");
    nav.append(b);
  }
}

function showTab(next: Tab) {
  tab = next;
  renderTabs();
  if (tab === "device") renderDevice();
  if (tab === "keys") renderKeys();
  if (tab === "clips") void renderClips();
  if (tab === "send") void renderSend();
}

// ---------- 1. device check ----------

function supportText(value: string): string {
  return value === "probably" ? "Yes" : value === "maybe" ? "Maybe" : value === "error" ? "Error" : "No";
}

function renderDevice() {
  const d = report.device;
  const rows: [string, string][] = [
    ["Chromium", d.chromiumVersion ?? "unknown"],
    ["Screen", `${d.screen.width}×${d.screen.height} @ ${d.screen.devicePixelRatio}x`],
    ["Viewport", `${d.viewport.width}×${d.viewport.height}`],
    ["WebGL", d.webgl.webgl2 ? "WebGL 2" : d.webgl.webgl1 ? "WebGL 1" : "none"],
    ["GPU", d.webgl.renderer ?? "unknown"],
    ["UI frame rate", d.fps === null ? "measuring…" : `${d.fps} fps`],
  ];
  for (const [q, v] of Object.entries(d.mediaQueries)) rows.push([q, v ? "Yes" : "No"]);
  for (const [f, v] of Object.entries(d.features)) rows.push([f, v ? "Yes" : "No"]);

  const codecRows = report.codecs.map((c) => {
    const label = CODEC_CHECKS.find((x) => x.id === c.id)?.label ?? c.id;
    return el("tr", {}, [
      el("td", { text: label }),
      el("td", { class: `s-${c.mse}`, text: supportText(c.mse) }),
      el("td", { class: `s-${c.canPlayType}`, text: supportText(c.canPlayType) }),
    ]);
  });
  const drmRows = Object.entries(report.drm).map(([k, v]) =>
    el("tr", {}, [el("td", { text: k }), el("td", { class: v ? "s-probably" : "s-no", text: v ? "Yes" : "No" })]),
  );

  setChildren(main, 
    el("p", { class: "lede", text: "These checks ran automatically. Move on to the remote keys when you're ready." }),
    el("div", { class: "cols" }, [
      el("section", {}, [
        el("h2", { text: "This TV" }),
        el("table", {}, rows.map(([k, v]) => el("tr", {}, [el("td", { text: k }), el("td", { text: v })]))),
      ]),
      el("section", {}, [
        el("h2", { text: "Formats" }),
        el("table", {}, [
          el("tr", {}, [el("th", { text: "Format" }), el("th", { text: "Streaming" }), el("th", { text: "Direct" })]),
          ...codecRows,
        ]),
        el("h2", { text: "DRM" }),
        el("table", {}, drmRows),
      ]),
    ]),
    el("div", { class: "actions" }, [button("Next: remote keys", () => showTab("keys"), "primary")]),
  );
  focusFirst("#main .primary");
}

// ---------- 2. remote keys ----------

// The VIDAA browser can run in cursor mode, where OK and the arrows drive an on-screen pointer and never
// reach the page as key presses. The wizard therefore also listens for clicks, offers on-screen buttons
// that work with the pointer, and shows every input event as it arrives.

const EVENT_LOG_LIMIT = 60;
const eventLog: string[] = [];
let sawPointer = false;

function logEvent(text: string) {
  eventLog.push(text);
  if (eventLog.length > EVENT_LOG_LIMIT) eventLog.shift();
  report.eventLog = eventLog.slice();
  const live = document.getElementById("live-event");
  if (live) live.textContent = `Last input received: ${text}`;
}

function renderKeys() {
  if (keyWizard) {
    const name = REMOTE_KEYS[keyWizard.index] ?? "";
    setChildren(main,
      el("div", { class: "prompt" }, [
        el("p", { class: "step", text: `Key ${keyWizard.index + 1} of ${REMOTE_KEYS.length}` }),
        el("h2", { class: "big", text: `Press ${name}` }),
        el("p", { class: "live", text: "Last input received: nothing yet" }),
        el("div", { class: "actions center" }, [
          button("Nothing happened / not on remote", () => recordWizardKey(null), "wizard-btn"),
          button("Stop", stopKeyWizard, "wizard-btn"),
        ]),
        el("p", {
          class: "step",
          text: "If the screen shows a pointer, point at a button and press OK to choose it.",
        }),
      ]),
    );
    const live = main.querySelector(".live");
    if (live) live.id = "live-event";
    return;
  }

  const recorded = report.keys.length > 0;
  const keyRows = report.keys.map((k) =>
    el("tr", {}, [
      el("td", { text: k.name }),
      el("td", { text: keyLabel(k) }),
    ]),
  );
  setChildren(main,
    el("p", {
      class: "lede",
      text: "The app needs to know which code each button on your Hisense remote sends. You'll be asked to press each one in turn.",
    }),
    sawPointer
      ? el("p", {
          class: "lede warn",
          text: "The browser is in cursor mode, so OK and the arrows may move a pointer instead of reaching the page. That's useful to know. Record what you can.",
        })
      : el("span"),
    recorded ? el("table", {}, keyRows) : el("span"),
    el("div", { class: "actions" }, [
      button(recorded ? "Record keys again" : "Start", startKeyWizard, "primary"),
      button("Next: test clips", () => showTab("clips")),
    ]),
  );
  focusFirst("#main .primary");
}

function keyLabel(k: KeyResult): string {
  if (k.via === "click") return "click only (cursor mode)";
  if (k.via === "history") return "browser back only";
  return k.keyCode === null ? "not received" : String(k.keyCode);
}

function startKeyWizard() {
  keyWizard = { index: 0, results: [] };
  renderKeys();
}

function stopKeyWizard() {
  if (!keyWizard) return;
  report.keys = keyWizard.results;
  keyWizard = null;
  saveProgress();
  renderKeys();
}

function recordWizardKey(result: Omit<KeyResult, "name"> | null) {
  if (!keyWizard) return;
  const name = REMOTE_KEYS[keyWizard.index] ?? "";
  keyWizard.results.push(result ? { name, ...result } : { name, keyCode: null });
  keyWizard.index += 1;
  if (keyWizard.index >= REMOTE_KEYS.length) {
    stopKeyWizard();
    return;
  }
  renderKeys();
}

function handleWizardKey(e: KeyboardEvent) {
  if (!keyWizard) return;
  e.preventDefault();
  // Once OK is known as a real key, pressing it again skips keys the remote doesn't have.
  const ok = keyWizard.results[0];
  if (keyWizard.index > 0 && ok?.via === "key" && e.keyCode === ok.keyCode) {
    recordWizardKey(null);
    return;
  }
  recordWizardKey({ keyCode: e.keyCode, key: e.key || undefined, code: e.code || undefined, via: "key" });
}

/** A click that didn't land on a wizard button means the key being asked for acts as a pointer click. */
function handleWizardClick(e: MouseEvent) {
  if (!keyWizard) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest(".wizard-btn")) return;
  e.preventDefault();
  e.stopPropagation();
  recordWizardKey({ keyCode: null, via: "click" });
}

// ---------- 3. test clips ----------

let clipsCache: Clip[] | null = null;

async function renderClips() {
  setChildren(main, el("p", { class: "lede", text: "Loading clips from the Hub…" }));
  try {
    if (!clipsCache) {
      const res = await fetch("/api/clips");
      clipsCache = ((await res.json()) as { clips: Clip[] }).clips;
    }
  } catch {
    setChildren(main, el("p", { class: "lede", text: "Couldn't reach the Hub. Check it is running, then open this tab again." }));
    return;
  }
  if (tab !== "clips") return;

  if (clipsCache.length === 0) {
    setChildren(main, 
      el("p", { class: "lede", text: "No test clips found. Copy clips into the test-clips folder on the server (see docs/phase0/test-clips.md), then open this tab again." }),
      el("div", { class: "actions" }, [button("Next: send report", () => showTab("send"), "primary")]),
    );
    clipsCache = null;
    focusFirst("#main .primary");
    return;
  }

  const list = el("div", { class: "clips" });
  for (const clip of clipsCache) {
    const done = report.clips.find((c) => c.clip === clip.file);
    const tile = el("button", { class: "clip", onSelect: () => playClip(clip) }, [
      el("strong", { text: clip.title }),
      el("span", { text: clip.tests ?? clip.file }),
      el("span", { class: done ? "done" : "todo", text: done ? (done.played ? "Tested" : "Didn't play") : "Not tested yet" }),
    ]);
    list.append(tile);
  }
  setChildren(main, 
    el("p", { class: "lede", text: "Play each clip, watch for the TV's HDR or Dolby Vision badge, then answer three quick questions." }),
    list,
    el("div", { class: "actions" }, [button("Next: send report", () => showTab("send"))]),
  );
  focusFirst("#main .clip");
}

function playClip(clip: Clip) {
  playing = { clip, started: performance.now() };
  document.body.classList.add("playing");
  playerHint.textContent = `${clip.title}. Press OK or Back to stop.`;
  video.src = `/clips/${encodeURIComponent(clip.file)}`;
  void video.play().catch(() => undefined);
}

video.addEventListener("playing", () => {
  if (playing && playing.startupMs === undefined) playing.startupMs = Math.round(performance.now() - playing.started);
});
video.addEventListener("error", () => {
  if (playing) playing.errorCode = video.error?.code;
});

function stopClip() {
  if (!playing) return;
  const { clip, startupMs, errorCode } = playing;
  const quality = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
  const result: ClipResult = {
    clip: clip.file,
    played: startupMs !== undefined && errorCode === undefined,
    errorCode,
    videoWidth: video.videoWidth || undefined,
    videoHeight: video.videoHeight || undefined,
    droppedFrames: quality?.droppedVideoFrames,
    totalFrames: quality?.totalVideoFrames,
    startupMs,
  };
  video.pause();
  video.removeAttribute("src");
  video.load();
  playing = null;
  document.body.classList.remove("playing");
  askAboutClip(clip, result);
}

function askAboutClip(clip: Clip, result: ClipResult) {
  const groups: { title: string; field: "hdrBadge" | "motion" | "audio"; options: [string, string][] }[] = [
    {
      title: "Which badge did the TV show?",
      field: "hdrBadge",
      options: [["dolby-vision", "Dolby Vision"], ["hdr10plus", "HDR10+"], ["hdr10", "HDR10"], ["hlg", "HLG"], ["none", "None"], ["unsure", "Not sure"]],
    },
    {
      title: "How did motion look?",
      field: "motion",
      options: [["smooth", "Smooth"], ["judder", "Juddery"], ["unsure", "Not sure"]],
    },
    {
      title: "What did the audio sound like?",
      field: "audio",
      options: [["atmos", "Atmos"], ["surround", "Surround"], ["stereo", "Stereo"], ["silent", "Silent"], ["unsure", "Not sure"]],
    },
  ];

  const body = el("div", { class: "questions" });
  for (const group of groups) {
    const row = el("div", { class: "options" });
    for (const [value, label] of group.options) {
      const b = button(label, () => {
        (result as unknown as Record<string, string>)[group.field] = value;
        row.querySelectorAll(".btn").forEach((n) => n.classList.remove("chosen"));
        b.classList.add("chosen");
      });
      row.append(b);
    }
    body.append(el("h3", { text: group.title }), row);
  }

  const status = result.played
    ? `Played at ${result.videoWidth ?? "?"}×${result.videoHeight ?? "?"}, started in ${result.startupMs ?? "?"} ms.`
    : `The browser couldn't play this clip${result.errorCode ? ` (error ${result.errorCode})` : ""}.`;

  setChildren(main, 
    el("h2", { text: clip.title }),
    el("p", { class: "lede", text: status }),
    body,
    el("div", { class: "actions" }, [
      button("Save answers", () => {
        report.clips = report.clips.filter((c) => c.clip !== clip.file).concat(result);
        saveProgress();
        void renderClips();
      }, "primary"),
      button("Play again", () => playClip(clip)),
    ]),
  );
  focusFirst("#main .options .btn");
}

// ---------- 4. send ----------

interface SystemChecks {
  checks: { av1HardwareDecode: boolean; hevcHardwareEncode: boolean; hevc10HardwareEncode: boolean };
  renderNode: string | null;
  ffmpeg: string | null;
}

async function renderSend() {
  const server = el("section", {}, [el("h2", { text: "Server" }), el("p", { text: "Checking the Hub…" })]);
  const result = el("p", { class: "result" });
  setChildren(main, 
    el("p", {
      class: "lede",
      text: `The report has ${report.codecs.length} format checks, ${report.keys.length} remote keys and ${report.clips.length} tested clips.`,
    }),
    el("div", { class: "actions" }, [button("Send report to the Hub", () => void sendReport(result), "primary")]),
    result,
    server,
  );
  focusFirst("#main .primary");

  try {
    const sys = (await (await fetch("/api/system")).json()) as SystemChecks;
    const yes = (v: boolean) => (v ? "Yes" : "No");
    setChildren(server, 
      el("h2", { text: "Server" }),
      el("table", {}, [
        el("tr", {}, [el("td", { text: "ffmpeg" }), el("td", { text: sys.ffmpeg ?? "not found" })]),
        el("tr", {}, [el("td", { text: "Graphics chip visible" }), el("td", { text: sys.renderNode ?? "No" })]),
        el("tr", {}, [el("td", { text: "AV1 hardware decode" }), el("td", { text: yes(sys.checks.av1HardwareDecode) })]),
        el("tr", {}, [el("td", { text: "HEVC hardware encode" }), el("td", { text: yes(sys.checks.hevcHardwareEncode) })]),
        el("tr", {}, [el("td", { text: "HEVC 10-bit hardware encode" }), el("td", { text: yes(sys.checks.hevc10HardwareEncode) })]),
      ]),
    );
  } catch {
    setChildren(server, el("h2", { text: "Server" }), el("p", { text: "Couldn't reach the Hub." }));
  }
}

async function sendReport(result: HTMLElement) {
  result.textContent = "Sending…";
  try {
    const res = await fetch("/api/probe-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...report, device: { ...report.device, viewport: { width: innerWidth, height: innerHeight } } }),
    });
    const body = (await res.json()) as { id?: string; matrix?: string; problems?: string[] };
    result.textContent = res.ok
      ? `Saved. Open ${location.origin}${body.matrix} on a computer to see the capability matrix.`
      : `The Hub rejected the report: ${(body.problems ?? []).join(", ")}`;
  } catch {
    result.textContent = "Couldn't reach the Hub. Check it is running and try again.";
  }
}

// ---------- input ----------

for (const type of ["keydown", "keyup"] as const) {
  document.addEventListener(type, (e) => logEvent(`${type} ${e.keyCode} ${e.key || "-"}`), true);
}
for (const type of ["mousedown", "click", "wheel", "contextmenu"] as const) {
  document.addEventListener(type, () => logEvent(type), true);
}
document.addEventListener("mousemove", () => {
  if (!sawPointer) {
    sawPointer = true;
    logEvent("mousemove (cursor mode)");
  }
}, true);
document.addEventListener("click", handleWizardClick, true);

document.addEventListener("keydown", (e) => {
  if (keyWizard) return handleWizardKey(e);
  if (playing) {
    if (e.keyCode === KEY_ENTER || BACK_KEYS.includes(e.keyCode)) {
      e.preventDefault();
      stopClip();
    }
    return;
  }
  if (moveFocus(e.keyCode)) {
    e.preventDefault();
    return;
  }
  if (e.keyCode === KEY_ENTER) {
    const current = document.activeElement as HTMLElement | null;
    if (current?.classList.contains("focusable")) {
      e.preventDefault();
      current.click();
    }
  }
});

// In cursor mode OK arrives as a click, so a click anywhere while a clip plays stops it.
document.addEventListener("click", (e) => {
  if (playing && !keyWizard) {
    e.preventDefault();
    stopClip();
  }
}, true);

// ---------- Back key and saved progress ----------

// In the browser, Back steps through history instead of sending a key, which would reload the probe.
// A history entry is kept in reserve so Back lands here as a popstate event, and answers are saved
// locally so an accidental reload doesn't lose them.

const STORAGE_KEY = "utv-probe-progress";

function armBackTrap() {
  try {
    history.pushState({ utvProbe: true }, "", location.href);
  } catch {
    // Some embedded browsers refuse pushState; Back will then leave the page as before.
  }
}

window.addEventListener("popstate", () => {
  logEvent("popstate (browser back)");
  armBackTrap();
  if (keyWizard) {
    recordWizardKey({ keyCode: null, via: "history" });
  } else if (playing) {
    stopClip();
  }
});

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: report.keys, clips: report.clips }));
  } catch {
    // Storage may be unavailable; progress then lasts only until the page reloads.
  }
}

function restoreProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Pick<ProbeReport, "keys" | "clips"> | null;
    if (saved && Array.isArray(saved.keys) && Array.isArray(saved.clips)) {
      report.keys = saved.keys;
      report.clips = saved.clips;
    }
  } catch {
    // Ignore unreadable saved progress.
  }
}

// ---------- start ----------

async function start() {
  restoreProgress();
  armBackTrap();
  report.codecs = checkCodecs();
  showTab("device");
  report.drm = await checkDrm();
  const fps = await measureFps(document.body);
  report.device = deviceInfo(fps);
  if (tab === "device") renderDevice();
}

void start();
