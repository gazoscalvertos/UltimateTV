// The box shell. Shows the Hub's TV UI full screen in a transparent window over mpv, which draws
// the video underneath; the UI cuts a hole where the video should show. Configured from
// /etc/ultimatetv/box.env (see tools/box/install.sh):
//
//   HUB_URL       the Hub, e.g. http://192.168.0.19:8095
//   CEC_DEVICE    the Pulse-Eight adapter's CEC device (default /dev/cec0)
//   AUDIO_DEVICE  mpv's --audio-device, when the default isn't the TV's HDMI output
//   MPV_ARGS      extra mpv arguments, space separated
//   SUSPEND_WHEN_TV_OFF  1 to suspend the box a minute after the TV goes to standby

import { execFile } from "node:child_process";
import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, session } from "electron";
import os from "node:os";
import path from "node:path";
import type { BoxInfo, PlayerState } from "@ultimatetv/shared";
import { Cec } from "./cec.js";
import { Display } from "./display.js";
import { Mpv } from "./mpv.js";
import { Player } from "./player.js";

const HUB_URL = (process.env.HUB_URL ?? "http://192.168.0.19:8095").replace(/\/$/, "");
const CEC_DEVICE = process.env.CEC_DEVICE ?? "/dev/cec0";
const RUNTIME = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
const VERSION: string = require("../package.json").version;

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

// Wayland where there is one (KDE), and the class KWin's rules use to keep this window on top.
app.commandLine.appendSwitch("ozone-platform-hint", "auto");
app.commandLine.appendSwitch("class", "ultimatetv");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");
app.setName("ultimatetv");

let win: BrowserWindow | null = null;
let blocker: number | null = null;

const offlinePage = (reason: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a0f1a;color:#e8edf5;font:32px system-ui,sans-serif;text-align:center">
<div><div style="font-size:64px;font-weight:700;margin-bottom:24px">UltimateTV</div>Can't reach the Hub at ${HUB_URL}<br><span style="opacity:.6;font-size:24px">${reason.replace(/</g, "&lt;")} · trying again</span></div>
<script>setTimeout(()=>location.replace(${JSON.stringify(`${HUB_URL}/app/`)}),5000)</script></body></html>`)}`;

async function main(): Promise<void> {
  await app.whenReady();
  const display = new Display(log);
  const mpv = new Mpv({ socket: path.join(RUNTIME, "ultimatetv-mpv.sock"), log, ...(process.env.AUDIO_DEVICE ? { audioDevice: process.env.AUDIO_DEVICE } : {}), extraArgs: (process.env.MPV_ARGS ?? "").split(/\s+/).filter(Boolean) });
  const cec = new Cec(CEC_DEVICE, log);
  const screenSize = () => {
    const b = win?.getContentBounds() ?? screen.getPrimaryDisplay().bounds;
    return { width: b.width, height: b.height };
  };
  const player = new Player(mpv, display, screenSize, log);

  await mpv.start().catch((e: Error) => log(`mpv didn't start: ${e.message}`));
  await player.start().catch((e: Error) => log(e.message));
  void cec.start();

  const send = (channel: string, value: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
  };
  player.onState((s: PlayerState) => {
    send("agent:state", s);
    // Keep the screen awake while something plays.
    const playing = s.status === "playing" || s.status === "buffering" || s.status === "loading";
    if (playing && blocker === null) blocker = powerSaveBlocker.start("prevent-display-sleep");
    if (!playing && blocker !== null) {
      powerSaveBlocker.stop(blocker);
      blocker = null;
    }
  });
  let suspendTimer: NodeJS.Timeout | undefined;
  cec.onPower((active) => {
    send("agent:power", active);
    clearTimeout(suspendTimer);
    if (!active && process.env.SUSPEND_WHEN_TV_OFF === "1") {
      suspendTimer = setTimeout(() => {
        log("TV is off: suspending");
        execFile("systemctl", ["suspend"], (e) => e && log(`Suspend failed: ${e.message}`));
      }, 60_000);
    }
  });

  const methods: Record<string, (...args: never[]) => Promise<unknown>> = {
    info: async (): Promise<BoxInfo> => {
      const tv = await display.tv();
      const info: BoxInfo = { kind: "box", version: VERSION, hostname: os.hostname(), cec: { connected: cec.connected, ...(cec.tvOn !== undefined ? { tvOn: cec.tvOn } : {}) } };
      if (tv) info.display = { name: tv.output.name, width: tv.mode.width, height: tv.mode.height, refreshHz: tv.mode.refreshRate, hdr: Boolean(tv.output.hdr) };
      const ao = await mpv.get<string>("current-ao").catch(() => undefined);
      if (ao) info.audioDevice = ao;
      return info;
    },
    play: (o: never) => player.play(o),
    stop: () => player.stop(),
    pause: (p: never) => player.pause(p),
    seek: (ms: never, mode: never) => player.seek(ms, mode),
    goLive: () => player.goLive(),
    setAudioTrack: (id: never) => player.setAudioTrack(id),
    setSubtitleTrack: (id: never) => player.setSubtitleTrack(id),
    setNightMode: (on: never) => player.setNightMode(on),
    setLayout: (l: never) => player.setLayout(l),
    wakeTv: () => cec.wakeTv(),
    reload: async () => win?.webContents.reloadIgnoringCache(),
  };
  ipcMain.handle("agent", async (e, method: string, ...args: unknown[]) => {
    if (!win || e.sender !== win.webContents) throw new Error("Not the TV window");
    const fn = methods[method];
    if (!fn) throw new Error(`Unknown method ${method}`);
    return (fn as (...a: unknown[]) => Promise<unknown>)(...args);
  });

  // Only the Hub's pages run here; no pop-ups, permissions or downloads.
  const hubOrigin = new URL(HUB_URL).origin;
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "fullscreen"));
  app.on("web-contents-created", (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (ev, url) => {
      if (!url.startsWith("data:") && new URL(url).origin !== hubOrigin) ev.preventDefault();
    });
  });

  const { width, height } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    width,
    height,
    fullscreen: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    title: "UltimateTV",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  win.setMenu(null);
  win.webContents.setZoomFactor(1);
  win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (url.startsWith(HUB_URL) && code !== -3) {
      log(`UI didn't load (${desc})`);
      void win?.loadURL(offlinePage(desc));
    }
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    log(`UI crashed (${details.reason}); reloading`);
    void player.stop();
    void win?.loadURL(`${HUB_URL}/app/`);
  });
  win.webContents.on("unresponsive", () => {
    log("UI unresponsive; reloading");
    win?.webContents.forcefullyCrashRenderer();
  });
  // The cursor never shows on the TV.
  win.webContents.on("dom-ready", () => void win?.webContents.insertCSS("*{cursor:none!important}"));
  await win.loadURL(`${HUB_URL}/app/`).catch(() => undefined);

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    cec.stop();
    void display.restore();
    void mpv.stop();
  });
  // Wake the TV and switch it to the box when the box starts.
  setTimeout(() => void cec.wakeTv(), 3000);
}

if (!app.requestSingleInstanceLock()) app.quit();
else
  main().catch((e: Error) => {
    log(`Box shell failed: ${e.stack ?? e.message}`);
    app.exit(1);
  });
