// The picture screensavers: landscapes and modern art, made as SVG from a seed so there's a new
// one every time and they're sharp at any resolution. Each is 1920×1080.

const W = 1920;
const H = 1080;

/** A small seeded random generator (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
  };
}
type Rng = ReturnType<typeof seeded>;

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, shift: number) => (p >> shift) & 255;
  const c = (shift: number) => Math.round(ch(pa, shift) + (ch(pb, shift) - ch(pa, shift)) * t);
  return `#${((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1)}`;
}

const path = (pts: [number, number][]) => `M0 ${H} ${pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${W} ${H} Z`;

/** A smooth line through points (Catmull-Rom as cubic Béziers), closed along the bottom. */
function smoothPath(pts: [number, number][]): string {
  let d = `M0 ${H} L${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d} L${W} ${H} Z`;
}

function ridge(r: Rng, y: number, amp: number, roughness: number, steps = 7): [number, number][] {
  let pts: [number, number][] = [
    [0, y + r.range(-amp, amp) / 2],
    [W, y + r.range(-amp, amp) / 2],
  ];
  let a = amp;
  for (let s = 0; s < steps; s++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      next.push([x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 + r.range(-a, a)]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
    a *= roughness;
  }
  return pts;
}

function waves(r: Rng, y: number, amp: number, n = 24): [number, number][] {
  const f1 = r.range(1, 3);
  const f2 = r.range(3, 7);
  const p1 = r.range(0, 6);
  const p2 = r.range(0, 6);
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    return [u * W, y + Math.sin(u * f1 * Math.PI + p1) * amp + Math.sin(u * f2 * Math.PI + p2) * amp * 0.35] as [number, number];
  });
}

const svg = (body: string, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;

export const svgUrl = (markup: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

// ---------------------------------------------------------------------------
// Landscapes

interface TimeOfDay {
  sky: [string, string, string];
  sun: string;
  /** How high the sun (or moon) is, as a fraction of the height. */
  sunY: number;
  far: string;
  near: string;
  night?: boolean;
  clouds: string;
}

const TIMES: TimeOfDay[] = [
  { sky: ["#2b3a67", "#a77fa6", "#f7c59f"], sun: "#ffe6c4", sunY: 0.6, far: "#a594b5", near: "#2b2440", clouds: "#f3c6c0" },
  { sky: ["#2f6fc8", "#79aee6", "#d9eeff"], sun: "#fffbe6", sunY: 0.18, far: "#93b5d3", near: "#22402c", clouds: "#ffffff" },
  { sky: ["#3d5a99", "#f2a65a", "#ffd89b"], sun: "#fff1c2", sunY: 0.52, far: "#c99474", near: "#3a2418", clouds: "#ffd1a1" },
  { sky: ["#1b1035", "#7b2d63", "#f26b4f"], sun: "#ffb07a", sunY: 0.58, far: "#704070", near: "#140a1f", clouds: "#b44d6e" },
  { sky: ["#020617", "#0b1d3a", "#1e3a5f"], sun: "#f1f5ff", sunY: 0.2, far: "#22395a", near: "#040a14", night: true, clouds: "#2a3f63" },
];

function skyAndSun(r: Rng, t: TimeOfDay, horizon: number): { defs: string; body: string } {
  const sx = r.range(0.2, 0.8) * W;
  const sy = t.sunY * H;
  const sr = t.night ? 46 : r.range(55, 85);
  const defs = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${t.sky[0]}"/><stop offset="0.6" stop-color="${t.sky[1]}"/><stop offset="1" stop-color="${t.sky[2]}"/></linearGradient>
<radialGradient id="sunglow"><stop offset="0" stop-color="${t.sun}" stop-opacity="0.75"/><stop offset="1" stop-color="${t.sun}" stop-opacity="0"/></radialGradient>`;
  let body = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (t.night) {
    for (let i = 0; i < 260; i++) body += `<circle cx="${r.range(0, W).toFixed(0)}" cy="${r.range(0, horizon * 0.85).toFixed(0)}" r="${r.range(0.6, 2).toFixed(1)}" fill="#fff" opacity="${r.range(0.3, 1).toFixed(2)}"/>`;
  }
  body += `<circle cx="${sx}" cy="${sy}" r="${sr * 5}" fill="url(#sunglow)"/><circle cx="${sx}" cy="${sy}" r="${sr}" fill="${t.sun}"/>`;
  const clouds = t.night ? 2 : Math.floor(r.range(2, 7));
  for (let i = 0; i < clouds; i++) {
    const cx = r.range(0, W);
    const cy = r.range(H * 0.08, horizon * 0.7);
    const s = r.range(0.6, 1.4);
    let puff = "";
    for (let j = 0; j < 6; j++) puff += `<ellipse cx="${(cx + (j - 2.5) * 55 * s).toFixed(0)}" cy="${(cy + r.range(-18, 10) * s).toFixed(0)}" rx="${(r.range(60, 110) * s).toFixed(0)}" ry="${(r.range(22, 40) * s).toFixed(0)}"/>`;
    body += `<g fill="${t.clouds}" opacity="${r.range(0.35, 0.7).toFixed(2)}">${puff}</g>`;
  }
  return { defs, body };
}

export function landscape(seed: number): string {
  const r = seeded(seed);
  const t = r.pick(TIMES);
  const kind = r.pick(["mountains", "mountains", "lake", "dunes", "hills", "coast"] as const);
  const horizon = H * (kind === "coast" || kind === "lake" ? 0.62 : 0.7);
  const { defs, body: sky } = skyAndSun(r, t, horizon);
  let body = sky;
  // Water, with the sun's light broken up on it: under the cliffs of a coast, over a lake's shore.
  let water = "";
  if (kind === "coast" || kind === "lake") {
    const top = mix(t.sky[2], t.near, kind === "lake" ? 0.55 : 0.4);
    const deep = mix(t.near, "#000000", 0.3);
    water = `<defs><linearGradient id="sea" x1="0" y1="${horizon}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs><rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#sea)"/>`;
    for (let i = 0; i < 70; i++) {
      const y = r.range(horizon + 6, H);
      const v = (y - horizon) / (H - horizon);
      water += `<rect x="${r.range(0, W).toFixed(0)}" y="${y.toFixed(0)}" width="${(r.range(20, 90) * (0.4 + v)).toFixed(0)}" height="${(1.5 + v * 2).toFixed(1)}" fill="${t.sun}" opacity="${(r.range(0.1, 0.35) * (1 - v * 0.6)).toFixed(2)}"/>`;
    }
  }
  if (kind === "coast") body += water;
  const layers = kind === "coast" ? 2 : 5;
  const hazeTop = mix(t.sky[2], t.far, 0.55);
  const left = r.next() < 0.5;
  for (let i = 0; i < layers; i++) {
    const u = i / Math.max(1, layers - 1);
    let colour = mix(hazeTop, t.near, u * u * 0.85 + u * 0.15);
    const y = kind === "lake" ? horizon - (layers - i) * 38 : horizon - 180 + i * (H - horizon + 120) / layers;
    let d: string;
    if (kind === "dunes") {
      colour = mix(colour, mix("#e8b46a", "#7a4a1e", u), 0.55);
      d = smoothPath(waves(r, y + 60, 40 + i * 12, 10));
    } else if (kind === "hills") {
      colour = mix(colour, mix("#7fa05a", "#1d3a1a", u), t.night ? 0.15 : 0.45);
      d = smoothPath(waves(r, y + 40, 30 + i * 14, 12));
    } else if (kind === "coast") {
      // Cliffs on one side running down into the sea.
      const pts = ridge(r, horizon - 120 + i * 60, 90, 0.55, 6).map(([x, yy]) => {
        const v = left ? x / W : 1 - x / W;
        return [x, v < 0.35 ? yy : yy + (v - 0.35) * H * 2.2] as [number, number];
      });
      d = path(pts);
    } else d = path(ridge(r, y, 160 - i * 22, 0.55));
    body += `<path d="${d}" fill="${colour}"/>`;
    // Trees on the nearest hills.
    if (kind === "hills" && i >= layers - 2) {
      for (let j = 0; j < 14; j++) {
        const x = r.range(0, W);
        const ty = y + 70 + r.range(0, 120);
        const sz = r.range(18, 34) * (i === layers - 1 ? 1.4 : 1);
        body += `<path d="M${x - sz} ${ty} L${x} ${ty - sz * 3} L${x + sz} ${ty} Z" fill="${mix(colour, "#000000", 0.35)}"/>`;
      }
    }
  }
  if (kind === "lake") body += water;
  if (!t.night && r.next() < 0.6) {
    for (let i = 0; i < 4; i++) {
      const x = r.range(W * 0.2, W * 0.8);
      const y = r.range(H * 0.15, H * 0.4);
      const s = r.range(8, 16);
      body += `<path d="M${x - s} ${y - s * 0.4} Q${x - s * 0.4} ${y - s * 0.5} ${x} ${y} Q${x + s * 0.4} ${y - s * 0.5} ${x + s} ${y - s * 0.4}" stroke="${mix(t.near, "#000000", 0.5)}" stroke-width="2.5" fill="none"/>`;
    }
  }
  return svg(body, defs);
}

// ---------------------------------------------------------------------------
// Modern art

const PALETTES: string[][] = [
  ["#f4f1de", "#e07a5f", "#3d405b", "#81b29a", "#f2cc8f"],
  ["#fefae0", "#283618", "#606c38", "#dda15e", "#bc6c25"],
  ["#f1faee", "#e63946", "#a8dadc", "#457b9d", "#1d3557"],
  ["#fff8f0", "#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"],
  ["#0b132b", "#1c2541", "#3a506b", "#5bc0be", "#ffd166"],
  ["#22223b", "#4a4e69", "#9a8c98", "#c9ada7", "#f2e9e4"],
  ["#ffcdb2", "#ffb4a2", "#e5989b", "#b5838d", "#6d6875"],
  ["#03071e", "#6a040f", "#d00000", "#e85d04", "#faa307"],
  ["#f8f9fa", "#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#073b4c"],
];

function bauhaus(r: Rng, pal: string[]): string {
  const cell = 270;
  let body = "";
  const others = (bg: string) => pal.filter((c) => c !== bg);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < Math.ceil(W / cell); col++) {
      const x = col * cell;
      const y = row * cell;
      const bg = r.pick(pal);
      const fg = r.pick(others(bg));
      const fg2 = r.pick(others(bg));
      body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${bg}"/>`;
      const c = cell / 2;
      const rot = Math.floor(r.range(0, 4)) * 90;
      const g = (inner: string) => `<g transform="translate(${x + c} ${y + c}) rotate(${rot})">${inner}</g>`;
      switch (Math.floor(r.range(0, 7))) {
        case 0:
          body += g(`<circle r="${c * 0.8}" fill="${fg}"/>`);
          break;
        case 1:
          body += g(`<path d="M${-c} ${c} A${c} ${c} 0 0 1 ${c} ${c} Z" fill="${fg}"/>`);
          break;
        case 2:
          body += g(`<path d="M${-c} ${-c} L${c} ${-c} A${c * 2} ${c * 2} 0 0 1 ${-c} ${c} Z" fill="${fg}"/>`);
          break;
        case 3:
          body += g(`<path d="M${-c} ${c} L${c} ${c} L${-c} ${-c} Z" fill="${fg}"/>`);
          break;
        case 4:
          body += g(`<rect x="${-c}" y="${-c}" width="${cell}" height="${c * 0.5}" fill="${fg}"/><rect x="${-c}" y="${-c * 0.25}" width="${cell}" height="${c * 0.5}" fill="${fg2}"/>`);
          break;
        case 5:
          body += g(`<circle r="${c * 0.8}" fill="${fg}"/><circle r="${c * 0.4}" fill="${fg2}"/>`);
          break;
        default:
          body += g(`<path d="M${-c} ${-c} A${c} ${c} 0 0 0 ${c} ${-c} Z" fill="${fg}"/><path d="M${-c} ${c} A${c} ${c} 0 0 1 ${c} ${c} Z" fill="${fg2}"/>`);
      }
    }
  }
  return svg(body);
}

function blobs(r: Rng, pal: string[]): string {
  let body = `<rect width="${W}" height="${H}" fill="${pal[0]}"/><g filter="url(#soft)">`;
  for (let i = 0; i < 8; i++) body += `<circle cx="${r.range(-100, W + 100).toFixed(0)}" cy="${r.range(-100, H + 100).toFixed(0)}" r="${r.range(220, 560).toFixed(0)}" fill="${r.pick(pal.slice(1))}" opacity="${r.range(0.6, 1).toFixed(2)}"/>`;
  body += "</g>";
  return svg(body, `<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="130"/></filter>`);
}

function paperWaves(r: Rng, pal: string[]): string {
  const bands = 7;
  let body = `<rect width="${W}" height="${H}" fill="${pal[0]}"/>`;
  const order = [...pal.slice(1)].sort(() => r.next() - 0.5);
  for (let i = 0; i < bands; i++) {
    const y = H * 0.12 + (i * H * 0.85) / bands;
    body += `<path d="${smoothPath(waves(r, y, r.range(30, 70), 16))}" fill="${order[i % order.length]}" filter="url(#lift)"/>`;
  }
  return svg(body, `<filter id="lift" x="-10%" y="-20%" width="120%" height="140%"><feDropShadow dx="0" dy="-8" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/></filter>`);
}

function rings(r: Rng, pal: string[]): string {
  const cx = r.pick([0, W * 0.5, W]);
  const cy = H;
  let body = `<rect width="${W}" height="${H}" fill="${pal[0]}"/>`;
  const step = r.range(70, 120);
  for (let i = 14; i >= 1; i--) body += `<circle cx="${cx}" cy="${cy}" r="${(i * step).toFixed(0)}" fill="${pal[1 + (i % (pal.length - 1))]}"/>`;
  body += `<circle cx="${r.range(W * 0.2, W * 0.8).toFixed(0)}" cy="${r.range(H * 0.15, H * 0.35).toFixed(0)}" r="${r.range(70, 130).toFixed(0)}" fill="${r.pick(pal.slice(1))}"/>`;
  return svg(body);
}

export function artwork(seed: number): string {
  const r = seeded(seed);
  const pal = r.pick(PALETTES);
  return r.pick([bauhaus, blobs, paperWaves, rings])(r, pal);
}
