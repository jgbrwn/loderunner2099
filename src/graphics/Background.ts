import Phaser from 'phaser';
import { Theme } from '../config';
import { rgba, mix, Rng } from './color';

interface LayerDef { draw: (ctx: CanvasRenderingContext2D, t: Theme, r: Rng) => void; vx: number; vy: number; alpha: number }
const S = 512; // layer canvas size (power of two, tiles seamlessly)

/** Subtle procedural parallax backdrop per theme, rendered as repeating TileSprites inside a field. */
export class Background {
  private layers: { ts: Phaser.GameObjects.TileSprite; vx: number; vy: number }[] = [];

  constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, theme: Theme, w: number, h: number, private still: boolean, variant = 0) {
    const defs = Background.defs(theme, variant);
    Background.prepare(scene, theme, variant);
    defs.forEach((d, i) => {
      const key = Background.texKey(theme, variant, i);
      const ts = scene.add.tileSprite(0, 0, w, h, key).setOrigin(0).setAlpha(d.alpha);
      parent.add(ts);
      this.layers.push({ ts, vx: d.vx, vy: d.vy });
    });
  }

  /** Generate (and cache) the layer textures for `theme`. */
  /** number of backdrop variants a theme has */
  static variants(theme: Theme): number { return DEFS_B[theme.id ?? ''] ? 2 : 1; }
  private static v(theme: Theme, variant: number): number { return variant % Background.variants(theme); }
  private static defs(theme: Theme, variant: number): LayerDef[] {
    const id = theme.id ?? 'cyber';
    return Background.v(theme, variant) ? DEFS_B[id] : DEFS[id] ?? DEFS.cyber;
  }
  private static texKey(theme: Theme, variant: number, i: number): string { return `bg_${theme.id ?? 'cyber'}_v${Background.v(theme, variant)}_${i}`; }

  static prepare(scene: Phaser.Scene, theme: Theme, variant = 0): void {
    Background.defs(theme, variant).forEach((d, i) => {
      const key = Background.texKey(theme, variant, i);
      if (scene.textures.exists(key)) return;
      const c = document.createElement('canvas'); c.width = c.height = S;
      d.draw(c.getContext('2d')!, theme, new Rng(1234 + i * 77));
      scene.textures.addCanvas(key, c);
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
  dungeon: [
    { vx: 2, vy: 0, alpha: 1, draw: (c, t, r) => {
      const wall = mix(t.background, t.brick, 0.22);
      for (let y = 0; y < S; y += 24) for (let x = (y / 24) % 2 ? -24 : 0; x < S; x += 48) { // big masonry
        c.fillStyle = rgba(mix(wall, 0x000000, r.next() * 0.25)); c.fillRect(x + 1, y + 1, 46, 22);
      }
      for (let ax = 0; ax < S; ax += 128) { // arches
        const cx = ax + 64, top = 220, hw = 38;
        c.fillStyle = rgba(mix(t.background, 0x000000, 0.5));
        c.beginPath(); c.arc(cx, top, hw, Math.PI, 0); c.lineTo(cx + hw, S); c.lineTo(cx - hw, S); c.closePath(); c.fill();
        c.strokeStyle = rgba(mix(wall, 0xffffff, 0.08)); c.lineWidth = 4; c.beginPath(); c.arc(cx, top, hw + 3, Math.PI, 0); c.stroke();
        // torch between arches
        const tx = ax + 128 - 0, ty = 250;
        const g = c.createRadialGradient(tx, ty, 0, tx, ty, 46); g.addColorStop(0, 'rgba(255,150,50,0.35)'); g.addColorStop(1, 'rgba(255,120,40,0)');
        c.fillStyle = g; c.fillRect(tx - 46, ty - 46, 92, 92);
        c.fillStyle = rgba(0x2a2018); c.fillRect(tx - 2, ty + 4, 4, 12);
        c.fillStyle = rgba(0xffb040, 0.8); c.fillRect(tx - 2, ty - 3, 4, 6); c.fillStyle = rgba(0xffe080, 0.9); c.fillRect(tx - 1, ty - 1, 2, 3);
      }
      c.fillStyle = rgba(0x606070, 0.35); // hanging chains
      for (let i = 0; i < 5; i++) { const x = 20 + Math.floor(r.next() * (S - 40)), len = 60 + Math.floor(r.next() * 140); for (let y = 0; y < len; y += 6) c.fillRect(x + (y / 6 % 2), y, 2, 4); }
    } },
    { vx: 3, vy: -12, alpha: 0.6, draw: (c, _t, r) => {
      for (let i = 0; i < 70; i++) { c.fillStyle = rgba(r.next() < 0.5 ? 0xff9a30 : 0xffd070, 0.3 + r.next() * 0.5); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), 1 + (r.next() < 0.2 ? 1 : 0), 1); }
    } },
  ],
  palace: [
    { vx: 1, vy: 0, alpha: 1, draw: (c, t) => {
      const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, rgba(t.background, 0)); g.addColorStop(1, rgba(0x6a3a10, 0.4));
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      c.fillStyle = rgba(0xffd080, 0.12); c.beginPath(); c.arc(380, 150, 40, 0, Math.PI * 2); c.fill();
      c.fillStyle = rgba(mix(t.background, t.brick, 0.28)); // pyramids
      for (const [cx, w, base] of [[150, 300, 470], [360, 200, 470]]) { c.beginPath(); c.moveTo(cx - w / 2, base); c.lineTo(cx, base - w * 0.55); c.lineTo(cx + w / 2, base); c.closePath(); c.fill(); }
      c.fillRect(0, 470, S, S - 470);
    } },
    { vx: 6, vy: 0, alpha: 1, draw: (c, t) => {
      const col = mix(t.background, t.brick, 0.34), dk = mix(t.background, 0x000000, 0.2), trim = mix(t.background, t.pole, 0.3);
      c.fillStyle = rgba(col); c.fillRect(0, 96, S, 26); c.fillStyle = rgba(trim); c.fillRect(0, 122, S, 4); c.fillRect(0, 92, S, 4);
      for (let x = 0; x < S; x += 16) { c.fillStyle = rgba(dk); c.fillRect(x + 4, 102, 8, 14); } // frieze
      for (let x = 20; x < S; x += 64) { // columns
        c.fillStyle = rgba(trim); c.fillRect(x - 5, 126, 30, 8); c.fillRect(x - 5, S - 10, 30, 10);
        c.fillStyle = rgba(col); c.fillRect(x, 134, 20, S - 144);
        c.fillStyle = rgba(dk); for (const f of [4, 9, 14]) c.fillRect(x + f, 138, 2, S - 152);
      }
    } },
    { vx: 9, vy: -3, alpha: 0.5, draw: (c, _t, r) => {
      for (let i = 0; i < 90; i++) { c.fillStyle = rgba(0xffe0a0, 0.15 + r.next() * 0.35); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), 1, 1); }
    } },
  ],
  foundry: [
    { vx: 1, vy: 0, alpha: 1, draw: (c, t, r) => {
      for (let i = 0; i < 220; i++) { c.fillStyle = rgba(r.next() < 0.1 ? 0xffc080 : 0xd0e0ff, 0.2 + r.next() * 0.6); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), 1, 1); }
      const g = c.createRadialGradient(300, 600, 120, 300, 600, 220); g.addColorStop(0, rgba(0x2a4a7a, 0.55)); g.addColorStop(0.8, rgba(0x2a4a7a, 0.35)); g.addColorStop(1, rgba(0x6aa0ff, 0));
      c.fillStyle = g; c.beginPath(); c.arc(300, 600, 220, 0, Math.PI * 2); c.fill();
      c.strokeStyle = rgba(0x8ac0ff, 0.25); c.lineWidth = 2; c.beginPath(); c.arc(300, 600, 200, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
      void t;
    } },
    { vx: 6, vy: 0, alpha: 1, draw: (c, t, r) => {
      const m = mix(t.background, 0x8090a0, 0.2), lamp = t.ladder;
      for (const y of [70, 400]) { // girders with lattice
        c.fillStyle = rgba(m); c.fillRect(0, y, S, 4); c.fillRect(0, y + 24, S, 4);
        c.strokeStyle = rgba(m); c.lineWidth = 2; c.beginPath();
        for (let x = 0; x < S; x += 32) { c.moveTo(x, y + 26); c.lineTo(x + 16, y + 2); c.lineTo(x + 32, y + 26); }
        c.stroke();
      }
      for (let x = 40; x < S; x += 128) { c.fillStyle = rgba(m); c.fillRect(x, 98, 10, 302); c.fillStyle = rgba(mix(m, 0x000000, 0.3)); c.fillRect(x - 14, 180 + Math.floor(r.next() * 120), 38, 26); }
      for (let i = 0; i < 18; i++) { c.fillStyle = rgba(lamp, 0.5 + r.next() * 0.4); c.fillRect(Math.floor(r.next() * S / 8) * 8 + 3, [74, 92, 404, 422][i % 4], 2, 2); }
    } },
  ],
  cyber: [
    { vx: 3, vy: 0, alpha: 1, draw: (c, t, r) => skyline(c, r, S, 120, 300, mix(t.background, 0x2244aa, 0.18), t.ladder, 0.35) },
    { vx: 8, vy: 0, alpha: 1, draw: (c, t, r) => {
      skyline(c, r, S, 40, 170, mix(t.background, 0x000000, 0.35), 0xff44cc, 0.4, 20, 60);
      c.fillStyle = rgba(t.ladder, 0.12); for (let y = 0; y < S; y += 64) c.fillRect(0, y + 30, S, 1);
    } },
  ],
  matrix: [0, 1].map(i => ({
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
  sunset: [
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
  neon: [
    { vx: 2, vy: 0, alpha: 1, draw: (c, _t, r) => {
      skyline(c, r, S, 140, 340, 0x101014, 0xff0088, 0.3, 16, 48);
      for (let i = 0; i < 6; i++) { c.fillStyle = rgba(i % 2 ? 0x00ffff : 0xff0088, 0.25); c.fillRect(Math.floor(r.next() * S), 200 + Math.floor(r.next() * 200), 4, 18); }
    } },
    { vx: -30, vy: -160, alpha: 0.5, draw: (c, _t, r) => {
      c.fillStyle = rgba(0x8899bb, 0.25);
      for (let i = 0; i < 160; i++) { const x = Math.floor(r.next() * S), y = Math.floor(r.next() * S); c.fillRect(x, y, 1, 6); }
    } },
  ],
  classic: [0, 1].map(i => ({
    vx: 4 + i * 10, vy: 0, alpha: 1, draw: (c: CanvasRenderingContext2D, _t: Theme, r: Rng) => {
      for (let k = 0; k < 70; k++) { c.fillStyle = rgba(0xa0a0ff, i ? 0.35 : 0.18); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), i + 1, 1); }
    },
  })),
};

// ---------------------------------------------------------------- alternate backdrops (variant 1)
// A set's backdrop alternates between DEFS and DEFS_B every 2–3 levels (fixed themes) or on each return (Auto Tour).
const glow = (c: CanvasRenderingContext2D, x: number, y: number, r: number, col: number, a: number) => {
  const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
};
const DEFS_B: Record<string, LayerDef[]> = {
  cyber: [ // megatowers + sky traffic
    { vx: 2, vy: 0, alpha: 1, draw: (c, t, r) => {
      let x = 0;
      while (x < S) {
        const w = 40 + Math.floor(r.next() * 40), h = 280 + Math.floor(r.next() * 180);
        c.fillStyle = rgba(mix(t.background, 0x2244aa, 0.16)); c.fillRect(x, S - h, Math.min(w, S - x) - 6, h);
        c.fillStyle = rgba(t.ladder, 0.22); for (let sx = x + 6; sx < x + w - 10; sx += 10) c.fillRect(sx, S - h + 10, 2, h - 10);
        c.fillStyle = rgba(0xff3355, 0.8); c.fillRect(x + (w >> 1) - 3, S - h - 14, 2, 14); c.fillRect(x + (w >> 1) - 4, S - h - 15, 4, 2);
        x += w;
      }
    } },
    { vx: 40, vy: 0, alpha: 0.8, draw: (c, _t, r) => {
      for (const y of [130, 170, 215, 260]) for (let i = 0; i < 10; i++) {
        c.fillStyle = rgba(r.next() < 0.5 ? 0xffffff : 0xff44cc, 0.35 + r.next() * 0.3);
        c.fillRect(Math.floor(r.next() * S), y + Math.floor(r.next() * 6), 6 + Math.floor(r.next() * 10), 1);
      }
    } },
  ],
  neon: [ // sign alley
    { vx: 2, vy: 0, alpha: 1, draw: (c, _t, r) => {
      skyline(c, r, S, 120, 300, 0x0c0c10, 0x00ffff, 0.2, 24, 60);
      for (let i = 0; i < 9; i++) {
        const x = Math.floor(r.next() * (S - 20)), y = 150 + Math.floor(r.next() * 220), col = i % 2 ? 0x00ffff : 0xff0088;
        c.strokeStyle = rgba(col, 0.4); c.lineWidth = 2; c.strokeRect(x, y, 14, 54);
        c.fillStyle = rgba(col, 0.3); for (let k = 0; k < 4; k++) c.fillRect(x + 4, y + 5 + k * 12, 6, 7);
      }
      c.strokeStyle = rgba(0x303040, 0.8); c.lineWidth = 1;
      for (const y of [110, 140]) { c.beginPath(); c.moveTo(0, y); c.quadraticCurveTo(S / 2, y + 40, S, y); c.stroke(); }
    } },
    { vx: -30, vy: -160, alpha: 0.5, draw: (c, _t, r) => {
      c.fillStyle = rgba(0x8899bb, 0.25);
      for (let i = 0; i < 160; i++) c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), 1, 6);
    } },
  ],
  matrix: [ // circuit traces + slow falling bits
    { vx: 0, vy: 0, alpha: 1, draw: (c, t, r) => {
      for (let n = 0; n < 26; n++) {
        let x = Math.floor(r.next() * 32) * 16, y = Math.floor(r.next() * 32) * 16;
        c.fillStyle = rgba(t.ladder, 0.16);
        for (let s = 0; s < 6; s++) {
          const horiz = r.next() < 0.5, len = (1 + Math.floor(r.next() * 4)) * 16;
          if (horiz) { c.fillRect(Math.min(x, x + len), y, len, 2); x = (x + len) % S; } else { c.fillRect(x, y, 2, len); y = (y + len) % S; }
        }
        c.fillStyle = rgba(t.ladder, 0.45); c.fillRect(x - 1, y - 1, 4, 4);
      }
    } },
    { vx: 0, vy: -24, alpha: 0.5, draw: (c, t, r) => {
      for (let i = 0; i < 120; i++) { c.fillStyle = rgba(t.ladder, 0.15 + r.next() * 0.3); c.fillRect(Math.floor(r.next() * S / 6) * 6, Math.floor(r.next() * S), 2, 2); }
    } },
  ],
  sunset: [ // palm beach at dusk
    { vx: 0, vy: 0, alpha: 1, draw: (c, t) => {
      const g = c.createLinearGradient(0, 0, 0, 400); g.addColorStop(0, rgba(t.background, 0)); g.addColorStop(1, rgba(0xa02a6a, 0.45));
      c.fillStyle = g; c.fillRect(0, 0, S, 400);
      glow(c, 256, 380, 120, 0xffb040, 0.35);
      c.fillStyle = rgba(0x1a0a30, 0.9); c.fillRect(0, 400, S, S - 400);
      for (let y = 404; y < S; y += 6) { const hw = 70 - (y - 400) * 0.35; c.fillStyle = rgba(0xff9040, 0.25); c.fillRect(256 - hw, y, hw * 2, 2); }
    } },
    { vx: 5, vy: 0, alpha: 1, draw: (c, t) => {
      const col = rgba(mix(t.background, 0x000000, 0.5));
      for (const [bx, lean] of [[70, 1], [200, -1], [420, 1]]) {
        c.fillStyle = col; let x = bx;
        for (let y = 400; y > 250; y -= 4) { c.fillRect(x, y, 6, 5); x += lean * (400 - y) / 120; }
        c.strokeStyle = col; c.lineWidth = 3;
        for (const [dx, dy] of [[-40, 18], [40, 18], [-30, -14], [32, -12], [0, -24]]) { c.beginPath(); c.moveTo(x + 3, 252); c.quadraticCurveTo(x + 3 + dx / 2, 240 + dy / 3, x + 3 + dx, 252 + dy); c.stroke(); }
      }
    } },
  ],
  dungeon: [ // crypt: barred cells and skull niches
    { vx: 2, vy: 0, alpha: 1, draw: (c, t, r) => {
      const wall = mix(t.background, t.brick, 0.2);
      for (let y = 0; y < S; y += 24) for (let x = (y / 24) % 2 ? -24 : 0; x < S; x += 48) { c.fillStyle = rgba(mix(wall, 0x000000, r.next() * 0.25)); c.fillRect(x + 1, y + 1, 46, 22); }
      for (let x = 8; x < S; x += 32) { // skull niches
        c.fillStyle = rgba(0x000000, 0.55); c.fillRect(x, 100, 18, 16);
        c.fillStyle = rgba(0xd8cfb8, 0.35); c.fillRect(x + 5, 104, 8, 6); c.fillRect(x + 6, 110, 6, 3);
        c.fillStyle = rgba(0x000000, 0.6); c.fillRect(x + 6, 106, 2, 2); c.fillRect(x + 10, 106, 2, 2);
      }
      for (let ax = 24; ax < S; ax += 128) { // portcullis cells
        c.fillStyle = rgba(mix(t.background, 0x000000, 0.55)); c.fillRect(ax, 230, 80, S - 230);
        c.fillStyle = rgba(0x40404a, 0.8); for (let bx = ax + 6; bx < ax + 80; bx += 12) c.fillRect(bx, 230, 3, S - 230);
        c.fillRect(ax, 280, 80, 3); c.fillRect(ax, 380, 80, 3);
        glow(c, ax + 104, 250, 40, 0x60a0ff, 0.18); // cold lantern
      }
    } },
    { vx: 0, vy: 10, alpha: 0.55, draw: (c, _t, r) => {
      for (let i = 0; i < 50; i++) { c.fillStyle = rgba(0x9ab8d8, 0.25 + r.next() * 0.4); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), 1, 2); }
    } },
  ],
  palace: [ // throne hall: lattice windows, light shafts, banners
    { vx: 1, vy: 0, alpha: 1, draw: (c, t) => {
      for (let wx = 40; wx < S; wx += 128) {
        c.fillStyle = rgba(0xffd890, 0.06);
        c.beginPath(); c.moveTo(wx, 140); c.lineTo(wx + 36, 140); c.lineTo(wx + 110, S); c.lineTo(wx + 40, S); c.closePath(); c.fill();
        c.fillStyle = rgba(mix(t.background, 0xffc070, 0.25)); c.beginPath(); c.arc(wx + 18, 70, 18, Math.PI, 0); c.fillRect(wx, 70, 36, 70); c.fill();
        c.fillStyle = rgba(mix(t.background, 0x000000, 0.3)); for (let k = 0; k < 5; k++) { c.fillRect(wx + 2 + k * 8, 56, 2, 84); c.fillRect(wx, 74 + k * 14, 36, 2); }
      }
    } },
    { vx: 6, vy: 0, alpha: 1, draw: (c, t) => {
      const trim = mix(t.background, t.pole, 0.45);
      for (let bx = 100; bx < S; bx += 128) {
        c.fillStyle = rgba(trim); c.fillRect(bx - 4, 30, 34, 4);
        c.fillStyle = rgba(mix(t.background, 0x8a1a2a, 0.5)); c.fillRect(bx, 34, 26, 140);
        c.beginPath(); c.moveTo(bx, 174); c.lineTo(bx + 13, 190); c.lineTo(bx + 26, 174); c.fill();
        c.fillStyle = rgba(trim); c.fillRect(bx + 2, 36, 2, 136); c.fillRect(bx + 22, 36, 2, 136);
        c.beginPath(); c.arc(bx + 13, 90, 6, 0, Math.PI * 2); c.fill();
      }
    } },
    { vx: 9, vy: -3, alpha: 0.5, draw: (c, _t, r) => {
      for (let i = 0; i < 90; i++) { c.fillStyle = rgba(0xffe0a0, 0.15 + r.next() * 0.35); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), 1, 1); }
    } },
  ],
  foundry: [ // nebula, orbital ring, cargo yard
    { vx: 1, vy: 0, alpha: 1, draw: (c, _t, r) => {
      glow(c, 150, 180, 160, 0x7a3aa0, 0.22); glow(c, 380, 300, 140, 0x2a8a9a, 0.18);
      for (let i = 0; i < 220; i++) { c.fillStyle = rgba(0xd0e0ff, 0.2 + r.next() * 0.6); c.fillRect(Math.floor(r.next() * S), Math.floor(r.next() * S), 1, 1); }
      c.strokeStyle = rgba(0xa0c0ff, 0.22); c.lineWidth = 3; c.beginPath(); c.ellipse(256, 160, 230, 40, -0.12, 0, Math.PI * 2); c.stroke();
    } },
    { vx: 8, vy: 0, alpha: 1, draw: (c, t, r) => {
      const m = mix(t.background, 0x8090a0, 0.2);
      for (let x = 0; x < S; x += 64) {
        const stack = 1 + Math.floor(r.next() * 3);
        for (let k = 0; k < stack; k++) { c.fillStyle = rgba(mix(m, k % 2 ? 0x803020 : 0x204060, 0.25)); c.fillRect(x + 2, S - 30 - k * 30, 58, 28); c.fillStyle = rgba(0x000000, 0.25); for (let s = x + 6; s < x + 58; s += 6) c.fillRect(s, S - 28 - k * 30, 1, 24); }
      }
      c.fillStyle = rgba(m); c.fillRect(300, 120, 8, S - 120); c.fillRect(200, 120, 180, 6); c.fillRect(220, 126, 2, 80);
      for (let i = 0; i < 10; i++) { c.fillStyle = rgba(t.ladder, 0.6 + r.next() * 0.3); c.fillRect(200 + Math.floor(r.next() * 180), 118, 2, 2); }
    } },
  ],
};
