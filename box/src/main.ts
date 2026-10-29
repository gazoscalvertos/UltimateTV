// The box shell. Shows the Hub's TV UI full screen in a transparent window over mpv, which draws
// the video underneath; the UI cuts a hole where the video should show. Configured from
// /etc/ultimatetv/box.env (see tools/box/install.sh):
//
//   HUB_URL       the Hub, e.g. http://192.168.0.19:8095
//   CEC_DEVICE    the Pulse-Eight adapter's CEC device (default /dev/cec0)
//   AUDIO_DEVICE  mpv's --audio-device, when the default isn't the TV's HDMI output
//   MPV_ARGS      extra mpv arguments, space separated
//   SUSPEND_WHEN_TV_OFF  1 to suspend the box a minute after the TV goes to standby
//   HDMI_AUDIO    0 to leave the sound output alone (by default it's moved to the TV's HDMI)
//   CUSTOM_MODES  0 to never add a custom refresh rate for films the screen has no mode for
//   SPOTIFY_API   the Spotify receiver's local API (default http://127.0.0.1:3678)
//   DOWNLOADS_DIR where downloads to the box go (default ~/.local/share/ultimatetv/downloads)

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, session } from "electron";
import os from "node:os";
import path from "node:path";
import type { BoxInfo, PlayerState, SpotifyState, WebAppState } from "@ultimatetv/shared";
import { Audio } from "./audio.js";
import { Cec } from "./cec.js";
import { Diagnostics } from "./diagnostics.js";
import { Display } from "./display.js";
import { Downloads } from "./downloads.js";
import { Mpv } from "./mpv.js";
import { Player } from "./player.js";
import { renameSpotifyDevice, Spotify } from "./spotify.js";
import { Updates } from "./updates.js";
import { WebApps } from "./webapp.js";

const HUB_URL = (process.env.HUB_URL ?? "http://192.168.0.19:8095").replace(/\/$/, "");
const CEC_DEVICE = process.env.CEC_DEVICE ?? "/dev/cec0";
const RUNTIME = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
const VERSION: string = require("../package.json").version;

const diagnostics = new Diagnostics(HUB_URL);
const log = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  diagnostics.record(stamped);
};

// Wayland where there is one (KDE), and the class KWin's rules use to keep this window on top.
app.commandLine.appendSwitch("ozone-platform-hint", "auto");
app.commandLine.appendSwitch("class", "ultimatetv");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");
app.setName("ultimatetv");

let win: BrowserWindow | null = null;
let blocker: number | null = null;

/**
 * When the Hub moves (to this box, say, at 127.0.0.1), the TV's pairing cookie is still filed under
 * the old address. The Hub's data moves with it, so the same token still works: copy it across
 * rather than make the TV ask to be let in again.
 */
async function carryPairing(): Promise<void> {
  try {
    const cookies = session.defaultSession.cookies;
    if ((await cookies.get({ url: HUB_URL, name: "utv_device" })).length) return;
    const old = (await cookies.get({ name: "utv_device" })).sort((a, b) => (b.expirationDate ?? 0) - (a.expirationDate ?? 0))[0];
    if (!old) return;
    await cookies.set({ url: `${HUB_URL}/`, name: old.name, value: old.value, path: "/", httpOnly: true, sameSite: "strict", expirationDate: Math.floor(Date.now() / 1000) + 10 * 365 * 86_400 });
    log(`Hub moved to ${HUB_URL}: kept the TV's pairing from ${old.domain}`);
  } catch (e) {
    log(`Couldn't carry the TV's pairing over: ${(e as Error).message}`);
  }
}

// The app's name as the Hub last gave it (the TV UI's page title), for when the Hub can't be reached.
const NAME_FILE = path.join(app.getPath("userData"), "app-name");
let appName = (() => {
  try {
    return readFileSync(NAME_FILE, "utf8").trim() || "UltimateTV";
  } catch {
    return "UltimateTV";
  }
})();
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const offlinePage = (reason: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a0f1a;color:#e8edf5;font:32px system-ui,sans-serif;text-align:center">
<div><div style="font-size:64px;font-weight:700;margin-bottom:24px">${escapeHtml(appName)}</div>Can't reach the Hub at ${HUB_URL}<br><span style="opacity:.6;font-size:24px">${escapeHtml(reason)} · trying again</span></div>
<script>setTimeout(()=>location.replace(${JSON.stringify(`${HUB_URL}/app/`)}),5000)</script></body></html>`)}`;

async function main(): Promise<void> {
  await app.whenReady();
  const display = new Display(log, process.env.CUSTOM_MODES !== "0");
  await display.unscaled().catch((e: Error) => log(`Couldn't unscale the screen: ${e.message}`));
  const mpv = new Mpv({ socket: path.join(RUNTIME, "ultimatetv-mpv.sock"), log, ...(process.env.AUDIO_DEVICE ? { audioDevice: process.env.AUDIO_DEVICE } : {}), extraArgs: (process.env.MPV_ARGS ?? "").split(/\s+/).filter(Boolean) });
  const cec = new Cec(CEC_DEVICE, log);
  const screenSize = () => {
    const b = win?.getContentBounds() ?? screen.getPrimaryDisplay().bounds;
    return { width: b.width, height: b.height };
  };
  const player = new Player(mpv, display, screenSize, log);
  const updates = new Updates(log);
  const spotify = new Spotify((process.env.SPOTIFY_API ?? "http://127.0.0.1:3678").replace(/\/$/, ""), log);
  const webApps = new WebApps(() => win, log);
  const downloads = new Downloads(HUB_URL, log);

  // Sound to the TV before mpv opens its output; again before each play, in case the TV moved.
  const audio = new Audio(log);
  const hdmiAudio = process.env.HDMI_AUDIO !== "0" && !process.env.AUDIO_DEVICE;
  if (hdmiAudio) {
    await audio.useHdmi();
    await audio.fullVolume();
  }
  await mpv.start().catch((e: Error) => log(`mpv didn't start: ${e.message}`));
  await player.start().catch((e: Error) => log(e.message));
  void cec.start();

  const send = (channel: string, value: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
  };
  let lastStatus: PlayerState["status"] | undefined;
  player.onState((s: PlayerState) => {
    send("agent:state", s);
    // Report to the Hub as playback starts and ends, so a diagnosis sees both.
    if (s.status !== lastStatus && (s.status === "playing" || s.status === "idle" || s.status === "error" || s.status === "ended")) {
      log(`Player ${s.status}${s.error ? `: ${s.error}` : ""}`);
      setTimeout(() => void diagnostics.send(), s.status === "playing" ? 5000 : 0);
    }
    lastStatus = s.status;
    // Keep the screen awake while something plays.
    const playing = s.status === "playing" || s.status === "buffering" || s.status === "loading";
    if (playing && blocker === null) blocker = powerSaveBlocker.start("prevent-display-sleep");
    if (!playing && blocker !== null) {
      powerSaveBlocker.stop(blocker);
      blocker = null;
    }
  });
  // One thing plays at a time: music pauses for a film, and Spotify and Deezer pause each other.
  const pauseMusic = async (except?: "spotify" | "web") => {
    if (except !== "spotify") await spotify.control({ cmd: "pause" }).catch(() => undefined);
    if (except !== "web") await webApps.control("pause");
  };
  let spotifyStatus: SpotifyState["status"] = "stopped";
  spotify.onState((s) => {
    send("agent:spotify", s);
    if (s.status === "playing" && spotifyStatus !== "playing") {
      // Started from a phone, perhaps: the film pauses, Deezer stops.
      if (lastStatus === "playing") void player.pause(true);
      void pauseMusic("spotify");
    }
    spotifyStatus = s.status;
  });
  let webPlaying = false;
  webApps.onState((s: WebAppState) => {
    send("agent:webapp", s);
    const playing = Boolean(s.nowPlaying?.playing);
    if (playing && !webPlaying) {
      if (lastStatus === "playing") void player.pause(true);
      void pauseMusic("web");
    }
    webPlaying = playing;
  });
  spotify.start();
  void webApps.checkSignedIn();
  downloads.onChange((d) => send("agent:downloads", d));
  void downloads.start().catch((e: Error) => log(`Downloads didn't start: ${e.message}`));

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
    play: async (o: never) => {
      await pauseMusic();
      if (hdmiAudio) await audio.useHdmi();
      return player.play(o);
    },
    stop: () => player.stop(),
    pause: (p: never) => player.pause(p),
    seek: (ms: never, mode: never) => player.seek(ms, mode),
    goLive: () => player.goLive(),
    setAudioTrack: (id: never) => player.setAudioTrack(id),
    setSubtitleTrack: (id: never) => player.setSubtitleTrack(id),
    setNightMode: (on: never) => player.setNightMode(on),
    setLayout: (l: never) => player.setLayout(l),
    stats: () => player.stats(),
    wakeTv: () => cec.wakeTv(),
    reload: async () => win?.webContents.reloadIgnoringCache(),
    software: (check: never) => updates.status(Boolean(check)),
    update: () => updates.start(),
    spotify: async () => spotify.current(),
    spotifyLibrary: (kind: never, offset: never) => spotify.library(kind, offset),
    spotifyTracks: (uri: never) => spotify.tracks(uri),
    spotifyPlay: (uri: never, options: never) => spotify.play(uri, options),
    spotifyControl: (c: never) => spotify.control(c),
    spotifySetup: (setup: never) => spotify.setup(setup),
    openWebApp: (id: never) => webApps.open(id),
    closeWebApp: () => webApps.close(),
    webAppKey: (a: never) => webApps.key(a),
    webAppText: (t: never) => webApps.text(t),
    webAppControl: (c: never) => webApps.control(c),
    webApp: async () => webApps.state(),
    webAppLogin: (id: never, login: never) => webApps.login(id, login),
    downloads: () => downloads.list(),
    download: (items: never) => downloads.add(items),
    removeDownload: (id: never) => downloads.remove(id),
    retryDownload: (id: never) => downloads.retry(id),
    downloadSettings: (s: never) => downloads.setSettings(s),
    localCopy: (req: never) => downloads.localCopy(req),
    downloadPosition: (id: never, positionMs: never, durationMs: never) => downloads.position(id, positionMs, durationMs),
  };
  diagnostics.start({ sample: () => player.sample(), software: () => updates.status(false), info: () => methods.info!() });

  ipcMain.handle("agent", async (e, method: string, ...args: unknown[]) => {
    if (!win || e.sender !== win.webContents) throw new Error("Not the TV window");
    const fn = methods[method];
    if (!fn) throw new Error(`Unknown method ${method}`);
    return (fn as (...a: unknown[]) => Promise<unknown>)(...args);
  });

  // Only the Hub's pages run here (and the music web players, on their own sites); no pop-ups,
  // permissions or downloads.
  const hubOrigin = new URL(HUB_URL).origin;
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "fullscreen"));
  app.on("web-contents-created", (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (ev, url) => {
      if (!url.startsWith("data:") && new URL(url).origin !== hubOrigin && !webApps.allows(wc, url)) ev.preventDefault();
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
    title: appName,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  win.setMenu(null);
  win.webContents.setZoomFactor(1);
  win.once("ready-to-show", () => win?.show());
  // The TV UI titles its page with the app's name: remember it, and give Spotify the same name.
  win.webContents.on("page-title-updated", (_e, title) => {
    const name = title.trim();
    if (!win?.webContents.getURL().startsWith(HUB_URL) || !name || name.length > 24) return;
    if (name !== appName) {
      appName = name;
      try {
        writeFileSync(NAME_FILE, name);
      } catch (e) {
        log(`Couldn't save the app's name: ${(e as Error).message}`);
      }
    }
    void renameSpotifyDevice(name, log);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (url.startsWith(HUB_URL) && code !== -3) {
      log(`UI didn't load (${desc})`);
      void win?.loadURL(offlinePage(desc));
    }
  });
  // An error page from the Hub (an old Hub without the TV app gives 404) would be invisible in the
  // transparent window, so show the offline page instead.
  win.webContents.on("did-navigate", (_e, url, code) => {
    if (url.startsWith(HUB_URL) && code >= 400) {
      log(`UI didn't load (HTTP ${code} from ${url})`);
      void win?.loadURL(offlinePage(`The Hub answered ${code}; update it`));
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
  await carryPairing();
  await win.loadURL(`${HUB_URL}/app/`).catch(() => undefined);

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    diagnostics.stop();
    cec.stop();
    spotify.stop();
    webApps.stop();
    downloads.stop();
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
