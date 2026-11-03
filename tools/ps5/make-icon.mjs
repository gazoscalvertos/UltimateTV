#!/usr/bin/env node
// The PlayStation 5 home screen's picture for UltimateTV (#182).
//
// A PS5 app installed on the home screen is a folder with `sce_sys/icon0.png` in it, and the
// console draws that PNG on the tile. There is no image library in this repo, so this writes the
// PNG itself, reusing the PNG writer the phone remote's icons already use
// (`tools/remote/make-icons.mjs`): a truecolour PNG is a signature, an IHDR, a deflated IDAT and
// an IEND, and the drawing is a rounded tile in the app's own blue.
//
//   node tools/ps5/make-icon.mjs            # writes ps5/sce_sys/icon0.png
//   node tools/ps5/make-icon.mjs --check    # exit 1 if the file on disk isn't what we'd draw
//
// `ps5/test/icon.test.mjs`-style checks live in `tools/ps5/` instead: the PS5 host tests are C++
// and can't read a PNG, so this file proves the picture itself, and `ps5/test/tile_test.cpp` just
// checks the folder it goes in.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { png } from "../remote/make-icons.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const ICON_DIR = path.join(ROOT, "ps5/sce_sys");

/** What the console wants on a home screen tile. */
export const ICON = { file: "icon0.png", size: 512 };

/** The app's colours, the same as the banner and the phone remote's icons. */
const BG_TOP = [0x07, 0x0b, 0x14];
const BG_BOTTOM = [0x0b, 0x13, 0x25];
const ACCENT = [0x3d, 0x8b, 0xff];
const ACCENT_2 = [0x00, 0xc2, 0xd1];
const WHITE = [0xff, 0xff, 0xff];

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Inside a rounded rectangle, given in the 0..1 square. */
const inRoundRect = (x, y, { x: rx, y: ry, w, h, r }) => {
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** A widescreen TV with a play triangle in it: the same picture as the banner and the icons. */
const SCREEN = { x: 0.145, y: 0.3, w: 0.71, h: 0.4, r: 0.055 };
const STAND = { x: 0.44, y: 0.71, w: 0.12, h: 0.045, r: 0.02 };
const FOOT = { x: 0.33, y: 0.755, w: 0.34, h: 0.04, r: 0.02 };
/** The triangle, as three points in the 0..1 square. */
const TRIANGLE = [
  [0.44, 0.4],
  [0.44, 0.6],
  [0.6, 0.5],
];

/** The colour at a point of the 0..1 square. */
export function colourAt(x, y) {
  // The background: the banner's vertical gradient, a touch brighter at the top centre.
  let colour = mix(BG_TOP, BG_BOTTOM, y);
  const glow = Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.42) / 0.7);
  colour = mix(colour, ACCENT, 0.16 * glow * glow);

  // The TV's body and its outline in the app's blue.
  if (inRoundRect(x, y, SCREEN)) {
    const edge =
      Math.min(
        x - SCREEN.x,
        SCREEN.x + SCREEN.w - x,
        y - SCREEN.y,
        SCREEN.y + SCREEN.h - y,
      );
    if (edge < 0.012) return mix(colour, ACCENT, 0.9);
    colour = mix(colour, [0x02, 0x06, 0x10], 0.85);
  }
  if (inRoundRect(x, y, STAND) || inRoundRect(x, y, FOOT)) colour = mix(colour, ACCENT, 0.55);

  // The play triangle, anti-aliased by testing the three edge half-planes.
  const [a, b, c] = TRIANGLE;
  const side = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const s1 = side(a, b);
  const s2 = side(b, c);
  const s3 = side(c, a);
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  if (inside) {
    // Warm the triangle from blue to teal so the tile reads as a screen, not a button.
    const t = (x - 0.44) / 0.16;
    return mix(WHITE, mix(ACCENT, ACCENT_2, Math.min(1, Math.max(0, t))), 0.35);
  }
  return colour;
}

/** The drawing, sampled with 4×4 supersampling so the curves are smooth at 512px. */
export function render(size) {
  const px = Buffer.alloc(size * size * 3);
  const samples = 4;
  const n = samples * samples;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const colour = colourAt((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
          r += colour[0];
          g += colour[1];
          b += colour[2];
        }
      }
      const i = (y * size + x) * 3;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
    }
  }
  return px;
}

export const draw = () => png(ICON.size, render(ICON.size));

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const check = process.argv.includes("--check");
  const target = path.join(ICON_DIR, ICON.file);
  const want = draw();
  const have = existsSync(target) ? readFileSync(target) : null;
  if (check) {
    if (!have || !have.equals(want)) {
      console.error(`✗ ${path.relative(ROOT, target)} is out of date: run node tools/ps5/make-icon.mjs`);
      process.exit(1);
    }
    console.log(`✓ ${path.relative(ROOT, target)} (${ICON.size}×${ICON.size}, ${want.length} bytes)`);
  } else {
    mkdirSync(ICON_DIR, { recursive: true });
    writeFileSync(target, want);
    console.log(`wrote ${path.relative(ROOT, target)} (${ICON.size}×${ICON.size}, ${want.length} bytes)`);
  }
}
