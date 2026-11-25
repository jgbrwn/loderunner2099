import Phaser from 'phaser';
import { Theme } from '../config';
import { drawCharacterFrames } from './CharacterArt';
import { rgba, shade, tint, mix, Rng } from './color';

const C = 32;          // atlas cell size
const COLS = 16;

type Ctx = CanvasRenderingContext2D;

/**
 * Builds one canvas atlas per theme (key = TileGraphics.key(theme)) holding every tile, character,
 * FX and HUD frame. One texture => sprites batch together.
 */
export class TileGraphics {
  static P2_COLOR = 0xffaa33;
  private scene: Phaser.Scene;
  constructor(scene: Phaser.Scene) { this.scene = scene; }

  static key(theme: Theme): string { return 'lr_atlas_' + theme.name.replace(/\W/g, ''); }

  /** Generates the atlas for `theme` if not cached; returns its texture key. */
  generateTextures(theme: Theme): string {
    const key = TileGraphics.key(theme);
    if (this.scene.textures.exists(key)) return key;
    const frames: { name: string; w: number; h: number; draw: (ctx: Ctx) => void }[] = [];
    const add = (name: string, draw: (ctx: Ctx) => void, w = C, h = C) => frames.push({ name, w, h, draw });

    for (let v = 0; v < 4; v++) add('brick' + v, ctx => drawBrick(ctx, theme, v));
    add('brick_trap', ctx => drawBrick(ctx, theme, 0, true));
    add('edge_top', ctx => drawEdge(ctx, theme));
    for (let v = 0; v < 2; v++) add('hard' + v, ctx => drawHard(ctx, theme, v));
    add('ladder', ctx => drawLadder(ctx, theme.ladder));
    // Escape ladder: the regular ladder alloyed with the theme's gold (it's what the gold unlocked) —
    // same shape, a clear but quiet hue shift. Themes can override via `exitLadder`.
    add('ladder_exit', ctx => drawLadder(ctx, theme.exitLadder ?? mix(theme.ladder, theme.gold, 0.42), true));
    add('pole', ctx => drawPole(ctx, theme));
    add('hole', ctx => drawHole(ctx, theme));
    for (let k = 0; k < 5; k++) add('crumble' + k, ctx => drawCrumble(ctx, theme, (k + 1) / 6));
    for (let k = 0; k < 4; k++) add('refill' + k, ctx => drawRefill(ctx, theme, (k + 1) / 5));
    add('warn', ctx => { ctx.fillStyle = rgba(0xff2040, 0.25); ctx.fillRect(1, 1, 30, 30); ctx.strokeStyle = rgba(0xff3050, 0.9); ctx.lineWidth = 2; ctx.strokeRect(1, 1, 30, 30); });
    for (let k = 0; k < 6; k++) add('gold' + k, ctx => drawGold(ctx, theme.gold, k, -1));
    // Guard-assisted gold bracket: must contrast with the gold on EVERY theme. Some themes have
    // gold and enemy colours that are near-identical (Matrix greens, Neon Noir pinks), so pick the
    // guard colour when it contrasts, else fall back to a bright cyan/white that reads on any theme.
    const lum = (c: number) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
    const gl = lum(theme.gold), el = lum(theme.enemy);
    const markColor = Math.abs(gl - el) > 60 ? theme.enemy : mix(theme.enemy, 0xffffff, 0.55);
    for (let k = 0; k < 6; k++) add('golda' + k, ctx => drawGold(ctx, theme.gold, k, markColor));
    // FX
    add('px', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 2, 2); }, 2, 2);
    add('spark', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(3, 0, 1, 7); ctx.fillRect(0, 3, 7, 1); ctx.fillRect(2, 2, 3, 3); }, 7, 7);
    add('glow', ctx => {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    });
    add('beam', ctx => {
      const g = ctx.createLinearGradient(0, 0, 32, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    });
    add('flash', ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 32, 32); });
    // characters
    const chars: [string, number, boolean][] = [['p1', theme.player, false], ['p2', TileGraphics.P2_COLOR, false], ['g', theme.enemy, true]];
    for (const [prefix, color, guard] of chars) {
      for (const f of drawCharacterFrames(color, guard)) add(`${prefix}_${f.name}`, ctx => ctx.drawImage(f.canvas, 0, 0));
    }
    // HUD icons
    add('life_p1', ctx => drawLifeIcon(ctx, theme.player), 12, 12);
    add('life_p2', ctx => drawLifeIcon(ctx, TileGraphics.P2_COLOR), 12, 12);
    add('pip_on', ctx => drawPip(ctx, theme.gold, true), 8, 8);
    add('pip_off', ctx => drawPip(ctx, theme.gold, false), 8, 8);
    add('icon_note', ctx => drawNote(ctx, theme.hudText), 14, 14);
    add('icon_radio', ctx => drawRadio(ctx, theme.hudText), 14, 14);
    add('icon_off', ctx => { drawNote(ctx, shade(theme.hudText, 0.5)); ctx.fillStyle = rgba(0xff3344); for (let i = 0; i < 14; i++) ctx.fillRect(i, 13 - i, 2, 1); }, 14, 14);

    const rows = Math.ceil(frames.length / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * C; canvas.height = rows * C;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    frames.forEach((f, i) => {
      const x = (i % COLS) * C, y = Math.floor(i / COLS) * C;
      ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, f.w, f.h); ctx.clip();
      f.draw(ctx); ctx.restore();
    });
    const tex = this.scene.textures.addCanvas(key, canvas)!;
    frames.forEach((f, i) => tex.add(f.name, 0, (i % COLS) * C, Math.floor(i / COLS) * C, f.w, f.h));
    return key;
  }
}

// ---------------------------------------------------------------- tiles
function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: number, a = 1): void {
  ctx.fillStyle = rgba(c, a); ctx.fillRect(x, y, w, h);
}

function drawBrick(ctx: Ctx, theme: Theme, variant: number, trap = false): void {
  const base = tint(theme.brick, 1.12);
  const mortar = shade(base, 0.35);
  const rng = new Rng(17 + variant * 101);
  px(ctx, 0, 0, 32, 32, mortar);
  for (let row = 0; row < 4; row++) {
    const y = row * 8;
    const off = row % 2 ? 8 : 0;
    for (let bx = -off; bx < 32; bx += 16) {
      const x0 = Math.max(0, bx), x1 = Math.min(31, bx + 15);
      const c = tint(base, 1 + (rng.next() - 0.5) * 0.16);
      px(ctx, x0, y, x1 - x0, 7, c);
      px(ctx, x0, y, x1 - x0, 1, tint(c, 1.45));
      px(ctx, x0, y + 1, 1, 5, tint(c, 1.18));
      px(ctx, x0, y + 6, x1 - x0, 1, shade(c, 0.72));
      // grain
      for (let i = 0; i < 3; i++) px(ctx, x0 + 2 + Math.floor(rng.next() * (x1 - x0 - 3)), y + 2 + Math.floor(rng.next() * 4), 1, 1, shade(c, 0.85));
    }
    if (trap && row === 2) px(ctx, 0, y, 32, 7, tint(base, 0.98)), px(ctx, 0, y, 32, 1, tint(base, 1.4)), px(ctx, 0, y + 6, 32, 1, shade(base, 0.72));
  }
  // wear variants
  if (variant === 1) { // crack
    let x = 6 + Math.floor(rng.next() * 18), y = 1;
    while (y < 30) { px(ctx, x, y, 1, 2, shade(base, 0.4)); y += 2; x += rng.next() < 0.5 ? -1 : 1; }
  } else if (variant === 2) { // chipped corners + specks
    px(ctx, 0, 0, 3, 2, mortar); px(ctx, 0, 2, 1, 1, mortar); px(ctx, 29, 24, 3, 2, mortar);
    for (let i = 0; i < 10; i++) px(ctx, Math.floor(rng.next() * 32), Math.floor(rng.next() * 32), 1, 1, tint(base, rng.next() < 0.5 ? 0.6 : 1.4));
  } else if (variant === 3) { // neon inlay
    const g = theme.ladder;
    px(ctx, 19, 11, 8, 1, g, 0.55); px(ctx, 26, 11, 1, 4, g, 0.55); px(ctx, 26, 15, 1, 1, g, 0.9);
    px(ctx, 18, 10, 2, 3, g, 0.25);
  }
}

function drawEdge(ctx: Ctx, theme: Theme): void {
  const c = mix(theme.brick, theme.ladder, 0.35);
  px(ctx, 0, 0, 32, 1, tint(c, 2.2), 0.95);
  px(ctx, 0, 1, 32, 1, tint(c, 1.6), 0.45);
}

function drawHard(ctx: Ctx, theme: Theme, variant: number): void {
  const base = mix(theme.brickHard, 0x8090a8, 0.3);
  px(ctx, 0, 0, 32, 32, shade(base, 0.3));
  // plate with vertical gradient
  for (let y = 1; y < 31; y++) px(ctx, 1, y, 30, 1, tint(base, 1.15 - y * 0.012));
  px(ctx, 1, 1, 30, 1, tint(base, 1.8)); px(ctx, 1, 1, 1, 30, tint(base, 1.45));
  px(ctx, 1, 30, 30, 1, shade(base, 0.5)); px(ctx, 30, 1, 1, 30, shade(base, 0.6));
  // rivets
  for (const [x, y] of [[4, 4], [26, 4], [4, 26], [26, 26]]) {
    px(ctx, x, y, 2, 2, shade(base, 0.45)); px(ctx, x, y, 1, 1, tint(base, 2)); px(ctx, x + 1, y + 2, 2, 1, shade(base, 0.6), 0.6);
  }
  if (variant === 0) { // inset panel
    px(ctx, 9, 9, 14, 1, shade(base, 0.55)); px(ctx, 9, 9, 1, 14, shade(base, 0.55));
    px(ctx, 9, 22, 14, 1, tint(base, 1.5)); px(ctx, 22, 9, 1, 14, tint(base, 1.5));
    px(ctx, 14, 14, 4, 4, mix(base, theme.ladder, 0.25));
  } else { // grooves
    for (const y of [10, 15, 20]) { px(ctx, 8, y, 16, 1, shade(base, 0.55)); px(ctx, 8, y + 1, 16, 1, tint(base, 1.4)); }
  }
}

function drawLadder(ctx: Ctx, color: number, exit = false): void {
  const core = mix(color, 0xffffff, 0.6);
  // glow halo
  for (const x of [5, 25]) { px(ctx, x - 2, 0, 6, 32, color, 0.12); px(ctx, x - 1, 0, 4, 32, color, 0.18); }
  for (let y = 3; y < 32; y += 8) px(ctx, 7, y - 1, 18, 4, color, 0.14);
  // rails
  for (const x of [5, 25]) { px(ctx, x, 0, 2, 32, color); px(ctx, x, 0, 1, 32, core); }
  // rungs
  for (let y = 3; y < 32; y += 8) { px(ctx, 7, y, 18, 2, color); px(ctx, 7, y, 18, 1, core); px(ctx, 7, y + 2, 18, 1, shade(color, 0.4), 0.6); }
  // escape ladder: a small bright stud mid-rung, in its own colour (not white) so it stays subtle
  if (exit) for (let y = 3; y < 32; y += 8) px(ctx, 15, y, 2, 2, tint(color, 1.5), 0.9);
}

function drawPole(ctx: Ctx, theme: Theme): void {
  const c = mix(mix(theme.pole, theme.ladder, 0.25), 0xffffff, 0.3);
  px(ctx, 0, 2, 32, 6, theme.ladder, 0.12);
  px(ctx, 0, 3, 32, 4, theme.ladder, 0.16);
  px(ctx, 0, 3, 32, 3, c);
  px(ctx, 0, 3, 32, 1, tint(c, 1.7));
  px(ctx, 0, 6, 32, 1, shade(c, 0.45));
  for (const x of [7, 23]) { px(ctx, x, 3, 2, 4, shade(c, 0.6)); px(ctx, x, 3, 1, 1, tint(c, 1.6)); }
}

function drawHole(ctx: Ctx, theme: Theme): void {
  for (let y = 0; y < 32; y++) px(ctx, 0, y, 32, 1, 0x000000, 0.25 + y * 0.012);
  const rng = new Rng(7);
  const c = theme.brick;
  for (let y = 0; y < 32; y += 2) { // jagged remnants at sides
    px(ctx, 0, y, 1 + Math.floor(rng.next() * 3), 2, shade(c, 0.8));
    const w = 1 + Math.floor(rng.next() * 3); px(ctx, 32 - w, y, w, 2, shade(c, 0.6));
  }
  for (let i = 0; i < 9; i++) px(ctx, 3 + Math.floor(rng.next() * 26), 29 + Math.floor(rng.next() * 3), 2, 1, tint(c, 0.7 + rng.next() * 0.6));
}

function brickCanvas(theme: Theme): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  drawBrick(cv.getContext('2d')!, theme, 0);
  return cv;
}

function drawCrumble(ctx: Ctx, theme: Theme, prog: number): void {
  const cv = brickCanvas(theme);
  const c2 = cv.getContext('2d')!;
  const img = c2.getImageData(0, 0, 32, 32);
  const rng = new Rng(Math.floor(prog * 1000));
  const edge: number[] = [];
  for (let x = 0; x < 32; x++) edge[x] = prog * 34 + (rng.next() - 0.5) * 8 - 2 + Math.abs(x - 16) * 0.15;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    if (y < edge[x]) img.data[i + 3] = 0;
    else if (y < edge[x] + 2) { img.data[i] = Math.min(255, img.data[i] + 90); img.data[i + 1] = Math.min(255, img.data[i + 1] + 70); img.data[i + 2] = Math.min(255, img.data[i + 2] + 40); }
  }
  c2.putImageData(img, 0, 0);
  // cracks
  c2.fillStyle = rgba(0x000000, 0.7);
  for (let k = 0; k < 3; k++) { let x = 6 + k * 10 + Math.floor(rng.next() * 4); for (let y = Math.floor(edge[x] || 0); y < 32 && y < (edge[x] || 0) + 6 + prog * 14; y++) { c2.fillRect(x, y, 1, 1); x += rng.next() < 0.5 ? -1 : 1; } }
  ctx.drawImage(cv, 0, 0);
}

function drawRefill(ctx: Ctx, theme: Theme, frac: number): void {
  drawHole(ctx, theme);
  const top = Math.round(32 * (1 - frac));
  ctx.drawImage(brickCanvas(theme), 0, top, 32, 32 - top, 0, top, 32, 32 - top);
  px(ctx, 0, top, 32, 1, mix(theme.ladder, 0xffffff, 0.5));
  px(ctx, 0, top - 1, 32, 1, theme.ladder, 0.5);
  px(ctx, 0, top - 3, 32, 2, theme.ladder, 0.18);
}

function drawGold(out: Ctx, color: number, k: number, mark: number): void {
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const ctx = cv.getContext('2d')!;
  drawGoldInto(ctx, color, k, mark);
  out.drawImage(cv, 0, 0);
}

function drawGoldInto(ctx: Ctx, color: number, k: number, mark: number): void {
  const light = mix(color, 0xffffff, 0.55), dark = shade(color, 0.45), out = shade(color, 0.2);
  // soft glow
  px(ctx, 4, 17, 24, 15, color, 0.12);
  const bar = (x: number, y: number) => {
    px(ctx, x, y, 12, 7, out);               // outline
    px(ctx, x + 2, y + 1, 8, 2, light);      // top face
    px(ctx, x + 1, y + 3, 10, 3, color);     // front
    px(ctx, x + 1, y + 5, 10, 1, dark);
    px(ctx, x + 2, y + 3, 1, 1, 0xffffff, 0.8);
  };
  bar(5, 24); bar(15, 24); bar(10, 18);
  // moving glint (frames 0..3), rest on 4..5
  if (k < 4) {
    const pos = 2 + k * 8;
    const img = ctx.getImageData(0, 0, 32, 32);
    for (let y = 16; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const d = x + (y - 16) * 0.7 - pos;
      if (img.data[i + 3] > 200 && d >= 0 && d < 3) { img.data[i] = img.data[i] / 3 + 170; img.data[i + 1] = img.data[i + 1] / 3 + 170; img.data[i + 2] = img.data[i + 2] / 3 + 170; }
    }
    ctx.putImageData(img, 0, 0);
  }
  if (k === 2) { px(ctx, 22, 14, 1, 5, 0xffffff); px(ctx, 20, 16, 5, 1, 0xffffff); }
  if (mark >= 0) { // enemy-assisted: brackets in guard colour
    for (const x of [1, 29]) { px(ctx, x, 16, 2, 15, mark, 0.9); }
    px(ctx, 1, 16, 5, 2, mark); px(ctx, 26, 16, 5, 2, mark); px(ctx, 1, 29, 5, 2, mark); px(ctx, 26, 29, 5, 2, mark);
  }
}

// ---------------------------------------------------------------- HUD icons
function drawLifeIcon(ctx: Ctx, c: number): void {
  px(ctx, 2, 1, 8, 8, shade(c, 0.3)); px(ctx, 3, 1, 6, 1, c); px(ctx, 2, 2, 8, 6, c); px(ctx, 3, 8, 6, 1, c);
  px(ctx, 5, 3, 5, 3, 0xbff8ff); px(ctx, 6, 3, 2, 1, 0xffffff);
  px(ctx, 3, 9, 6, 3, shade(c, 0.7));
}
function drawPip(ctx: Ctx, c: number, on: boolean): void {
  if (on) { px(ctx, 1, 2, 6, 4, c); px(ctx, 2, 1, 4, 1, mix(c, 0xffffff, 0.6)); px(ctx, 1, 6, 6, 1, shade(c, 0.5)); }
  else { px(ctx, 1, 2, 6, 4, c, 0.3); px(ctx, 1, 2, 6, 1, c, 0.7); }
}
function drawNote(ctx: Ctx, c: number): void {
  px(ctx, 5, 1, 8, 2, c); px(ctx, 5, 1, 2, 10, c); px(ctx, 11, 1, 2, 8, c);
  px(ctx, 2, 9, 5, 4, c); px(ctx, 8, 7, 5, 4, c);
}
function drawRadio(ctx: Ctx, c: number): void {
  px(ctx, 1, 5, 12, 8, c); px(ctx, 3, 7, 4, 4, shade(c, 0.3)); px(ctx, 9, 7, 2, 1, shade(c, 0.3)); px(ctx, 9, 9, 2, 1, shade(c, 0.3));
  for (let i = 0; i < 5; i++) px(ctx, 3 + i * 2, 4 - Math.round(i * 0.8), 1, 1, c);
}
