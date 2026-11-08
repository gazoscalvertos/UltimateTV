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
//   UXPLAY_ARGS   extra UxPlay (AirPlay receiver) arguments, space separated, e.g. -vd vah264dec
//
// The same app runs on a desktop as an AppImage (mode.ts, docs/desktop.md): a normal window, video
// in mpv's own window, settings in ~/.config/ultimatetv/box.env, and the screen, sound, CEC and
// updates left to the computer (CEC only if CEC_DEVICE is set).

import { DESKTOP, MODE } from "./mode.js";

import { execFile } from "node:child_process";
import { AppImageUpdates } from "./appimage-updates.js";
import { DesktopAppUpdates, installerFor } from "./desktop-app-updates.js";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, session, shell } from "electron";
import os from "node:os";
import path from "node:path";
import type { BtAction, BoxInfo, CastState, LimitedPlayRequest, OfflineProfile, PlayerState, SelfTestCall, SpotifyState, WebAppState } from "@ultimatetv/shared";
import { Audio } from "./audio.js";
import { Bluetooth } from "./bluetooth.js";
import { Cast } from "./cast.js";
import { Cec } from "./cec.js";
import { Diagnostics } from "./diagnostics.js";
import { Display } from "./display.js";
import { Downloads } from "./downloads.js";
import { Heartbeat } from "./heartbeat.js";
import { hubAnswers, HubWatch } from "./hubwatch.js";
import { LimitedCache, LIMITED_REFRESH_MS, refreshDue } from "./limited.js";
import { jellyfinReportFor, reportJellyfinProgress, resolveLimitedPlay, type JellyfinReportState } from "./limitedplay.js";
import { UiCheck } from "./uicheck.js";
import { Mpv } from "./mpv.js";
import { Player } from "./player.js";
import { raiseSoon } from "./raise.js";
import { defaultSelftestDir, desktopSelftestDir, ensureClips, SelfTester } from "./selftest.js";
import { renameSpotifyDevice, Spotify } from "./spotify.js";
import { desktopLogFile, desktopPlatform, downloadsDir, mpvBinary, mpvSocket } from "./platform.js";
import { Updates } from "./updates.js";
import { WebApps } from "./webapp.js";

const HUB_URL = (process.env.HUB_URL ?? "http://192.168.0.19:8095").replace(/\/$/, "");
const CEC_DEVICE = process.env.CEC_DEVICE ?? (DESKTOP ? "" : "/dev/cec0");
const RUNTIME = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
const VERSION: string = require("../package.json").version;
/** Which desktop this is: the box is always Linux; Windows and macOS get the desktop app. */
const PLATFORM = desktopPlatform();

const diagnostics = new Diagnostics(HUB_URL);
// The box's launcher sends the output to ~/.local/state/ultimatetv.log; a desktop copy started from
// the menu (or from the Start menu, or Spotlight) has nowhere to send it, so it writes its own:
// %LOCALAPPDATA%\ultimatetv\logs on Windows, ~/Library/Logs/UltimateTV on a Mac, and
// ~/.local/state/ultimatetv-desktop.log on Linux (platform.ts).
const desktopLog = DESKTOP ? desktopLogFile(process.env, PLATFORM) : null;
const log = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  diagnostics.record(stamped);
  if (desktopLog) {
    try {
      appendFileSync(desktopLog, `${stamped}\n`);
    } catch {
      // As above.
    }
  }
};

// Wayland where there is one, and the class KWin's rules use to keep this window on top (and a
// desktop's window rules can match, e.g. Hyprland's class:^(ultimatetv)$).
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

/**
 * The TV's pairing token, which is what lets the box ask the Hub for its Limited-mode copy. Electron
 * keeps it as a cookie; a plain `fetch` has no cookie jar, so it is read out here and sent by hand.
 */
async function deviceToken(): Promise<string | undefined> {
  try {
    const jar = session.defaultSession.cookies;
    const mine = await jar.get({ url: HUB_URL, name: "utv_device" });
    const any = mine.length ? mine : await jar.get({ name: "utv_device" });
    return any.sort((a, b) => (b.expirationDate ?? 0) - (a.expirationDate ?? 0))[0]?.value;
  } catch {
    return undefined;
  }
}

/** Asks the Hub for the box's Limited-mode copy. Throws with a plain reason when it can't. */
async function fetchHubSnapshot(): Promise<unknown> {
  const token = await deviceToken();
  const res = await fetch(`${HUB_URL}/api/box/offline`, {
    headers: token ? { "x-device-token": token } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`the Hub answered ${res.status}`);
  return (await res.json()) as unknown;
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

// The box's own screen for when the Hub is down (box/offline, see hubwatch.ts), and the profile it
// follows: the one last used on the TV, so Kids only get their own downloads.
const OFFLINE_PAGE = path.join(__dirname, "../offline/index.html");
const PROFILE_FILE = path.join(app.getPath("userData"), "offline-profile.json");
// The Bluetooth audio delay, kept on the box because it belongs to its own headphones (#102).
const BLUETOOTH_FILE = path.join(app.getPath("userData"), "bluetooth.json");
let offlineReason = "";
let offlineProfile: OfflineProfile | null = (() => {
  try {
    return JSON.parse(readFileSync(PROFILE_FILE, "utf8")) as OfflineProfile;
  } catch {
    // Not known yet: the screen treats whoever's watching as Kids.
    return null;
  }
})();
// Limited mode (#78): what the box keeps so the TV still works with the Hub off. The cache holds the
// channel URLs, a week of guide, every profile's rules and the Jellyfin connection; it is refreshed
// while the Hub is up and read when it isn't. It sits in userData beside everything else the box keeps.
const LIMITED_FILE = path.join(app.getPath("userData"), "limited.json");
const boxAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);

async function main(): Promise<void> {
  if (desktopLog) {
    try {
      mkdirSync(path.dirname(desktopLog), { recursive: true });
      // A fresh log each start (only the copy that runs gets here), so it never grows without end.
      writeFileSync(desktopLog, "");
    } catch {
      // Logging to the terminal only.
    }
  }
  await app.whenReady();
  log(`UltimateTV ${VERSION} starting in ${MODE} mode for the Hub at ${HUB_URL}`);
  const display = new Display(log, process.env.CUSTOM_MODES !== "0", !DESKTOP);
  await display.unscaled().catch((e: Error) => log(`Couldn't unscale the screen: ${e.message}`));
  const mpv = new Mpv({
    // Windows has no Unix socket and mpv there speaks over a named pipe (platform.ts).
    socket: mpvSocket(process.env, PLATFORM),
    log,
    ...(process.env.AUDIO_DEVICE ? { audioDevice: process.env.AUDIO_DEVICE } : {}),
    extraArgs: (process.env.MPV_ARGS ?? "").split(/\s+/).filter(Boolean),
    ...(DESKTOP ? { desktop: true, inputConf: path.join(RUNTIME, "ultimatetv-mpv-input.conf") } : {}),
    // The Windows and Mac installers carry their own mpv; Linux uses the computer's.
    binary: mpvBinary(process.env, PLATFORM).command,
  });
  const cec = new Cec(CEC_DEVICE, log);
  const screenSize = () => {
    const b = win?.getContentBounds() ?? screen.getPrimaryDisplay().bounds;
    return { width: b.width, height: b.height };
  };
  const player = new Player(mpv, display, screenSize, log, DESKTOP);
  // The on-box self-test (#105): clips generated on the box itself, played one at a time, with what
  // mpv and the screen reported recorded beside the household's answer.
  const selfTestDir = process.env.SELFTEST_DIR ?? (DESKTOP ? desktopSelftestDir(process.env, PLATFORM) : defaultSelftestDir());
  const selfTester = new SelfTester({ player, mpv, display, dir: selfTestDir, log });
  // The AppImage swaps itself for the new one from GitHub; an installed Windows or Mac copy asks
  // the same release for the new installer and opens it (desktop-app-updates.ts); the box updates
  // through its root services; a desktop copy run from a checkout (npm start -- --desktop) has no
  // installer to fetch, so it doesn't update.
  const appImage = process.env.APPIMAGE;
  const installer = installerFor(PLATFORM);
  const updates = appImage
    ? new AppImageUpdates({
        appImage,
        buildInfo: path.join(__dirname, "../build-info.json"),
        stateDir: app.getPath("userData"),
        log,
        ...(process.env.UPDATE_URL ? { baseUrl: process.env.UPDATE_URL } : {}),
        relaunch: () => {
          app.relaunch({ execPath: appImage, args: process.argv.slice(1) });
          app.quit();
        },
      })
    : DESKTOP && installer
      ? new DesktopAppUpdates({
          platform: PLATFORM,
          arch: process.arch,
          buildInfo: path.join(__dirname, "../build-info.json"),
          stateDir: app.getPath("userData"),
          log,
          ...(process.env.UPDATE_URL ? { baseUrl: process.env.UPDATE_URL } : {}),
          openInstaller: (file) => shell.openPath(file),
        })
      : new Updates(log);
  const spotify = new Spotify((process.env.SPOTIFY_API ?? "http://127.0.0.1:3678").replace(/\/$/, ""), log);
  const webApps = new WebApps(() => win, log);
  const downloads = new Downloads(HUB_URL, log, downloadsDir(process.env, PLATFORM));
  let castForeground = false;
  // The box's copy of what Limited mode needs (#78). Fetched from the Hub's one answer for the box,
  // `/api/box/offline`, which carries the channels' own feed URLs, a week of guide, every profile's
  // rules and the Jellyfin connection. The TV's pairing token is what lets it ask.
  const limited = new LimitedCache({
    file: LIMITED_FILE,
    fetchSnapshot: fetchHubSnapshot,
    readFile: (file) => readFileSync(file, "utf8"),
    writeFile: (file, text) => writeFileSync(file, text),
    rename: (from, to) => renameSync(from, to),
    log,
  });
  const watch = new HubWatch({
    probe: () => hubAnswers(HUB_URL),
    showOffline: (reason) => showOffline(reason),
    showApp: () => {
      void win?.loadURL(`${HUB_URL}/app/`);
      // Fresh copy for the next time the Hub goes away.
      void limited.refresh();
    },
    busy: () => castForeground || (lastStatus !== undefined && lastStatus !== "idle" && lastStatus !== "ended" && lastStatus !== "error"),
    log,
  });
  const showOffline = (reason: string) => {
    offlineReason = reason;
    watch.wentOffline();
    void win?.loadFile(OFFLINE_PAGE).catch((e: Error) => log(`Couldn't show the box's own screen: ${e.message}`));
  };
  // A Hub that answers is not the same as a TV app that works: see uicheck.ts.
  const uiCheck = new UiCheck({
    drawn: async () => {
      if (!win || win.isDestroyed()) return true;
      return Boolean(
        await win.webContents.executeJavaScript(
          `(() => { const root = document.getElementById("app"); return !!root && root.childElementCount > 0; })()`,
          true,
        ),
      );
    },
    reload: async () => {
      // Always the TV app, not whatever is showing now: after giving up, the box's own screen is up.
      await win?.loadURL(`${HUB_URL}/app/`, { extraHeaders: "pragma: no-cache\n" });
    },
    busy: () => castForeground || (lastStatus !== undefined && lastStatus !== "idle" && lastStatus !== "ended" && lastStatus !== "error"),
    showOffline: (reason) => showOffline(reason),
    log,
  });

  // Sound to the TV before mpv opens its output; again before each play, in case the TV moved.
  const audio = new Audio(log);
  // A desktop's sound output and volume are its owner's business.
  const hdmiAudio = !DESKTOP && process.env.HDMI_AUDIO !== "0" && !process.env.AUDIO_DEVICE;
  if (hdmiAudio) {
    await audio.useHdmi();
    await audio.fullVolume();
  }
  // Bluetooth headphones, speakers and controllers (#102). Only a real box has them; a desktop
  // leaves the computer's own sound alone.
  const bluetooth = DESKTOP
    ? null
    : new Bluetooth({
        stateFile: BLUETOOTH_FILE,
        log,
        useSink: (sink) => audio.useSink(sink),
        setPcm: (on) => void player.setBluetooth(on),
        setAudioDelay: (seconds) => void player.setAudioDelay(seconds),
      });
  await mpv.start().catch((e: Error) => log(`mpv didn't start: ${e.message}`));
  await player.start().catch((e: Error) => log(e.message));
  if (CEC_DEVICE) void cec.start();

  const send = (channel: string, value: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
  };
  let lastStatus: PlayerState["status"] | undefined;
  // A Jellyfin film started from Limited mode (#78): the box reports its place straight to Jellyfin,
  // since no Hub is there to do it, so Continue watching is right when the Hub comes back.
  let limitedFilm: { itemId: string } | null = null;
  let lastReport: JellyfinReportState | null = null;
  const reportLimitedProgress = (s: PlayerState) => {
    if (!limitedFilm) return;
    const jf = limited.snapshot()?.jellyfin;
    if (!jf) return;
    const report = jellyfinReportFor(lastReport, { status: s.status, positionMs: s.positionMs }, Date.now(), s.status === "paused");
    if (s.status === "playing" || s.status === "paused") lastReport = { at: Date.now(), status: s.status === "paused" ? "paused" : "playing" };
    if (report) void reportJellyfinProgress(fetch, jf, { itemId: limitedFilm.itemId, ...report });
    if (s.status === "ended" || s.status === "error" || s.status === "idle") {
      // The film is over: the next Hub check may swap the page back, and nothing is lost.
      limitedFilm = null;
      lastReport = null;
    }
  };
  player.onState((s: PlayerState) => {
    send("agent:state", s);
    reportLimitedProgress(s);
    // Report to the Hub as playback starts and ends, so a diagnosis sees both.
    if (s.status !== lastStatus && (s.status === "playing" || s.status === "idle" || s.status === "error" || s.status === "ended")) {
      log(`Player ${s.status}${s.error ? `: ${s.error}` : ""}`);
      // (Not from a desktop: the Hub keeps one box's diagnostics, and that's the TV's.)
      if (!DESKTOP) setTimeout(() => void diagnostics.send(), s.status === "playing" ? 5000 : 0);
    }
    // A film switches the screen's refresh rate and HDR, which can leave mpv's window in front of the
    // UI and hide every pop-up, clip and prompt (raise.ts). Put the UI back on top as it starts.
    if (!DESKTOP && s.status !== lastStatus && (s.status === "loading" || s.status === "playing")) raiseSoon(() => win);
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

  // AirPlay and games (cast.ts). While AirPlay mirrors, the UI stays on top but draws nothing (it
  // still hears the remote); a game gets the whole screen, keyboard and controllers to itself.
  const cast = new Cast({
    runtimeDir: RUNTIME,
    configFile: path.join(app.getPath("userData"), "cast.json"),
    name: () => appName,
    log,
    extraUxplayArgs: (process.env.UXPLAY_ARGS ?? "").split(/\s+/).filter(Boolean),
    onForeground: (kind) => {
      castForeground = Boolean(kind);
      if (kind) {
        if (lastStatus === "playing") void player.pause(true);
        void pauseMusic();
      }
      if (kind === "app") win?.hide();
      else if (win && !win.isVisible()) {
        win.show();
        win.focus();
      }
    },
  });
  cast.onChange((s: CastState) => send("agent:cast", s));
  void cast.start().catch((e: Error) => log(`AirPlay and games didn't start: ${e.message}`));
  void downloads.start().catch((e: Error) => log(`Downloads didn't start: ${e.message}`));
  void bluetooth?.start().catch((e: Error) => log(`Bluetooth didn't start: ${e.message}`));

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
    setClipSound: (on: never) => player.setClipSound(on),
    setLayout: (l: never) => player.setLayout(l),
    toggleFullscreen: () => player.toggleFullscreen(),
    stats: () => player.stats(),
    selfTest: async (what: never) => {
      const a = (what ?? {}) as SelfTestCall;
      if (a.action === "prepare") return { ready: selfTester.ready(), missing: await ensureClips(selfTestDir, log) };
      if (a.action === "play") return selfTester.play(a.id);
      if (a.action === "stop") {
        await selfTester.stop();
        return { ok: true };
      }
      throw new Error(`Unknown self-test action ${String((a as { action?: string }).action)}`);
    },
    bluetooth: async (a: never) => (bluetooth ? bluetooth.act((a ?? { do: "status" }) as BtAction) : { available: false, powered: false, scanning: false, devices: [], output: { kind: "tv" as const }, delayMs: 0, reason: "Bluetooth is set up on the TV box, not on a desktop" }),
    wakeTv: () => cec.wakeTv(),
    reload: async () => win?.webContents.reloadIgnoringCache(),
    software: (check: never) => updates.status(Boolean(check)),
    update: () => updates.start(),
    rollback: () => updates.rollBack(),
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
    cast: async () => cast.state(),
    castSettings: (s: never) => cast.settings(s),
    launchApp: (id: never) => cast.launch(id),
    stopApp: () => cast.stopForeground(),
    tvStandby: () => cec.standby(),
    addSubtitle: (sub: never) => player.addSubtitle(sub),
    setSubtitleStyle: (style: never) => player.setSubtitleStyle(style),
    setVolume: (pct: never) => player.setVolume(pct),
    offlineProfile: async (p: never) => {
      const next = p as OfflineProfile;
      if (!next || typeof next.name !== "string" || typeof next.kids !== "boolean") return;
      if (JSON.stringify(next) === JSON.stringify(offlineProfile)) return;
      offlineProfile = { name: next.name.slice(0, 40), kids: next.kids, ...(next.kids ? { allowedDownloads: (next.allowedDownloads ?? []).filter((id) => typeof id === "string") } : {}) };
      try {
        writeFileSync(PROFILE_FILE, JSON.stringify(offlineProfile));
      } catch (e) {
        log(`Couldn't save the profile for the Hub-down screen: ${(e as Error).message}`);
      }
    },
    // The box's Hub-down screen.
    hubStatus: async () => ({ hubUrl: HUB_URL, appName, reason: offlineReason, since: watch.since, addresses: boxAddresses(), profile: offlineProfile, hubBack: watch.hubBack }),
    retryHub: async () => void watch.check(),
    // Limited mode (#78): what the box kept, and playing from it with the Hub off. The Kids rules run
    // in resolveLimitedPlay, from the cached profiles, so the reduced app can't offer more than the
    // full one would; this only wires the answer to mpv and the player's progress to Jellyfin.
    limitedView: async () => limited.view(offlineProfile),
    limitedPlay: async (req: never) => {
      const result = resolveLimitedPlay(limited.snapshot(), offlineProfile, req as LimitedPlayRequest);
      if (!result.ok) return result;
      await methods.play!(result.options as never);
      limitedFilm = result.jellyfin ?? null;
      lastReport = null;
      return {
        ok: true as const,
        title: result.options.title ?? "",
        ...(result.options.artwork ? { artwork: result.options.artwork } : {}),
        live: result.options.live,
        ...(result.jellyfin?.durationMs !== undefined ? { durationMs: result.jellyfin.durationMs } : {}),
      };
    },
  };
  if (!DESKTOP) diagnostics.start({ sample: () => player.sample(), software: () => updates.status(false), info: () => methods.info!(), updateLog: () => updates.history() });
  // Tells the check after an update that the app is up (tools/box/healthcheck.sh).
  const heartbeat = new Heartbeat(async () => ({ page: watch.mode, hub: await hubAnswers(HUB_URL) }), VERSION, log);

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
  const webPreferences = {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: false,
    backgroundThrottling: false,
    // Tells the UI it's on a desktop (preload.ts), so it leaves phone commands to the TV box.
    ...(DESKTOP ? { additionalArguments: ["--utv-desktop"] } : {}),
  };
  win = DESKTOP
    ? // A normal window, 16:9 like the TV (the UI scales to any size). Video opens in mpv's own
      // window, so this one is opaque: the hole the UI leaves for video is just black.
      new BrowserWindow({
        width: Math.min(1600, Math.round(width * 0.8)),
        height: Math.min(900, Math.round((Math.min(1600, Math.round(width * 0.8)) * 9) / 16)),
        minWidth: 640,
        minHeight: 360,
        backgroundColor: "#000000",
        show: false,
        title: appName,
        autoHideMenuBar: true,
        webPreferences,
      })
    : new BrowserWindow({
        width,
        height,
        fullscreen: true,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        show: false,
        title: appName,
        webPreferences,
      });
  win.setMenu(null);
  if (!DESKTOP) {
    // The screen changing mode or HDR (display.ts) is when the stacking is lost: raise again after.
    const again = () => raiseSoon(() => win);
    screen.on("display-metrics-changed", again);
    screen.on("display-added", again);
    screen.on("display-removed", again);
    raiseSoon(() => win);
  }
  if (DESKTOP) {
    // F11 for full screen, as in a browser; the TV UI has no use for the key.
    win.webContents.on("before-input-event", (e, input) => {
      if (input.type === "keyDown" && input.key === "F11") {
        e.preventDefault();
        win?.setFullScreen(!win.isFullScreen());
      }
    });
    // Back from mpv's window (q, Esc, closing it) leaves playback stopped: bring the app forward.
    player.onState((s) => {
      if ((s.status === "idle" || s.status === "ended") && win && !win.isDestroyed() && !win.isFocused()) win.focus();
    });
  }
  win.webContents.setZoomFactor(1);
  win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-finish-load", () => {
    heartbeat.start();
    // Look at what the Hub's page actually drew. The box's own screen is left alone, and its retry
    // timer (set by the check that gave up) keeps running, so a Hub fixed later puts the TV right.
    if (win?.webContents.getURL().startsWith(HUB_URL)) uiCheck.start();
  });
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
      // AirPlay announces the name it started with.
      void cast.settings({ name });
    }
    void renameSpotifyDevice(name, log);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (url.startsWith(HUB_URL) && code !== -3) {
      log(`UI didn't load (${desc})`);
      showOffline(`The TV app didn't load (${desc})`);
    }
  });
  // An error page from the Hub (an old Hub without the TV app gives 404) would be invisible in the
  // transparent window, so show the offline page instead.
  win.webContents.on("did-navigate", (_e, url, code) => {
    if (url.startsWith(HUB_URL) && code >= 400) {
      log(`UI didn't load (HTTP ${code} from ${url})`);
      showOffline(`The Hub answered ${code}: it may need updating`);
    } else if (url.startsWith(HUB_URL)) watch.wentToApp();
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    log(`UI crashed (${details.reason}); reloading`);
    void player.stop();
    if (watch.mode === "offline") void win?.loadFile(OFFLINE_PAGE);
    else void win?.loadURL(`${HUB_URL}/app/`);
  });
  win.webContents.on("unresponsive", () => {
    log("UI unresponsive; reloading");
    win?.webContents.forcefullyCrashRenderer();
  });
  // The pointer never shows on the TV. On a desktop the UI works with the mouse too and shows and
  // hides the pointer itself (ui/src/mouse.ts).
  // (A Hub too old to have mouse.ts serves a UI that hides it everywhere: show it there.)
  win.webContents.on("dom-ready", () => void win?.webContents.insertCSS(DESKTOP ? "html:not(.mouse) *{cursor:auto!important}" : "*{cursor:none!important}"));
  await carryPairing();
  // Straight to the box's own screen when the Hub's down, rather than waiting on a dead address.
  if (await hubAnswers(HUB_URL)) await win.loadURL(`${HUB_URL}/app/`).catch(() => undefined);
  else {
    log(`The Hub at ${HUB_URL} didn't answer: showing the box's own screen`);
    showOffline("The Hub didn't answer when the box started");
  }
  watch.start();

  // Keep the Limited-mode copy fresh while the Hub is up (#78). A quick look at startup, then every
  // quarter of an hour; a box whose Hub has gone keeps the copy it has. When the Hub comes back the
  // watch refreshes it again, so the copy is never a week stale after a long outage.
  const keepLimitedFresh = () => {
    if (watch.mode !== "app" || !win) return;
    if (!refreshDue(limited.refreshedAt, Date.now())) return;
    void limited.refresh();
  };
  keepLimitedFresh();
  const limitedTimer = setInterval(keepLimitedFresh, LIMITED_REFRESH_MS);
  limitedTimer.unref();

  app.on("window-all-closed", () => app.quit());
  // Started again from the menu: bring the open one forward.
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.show();
    win?.focus();
  });
  app.on("before-quit", () => {
    diagnostics.stop();
    heartbeat.stop();
    watch.stop();
    clearInterval(limitedTimer);
    uiCheck.stop();
    cec.stop();
    spotify.stop();
    webApps.stop();
    downloads.stop();
    cast.stop();
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
