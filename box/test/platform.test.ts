import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  configDir,
  desktopConfigFile,
  desktopLogFile,
  desktopPlatform,
  downloadsDir,
  heartbeatFile,
  installerAssetName,
  installerKind,
  isPipePath,
  mpvBinary,
  mpvFileName,
  mpvSocket,
  stateDir,
} from "../src/platform.js";

const HOME_WIN = "C:\\Users\\Gaz";
const HOME_POSIX = "/home/gaz";

describe("where a desktop install keeps things", () => {
  it("puts Windows settings in %APPDATA%\\ultimatetv, as #127 asks", () => {
    const env = { APPDATA: "C:\\Users\\Gaz\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\Gaz\\AppData\\Local" };
    expect(configDir(env, "win32", HOME_WIN)).toBe(path.join("C:\\Users\\Gaz\\AppData\\Roaming", "ultimatetv"));
    expect(desktopConfigFile(env, "win32", HOME_WIN)).toBe(path.join("C:\\Users\\Gaz\\AppData\\Roaming", "ultimatetv", "box.env"));
    // The state the app writes goes to Local, so it isn't roamed between machines.
    expect(stateDir(env, "win32", HOME_WIN)).toBe(path.join("C:\\Users\\Gaz\\AppData\\Local", "ultimatetv"));
    expect(desktopLogFile(env, "win32", HOME_WIN)).toBe(path.join("C:\\Users\\Gaz\\AppData\\Local", "ultimatetv", "logs", "ultimatetv-desktop.log"));
    expect(downloadsDir(env, "win32", HOME_WIN)).toBe(path.join("C:\\Users\\Gaz", "Videos", "UltimateTV"));
  });

  it("puts Mac settings in ~/Library/Application Support/ultimatetv, as #128 asks", () => {
    expect(configDir({}, "darwin", HOME_POSIX)).toBe(path.join("/home/gaz", "Library", "Application Support", "ultimatetv"));
    expect(desktopConfigFile({}, "darwin", HOME_POSIX)).toBe(path.join("/home/gaz", "Library", "Application Support", "ultimatetv", "box.env"));
    expect(stateDir({}, "darwin", HOME_POSIX)).toBe(path.join("/home/gaz", "Library", "Application Support", "ultimatetv"));
    expect(desktopLogFile({}, "darwin", HOME_POSIX)).toBe(path.join("/home/gaz", "Library", "Logs", "UltimateTV", "ultimatetv-desktop.log"));
    expect(downloadsDir({}, "darwin", HOME_POSIX)).toBe(path.join("/home/gaz", "Movies", "UltimateTV"));
  });

  it("keeps the Linux AppImage's paths as they were", () => {
    const env = { XDG_CONFIG_HOME: "/home/gaz/.config", XDG_STATE_HOME: "/home/gaz/.state", XDG_DATA_HOME: "/home/gaz/.share" };
    expect(configDir(env, "linux", HOME_POSIX)).toBe("/home/gaz/.config/ultimatetv");
    expect(stateDir(env, "linux", HOME_POSIX)).toBe("/home/gaz/.state/ultimatetv");
    expect(desktopLogFile(env, "linux", HOME_POSIX)).toBe(path.join("/home/gaz/.state/ultimatetv", "ultimatetv-desktop.log"));
    expect(downloadsDir(env, "linux", HOME_POSIX)).toBe("/home/gaz/.share/ultimatetv/downloads");
    // With no XDG variables at all, the old defaults under the home folder.
    expect(configDir({}, "linux", HOME_POSIX)).toBe(path.join("/home/gaz", ".config", "ultimatetv"));
    expect(stateDir({}, "linux", HOME_POSIX)).toBe(path.join("/home/gaz", ".local", "state", "ultimatetv"));
  });

  it("falls back to the home folder when APPDATA or a usable env is missing", () => {
    // A stripped environment (a scheduled task, a child process) still gets a real path.
    expect(configDir({}, "win32", HOME_WIN)).toBe(path.join("C:\\Users\\Gaz", "AppData", "Roaming", "ultimatetv"));
    expect(stateDir({}, "win32", HOME_WIN)).toBe(path.join("C:\\Users\\Gaz", "AppData", "Local", "ultimatetv"));
  });

  it("treats any other platform as Linux, because the box only exists there", () => {
    expect(desktopPlatform("win32")).toBe("win32");
    expect(desktopPlatform("darwin")).toBe("darwin");
    expect(desktopPlatform("linux")).toBe("linux");
    expect(desktopPlatform("freebsd")).toBe("linux");
    expect(desktopPlatform()).toBe(desktopPlatform(process.platform));
  });

  it("keeps the heartbeat where the box's health check looks for it", () => {
    // On Linux it must not move: tools/box/healthcheck.sh reads this exact path after an update.
    expect(heartbeatFile({ XDG_STATE_HOME: "/home/tv/.state" }, "linux", "/home/tv")).toBe(path.join("/home/tv/.state", "ultimatetv-health"));
    expect(heartbeatFile({}, "linux", "/home/tv")).toBe(path.join("/home/tv", ".local", "state", "ultimatetv-health"));
    // A desktop copy keeps it with its own state instead of inventing ~/.local there.
    expect(heartbeatFile({}, "darwin", HOME_POSIX)).toBe(path.join("/home/gaz", "Library", "Application Support", "ultimatetv", "ultimatetv-health"));
    expect(heartbeatFile({ LOCALAPPDATA: "C:\\L" }, "win32", HOME_WIN)).toBe(path.join("C:\\L", "ultimatetv", "ultimatetv-health"));
  });
});

describe("where mpv is", () => {
  it("uses a named pipe on Windows and a socket file everywhere else", () => {
    expect(mpvSocket({}, "win32")).toBe("\\\\.\\pipe\\ultimatetv-mpv");
    expect(isPipePath(mpvSocket({}, "win32"))).toBe(true);
    expect(mpvSocket({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux")).toBe(path.join("/run/user/1000", "ultimatetv-mpv.sock"));
    expect(mpvSocket({}, "linux")).toBe(path.join(os.tmpdir(), "ultimatetv-mpv.sock"));
    expect(mpvSocket({ XDG_RUNTIME_DIR: "/run/user/501" }, "darwin")).toBe(path.join("/run/user/501", "ultimatetv-mpv.sock"));
    expect(isPipePath("/run/user/1000/ultimatetv-mpv.sock")).toBe(false);
  });

  it("names the binary per platform", () => {
    expect(mpvFileName("win32")).toBe("mpv.exe");
    expect(mpvFileName("linux")).toBe("mpv");
    expect(mpvFileName("darwin")).toBe("mpv");
  });

  it("prefers MPV_BIN, then the copy inside the app, then PATH", () => {
    const seen: string[] = [];
    const exists = (p: string) => {
      seen.push(p);
      return p === path.join("/opt/UltimateTV/resources", "mpv", "mpv.exe");
    };
    expect(mpvBinary({ MPV_BIN: "D:\\mpv\\mpv.exe" }, "win32", "/opt/UltimateTV/resources", exists)).toEqual({ command: "D:\\mpv\\mpv.exe", bundled: false });
    expect(seen).toEqual([]); // MPV_BIN wins without touching the disk at all.
    expect(mpvBinary({}, "win32", "/opt/UltimateTV/resources", exists)).toEqual({ command: path.join("/opt/UltimateTV/resources", "mpv", "mpv.exe"), bundled: true });
    expect(seen).toContain(path.join("/opt/UltimateTV/resources", "mpv", "mpv.exe"));
    // Nothing bundled: fall back to PATH, which is the Linux arrangement and the escape hatch elsewhere.
    expect(mpvBinary({}, "darwin", "/Applications/UltimateTV.app/Contents/Resources", () => false)).toEqual({ command: "mpv", bundled: false });
    expect(mpvBinary({}, "linux", "/tmp/resources", () => false)).toEqual({ command: "mpv", bundled: false });
  });

  it("looks for the binary in the resources folder electron-builder fills", () => {
    let asked = "";
    mpvBinary({}, "darwin", "/Applications/UltimateTV.app/Contents/Resources", (p) => {
      asked = p;
      return false;
    });
    // extraResources in tools/desktop/electron-builder.yml puts it at <resources>/mpv/mpv.
    expect(asked).toBe(path.join("/Applications/UltimateTV.app/Contents/Resources", "mpv", "mpv"));
  });
});

describe("which installer a platform updates with", () => {
  it("names the file and the kind of file", () => {
    expect(installerAssetName("win32", "x64")).toBe("UltimateTV-Setup-x64.exe");
    expect(installerAssetName("darwin", "arm64")).toBe("UltimateTV-arm64.dmg");
    expect(installerAssetName("linux", "x64")).toBe("UltimateTV-x86_64.AppImage");
    expect(installerKind("win32")).toBe("exe");
    expect(installerKind("darwin")).toBe("dmg");
    expect(installerKind("linux")).toBe("appimage");
    expect(installerKind("freebsd")).toBe("appimage");
  });
});
