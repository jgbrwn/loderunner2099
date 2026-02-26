import Phaser from 'phaser';
import { CONFIG, Theme } from '../config';

/**
 * CRT scanline and glow effects for retro-futuristic aesthetics.
 * Applied as a post-processing layer.
 */
export class CRTEffect {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private scanlines: Phaser.GameObjects.Graphics;
  private vignette: Phaser.GameObjects.Graphics;
  private enabled: boolean = true;
  private intensity: number = 0.5;
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setDepth(1000);
    
    // Create scanlines
    this.scanlines = scene.add.graphics();
    this.createScanlines();
    this.container.add(this.scanlines);
    
    // Create vignette
    this.vignette = scene.add.graphics();
    this.createVignette();
    this.container.add(this.vignette);
  }
  
  private createScanlines(): void {
    this.scanlines.clear();
    
    if (!this.enabled) return;
    
    const width = CONFIG.GAME_WIDTH;
    const height = CONFIG.GAME_HEIGHT;
    const lineSpacing = 3;
    const alpha = 0.1 * this.intensity;
    
    // Horizontal scanlines
    this.scanlines.lineStyle(1, 0x000000, alpha);
    
    for (let y = 0; y < height; y += lineSpacing) {
      this.scanlines.beginPath();
      this.scanlines.moveTo(0, y);
      this.scanlines.lineTo(width, y);
      this.scanlines.strokePath();
    }
    
    // Subtle vertical lines for RGB effect
    this.scanlines.lineStyle(1, 0x000000, alpha * 0.3);
    for (let x = 0; x < width; x += 3) {
      this.scanlines.beginPath();
      this.scanlines.moveTo(x, 0);
      this.scanlines.lineTo(x, height);
      this.scanlines.strokePath();
    }
  }
  
  private createVignette(): void {
    this.vignette.clear();
    
    if (!this.enabled) return;
    
    const width = CONFIG.GAME_WIDTH;
    const height = CONFIG.GAME_HEIGHT;
    const cx = width / 2;
    const cy = height / 2;
    
    // Radial gradient vignette using concentric rectangles
    const steps = 20;
    const maxAlpha = 0.4 * this.intensity;
    
    for (let i = steps; i >= 0; i--) {
      const ratio = i / steps;
      const alpha = maxAlpha * (1 - ratio) * (1 - ratio);
      const inset = ratio * Math.min(width, height) * 0.3;
      
      this.vignette.fillStyle(0x000000, alpha);
      this.vignette.fillRect(0, 0, width, inset); // Top
      this.vignette.fillRect(0, height - inset, width, inset); // Bottom
      this.vignette.fillRect(0, inset, inset, height - inset * 2); // Left
      this.vignette.fillRect(width - inset, inset, inset, height - inset * 2); // Right
    }
    
    // Corner darkening
    const cornerSize = 100;
    const corners = [
      { x: 0, y: 0 },
      { x: width - cornerSize, y: 0 },
      { x: 0, y: height - cornerSize },
      { x: width - cornerSize, y: height - cornerSize }
    ];
    
    corners.forEach(corner => {
      for (let i = 0; i < 10; i++) {
        const a = maxAlpha * 0.5 * (1 - i / 10);
        this.vignette.fillStyle(0x000000, a);
        this.vignette.fillRect(
          corner.x + i * 5, 
          corner.y + i * 5, 
          cornerSize - i * 10, 
          cornerSize - i * 10
        );
      }
    });
  }
  
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.createScanlines();
    this.createVignette();
    this.container.setVisible(enabled);
  }
  
  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }
  
  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.createScanlines();
    this.createVignette();
  }
  
  applyTheme(theme: Theme): void {
    // Some themes have scanlines disabled
    if (theme.scanlines === false) {
      this.setEnabled(false);
    } else if (theme.scanlines === true) {
      this.setEnabled(true);
    }
  }
  
  update(): void {
    // Optional: Animate scanline flicker
    if (this.enabled && Math.random() < 0.01) {
      const flicker = 0.8 + Math.random() * 0.4;
      this.scanlines.setAlpha(flicker);
      this.scene.time.delayedCall(50, () => {
        this.scanlines.setAlpha(1);
      });
    }
  }
  
  destroy(): void {
    this.container.destroy();
  }
}
