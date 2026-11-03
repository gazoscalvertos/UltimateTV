import { describe, expect, it } from "vitest";
import { desktopAsset, desktopDownload, desktopDownloads, desktopKind, DESKTOP_BUILD_FILE, DESKTOP_RELEASE, downloadAsset, looksLikeDesktopDownload, otherAsset } from "../src/desktop.js";

/** A file with the given first and last bytes, as the Hub and the app see it after a download. */
function ends(kind: "windows" | "macos" | "linux", size: number): { head: Buffer; tail: Buffer } {
  if (kind === "windows") return { head: Buffer.from("MZ\x90\x00"), tail: Buffer.from("\x00\x00") };
  if (kind === "macos") return { head: Buffer.from("koly"), tail: Buffer.from("koly") };
  return { head: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), tail: Buffer.from([0, 0, 0, 0]) };
}

describe("desktop downloads", () => {
  it("names each platform's file exactly as electron-builder writes it", () => {
    // These names are the contract with tools/desktop/electron-builder.yml and docs/ci-desktop-jobs.md:
    // a mismatch means a download link that goes nowhere.
    expect(desktopAsset("windows", "x64")).toBe("UltimateTV-Setup-x64.exe");
    expect(desktopAsset("windows", "arm64")).toBe("UltimateTV-Setup-arm64.exe");
    expect(desktopAsset("macos", "x64")).toBe("UltimateTV-x64.dmg");
    expect(desktopAsset("macos", "arm64")).toBe("UltimateTV-arm64.dmg");
    // Linux keeps electron-builder's x86_64 spelling, which the AppImage updater already uses.
    expect(desktopAsset("linux", "x64")).toBe("UltimateTV-x86_64.AppImage");
    expect(desktopAsset("linux", "arm64")).toBe("UltimateTV-arm64.AppImage");
  });

  it("falls back to x64 rather than inventing a name it can't build", () => {
    expect(desktopAsset("windows", "ia32")).toBe("UltimateTV-Setup-x64.exe");
    expect(desktopAsset("macos", "riscv64")).toBe("UltimateTV-x64.dmg");
    // The Hub's route without ?arch= uses the platform's usual build, which it looks up itself.
    expect(desktopAsset("linux", process.arch === "arm64" ? "arm64" : "x64")).toBe(process.arch === "arm64" ? "UltimateTV-arm64.AppImage" : "UltimateTV-x86_64.AppImage");
  });

  it("knows which platform runs which build", () => {
    expect(desktopKind("win32")).toBe("windows");
    expect(desktopKind("darwin")).toBe("macos");
    expect(desktopKind("linux")).toBe("linux");
    // Anything else is treated as Linux: the box is Linux and so is everything we can't name.
    expect(desktopKind("freebsd")).toBe("linux");
    // No default argument: this module is compiled for the browser too, so the caller passes Node's
    // value (box/src/platform.ts, box/src/desktop-app-updates.ts). Whatever this machine is, it has
    // to land on one of the three builds rather than fall through to undefined.
    expect(["windows", "macos", "linux"]).toContain(desktopKind(process.platform));
  });

  it("lists the three downloads with what a person does with each", () => {
    const all = desktopDownloads();
    expect(all.map((d) => d.kind)).toEqual(["windows", "macos", "linux"]);
    expect(all.map((d) => d.label)).toEqual(["Windows", "Mac", "Linux"]);
    for (const d of all) {
      expect(Object.keys(d.assets).sort()).toEqual(["arm64", "x64"]);
      expect(d.contentType).toMatch(/^application\//);
      expect(d.how.length).toBeGreaterThan(20);
    }
    // A Mac is usually an Apple Silicon one now; PCs and Linux machines are usually x64.
    expect(desktopDownload("macos").usual).toBe("arm64");
    expect(desktopDownload("windows").usual).toBe("x64");
    expect(desktopDownload("linux").usual).toBe("x64");
    expect(desktopDownload("windows").contentType).toBe("application/vnd.microsoft.portable-executable");
    expect(desktopDownload("macos").contentType).toBe("application/x-apple-diskimage");
  });

  it("picks the file to hand someone from ?arch=", () => {
    expect(downloadAsset("macos", "arm64")).toBe("UltimateTV-arm64.dmg");
    expect(downloadAsset("macos", "x64")).toBe("UltimateTV-x64.dmg");
    expect(downloadAsset("macos")).toBe("UltimateTV-arm64.dmg");
    expect(downloadAsset("macos", "nonsense")).toBe("UltimateTV-arm64.dmg");
    expect(downloadAsset("windows")).toBe("UltimateTV-Setup-x64.exe");
    expect(downloadAsset("windows", "arm64")).toBe("UltimateTV-Setup-arm64.exe");
  });

  it("offers the other architecture beside the usual one", () => {
    expect(otherAsset("macos")).toEqual({ arch: "x64", asset: "UltimateTV-x64.dmg" });
    expect(otherAsset("macos", "arm64")).toEqual({ arch: "x64", asset: "UltimateTV-x64.dmg" });
    expect(otherAsset("macos", "x64")).toEqual({ arch: "arm64", asset: "UltimateTV-arm64.dmg" });
    expect(otherAsset("windows", "arm64")).toEqual({ arch: "x64", asset: "UltimateTV-Setup-x64.exe" });
  });

  it("keeps the release and the build description named in one place", () => {
    expect(DESKTOP_RELEASE).toBe("desktop-app");
    expect(DESKTOP_BUILD_FILE).toBe("ultimatetv-desktop.json");
  });
});

describe("checking a desktop download", () => {
  it("accepts the real thing", () => {
    expect(looksLikeDesktopDownload("windows", ends("windows", 90 * 1024 * 1024).head, ends("windows", 1).tail, 90 * 1024 * 1024)).toBe(true);
    expect(looksLikeDesktopDownload("macos", ends("macos", 120 * 1024 * 1024).head, ends("macos", 120 * 1024 * 1024).tail, 120 * 1024 * 1024)).toBe(true);
    expect(looksLikeDesktopDownload("linux", ends("linux", 100 * 1024 * 1024).head, ends("linux", 1).tail, 100 * 1024 * 1024)).toBe(true);
  });

  it("refuses an HTML error page served in its place", () => {
    const page = Buffer.from("<!DOCTYPE html><h1>404</h1>");
    expect(looksLikeDesktopDownload("windows", page, page, 24)).toBe(false);
    expect(looksLikeDesktopDownload("macos", page, page, 24)).toBe(false);
    expect(looksLikeDesktopDownload("linux", page, page, 24)).toBe(false);
  });

  it("refuses a stub, however right its first bytes look", () => {
    expect(looksLikeDesktopDownload("windows", Buffer.from("MZ"), Buffer.alloc(0), 500)).toBe(false);
    expect(looksLikeDesktopDownload("macos", Buffer.from("koly"), Buffer.from("koly"), 4096)).toBe(false);
    expect(looksLikeDesktopDownload("linux", Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(0), 1024)).toBe(false);
  });
});
