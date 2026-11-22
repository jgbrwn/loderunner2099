import { rgba, shade, mix, Rng } from './color';

/**
 * Pose-based pixel-art characters (32x32, facing right). Each pose is a tiny skeleton
 * (angles: 0 = straight down, + = towards +x) rendered with thick pixel limbs, then
 * outlined and given a faint neon halo.
 */
type Limb = [number, number];
interface Pose {
  front?: boolean; lean?: number;
  legs: [Limb, Limb]; arms: [Limb, Limb];   // [back, front] (front view: [left, right])
  ground: 'feet' | 'hands' | 'none';
  blink?: boolean; blaster?: 0 | 1 | 2; dx?: number;
}
export interface CharFrame { name: string; canvas: HTMLCanvasElement }

const L = (a: number, len: number) => [Math.sin(a) * len, Math.cos(a) * len];

function poses(guard: boolean): [string, Pose][] {
  const out: [string, Pose][] = [];
  const idle: Pose = { legs: [[-0.12, -0.12], [0.12, 0.12]], arms: [[-0.15, 0.1], [0.15, 0.4]], ground: 'feet' };
  out.push(['idle', idle], ['blink', { ...idle, blink: true }]);
  for (let k = 0; k < 6; k++) {
    const f = k * Math.PI / 3;
    const leg = (p: number): Limb => { const t = 0.75 * Math.sin(p); return [t, t - 1.2 * Math.max(0, Math.cos(p))]; };
    const s = Math.sin(f);
    out.push(['run' + k, { lean: 1, legs: [leg(f + Math.PI), leg(f)], arms: [[0.7 * s, 0.7 * s + 1.1], [-0.7 * s, -0.7 * s + 1.1]], ground: 'feet' }]);
  }
  const A: Pose = { front: true, legs: [[-0.15, -0.05], [0.9, -0.1]], arms: [[-2.85, -3.05], [2.0, 2.7]], ground: 'feet' };
  const B: Pose = { front: true, legs: [[-0.9, 0.1], [0.15, 0.05]], arms: [[-2.0, -2.7], [2.85, 3.05]], ground: 'feet' };
  const M: Pose = { front: true, legs: [[-0.4, -0.1], [0.4, 0.1]], arms: [[-2.45, -2.85], [2.45, 2.85]], ground: 'feet' };
  out.push(['climb0', A], ['climb1', M], ['climb2', B], ['climb3', { ...M, dx: 0 }]);
  for (let k = 0; k < 4; k++) {
    const s = Math.sin(k * Math.PI / 2);
    out.push(['hang' + k, {
      legs: [[0.3 * s - 0.1, 0.3 * s - 0.45], [-0.3 * s + 0.15, -0.3 * s - 0.2]],
      arms: [[Math.PI + 0.3 + 0.25 * s, Math.PI + 0.1 + 0.25 * s], [Math.PI - 0.3 + 0.25 * s, Math.PI - 0.1 + 0.25 * s]], ground: 'hands',
    }]);
  }
  for (let k = 0; k < 2; k++) out.push(['fall' + k, {
    legs: [[-0.4, -0.1 + 0.2 * k], [0.5 - 0.3 * k, -0.2]], arms: [[2.4 + 0.3 * k, 2.9], [2.0 + 0.3 * (1 - k), 2.6]], ground: 'none',
  }]);
  for (let k = 0; k < 2; k++) out.push(['dig' + k, {
    lean: 2, legs: [[0.1, -1.5], [1.25, 0.05]], arms: [[0.7, 1.1], [1.25, 1.5 - 0.1 * k]], ground: 'feet', blaster: (k + 1) as 1 | 2,
  }]);
  if (guard) for (let k = 0; k < 2; k++) out.push(['trapped' + k, {
    front: true, legs: [[-0.1, -0.05], [0.1, 0.05]], arms: [[-2.6 - 0.2 * k, -2.9], [2.6 + 0.2 * (1 - k), 2.9]], ground: 'feet', dx: k ? 1 : -1,
  }]);
  return out;
}

export function drawCharacterFrames(color: number, guard: boolean): CharFrame[] {
  const frames: CharFrame[] = [];
  let idleCanvas: HTMLCanvasElement | null = null;
  for (const [name, pose] of poses(guard)) {
    const cv = renderPose(pose, color, guard);
    if (name === 'idle') idleCanvas = cv;
    frames.push({ name, canvas: cv });
  }
  // death: white flash, then pixel dissolve/melt
  for (let k = 0; k < 6; k++) {
    const cv = newCanvas();
    const ctx = cv.getContext('2d')!;
    const src = idleCanvas!.getContext('2d')!.getImageData(0, 0, 32, 32);
    const dst = ctx.createImageData(32, 32);
    const rng = new Rng(99 + k);
    const white = k < 2 ? 0.75 - k * 0.2 : 0.5;
    for (let y = 31; y >= 0; y--) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      if (src.data[i + 3] === 0) continue;
      if (k >= 2 && rng.next() < (k - 1) / 5) continue;
      const ny = Math.min(31, y + (k >= 2 ? Math.floor(rng.next() * (k - 1) * 2) : 0));
      const nx = Math.max(0, Math.min(31, x + (k >= 3 ? Math.round((rng.next() - 0.5) * k) : 0)));
      const j = (ny * 32 + nx) * 4;
      for (let c = 0; c < 3; c++) dst.data[j + c] = src.data[i + c] + (255 - src.data[i + c]) * white;
      dst.data[j + 3] = k >= 4 ? 200 : 255;
    }
    ctx.putImageData(dst, 0, 0);
    frames.push({ name: 'death' + k, canvas: cv });
  }
  return frames;
}

function newCanvas(): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = c.height = 32; return c; }

function renderPose(p: Pose, color: number, guard: boolean): HTMLCanvasElement {
  const cv = newCanvas();
  const ctx = cv.getContext('2d')!;
  const body = color, dark = shade(color, 0.6), light = mix(color, 0xffffff, 0.45);
  const lean = p.lean ?? 0;
  // skeleton
  let hip = [16 + (p.dx ?? 0), 21];
  const neck = () => [hip[0] + lean, hip[1] - 8];
  const build = () => {
    const n = neck();
    const hips = p.front ? [[hip[0] - 3, hip[1]], [hip[0] + 3, hip[1]]] : [hip, hip];
    const sh = p.front ? [[n[0] - 5, n[1] + 2], [n[0] + 5, n[1] + 2]] : [[n[0], n[1] + 1], [n[0], n[1] + 1]];
    const legs = p.legs.map((l, i) => { const k = add(hips[i], L(l[0], 5)); return [hips[i], k, add(k, L(l[1], 5))]; });
    const arms = p.arms.map((a, i) => { const e = add(sh[i], L(a[0], 5)); return [sh[i], e, add(e, L(a[1], 4))]; });
    return { n, legs, arms };
  };
  let s = build();
  let dy = 0;
  if (p.ground === 'feet') dy = 29.5 - Math.max(...s.legs.map(l => l[2][1]));
  else if (p.ground === 'hands') dy = 5 - Math.min(...s.arms.map(a => a[2][1]));
  hip = [hip[0], hip[1] + dy];
  s = build();

  const limb = (pts: number[][], w: number, c: number) => {
    ctx.fillStyle = rgba(c);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
      for (let t = 0; t <= n; t++) {
        const x = x0 + (x1 - x0) * t / n, y = y0 + (y1 - y0) * t / n;
        ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
      }
    }
  };
  const rect = (x: number, y: number, w: number, h: number, c: number, a = 1) => { ctx.fillStyle = rgba(c, a); ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  const boot = (f: number[], c: number) => p.front ? rect(f[0] - 2, f[1] - 1, 4, 3, c) : rect(f[0] - 2, f[1] - 1, 6, 3, c);

  const [nx, ny] = s.n;
  // back limbs
  limb(s.legs[0], 4, p.front ? body : dark); boot(s.legs[0][2], shade(color, 0.4));
  if (!p.front) limb(s.arms[0], 3, dark);
  // torso
  const tw = p.front ? 11 : guard ? 10 : 9;
  rect(Math.min(nx, hip[0]) - tw / 2, ny, tw + Math.abs(nx - hip[0]), hip[1] - ny + 1, body);
  rect(Math.min(nx, hip[0]) - tw / 2, hip[1] - 1, tw + Math.abs(nx - hip[0]), 1, dark);
  if (guard) { rect(nx - tw / 2, ny + 3, tw, 2, dark); rect(nx - (p.front ? 5 : 2), ny, p.front ? 10 : 5, 2, light); }
  else { rect(nx + (p.front ? -1 : 1), ny + 2, 2, 2, light); rect(nx - tw / 2, ny, 1, hip[1] - ny, light, 0.6); }
  // head
  const hw = guard ? 11 : 10, hx = Math.round(nx - hw / 2 + (p.front ? 0 : 1)), hy = Math.round(ny - 9);
  rect(hx, hy + 1, hw, 7, body); rect(hx + 1, hy, hw - 2, 9, body);
  rect(hx + 1, hy, hw - 2, 1, light);
  if (guard) {
    rect(hx, hy + 1, hw, 2, dark); // brow plate
    rect(hx + 2, hy - 3, 1, 3, light); rect(hx + 2, hy - 4, 1, 1, 0xffffff);
    const eye = p.blink ? dark : 0xffee44;
    if (p.front) { rect(hx + 2, hy + 4, 3, 2, eye); rect(hx + hw - 5, hy + 4, 3, 2, eye); }
    else { rect(hx + hw - 4, hy + 4, 4, 2, eye); rect(hx + hw - 2, hy + 4, 1, 1, 0xffffff, p.blink ? 0 : 1); }
    rect(hx + 2, hy + 7, hw - 4, 1, dark);
  } else {
    const visor = p.blink ? shade(color, 0.35) : 0x9ff4ff;
    if (p.front) { rect(hx + 1, hy + 3, hw - 2, 3, visor); if (!p.blink) rect(hx + 2, hy + 3, 2, 1, 0xffffff); }
    else { rect(hx + 5, hy + 3, 5, 3, visor); if (!p.blink) rect(hx + 8, hy + 3, 1, 1, 0xffffff); }
    rect(hx, hy + 7, hw, 1, dark);
  }
  // front limbs
  limb(s.legs[1], 4, body); boot(s.legs[1][2], shade(color, 0.4));
  limb(s.arms[p.front ? 0 : 1], 3, p.front ? body : mix(body, 0xffffff, 0.2));
  if (p.front) limb(s.arms[1], 3, body);
  // hands
  for (const a of s.arms) rect(a[2][0] - 1.5, a[2][1] - 1.5, 3, 3, light);
  if (p.blaster) {
    const h = s.arms[1][2], d = L(1.5, 1);
    limb([h, add(h, [d[0] * 5, d[1] * 5])], 2, 0xb0b8c8);
    if (p.blaster === 2) { const t = add(h, [d[0] * 7, d[1] * 7]); rect(t[0] - 1, t[1] - 1, 3, 3, 0xfff6a0); rect(t[0], t[1], 1, 1, 0xffffff); }
  }
  outline(ctx, color);
  return cv;
}

function add(a: number[], b: number[]): number[] { return [a[0] + b[0], a[1] + b[1]]; }

/** 1px dark outline + faint halo around opaque pixels. */
function outline(ctx: CanvasRenderingContext2D, color: number): void {
  const img = ctx.getImageData(0, 0, 32, 32), d = img.data;
  const op = (x: number, y: number) => x >= 0 && y >= 0 && x < 32 && y < 32 && d[(y * 32 + x) * 4 + 3] > 0;
  const o = shade(color, 0.15), g = color;
  const mark: number[] = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (op(x, y)) continue;
    if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1)) mark.push(y * 32 + x, 1);
    else if (op(x - 1, y - 1) || op(x + 1, y + 1) || op(x + 1, y - 1) || op(x - 1, y + 1) || op(x - 2, y) || op(x + 2, y) || op(x, y - 2) || op(x, y + 2)) mark.push(y * 32 + x, 2);
  }
  for (let i = 0; i < mark.length; i += 2) {
    const j = mark[i] * 4, c = mark[i + 1] === 1 ? o : g;
    d[j] = (c >> 16) & 255; d[j + 1] = (c >> 8) & 255; d[j + 2] = c & 255; d[j + 3] = mark[i + 1] === 1 ? 235 : 50;
  }
  ctx.putImageData(img, 0, 0);
}
