// Material-specific tile art for the environment sets (dungeon stone, palace sandstone/marble, foundry steel).
// Gameplay silhouettes stay identical across materials: diggable brick fills the cell, a trap brick is that brick
// with only the classic subtle tell (one seam missing), hard brick reads as a different, heavier material,
// ladders keep two rails + rungs, poles stay a thin horizontal bar near the top of the cell.
import { Theme } from '../config';
import { rgba, shade, tint, mix, Rng } from './color';

type Ctx = CanvasRenderingContext2D;
function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: number, a = 1): void {
  ctx.fillStyle = rgba(c, a); ctx.fillRect(x, y, w, h);
}
const fl = Math.floor;

/** Bevelled block used by all materials. */
function block(ctx: Ctx, x: number, y: number, w: number, h: number, c: number, mortar: number, round: boolean, hi = 1.35, lo = 0.66): void {
  px(ctx, x, y, w, h, c);
  px(ctx, x + 1, y, w - 2, 1, tint(c, hi));
  px(ctx, x, y + 1, 1, h - 2, tint(c, (hi + 1) / 2));
  px(ctx, x + 1, y + h - 1, w - 2, 1, shade(c, lo));
  px(ctx, x + w - 1, y + 1, 1, h - 2, shade(c, (lo + 1) / 2));
  if (round) for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) px(ctx, cx, cy, 1, 1, mortar);
}

function crack(ctx: Ctx, rng: Rng, c: number): void {
  let x = 6 + fl(rng.next() * 18), y = 1;
  while (y < 30) { px(ctx, x, y, 1, 2, c); y += 2; x += rng.next() < 0.5 ? -1 : 1; }
}

// ---------------------------------------------------------------- diggable bricks
export function stoneBrick(ctx: Ctx, theme: Theme, variant: number, trap: boolean): void {
  const base = tint(theme.brick, 1.05), mortar = shade(base, 0.28);
  const rng = new Rng(31 + variant * 57);
  px(ctx, 0, 0, 32, 32, mortar);
  const rows: [number, number, number][] = [[0, 10, 0], [11, 10, -6], [22, 10, -11]];
  rows.forEach(([y, h, start], ri) => {
    if (trap && ri === 1) { stone(ctx, rng, 0, y, 32, h, base, mortar); return; } // the tell: one long slab
    let x = start;
    while (x < 32) {
      const w = 9 + fl(rng.next() * 8);
      const x0 = Math.max(0, x), x1 = Math.min(32, x + w - 1);
      if (x1 - x0 >= 2) stone(ctx, rng, x0, y, x1 - x0, h, base, mortar);
      x += w;
    }
  });
  if (variant === 1) crack(ctx, rng, shade(base, 0.35));
  else if (variant === 2) { // moss on the upper edges
    for (let i = 0; i < 14; i++) { const x = fl(rng.next() * 32), y = [0, 11, 22][fl(rng.next() * 3)]; px(ctx, x, y, 1 + fl(rng.next() * 2), 1 + fl(rng.next() * 2), 0x4f7a34, 0.85); }
  } else if (variant === 3) { // damp streak
    const x = 8 + fl(rng.next() * 16); for (let y = 2; y < 30; y++) px(ctx, x + (y % 7 === 0 ? 1 : 0), y, 2, 1, 0x000000, 0.18 + (y % 3) * 0.04);
  }
}
function stone(ctx: Ctx, rng: Rng, x: number, y: number, w: number, h: number, base: number, mortar: number): void {
  const c = tint(base, 1 + (rng.next() - 0.5) * 0.24);
  block(ctx, x, y, w, h, c, mortar, true);
  for (let i = 0; i < Math.max(2, w / 4); i++) px(ctx, x + 1 + fl(rng.next() * (w - 2)), y + 2 + fl(rng.next() * (h - 4)), 1, 1, rng.next() < 0.6 ? shade(c, 0.78) : tint(c, 1.2));
}

export function palaceBrick(ctx: Ctx, theme: Theme, variant: number, trap: boolean): void {
  const base = tint(theme.brick, 1.1), mortar = shade(base, 0.5);
  const rng = new Rng(43 + variant * 61);
  px(ctx, 0, 0, 32, 32, mortar);
  for (let row = 0; row < 2; row++) {
    const y = row * 16, off = row ? 8 : 0;
    if (trap && row === 1) { ashlar(ctx, rng, 0, y, 32, 15, base, mortar); continue; } // the tell: no vertical joint
    for (let bx = -off; bx < 32; bx += 16) {
      const x0 = Math.max(0, bx), x1 = Math.min(32, bx + 15);
      ashlar(ctx, rng, x0, y, x1 - x0, 15, base, mortar);
    }
  }
  const ink = shade(base, 0.55);
  if (variant === 1) crack(ctx, rng, shade(base, 0.45));
  else if (variant === 2) { px(ctx, 0, 0, 3, 2, mortar); px(ctx, 28, 17, 4, 2, mortar); px(ctx, 13, 29, 3, 2, mortar); }
  else if (variant === 3) { // carved ankh + turquoise/gold inlay
    px(ctx, 5, 3, 4, 1, ink); px(ctx, 4, 4, 1, 3, ink); px(ctx, 9, 4, 1, 3, ink); px(ctx, 5, 7, 4, 1, ink);
    px(ctx, 3, 8, 8, 1, ink); px(ctx, 6, 8, 2, 5, ink);
    px(ctx, 20, 21, 2, 2, 0x40d0c0); px(ctx, 23, 21, 2, 2, theme.gold); px(ctx, 26, 21, 2, 2, 0x3050c0);
  }
}
function ashlar(ctx: Ctx, rng: Rng, x: number, y: number, w: number, h: number, base: number, mortar: number): void {
  const c = tint(base, 1 + (rng.next() - 0.5) * 0.12);
  block(ctx, x, y, w, h, c, mortar, false, 1.3, 0.7);
  for (let i = 0; i < 2; i++) px(ctx, x + 2 + fl(rng.next() * Math.max(1, w - 8)), y + 3 + fl(rng.next() * (h - 6)), 4, 1, shade(c, 0.88)); // chisel
}

export function metalBrick(ctx: Ctx, theme: Theme, variant: number, trap: boolean): void {
  const base = tint(theme.brick, 1.08), seam = shade(base, 0.3);
  const rng = new Rng(53 + variant * 71);
  px(ctx, 0, 0, 32, 32, seam);
  for (let row = 0; row < 2; row++) {
    const y = row * 16;
    const xs = trap && row === 1 ? [[0, 32]] : row ? [[0, 20], [20, 12]] : [[0, 12], [12, 20]];
    for (const [x, w] of xs) {
      const c = tint(base, 1 + (rng.next() - 0.5) * 0.1);
      block(ctx, x, y, w - 1, 15, c, seam, false, 1.4, 0.6);
      for (let yy = y + 3; yy < y + 13; yy += 3) px(ctx, x + 2, yy, w - 5, 1, tint(c, 1.06), 0.5); // brushed
      for (const [bx, by] of [[x + 2, y + 2], [x + w - 4, y + 12]]) { px(ctx, bx, by, 2, 2, shade(c, 0.5)); px(ctx, bx, by, 1, 1, tint(c, 1.8)); }
    }
  }
  if (variant === 1) { for (let i = 0; i < 5; i++) px(ctx, 4 + i * 2, 6 + i, 3, 1, tint(base, 1.6), 0.7); } // scratch
  else if (variant === 2) { for (let i = 0; i < 12; i++) px(ctx, fl(rng.next() * 30), fl(rng.next() * 30), 2, 1, 0x8a4a24, 0.6); } // rust
  else if (variant === 3) { for (let y = 19; y < 28; y += 3) { px(ctx, 5, y, 10, 1, 0x000000, 0.7); px(ctx, 5, y + 1, 10, 1, tint(base, 1.4), 0.5); } px(ctx, 24, 5, 3, 3, theme.ladder, 0.8); } // vent + status lamp
}

// ---------------------------------------------------------------- hard (undiggable) bricks
export function stoneHard(ctx: Ctx, theme: Theme, variant: number): void {
  const base = theme.brickHard, rng = new Rng(97 + variant);
  px(ctx, 0, 0, 32, 32, shade(base, 0.3));
  block(ctx, 1, 1, 30, 30, base, shade(base, 0.3), true, 1.4, 0.55);
  for (let i = 0; i < 60; i++) px(ctx, 2 + fl(rng.next() * 28), 2 + fl(rng.next() * 28), 1, 1, rng.next() < 0.5 ? shade(base, 0.75) : tint(base, 1.25));
  const iron = 0x2c2c34;
  const band = (x: number, y: number, w: number, h: number) => { px(ctx, x, y, w, h, iron); px(ctx, x, y, w, 1, 0x60606c); };
  if (variant === 0) { band(0, 6, 32, 3); band(0, 23, 32, 3); for (const x of [4, 15, 26]) for (const y of [7, 24]) px(ctx, x, y, 2, 1, 0x9a9aa8); }
  else { band(6, 0, 3, 32); band(23, 0, 3, 32); for (const y of [4, 15, 26]) for (const x of [7, 24]) px(ctx, x, y, 1, 2, 0x9a9aa8); }
}

export function palaceHard(ctx: Ctx, theme: Theme, variant: number): void {
  const base = theme.brickHard, trim = theme.pole, rng = new Rng(131 + variant);
  px(ctx, 0, 0, 32, 32, shade(trim, 0.45));
  px(ctx, 1, 1, 30, 30, base);
  for (let k = 0; k < 2; k++) { // marble veins
    let x = fl(rng.next() * 30), y = 2;
    while (y < 30) { px(ctx, x, y, 1, 1, shade(base, 0.68)); y++; if (rng.next() < 0.5) x = Math.max(2, Math.min(29, x + (rng.next() < 0.5 ? -1 : 1))); }
  }
  px(ctx, 1, 1, 30, 2, trim); px(ctx, 1, 29, 30, 2, shade(trim, 0.75)); px(ctx, 1, 1, 30, 1, tint(trim, 1.4));
  if (variant === 0) { // lapis/turquoise lozenge
    for (let i = 0; i < 6; i++) { px(ctx, 16 - i, 10 + i, i * 2, 1, i % 2 ? 0x2a48b0 : 0x40c8c0); px(ctx, 16 - i, 21 - i, i * 2, 1, i % 2 ? 0x2a48b0 : 0x40c8c0); }
  } else { for (const x of [6, 12, 18, 24]) { px(ctx, x, 4, 2, 24, shade(base, 0.8)); px(ctx, x + 2, 4, 1, 24, tint(base, 1.1)); } } // fluting
}

export function metalHard(ctx: Ctx, theme: Theme, variant: number): void {
  const base = theme.brickHard;
  px(ctx, 0, 0, 32, 32, shade(base, 0.4));
  block(ctx, 1, 1, 30, 30, base, 0, false, 1.6, 0.5);
  const stripes = (y: number) => { for (let x = 1; x < 31; x++) for (let k = 0; k < 4; k++) if (((x + k) >> 2) % 2 === 0) px(ctx, x, y + k, 1, 1, 0xe8b020); else px(ctx, x, y + k, 1, 1, 0x141414); };
  if (variant === 0) { stripes(3); stripes(25); }
  else { for (let i = 4; i < 28; i++) { px(ctx, i, i, 2, 1, shade(base, 0.55)); px(ctx, 31 - i - 2, i, 2, 1, shade(base, 0.55)); } }
  for (const [x, y] of [[3, 12], [27, 12], [3, 19], [27, 19]]) { px(ctx, x, y, 2, 2, shade(base, 0.45)); px(ctx, x, y, 1, 1, tint(base, 2)); }
}

// ---------------------------------------------------------------- ladders & poles
export function woodLadder(ctx: Ctx, color: number, exit: boolean): void {
  const dark = shade(color, 0.55), light = tint(color, 1.3);
  for (const x of [4, 25]) { px(ctx, x, 0, 3, 32, color); px(ctx, x, 0, 1, 32, light); px(ctx, x + 2, 0, 1, 32, dark); for (let y = 2; y < 32; y += 9) px(ctx, x + 1, y, 1, 3, dark); }
  for (let y = 3; y < 32; y += 8) { px(ctx, 7, y, 18, 3, color); px(ctx, 7, y, 18, 1, light); px(ctx, 7, y + 2, 18, 1, dark); px(ctx, 7, y + 1, 1, 1, 0x222222); px(ctx, 24, y + 1, 1, 1, 0x222222); }
  if (exit) for (let y = 3; y < 32; y += 8) px(ctx, 15, y, 2, 2, tint(color, 1.5), 0.9);
}

export function chainPole(ctx: Ctx, theme: Theme): void {
  const c = theme.pole, hi = tint(c, 1.5), lo = shade(c, 0.45);
  for (let x = 0; x < 32; x += 8) {
    // flat link (oval ring) then an edge-on link
    px(ctx, x + 1, 3, 5, 1, hi); px(ctx, x + 1, 7, 5, 1, lo); px(ctx, x, 4, 1, 3, c); px(ctx, x + 6, 4, 1, 3, c);
    px(ctx, x + 5, 5, 4, 2, c); px(ctx, x + 5, 5, 4, 1, hi);
  }
}

export function ropePole(ctx: Ctx, theme: Theme): void {
  const c = theme.pole;
  px(ctx, 0, 3, 32, 4, shade(c, 0.6));
  for (let x = 0; x < 32; x++) for (let y = 3; y < 7; y++) if (((x + y) % 4) < 2) px(ctx, x, y, 1, 1, tint(c, 1.15));
  px(ctx, 0, 3, 32, 1, tint(c, 1.5), 0.6);
}
