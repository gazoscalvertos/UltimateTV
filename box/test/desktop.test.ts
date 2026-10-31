import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppImageUpdates, appImageName, looksLikeAppImage, parseBuild } from "../src/appimage-updates.js";
import { parseEnvFile, runMode } from "../src/mode.js";
import { DESKTOP_INPUT_CONF, mpvArgs } from "../src/mpv.js";

describe("desktop mode", () => {
  it("is the AppImage's default, and either way can be asked for", () => {
    expect(runMode([], {})).toBe("tv");
    expect(runMode([], { APPIMAGE: "/home/g/UltimateTV.AppImage" })).toBe("desktop");
    expect(runMode(["--tv"], { APPIMAGE: "/x" })).toBe("tv");
    expect(runMode(["--desktop"], {})).toBe("desktop");
    expect(runMode([], { UTV_MODE: "tv", APPIMAGE: "/x" })).toBe("tv");
  });

  it("reads box.env lines", () => {
    expect(parseEnvFile('# comment\nHUB_URL=http://192.168.0.19:8095\n\nexport MPV_ARGS="--vo=gpu --hwdec=no"\nnot a line\n')).toEqual({
      HUB_URL: "http://192.168.0.19:8095",
      MPV_ARGS: "--vo=gpu --hwdec=no",
    });
  });

  it("gives mpv an ordinary window with its own controls, and keeps the box's settings for the TV", () => {
    const desktop = mpvArgs({ socket: "/run/s", desktop: true, inputConf: "/run/input.conf" });
    expect(desktop).toContain("--force-window=no");
    expect(desktop).toContain("--osc=yes");
    expect(desktop).toContain("--input-conf=/run/input.conf");
    expect(desktop).not.toContain("--audio-spdif=ac3,eac3,dts");
    expect(desktop.some((a) => a.startsWith("--background-color"))).toBe(false);
    expect(DESKTOP_INPUT_CONF).toContain("CLOSE_WIN stop");
    const tv = mpvArgs({ socket: "/run/s" });
    expect(tv).toContain("--force-window=yes");
    expect(tv).toContain("--osc=no");
    expect(tv).toContain("--hwdec=vaapi,auto-safe");
  });
});

describe("AppImage updates", () => {
  it("names the AppImage for the machine and checks what it downloads", () => {
    expect(appImageName("x64")).toBe("UltimateTV-x86_64.AppImage");
    expect(appImageName("arm64")).toBe("UltimateTV-arm64.AppImage");
    expect(parseBuild('{"commit":"2485b93040e39d3b6d1ca5d4b39d4cf2c18de28b","branch":"main"}')).toEqual({ commit: "2485b93040e39d3b6d1ca5d4b39d4cf2c18de28b", branch: "main" });
    expect(parseBuild("<html>Not Found</html>")).toBeNull();
    expect(looksLikeAppImage(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 120 * 1024 * 1024)).toBe(true);
    expect(looksLikeAppImage(Buffer.from("<htm"), 120 * 1024 * 1024)).toBe(false);
    expect(looksLikeAppImage(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 1000)).toBe(false);
  });

  it("swaps in the new AppImage, keeps the old one, and can go back to it", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "utv-appimage-"));
    const appImage = path.join(dir, "UltimateTV.AppImage");
    writeFileSync(appImage, "old build");
    const buildInfo = path.join(dir, "build-info.json");
    writeFileSync(buildInfo, JSON.stringify({ commit: "aaaaaaa", branch: "main" }));
    const newBuild = Buffer.alloc(21 * 1024 * 1024);
    newBuild.set([0x7f, 0x45, 0x4c, 0x46]);
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(".json") ? new Response(JSON.stringify({ commit: "bbbbbbb", branch: "main" })) : new Response(newBuild),
    ) as unknown as typeof fetch;
    const relaunch = vi.fn();
    const updates = new AppImageUpdates({ appImage, buildInfo, stateDir: dir, relaunch, log: () => undefined, fetchImpl, baseUrl: "https://example.test/rel" });

    const before = await updates.status(true);
    expect(before).toMatchObject({ commit: "aaaaaaa", latest: "bbbbbbb", updating: false });
    expect(before.canRollBack).toBeUndefined();

    await updates.start();
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(readFileSync(`${appImage}.old`, "utf8")).toBe("old build");
    expect(readFileSync(appImage).subarray(0, 4)).toEqual(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    expect(existsSync(`${appImage}.download`)).toBe(false);
    const after = await updates.status(false);
    expect(after.lastUpdate?.ok).toBe(true);
    expect(after.canRollBack).toBe(true);
    expect(after.rollbackTo).toBe("aaaaaaa");

    await updates.rollBack();
    expect(relaunch).toHaveBeenCalledTimes(2);
    expect(readFileSync(appImage, "utf8")).toBe("old build");
    expect(existsSync(`${appImage}.old`)).toBe(false);
    expect((await updates.status(false)).rollback).toMatchObject({ manual: true, ok: true, how: "app" });
  });

  it("leaves the running AppImage alone when the download isn't one", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "utv-appimage-"));
    const appImage = path.join(dir, "UltimateTV.AppImage");
    writeFileSync(appImage, "current");
    const fetchImpl = vi.fn(async () => new Response("<html>rate limited</html>")) as unknown as typeof fetch;
    const relaunch = vi.fn();
    const updates = new AppImageUpdates({ appImage, buildInfo: path.join(dir, "none.json"), stateDir: dir, relaunch, log: () => undefined, fetchImpl });
    await expect(updates.start()).rejects.toThrow(/isn't an AppImage/);
    expect(relaunch).not.toHaveBeenCalled();
    expect(readFileSync(appImage, "utf8")).toBe("current");
    expect(existsSync(`${appImage}.download`)).toBe(false);
    expect((await updates.status(false)).lastUpdate).toMatchObject({ ok: false });
  });
});
