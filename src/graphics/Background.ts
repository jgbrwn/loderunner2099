import Phaser from 'phaser';
import { Theme } from '../config';
import { rgba, mix, Rng } from './color';

interface LayerDef { draw: (ctx: CanvasRenderingContext2D, t: Theme, r: Rng) => void; vx: number; vy: number; alpha: number }
const S = 512; // layer canvas size (power of two, tiles seamlessly)

/** Subtle procedural parallax backdrop per theme, rendered as repeating TileSprites inside a field. */
export class Background {
  private layers: { ts: Phaser.GameObjects.TileSprite; vx: number; vy: number }[] = [];

  constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, theme: Theme, w: number, h: number, private still: boolean) {
    const defs = DEFS[theme.name] ?? DEFS['CYBER BLUE'];
    defs.forEach((d, i) => {
      const key = `bg_${theme.name.replace(/\W/g, '')}_${i}`;
      if (!scene.textures.exists(key)) {
        const c = document.createElement('canvas'); c.width = c.height = S;
        const ctx = c.getContext('2d')!;
        d.draw(ctx, theme, new Rng(1234 + i * 77));
        scene.textures.addCanvas(key, c);
      }
      const ts = scene.add.tileSprite(0, 0, w, h, key).setOrigin(0).setAlpha(d.alpha);
      parent.add(ts);
      this.layers.push({ ts, vx: d.vx, vy: d.vy });
    });
  }

  update(time: number): void {
    if (this.still) return;
    const s = time / 1000;
    for (const l of this.layers) { l.ts.tilePositionX = s * l.vx; l.ts.tilePositionY = s * l.vy; }
  }

  destroy(): void { for (const l of this.layers) l.ts.destroy(); this.layers = []; }
}

function skyline(ctx: CanvasRenderingContext2D, r: Rng, base: number, minH: number, maxH: number, body: number, win: number, winA: number, wmin = 10, wmax = 34): void {
  let x = 0;
  while (x < S) {
    const w = Math.min(S - x, wmin + Math.floor(r.next() * (wmax - wmin)));
    const h = minH + Math.floor(r.next() * (maxH - minH));
    ctx.fillStyle = rgba(body); ctx.fillRect(x, base - h, w - 2, h + (S - base));
    if (r.next() < 0.3) { ctx.fillRect(x + (w >> 1) - 1, base - h - 10, 1, 10); ctx.fillStyle = rgba(0xff3355, 0.8); ctx.fillRect(x + (w >> 1) - 1, base - h - 11, 1, 1); }
    for (let wy = base - h + 4; wy < base - 2; wy += 5) for (let wx = x + 2; wx < x + w - 4; wx += 4) {
      if (r.next() < 0.22) { ctx.fillStyle = rgba(win, winA * (0.4 + r.next() * 0.6)); ctx.fillRect(wx, wy, 2, 2); }
    }
    x += w;
  }
}

const DEFS: Record<string, LayerDef[]> = {
  'CYBER BLUE': [
    { vx: 3, vy: 0, alpha: 1, draw: (c, t, r) => skyline(c, r, S, 120, 300, mix(t.background, 0x2244aa, 0.18), t.ladder, 0.35) },
    { vx: 8, vy: 0, alpha: 1, draw: (c, t, r) => {
      skyline(c, r, S, 40, 170, mix(t.background, 0x000000, 0.35), 0xff44cc, 0.4, 20, 60);
      c.fillStyle = rgba(t.ladder, 0.12); for (let y = 0; y < S; y += 64) c.fillRect(0, y + 30, S, 1);
    } },
  ],
  'MATRIX': [0, 1].map(i => ({
    vx: 0, vy: -(14 + i * 22), alpha: i ? 0.7 : 0.45, draw: (c: CanvasRenderingContext2D, t: Theme, r: Rng) => {
      for (let col = 0; col < S / 12; col++) {
        if (r.next() < 0.45) continue;
        const x = col * 12 + (i ? 6 : 0);
        let y = Math.floor(r.next() * S);
        const len = 8 + Math.floor(r.next() * 18);
        for (let k = 0; k < len; k++) {
          const a = (k === len - 1 ? 0.9 : 0.12 + 0.4 * k / len) * (i ? 0.5 : 0.35);
          for (let p = 0; p < 6; p++) if (r.next() < 0.5) { c.fillStyle = rgba(k === len - 1 ? 0xccffcc : t.ladder, a); c.fillRect(x + (p % 2) * 2, (y + Math.floor(p / 2) * 2) % S, 2, 2); }
          y = (y + 8) % S;
        }
      }
    },
  })),
  'SUNSET CHROME': [
    { vx: 0, vy: 0, alpha: 1, draw: (c, t) => {
      const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, rgba(t.background, 0)); g.addColorStop(1, rgba(0x6a1a5a, 0.5));
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      const cx = 256, cy = 300, R = 110;
      for (let y = cy - R; y < cy + R * 0.35; y++) {
        const band = y > cy - 20 && ((y - cy) % 12 + 12) % 12 < 2 + (y - cy) / 12; if (band) continue;
        const hw = Math.sqrt(Math.max(0, R * R - (y - cy) ** 2));
        c.fillStyle = rgba(mix(0xffd040, 0xff2a80, (y - cy + R) / (R * 1.35)), 0.28); c.fillRect(cx - hw, y, hw * 2, 1);
      }
    } },
    { vx: 5, vy: 0, alpha: 1, draw: (c, t, r) => {
      let h = 380; c.fillStyle = rgba(mix(t.background, 0x000000, 0.4));
      for (let x = 0; x < S; x++) { h += (r.next() - 0.5) * 6 + (x < S / 2 ? -0.08 : 0.08); h = Math.max(330, Math.min(440, h)); c.fillRect(x, h, 1, S - h); }
      c.fillStyle = rgba(0xff44aa, 0.14); for (let y = 420; y < S; y += 8 + (y - 420) / 4) c.fillRect(0, y, S, 1);
      for (let x = 0; x < S; x += 32) c.fillRect(x, 420, 1, S - 420);
    } },
  ],
  'NEON NOIR': [
    { vx: 2, vy: 0, alpha: 1, draw: (c, _t, r) => {
      skyline(c, r, S, 140, 340, 0x101014, 0xff0088, 0.3, 16, 48);
      for (let i = 0; i < 6; i++) { c.fillStyle = rgba(i % 2 ? 0x00ffff : 0xff0088, 0.25); c.fillRect(Math.floor(r.next() * S), 200 + Math.floor(r.next() * 200), 4, 18); }
    } },
    { vx: -30, vy: -160, alpha: 0.5, draw: (c, _t, r) => {
      c.fillStyle = rgba(0x8899bb, 0.25);
      for (let i = 0; i < 160; i++) { const x = Math.floor(r.next() * S), y = Math.floor(r.next() * S); c.fillRect(x, y, 1, 6); }
    } },
  ],
  'CLASSIC C64': [0, 1].map(i => ({
    vx: 4 + i * 10, vy: 0, alpha: 1, draw: (c: CanvasRenderingContext2D, _t: Theme, r: Rng) => {
      for (let k = 0; k < 70; k++) { c.fillStyle = rgba(0xa0a0ff, i ? 0.35 : 0.18); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), i + 1, 1); }
    },
  })),
};
