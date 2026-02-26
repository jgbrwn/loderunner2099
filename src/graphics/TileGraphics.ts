import Phaser from 'phaser';
import { CONFIG, TileType, Theme } from '../config';

/**
 * Creates pixel art tile graphics procedurally.
 * No external assets needed - everything is generated.
 */
export class TileGraphics {
  private scene: Phaser.Scene;
  private textures: Map<string, string> = new Map();
  
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }
  
  /**
   * Generate all tile textures for a theme.
   */
  generateTextures(theme: Theme, prefix: string = ''): void {
    this.generateBrickTexture(prefix + 'brick', theme.brick, 0);
    this.generateBrickTexture(prefix + 'brick_hard', theme.brickHard, 1);
    this.generateLadderTexture(prefix + 'ladder', theme.ladder);
    this.generatePoleTexture(prefix + 'pole', theme.pole);
    this.generateGoldTexture(prefix + 'gold', theme.gold);
    this.generatePlayerTexture(prefix + 'player', theme.player);
    this.generateEnemyTexture(prefix + 'enemy', theme.enemy);
  }
  
  private generateBrickTexture(key: string, color: number, style: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Fill background
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(0, 0, size, size);
    
    // Add brick pattern
    const borderColor = this.darken(color, 0.3);
    const highlightColor = this.lighten(color, 0.2);
    
    ctx.strokeStyle = this.colorToHex(borderColor);
    ctx.lineWidth = 1;
    
    // Horizontal lines
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
    
    // Vertical lines (offset)
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size / 2);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(0, size);
    ctx.moveTo(size, size / 2);
    ctx.lineTo(size, size);
    ctx.stroke();
    
    // Add highlight on top-left of each brick
    ctx.strokeStyle = this.colorToHex(highlightColor);
    ctx.beginPath();
    ctx.moveTo(1, 1);
    ctx.lineTo(size / 2 - 2, 1);
    ctx.moveTo(size / 2 + 1, size / 2 + 1);
    ctx.lineTo(size - 2, size / 2 + 1);
    ctx.stroke();
    
    // Hard brick: add X pattern
    if (style === 1) {
      ctx.strokeStyle = this.colorToHex(this.darken(color, 0.5));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 4);
      ctx.lineTo(size - 4, size - 4);
      ctx.moveTo(size - 4, 4);
      ctx.lineTo(4, size - 4);
      ctx.stroke();
    }
    
    // Create texture
    if (this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
    this.scene.textures.addCanvas(key, canvas);
    this.textures.set(key, key);
  }
  
  private generateLadderTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    const railWidth = 3;
    const rungSpacing = 6;
    
    ctx.fillStyle = this.colorToHex(color);
    
    // Left rail
    ctx.fillRect(4, 0, railWidth, size);
    // Right rail
    ctx.fillRect(size - 4 - railWidth, 0, railWidth, size);
    
    // Rungs
    for (let y = rungSpacing; y < size; y += rungSpacing) {
      ctx.fillRect(4, y - 1, size - 8, 2);
    }
    
    if (this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
    this.scene.textures.addCanvas(key, canvas);
    this.textures.set(key, key);
  }
  
  private generatePoleTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Main bar
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(0, size / 2 - 2, size, 4);
    
    // Highlight
    ctx.fillStyle = this.colorToHex(this.lighten(color, 0.3));
    ctx.fillRect(0, size / 2 - 2, size, 1);
    
    if (this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
    this.scene.textures.addCanvas(key, canvas);
    this.textures.set(key, key);
  }
  
  private generateGoldTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Gold nugget shape (chest/bar)
    const pad = 6;
    ctx.fillStyle = this.colorToHex(color);
    
    // Main body
    ctx.fillRect(pad, pad + 4, size - pad * 2, size - pad * 2 - 4);
    
    // Top
    ctx.fillRect(pad + 2, pad, size - pad * 2 - 4, 4);
    
    // Highlight
    ctx.fillStyle = this.colorToHex(this.lighten(color, 0.5));
    ctx.fillRect(pad + 2, pad + 2, 4, 4);
    
    // Shadow
    ctx.fillStyle = this.colorToHex(this.darken(color, 0.3));
    ctx.fillRect(size - pad - 4, size - pad - 4, 3, 3);
    
    if (this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
    this.scene.textures.addCanvas(key, canvas);
    this.textures.set(key, key);
  }
  
  private generatePlayerTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Simple humanoid figure
    ctx.fillStyle = this.colorToHex(color);
    
    // Head
    ctx.fillRect(size/2 - 3, 2, 6, 6);
    
    // Body
    ctx.fillRect(size/2 - 4, 8, 8, 8);
    
    // Arms
    ctx.fillRect(size/2 - 8, 9, 4, 3);
    ctx.fillRect(size/2 + 4, 9, 4, 3);
    
    // Legs
    ctx.fillRect(size/2 - 4, 16, 3, 6);
    ctx.fillRect(size/2 + 1, 16, 3, 6);
    
    if (this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
    this.scene.textures.addCanvas(key, canvas);
    this.textures.set(key, key);
  }
  
  private generateEnemyTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Enemy figure (slightly different from player)
    ctx.fillStyle = this.colorToHex(color);
    
    // Head (rounder)
    ctx.beginPath();
    ctx.arc(size/2, 6, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Body (bulkier)
    ctx.fillRect(size/2 - 5, 10, 10, 7);
    
    // Arms
    ctx.fillRect(size/2 - 9, 10, 4, 4);
    ctx.fillRect(size/2 + 5, 10, 4, 4);
    
    // Legs
    ctx.fillRect(size/2 - 5, 17, 4, 5);
    ctx.fillRect(size/2 + 1, 17, 4, 5);
    
    if (this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
    this.scene.textures.addCanvas(key, canvas);
    this.textures.set(key, key);
  }
  
  private colorToHex(color: number): string {
    return '#' + color.toString(16).padStart(6, '0');
  }
  
  private darken(color: number, amount: number): number {
    const r = Math.floor(((color >> 16) & 0xff) * (1 - amount));
    const g = Math.floor(((color >> 8) & 0xff) * (1 - amount));
    const b = Math.floor((color & 0xff) * (1 - amount));
    return (r << 16) | (g << 8) | b;
  }
  
  private lighten(color: number, amount: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * (1 + amount)));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * (1 + amount)));
    const b = Math.min(255, Math.floor((color & 0xff) * (1 + amount)));
    return (r << 16) | (g << 8) | b;
  }
}
