import Phaser from 'phaser';
import { CONFIG, Theme } from '../config';

/**
 * CRT look for Phaser 4: scanline overlay (one cached texture) + camera filters
 * (vignette, slight barrel curvature). Everything is removed in destroy().
 */
export class CRTEffect {
  private scene: Phaser.Scene;
  private overlay: Phaser.GameObjects.Image;
  private vignette: Phaser.Filters.Vignette | null = null;
  private barrel: Phaser.Filters.Barrel | null = null;
  private enabled = true;
  private intensity = 0.5;
  private static TEX = 'crt_scanlines';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    if (!scene.textures.exists(CRTEffect.TEX)) {
      const w = CONFIG.GAME_WIDTH, h = CONFIG.GAME_HEIGHT;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
      scene.textures.addCanvas(CRTEffect.TEX, c);
    }
    this.overlay = scene.add.image(0, 0, CRTEffect.TEX).setOrigin(0).setDepth(1000).setScrollFactor(0);
    const cam = scene.cameras.main;
    try {
      this.vignette = cam.filters.external.addVignette(0.5, 0.5, 0.9, 0.3);
      this.barrel = cam.filters.external.addBarrel(1.03);
    } catch {
      // Canvas renderer: no filters, overlay only.
    }
    this.apply();
  }

  private apply(): void {
    this.overlay.setVisible(this.enabled);
    this.overlay.setAlpha(0.3 + 0.7 * this.intensity);
    if (this.vignette) { this.vignette.active = this.enabled; this.vignette.strength = 0.15 + 0.35 * this.intensity; }
    if (this.barrel) this.barrel.active = this.enabled;
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; this.apply(); }
  toggle(): boolean { this.setEnabled(!this.enabled); return this.enabled; }
  setIntensity(intensity: number): void { this.intensity = Math.max(0, Math.min(1, intensity)); this.apply(); }

  applyTheme(theme: Theme): void {
    if (theme.scanlines === false) this.setEnabled(false);
    else if (theme.scanlines === true) this.setEnabled(true);
  }

  update(): void {
    if (this.enabled) this.overlay.setAlpha((0.3 + 0.7 * this.intensity) * (Math.random() < 0.01 ? 0.7 : 1));
  }

  destroy(): void {
    const ext = this.scene.cameras?.main?.filters?.external;
    if (ext) {
      if (this.vignette) ext.remove(this.vignette, true);
      if (this.barrel) ext.remove(this.barrel, true);
    }
    this.vignette = this.barrel = null;
    this.overlay.destroy();
  }
}
