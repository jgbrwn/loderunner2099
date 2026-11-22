import Phaser from 'phaser';
import { CONFIG, Theme } from '../config';
import type { Rect } from './Layout';
import { TileGraphics } from './TileGraphics';
import { hex, mix } from './color';

export interface HudData {
  score: number; lives: number; level: number;
  goldTotal: number; goldLeft: number;
  difficulty: string; seed: string;
  music: 'procedural' | 'radio' | 'off';
  label?: string;          // e.g. 'P1' in split-screen
  livesIcon?: 'life_p1' | 'life_p2';
}

/** Slim HUD bar laid out at 960x28 design size, scaled into its rect. */
export class Hud {
  readonly root: Phaser.GameObjects.Container;
  private scene: Phaser.Scene;
  private theme!: Theme;
  private tex = '';
  private texts: Record<string, Phaser.GameObjects.Text> = {};
  private icons: Phaser.GameObjects.Image[] = [];
  private bar!: Phaser.GameObjects.Graphics;
  private last = '';

  constructor(scene: Phaser.Scene, rect: Rect, theme: Theme) {
    this.scene = scene;
    this.root = scene.add.container(0, 0).setDepth(50);
    this.setRect(rect);
    this.setTheme(theme);
  }

  setRect(r: Rect): void { this.root.setPosition(r.x, r.y).setScale(r.w / CONFIG.GAME_WIDTH, r.h / CONFIG.HUD_HEIGHT); }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.tex = new TileGraphics(this.scene).generateTextures(theme);
    this.root.removeAll(true);
    this.icons = []; this.texts = {}; this.last = '';
    const W = CONFIG.GAME_WIDTH, H = CONFIG.HUD_HEIGHT;
    this.bar = this.scene.add.graphics();
    this.bar.fillStyle(theme.hudBg, 1).fillRect(0, 0, W, H);
    this.bar.fillStyle(mix(theme.hudBg, 0xffffff, 0.04), 1).fillRect(0, 0, W, H / 2);
    this.bar.fillStyle(theme.hudText, 0.6).fillRect(0, H - 2, W, 1);
    this.bar.fillStyle(theme.hudText, 0.18).fillRect(0, H - 1, W, 1);
    this.root.add(this.bar);
    const mk = (k: string, x: number, color: number, size = 14, origin = 0) => {
      const t = this.scene.add.text(x, H / 2 - 1, '', { fontFamily: 'monospace', fontSize: size + 'px', fontStyle: 'bold', color: hex(color) }).setOrigin(origin, 0.5);
      this.texts[k] = t; this.root.add(t);
    };
    const dim = mix(theme.hudText, theme.hudBg, 0.45);
    mk('scoreL', 10, dim, 11); mk('score', 54, 0xffffff, 16);
    mk('livesX', 0, 0xffffff, 12);
    mk('levelL', 300, dim, 11); mk('level', 334, 0xffffff, 16);
    mk('goldL', 384, dim, 11); mk('gold', 0, theme.gold, 13);
    mk('diff', 790, theme.hudText, 12, 1); mk('seed', 905, dim, 12, 1);
  }

  update(d: HudData): void {
    const key = JSON.stringify(d);
    if (key === this.last) return;
    this.last = key;
    const t = this.texts;
    for (const i of this.icons) i.destroy();
    this.icons = [];
    const icon = (f: string, x: number, y: number) => { const im = this.scene.add.image(x, y, this.tex, f).setOrigin(0, 0.5); this.root.add(im); this.icons.push(im); return im; };
    const H = CONFIG.HUD_HEIGHT, cy = H / 2 - 1;
    t.scoreL.setText(d.label ? d.label : 'SCORE');
    t.score.setText(String(d.score).padStart(7, '0'));
    // lives
    let x = 150;
    const shown = d.lives > 7 ? 1 : Math.max(0, d.lives);
    for (let i = 0; i < shown; i++) icon(d.livesIcon ?? 'life_p1', x + i * 14, cy);
    t.livesX.setPosition(x + shown * 14 + 2, cy).setText(d.lives > 7 ? 'x' + d.lives : d.lives <= 0 ? '--' : '');
    t.levelL.setText('LV'); t.level.setText(String(d.level).padStart(2, '0'));
    t.goldL.setText('GOLD');
    // gold pips (collected = lit)
    x = 422;
    const total = Math.min(d.goldTotal, 24), got = d.goldTotal - d.goldLeft;
    for (let i = 0; i < total; i++) icon(i < got ? 'pip_on' : 'pip_off', x + i * 10, cy);
    t.gold.setPosition(x + total * 10 + 6, cy).setText(d.goldLeft > 0 ? String(d.goldLeft) : 'EXIT!');
    t.diff.setText(d.difficulty);
    t.seed.setText('SEED ' + d.seed);
    icon(d.music === 'radio' ? 'icon_radio' : d.music === 'off' ? 'icon_off' : 'icon_note', 924, cy);
  }

  destroy(): void { this.root.destroy(); }
}
