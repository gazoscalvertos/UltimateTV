#!/usr/bin/env node
// The phone remote's icons, drawn here so they can change without a design tool (#129).
//
// iOS wants a 180×180 apple-touch-icon, and the manifest wants 192 and 512 (a browser that installs
// the remote on Android reads those). There is no image library in this repo and none on the Hub,
// so this writes the PNGs itself: a PNG is a signature, an IHDR, one or more IDATs and an IEND, and
// zlib (Node's own) does the compressing. The drawing is the banner's gradient and the remote's
// play/back glyph on a rounded tile — the same picture at every size, scaled from the 512 grid.
//
//   node tools/remote/make-icons.mjs            # write hub/public/remote/icon-*.png
//   node tools/remote/make-icons.mjs --check    # exit 1 if a file on disk isn't what we'd draw
//
// hub/test/pwa.test.ts checks the committed files are real PNGs of the right size; --check is for
// whoever edits the drawing.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const ICON_DIR = path.join(ROOT, "hub/public/remote");

/** What a browser and iOS ask for: the sizes in the manifest, plus the apple-touch-icon. */
export const ICONS = [
  { file: "icon-180.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
];

/** The remote's colours, from hub/public/remote/index.html's :root. */
const BG = [0x07, 0x0b, 0x14];
const ACCENT = [0x3d, 0x8b, 0xff];
const ACCENT_2 = [0x00, 0xc2, 0xd1];
const WHITE = [0xff, 0xff, 0xff];

// ---------------------------------------------------------------------------
// A tiny rasteriser: rectangles, circles and rounded rectangles in a unit square, sampled per
// pixel with 3×3 supersampling so the curves and the corners are smooth at 180px as at 512px.

/** The drawing, in a 0..1 square: a phone-shaped tile in the banner's gradient, with a screen and
 * three buttons — the phone remote itself (the same picture as icon.svg, redrawn for iOS's tile). */
const TILE = { x: 0.266, y: 0.141, w: 0.469, h: 0.719, r: 0.125 };
const SCREEN = { cx: 0.5, cy: 0.391, r: 0.137 };
const SCREEN_HOLE = { cx: 0.5, cy: 0.391, r: 0.055 };
const BUTTONS = [
  { cx: 0.402, cy: 0.645, r: 0.031 },
  { cx: 0.5, cy: 0.645, r: 0.031 },
  { cx: 0.598, cy: 0.645, r: 0.031 },
];
const BAR = { x: 0.402, y: 0.73, w: 0.195, h: 0.039, r: 0.02 };

const inRoundRect = (x, y, { x: rx, y: ry, w, h, r }) => {
  // Clamp to the nearest point of the inner rectangle and measure: inside the rounded corner when
  // that distance is within the radius.
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inCircle = (x, y, { cx, cy, r }) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The gradient along the tile, from its top-left corner to its bottom-right, as icon.svg has it
 * (an SVG linearGradient's default units are the shape's bounding box, not the whole picture). */
const gradientAt = (x, y) => {
  const t = ((x - TILE.x) / TILE.w + (y - TILE.y) / TILE.h) / 2;
  return mix(ACCENT, ACCENT_2, Math.min(Math.max(t, 0), 1));
};

/** The colour of the drawing at (x, y) in the unit square, as [r, g, b]. */
function colourAt(x, y) {
  if (!inRoundRect(x, y, TILE)) return BG;
  // On the tile: the screen's dark circle, its white iris, the three white buttons and the bar. The
  // circle and the bar are translucent in icon.svg, so they let the gradient through.
  const tile = gradientAt(x, y);
  if (inCircle(x, y, SCREEN)) {
    if (inCircle(x, y, SCREEN_HOLE)) return WHITE;
    return mix(tile, BG, 0.9);
  }
  if (BUTTONS.some((b) => inCircle(x, y, b))) return WHITE;
  if (inRoundRect(x, y, BAR)) return mix(tile, WHITE, 0.7);
  return tile;
}

/** Renders one icon to raw RGB rows, 3×3 samples per pixel. */
export function render(size) {
  const px = Buffer.alloc(size * size * 3);
  const samples = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          // Sample at pixel centres, nudged for the sub-samples.
          const c = colourAt((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * size + x) * 3;
      const n = samples * samples;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
    }
  }
  return px;
}

// ---------------------------------------------------------------------------
// PNG writing. Each chunk is length, type, data, and the CRC32 of type+data; the pixel rows are
// filtered (a zero byte, meaning "none", in front of each row) and deflated.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A truecolour (8-bit RGB) PNG of `size`×`size` from `rgb`, which is `size * size * 3` bytes. */
export function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  // Filter byte 0 (none) in front of every row.
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 3 + 1)] = 0;
    rgb.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const draw = (size) => png(size, render(size));

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const { file, size } of ICONS) {
    const target = path.join(ICON_DIR, file);
    const want = draw(size);
    const have = existsSync(target) ? readFileSync(target) : null;
    if (check) {
      if (!have || !have.equals(want)) {
        console.error(`✗ ${path.relative(ROOT, target)} is out of date: run node tools/remote/make-icons.mjs`);
        bad++;
      } else {
        console.log(`✓ ${path.relative(ROOT, target)} (${size}×${size}, ${want.length} bytes)`);
      }
    } else {
      writeFileSync(target, want);
      console.log(`wrote ${path.relative(ROOT, target)} (${size}×${size}, ${want.length} bytes)`);
    }
  }
  if (bad) process.exit(1);
}
