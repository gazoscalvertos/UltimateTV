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
    const portable = ["json", "model", "http", "hub", "text", "ui"];
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

  it("never writes the device token or a PIN to the log", () => {
    for (const name of ["json", "model", "http", "hub", "text", "ui", "platform_sdl", "video", "main"]) {
      const source = read(`ps5/src/${name}.cpp`);
      // There is no logging of secrets anywhere: the only printed things are errors.
      expect(source, name).not.toMatch(/printf\([^)]*token/i);
      expect(source, name).not.toMatch(/printf\([^)]*pin/i);
    }
  });
});
