#!/usr/bin/env node
// Makes the starter clip packs in hub/packs: seasonal pictures drawn here as animated SVG (with a
// transparent background, so they float over the TV) and sounds synthesised here as WAV, so
// nothing in them belongs to anyone else.
//
//   node tools/packs/make-starter-packs.mjs
//
// Then refresh the community list's checksums with `node tools/packs/index-packs.mjs`.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "hub/packs");

// ---------------------------------------------------------------------------
// Sound: 22.05 kHz mono, 16-bit.

const RATE = 22050;
const secs = (n) => Math.round(n * RATE);
const track = (seconds) => new Float32Array(secs(seconds));

/** Adds a note: a sine with a few harmonics (a bell, a music box), dying away. */
function bell(buf, at, freq, dur, vol = 0.3, harmonics = [1, 0.5, 0.25, 0.12], decay = 4) {
  const start = secs(at);
  const n = secs(dur);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t * 400) * Math.exp(-decay * t);
    let v = 0;
    harmonics.forEach((h, k) => (v += h * Math.sin(2 * Math.PI * freq * (k + 1) * t)));
    buf[start + i] += v * env * vol;
  }
}

/** Adds a tone whose pitch follows f(t), with an envelope. */
function sweep(buf, at, dur, f, { vol = 0.3, wave = "sine", env = (t, d) => Math.min(1, t * 60) * Math.min(1, (d - t) * 20) } = {}) {
  const start = secs(at);
  const n = secs(dur);
  let phase = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * f(t)) / RATE;
    const p = phase / (2 * Math.PI);
    const s = wave === "saw" ? 2 * (p - Math.floor(p + 0.5)) : wave === "square" ? (Math.sin(phase) >= 0 ? 1 : -1) : Math.sin(phase);
    buf[start + i] += s * env(t, dur) * vol;
  }
}

/** Adds noise, high-passed (bright, like bells or crackle) or low-passed (a rumble or a bang). */
function noise(buf, at, dur, { vol = 0.3, bright = 0.9, env = (t, d) => Math.exp((-6 * t) / d) } = {}) {
  const start = secs(at);
  const n = secs(dur);
  let lo = 0;
  let prev = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const w = Math.random() * 2 - 1;
    lo += (w - lo) * (1 - bright);
    const hi = w - prev;
    prev = w;
    const s = bright > 0.5 ? hi : lo * 3;
    buf[start + i] += s * env(t, dur) * vol;
  }
}

/** A shake of sleigh bells. */
function jingle(buf, at, dur = 0.18, vol = 0.18) {
  noise(buf, at, dur, { vol, bright: 0.95, env: (t, d) => Math.exp((-5 * t) / d) * (0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 38)) });
  for (const f of [5200, 6300, 7400]) bell(buf, at + Math.random() * 0.02, f, dur * 1.5, vol * 0.25, [1], 18);
}

const NOTE = (name) => {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
};

/** Plays a tune: [note, beats] pairs, "-" for a rest. */
function tune(buf, at, bpm, notes, voice) {
  let t = at;
  for (const [note, beats] of notes) {
    const dur = (60 / bpm) * beats;
    if (note !== "-") voice(t, NOTE(note), dur);
    t += dur;
  }
  return t;
}

function wav(buf) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// A fixed seed, so running this again makes the same files.
let seed = 20261029;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const sounds = {
  jingleBells() {
    const b = track(6.5);
    const melody = [["E5", 1], ["E5", 1], ["E5", 2], ["E5", 1], ["E5", 1], ["E5", 2], ["E5", 1], ["G5", 1], ["C5", 1.5], ["D5", 0.5], ["E5", 4]];
    const end = tune(b, 0.1, 200, melody, (t, f, d) => bell(b, t, f, d + 0.4, 0.3, [1, 0.4, 0.2, 0.1], 3));
    for (let t = 0.1; t < end; t += 60 / 200) jingle(b, t);
    return b;
  },
  sleighBells() {
    const b = track(5);
    for (let t = 0.05; t < 4.8; t += 0.3) jingle(b, t, 0.22, 0.22 * (0.6 + 0.4 * Math.sin(t * 1.3)));
    return b;
  },
  twinkle() {
    const b = track(3.5);
    ["C6", "E6", "G6", "C7", "G6", "E6", "C7", "E7"].forEach((n, i) => bell(b, 0.1 + i * 0.28, NOTE(n), 1.6, 0.22, [1, 0.3], 3));
    return b;
  },
  boing() {
    const b = track(4);
    for (let i = 0; i < 3; i++) {
      const at = 0.15 + i * 1.2;
      sweep(b, at, 0.55, (t) => 180 + 520 * Math.sin(Math.min(1, t / 0.45) * Math.PI) * (1 + 0.15 * Math.sin(t * 2 * Math.PI * 22)), { vol: 0.35, env: (t, d) => Math.min(1, t * 80) * Math.exp((-3 * t) / d) });
      noise(b, at + 0.5, 0.08, { vol: 0.12, bright: 0.2 });
    }
    return b;
  },
  chirps() {
    const b = track(4);
    let t = 0.1;
    while (t < 3.6) {
      const n = 2 + Math.floor(Math.random() * 4);
      const base = 2800 + Math.random() * 1500;
      for (let k = 0; k < n; k++) {
        sweep(b, t, 0.07, (x) => base + 1800 * (x / 0.07), { vol: 0.2, env: (x, d) => Math.sin((Math.PI * x) / d) });
        t += 0.09;
      }
      t += 0.25 + Math.random() * 0.4;
    }
    return b;
  },
  musicBox() {
    const b = track(6);
    const notes = [["C5", 1], ["E5", 1], ["G5", 1], ["C6", 2], ["B5", 1], ["G5", 1], ["E5", 1], ["F5", 2], ["A5", 1], ["C6", 1], ["E6", 1], ["D6", 3]];
    tune(b, 0.1, 150, notes, (t, f) => bell(b, t, f, 1.8, 0.25, [1, 0.15, 0.4], 2.6));
    return b;
  },
  harp() {
    const b = track(3);
    ["C4", "E4", "G4", "C5", "E5", "G5", "C6", "E6", "G6", "C7"].forEach((n, i) => bell(b, 0.05 + i * 0.07, NOTE(n), 2, 0.2, [1, 0.6, 0.2], 2.2));
    return b;
  },
  happyBirthday() {
    const b = track(9);
    const notes = [
      ["G4", 0.75], ["G4", 0.25], ["A4", 1], ["G4", 1], ["C5", 1], ["B4", 2],
      ["G4", 0.75], ["G4", 0.25], ["A4", 1], ["G4", 1], ["D5", 1], ["C5", 2],
      ["G4", 0.75], ["G4", 0.25], ["G5", 1], ["E5", 1], ["C5", 1], ["B4", 1], ["A4", 2],
      ["F5", 0.75], ["F5", 0.25], ["E5", 1], ["C5", 1], ["D5", 1], ["C5", 3],
    ];
    tune(b, 0.1, 168, notes, (t, f) => bell(b, t, f, 1.6, 0.25, [1, 0.15, 0.4], 2.6));
    return b;
  },
  partyHorn() {
    const b = track(2.5);
    sweep(b, 0.05, 0.25, (t) => 300 + t * 600, { vol: 0.25, wave: "saw" });
    sweep(b, 0.45, 1.4, (t) => 470 + 12 * Math.sin(t * 2 * Math.PI * 7), { vol: 0.28, wave: "saw", env: (t, d) => Math.min(1, t * 30) * Math.min(1, (d - t) * 6) });
    sweep(b, 0.45, 1.4, (t) => 940 + 24 * Math.sin(t * 2 * Math.PI * 7), { vol: 0.08, wave: "square", env: (t, d) => Math.min(1, t * 30) * Math.min(1, (d - t) * 6) });
    return b;
  },
  fireworks() {
    const b = track(7);
    for (const at of [0.1, 1.6, 2.4, 4.1, 5.0]) {
      sweep(b, at, 0.9, (t) => 900 + 1600 * (t / 0.9), { vol: 0.08, env: (t, d) => Math.min(1, t * 10) * (1 - t / d) });
      noise(b, at + 0.9, 1.2, { vol: 0.9, bright: 0.1, env: (t) => Math.exp(-7 * t) });
      for (let k = 0; k < 24; k++) noise(b, at + 1.0 + Math.random() * 1.1, 0.03, { vol: 0.25, bright: 0.95 });
    }
    return b;
  },
  ghost() {
    const b = track(5);
    sweep(b, 0.1, 2.2, (t) => 330 + 140 * Math.sin(t * 2.4) + 8 * Math.sin(t * 2 * Math.PI * 6), { vol: 0.3, env: (t, d) => Math.sin((Math.PI * t) / d) ** 1.5 });
    sweep(b, 2.4, 2.4, (t) => 420 - 160 * (t / 2.4) + 10 * Math.sin(t * 2 * Math.PI * 5), { vol: 0.3, env: (t, d) => Math.sin((Math.PI * t) / d) ** 1.5 });
    noise(b, 0, 5, { vol: 0.05, bright: 0.05, env: () => 1 });
    return b;
  },
  bats() {
    const b = track(4);
    for (let i = 0; i < 26; i++) {
      const at = 0.1 + Math.random() * 3.6;
      sweep(b, at, 0.05, (t) => 5200 - 26000 * t, { vol: 0.16, env: (t, d) => Math.sin((Math.PI * t) / d) });
    }
    for (let t = 0.05; t < 3.9; t += 0.11) noise(b, t, 0.06, { vol: 0.06, bright: 0.3 });
    return b;
  },
  creep() {
    const b = track(5);
    ["E3", "D#3", "D3", "C#3", "C3", "B2", "A#2"].forEach((n, i) => {
      bell(b, 0.1 + i * 0.55, NOTE(n), 0.5, 0.3, [1, 0.7, 0.4, 0.2], 7);
      bell(b, 0.1 + i * 0.55, NOTE(n) * 1.414, 0.5, 0.12, [1, 0.5], 7);
    });
    sweep(b, 3.9, 1, (t) => 120 + 30 * Math.sin(t * 40), { vol: 0.12, wave: "saw", env: (t, d) => Math.sin((Math.PI * t) / d) });
    return b;
  },
};

// ---------------------------------------------------------------------------
// Pictures: animated SVG, transparent. Animations are CSS inside the picture, which plays in the
// TV's <img>; nothing here is script.

const svg = (w, h, style, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${style.replace(/\s+/g, " ")}</style>${body}</svg>`;

const pictures = {
  snowman: svg(
    300,
    400,
    `.arm{transform-origin:228px 190px;animation:wave 1.2s ease-in-out infinite alternate}
     @keyframes wave{from{transform:rotate(-8deg)}to{transform:rotate(22deg)}}
     .body{animation:sway 0.8s ease-in-out infinite alternate;transform-origin:150px 390px}
     @keyframes sway{from{transform:rotate(-2deg)}to{transform:rotate(2deg)}}`,
    `<g class="body">
      <ellipse cx="150" cy="392" rx="96" ry="10" fill="#000" opacity=".18"/>
      <circle cx="150" cy="310" r="85" fill="#fbfdff" stroke="#c9d8ec" stroke-width="4"/>
      <circle cx="150" cy="190" r="62" fill="#fbfdff" stroke="#c9d8ec" stroke-width="4"/>
      <circle cx="150" cy="95" r="46" fill="#fbfdff" stroke="#c9d8ec" stroke-width="4"/>
      <path d="M72 190 30 150M36 158l-14-4M36 158l-2-16" stroke="#6b4423" stroke-width="7" stroke-linecap="round" fill="none"/>
      <g class="arm"><path d="M228 190l46-44M266 152l14-2M266 152l2-16" stroke="#6b4423" stroke-width="7" stroke-linecap="round" fill="none"/></g>
      <path d="M100 132c30 16 70 16 100 0l4 20c-34 16-74 16-108 0z" fill="#d62f3a"/>
      <path d="M176 146l14 52-24 4-8-50z" fill="#b8202c"/>
      <rect x="118" y="-4" width="64" height="54" rx="6" fill="#1c1f2b"/>
      <rect x="118" y="34" width="64" height="10" fill="#d62f3a"/>
      <rect x="100" y="46" width="100" height="12" rx="5" fill="#1c1f2b"/>
      <circle cx="134" cy="88" r="6" fill="#1c1f2b"/><circle cx="166" cy="88" r="6" fill="#1c1f2b"/>
      <path d="M150 98l40 8-40 8z" fill="#f28c28"/>
      <path d="M130 118q20 12 40 0" stroke="#1c1f2b" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="150" cy="180" r="7" fill="#1c1f2b"/><circle cx="150" cy="210" r="7" fill="#1c1f2b"/><circle cx="150" cy="290" r="8" fill="#1c1f2b"/>
    </g>`,
  ).replace('viewBox="0 0 300 400"', 'viewBox="0 -10 300 410"'),

  sleigh: svg(
    720,
    260,
    `.deer{animation:gallop .5s ease-in-out infinite alternate}
     .deer2{animation:gallop .5s .25s ease-in-out infinite alternate}
     @keyframes gallop{from{transform:translateY(-6px)}to{transform:translateY(6px)}}
     .leg{transform-box:fill-box;transform-origin:top;animation:leg .5s ease-in-out infinite alternate}
     @keyframes leg{from{transform:rotate(-25deg)}to{transform:rotate(25deg)}}
     .sparkle{animation:tw 1s ease-in-out infinite alternate}@keyframes tw{from{opacity:.2}to{opacity:1}}`,
    `<defs><linearGradient id="sl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e53945"/><stop offset="1" stop-color="#a3121f"/></linearGradient></defs>
    <g class="sparkle" fill="#ffe680"><circle cx="20" cy="190" r="4"/><circle cx="60" cy="210" r="3"/><circle cx="35" cy="160" r="2.5"/><circle cx="90" cy="230" r="2"/></g>
    <path d="M150 130l-30 8M260 128" stroke="#8a5a2b" stroke-width="3"/>
    <path d="M250 150 470 120M250 160 610 110" stroke="#8a5a2b" stroke-width="3"/>
    <g class="deer"><g fill="#8a5a2b">
      <ellipse cx="520" cy="120" rx="48" ry="22"/><path d="M556 112l22-32 14 6-18 34z"/><ellipse cx="590" cy="80" rx="18" ry="12"/>
      <rect class="leg" x="490" y="132" width="7" height="40" rx="3"/><rect class="leg" x="545" y="132" width="7" height="40" rx="3"/></g>
      <path d="M584 70l-8-26m4 12-12-6m22 18 6-26m-3 12 12-8" stroke="#5a3a1a" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="606" cy="80" r="6" fill="#ff2a2a"/><circle cx="592" cy="76" r="2.5" fill="#111"/></g>
    <g class="deer2"><g fill="#9b6a35">
      <ellipse cx="640" cy="110" rx="44" ry="20"/><path d="M674 102l20-30 13 6-16 32z"/><ellipse cx="704" cy="72" rx="16" ry="11"/>
      <rect class="leg" x="612" y="120" width="7" height="38" rx="3"/><rect class="leg" x="662" y="120" width="7" height="38" rx="3"/></g>
      <path d="M698 62l-8-24m4 11-11-6m21 17 6-24" stroke="#5a3a1a" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="706" cy="68" r="2.5" fill="#111"/></g>
    <g class="deer2">
      <path d="M120 200h200" stroke="#d4af37" stroke-width="7" stroke-linecap="round"/><path d="M110 190q-14 14 6 20M330 190q10 0 10-12" stroke="#d4af37" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M130 120h190l-20 60H150z" fill="url(#sl)"/><path d="M130 120h190" stroke="#d4af37" stroke-width="6"/>
      <circle cx="200" cy="96" r="22" fill="#f2c9a5"/><path d="M178 90q22-40 46 0z" fill="#d62f3a"/><circle cx="226" cy="64" r="8" fill="#fff"/>
      <path d="M178 92h46" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M182 104q18 34 36 0z" fill="#fff"/>
      <path d="M170 120q30-24 60 0z" fill="#d62f3a"/><rect x="238" y="80" width="54" height="44" rx="8" fill="#6a3fa0"/><path d="M265 80v44M238 102h54" stroke="#ffd34d" stroke-width="5"/></g>`,
  ),

  snowfall: (() => {
    let flakes = "";
    let css = "";
    for (let i = 0; i < 70; i++) {
      const x = Math.round(Math.random() * 1920);
      const r = (2 + Math.random() * 6).toFixed(1);
      const d = (7 + Math.random() * 9).toFixed(1);
      const delay = (-Math.random() * 16).toFixed(1);
      css += `.f${i}{animation:fall${i % 4} ${d}s ${delay}s linear infinite}`;
      flakes += `<circle class="f${i}" cx="${x}" cy="-20" r="${r}" fill="#fff" opacity="${(0.55 + Math.random() * 0.45).toFixed(2)}"/>`;
    }
    for (let k = 0; k < 4; k++) css += `@keyframes fall${k}{from{transform:translate(0,0)}50%{transform:translate(${(k - 1.5) * 30}px,560px)}to{transform:translate(${(1.5 - k) * 40}px,1120px)}}`;
    return svg(1920, 1080, css, flakes);
  })(),

  tree: svg(
    320,
    420,
    `.l{animation:tw 1.4s ease-in-out infinite alternate}.l2{animation-delay:.5s}.l3{animation-delay:.9s}
     @keyframes tw{from{opacity:.25}to{opacity:1}}.star{transform-origin:160px 40px;animation:spin 6s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`,
    `<rect x="140" y="350" width="40" height="60" fill="#7a4a24"/>
    <path d="M160 40 40 200h50L20 300h60L0 380h320l-80-80h60l-70-100h50z" fill="#1f8a4c"/><path d="M160 40 40 200h50L20 300h60L0 380h160z" fill="#1a7a42"/>
    <g class="star"><path d="m160 10 9 20 22 2-17 14 6 22-20-12-20 12 6-22-17-14 22-2z" fill="#ffd34d"/></g>
    <path d="M70 230q90 40 170-10M50 330q110 40 220-10" stroke="#d4af37" stroke-width="5" fill="none"/>
    <g class="l"><circle cx="110" cy="150" r="9" fill="#ff4d4d"/><circle cx="200" cy="250" r="9" fill="#4dc3ff"/><circle cx="90" cy="320" r="9" fill="#ffd34d"/></g>
    <g class="l l2"><circle cx="190" cy="140" r="9" fill="#ffd34d"/><circle cx="120" cy="260" r="9" fill="#ff4dc3"/><circle cx="240" cy="340" r="9" fill="#ff4d4d"/></g>
    <g class="l l3"><circle cx="150" cy="200" r="9" fill="#4dc3ff"/><circle cx="160" cy="300" r="9" fill="#7dff4d"/><circle cx="60" cy="360" r="9" fill="#4dc3ff"/></g>`,
  ),

  fireworks: (() => {
    let body = "";
    let css = "@keyframes burst{0%{transform:scale(.05);opacity:0}8%{opacity:1}70%{opacity:1}100%{transform:scale(1);opacity:0}}";
    const colours = ["#ff4d6d", "#ffd34d", "#4dc3ff", "#7dff8a", "#c77dff", "#ff9f4d"];
    for (let i = 0; i < 7; i++) {
      const cx = 200 + Math.round(Math.random() * 1520);
      const cy = 140 + Math.round(Math.random() * 420);
      const c = colours[i % colours.length];
      const dur = (2.4 + Math.random() * 1.6).toFixed(1);
      const delay = (-Math.random() * 4).toFixed(1);
      css += `.b${i}{transform-origin:${cx}px ${cy}px;animation:burst ${dur}s ${delay}s ease-out infinite}`;
      let rays = "";
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const r1 = 30;
        const r2 = 150 + Math.random() * 60;
        rays += `<path d="M${(cx + Math.cos(a) * r1).toFixed(0)} ${(cy + Math.sin(a) * r1).toFixed(0)}L${(cx + Math.cos(a) * r2).toFixed(0)} ${(cy + Math.sin(a) * r2).toFixed(0)}"/>`;
        rays += `<circle cx="${(cx + Math.cos(a) * (r2 + 14)).toFixed(0)}" cy="${(cy + Math.sin(a) * (r2 + 14)).toFixed(0)}" r="5"/>`;
      }
      body += `<g class="b${i}" stroke="${c}" fill="${c}" stroke-width="5" stroke-linecap="round">${rays}</g>`;
    }
    return svg(1920, 1080, css, body);
  })(),

  rocket: svg(
    160,
    420,
    `.flame{transform-origin:80px 300px;animation:fl .12s ease-in-out infinite alternate}@keyframes fl{from{transform:scaleY(.8)}to{transform:scaleY(1.2)}}
     .spark{animation:sp .4s linear infinite}@keyframes sp{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(60px)}}`,
    `<g class="flame"><path d="M58 300q22 120 22 120t22-120z" fill="#ffd34d"/><path d="M68 300q12 70 12 70t12-70z" fill="#fff4b0"/></g>
    <g class="spark" fill="#ffb84d"><circle cx="50" cy="340" r="4"/><circle cx="110" cy="360" r="3"/><circle cx="64" cy="390" r="3"/></g>
    <path d="M80 20q40 40 40 120v160H40V140q0-80 40-120z" fill="#e53945"/><path d="M40 260l-30 50h30zM120 260l30 50h-30z" fill="#4d7cff"/>
    <circle cx="80" cy="130" r="20" fill="#bfe7ff" stroke="#fff" stroke-width="6"/><path d="M40 210h80M40 230h80" stroke="#ffd34d" stroke-width="8"/>`,
  ),

  bunny: svg(
    360,
    380,
    `.ear{transform-origin:150px 120px;animation:ear 1.1s ease-in-out infinite alternate}.ear2{transform-origin:205px 120px;animation-delay:.3s}
     @keyframes ear{from{transform:rotate(-6deg)}to{transform:rotate(8deg)}}
     .nose{animation:sn .3s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}@keyframes sn{to{transform:scale(1.25)}}`,
    `<ellipse cx="185" cy="370" rx="110" ry="9" fill="#000" opacity=".16"/>
    <g class="ear"><path d="M130 130c-20-70-10-120 12-124s30 50 22 124z" fill="#f4efe9" stroke="#d8cfc6" stroke-width="3"/><path d="M140 120c-10-50-6-90 4-92s14 40 10 92z" fill="#f7b6c8"/></g>
    <g class="ear ear2"><path d="M195 130c0-72 20-118 42-114s16 58-8 122z" fill="#f4efe9" stroke="#d8cfc6" stroke-width="3"/><path d="M205 124c2-50 14-84 24-82s8 40-8 84z" fill="#f7b6c8"/></g>
    <ellipse cx="200" cy="280" rx="110" ry="85" fill="#f4efe9" stroke="#d8cfc6" stroke-width="3"/>
    <circle cx="300" cy="270" r="28" fill="#fff" stroke="#e6ded6" stroke-width="3"/>
    <ellipse cx="175" cy="175" rx="70" ry="62" fill="#f4efe9" stroke="#d8cfc6" stroke-width="3"/>
    <ellipse cx="135" cy="355" rx="34" ry="14" fill="#f4efe9" stroke="#d8cfc6" stroke-width="3"/><ellipse cx="250" cy="358" rx="40" ry="14" fill="#f4efe9" stroke="#d8cfc6" stroke-width="3"/>
    <circle cx="150" cy="168" r="9" fill="#2b2230"/><circle cx="153" cy="165" r="3" fill="#fff"/><circle cx="200" cy="168" r="9" fill="#2b2230"/><circle cx="203" cy="165" r="3" fill="#fff"/>
    <ellipse class="nose" cx="175" cy="192" rx="9" ry="6" fill="#f28cab"/>
    <path d="M175 198v10m0 0q-10 10-18 2m18-2q10 10 18 2" stroke="#2b2230" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M120 196l-30-6m30 14-30 6M230 196l30-6m-30 14 30 6" stroke="#b9aea4" stroke-width="2"/>
    <g transform="translate(70 250) rotate(-12)"><ellipse cx="0" cy="0" rx="30" ry="38" fill="#7ad0f0"/><path d="M-28-8q14 10 28 0t28 0M-28 12q14 10 28 0t28 0" stroke="#fff" stroke-width="5" fill="none"/></g>`,
  ),

  chick: svg(
    280,
    300,
    `.chick{animation:pop 1.6s ease-in-out infinite alternate;transform-origin:140px 220px}@keyframes pop{from{transform:translateY(24px)}to{transform:translateY(-8px)}}
     .wing{transform-origin:100px 170px;animation:fl .25s ease-in-out infinite alternate}@keyframes fl{to{transform:rotate(-30deg)}}`,
    `<g class="chick"><circle cx="140" cy="150" r="62" fill="#ffd93b"/><path class="wing" d="M86 160q-30 0-30 30 26 6 44-10z" fill="#f5c400"/>
      <circle cx="120" cy="138" r="8" fill="#2b2230"/><circle cx="160" cy="138" r="8" fill="#2b2230"/><path d="M128 156h24l-12 14z" fill="#ff8a1f"/>
      <path d="M140 88q-6-20 6-26M140 88q8-18 22-16" stroke="#f5c400" stroke-width="6" fill="none" stroke-linecap="round"/></g>
    <path d="M50 190q0 100 90 100t90-100l-20 14-18-20-18 22-18-22-18 22-18-22-18 20z" fill="#fffaf0" stroke="#e8dcc4" stroke-width="4"/>
    <path d="M70 240q70 20 140 0" stroke="#ff9ec7" stroke-width="8" fill="none"/><circle cx="110" cy="265" r="6" fill="#8fd16a"/><circle cx="170" cy="265" r="6" fill="#7ad0f0"/>`,
  ),

  butterflies: (() => {
    let body = "";
    let css = "@keyframes flap{from{transform:scaleX(1)}to{transform:scaleX(.25)}}";
    const colours = ["#ff9ec7", "#7ad0f0", "#ffd93b", "#b98cff", "#8fd16a"];
    for (let i = 0; i < 9; i++) {
      const x = 120 + Math.round(Math.random() * 1680);
      const y = 120 + Math.round(Math.random() * 800);
      const c = colours[i % colours.length];
      const dur = (9 + Math.random() * 8).toFixed(1);
      const delay = (-Math.random() * 10).toFixed(1);
      const dx = Math.round(-300 + Math.random() * 600);
      const dy = Math.round(-200 + Math.random() * 400);
      css += `.m${i}{animation:m${i} ${dur}s ${delay}s ease-in-out infinite alternate}@keyframes m${i}{from{transform:translate(0,0)}50%{transform:translate(${Math.round(dx / 2)}px,${-Math.abs(dy)}px)}to{transform:translate(${dx}px,${dy}px)}}`;
      css += `.w${i}{transform-origin:${x}px ${y}px;animation:flap ${(0.18 + Math.random() * 0.1).toFixed(2)}s ease-in-out infinite alternate}`;
      body += `<g class="m${i}"><g class="w${i}"><path d="M${x} ${y}c-30-40-70-20-50 10 10 14 40 10 50-10zM${x} ${y}c30-40 70-20 50 10-10 14-40 10-50-10zM${x} ${y}c-24 10-36 40-14 40 10 0 14-20 14-40zM${x} ${y}c24 10 36 40 14 40-10 0-14-20-14-40z" fill="${c}" opacity=".9"/></g><path d="M${x} ${y - 14}v34" stroke="#3a2a3a" stroke-width="5" stroke-linecap="round"/></g>`;
    }
    return svg(1920, 1080, css, body);
  })(),

  hearts: (() => {
    let body = "";
    let css = "";
    const colours = ["#ff4d6d", "#ff8fab", "#e5383b", "#ffb3c6"];
    for (let i = 0; i < 26; i++) {
      const x = Math.round(Math.random() * 1880);
      const s = (0.5 + Math.random() * 1.3).toFixed(2);
      const d = (8 + Math.random() * 8).toFixed(1);
      const delay = (-Math.random() * 16).toFixed(1);
      css += `.h${i}{animation:up${i % 3} ${d}s ${delay}s linear infinite}`;
      body += `<g class="h${i}"><path transform="translate(${x} 1120) scale(${s})" d="M0 12C0-8 30-10 30 12 30 30 0 46 0 56 0 46-30 30-30 12-30-10 0-8 0 12z" fill="${colours[i % colours.length]}" opacity=".85"/></g>`;
    }
    for (let k = 0; k < 3; k++) css += `@keyframes up${k}{from{transform:translate(0,0)}33%{transform:translate(${(k - 1) * 40}px,-400px)}66%{transform:translate(${(1 - k) * 40}px,-800px)}to{transform:translate(0,-1220px)}}`;
    return svg(1920, 1080, css, body);
  })(),

  cupid: svg(
    420,
    280,
    `.wing{transform-origin:200px 120px;animation:fl .3s ease-in-out infinite alternate}@keyframes fl{to{transform:rotate(-22deg) scaleY(.85)}}
     .bob{animation:bob 1s ease-in-out infinite alternate}@keyframes bob{from{transform:translateY(-6px)}to{transform:translateY(6px)}}`,
    `<g class="bob"><g class="wing"><path d="M200 120c-20-70 40-110 90-90-10 20-20 30-40 34 20 4 30 10 36 24-30 10-50 0-60-10 10 24 0 40-26 42z" fill="#fff" stroke="#e8d8f0" stroke-width="3"/></g>
      <circle cx="160" cy="90" r="40" fill="#ffd2b0"/><path d="M122 80q10-44 54-40 30 4 26 30-14-18-40-14t-40 24z" fill="#ffcf4d"/>
      <circle cx="148" cy="92" r="5" fill="#2b2230"/><circle cx="176" cy="92" r="5" fill="#2b2230"/><path d="M152 108q10 8 20 0" stroke="#d65a7a" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="138" cy="104" r="7" fill="#ff9eb5" opacity=".7"/>
      <ellipse cx="170" cy="168" rx="46" ry="40" fill="#ffd2b0"/><path d="M128 170q42 30 86 0v18q-42 24-86 0z" fill="#fff"/>
      <path d="M210 150q60-60 120-30" stroke="#a0522d" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M210 150 330 120" stroke="#ccc" stroke-width="2"/>
      <path d="M200 150h170" stroke="#a0522d" stroke-width="5"/><path d="M370 150l-20-12v24z" fill="#c0c0c0"/>
      <path d="M380 150c0-10 14-12 14 0 0 10-14 18-14 22 0-4-14-12-14-22 0-12 14-10 14 0z" fill="#ff4d6d"/></g>`,
  ),

  balloons: svg(
    360,
    520,
    `.sway{transform-origin:180px 520px;animation:sw 2.4s ease-in-out infinite alternate}@keyframes sw{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}`,
    `<g class="sway"><path d="M100 180q40 160 80 340M180 150q-10 180 0 370M265 190q-40 160-85 330" stroke="#8a8a9a" stroke-width="3" fill="none"/>
      <ellipse cx="100" cy="110" rx="72" ry="88" fill="#ff4d6d"/><ellipse cx="78" cy="78" rx="16" ry="26" fill="#fff" opacity=".45"/><path d="M92 196h16l-8-12z" fill="#ff4d6d"/>
      <ellipse cx="265" cy="120" rx="72" ry="88" fill="#4dc3ff"/><ellipse cx="243" cy="88" rx="16" ry="26" fill="#fff" opacity=".45"/><path d="M257 206h16l-8-12z" fill="#4dc3ff"/>
      <ellipse cx="180" cy="80" rx="74" ry="90" fill="#ffd34d"/><ellipse cx="158" cy="48" rx="16" ry="26" fill="#fff" opacity=".5"/><path d="M172 168h16l-8-12z" fill="#ffd34d"/>
      <ellipse cx="180" cy="508" rx="22" ry="10" fill="#7a5cff"/></g>`,
  ).replace('viewBox="0 0 360 520"', 'viewBox="0 -12 360 532"'),

  banner: svg(
    900,
    240,
    `.flag{transform-box:fill-box;transform-origin:top;animation:fl 1.2s ease-in-out infinite alternate}.flag:nth-child(even){animation-delay:.4s}@keyframes fl{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}`,
    `<path d="M10 20q440 80 880 0" stroke="#7a5cff" stroke-width="5" fill="none"/>
    ${"HAPPY BIRTHDAY"
      .split("")
      .map((ch, i) => {
        if (ch === " ") return "";
        const x = 30 + i * 61;
        const y = 20 + 80 * (1 - ((x - 450) / 440) ** 2) * 0.5;
        const c = ["#ff4d6d", "#ffd34d", "#4dc3ff", "#7dff8a", "#c77dff"][i % 5];
        return `<g class="flag"><path d="M${x} ${y.toFixed(0)}h54l-27 120z" fill="${c}"/><text x="${x + 27}" y="${(y + 56).toFixed(0)}" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="40" text-anchor="middle" fill="#fff">${ch}</text></g>`;
      })
      .join("")}`,
  ),

  confetti: (() => {
    let body = "";
    let css = "rect{transform-box:fill-box;transform-origin:center}";
    const colours = ["#ff4d6d", "#ffd34d", "#4dc3ff", "#7dff8a", "#c77dff", "#ff9f4d"];
    for (let i = 0; i < 90; i++) {
      const x = Math.round(Math.random() * 1920);
      const d = (4 + Math.random() * 5).toFixed(1);
      const delay = (-Math.random() * 9).toFixed(1);
      const w = 8 + Math.round(Math.random() * 10);
      css += `.c${i}{animation:cf${i % 4} ${d}s ${delay}s linear infinite}`;
      body += `<rect class="c${i}" x="${x}" y="-30" width="${w}" height="${Math.round(w * 0.5)}" fill="${colours[i % colours.length]}"/>`;
    }
    for (let k = 0; k < 4; k++) css += `@keyframes cf${k}{from{transform:translate(0,0) rotate(0)}to{transform:translate(${(k - 1.5) * 80}px,1140px) rotate(${(k + 2) * 260}deg)}}`;
    return svg(1920, 1080, css, body);
  })(),

  ghost: svg(
    320,
    400,
    `.g{animation:fl 1.6s ease-in-out infinite alternate}@keyframes fl{from{transform:translateY(-10px)}to{transform:translateY(10px)}}
     .tail{animation:wv .8s ease-in-out infinite alternate;transform-origin:160px 300px}@keyframes wv{from{transform:skewX(-6deg)}to{transform:skewX(6deg)}}
     .eye{animation:bl 4s infinite;transform-box:fill-box;transform-origin:center}@keyframes bl{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}`,
    `<defs><radialGradient id="gg" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dfe6ff"/></radialGradient></defs>
    <g class="g" opacity=".93"><path class="tail" d="M160 20c74 0 120 56 120 140v170l-24-22-26 26-24-26-24 26-22-26-24 26-24-26-26 26-26-24V160C40 76 86 20 160 20z" fill="url(#gg)"/>
      <ellipse class="eye" cx="122" cy="150" rx="18" ry="26" fill="#1b1030"/><ellipse class="eye" cx="198" cy="150" rx="18" ry="26" fill="#1b1030"/>
      <ellipse cx="160" cy="222" rx="24" ry="30" fill="#1b1030"/><path d="M40 220q-30 10-34 40M280 220q30 10 34 40" stroke="#dfe6ff" stroke-width="20" stroke-linecap="round" fill="none"/></g>`,
  ),

  spider: svg(
    240,
    420,
    `.legs{transform-origin:120px 330px;animation:wr .3s ease-in-out infinite alternate}@keyframes wr{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}
     .eye{animation:gl 1.4s ease-in-out infinite alternate}@keyframes gl{from{opacity:.4}to{opacity:1}}`,
    `<path d="M120 0v290" stroke="#e8e8f0" stroke-width="2" opacity=".8"/>
    <g class="legs" stroke="#141018" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M100 310 50 270 20 310M98 325 40 315 12 360M100 340 50 360 30 405M106 350 76 390 70 418"/>
      <path d="M140 310 190 270 220 310M142 325 200 315 228 360M140 340 190 360 210 405M134 350 164 390 170 418"/></g>
    <ellipse cx="120" cy="370" rx="44" ry="50" fill="#1e1824"/><circle cx="120" cy="310" r="30" fill="#141018"/>
    <path d="M104 370h32M108 390h24" stroke="#a3121f" stroke-width="7" stroke-linecap="round"/>
    <g class="eye" fill="#ff2a2a"><circle cx="108" cy="306" r="7"/><circle cx="132" cy="306" r="7"/><circle cx="114" cy="294" r="4"/><circle cx="126" cy="294" r="4"/></g>`,
  ),

  bats: (() => {
    let body = "";
    let css = "@keyframes flap{from{transform:scaleY(1)}to{transform:scaleY(-.4)}}";
    for (let i = 0; i < 14; i++) {
      const y = 80 + Math.round(Math.random() * 700);
      const s = (0.6 + Math.random() * 0.9).toFixed(2);
      const dur = (6 + Math.random() * 6).toFixed(1);
      const delay = (-Math.random() * 12).toFixed(1);
      const dir = i % 2 ? 1 : -1;
      css += `.v${i}{animation:fly${i} ${dur}s ${delay}s linear infinite}@keyframes fly${i}{from{transform:translate(${dir > 0 ? -200 : 2120}px,${y}px) scale(${s})}25%{transform:translate(${dir > 0 ? 300 : 1620}px,${y - 60}px) scale(${s})}50%{transform:translate(${dir > 0 ? 860 : 1060}px,${y + 40}px) scale(${s})}75%{transform:translate(${dir > 0 ? 1400 : 520}px,${y - 30}px) scale(${s})}to{transform:translate(${dir > 0 ? 2120 : -200}px,${y}px) scale(${s})}}`;
      css += `.k${i}{transform-origin:0 0;animation:flap ${(0.14 + Math.random() * 0.08).toFixed(2)}s ease-in-out infinite alternate}`;
      body += `<g class="v${i}"><g class="k${i}"><path d="M0 0c-20-26-50-30-80-20 14 4 20 12 18 22-10-8-24-6-32 2 16 2 24 10 22 20 20-18 50-20 72-24zM0 0c20-26 50-30 80-20-14 4-20 12-18 22 10-8 24-6 32 2-16 2-24 10-22 20-20-18-50-20-72-24z" fill="#120a18"/></g><ellipse cx="0" cy="4" rx="10" ry="14" fill="#120a18"/><path d="M-8-8l-4-10 8 6zM8-8l4-10-8 6z" fill="#120a18"/></g>`;
    }
    return svg(1920, 1080, css, body);
  })(),
};

// ---------------------------------------------------------------------------
// The packs

const packs = [
  {
    id: "christmas-starter",
    name: "Christmas starter",
    theme: "christmas",
    description: "A snowman strolling along the bottom, Santa's sleigh across the top, falling snow and a twinkling tree.",
    clips: [
      ["snowman", "Snowman", "image/svg+xml", pictures.snowman],
      ["sleigh", "Santa's sleigh", "image/svg+xml", pictures.sleigh],
      ["snowfall", "Falling snow", "image/svg+xml", pictures.snowfall],
      ["tree", "Christmas tree", "image/svg+xml", pictures.tree],
      ["jingle", "Jingle bells", "audio/wav", sounds.jingleBells],
      ["sleighbells", "Sleigh bells", "audio/wav", sounds.sleighBells],
      ["twinkle", "Twinkle", "audio/wav", sounds.twinkle],
    ],
    mixes: [
      { name: "Snowman walks by", visual: "snowman", audio: "sleighbells", spot: "bottom", size: "medium", motion: "walk-left", seconds: 18 },
      { name: "Santa's sleigh", visual: "sleigh", audio: "jingle", spot: "top", size: "small", motion: "fly-right", seconds: 14 },
      { name: "Let it snow", visual: "snowfall", spot: "overlay", size: "large", seconds: 25 },
      { name: "Tree peeks up", visual: "tree", audio: "twinkle", spot: "bottom-right", size: "small", motion: "peek", seconds: 10 },
    ],
  },
  {
    id: "fireworks-starter",
    name: "Fireworks",
    theme: "bonfire",
    description: "Fireworks over whatever's on, and a rocket going up: for Bonfire Night and New Year.",
    clips: [
      ["fireworks", "Fireworks", "image/svg+xml", pictures.fireworks],
      ["rocket", "Rocket", "image/svg+xml", pictures.rocket],
      ["bangs", "Fireworks", "audio/wav", sounds.fireworks],
    ],
    mixes: [
      { name: "Fireworks", visual: "fireworks", audio: "bangs", spot: "overlay", size: "large", seconds: 12 },
      { name: "Rocket", visual: "rocket", audio: "bangs", spot: "bottom", size: "small", motion: "rise", seconds: 8 },
      { name: "New Year fireworks", visual: "fireworks", audio: "bangs", spot: "overlay", size: "large", seconds: 15, theme: "newyear" },
      { name: "New Year rocket", visual: "rocket", audio: "bangs", spot: "bottom-left", size: "small", motion: "rise", seconds: 8, theme: "newyear" },
    ],
  },
  {
    id: "easter-starter",
    name: "Easter starter",
    theme: "easter",
    description: "The Easter bunny hopping across, a chick popping out of its egg and butterflies.",
    clips: [
      ["bunny", "Easter bunny", "image/svg+xml", pictures.bunny],
      ["chick", "Chick in an egg", "image/svg+xml", pictures.chick],
      ["butterflies", "Butterflies", "image/svg+xml", pictures.butterflies],
      ["boing", "Boing", "audio/wav", sounds.boing],
      ["chirps", "Birdsong", "audio/wav", sounds.chirps],
    ],
    mixes: [
      { name: "Bunny hops across", visual: "bunny", audio: "boing", spot: "bottom", size: "medium", motion: "hop-right", seconds: 12 },
      { name: "Chick says hello", visual: "chick", audio: "chirps", spot: "bottom-left", size: "small", motion: "peek", seconds: 9 },
      { name: "Butterflies", visual: "butterflies", audio: "chirps", spot: "overlay", size: "large", seconds: 15 },
    ],
  },
  {
    id: "valentines-starter",
    name: "Valentine's starter",
    theme: "valentines",
    description: "Hearts floating up over the film and Cupid flying past.",
    clips: [
      ["hearts", "Floating hearts", "image/svg+xml", pictures.hearts],
      ["cupid", "Cupid", "image/svg+xml", pictures.cupid],
      ["musicbox", "Music box", "audio/wav", sounds.musicBox],
      ["harp", "Harp", "audio/wav", sounds.harp],
    ],
    mixes: [
      { name: "Hearts", visual: "hearts", audio: "musicbox", spot: "overlay", size: "large", seconds: 15 },
      { name: "Cupid flies by", visual: "cupid", audio: "harp", spot: "top", size: "small", motion: "fly-left", seconds: 12 },
    ],
  },
  {
    id: "birthday-starter",
    name: "Birthday starter",
    theme: "birthday",
    description: "Balloons floating up to Happy Birthday, a banner dropping in and confetti. Pick Birthday as the occasion on the day.",
    clips: [
      ["balloons", "Balloons", "image/svg+xml", pictures.balloons],
      ["banner", "Happy Birthday banner", "image/svg+xml", pictures.banner],
      ["confetti", "Confetti", "image/svg+xml", pictures.confetti],
      ["song", "Happy Birthday", "audio/wav", sounds.happyBirthday],
      ["horn", "Party horn", "audio/wav", sounds.partyHorn],
    ],
    mixes: [
      { name: "Balloons", visual: "balloons", audio: "song", spot: "bottom-right", size: "medium", motion: "rise", seconds: 12 },
      { name: "Happy Birthday banner", visual: "banner", audio: "horn", spot: "top", size: "small", motion: "drop", seconds: 9 },
      { name: "Confetti", visual: "confetti", audio: "horn", spot: "overlay", size: "large", seconds: 10 },
    ],
  },
  {
    id: "halloween-starter",
    name: "Halloween starter",
    theme: "halloween",
    description: "A ghost drifting across, a spider dropping in and a swarm of bats. Spooky rather than a jump scare.",
    clips: [
      ["ghost", "Ghost", "image/svg+xml", pictures.ghost],
      ["spider", "Spider", "image/svg+xml", pictures.spider],
      ["bats", "Bats", "image/svg+xml", pictures.bats],
      ["wooo", "Ghostly wail", "audio/wav", sounds.ghost],
      ["creep", "Creeping", "audio/wav", sounds.creep],
      ["squeaks", "Bat squeaks", "audio/wav", sounds.bats],
    ],
    mixes: [
      { name: "Ghost drifts by", visual: "ghost", audio: "wooo", spot: "center", size: "medium", motion: "fly-left", seconds: 12 },
      { name: "Spider drops in", visual: "spider", audio: "creep", spot: "top-right", size: "medium", motion: "drop", seconds: 8 },
      { name: "Bats", visual: "bats", audio: "squeaks", spot: "overlay", size: "large", seconds: 12 },
    ],
  },
];

await mkdir(out, { recursive: true });
for (const p of packs) {
  const clips = p.clips.map(([key, name, type, make]) => {
    const data = typeof make === "function" ? wav(make()) : Buffer.from(make);
    return { key, name, type, data: data.toString("base64") };
  });
  const file = { format: "ultimatetv.clips", version: 1, id: p.id, name: p.name, theme: p.theme, description: p.description, author: "UltimateTV", createdAt: "2026-10-29T00:00:00.000Z", clips, mixes: p.mixes };
  const json = JSON.stringify(file);
  await writeFile(path.join(out, `${p.id}.utvpack`), json);
  console.log(`  ${p.id}.utvpack  ${(json.length / 1024).toFixed(0)} KB`);
}
// Each picture on its own too, for looking at while drawing them.
if (process.argv.includes("--svgs")) {
  const dir = path.join(process.argv[process.argv.indexOf("--svgs") + 1] ?? "svgs");
  await mkdir(dir, { recursive: true });
  for (const [name, s] of Object.entries(pictures)) await writeFile(path.join(dir, `${name}.svg`), s);
}
