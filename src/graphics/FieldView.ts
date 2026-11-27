import Phaser from 'phaser';
import { CONFIG, Theme, TileType as T } from '../config';
import type { World } from '../sim/World';
import { SUB, DIG_TICKS, HOLE_WARN_TICKS, GUARD_SPAWN_ANIM_TICKS, SCORE, type SimEvent, type Actor } from '../sim/types';
import { TileGraphics } from './TileGraphics';
import { Background } from './Background';
import { FieldLayout, FIELD_W, FIELD_H, reducedMotion } from './Layout';
import { mix, hex } from './color';

const TS = CONFIG.TILE_SIZE;
const U = TS / SUB;               // pixels per sim unit
const REFILL_TICKS = 24;          // last ticks of a hole show the refill animation
const INTRO_STEP = 13;            // ms per diagonal step of the board draw-in
const ADD = Phaser.BlendModes.ADD;

type Img = Phaser.GameObjects.Image;
interface Particle { img: Img; x: number; y: number; vx: number; vy: number; g: number; t0: number; life: number; s0: number; s1: number; a0: number }

/** Pool of images inside a container; begin()/get()/end() per frame, unused ones hidden. */
class Pool {
  private items: Img[] = []; private n = 0;
  constructor(private scene: Phaser.Scene, private parent: Phaser.GameObjects.Container, private tex: string) {}
  begin(): void { this.n = 0; }
  get(frame: string, x: number, y: number): Img {
    let im = this.items[this.n];
    if (!im) { im = this.scene.add.image(0, 0, this.tex, frame); this.parent.add(im); this.items.push(im); }
    this.n++;
    return im.setFrame(frame).setPosition(x, y).setVisible(true).setAlpha(1).setScale(1).setTint(0xffffff).setBlendMode(Phaser.BlendModes.NORMAL);
  }
  end(): void { for (let i = this.n; i < this.items.length; i++) this.items[i].setVisible(false); }
}

/**
 * Renders one World (sim) into a container placed by a FieldLayout (origin + scale), so several
 * views can coexist (split-screen). Static tiles live in a RenderTexture updated per changed cell.
 */
export class FieldView {
  readonly root: Phaser.GameObjects.Container;
  private scene: Phaser.Scene;
  private layout: FieldLayout;
  private theme: Theme;
  private tex = '';
  private world: World | null = null;
  private reduced = reducedMotion();

  private bgLayer!: Phaser.GameObjects.Container;
  private bg: Background | null = null;
  private rt!: Phaser.GameObjects.RenderTexture;
  private under!: Pool; private gold!: Pool; private actors!: Pool; private over!: Pool;
  private fxLayer!: Phaser.GameObjects.Container;
  private lasers!: Phaser.GameObjects.Graphics;
  private fxImgs: Img[] = [];
  private particles: Particle[] = [];
  private flashImg!: Img;

  private cells: string[] = [];
  private anim = new Map<string, { x: number; y: number; d: number }>();
  private deathT: number[] = [];
  private introStart = 0; private outroStart = -1; private outroCb: (() => void) | null = null;
  private exitT = -1;
  private shakeUntil = 0; private shakeMag = 0; private shakeLen = 1;
  private flashUntil = 0; private flashColor = 0xffffff;
  private lastTime = 0;

  constructor(scene: Phaser.Scene, layout: FieldLayout, theme: Theme) {
    this.scene = scene;
    this.layout = layout;
    this.theme = theme;
    this.root = scene.add.container(layout.x, layout.y).setScale(layout.scale).setDepth(10);
    this.build();
  }

  private build(): void {
    const s = this.scene;
    this.tex = new TileGraphics(s).generateTextures(this.theme);
    this.root.removeAll(true);
    this.fxImgs = []; this.particles = [];
    const bgFill = s.add.rectangle(0, 0, FIELD_W, FIELD_H, mix(this.theme.background, 0x000000, 0.25)).setOrigin(0);
    this.bgLayer = s.add.container(0, 0).setAlpha(0.75);
    this.bg?.destroy();
    this.bg = new Background(s, this.bgLayer, this.theme, FIELD_W, FIELD_H, this.reduced, this.bgVariant);
    this.rt = s.add.renderTexture(0, 0, FIELD_W, FIELD_H).setOrigin(0);
    const layer = () => s.add.container(0, 0);
    const underC = layer(), goldC = layer(), actorC = layer(), overC = layer();
    this.fxLayer = layer();
    this.lasers = s.add.graphics();
    this.flashImg = s.add.image(0, 0, this.tex, 'flash').setOrigin(0).setScale(FIELD_W / 32, FIELD_H / 32).setVisible(false);
    this.root.add([bgFill, this.bgLayer, this.rt, underC, goldC, actorC, overC, this.lasers, this.fxLayer, this.flashImg]);
    this.under = new Pool(s, underC, this.tex); this.gold = new Pool(s, goldC, this.tex);
    this.actors = new Pool(s, actorC, this.tex); this.over = new Pool(s, overC, this.tex);
    this.cells = [];
  }

  setLayout(l: FieldLayout): void { this.layout = l; this.root.setPosition(l.x, l.y).setScale(l.scale); }
  /** Versus: a single-player board drawn as player 2. */
  playerIndexOffset = 0;

  private bgVariant = 0;
  /** Rebuilds only if the theme or backdrop variant actually changed. */
  setTheme(theme: Theme, bgVariant = this.bgVariant): void {
    if (theme === this.theme && bgVariant === this.bgVariant && this.tex) return;
    this.theme = theme; this.bgVariant = bgVariant; this.build();
  }
  setReducedMotion(on: boolean): void { this.reduced = on; this.build(); }

  /** Show a (new or restarted) world; plays the board draw-in. */
  setWorld(world: World, time: number): void {
    this.world = world;
    this.cells = [];
    this.rt.clear(); this.rt.render();
    this.anim.clear();
    this.deathT = [];
    this.exitT = world.exitsRevealed ? 0 : -1;
    this.introStart = time; this.outroStart = -1; this.outroCb = null;
    for (const p of this.particles) p.img.setVisible(false);
    this.particles = [];
  }

  introDuration(): number { return (CONFIG.GRID_WIDTH + CONFIG.GRID_HEIGHT * 1.5) * INTRO_STEP + 250; }
  introDone(time: number): boolean { return time - this.introStart >= this.introDuration(); }
  /** Board dissolves; cb fires when finished. */
  playOutro(time: number, cb?: () => void): void { this.outroStart = time; this.outroCb = cb ?? null; }

  shake(mag: number, ms: number, time: number): void {
    if (this.reduced) return;
    this.shakeMag = mag; this.shakeLen = ms; this.shakeUntil = time + ms;
  }

  // ------------------------------------------------------------------ events
  onEvent(e: SimEvent, time: number): void {
    const th = this.theme;
    const c = (x: number) => x * TS + TS / 2;
    switch (e.t) {
      case 'holeOpen': this.debris(c(e.x), c(e.y) - 10, th.brick, 16, time); this.cellFlash(e.x, e.y, th.ladder, time, 0.5); break;
      case 'holeFill': this.cellFlash(e.x, e.y, th.ladder, time, 0.7); this.sparks(c(e.x), c(e.y) - 14, th.ladder, 5, time, 60); break;
      case 'gold':
        this.sparks(c(e.x), c(e.y) + 6, th.gold, 14, time, 110); this.sparks(c(e.x), c(e.y) + 6, 0xffffff, 6, time, 60);
        this.popup(c(e.x), c(e.y) - 6, '+' + SCORE.GOLD, th.gold, time); break;
      case 'guardGold': case 'goldDrop': this.sparks(c(e.x), c(e.y) + 6, th.gold, 6, time, 50); break;
      case 'trap': this.popup(c(e.x), c(e.y) - 12, '+' + SCORE.TRAP, th.hudText, time); this.debris(c(e.x), c(e.y) - 12, th.brick, 5, time); break;
      case 'guardDeath': this.burst(c(e.x), c(e.y), th.enemy, 22, time); this.popup(c(e.x), c(e.y) - 12, '+' + SCORE.GUARD_DEATH, th.hudText, time); break;
      case 'guardSpawn': this.sparks(c(e.x), c(e.y), mix(th.enemy, 0xffffff, 0.4), 10, time, 70); break;
      case 'playerDeath': {
        this.deathT[e.p] = time;
        const col = e.p === 1 ? TileGraphics.P2_COLOR : th.player;
        this.burst(c(e.x), c(e.y), col, 34, time);
        this.shake(5, 380, time);
        this.flashUntil = time + 260; this.flashColor = 0xff2244;
        break;
      }
      case 'playerSpawn': { const p = this.world?.players[e.p]; if (p) this.sparks(this.ax(p), this.ay(p), th.player, 12, time, 80); break; }
      case 'exitReveal': this.exitT = time; this.flashUntil = time + 160; this.flashColor = th.ladder; break;
      case 'complete': { const p = this.world?.players[e.p]; if (p) this.sparks(this.ax(p), this.ay(p), th.gold, 24, time, 140); break; }
    }
  }

  // ------------------------------------------------------------------ FX primitives
  private spawn(frame: string, x: number, y: number, vx: number, vy: number, g: number, life: number, tintC: number, time: number, add = false, s0 = 1, s1 = 1, a0 = 1): void {
    if (this.particles.length > 260) return;
    let img = this.fxImgs.pop();
    if (!img) { img = this.scene.add.image(0, 0, this.tex, frame); this.fxLayer.add(img); }
    img.setFrame(frame).setTint(tintC).setVisible(true).setBlendMode(add ? ADD : Phaser.BlendModes.NORMAL).setAlpha(a0).setScale(s0);
    this.particles.push({ img, x, y, vx, vy, g, t0: time, life, s0, s1, a0 });
  }
  private debris(x: number, y: number, color: number, n: number, time: number): void {
    for (let i = 0; i < n; i++) {
      const c = i % 3 === 0 ? mix(color, 0xffffff, 0.4) : color;
      this.spawn('px', x + (Math.random() - 0.5) * 24, y + Math.random() * 6, (Math.random() - 0.5) * 140, -60 - Math.random() * 120, 520, 500 + Math.random() * 300, c, time, false, 1 + Math.random(), 1);
    }
  }
  private sparks(x: number, y: number, color: number, n: number, time: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.spawn(i % 2 ? 'spark' : 'px', x, y, Math.cos(a) * v, Math.sin(a) * v - 20, 0, 400 + Math.random() * 300, color, time, true, 1, 0.2);
    }
  }
  private burst(x: number, y: number, color: number, n: number, time: number): void {
    this.spawn('glow', x, y, 0, 0, 0, 350, color, time, true, 1.5, 4, 0.9);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
      this.spawn('px', x, y, Math.cos(a) * v, Math.sin(a) * v - 60, 300, 600 + Math.random() * 500, i % 4 ? color : 0xffffff, time, true, 1.5, 0.5);
    }
  }
  private cellFlash(cx: number, cy: number, color: number, time: number, a = 0.6): void {
    this.spawn('flash', cx * TS + TS / 2, cy * TS + TS / 2, 0, 0, 0, 220, color, time, true, 1, 1.15, a);
  }
  private popup(x: number, y: number, text: string, color: number, time: number): void {
    const t = this.scene.add.text(x, y, text, {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: hex(mix(color, 0xffffff, 0.35)), stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.fxLayer.add(t);
    this.scene.tweens.add({ targets: t, y: y - 26, alpha: { from: 1, to: 0 }, duration: 900, delay: 0, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
    void time;
  }

  private stepParticles(time: number): void {
    const dt = Math.min(50, time - this.lastTime) / 1000;
    const keep: Particle[] = [];
    for (const p of this.particles) {
      const k = (time - p.t0) / p.life;
      if (k >= 1) { p.img.setVisible(false); this.fxImgs.push(p.img); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.img.setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(p.a0 * (1 - k * k)).setScale(p.s0 + (p.s1 - p.s0) * k);
      keep.push(p);
    }
    this.particles = keep;
  }

  // ------------------------------------------------------------------ static tiles
  private cellDelay(x: number, y: number): number { return (x + y * 1.5) * INTRO_STEP; }

  private solid(t: T): boolean { return t === T.BRICK || t === T.BRICK_TRAP || t === T.BRICK_HARD; }

  private cellKey(x: number, y: number, time: number, digging: Set<number>): string {
    const w = this.world!;
    if (time < this.introStart + this.cellDelay(x, y)) return '';
    if (this.outroStart >= 0 && time > this.outroStart + this.cellDelay(x, y)) return '';
    const t = w.tiles[y][x];
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const edge = y === 0 || !this.solid(w.tiles[y - 1][x]) ? '|edge_top' : '';
    switch (t) {
      case T.BRICK: if (digging.has(y * 64 + x)) return ''; { const r = h % 10; return 'brick' + (r < 6 ? 0 : r < 8 ? 1 : r < 9 ? 2 : 3) + edge; }
      case T.BRICK_TRAP: return 'brick_trap' + edge;
      case T.BRICK_HARD: return 'hard' + (h % 3 === 0 ? 1 : 0);
      case T.LADDER: return 'ladder';
      case T.POLE: return 'pole';
      case T.LADDER_EXIT: return this.exitT >= 0 && time >= this.exitT + this.exitDelay(y) ? 'ladder_exit' : '';
      default: return '';
    }
  }
  private exitDelay(y: number): number { return this.exitT === 0 ? 0 : (CONFIG.GRID_HEIGHT - 1 - y) * 45; }

  private updateTiles(time: number): void {
    const w = this.world!;
    const digging = new Set<number>();
    for (const p of w.players) if (p.mode === 'dig') digging.add(p.digY * 64 + p.digX);
    let dirty = false;
    for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
      const i = y * w.width + x;
      const k = this.cellKey(x, y, time, digging);
      if (this.cells[i] === k) continue;
      const was = this.cells[i];
      this.cells[i] = k;
      this.rt.clear(x * TS, y * TS, TS, TS);
      if (k) for (const f of k.split('|')) this.rt.stamp(this.tex, f, x * TS, y * TS, { originX: 0, originY: 0 });
      dirty = true;
      const intro = time < this.introStart + this.introDuration();
      if (was !== undefined && (intro || this.outroStart >= 0) && (k || was)) this.cellFlash(x, y, this.theme.ladder, time, k ? 0.35 : 0.5);
      else if (k === 'ladder_exit') { this.cellFlash(x, y, 0xffffff, time, 0.8); this.sparks(x * TS + 16, y * TS + 16, this.theme.ladder, 3, time, 50); }
    }
    if (dirty) this.rt.render();
  }

  // ------------------------------------------------------------------ per-frame
  // Render interpolation: the sim runs at a fixed 60 Hz but frames don't line up with ticks (0, 1 or 2 ticks
  // per frame, and guards move 1-2 units per tick), which made actors visibly surge and stall. Draw each actor
  // between its previous and current tick position by the leftover accumulator fraction. Snaps on teleports.
  private alpha = 1;
  private lerpU(a: Actor, cur: number, prev: number | undefined): number {
    if (prev === undefined || Math.abs(cur - prev) > SUB) return cur;
    return prev + (cur - prev) * this.alpha;
  }
  private ax(a: Actor): number { return Math.round((this.lerpU(a, a.cx * SUB + a.ox, a.px) * U + TS / 2) * 2) / 2; }
  private ay(a: Actor): number { return Math.round((this.lerpU(a, a.cy * SUB + a.oy, a.py) * U + TS / 2) * 2) / 2; }

  /** Motion-driven animation counter (frames only advance while the actor moves). */
  private step(id: string, x: number, y: number): number {
    let s = this.anim.get(id);
    if (!s) { s = { x, y, d: 0 }; this.anim.set(id, s); }
    s.d += Math.abs(x - s.x) + Math.abs(y - s.y);
    s.x = x; s.y = y;
    return s.d;
  }

  private actorFrame(a: Actor, id: string, prefix: string, time: number, seed: number): string {
    const d = this.step(id, this.ax(a), this.ay(a));
    switch (a.mode) {
      case 'run': return prefix + 'run' + (Math.floor(d / 5) % 6);
      case 'climb': case 'escape': return prefix + 'climb' + (Math.floor(d / 6) % 4);
      case 'hang': return prefix + 'hang' + (Math.floor(d / 6) % 4);
      case 'fall': return prefix + 'fall' + (Math.floor(time / 110) % 2);
      case 'dig': return prefix + 'dig' + (Math.floor(time / 70) % 2);
      case 'trapped': return prefix + 'trapped' + (Math.floor(time / ((a as any).trapTicks < 50 ? 60 : 220)) % 2);
      default: return prefix + ((time + seed * 977) % 3200 < 130 ? 'blink' : 'idle');
    }
  }

  /** `alpha` = fraction of a sim tick elapsed since the last tick (accumulator / TICK_MS). */
  render(time: number, alpha = 1): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
    const w = this.world;
    if (!w) return;
    this.updateTiles(time);
    this.bg?.update(time);
    const th = this.theme;
    const introEnd = this.introStart + this.introDuration();
    const actorAlpha = this.outroStart >= 0 ? Math.max(0, 1 - (time - this.outroStart) / 300)
      : Math.max(0, Math.min(1, (time - introEnd + 300) / 300));

    // holes / digging overlays
    this.under.begin(); this.over.begin();
    for (const h of w.holes) {
      const x = h.x * TS + 16, y = h.y * TS + 16;
      if (h.ticks <= REFILL_TICKS) this.over.get('refill' + Math.min(3, Math.floor((1 - h.ticks / REFILL_TICKS) * 4)), x, y);
      else this.under.get('hole', x, y);
      if (h.ticks < HOLE_WARN_TICKS) {
        const on = this.reduced ? true : Math.sin(time / 45) > 0;
        if (on) this.over.get('warn', x, y).setAlpha(this.reduced ? 0.5 : 0.85);
      }
    }
    this.lasers.clear();
    for (const p of w.players) {
      if (p.mode !== 'dig') continue;
      const prog = 1 - p.digTicks / DIG_TICKS;
      const x = p.digX * TS + 16, y = p.digY * TS + 16;
      this.under.get('crumble' + Math.max(0, Math.min(4, Math.floor(prog * 5))), x, y);
      const hx = this.ax(p) + p.facing * 11, hy = this.ay(p) + 6;
      const col = mix(th.ladder, 0xffffff, 0.3);
      this.lasers.lineStyle(3, th.ladder, 0.25 + 0.15 * Math.random()).lineBetween(hx, hy, x, y - 12 + prog * 10);
      this.lasers.lineStyle(1, col, 0.9).lineBetween(hx, hy, x, y - 12 + prog * 10);
      this.over.get('glow', x, y - 12 + prog * 10).setTint(th.ladder).setBlendMode(ADD).setAlpha(0.6).setScale(0.6 + Math.random() * 0.3);
      if (Math.random() < 0.35) this.debris(x, y - 14 + prog * 10, th.brick, 1, time);
    }
    // exit sweep glow
    if (this.exitT > 0 && time - this.exitT < CONFIG.GRID_HEIGHT * 45 + 300) {
      for (const e of w.exitLadders) {
        const dt = time - this.exitT - this.exitDelay(e.y);
        if (dt > 0 && dt < 300) this.over.get('beam', e.x * TS + 16, e.y * TS + 16).setTint(th.ladder).setBlendMode(ADD).setAlpha(1 - dt / 300).setScale(1, 1.5);
      }
    }

    // gold
    this.gold.begin();
    w.golds.forEach((g, i) => {
      if (g.collected || g.carriedBy >= 0) return;
      if (time < this.introStart + this.cellDelay(g.x, g.y) + 80) return;
      const x = g.x * TS + 16, y = g.y * TS + 16 + (this.reduced ? 0 : Math.round(Math.sin(time / 320 + i) * 1.2));
      if (th.glow) this.gold.get('glow', x, y + 8).setTint(th.gold).setBlendMode(ADD).setAlpha(0.28 + 0.1 * Math.sin(time / 200 + i)).setScale(1.3, 0.8);
      const idx = Math.floor(time / 75 + i * 13) % 26;
      this.gold.get((g.assisted ? 'golda' : 'gold') + (idx < 4 ? idx : 4 + (idx >> 3) % 2), x, y);
    });

    // actors
    this.actors.begin();
    w.guards.forEach((g, i) => {
      if (g.mode === 'dead') return;
      const x = this.ax(g), y = this.ay(g);
      let alpha = actorAlpha;
      if (g.mode === 'spawning') {
        const k = 1 - g.spawnTicks / GUARD_SPAWN_ANIM_TICKS;
        this.actors.get('beam', x, y).setTint(th.enemy).setBlendMode(ADD).setAlpha(1 - k).setScale(1 - k * 0.6, 1.2);
        alpha *= k;
        this.actors.get(this.actorFrame(g, 'g' + i, 'g_', time, i), x, y).setAlpha(alpha).setScale(1, 0.3 + 0.7 * k).setFlipX(g.facing < 0);
        return;
      }
      this.actors.get(this.actorFrame(g, 'g' + i, 'g_', time, i), x + (g.mode === 'trapped' && (g as any).trapTicks < 50 && !this.reduced ? (Math.floor(time / 40) % 2 ? 1 : -1) : 0), y)
        .setAlpha(alpha).setFlipX(g.facing < 0);
      if (g.carry >= 0) {
        const by = y - 22 + (this.reduced ? 0 : Math.round(Math.sin(time / 150) * 1.5));
        this.actors.get('glow', x, by).setTint(th.gold).setBlendMode(ADD).setAlpha(0.5 * alpha).setScale(0.5);
        this.actors.get('pip_on', x, by).setAlpha(alpha).setScale(1.25);
      }
    });
    w.players.forEach((p, i) => {
      const prefix = i + this.playerIndexOffset === 1 ? 'p2_' : 'p1_';
      const x = this.ax(p), y = this.ay(p);
      if (!p.alive) {
        const dt = time - (this.deathT[i] ?? time);
        const k = Math.floor(dt / 110);
        if (k < 6) this.actors.get(prefix + 'death' + k, x, y).setFlipX(p.facing < 0);
        return;
      }
      if (th.glow) this.actors.get('glow', x, y).setTint(i === 1 ? TileGraphics.P2_COLOR : th.player).setBlendMode(ADD).setAlpha(0.32 * actorAlpha).setScale(1.6);
      this.actors.get(this.actorFrame(p, 'p' + i, prefix, time, 7 + i), x, y).setAlpha(actorAlpha).setFlipX(p.facing < 0);
    });
    this.under.end(); this.over.end(); this.gold.end(); this.actors.end();

    // screen flash + particles + shake
    if (time < this.flashUntil) this.flashImg.setVisible(true).setTint(this.flashColor).setAlpha(0.22 * (this.flashUntil - time) / 260);
    else this.flashImg.setVisible(false);
    this.stepParticles(time);
    let ox = 0, oy = 0;
    if (time < this.shakeUntil) {
      const m = this.shakeMag * (this.shakeUntil - time) / this.shakeLen;
      ox = Math.round((Math.random() - 0.5) * 2 * m); oy = Math.round((Math.random() - 0.5) * 2 * m);
    }
    this.root.setPosition(this.layout.x + ox * this.layout.scale, this.layout.y + oy * this.layout.scale);
    if (this.outroStart >= 0 && this.outroCb && time - this.outroStart > this.introDuration()) { const cb = this.outroCb; this.outroCb = null; cb(); }
    this.lastTime = time;
  }

  destroy(): void { this.bg?.destroy(); this.bg = null; this.root.destroy(); }
}
