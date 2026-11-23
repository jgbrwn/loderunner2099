// Attract-mode demo: a real World on a procedural level, driven by a simple BFS gold-hunting bot. Silent.
import Phaser from 'phaser';
import { DIFFICULTIES, THEMES } from '../config';
import { LevelGenerator } from '../level/LevelGenerator';
import { World } from '../sim/World';
import { TICK_MS, type Dir } from '../sim/types';
import { botInput } from './bot';
import { FieldView } from '../graphics/FieldView';
import { computeLayout } from '../graphics/Layout';
import { Settings } from '../systems/Settings';

export class AttractDemo {
  private view: FieldView;
  private world!: World;
  private acc = 0;
  private memo = { dir: null as Dir, at: -99 };
  private restartAt = 0;
  private lastGoldTick = 0;
  private n = 0;
  private viewTheme: import("../config").Theme | null = null;

  constructor(private scene: Phaser.Scene) {
    this.view = new FieldView(scene, computeLayout(1)[0], THEMES[Settings.theme]);
    // Live theme switching: the Options page writes Settings.theme; adopt it here every frame.
    scene.events.on('update', () => {
      const t = THEMES[Settings.theme];
      if (t && t !== this.viewTheme) { this.viewTheme = t; this.view.setTheme(t); scene.cameras.main.setBackgroundColor(t.background); }
    });
    this.next(scene.time.now);
  }

  private next(time: number): void {
    const keys = Object.keys(THEMES);
    if (this.n++ > 0) { const t = THEMES[keys[this.n % keys.length]]; this.viewTheme = t; this.view.setTheme(t); this.scene.cameras.main.setBackgroundColor(t.background); }
    const seed = `DEMO${Math.floor(Math.random() * 1e6)}`;
    const diff = 'easy';
    const map = new LevelGenerator(seed, diff, 1 + (this.n % 4)).generateWithInfo(1).map;
    const d = DIFFICULTIES[diff];
    this.world = new World(map, { seed, players: 1, enemySpeed: d.enemySpeed, holeTime: d.holeTime });
    this.memo = { dir: null, at: -99 };
    this.lastGoldTick = 0;
    this.restartAt = 0;
    this.view.setWorld(this.world, time);
  }

  update(time: number, delta: number): void {
    const w = this.world;
    if (this.restartAt && time >= this.restartAt) { this.next(time); return; }
    if (w.status === 'playing' && this.view.introDone(time)) {
      this.acc += Math.min(delta, 250);
      let steps = 0;
      while (this.acc >= TICK_MS && steps++ < 8) {
        this.acc -= TICK_MS;
        w.tick([botInput(w, this.memo)]);
        for (const e of w.drainEvents()) {
          this.view.onEvent(e, time);
          if (e.t === 'gold') this.lastGoldTick = w.tickCount;
        }
        if (w.status !== 'playing') break;
      }
      if (steps >= 8) this.acc = 0;
      // stuck (unreachable gold, endless dodging) → next board
      if (w.tickCount - this.lastGoldTick > 60 * 45) this.restartAt = time + 500;
    } else if (w.status !== 'playing' && !this.restartAt) this.restartAt = time + 2500;
    this.view.render(time);
  }

  destroy(): void { this.view.destroy(); }
}
