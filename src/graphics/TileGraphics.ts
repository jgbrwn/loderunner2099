import Phaser from 'phaser';
import { CONFIG, TileType, Theme } from '../config';

/**
 * Creates pixel art tile graphics procedurally with animations.
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
    this.generateBrickTexture(prefix + 'brick', theme.brick);
    this.generateBrickTexture(prefix + 'brick_hard', theme.brickHard, true);
    this.generateTrapBrickTexture(prefix + 'brick_trap', theme.brick);
    this.generateLadderTexture(prefix + 'ladder', theme.ladder);
    this.generateLadderTexture(prefix + 'ladder_exit', theme.ladder, true);
    this.generatePoleTexture(prefix + 'pole', theme.pole);
    this.generateGoldTexture(prefix + 'gold', theme.gold);
    this.generateHoleTexture(prefix + 'hole');
    this.generatePlayerTextures(prefix + 'player', theme.player);
    this.generateEnemyTextures(prefix + 'enemy', theme.enemy);
  }
  
  private generateBrickTexture(key: string, color: number, hard: boolean = false): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Fill background
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(0, 0, size, size);
    
    const borderColor = this.darken(color, 0.4);
    const highlightColor = this.lighten(color, 0.3);
    const shadowColor = this.darken(color, 0.2);
    
    // Brick pattern - more detailed
    ctx.strokeStyle = this.colorToHex(borderColor);
    ctx.lineWidth = 1;
    
    // Draw brick rows
    const brickHeight = size / 2;
    
    // Top row - full bricks
    ctx.fillStyle = this.colorToHex(shadowColor);
    ctx.fillRect(0, brickHeight - 1, size, 2);
    
    // Vertical mortar lines
    ctx.fillRect(size / 2 - 1, 0, 2, brickHeight);
    ctx.fillRect(0, brickHeight, 2, brickHeight);
    ctx.fillRect(size - 2, brickHeight, 2, brickHeight);
    
    // Highlights on bricks
    ctx.fillStyle = this.colorToHex(highlightColor);
    ctx.fillRect(2, 2, size / 2 - 6, 2);
    ctx.fillRect(size / 2 + 2, 2, size / 2 - 6, 2);
    ctx.fillRect(4, brickHeight + 2, size - 10, 2);
    
    // Hard brick: add metallic X pattern
    if (hard) {
      ctx.strokeStyle = this.colorToHex(this.lighten(color, 0.5));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 4);
      ctx.lineTo(size - 4, size - 4);
      ctx.moveTo(size - 4, 4);
      ctx.lineTo(4, size - 4);
      ctx.stroke();
      
      // Corner rivets
      ctx.fillStyle = this.colorToHex(this.lighten(color, 0.6));
      ctx.fillRect(3, 3, 3, 3);
      ctx.fillRect(size - 6, 3, 3, 3);
      ctx.fillRect(3, size - 6, 3, 3);
      ctx.fillRect(size - 6, size - 6, 3, 3);
    }
    
    // Border
    ctx.strokeStyle = this.colorToHex(borderColor);
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, size, size);
    
    this.addTexture(key, canvas);
  }
  
  private generateTrapBrickTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Fill background - same as normal bricks
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(0, 0, size, size);
    
    const borderColor = this.darken(color, 0.4);
    const shadowColor = this.darken(color, 0.3);
    const crackColor = this.darken(color, 0.6);
    
    // Brick pattern like normal
    const brickHeight = size / 2;
    ctx.fillStyle = this.colorToHex(shadowColor);
    ctx.fillRect(0, brickHeight - 1, size, 2);
    ctx.fillRect(size / 2 - 1, 0, 2, brickHeight);
    ctx.fillRect(0, brickHeight, 2, brickHeight);
    ctx.fillRect(size - 2, brickHeight, 2, brickHeight);
    
    // Add visible cracks to indicate it's a trap brick
    ctx.strokeStyle = this.colorToHex(crackColor);
    ctx.lineWidth = 1;
    
    // Main diagonal crack
    ctx.beginPath();
    ctx.moveTo(4, size - 4);
    ctx.lineTo(size / 2 - 2, size / 2 + 2);
    ctx.lineTo(size / 2 + 3, size / 2 - 1);
    ctx.stroke();
    
    // Secondary crack
    ctx.beginPath();
    ctx.moveTo(size - 6, 4);
    ctx.lineTo(size - 10, 8);
    ctx.lineTo(size - 8, 12);
    ctx.stroke();
    
    // Small dots to show crumbling
    ctx.fillStyle = this.colorToHex(crackColor);
    ctx.fillRect(6, size / 2 + 4, 2, 2);
    ctx.fillRect(size - 8, size / 2 - 4, 2, 2);
    
    // Border
    ctx.strokeStyle = this.colorToHex(borderColor);
    ctx.strokeRect(0, 0, size, size);
    
    this.addTexture(key, canvas);
  }
  
  private generateLadderTexture(key: string, color: number, isExit: boolean = false): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    const railWidth = 3;
    const rungHeight = 2;
    const rungSpacing = 5;
    const railOffset = 5;
    
    // Rails with gradient effect
    const railHighlight = this.lighten(color, 0.3);
    const railShadow = this.darken(color, 0.3);
    
    // Left rail
    ctx.fillStyle = this.colorToHex(railShadow);
    ctx.fillRect(railOffset + 1, 0, railWidth, size);
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(railOffset, 0, railWidth - 1, size);
    ctx.fillStyle = this.colorToHex(railHighlight);
    ctx.fillRect(railOffset, 0, 1, size);
    
    // Right rail
    ctx.fillStyle = this.colorToHex(railShadow);
    ctx.fillRect(size - railOffset - railWidth + 1, 0, railWidth, size);
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(size - railOffset - railWidth, 0, railWidth - 1, size);
    ctx.fillStyle = this.colorToHex(railHighlight);
    ctx.fillRect(size - railOffset - railWidth, 0, 1, size);
    
    // Rungs
    for (let y = rungSpacing; y < size; y += rungSpacing) {
      ctx.fillStyle = this.colorToHex(color);
      ctx.fillRect(railOffset, y - rungHeight / 2, size - railOffset * 2, rungHeight);
      ctx.fillStyle = this.colorToHex(railHighlight);
      ctx.fillRect(railOffset, y - rungHeight / 2, size - railOffset * 2, 1);
    }
    
    // Exit ladder glow effect
    if (isExit) {
      ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
      ctx.fillRect(0, 0, size, size);
    }
    
    this.addTexture(key, canvas);
  }
  
  private generatePoleTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    const barHeight = 4;
    const y = size / 2 - barHeight / 2;
    
    // Shadow
    ctx.fillStyle = this.colorToHex(this.darken(color, 0.4));
    ctx.fillRect(0, y + barHeight - 1, size, 2);
    
    // Main bar
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(0, y, size, barHeight);
    
    // Highlight
    ctx.fillStyle = this.colorToHex(this.lighten(color, 0.4));
    ctx.fillRect(0, y, size, 1);
    
    // Support brackets every 6 tiles
    ctx.fillStyle = this.colorToHex(this.darken(color, 0.3));
    ctx.fillRect(0, y - 2, 2, barHeight + 4);
    ctx.fillRect(size - 2, y - 2, 2, barHeight + 4);
    
    this.addTexture(key, canvas);
  }
  
  private generateGoldTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Gold chest/nugget with shine
    const pad = 4;
    const chest = {
      x: pad,
      y: pad + 4,
      w: size - pad * 2,
      h: size - pad * 2 - 4
    };
    
    // Shadow under chest
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(chest.x + 2, chest.y + chest.h, chest.w - 2, 2);
    
    // Main body
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(chest.x, chest.y, chest.w, chest.h);
    
    // Top lid
    ctx.fillRect(chest.x + 2, chest.y - 3, chest.w - 4, 4);
    
    // Darker bottom
    ctx.fillStyle = this.colorToHex(this.darken(color, 0.3));
    ctx.fillRect(chest.x, chest.y + chest.h - 3, chest.w, 3);
    
    // Highlight
    ctx.fillStyle = this.colorToHex(this.lighten(color, 0.5));
    ctx.fillRect(chest.x + 2, chest.y + 2, 4, 4);
    ctx.fillRect(chest.x + 3, chest.y - 2, 3, 2);
    
    // Shine sparkle
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(chest.x + 3, chest.y + 2, 2, 2);
    
    // Lock detail
    ctx.fillStyle = this.colorToHex(this.darken(color, 0.4));
    ctx.fillRect(chest.x + chest.w / 2 - 2, chest.y + 4, 4, 4);
    
    this.addTexture(key, canvas);
  }
  
  private generateHoleTexture(key: string): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Black hole with crumbling edges
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    
    // Jagged edges
    ctx.fillStyle = '#1a1a2a';
    for (let i = 0; i < size; i += 4) {
      const h = Math.random() * 3 + 1;
      ctx.fillRect(i, 0, 3, h);
      ctx.fillRect(i, size - h, 3, h);
    }
    
    this.addTexture(key, canvas);
  }
  
  private generatePlayerTextures(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const frames = ['idle', 'walk1', 'walk2', 'climb1', 'climb2', 'hang', 'dig', 'fall'];
    
    for (const frame of frames) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      
      this.drawCharacter(ctx, size, color, frame, false);
      this.addTexture(`${key}_${frame}`, canvas);
    }
    
    // Default texture
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    this.drawCharacter(ctx, size, color, 'idle', false);
    this.addTexture(key, canvas);
  }
  
  private generateEnemyTextures(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const frames = ['idle', 'walk1', 'walk2', 'climb1', 'climb2', 'hang', 'trapped'];
    
    for (const frame of frames) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      
      this.drawCharacter(ctx, size, color, frame, true);
      this.addTexture(`${key}_${frame}`, canvas);
    }
    
    // Default texture
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    this.drawCharacter(ctx, size, color, 'idle', true);
    this.addTexture(key, canvas);
  }
  
  private drawCharacter(ctx: CanvasRenderingContext2D, size: number, color: number, frame: string, isEnemy: boolean): void {
    const highlight = this.lighten(color, 0.4);
    const shadow = this.darken(color, 0.3);
    const outline = this.darken(color, 0.5);
    
    ctx.fillStyle = this.colorToHex(color);
    
    // Base character dimensions
    const headSize = 6;
    const bodyWidth = 8;
    const bodyHeight = 8;
    const legWidth = 3;
    const legHeight = 6;
    const armWidth = 4;
    const armHeight = 3;
    
    const cx = size / 2;
    let headY = 2;
    let bodyY = headY + headSize;
    let legY = bodyY + bodyHeight;
    let armY = bodyY + 1;
    
    // Frame-specific modifications
    let leftLegOffset = 0;
    let rightLegOffset = 0;
    let leftArmOffset = 0;
    let rightArmOffset = 0;
    let armRaised = false;
    
    switch (frame) {
      case 'walk1':
        leftLegOffset = -2;
        rightLegOffset = 2;
        break;
      case 'walk2':
        leftLegOffset = 2;
        rightLegOffset = -2;
        break;
      case 'climb1':
        leftArmOffset = -2;
        rightArmOffset = 2;
        leftLegOffset = 1;
        rightLegOffset = -1;
        break;
      case 'climb2':
        leftArmOffset = 2;
        rightArmOffset = -2;
        leftLegOffset = -1;
        rightLegOffset = 1;
        break;
      case 'hang':
        armRaised = true;
        bodyY += 3;
        legY += 3;
        armY = headY;
        break;
      case 'dig':
        rightArmOffset = 3;
        armY += 2;
        break;
      case 'fall':
        leftArmOffset = -3;
        rightArmOffset = 3;
        leftLegOffset = -2;
        rightLegOffset = 2;
        break;
      case 'trapped':
        bodyY = size - bodyHeight - 4;
        headY = bodyY - headSize;
        legY = size - 2;
        armY = bodyY + 1;
        break;
    }
    
    // Outline
    ctx.fillStyle = this.colorToHex(outline);
    
    // Head
    if (isEnemy) {
      // Enemy has rounder head
      ctx.beginPath();
      ctx.arc(cx, headY + headSize / 2, headSize / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(cx - headSize / 2 - 1, headY - 1, headSize + 2, headSize + 2);
    }
    
    // Body
    ctx.fillRect(cx - bodyWidth / 2 - 1, bodyY - 1, bodyWidth + 2, bodyHeight + 2);
    
    // Fill
    ctx.fillStyle = this.colorToHex(color);
    
    // Head
    if (isEnemy) {
      ctx.beginPath();
      ctx.arc(cx, headY + headSize / 2, headSize / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(cx - headSize / 2, headY, headSize, headSize);
    }
    
    // Body
    ctx.fillRect(cx - bodyWidth / 2, bodyY, bodyWidth, bodyHeight);
    
    // Highlight on body
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(cx - bodyWidth / 2 + 1, bodyY + 1, 2, bodyHeight - 2);
    
    // Arms
    ctx.fillStyle = this.colorToHex(color);
    if (armRaised) {
      // Arms up for hanging
      ctx.fillRect(cx - bodyWidth / 2 - armWidth, armY, armWidth, armHeight + 4);
      ctx.fillRect(cx + bodyWidth / 2, armY, armWidth, armHeight + 4);
    } else {
      ctx.fillRect(cx - bodyWidth / 2 - armWidth + leftArmOffset, armY, armWidth, armHeight);
      ctx.fillRect(cx + bodyWidth / 2 + rightArmOffset, armY, armWidth, armHeight);
    }
    
    // Legs
    ctx.fillRect(cx - bodyWidth / 2 + leftLegOffset, legY, legWidth, legHeight);
    ctx.fillRect(cx + bodyWidth / 2 - legWidth + rightLegOffset, legY, legWidth, legHeight);
    
    // Eyes
    if (!isEnemy) {
      // Player has visor
      ctx.fillStyle = this.colorToHex(this.lighten(color, 0.8));
      ctx.fillRect(cx - 2, headY + 2, 4, 2);
    } else {
      // Enemy has angry eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 2, headY + 2, 2, 2);
      ctx.fillRect(cx + 1, headY + 2, 2, 2);
      ctx.fillStyle = '#000000';
      ctx.fillRect(cx - 1, headY + 2, 1, 1);
      ctx.fillRect(cx + 1, headY + 2, 1, 1);
    }
  }
  
  private addTexture(key: string, canvas: HTMLCanvasElement): void {
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
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) + (255 - ((color >> 16) & 0xff)) * amount));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) + (255 - ((color >> 8) & 0xff)) * amount));
    const b = Math.min(255, Math.floor((color & 0xff) + (255 - (color & 0xff)) * amount));
    return (r << 16) | (g << 8) | b;
  }
  
  getTextureKey(baseName: string): string {
    return this.textures.get(baseName) || baseName;
  }
  
  hasTexture(key: string): boolean {
    return this.textures.has(key);
  }
}
