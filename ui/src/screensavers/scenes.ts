// The moving screensavers, drawn live on a canvas so they loop forever at any resolution with
// nothing to download. Each scene paints its still parts once (offscreen) and only the moving
// parts each frame.

/** Draws one frame: `t` seconds since the scene started, `dt` since the last frame. */
export type Frame = (t: number, dt: number) => void;
export type SceneFactory = (ctx: CanvasRenderingContext2D, w: number, h: number, opts: { name: string }) => Frame;

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/** A canvas drawn once, for the parts of a scene that don't move. */
function layer(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  draw(canvas.getContext("2d")!);
  return canvas;
}

/** A soft round light, for flames, glows and fairy lights: drawn once, stamped many times. */
function glow(stops: [number, string][], size = 128): HTMLCanvasElement {
  return layer(size, size, (c) => {
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, colour] of stops) g.addColorStop(at, colour);
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
  });
}

function stamp(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, size: number, alpha = 1): void {
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

function vertical(c: CanvasRenderingContext2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

/** A jagged ridge line by midpoint displacement: x from 0 to w, around `y`. */
function ridge(w: number, y: number, amp: number, roughness = 0.55, steps = 7): [number, number][] {
  let pts: [number, number][] = [
    [0, y + rand(-amp, amp) / 2],
    [w, y + rand(-amp, amp) / 2],
  ];
  let a = amp;
  for (let s = 0; s < steps; s++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      next.push([x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 + rand(-a, a)]);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
    a *= roughness;
  }
  return pts;
}

function fillBelow(c: CanvasRenderingContext2D, pts: [number, number][], h: number, fill: string | CanvasGradient): void {
  c.beginPath();
  c.moveTo(0, h);
  for (const [x, y] of pts) c.lineTo(x, y);
  c.lineTo(pts[pts.length - 1]![0], h);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

function starField(c: CanvasRenderingContext2D, w: number, h: number, n: number, maxY: number): void {
  for (let i = 0; i < n; i++) {
    c.globalAlpha = rand(0.2, 0.9);
    c.fillStyle = pick(["#ffffff", "#dfe8ff", "#fff3d6"]);
    const r = Math.random() < 0.08 ? rand(1.2, 1.8) : rand(0.4, 1.1);
    c.beginPath();
    c.arc(rand(0, w), rand(0, maxY), r * (h / 1080), 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

/** Snow falling in three depths, drifting side to side. */
function snowfall(w: number, h: number, count: number) {
  const flakes = Array.from({ length: count }, () => {
    const depth = Math.random();
    return { x: rand(0, w), y: rand(0, h), r: (0.8 + depth * 2.6) * (h / 1080), speed: (25 + depth * 70) * (h / 1080), sway: rand(0, TAU), a: 0.35 + depth * 0.6 };
  });
  return (ctx: CanvasRenderingContext2D, t: number, dt: number) => {
    ctx.fillStyle = "#ffffff";
    for (const f of flakes) {
      f.y += f.speed * dt;
      f.x += Math.sin(t * 0.6 + f.sway) * f.r * 8 * dt;
      if (f.y > h + 5) {
        f.y = -5;
        f.x = rand(0, w);
      }
      ctx.globalAlpha = f.a;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
}

// ---------------------------------------------------------------------------

const aurora: SceneFactory = (ctx, w, h) => {
  const sky = layer(w, h, (c) => {
    c.fillStyle = vertical(c, 0, h, [
      [0, "#01030a"],
      [0.55, "#041628"],
      [1, "#0b2a3a"],
    ]);
    c.fillRect(0, 0, w, h);
    starField(c, w, h, 420, h * 0.75);
  });
  const land = layer(w, h, (c) => {
    const far = ridge(w, h * 0.66, h * 0.16, 0.52);
    fillBelow(c, far, h, vertical(c, h * 0.5, h * 0.8, [
      [0, "#3c5a70"],
      [0.25, "#1b2f40"],
      [1, "#0b1622"],
    ]));
    fillBelow(c, ridge(w, h * 0.78, h * 0.08, 0.5), h, "#060c14");
    // A still lake catching a little of the sky.
    c.fillStyle = vertical(c, h * 0.86, h, [
      [0, "#0c2230"],
      [1, "#02060b"],
    ]);
    c.fillRect(0, h * 0.86, w, h * 0.14);
    c.fillStyle = "#060c14";
    fillBelow(c, ridge(w, h * 0.865, h * 0.01, 0.5, 6), h * 0.875, "#060c14");
  });
  const twinkles = Array.from({ length: 60 }, () => ({ x: rand(0, w), y: rand(0, h * 0.6), p: rand(0, TAU), s: rand(0.5, 2) }));
  const bands = [
    { y: 0.42, amp: 0.07, speed: 0.13, offset: 0, low: "120,255,170", high: "90,220,160", strength: 1 },
    { y: 0.34, amp: 0.05, speed: -0.09, offset: 2, low: "80,255,200", high: "120,90,230", strength: 0.75 },
    { y: 0.5, amp: 0.05, speed: 0.07, offset: 4, low: "160,255,140", high: "200,80,180", strength: 0.55 },
  ].map((b) => {
    const g = ctx.createLinearGradient(0, 0, 0, 1);
    g.addColorStop(0, `rgba(${b.high},0)`);
    g.addColorStop(0.55, `rgba(${b.high},0.25)`);
    g.addColorStop(0.9, `rgba(${b.low},0.85)`);
    g.addColorStop(1, `rgba(${b.low},0)`);
    return { ...b, g };
  });
  const step = Math.max(3, Math.round(w / 480));
  return (t) => {
    ctx.drawImage(sky, 0, 0);
    ctx.fillStyle = "#ffffff";
    for (const s of twinkles) {
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * s.s + s.p));
      ctx.fillRect(s.x, s.y, 1.6, 1.6);
    }
    ctx.globalCompositeOperation = "lighter";
    for (const b of bands) {
      ctx.fillStyle = b.g;
      for (let x = 0; x < w; x += step) {
        const u = x / w;
        const y = h * b.y + Math.sin(u * 7.5 + t * b.speed * 2 + b.offset) * h * b.amp + Math.sin(u * 23 - t * 0.35 + b.offset) * h * 0.018;
        const len = h * (0.16 + 0.14 * (0.5 + 0.5 * Math.sin(u * 13 + t * 0.3 + b.offset)));
        const edge = Math.sin(Math.min(1, Math.max(0, (u - 0.02) / 0.96)) * Math.PI);
        ctx.globalAlpha = b.strength * edge * (0.25 + 0.6 * (0.5 + 0.5 * Math.sin(u * 40 + t * 0.9 + b.offset * 3)));
        ctx.setTransform(1, 0, 0, len, x, y - len);
        ctx.fillRect(0, 0, step + 1, 1);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(land, 0, 0);
  };
};

const fireplace: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const cx = w / 2;
  const base = h * 0.74;
  const back = layer(w, h, (c) => {
    c.fillStyle = "#0d0504";
    c.fillRect(0, 0, w, h);
    // Soot-dark brick at the back of the fireplace.
    const bw = 150 * k;
    const bh = 54 * k;
    for (let row = 0; row * bh < h * 0.86; row++) {
      for (let x = (row % 2) * -bw / 2; x < w; x += bw) {
        c.fillStyle = `hsl(${rand(8, 18)}, ${rand(35, 55)}%, ${rand(7, 12)}%)`;
        c.fillRect(x + 3 * k, row * bh + 3 * k, bw - 6 * k, bh - 6 * k);
      }
    }
    c.fillStyle = vertical(c, 0, h, [
      [0, "rgba(0,0,0,0.85)"],
      [0.5, "rgba(0,0,0,0.35)"],
      [0.86, "rgba(0,0,0,0.2)"],
    ]);
    c.fillRect(0, 0, w, h);
    // The hearth.
    c.fillStyle = vertical(c, h * 0.86, h, [
      [0, "#2b2420"],
      [1, "#120e0c"],
    ]);
    c.fillRect(0, h * 0.86, w, h * 0.14);
    c.fillStyle = "#3a312b";
    c.fillRect(0, h * 0.86, w, 5 * k);
  });
  const logs = layer(w, h, (c) => {
    const log = (x: number, y: number, len: number, r: number, angle: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.fillStyle = vertical(c, -r, r, [
        [0, "#4a2f1d"],
        [0.5, "#2a170d"],
        [1, "#120804"],
      ]);
      c.beginPath();
      c.roundRect(-len / 2, -r, len, r * 2, r);
      c.fill();
      // Bark lines and a glowing, charred end.
      c.strokeStyle = "rgba(0,0,0,0.35)";
      c.lineWidth = 3 * k;
      for (let i = 0; i < 6; i++) {
        c.beginPath();
        const yy = rand(-r * 0.7, r * 0.7);
        c.moveTo(-len / 2 + rand(0, len * 0.2), yy);
        c.lineTo(len / 2 - rand(0, len * 0.2), yy + rand(-4, 4) * k);
        c.stroke();
      }
      c.fillStyle = "#6b4a33";
      c.beginPath();
      c.ellipse(len / 2 - r * 0.2, 0, r * 0.45, r * 0.95, 0, 0, TAU);
      c.fill();
      c.strokeStyle = "#4a3020";
      for (let ring = 0.3; ring < 0.95; ring += 0.22) {
        c.beginPath();
        c.ellipse(len / 2 - r * 0.2, 0, r * 0.45 * ring, r * 0.95 * ring, 0, 0, TAU);
        c.stroke();
      }
      c.restore();
    };
    log(cx - 60 * k, base + 70 * k, 620 * k, 46 * k, 0.06);
    log(cx + 80 * k, base + 82 * k, 560 * k, 42 * k, -0.08);
    log(cx, base + 30 * k, 480 * k, 38 * k, 0.02);
  });
  const young = glow([
    [0, "rgba(255,250,220,1)"],
    [0.25, "rgba(255,200,90,0.8)"],
    [0.6, "rgba(255,120,30,0.25)"],
    [1, "rgba(255,80,0,0)"],
  ]);
  const old = glow([
    [0, "rgba(255,120,40,0.7)"],
    [0.5, "rgba(200,50,10,0.25)"],
    [1, "rgba(120,20,0,0)"],
  ]);
  const bed = glow([
    [0, "rgba(255,140,40,0.9)"],
    [0.6, "rgba(200,60,10,0.3)"],
    [1, "rgba(120,20,0,0)"],
  ]);
  type P = { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number; seed: number };
  const flames: P[] = [];
  const sparks: P[] = [];
  let carry = 0;
  return (t, dt) => {
    ctx.drawImage(back, 0, 0);
    const flicker = 0.8 + 0.12 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1);
    ctx.globalCompositeOperation = "lighter";
    stamp(ctx, bed, cx, base + 40 * k, w * 0.75, 0.35 * flicker);
    carry += dt * 260;
    while (carry > 1) {
      carry--;
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 300 * k;
      flames.push({ x: cx + spread, y: base + rand(0, 50) * k, vx: -spread * 0.25, vy: -rand(110, 240) * k, life: rand(0.7, 1.5) * (1 - Math.abs(spread) / (600 * k)), age: 0, size: rand(70, 140) * k, seed: rand(0, TAU) });
    }
    if (Math.random() < dt * 4) sparks.push({ x: cx + rand(-200, 200) * k, y: base, vx: rand(-30, 30) * k, vy: -rand(150, 320) * k, life: rand(1.5, 3), age: 0, size: rand(3, 6) * k, seed: rand(0, TAU) });
    for (let i = flames.length - 1; i >= 0; i--) {
      const p = flames[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        flames.splice(i, 1);
        continue;
      }
      const f = p.age / p.life;
      p.x += (p.vx * 0.4 + Math.sin(t * 3 + p.seed) * 25 * k) * dt;
      p.y += p.vy * dt;
      const size = p.size * (1 - f * 0.7);
      stamp(ctx, young, p.x, p.y, size, (1 - f) * (1 - f) * 0.55);
      stamp(ctx, old, p.x, p.y - size * 0.2, size * 1.3, f * (1 - f) * 0.9);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        sparks.splice(i, 1);
        continue;
      }
      p.x += (p.vx + Math.sin(t * 4 + p.seed) * 40 * k) * dt;
      p.y += p.vy * dt;
      stamp(ctx, young, p.x, p.y, p.size * 4, 1 - p.age / p.life);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(logs, 0, 0);
    // Embers in the cracks, and the fire's light thrown on the room.
    ctx.globalCompositeOperation = "lighter";
    stamp(ctx, old, cx, base + 75 * k, 700 * k, 0.25 * flicker);
    stamp(ctx, old, cx, h * 0.9, w * 1.1, 0.12 * flicker);
    ctx.globalCompositeOperation = "source-over";
  };
};

const aquarium: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const sandY = h * 0.84;
  const back = layer(w, h, (c) => {
    c.fillStyle = vertical(c, 0, h, [
      [0, "#1478a8"],
      [0.5, "#0a4a78"],
      [1, "#062640"],
    ]);
    c.fillRect(0, 0, w, h);
    const pts: [number, number][] = [];
    for (let x = 0; x <= w; x += 20) pts.push([x, sandY + Math.sin(x * 0.004) * 18 * k + Math.sin(x * 0.013) * 8 * k]);
    fillBelow(c, pts, h, vertical(c, sandY - 20 * k, h, [
      [0, "#d8c493"],
      [1, "#8b7650"],
    ]));
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(${pick(["90,70,40", "255,245,220", "120,100,70"])},0.35)`;
      c.fillRect(rand(0, w), rand(sandY + 10 * k, h), 3 * k, 3 * k);
    }
    for (let i = 0; i < 6; i++) {
      const x = rand(0, w);
      const r = rand(40, 110) * k;
      c.fillStyle = vertical(c, sandY - r, sandY + r * 0.4, [
        [0, "#7d8a91"],
        [1, "#3a4448"],
      ]);
      c.beginPath();
      c.ellipse(x, sandY + 10 * k, r * 1.4, r * 0.7, 0, Math.PI, TAU);
      c.fill();
    }
  });
  const rays = Array.from({ length: 6 }, (_, i) => ({ x: (i + 0.5) * (w / 6) + rand(-60, 60) * k, width: rand(80, 200) * k, p: rand(0, TAU) }));
  const weeds = Array.from({ length: 16 }, () => ({ x: rand(0, w), height: rand(160, 380) * k, p: rand(0, TAU), colour: pick(["#2f8f4e", "#3fa45a", "#24703c", "#5aa83a"]), width: rand(8, 16) * k }));
  const FISH = [
    { body: "#ff7a1a", tail: "#ff7a1a", stripes: "#ffffff" },
    { body: "#2c6cf5", tail: "#ffd23a", stripes: "" },
    { body: "#ffd23a", tail: "#ffc000", stripes: "" },
    { body: "#e8e8f0", tail: "#c0c0d0", stripes: "#202030" },
    { body: "#ff4f8b", tail: "#a64dff", stripes: "" },
    { body: "#2fd1c5", tail: "#1a8f88", stripes: "" },
  ];
  const fish = Array.from({ length: 14 }, () => ({
    x: rand(0, w),
    y: rand(h * 0.12, sandY - 80 * k),
    dir: Math.random() < 0.5 ? -1 : 1,
    speed: rand(40, 110) * k,
    size: rand(30, 70) * k,
    p: rand(0, TAU),
    ...pick(FISH),
  }));
  const bubbles: { x: number; y: number; r: number; p: number }[] = [];
  const vents = [w * 0.15, w * 0.62, w * 0.88];
  return (t, dt) => {
    ctx.drawImage(back, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const r of rays) {
      const sway = Math.sin(t * 0.2 + r.p) * 80 * k;
      ctx.globalAlpha = 0.05 + 0.03 * Math.sin(t * 0.5 + r.p);
      ctx.fillStyle = vertical(ctx, 0, h, [
        [0, "rgba(200,240,255,1)"],
        [1, "rgba(200,240,255,0)"],
      ]);
      ctx.beginPath();
      ctx.moveTo(r.x - r.width / 2, 0);
      ctx.lineTo(r.x + r.width / 2, 0);
      ctx.lineTo(r.x + sway + r.width * 1.6, h);
      ctx.lineTo(r.x + sway - r.width * 0.4, h);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    for (const wd of weeds) {
      ctx.strokeStyle = wd.colour;
      ctx.lineWidth = wd.width;
      ctx.beginPath();
      let x = wd.x;
      let y = sandY + 15 * k;
      ctx.moveTo(x, y);
      for (let s = 1; s <= 10; s++) {
        const angle = Math.sin(t * 0.8 + wd.p + s * 0.35) * 0.18 * (s / 10);
        x += Math.sin(angle) * wd.height / 10;
        y -= Math.cos(angle) * wd.height / 10;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (const f of fish) {
      f.x += f.dir * f.speed * dt;
      if (f.x < -f.size * 3 || f.x > w + f.size * 3) {
        f.dir = Math.random() < 0.5 ? -1 : 1;
        f.x = f.dir > 0 ? -f.size * 2.5 : w + f.size * 2.5;
        f.y = rand(h * 0.12, sandY - 80 * k);
      }
      const y = f.y + Math.sin(t * 0.7 + f.p) * 18 * k;
      const wag = Math.sin(t * 8 + f.p) * 0.35;
      ctx.save();
      ctx.translate(f.x, y);
      ctx.scale(f.dir, 1);
      const s = f.size;
      ctx.fillStyle = f.tail;
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, 0);
      ctx.lineTo(-s * 1.45, -s * (0.45 + wag * 0.3));
      ctx.lineTo(-s * 1.35, 0);
      ctx.lineTo(-s * 1.45, s * (0.45 - wag * 0.3));
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.35);
      ctx.quadraticCurveTo(0, -s * 0.8, s * 0.3, -s * 0.35);
      ctx.fill();
      ctx.fillStyle = f.body;
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.45, 0, 0, TAU);
      ctx.fill();
      if (f.stripes) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = f.stripes;
        for (const sx of [-0.45, 0.2]) ctx.fillRect(s * sx, -s, s * 0.16, s * 2);
        ctx.restore();
      }
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.ellipse(s * 0.1, -s * 0.15, s * 0.6, s * 0.14, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s * 0.6, -s * 0.08, s * 0.12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#101018";
      ctx.beginPath();
      ctx.arc(s * 0.63, -s * 0.08, s * 0.06, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    if (Math.random() < dt * 6) bubbles.push({ x: pick(vents) + rand(-10, 10) * k, y: sandY, r: rand(3, 9) * k, p: rand(0, TAU) });
    ctx.strokeStyle = "rgba(220,245,255,0.6)";
    ctx.lineWidth = 1.5 * k;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]!;
      b.y -= (60 + b.r * 12) * k * dt;
      if (b.y < -10) {
        bubbles.splice(i, 1);
        continue;
      }
      const x = b.x + Math.sin(t * 3 + b.p) * 6 * k;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(x - b.r * 0.4, b.y - b.r * 0.5, b.r * 0.35, b.r * 0.35);
    }
  };
};

const space: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const size = Math.hypot(w, h);
  const nebula = layer(size, size, (c) => {
    c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 26; i++) {
      const x = size / 2 + rand(-0.35, 0.35) * size;
      const y = size / 2 + rand(-0.25, 0.25) * size;
      const r = rand(0.08, 0.28) * size;
      const hue = pick([265, 285, 200, 320, 180, 230]);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${hue}, 80%, 55%, ${rand(0.05, 0.14)})`);
      g.addColorStop(1, `hsla(${hue}, 80%, 30%, 0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, size, size);
    }
    c.globalCompositeOperation = "source-over";
    starField(c, size, size, 900, size);
  });
  const planet = layer(360 * k, 360 * k, (c) => {
    const r = 120 * k;
    const m = 180 * k;
    const g = c.createRadialGradient(m - r * 0.4, m - r * 0.4, r * 0.1, m, m, r);
    g.addColorStop(0, "#f2c58f");
    g.addColorStop(0.6, "#b0683a");
    g.addColorStop(1, "#2a1308");
    c.fillStyle = g;
    c.beginPath();
    c.arc(m, m, r, 0, TAU);
    c.fill();
    c.strokeStyle = "rgba(240,210,170,0.55)";
    c.lineWidth = 9 * k;
    c.beginPath();
    c.ellipse(m, m, r * 1.6, r * 0.38, -0.35, 0.05 * Math.PI, 0.95 * Math.PI, true);
    c.stroke();
  });
  const stars = Array.from({ length: 700 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1) }));
  return (t, dt) => {
    ctx.fillStyle = "#02010a";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(t * 0.004);
    ctx.drawImage(nebula, -size / 2, -size / 2);
    ctx.restore();
    // Drifts right to left, off one side and on again at the other.
    const px = w + 50 - ((t * 4 * k + w * 0.3) % (w + 450 * k));
    ctx.drawImage(planet, px, h * 0.58);
    ctx.fillStyle = "#ffffff";
    for (const s of stars) {
      s.z -= dt * 0.035;
      const sx = w / 2 + (s.x / s.z) * w * 0.5;
      const sy = h / 2 + (s.y / s.z) * w * 0.5;
      if (s.z < 0.02 || sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) {
        s.x = rand(-1, 1);
        s.y = rand(-1, 1);
        s.z = 1;
        continue;
      }
      const r = (1 - s.z) * 2.6 * k + 0.3;
      ctx.globalAlpha = Math.min(1, (1 - s.z) * 1.4);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
};

const snow: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const cabin = { x: w * 0.3, y: h * 0.74 };
  const back = layer(w, h, (c) => {
    c.fillStyle = vertical(c, 0, h, [
      [0, "#070d24"],
      [0.6, "#1d2b57"],
      [1, "#33467a"],
    ]);
    c.fillRect(0, 0, w, h);
    starField(c, w, h, 260, h * 0.6);
    const moon = { x: w * 0.78, y: h * 0.2, r: 70 * k };
    const halo = c.createRadialGradient(moon.x, moon.y, moon.r, moon.x, moon.y, moon.r * 5);
    halo.addColorStop(0, "rgba(220,230,255,0.35)");
    halo.addColorStop(1, "rgba(220,230,255,0)");
    c.fillStyle = halo;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#f4f6ff";
    c.beginPath();
    c.arc(moon.x, moon.y, moon.r, 0, TAU);
    c.fill();
    c.fillStyle = "rgba(160,170,200,0.35)";
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.35, 0.12]] as const) {
      c.beginPath();
      c.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, r * moon.r, 0, TAU);
      c.fill();
    }
    fillBelow(c, ridge(w, h * 0.6, h * 0.12, 0.5), h, "#5a6c9c");
    const tree = (x: number, y: number, s: number, colour: string) => {
      c.fillStyle = colour;
      for (let i = 0; i < 4; i++) {
        const ty = y - i * s * 0.55;
        const tw = s * (0.8 - i * 0.16);
        c.beginPath();
        c.moveTo(x - tw, ty);
        c.lineTo(x, ty - s * 0.9);
        c.lineTo(x + tw, ty);
        c.fill();
      }
      c.fillStyle = "rgba(235,242,255,0.8)";
      for (let i = 0; i < 4; i++) {
        const ty = y - i * s * 0.55;
        const tw = s * (0.8 - i * 0.16);
        c.beginPath();
        c.moveTo(x - tw * 0.7, ty - s * 0.12);
        c.lineTo(x, ty - s * 0.6);
        c.lineTo(x + tw * 0.5, ty - s * 0.18);
        c.lineTo(x, ty - s * 0.45);
        c.fill();
      }
    };
    for (let i = 0; i < 30; i++) tree(rand(0, w), h * rand(0.62, 0.7), rand(30, 50) * k, "#1d2a4c");
    const hill: [number, number][] = [];
    for (let x = 0; x <= w; x += 20) hill.push([x, h * 0.76 + Math.sin(x / w * 3 + 1) * h * 0.04]);
    fillBelow(c, hill, h, vertical(c, h * 0.7, h, [
      [0, "#dfe8fb"],
      [1, "#8a9ccc"],
    ]));
    for (const x of [0.08, 0.14, 0.5, 0.58, 0.9, 0.95]) tree(w * x, h * (0.8 + Math.random() * 0.04), rand(70, 110) * k, "#12203f");
    // The log cabin.
    const { x, y } = cabin;
    const cw = 300 * k;
    const ch = 170 * k;
    c.fillStyle = "#3b2418";
    c.fillRect(x - cw / 2, y - ch, cw, ch);
    c.strokeStyle = "#24140c";
    c.lineWidth = 4 * k;
    for (let yy = y - ch + 20 * k; yy < y; yy += 24 * k) {
      c.beginPath();
      c.moveTo(x - cw / 2, yy);
      c.lineTo(x + cw / 2, yy);
      c.stroke();
    }
    c.fillStyle = "#2a1a12";
    c.fillRect(x + cw * 0.22, y - ch - 120 * k, 40 * k, 90 * k);
    c.fillStyle = "#f2f6ff";
    c.beginPath();
    c.moveTo(x - cw / 2 - 40 * k, y - ch + 8 * k);
    c.lineTo(x, y - ch - 110 * k);
    c.lineTo(x + cw / 2 + 40 * k, y - ch + 8 * k);
    c.closePath();
    c.fill();
    c.fillStyle = "#1a0f0a";
    c.fillRect(x - 25 * k, y - 95 * k, 50 * k, 95 * k);
    c.fillStyle = "#f2f6ff";
    c.beginPath();
    c.ellipse(x, y + 4 * k, cw * 0.75, 18 * k, 0, 0, TAU);
    c.fill();
  });
  const windows = [
    { x: cabin.x - 95 * k, y: cabin.y - 110 * k },
    { x: cabin.x + 70 * k, y: cabin.y - 110 * k },
  ];
  const warm = glow([
    [0, "rgba(255,200,100,0.7)"],
    [1, "rgba(255,150,50,0)"],
  ]);
  const smoke: { x: number; y: number; age: number; p: number }[] = [];
  const flakes = snowfall(w, h, 380);
  return (t, dt) => {
    ctx.drawImage(back, 0, 0);
    const f = 0.85 + 0.1 * Math.sin(t * 5) + 0.05 * Math.sin(t * 11);
    for (const win of windows) {
      ctx.fillStyle = `rgba(255,${190 + 20 * f},${90 + 30 * f},1)`;
      ctx.fillRect(win.x, win.y, 50 * k, 44 * k);
      ctx.fillStyle = "#3b2418";
      ctx.fillRect(win.x + 23 * k, win.y, 4 * k, 44 * k);
      ctx.fillRect(win.x, win.y + 20 * k, 50 * k, 4 * k);
      ctx.globalCompositeOperation = "lighter";
      stamp(ctx, warm, win.x + 25 * k, win.y + 22 * k, 260 * k, 0.5 * f);
      ctx.globalCompositeOperation = "source-over";
    }
    if (Math.random() < dt * 3) smoke.push({ x: cabin.x + 85 * k, y: cabin.y - 300 * k, age: 0, p: rand(0, TAU) });
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i]!;
      s.age += dt;
      if (s.age > 8) {
        smoke.splice(i, 1);
        continue;
      }
      s.y -= 25 * k * dt;
      s.x += (12 + Math.sin(t + s.p) * 6) * k * dt;
      ctx.fillStyle = `rgba(200,210,230,${0.12 * (1 - s.age / 8)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, (14 + s.age * 9) * k, 0, TAU);
      ctx.fill();
    }
    flakes(ctx, t, dt);
  };
};

const rain: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const city = layer(w, h, (c) => {
    c.fillStyle = vertical(c, 0, h, [
      [0, "#06080f"],
      [1, "#141a2a"],
    ]);
    c.fillRect(0, 0, w, h);
    c.filter = `blur(${Math.round(22 * k)}px)`;
    for (let i = 0; i < 90; i++) {
      const y = rand(h * 0.35, h * 0.95);
      c.globalAlpha = rand(0.25, 0.7);
      c.fillStyle = pick(["#ffb347", "#ff6b4a", "#fff1c1", "#6ad1ff", "#ffd36b", "#ff8fb1", "#b6ff8a"]);
      c.beginPath();
      c.arc(rand(0, w), y, rand(14, 70) * k, 0, TAU);
      c.fill();
    }
    c.filter = "none";
    c.globalAlpha = 1;
    // Dull it a little, like looking through wet glass.
    c.fillStyle = "rgba(10,14,24,0.35)";
    c.fillRect(0, 0, w, h);
  });
  const drop = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    c.fillStyle = "rgba(170,190,230,0.16)";
    c.beginPath();
    c.ellipse(x, y, r, r * 1.15, 0, 0, TAU);
    c.fill();
    c.strokeStyle = "rgba(0,0,0,0.25)";
    c.lineWidth = Math.max(1, r * 0.18);
    c.beginPath();
    c.ellipse(x, y + r * 0.1, r * 0.9, r * 1.05, 0, 0.1 * Math.PI, 0.9 * Math.PI);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.beginPath();
    c.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, TAU);
    c.fill();
  };
  const beads = layer(w, h, (c) => {
    for (let i = 0; i < 900; i++) drop(c, rand(0, w), rand(0, h), rand(1, 4.5) * k);
  });
  const runners = Array.from({ length: 30 }, () => ({ x: rand(0, w), y: rand(-h, h), r: rand(4, 8) * k, v: 0, trail: rand(0, 1), pause: 0 }));
  return (_t, dt) => {
    ctx.drawImage(city, 0, 0);
    ctx.strokeStyle = "rgba(200,215,255,0.07)";
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const x = rand(0, w);
      const y = rand(0, h);
      ctx.moveTo(x, y);
      ctx.lineTo(x - 8 * k, y + 40 * k);
    }
    ctx.stroke();
    ctx.drawImage(beads, 0, 0);
    for (const r of runners) {
      if (r.pause > 0) r.pause -= dt;
      else {
        r.v = Math.min(r.v + 300 * k * dt, 260 * k);
        r.y += r.v * dt;
        r.x += Math.sin(r.y * 0.02) * 0.3;
        if (Math.random() < dt * 0.8) {
          r.pause = rand(0.3, 1.8);
          r.v = 0;
        }
      }
      if (r.y > h + 40) {
        r.y = rand(-h * 0.5, h * 0.3);
        r.x = rand(0, w);
        r.v = 0;
      }
      const tail = 140 * k * (0.5 + r.trail);
      const g = ctx.createLinearGradient(0, r.y - tail, 0, r.y);
      g.addColorStop(0, "rgba(180,200,240,0)");
      g.addColorStop(1, "rgba(180,200,240,0.18)");
      ctx.strokeStyle = g;
      ctx.lineWidth = r.r * 0.7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(r.x, r.y - tail);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
      drop(ctx, r.x, r.y, r.r);
    }
  };
};

const ocean: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const horizon = h * 0.6;
  const sun = { x: w * 0.5, y: horizon - h * 0.04, r: 95 * k };
  const sky = layer(w, h, (c) => {
    c.fillStyle = vertical(c, 0, horizon, [
      [0, "#1d1440"],
      [0.45, "#6d2c6b"],
      [0.75, "#d4566a"],
      [1, "#ffa24c"],
    ]);
    c.fillRect(0, 0, w, horizon);
    const halo = c.createRadialGradient(sun.x, sun.y, sun.r * 0.8, sun.x, sun.y, sun.r * 6);
    halo.addColorStop(0, "rgba(255,210,140,0.6)");
    halo.addColorStop(1, "rgba(255,160,90,0)");
    c.fillStyle = halo;
    c.fillRect(0, 0, w, horizon);
    c.fillStyle = "#ffe0a0";
    c.beginPath();
    c.arc(sun.x, sun.y, sun.r, 0, TAU);
    c.fill();
    // Long thin clouds catching the light.
    for (let i = 0; i < 9; i++) {
      const y = rand(h * 0.12, horizon - h * 0.12);
      c.fillStyle = `rgba(${pick(["120,50,110", "200,90,120", "90,40,100"])},${rand(0.35, 0.6)})`;
      c.beginPath();
      c.ellipse(rand(0, w), y, rand(200, 520) * k, rand(8, 20) * k, 0, 0, TAU);
      c.fill();
    }
    c.fillStyle = vertical(c, horizon, h, [
      [0, "#7a3560"],
      [0.3, "#3a1c48"],
      [1, "#0e0820"],
    ]);
    c.fillRect(0, horizon, w, h - horizon);
  });
  const waves = Array.from({ length: 7 }, (_, i) => ({
    y: horizon + (h - horizon) * ((i + 1) / 8) ** 1.4,
    amp: (4 + i * 5) * k,
    len: 0.004 / (1 + i * 0.4),
    speed: 0.4 + i * 0.12,
    colour: `rgba(${20 + i * 2},${10 + i * 2},${45 - i * 3},${0.35 + i * 0.08})`,
  }));
  const birds = Array.from({ length: 3 }, (_, i) => ({ x: -100 * (i + 1) * k, y: h * rand(0.18, 0.3), p: rand(0, TAU) }));
  return (t, dt) => {
    ctx.drawImage(sky, 0, 0);
    // The sun's path on the water, broken by the swell.
    ctx.globalCompositeOperation = "lighter";
    for (let y = horizon + 2; y < h; y += 3 * k) {
      const d = (y - horizon) / (h - horizon);
      const width = sun.r * (0.8 + d * 3);
      for (let j = 0; j < 3; j++) {
        const s = Math.sin(y * 0.7 + t * 2.2 + j * 2.1);
        if (s < 0.2) continue;
        ctx.fillStyle = `rgba(255,180,110,${0.35 * (1 - d) * s})`;
        const x = sun.x + Math.sin(y * 0.13 + t * 0.8 + j) * width;
        ctx.fillRect(x - width * 0.25 * s, y, width * 0.5 * s, 2 * k);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    for (const wv of waves) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) {
        ctx.lineTo(x, wv.y + Math.sin(x * wv.len + t * wv.speed) * wv.amp + Math.sin(x * wv.len * 2.7 - t * wv.speed * 1.3) * wv.amp * 0.4);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = wv.colour;
      ctx.fill();
    }
    ctx.strokeStyle = "#1a1020";
    ctx.lineWidth = 3 * k;
    for (const b of birds) {
      b.x += 45 * k * dt;
      if (b.x > w + 100) b.x = -rand(200, 1200) * k;
      const flap = Math.sin(t * 6 + b.p) * 10 * k;
      const y = b.y + Math.sin(t * 0.5 + b.p) * 10 * k;
      ctx.beginPath();
      ctx.moveTo(b.x - 18 * k, y - flap);
      ctx.quadraticCurveTo(b.x - 8 * k, y - 6 * k, b.x, y);
      ctx.quadraticCurveTo(b.x + 8 * k, y - 6 * k, b.x + 18 * k, y - flap);
      ctx.stroke();
    }
  };
};

const lava: SceneFactory = (ctx, w, h) => {
  const bw = 200;
  const bh = Math.round((bw * h) / w);
  const buf = layer(bw, bh, () => undefined);
  const bctx = buf.getContext("2d")!;
  const img = bctx.createImageData(bw, bh);
  const blobs = Array.from({ length: 9 }, () => ({ x: rand(0.1, 0.9) * bw, y: rand(0, bh), r: rand(0.07, 0.14) * bh * 1.6, sp: rand(0.05, 0.12), p: rand(0, TAU), dx: rand(-0.03, 0.03) }));
  return (t) => {
    for (const b of blobs) {
      b.y = bh * (0.5 + 0.55 * Math.sin(t * b.sp + b.p));
      b.x += Math.sin(t * 0.2 + b.p) * b.dx;
    }
    const d = img.data;
    for (let y = 0; y < bh; y++) {
      const v = y / bh;
      for (let x = 0; x < bw; x++) {
        let f = 0;
        for (const b of blobs) {
          const dx = x - b.x;
          const dy = y - b.y;
          f += (b.r * b.r) / (dx * dx + dy * dy + 1);
        }
        const i = (y * bw + x) * 4;
        // Inside a blob: hot orange-yellow; outside: the lamp's glass, lit a little by the blobs.
        const inside = Math.min(1, Math.max(0, (f - 0.9) * 6));
        const heat = Math.min(1, (f - 1) * 0.5);
        const bgR = 40 + v * 70 + f * 30;
        const bgG = 8 + v * 15 + f * 8;
        const bgB = 60 + v * 30 + f * 10;
        const fgR = 255;
        const fgG = 90 + Math.max(0, heat) * 120;
        const fgB = 50 + Math.max(0, heat) * 60;
        d[i] = bgR + (fgR - bgR) * inside;
        d[i + 1] = bgG + (fgG - bgG) * inside;
        d[i + 2] = bgB + (fgB - bgB) * inside;
        d[i + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(buf, 0, 0, w, h);
  };
};

const fireworks: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const skyline = layer(w, h, (c) => {
    let x = 0;
    while (x < w) {
      const bw = rand(50, 160) * k;
      const bh = rand(0.08, 0.3) * h;
      c.fillStyle = "#04050b";
      c.fillRect(x, h - bh, bw + 1, bh);
      for (let wy = h - bh + 12 * k; wy < h - 10 * k; wy += 18 * k) {
        for (let wx = x + 8 * k; wx < x + bw - 10 * k; wx += 16 * k) {
          if (Math.random() < 0.3) {
            c.fillStyle = `rgba(255,${rand(190, 230)},${rand(120, 170)},${rand(0.4, 0.9)})`;
            c.fillRect(wx, wy, 6 * k, 8 * k);
          }
        }
      }
      x += bw;
    }
  });
  const COLOURS = ["#ff4d4d", "#ffd84d", "#4dff88", "#4dc3ff", "#d36bff", "#ffffff", "#ff9a3d", "#ff6ad5"];
  type Spark = { x: number; y: number; vx: number; vy: number; life: number; age: number; colour: string; crackle: boolean };
  const rockets: { x: number; y: number; vy: number; colour: string }[] = [];
  const sparks: Spark[] = [];
  let next = 0;
  let first = true;
  const g = 0.35 * h;
  return (t, dt) => {
    if (first) {
      ctx.fillStyle = "#03040c";
      ctx.fillRect(0, 0, w, h);
      first = false;
    }
    ctx.fillStyle = `rgba(3,4,12,${1 - Math.pow(0.8, dt * 60)})`;
    ctx.fillRect(0, 0, w, h);
    next -= dt;
    if (next <= 0) {
      next = rand(0.2, 1.1);
      rockets.push({ x: rand(0.12, 0.88) * w, y: h, vy: -rand(0.75, 0.95) * h, colour: pick(COLOURS) });
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]!;
      r.vy += g * dt;
      r.y += r.vy * dt;
      ctx.fillStyle = "#ffe9b0";
      ctx.fillRect(r.x - 1.5 * k, r.y, 3 * k, 8 * k);
      if (r.vy > -0.08 * h) {
        rockets.splice(i, 1);
        const n = Math.round(rand(90, 150));
        const speed = rand(0.16, 0.3) * h;
        const second = Math.random() < 0.4 ? pick(COLOURS) : r.colour;
        const crackle = Math.random() < 0.3;
        for (let j = 0; j < n; j++) {
          const a = (j / n) * TAU + rand(-0.05, 0.05);
          const s = speed * rand(0.75, 1);
          sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(1.3, 2.3), age: 0, colour: j % 2 ? r.colour : second, crackle });
        }
      }
    }
    const drag = Math.pow(0.975, dt * 60);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!;
      s.age += dt;
      if (s.age >= s.life) {
        sparks.splice(i, 1);
        continue;
      }
      s.vx *= drag;
      s.vy = s.vy * drag + g * 0.25 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const fade = 1 - s.age / s.life;
      ctx.globalAlpha = s.crackle && s.age > s.life * 0.5 ? (Math.sin(t * 40 + i) > 0 ? fade : 0) : fade;
      ctx.fillStyle = s.colour;
      ctx.fillRect(s.x - 1.5 * k, s.y - 1.5 * k, 3 * k, 3 * k);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(skyline, 0, 0);
  };
};

const halloween: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const moon = { x: w * 0.68, y: h * 0.3, r: 170 * k };
  const back = layer(w, h, (c) => {
    c.fillStyle = vertical(c, 0, h, [
      [0, "#120624"],
      [0.55, "#3d1446"],
      [0.85, "#a8441f"],
      [1, "#d06a1f"],
    ]);
    c.fillRect(0, 0, w, h);
    starField(c, w, h, 160, h * 0.5);
    const halo = c.createRadialGradient(moon.x, moon.y, moon.r, moon.x, moon.y, moon.r * 3.2);
    halo.addColorStop(0, "rgba(255,230,170,0.45)");
    halo.addColorStop(1, "rgba(255,200,120,0)");
    c.fillStyle = halo;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#f8e6ad";
    c.beginPath();
    c.arc(moon.x, moon.y, moon.r, 0, TAU);
    c.fill();
    c.fillStyle = "rgba(200,170,110,0.4)";
    for (const [dx, dy, r] of [[-0.35, -0.2, 0.2], [0.3, 0.25, 0.15], [0.05, -0.45, 0.1], [-0.15, 0.4, 0.12], [0.45, -0.15, 0.08]] as const) {
      c.beginPath();
      c.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, r * moon.r, 0, TAU);
      c.fill();
    }
    fillBelow(c, ridge(w, h * 0.78, h * 0.05, 0.5), h, "#1a0a20");
    const hill: [number, number][] = [];
    for (let x = 0; x <= w; x += 20) hill.push([x, h * 0.86 - Math.sin((x / w) * Math.PI) * h * 0.06]);
    fillBelow(c, hill, h, "#07030a");
    // Gravestones along the hill.
    c.fillStyle = "#07030a";
    for (const gx of [0.42, 0.5, 0.57, 0.8, 0.87]) {
      const x = w * gx;
      const y = h * 0.86 - Math.sin(gx * Math.PI) * h * 0.06;
      const gw = rand(36, 52) * k;
      const gh = rand(60, 90) * k;
      c.save();
      c.translate(x, y + 8 * k);
      c.rotate(rand(-0.12, 0.12));
      c.beginPath();
      c.roundRect(-gw / 2, -gh, gw, gh + 10 * k, [gw / 2, gw / 2, 0, 0]);
      c.fill();
      c.restore();
    }
    // A bare, crooked tree.
    c.strokeStyle = "#07030a";
    c.lineCap = "round";
    const branch = (x: number, y: number, len: number, angle: number, width: number, depth: number) => {
      const x2 = x + Math.cos(angle) * len;
      const y2 = y + Math.sin(angle) * len;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo((x + x2) / 2 + rand(-len, len) * 0.15, (y + y2) / 2 + rand(-len, len) * 0.15, x2, y2);
      c.stroke();
      if (depth <= 0) return;
      const n = depth > 5 ? 2 : Math.random() < 0.5 ? 2 : 3;
      for (let i = 0; i < n; i++) branch(x2, y2, len * rand(0.62, 0.8), angle + rand(-0.6, 0.6), width * 0.68, depth - 1);
    };
    branch(w * 0.13, h * 0.95, 230 * k, -Math.PI / 2 + 0.08, 46 * k, 7);
  });
  const pumpkins = [
    { x: w * 0.27, y: h * 0.86, s: 70 * k },
    { x: w * 0.35, y: h * 0.875, s: 48 * k },
    { x: w * 0.72, y: h * 0.865, s: 58 * k },
  ];
  const candle = glow([
    [0, "rgba(255,190,60,0.8)"],
    [1, "rgba(255,120,20,0)"],
  ]);
  const bats = Array.from({ length: 8 }, () => ({ x: rand(0, w), y: rand(h * 0.1, h * 0.5), v: rand(60, 130) * k, s: rand(18, 34) * k, p: rand(0, TAU) }));
  const fog = Array.from({ length: 7 }, () => ({ x: rand(0, w), y: rand(h * 0.78, h * 0.98), r: rand(250, 450) * k, v: rand(8, 20) * k }));
  const ghost = { x: -200 * k, y: h * 0.55, p: 0 };
  return (t, dt) => {
    ctx.drawImage(back, 0, 0);
    for (const b of bats) {
      b.x += b.v * dt;
      if (b.x > w + 60) {
        b.x = -60;
        b.y = rand(h * 0.1, h * 0.5);
      }
      const y = b.y + Math.sin(t * 1.3 + b.p) * 30 * k;
      const flap = Math.sin(t * 14 + b.p);
      ctx.fillStyle = "#0a0410";
      ctx.beginPath();
      ctx.ellipse(b.x, y, b.s * 0.22, b.s * 0.3, 0, 0, TAU);
      ctx.fill();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(b.x, y - b.s * 0.1);
        ctx.quadraticCurveTo(b.x + side * b.s * 0.6, y - b.s * (0.2 + flap * 0.7), b.x + side * b.s * 1.3, y - b.s * flap * 0.5);
        ctx.quadraticCurveTo(b.x + side * b.s * 0.8, y + b.s * 0.05, b.x + side * b.s * 0.5, y + b.s * 0.15);
        ctx.quadraticCurveTo(b.x + side * b.s * 0.3, y + b.s * 0.05, b.x, y + b.s * 0.1);
        ctx.fill();
      }
    }
    // The ghost drifts across now and then.
    ghost.x += 70 * k * dt;
    if (ghost.x > w + 300 * k) ghost.x = -rand(800, 2400) * k;
    const gy = ghost.y + Math.sin(t * 1.2) * 25 * k;
    const gs = 80 * k;
    ctx.globalAlpha = 0.6 + 0.2 * Math.sin(t * 2);
    ctx.fillStyle = "#f2f0ff";
    ctx.beginPath();
    ctx.moveTo(ghost.x - gs * 0.6, gy + gs * 0.9);
    ctx.lineTo(ghost.x - gs * 0.6, gy);
    ctx.arc(ghost.x, gy, gs * 0.6, Math.PI, 0);
    ctx.lineTo(ghost.x + gs * 0.6, gy + gs * 0.9);
    for (let i = 0; i < 4; i++) {
      const x = ghost.x + gs * 0.6 - (i + 0.5) * gs * 0.3;
      ctx.quadraticCurveTo(x, gy + gs * (0.75 + 0.15 * Math.sin(t * 6 + i)), x - gs * 0.15, gy + gs * 0.9);
    }
    ctx.fill();
    ctx.fillStyle = "#1a1030";
    ctx.beginPath();
    ctx.ellipse(ghost.x - gs * 0.2, gy - gs * 0.05, gs * 0.08, gs * 0.13, 0, 0, TAU);
    ctx.ellipse(ghost.x + gs * 0.2, gy - gs * 0.05, gs * 0.08, gs * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (const p of pumpkins) {
      const f = 0.75 + 0.15 * Math.sin(t * 9 + p.x) + 0.1 * Math.sin(t * 17 + p.s);
      ctx.globalCompositeOperation = "lighter";
      stamp(ctx, candle, p.x, p.y - p.s * 0.5, p.s * 5, 0.45 * f);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#e0661a";
      for (const dx of [-0.45, 0.45, 0]) {
        ctx.beginPath();
        ctx.ellipse(p.x + dx * p.s, p.y - p.s * 0.55, p.s * 0.6, p.s * 0.55, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "#3a5a1a";
      ctx.fillRect(p.x - p.s * 0.06, p.y - p.s * 1.25, p.s * 0.12, p.s * 0.2);
      ctx.fillStyle = `rgb(255,${180 + 40 * f},${60 * f})`;
      const face = (pts: [number, number][]) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(p.x + x * p.s, p.y + y * p.s) : ctx.moveTo(p.x + x * p.s, p.y + y * p.s)));
        ctx.fill();
      };
      face([[-0.4, -0.65], [-0.15, -0.65], [-0.27, -0.85]]);
      face([[0.4, -0.65], [0.15, -0.65], [0.27, -0.85]]);
      face([[-0.45, -0.4], [-0.3, -0.3], [-0.15, -0.38], [0, -0.28], [0.15, -0.38], [0.3, -0.3], [0.45, -0.4], [0.3, -0.18], [-0.3, -0.18]]);
    }
    for (const f of fog) {
      f.x += f.v * dt;
      if (f.x - f.r > w) f.x = -f.r;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, "rgba(190,170,220,0.12)");
      g.addColorStop(1, "rgba(190,170,220,0)");
      ctx.fillStyle = g;
      ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
  };
};

const christmas: SceneFactory = (ctx, w, h) => {
  const k = h / 1080;
  const tree = { x: w * 0.5, base: h * 0.84, height: h * 0.62, width: h * 0.42 };
  const back = layer(w, h, (c) => {
    c.fillStyle = vertical(c, 0, h, [
      [0, "#050a20"],
      [1, "#16285a"],
    ]);
    c.fillRect(0, 0, w, h);
    starField(c, w, h, 240, h * 0.7);
    const ground: [number, number][] = [];
    for (let x = 0; x <= w; x += 20) ground.push([x, h * 0.8 + Math.sin(x / w * 4) * h * 0.02]);
    fillBelow(c, ground, h, vertical(c, h * 0.78, h, [
      [0, "#e9f0ff"],
      [1, "#a6b6dc"],
    ]));
    // The tree: tiers of branches, darker underneath.
    c.fillStyle = "#4a2c18";
    c.fillRect(tree.x - 22 * k, tree.base - 40 * k, 44 * k, 60 * k);
    for (let i = 0; i < 5; i++) {
      const top = tree.base - tree.height + i * tree.height * 0.17;
      const bottom = top + tree.height * 0.3;
      const half = tree.width * (0.32 + i * 0.17) * 0.6;
      c.fillStyle = vertical(c, top, bottom, [
        [0, "#2f8a4a"],
        [1, "#103d22"],
      ]);
      c.beginPath();
      c.moveTo(tree.x, top);
      c.quadraticCurveTo(tree.x + half * 0.4, top + (bottom - top) * 0.5, tree.x + half, bottom);
      for (let j = 0; j <= 6; j++) c.quadraticCurveTo(tree.x + half - (j + 0.5) * (half / 3.5), bottom + 12 * k, tree.x + half - (j + 1) * (half / 3.5), bottom);
      c.quadraticCurveTo(tree.x - half * 0.4, top + (bottom - top) * 0.5, tree.x, top);
      c.fill();
    }
    // Presents.
    const present = (x: number, pw: number, ph: number, box: string, ribbon: string) => {
      const y = tree.base + 18 * k;
      c.fillStyle = box;
      c.fillRect(x - pw / 2, y - ph, pw, ph);
      c.fillStyle = ribbon;
      c.fillRect(x - 6 * k, y - ph, 12 * k, ph);
      c.fillRect(x - pw / 2, y - ph * 0.55, pw, 10 * k);
      c.beginPath();
      c.ellipse(x - 14 * k, y - ph - 8 * k, 14 * k, 9 * k, -0.4, 0, TAU);
      c.ellipse(x + 14 * k, y - ph - 8 * k, 14 * k, 9 * k, 0.4, 0, TAU);
      c.fill();
    };
    present(tree.x - 200 * k, 130 * k, 95 * k, "#c0283a", "#ffd84d");
    present(tree.x - 70 * k, 90 * k, 70 * k, "#2a62c9", "#ffffff");
    present(tree.x + 90 * k, 120 * k, 110 * k, "#1f8a50", "#ff4d6d");
    present(tree.x + 215 * k, 80 * k, 60 * k, "#7c3fc9", "#ffd84d");
  });
  const lights: { x: number; y: number; colour: number; p: number }[] = [];
  for (let row = 0; row < 9; row++) {
    const v = (row + 0.6) / 9.5;
    const y = tree.base - tree.height + v * tree.height * 0.98;
    const half = tree.width * 0.6 * (0.15 + v * 0.85);
    const n = 3 + row * 2;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      lights.push({ x: tree.x - half + u * half * 2, y: y + Math.sin(u * Math.PI) * 18 * k, colour: Math.floor(Math.random() * 5), p: rand(0, TAU) });
    }
  }
  const bulbs = ["255,70,70", "255,210,80", "90,255,130", "90,170,255", "255,120,220"].map((c) => glow([
    [0, `rgba(255,255,255,1)`],
    [0.15, `rgba(${c},0.95)`],
    [0.5, `rgba(${c},0.25)`],
    [1, `rgba(${c},0)`],
  ]));
  const starGlow = glow([
    [0, "rgba(255,240,180,1)"],
    [0.4, "rgba(255,210,90,0.4)"],
    [1, "rgba(255,200,80,0)"],
  ]);
  const flakes = snowfall(w, h, 320);
  return (t, dt) => {
    ctx.drawImage(back, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const l of lights) {
      const on = 0.45 + 0.55 * Math.max(0, Math.sin(t * 1.6 + l.p));
      stamp(ctx, bulbs[(l.colour + Math.floor(t / 6)) % bulbs.length]!, l.x, l.y, 46 * k, on);
    }
    const top = tree.base - tree.height;
    stamp(ctx, starGlow, tree.x, top - 6 * k, (180 + 20 * Math.sin(t * 2)) * k, 0.9);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffd84d";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 ? 18 : 42) * k;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(tree.x + Math.cos(a) * r, top - 6 * k + Math.sin(a) * r);
    }
    ctx.fill();
    flakes(ctx, t, dt);
  };
};

const bounce: SceneFactory = (ctx, w, h, opts) => {
  const k = h / 1080;
  const fontSize = 110 * k;
  ctx.font = `800 italic ${fontSize}px Inter, system-ui, sans-serif`;
  const tw = ctx.measureText(opts.name).width;
  const bw = tw + 80 * k;
  const bh = fontSize * 1.9;
  const s = { x: rand(0, w - bw), y: rand(0, h - bh), vx: 170 * k, vy: 130 * k, hue: rand(0, 360) };
  return (_t, dt) => {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    let hit = false;
    if (s.x < 0 || s.x + bw > w) {
      s.vx = -s.vx;
      s.x = Math.min(Math.max(0, s.x), w - bw);
      hit = true;
    }
    if (s.y < 0 || s.y + bh > h) {
      s.vy = -s.vy;
      s.y = Math.min(Math.max(0, s.y), h - bh);
      hit = true;
    }
    if (hit) s.hue = (s.hue + rand(70, 200)) % 360;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    const colour = `hsl(${s.hue}, 90%, 60%)`;
    ctx.fillStyle = colour;
    ctx.font = `800 italic ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.name, s.x + bw / 2, s.y + fontSize * 0.6);
    ctx.beginPath();
    ctx.ellipse(s.x + bw / 2, s.y + bh - fontSize * 0.35, bw * 0.42, fontSize * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#000000";
    ctx.font = `700 ${fontSize * 0.26}px Inter, system-ui, sans-serif`;
    ctx.fillText("T V", s.x + bw / 2, s.y + bh - fontSize * 0.33);
  };
};

export const SCENES: Record<string, SceneFactory> = { aurora, fireplace, aquarium, space, snow, rain, ocean, lava, fireworks, halloween, christmas, bounce };
