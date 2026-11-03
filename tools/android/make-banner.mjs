#!/usr/bin/env node
// The Fire TV launcher banner, drawn here so it can change without a design tool (#183).
//
// Fire TV's home screen wants a 320×180 (xhdpi) banner for a sideloaded leanback app, and it shows
// that picture instead of the icon — so the app's name has to be in the picture, not just in
// strings.xml. There is no image library in this repo and none may be added, so this draws the
// banner itself the same way tools/remote/make-icons.mjs draws the remote's icons: a tiny
// rasteriser in pixel space, sampled 4×4 per pixel, and a PNG writer built on node:zlib.
//
// There is no font renderer either, so "UltimateTV" is set in a hand-built 5×7 pixel font
// (GLYPHS below): cap height 7 units × 4 px = 28 px, stroke 4 px. The letters are proportional —
// l and i are one unit wide, t is three — which brings the ten characters to 47 units = 188 px, so
// the wordmark fits on the left with the TV-screen glyph on the right.
//
//   node tools/android/make-banner.mjs            # write the banner PNG
//   node tools/android/make-banner.mjs --check    # exit 1 if the file on disk isn't what we'd draw
//
// render, png, draw, GLYPHS, WORD and the paths are exported so a Node test can import them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
// In the "firetv" source set, not "main": only the Fire TV build has a launcher that shows a
// banner, and a resource every build carries but one build uses is just weight for the phone (#183).
export const BANNER_DIR = path.join(ROOT, "android/client/src/firetv/res/drawable-xhdpi");

/** What the Fire TV launcher asks for: xhdpi, 320×180, in the drawable-xhdpi folder. */
export const BANNER = { file: "banner.png", width: 320, height: 180 };

/** The project's colours, shared with tools/remote/make-icons.mjs. */
const BG_TOP = [0x07, 0x0b, 0x14]; // #070b14
const BG_BOTTOM = [0x0b, 0x13, 0x25]; // a touch lighter, so the banner isn't a flat slab
const ACCENT = [0x3d, 0x8b, 0xff]; // #3d8bff
const ACCENT_2 = [0x00, 0xc2, 0xd1]; // #00c2d1
const WHITE = [0xff, 0xff, 0xff];

// ---------------------------------------------------------------------------
// The letter table: a 5×7 pixel font, one string per row, "1" meaning a filled cell. Uppercase is
// full height; lowercase sits on the x-height (rows 2–6) with ascenders reaching row 0. Glyphs are
// proportional: the width is the length of a row, so l and i are one cell wide and t is three.

export const GLYPHS = {
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  l: ["1", "1", "1", "1", "1", "1", "1"],
  t: ["010", "111", "010", "010", "010", "010", "011"],
  i: ["1", "0", "1", "1", "1", "1", "1"],
  m: ["00000", "00000", "10001", "11011", "10101", "10101", "10101"],
  a: ["00000", "00000", "01110", "10001", "01111", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
};

/** The wordmark, and how it is laid out: 4 px per font cell, one cell between letters. */
export const WORD = "UltimateTV";
const UNIT = 4;
const LETTER_GAP = 1; // in font cells
const TEXT_X = 22;
const TEXT_TOP = 76; // top of the cap height; the word's optical centre is y≈90

// ---------------------------------------------------------------------------
// The TV-screen glyph on the right: a rounded screen with a play triangle, on a small stand.

const TV = { x: 226, y: 46, w: 78, h: 64, r: 12, stroke: 4 };
const PLAY = { cx: 265, cy: 78, halfH: 17, baseX: 253, tipX: 282 };
const STAND = { cx: 265, stemW: 6, stemTop: 108, stemBottom: 126, footW: 40, footH: 6, footY: 124, r: 3 };
const GLOW = { cx: 265, cy: 82, r: 100, strength: 0.16 };

// ---------------------------------------------------------------------------

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/** Inside a rounded rectangle? Clamp to the inner rectangle's nearest point and measure. */
const inRoundRect = (x, y, { x: rx, y: ry, w, h, r }) => {
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Inside the play triangle? Its vertices are (baseX, cy±halfH) and (tipX, cy). */
const inPlay = (x, y) => {
  const { cx, cy, halfH, baseX, tipX } = PLAY;
  if (x < baseX || x > tipX) return false;
  // The two sloping edges converge at the tip: |y - cy| <= halfH * (tipX - x) / (tipX - baseX).
  return Math.abs(y - cy) <= halfH * ((tipX - x) / (tipX - baseX));
};

/** The wordmark rasterised once into a 1-byte-per-pixel mask, in whole pixels so it stays crisp. */
const WORD_MASK = (() => {
  const { width: w, height: h } = BANNER;
  const mask = new Uint8Array(w * h);
  let pen = TEXT_X;
  for (const ch of WORD) {
    const rows = GLYPHS[ch];
    if (!rows) throw new Error(`make-banner: no glyph for "${ch}"`);
    const cells = rows[0].length;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cells; c++) {
        if (rows[r][c] !== "1") continue;
        const x0 = pen + c * UNIT;
        const y0 = TEXT_TOP + r * UNIT;
        for (let y = y0; y < y0 + UNIT; y++) for (let x = x0; x < x0 + UNIT; x++) mask[y * w + x] = 1;
      }
    }
    pen += (cells + LETTER_GAP) * UNIT;
  }
  return mask;
})();

/** The width of the wordmark in pixels, exported so a test can check it clears the glyph. */
export const WORD_WIDTH = (() => {
  let cells = 0;
  for (const ch of WORD) cells += GLYPHS[ch][0].length;
  return (cells + (WORD.length - 1) * LETTER_GAP) * UNIT;
})();

/** The colour at a point, as [r, g, b]. `x`/`y` are pixels, with the sample inside the pixel. */
function colourAt(x, y) {
  const { width: w, height: h } = BANNER;
  // A subtle vertical gradient rather than a flat background.
  let c = mix(BG_TOP, BG_BOTTOM, clamp01(y / (h - 1)));
  // A soft accent glow behind the screen, squared so it falls off gently.
  const d = Math.hypot(x - GLOW.cx, y - GLOW.cy);
  const glow = clamp01(1 - d / GLOW.r);
  c = mix(c, ACCENT, GLOW.strength * glow * glow);

  // The wordmark, white on top of all that.
  if (WORD_MASK[(y | 0) * w + (x | 0)]) return WHITE;

  // The screen: an accent-to-accent_2 outline, and a dark inside that is slightly lit.
  if (inRoundRect(x, y, TV)) {
    const t = clamp01(((x - TV.x) / TV.w + (y - TV.y) / TV.h) / 2);
    const line = mix(ACCENT, ACCENT_2, t);
    const inner = { x: TV.x + TV.stroke, y: TV.y + TV.stroke, w: TV.w - 2 * TV.stroke, h: TV.h - 2 * TV.stroke, r: TV.r - TV.stroke };
    if (!inRoundRect(x, y, inner)) return line;
    if (inPlay(x, y)) return WHITE;
    return mix(BG_TOP, mix(ACCENT, ACCENT_2, t), 0.1);
  }

  // The stand: a stem and a rounded foot.
  if (x >= STAND.cx - STAND.stemW / 2 && x <= STAND.cx + STAND.stemW / 2 && y >= STAND.stemTop && y <= STAND.stemBottom) {
    return mix(ACCENT, ACCENT_2, 0.35);
  }
  if (inRoundRect(x, y, { x: STAND.cx - STAND.footW / 2, y: STAND.footY, w: STAND.footW, h: STAND.footH, r: STAND.r })) {
    return mix(ACCENT, ACCENT_2, 0.35);
  }
  return c;
}

/** Renders the banner to raw RGB rows (width * height * 3 bytes), 4×4 samples per pixel. */
export function render(width = BANNER.width, height = BANNER.height) {
  if (width !== BANNER.width || height !== BANNER.height) {
    throw new Error(`make-banner: the drawing is fixed at ${BANNER.width}×${BANNER.height}, not ${width}×${height}`);
  }
  const px = Buffer.alloc(width * height * 3);
  const samples = 4;
  const n = samples * samples;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const c = colourAt(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * width + x) * 3;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
    }
  }
  return px;
}

// ---------------------------------------------------------------------------
// PNG writing: signature, IHDR, one IDAT (the deflated rows, each behind a zero filter byte) and
// IEND; every chunk carries the CRC32 of its type and data. Same writer as make-icons.mjs.

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

/** A truecolour (8-bit RGB, colour type 2) PNG of width×height from `rgb` (w * h * 3 bytes). */
export function png(width, height, rgb) {
  if (rgb.length !== width * height * 3) {
    throw new Error(`make-banner: expected ${width * height * 3} RGB bytes, got ${rgb.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const stride = width * 3 + 1;
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    rows[y * stride] = 0; // filter: none
    rgb.copy(rows, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The banner as a PNG buffer. */
export const draw = () => png(BANNER.width, BANNER.height, render());

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const check = process.argv.includes("--check");
  const target = path.join(BANNER_DIR, BANNER.file);
  const want = draw();
  const have = existsSync(target) ? readFileSync(target) : null;
  const size = `${BANNER.width}×${BANNER.height}`;
  if (check) {
    if (!have || !have.equals(want)) {
      console.error(`✗ ${path.relative(ROOT, target)} is out of date: run node tools/android/make-banner.mjs`);
      process.exit(1);
    }
    console.log(`✓ ${path.relative(ROOT, target)} (${size}, ${want.length} bytes)`);
  } else {
    mkdirSync(BANNER_DIR, { recursive: true });
    writeFileSync(target, want);
    console.log(`wrote ${path.relative(ROOT, target)} (${size}, ${want.length} bytes)`);
  }
}
