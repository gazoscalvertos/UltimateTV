// Where a desktop install of the app keeps things, per platform, and where it finds mpv.
//
// The TV box is always Linux, so the rest of the app can assume /etc/ultimatetv and systemd. A
// desktop install can be Linux (the AppImage, docs/desktop.md), Windows (#127) or macOS (#128), and
// each of those puts per-user data somewhere else:
//
//   Windows  settings %APPDATA%\ultimatetv,      state %LOCALAPPDATA%\ultimatetv, log …\ultimatetv\logs
//   macOS    settings and state ~/Library/Application Support/ultimatetv, log ~/Library/Logs/UltimateTV
//   Linux    settings $XDG_CONFIG_HOME/ultimatetv, state $XDG_STATE_HOME/ultimatetv (as before)
//
// Nothing here touches Electron, so every path can be tested on any machine by passing a platform,
// an environment and a home folder (box/test/platform.test.ts).
//
// mpv is not bundled on Linux: the distro's own mpv uses the distro's graphics drivers (see the end
// of docs/desktop.md). Windows and macOS have no system mpv, so those installers carry one in the
// app's resources and mpvBinary() finds it there before falling back to PATH.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopAsset, desktopKind } from "@ultimatetv/shared";

export type DesktopPlatform = "linux" | "win32" | "darwin";

/** The platform as one of the three we ship a desktop build for; anything else is treated as Linux. */
export function desktopPlatform(platform: string = process.platform): DesktopPlatform {
  return platform === "win32" || platform === "darwin" ? platform : "linux";
}

/** Where a desktop install keeps its settings: the folder holding box.env. */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, home = os.homedir()): string {
  const on = desktopPlatform(platform);
  if (on === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "ultimatetv");
  if (on === "darwin") return path.join(home, "Library", "Application Support", "ultimatetv");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "ultimatetv");
}

/** box.env: the settings file a desktop install reads on start (mode.ts). */
export function desktopConfigFile(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, home = os.homedir()): string {
  return path.join(configDir(env, platform, home), "box.env");
}

/** Where the app may write its own state (a name, an offline profile, update records). */
export function stateDir(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, home = os.homedir()): string {
  const on = desktopPlatform(platform);
  if (on === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "ultimatetv");
  if (on === "darwin") return path.join(home, "Library", "Application Support", "ultimatetv");
  return path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "ultimatetv");
}

/** The desktop build's log: where "If it goes wrong" in docs/desktop.md sends people. */
export function desktopLogFile(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, home = os.homedir()): string {
  const on = desktopPlatform(platform);
  if (on === "win32") return path.join(stateDir(env, platform, home), "logs", "ultimatetv-desktop.log");
  if (on === "darwin") return path.join(home, "Library", "Logs", "UltimateTV", "ultimatetv-desktop.log");
  return path.join(stateDir(env, platform, home), "ultimatetv-desktop.log");
}

/** Where downloads (films and series taken off the Hub) are kept by default. */
export function downloadsDir(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, home = os.homedir()): string {
  const on = desktopPlatform(platform);
  if (on === "win32") return path.join(env.USERPROFILE || home, "Videos", "UltimateTV");
  if (on === "darwin") return path.join(home, "Movies", "UltimateTV");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "ultimatetv", "downloads");
}

/**
 * The heartbeat file (heartbeat.ts). On the box it is exactly where tools/box/healthcheck.sh looks
 * for it; a desktop copy keeps it with the rest of its state instead of inventing ~/.local on
 * Windows or a Mac.
 */
export function heartbeatFile(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, home = os.homedir()): string {
  if (desktopPlatform(platform) === "linux") return path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "ultimatetv-health");
  return path.join(stateDir(env, platform, home), "ultimatetv-health");
}

/**
 * The path mpv's JSON IPC listens on. A filesystem socket everywhere but Windows, where mpv only
 * speaks over a named pipe, so the socket path is a pipe name and is not a file.
 */
export function mpvSocket(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (desktopPlatform(platform) === "win32") return "\\\\.\\pipe\\ultimatetv-mpv";
  return path.join(env.XDG_RUNTIME_DIR || os.tmpdir(), "ultimatetv-mpv.sock");
}

/** True for the named-pipe form above: it must not be stat'ed for readiness or unlinked. */
export function isPipePath(socket: string): boolean {
  return socket.startsWith("\\\\");
}

/** The file name an mpv build ships under, per platform. */
export function mpvFileName(platform: string = process.platform): string {
  return desktopPlatform(platform) === "win32" ? "mpv.exe" : "mpv";
}

export interface MpvLocation {
  /** What to hand to spawn(): an absolute path, or "mpv" when it came from PATH. */
  command: string;
  /** True when the path is inside the app (what the installer ships), false for PATH or MPV_BIN. */
  bundled: boolean;
}

/**
 * Where mpv is, in the order that makes a bundled copy win:
 *
 *   1. MPV_BIN, for anyone pointing the app at their own build;
 *   2. <resources>/mpv/mpv[.exe], which electron-builder copies in from the build's vendor folder
 *      (tools/desktop/vendor/, see "Bundling mpv" in docs/desktop.md);
 *   3. "mpv" from PATH: the Linux arrangement, and the escape hatch on Windows and macOS.
 *
 * `exists` is injected so the order can be tested without real binaries.
 */
export function mpvBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  resourcesPath: string = process.resourcesPath ?? path.join(process.cwd(), "resources"),
  exists: (p: string) => boolean = existsSync,
): MpvLocation {
  const want = env.MPV_BIN;
  if (want) return { command: want, bundled: false };
  const bundled = path.join(resourcesPath, "mpv", mpvFileName(platform));
  if (exists(bundled)) return { command: bundled, bundled: true };
  return { command: "mpv", bundled: false };
}

/**
 * The installer (or disk image) name for a platform and architecture. The names themselves live in
 * shared/src/desktop.ts, because the Hub builds its download links from the same release assets;
 * this is only the platform-shaped way in for the app.
 */
export function installerAssetName(platform: string, arch: string = process.arch): string {
  return desktopAsset(desktopKind(platform), arch);
}

/** What an installer download starts (or ends) with, so a bad one is caught before it is opened. */
export type InstallerKind = "exe" | "dmg" | "appimage";

export function installerKind(platform: string): InstallerKind {
  const on = desktopPlatform(platform);
  return on === "win32" ? "exe" : on === "darwin" ? "dmg" : "appimage";
}
