// Checks on the PlayStation 5 app's home screen tile (#182).
//
// The app itself is C++ and is tested by `make -C ps5 test`. What can't be checked from C++
// is the folder the console installs: the metadata the console reads, the picture it draws on
// the tile, and the linker script that gives the app its console process parameter. Those are
// files, so they are checked here where the repository's own tests can see them.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const bytes = (p: string) => readFileSync(path.join(ROOT, p));

/** The PNG's width, height and colour type, read straight out of the IHDR. */
function pngSize(data: Buffer): { width: number; height: number; depth: number; colour: number } {
  expect(data.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(data.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    depth: data[24],
    colour: data[25],
  };
}

describe("the PlayStation 5 home screen tile", () => {
  const param = JSON.parse(read("ps5/sce_sys/param.json"));
  const system = JSON.parse(read("ps5/sce_sys/param.json.system"));

  it("names the app and keeps one title id across both metadata files", () => {
    expect(param.titleId).toMatch(/^[A-Z]{4}\d{5}$/);
    expect(system.titleId).toBe(param.titleId);
    expect(param.applicationCategoryType).toBe(0);
    // The `.system` variant is what the console uses once the tile is registered properly.
    expect(system.applicationCategoryType).toBe(33554432);
  });

  it("calls the tile UltimateTV in the language the household set", () => {
    expect(param.localizedParameters.defaultLanguage).toBe("en-GB");
    expect(param.localizedParameters["en-GB"].titleName).toBe("UltimateTV");
  });

  it("carries the keys the console documents as required", () => {
    // Shape from psdevwiki's param.json page (the PS4's param.sfo replacement), cross-checked
    // against a shipping homebrew title's own file: without contentVersion and a DRM type the
    // console's installer is entitled to refuse the folder.
    for (const file of [param, system]) {
      expect(file.contentVersion).toMatch(/^\d{2}\.\d{3}\.\d{3}$/);
      expect(file.applicationDrmType).toBe("free");
      // A .pkg is checked for this by the packaging tool: without it the package still builds
      // but a checker calls the package incoherent, and the console is the last word on that.
      // Shape: <publisher 6>-<title id>_00-<16 chars>, e.g. UP9000-PPSA26001_00-ULTIMATETV000000.
      expect(file.contentId).toMatch(/^[A-Z0-9]{6}-[A-Z]{4}\d{5}_00-[A-Z0-9]{16}$/);
      expect(file.contentId).toContain(file.titleId);
    }
  });

  it("carries the full metadata block a shipping title wears, not a minimal one", () => {
    // The console's install record, patch cache and update checker read these. A title with no
    // masterVersion logs an empty contentVer and app_version, and PlayGo complains that the
    // content id is too small — so the fields a known-good homebrew title carries are here too.
    for (const file of [param, system]) {
      expect(file.masterVersion).toMatch(/^\d{2}\.\d{2}$/);
      expect(file.sdkVersion).toMatch(/^0x[0-9a-fA-F]{16}$/);
      expect(file.requiredSystemSoftwareVersion).toMatch(/^0x[0-9a-fA-F]{16}$/);
      expect(file.conceptId).toBe("26001");
      expect(file.contentBadgeType).toBe(1);
      expect(file.downloadDataSize).toBe(256);
      expect(file.versionFileUri).toBe("");
      expect(file.ageLevel).toEqual({ default: 0 });
      expect(file.gameIntent.permittedIntents).toEqual([{ intentType: "launchActivity" }]);
      expect(file.pubtools.creationDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(file.pubtools.toolVersion).toBe("2.00");
      // The ids the console cross-checks against contentId.
      expect(file.conceptId).toBe(file.titleId.slice(-5));
      expect(file.contentId).toContain(`-${file.titleId}_00-`);
    }
    // A PS5 title must NOT carry PS4 metadata where the launch service can see it.
    expect(param).not.toHaveProperty("paramSfo");
  });

  it("can be wrapped in a .pkg, which needs a layout the folder route does not use", () => {
    const makefile = read("ps5/Makefile");
    // The package tool wants eboot.bin at the top of the title folder and the metadata under
    // sce_sys/; 'make package' makes the flat shape the FTP copy needs. Both exist on purpose.
    expect(makefile).toContain(".PHONY: pkg");
    expect(makefile).toContain("build/pkg-src/$(TITLE_ID)/sce_sys");
    expect(makefile).toContain("--content-id $(PKG_CONTENT_ID)");
    expect(makefile).toContain("$(PS5_PKG_TOOL) validate");
    // The tool is 80 MB of .NET, so it is never assumed: the target says what to do instead.
    expect(makefile).toContain("PS5_PKG_TOOL ?=");
    expect(makefile).toContain("point PS5_PKG_TOOL at an ffpfsc-pkg-tool binary");
  });

  it("ships the 512×512 picture the console draws on the tile", () => {
    const size = pngSize(bytes("ps5/sce_sys/icon0.png"));
    expect(size).toEqual({ width: 512, height: 512, depth: 8, colour: 2 });
  });

  it("has a picture that is really drawn, not a blank square", () => {
    const data = bytes("ps5/sce_sys/icon0.png");
    // Walk the chunks to the pixels, checking every CRC on the way: a truncated or corrupted
    // PNG would still have a valid header but no usable picture.
    let at = 8;
    const idat: Buffer[] = [];
    while (at < data.length) {
      const length = data.readUInt32BE(at);
      const type = data.subarray(at + 4, at + 8).toString("ascii");
      const body = data.subarray(at + 8, at + 8 + length);
      const crc = data.readUInt32BE(at + 8 + length);
      expect(zlib.crc32(Buffer.concat([Buffer.from(type, "ascii"), body])) >>> 0, type).toBe(crc);
      if (type === "IDAT") idat.push(body);
      at += 12 + length;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const size = 512;
    expect(raw.length).toBe(size * (size * 3 + 1));
    // The middle of the tile has the play triangle on it, which is lighter than the corners.
    const pixel = (x: number, y: number) => {
      const o = y * (size * 3 + 1) + 1 + x * 3;
      return raw[o] + raw[o + 1] + raw[o + 2];
    };
    expect(pixel(256, 256)).toBeGreaterThan(pixel(8, 8) + 120);
    // More than a couple of dozen shades, so it can't be a flat block of colour.
    const shades = new Set<number>();
    for (let y = 0; y < size; y += 16) for (let x = 0; x < size; x += 16) shades.add(pixel(x, y));
    expect(shades.size).toBeGreaterThan(24);
  });

  it("can be rebuilt from source, so the picture isn't a mystery file", () => {
    expect(existsSync(path.join(ROOT, "tools/ps5/make-icon.mjs"))).toBe(true);
    const maker = read("tools/ps5/make-icon.mjs");
    // It has to write exactly the file that is committed, or `--check` is pointless.
    expect(maker).toContain('export const ICON = { file: "icon0.png", size: 512 }');
    expect(maker).toContain("--check");
  });
});

describe("the PlayStation 5 app's sources", () => {
  it("builds the console app and the installable tile from one Makefile", () => {
    const makefile = read("ps5/Makefile");
    for (const target of [".PHONY: test", ".PHONY: console", ".PHONY: tile", ".PHONY: install"]) {
      expect(makefile, target).toContain(target);
    }
    // The tests must be runnable with no console and no SDK.
    expect(makefile).toContain("HOST_CXX ?=");
    expect(makefile).toContain("$(HOST_CXX) $(HOST_CXXFLAGS)");
    // The tile is ET_EXEC and carries the console's process parameter header.
    expect(makefile).toContain("-Wl,--no-pie -T src/eboot.x");
    expect(makefile).toContain("--ptype fake");
  });

  it("installs the way the console actually accepts a title", () => {
    // Copying files is not installing. The SDK's own install_app sample puts the app under
    // /system_ex/app and the metadata under /user/app, then runs a payload that calls the
    // console's installer -- without that last step the files never become a home-screen tile.
    const makefile = read("ps5/Makefile");
    expect(makefile).toContain("/system_ex/app/$(TITLE_ID)");
    expect(makefile).toContain("/user/app/$(TITLE_ID)/sce_sys");
    expect(makefile).toContain("build/installer.elf");
    expect(makefile).toContain("param.json.system");
    const installer = read("ps5/installer/install.c");
    expect(installer).toContain("sceAppInstUtilInitialize");
    expect(installer).toContain("sceAppInstUtilAppInstallTitleDir");
    expect(installer).toContain("TITLE_ID");
  });

  it("mentions the folder-mounter route, which is what most consoles use", () => {
    // Most 2026 homebrew titles are installed by dropping a folder in /data/homebrew and
    // letting ShadowMountPlus register it, so the docs have to say that as well.
    const doc = read("docs/ps5.md");
    expect(doc).toContain("/data/homebrew");
    expect(doc).toContain("ShadowMountPlus");
  });

  it("keeps the process parameter header the console needs, and the unwind symbols C++ needs", () => {
    const script = read("ps5/src/eboot.x");
    // 0x61000001 is the console's own segment type for the process parameter.
    expect(script).toContain("0x61000001");
    expect(script).toContain(".sce_process_param");
    // libunwind asks for these two, so a C++ app can't link without them.
    expect(script).toContain("__eh_frame_start");
    expect(script).toContain("__eh_frame_end");
  });

  it("keeps the drawing out of the part that can be tested on a build machine", () => {
    // The screens, the keys and the Hub calls are plain C++ with no SDL, which is why
    // `make -C ps5 test` runs anywhere. Only the platform file may include SDL.
    const portable = ["json", "model", "http", "hub", "text", "ui", "display", "address"];
    for (const name of portable) {
      const source = read(`ps5/src/${name}.cpp`);
      expect(source, `ps5/src/${name}.cpp`).not.toMatch(/#include\s*<SDL/);
      expect(source, `ps5/src/${name}.cpp`).not.toMatch(/ImGui::/);
    }
    const platform = read("ps5/src/platform_sdl.cpp");
    expect(platform).toContain("SDL_Init");
    expect(platform).toContain("ImGui");
  });

  it("keeps the film player's library out of the testable core", () => {
    // `video.cpp` needs the console's decoder, so it is only built into the console app.
    const video = read("ps5/src/video.cpp");
    expect(video).toContain("Kit_");
    // The core asks the platform for a player through this seam and nothing else.
    expect(read("ps5/src/platform.hpp")).toContain("makeVideo");
  });

  it("asks the console for the biggest picture it offers, not 1080p", () => {
    // The console's SDL driver offers 1920x1080 and 3840x2160. Asking for 1080p meant a 4K film
    // was decoded, shrunk, and stretched back up. This is the guard for the fix: the size comes
    // from the console, and it can be turned back down with --1080p.
    const display = read("ps5/src/display.cpp");
    const platform = read("ps5/src/platform_sdl.cpp");
    const main = read("ps5/src/main.cpp");

    // The surface is what the console gave, never a hard-coded 1080p canvas.
    expect(display).toContain("MAX_WIDTH = 3840");
    expect(display).toContain("MAX_HEIGHT = 2160");
    expect(platform).toContain("SDL_GetNumDisplayModes");
    expect(platform).toContain("SDL_GetRendererOutputSize");
    expect(platform).toContain("SDL_RenderSetLogicalSize(renderer_, width_, height_)");
    // It used to be this, whatever the television was.
    expect(platform).not.toContain("SDL_RenderSetLogicalSize(renderer_, 1920, 1080)");
    // The text has to be the same size on the wall at 1080p and at 4K.
    expect(platform).toContain("uiScaleFor(height_)");
    // The decoder is asked for the surface size, so a 4K film isn't shrunk on the way.
    expect(platform).toContain("setDisplaySize");
    expect(read("ps5/src/video.cpp")).toContain("displayWidth_");
    expect(read("ps5/src/video.cpp")).not.toContain("&audioRequest, MAX_VIDEO_WIDTH, MAX_VIDEO_HEIGHT");
    // There is a way to ask for 1080p on a console that can't keep up with 4K.
    expect(main).toContain('"--1080p"');
  });

  it("can be pointed at the Hub from the controller, because a console has no keyboard", () => {
    // The app used to start hard-coded to http://127.0.0.1:8095 — the console itself — and the
    // only way to change it was the command line. A tile has no command line, so the address
    // has to be editable on screen, a number at a time.
    const address = read("ps5/src/address.cpp");
    const addressHeader = read("ps5/src/address.hpp");
    const ui = read("ps5/src/ui.cpp");
    const hub = read("ps5/src/hub.hpp");

    // The fields exist as separate numbers, and the address is rebuilt from them.
    expect(addressHeader).toContain("struct AddressFields");
    expect(address).toContain("formatAddress");
    expect(address).toContain("stepAddressField");
    // The connect screen moves between them and changes the one under the cursor.
    expect(ui).toContain("stepAddressField(view_.addressFields, view_.addressField");
    expect(ui).toContain("hub_.setBaseUrl(view_.address)");
    // And the address it tries is the one on screen, not the one it started with.
    expect(ui).toContain("view_.address = formatAddress(view_.addressFields)");
    // The house Hub, so a fresh tile finds it without being told.
    expect(hub).toContain("http://192.168.0.19:8095");
    expect(hub).not.toContain("http://127.0.0.1:8095");
  });

  it("leaves a note on the console's disk about how far it got", () => {
    // A console that fails to start shows a black screen and nothing else. This file is the
    // only way to tell "the console wouldn't run it" from "it ran and couldn't find the Hub".
    const main = read("ps5/src/main.cpp");
    expect(main).toContain("/data/ultimatetv/last-run.log");
    expect(main).toContain("LOG_PATH");
    // It writes through the one log module the whole app shares, so every failure says why.
    expect(main).toContain("logTo(LOG_PATH)");
    expect(main).toContain("logLine(");
    expect(main).not.toContain("std::FILE* gLog");
    // The first thing it writes is which Hub it is going to look for.
    expect(main).toMatch(/logLine\("looking for the Hub at/);
  });

  it("starts the picture, the pad and the sound one at a time, and needs only the picture", () => {
    // This is the bug that stopped the app running at all: the three were asked for in one call,
    // the console's audio driver refused on a current firmware, and the whole call answered
    // "no" — so the app never drew a frame. A missing pad or a silent console must not be fatal
    // now, and the decision lives in a file the host tests can reach.
    const sdl = read("ps5/src/platform_sdl.cpp");
    expect(sdl).toContain("SDL_InitSubSystem(flags)");
    expect(sdl).toContain("startSubsystem(SDL_INIT_VIDEO");
    expect(sdl).toContain("startSubsystem(SDL_INIT_GAMECONTROLLER");
    expect(sdl).toContain("startSubsystem(SDL_INIT_AUDIO");
    // The old all-in-one call is exactly what took the window down with the sound.
    expect(sdl).not.toMatch(
      /SDL_Init\(SDL_INIT_VIDEO \| SDL_INIT_GAMECONTROLLER \| SDL_INIT_AUDIO\)/,
    );
    expect(sdl).toContain("decideStartup(");
    // And the player doesn't try to open a device on a console with no sound subsystem.
    expect(read("ps5/src/video.cpp")).toContain("SDL_WasInit(SDL_INIT_AUDIO)");
    // The decision itself is tested where a build machine can run it.
    expect(read("ps5/test/startup_test.cpp")).toContain("stillRunsWithNoSound");
  });

  it("builds the folder a mounter needs, not only a package that won't launch", () => {
    // A fake .pkg installs on firmware 12.00+ and then will not launch, because the console
    // refuses to mount its filesystem. A folder has nothing to mount, so `make homebrew` is the
    // route that works there and it must keep producing the layout monters scan for.
    const makefile = read("ps5/Makefile");
    expect(makefile).toContain("HOMEBREW_DIR");
    expect(makefile).toContain("homebrew");
    expect(makefile).toContain("/data/homebrew/");
    // The layout is one folder named after the title, holding eboot.bin and sce_sys/.
    expect(makefile).toContain("$(HOMEBREW_DIR)/sce_sys");
    expect(makefile).toContain("cp build/$(TITLE_ID)/eboot.bin $(HOMEBREW_DIR)/");
    expect(makefile).toContain("cp sce_sys/param.json sce_sys/icon0.png $(HOMEBREW_DIR)/sce_sys/");
    // The folder gets the title's param.json, not the .system one.
    expect(makefile).not.toContain("param.json.system $(HOMEBREW_DIR)");
  });

  it("can also build the UFS2 image the reference project actually ships", () => {
    // BlackBox — the project that works on a current console — ships a `.ffpkg`, a UFS2 image
    // ShadowMountPlus mounts. That is the image route, not a package route, which is why the
    // kstuff gate on fake packages never applies to it. `make ffpkg` wraps the same folder.
    const makefile = read("ps5/Makefile");
    expect(makefile).toContain(".PHONY: ffpkg");
    expect(makefile).toContain("UFS2_TOOL");
    // It must never invent a builder; the image has to come from a tool the user points at.
    expect(makefile).toContain("make ffpkg needs a UFS2 image builder");
    // And it must say the layout constraint, or the image mounts and shows nothing.
    expect(makefile).toContain("at its ROOT");
    // The image is built from the same folder the mounter route produces.
    expect(makefile).toContain("$(UFS2_TOOL) $(HOMEBREW_DIR) $(FFPKG)");
  });

  it("never writes the device token or a PIN to the log", () => {
    for (const name of ["json", "model", "http", "hub", "text", "address", "ui", "platform_sdl", "video", "main"]) {
      const source = read(`ps5/src/${name}.cpp`);
      // There is no logging of secrets anywhere: the only printed things are errors.
      expect(source, name).not.toMatch(/printf\([^)]*token/i);
      expect(source, name).not.toMatch(/printf\([^)]*pin/i);
    }
  });
});
