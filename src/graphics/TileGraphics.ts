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
    this.generateEnemyAssistedGoldTexture(prefix + 'gold_enemy', theme.gold, theme.enemy);
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
    
    const borderColor = this.darken(color, 0.5);
    const highlightColor = this.lighten(color, 0.35);
    const shadowColor = this.darken(color, 0.25);
    const midColor = this.darken(color, 0.1);
    
    const brickHeight = size / 2;
    
    // Draw individual bricks with 3D effect
    const drawBrick = (x: number, y: number, w: number, h: number) => {
      // Main fill with slight gradient effect
      ctx.fillStyle = this.colorToHex(color);
      ctx.fillRect(x, y, w, h);
      
      // Subtle texture noise
      ctx.fillStyle = this.colorToHex(midColor);
      for (let px = x + 2; px < x + w - 2; px += 3) {
        for (let py = y + 2; py < y + h - 2; py += 3) {
          if (Math.random() > 0.7) {
            ctx.fillRect(px, py, 1, 1);
          }
        }
      }
      
      // Top highlight
      ctx.fillStyle = this.colorToHex(highlightColor);
      ctx.fillRect(x + 1, y + 1, w - 2, 2);
      ctx.fillRect(x + 1, y + 1, 2, h - 2);
      
      // Bottom/right shadow
      ctx.fillStyle = this.colorToHex(shadowColor);
      ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
      ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
    };
    
    // Top row bricks (offset)
    drawBrick(1, 1, size / 2 - 2, brickHeight - 2);
    drawBrick(size / 2 + 1, 1, size / 2 - 2, brickHeight - 2);
    
    // Bottom row brick (centered)
    drawBrick(1, brickHeight + 1, size - 2, brickHeight - 2);
    
    // Mortar lines
    ctx.fillStyle = this.colorToHex(borderColor);
    ctx.fillRect(0, brickHeight - 1, size, 2); // Horizontal
    ctx.fillRect(size / 2 - 1, 0, 2, brickHeight); // Vertical top
    
    // Hard brick: metallic reinforcement
    if (hard) {
      // Steel X pattern
      ctx.strokeStyle = this.colorToHex(this.lighten(color, 0.6));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(5, 5);
      ctx.lineTo(size - 5, size - 5);
      ctx.moveTo(size - 5, 5);
      ctx.lineTo(5, size - 5);
      ctx.stroke();
      
      // Inner glow on X
      ctx.strokeStyle = this.colorToHex(this.lighten(color, 0.8));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(6, 6);
      ctx.lineTo(size - 6, size - 6);
      ctx.moveTo(size - 6, 6);
      ctx.lineTo(6, size - 6);
      ctx.stroke();
      
      // Corner rivets with 3D effect
      const drawRivet = (rx: number, ry: number) => {
        ctx.fillStyle = this.colorToHex(this.darken(color, 0.2));
        ctx.fillRect(rx, ry, 4, 4);
        ctx.fillStyle = this.colorToHex(this.lighten(color, 0.7));
        ctx.fillRect(rx, ry, 2, 2);
        ctx.fillStyle = this.colorToHex(this.darken(color, 0.4));
        ctx.fillRect(rx + 2, ry + 2, 2, 2);
      };
      drawRivet(2, 2);
      drawRivet(size - 6, 2);
      drawRivet(2, size - 6);
      drawRivet(size - 6, size - 6);
    }
    
    // Outer border
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
    
    // Slightly different color to hint at weakness
    const weakColor = this.blend(color, 0x4a3a2a, 0.15);
    const borderColor = this.darken(weakColor, 0.5);
    const highlightColor = this.lighten(weakColor, 0.25);
    const shadowColor = this.darken(weakColor, 0.25);
    const crackColor = this.darken(color, 0.65);
    const crackHighlight = this.darken(color, 0.4);
    
    const brickHeight = size / 2;
    
    // Draw brick similar to normal but with worn appearance
    const drawWeakBrick = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = this.colorToHex(weakColor);
      ctx.fillRect(x, y, w, h);
      
      // More pronounced texture (worn)
      ctx.fillStyle = this.colorToHex(this.darken(weakColor, 0.15));
      for (let px = x + 1; px < x + w - 1; px += 2) {
        for (let py = y + 1; py < y + h - 1; py += 2) {
          if (Math.random() > 0.5) {
            ctx.fillRect(px, py, 1, 1);
          }
        }
      }
      
      ctx.fillStyle = this.colorToHex(highlightColor);
      ctx.fillRect(x + 1, y + 1, w - 3, 1);
      ctx.fillRect(x + 1, y + 1, 1, h - 3);
      
      ctx.fillStyle = this.colorToHex(shadowColor);
      ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
      ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
    };
    
    // Top row bricks
    drawWeakBrick(1, 1, size / 2 - 2, brickHeight - 2);
    drawWeakBrick(size / 2 + 1, 1, size / 2 - 2, brickHeight - 2);
    
    // Bottom row brick
    drawWeakBrick(1, brickHeight + 1, size - 2, brickHeight - 2);
    
    // Mortar lines
    ctx.fillStyle = this.colorToHex(borderColor);
    ctx.fillRect(0, brickHeight - 1, size, 2);
    ctx.fillRect(size / 2 - 1, 0, 2, brickHeight);
    
    // Crack pattern with depth effect
    // Main crack with shadow
    ctx.strokeStyle = this.colorToHex(crackColor);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(3, size - 3);
    ctx.lineTo(size / 2 - 1, size / 2 + 3);
    ctx.lineTo(size / 2 + 4, size / 2);
    ctx.lineTo(size - 5, 3);
    ctx.stroke();
    
    // Crack highlight (makes it look 3D)
    ctx.strokeStyle = this.colorToHex(crackHighlight);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, size - 4);
    ctx.lineTo(size / 2, size / 2 + 2);
    ctx.lineTo(size / 2 + 3, size / 2 - 1);
    ctx.stroke();
    
    // Secondary crack
    ctx.strokeStyle = this.colorToHex(crackColor);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2 - 1, size / 2 + 3);
    ctx.lineTo(size / 2 - 4, size - 5);
    ctx.stroke();
    
    // Crumble particles
    ctx.fillStyle = this.colorToHex(crackColor);
    ctx.fillRect(5, size / 2 + 5, 2, 2);
    ctx.fillRect(size / 2 + 2, size / 2 - 3, 2, 2);
    ctx.fillRect(size - 7, 5, 2, 2);
    ctx.fillRect(7, size - 7, 1, 1);
    ctx.fillRect(size / 2 - 3, brickHeight + 5, 1, 1);
    
    // Outer border
    ctx.strokeStyle = this.colorToHex(borderColor);
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, size, size);
    
    this.addTexture(key, canvas);
  }
  
  private generateLadderTexture(key: string, color: number, isExit: boolean = false): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    const railWidth = 4;
    const rungHeight = 3;
    const rungSpacing = 6;
    const railOffset = 4;
    
    const railHighlight = this.lighten(color, 0.45);
    const railShadow = this.darken(color, 0.35);
    const railMid = this.darken(color, 0.15);
    
    // Exit ladder glow background
    if (isExit) {
      const gradient = ctx.createLinearGradient(0, 0, size, 0);
      gradient.addColorStop(0, 'rgba(255, 255, 0, 0.1)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 0, 0.25)');
      gradient.addColorStop(1, 'rgba(255, 255, 0, 0.1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    
    // Draw 3D rails
    const drawRail = (x: number) => {
      // Shadow/depth
      ctx.fillStyle = this.colorToHex(railShadow);
      ctx.fillRect(x + railWidth - 1, 0, 1, size);
      
      // Main rail body
      ctx.fillStyle = this.colorToHex(color);
      ctx.fillRect(x + 1, 0, railWidth - 2, size);
      
      // Highlight edge
      ctx.fillStyle = this.colorToHex(railHighlight);
      ctx.fillRect(x, 0, 1, size);
      
      // Metal sheen
      ctx.fillStyle = this.colorToHex(railMid);
      ctx.fillRect(x + 2, 0, 1, size);
    };
    
    drawRail(railOffset);
    drawRail(size - railOffset - railWidth);
    
    // Draw 3D rungs
    for (let y = rungSpacing - 1; y < size; y += rungSpacing) {
      const rungY = y - rungHeight / 2;
      
      // Rung shadow
      ctx.fillStyle = this.colorToHex(railShadow);
      ctx.fillRect(railOffset + railWidth, rungY + rungHeight - 1, 
                   size - (railOffset + railWidth) * 2, 1);
      
      // Rung body
      ctx.fillStyle = this.colorToHex(color);
      ctx.fillRect(railOffset + railWidth - 1, rungY, 
                   size - (railOffset + railWidth - 1) * 2, rungHeight - 1);
      
      // Rung highlight
      ctx.fillStyle = this.colorToHex(railHighlight);
      ctx.fillRect(railOffset + railWidth, rungY, 
                   size - (railOffset + railWidth) * 2, 1);
    }
    
    // Exit ladder sparkles
    if (isExit) {
      ctx.fillStyle = '#ffff88';
      ctx.fillRect(railOffset + 1, 2, 2, 2);
      ctx.fillRect(size - railOffset - 3, size - 4, 2, 2);
      ctx.fillRect(size / 2 - 1, size / 2, 2, 2);
    }
    
    this.addTexture(key, canvas);
  }
  
  private generatePoleTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    const barHeight = 5;
    const y = size / 2 - barHeight / 2;
    
    const highlight = this.lighten(color, 0.5);
    const midlight = this.lighten(color, 0.25);
    const shadow = this.darken(color, 0.4);
    const deepShadow = this.darken(color, 0.55);
    
    // Drop shadow beneath bar
    ctx.fillStyle = this.colorToHex(deepShadow);
    ctx.fillRect(0, y + barHeight, size, 2);
    
    // Main bar body
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(0, y + 1, size, barHeight - 2);
    
    // Top highlight (metallic sheen)
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(0, y, size, 1);
    
    // Secondary highlight
    ctx.fillStyle = this.colorToHex(midlight);
    ctx.fillRect(0, y + 1, size, 1);
    
    // Bottom edge shadow
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(0, y + barHeight - 1, size, 1);
    
    // Support brackets with 3D effect
    const drawBracket = (bx: number) => {
      ctx.fillStyle = this.colorToHex(shadow);
      ctx.fillRect(bx, y - 3, 3, barHeight + 6);
      ctx.fillStyle = this.colorToHex(color);
      ctx.fillRect(bx, y - 3, 2, barHeight + 6);
      ctx.fillStyle = this.colorToHex(highlight);
      ctx.fillRect(bx, y - 3, 1, barHeight + 6);
    };
    
    drawBracket(0);
    drawBracket(size - 3);
    
    // Rivet details on brackets
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(1, y - 1, 1, 1);
    ctx.fillRect(size - 2, y - 1, 1, 1);
    ctx.fillRect(1, y + barHeight, 1, 1);
    ctx.fillRect(size - 2, y + barHeight, 1, 1);
    
    this.addTexture(key, canvas);
  }
  
  private generateGoldTexture(key: string, color: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    const highlight = this.lighten(color, 0.6);
    const midlight = this.lighten(color, 0.35);
    const shadow = this.darken(color, 0.35);
    const deepShadow = this.darken(color, 0.5);
    
    // Gold chest dimensions
    const pad = 3;
    const chestX = pad;
    const chestY = pad + 5;
    const chestW = size - pad * 2;
    const chestH = size - pad * 2 - 6;
    const lidH = 5;
    
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(chestX + 2, chestY + chestH + 1, chestW - 1, 2);
    
    // Chest body - gradient effect
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(chestX, chestY, chestW, chestH);
    
    // Body highlights and shadows for 3D effect
    ctx.fillStyle = this.colorToHex(midlight);
    ctx.fillRect(chestX, chestY, chestW, 2);
    ctx.fillRect(chestX, chestY, 2, chestH);
    
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(chestX, chestY + chestH - 2, chestW, 2);
    ctx.fillRect(chestX + chestW - 2, chestY, 2, chestH);
    
    // Chest lid (curved top effect)
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(chestX + 1, chestY - lidH, chestW - 2, lidH);
    
    // Lid curve highlight
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(chestX + 2, chestY - lidH, chestW - 4, 2);
    ctx.fillRect(chestX + 3, chestY - lidH - 1, chestW - 6, 1);
    
    // Lid shadow edge
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(chestX + 1, chestY - 1, chestW - 2, 1);
    
    // Metal bands
    ctx.fillStyle = this.colorToHex(deepShadow);
    ctx.fillRect(chestX, chestY + chestH / 2 - 1, chestW, 2);
    ctx.fillStyle = this.colorToHex(midlight);
    ctx.fillRect(chestX, chestY + chestH / 2 - 1, chestW, 1);
    
    // Lock/clasp with metallic effect
    const lockX = chestX + chestW / 2 - 3;
    const lockY = chestY + 2;
    ctx.fillStyle = this.colorToHex(deepShadow);
    ctx.fillRect(lockX, lockY, 6, 6);
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(lockX + 1, lockY + 1, 4, 4);
    ctx.fillStyle = this.colorToHex(midlight);
    ctx.fillRect(lockX + 1, lockY + 1, 2, 2);
    
    // Shine sparkles
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(chestX + 3, chestY - lidH + 2, 2, 2);
    ctx.fillRect(chestX + chestW - 6, chestY + 2, 1, 1);
    
    // Gleam effect
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(chestX + 2, chestY + 2, 3, 1);
    ctx.fillRect(chestX + 2, chestY + 2, 1, 3);
    
    this.addTexture(key, canvas);
  }
  
  /**
   * Generate a special gold texture for enemy-assisted gold.
   * Features a pulsing enemy-colored border/indicator that works across all themes.
   * The visual hint is a subtle "danger" indicator showing this gold requires
   * enemy interaction to collect.
   */
  private generateEnemyAssistedGoldTexture(key: string, goldColor: number, enemyColor: number): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    const highlight = this.lighten(goldColor, 0.6);
    const midlight = this.lighten(goldColor, 0.35);
    const shadow = this.darken(goldColor, 0.35);
    const deepShadow = this.darken(goldColor, 0.5);
    
    // Enemy indicator colors
    const enemyHighlight = this.lighten(enemyColor, 0.4);
    const enemyGlow = this.blend(enemyColor, 0xffffff, 0.3);
    
    // Gold chest dimensions
    const pad = 3;
    const chestX = pad;
    const chestY = pad + 5;
    const chestW = size - pad * 2;
    const chestH = size - pad * 2 - 6;
    const lidH = 5;
    
    // Draw enemy-colored pulsing border/glow FIRST (behind chest)
    // This creates a "danger zone" indicator around the gold
    ctx.fillStyle = this.colorToHex(this.darken(enemyColor, 0.3));
    ctx.fillRect(chestX - 2, chestY - lidH - 3, chestW + 4, chestH + lidH + 6);
    ctx.fillStyle = this.colorToHex(enemyColor);
    ctx.fillRect(chestX - 1, chestY - lidH - 2, chestW + 2, chestH + lidH + 4);
    
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(chestX + 2, chestY + chestH + 1, chestW - 1, 2);
    
    // Chest body - gradient effect
    ctx.fillStyle = this.colorToHex(goldColor);
    ctx.fillRect(chestX, chestY, chestW, chestH);
    
    // Body highlights and shadows for 3D effect
    ctx.fillStyle = this.colorToHex(midlight);
    ctx.fillRect(chestX, chestY, chestW, 2);
    ctx.fillRect(chestX, chestY, 2, chestH);
    
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(chestX, chestY + chestH - 2, chestW, 2);
    ctx.fillRect(chestX + chestW - 2, chestY, 2, chestH);
    
    // Chest lid (curved top effect)
    ctx.fillStyle = this.colorToHex(goldColor);
    ctx.fillRect(chestX + 1, chestY - lidH, chestW - 2, lidH);
    
    // Lid curve highlight
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(chestX + 2, chestY - lidH, chestW - 4, 2);
    ctx.fillRect(chestX + 3, chestY - lidH - 1, chestW - 6, 1);
    
    // Lid shadow edge
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(chestX + 1, chestY - 1, chestW - 2, 1);
    
    // Metal bands
    ctx.fillStyle = this.colorToHex(deepShadow);
    ctx.fillRect(chestX, chestY + chestH / 2 - 1, chestW, 2);
    ctx.fillStyle = this.colorToHex(midlight);
    ctx.fillRect(chestX, chestY + chestH / 2 - 1, chestW, 1);
    
    // Lock/clasp - use enemy color to indicate danger
    const lockX = chestX + chestW / 2 - 3;
    const lockY = chestY + 2;
    ctx.fillStyle = this.colorToHex(this.darken(enemyColor, 0.3));
    ctx.fillRect(lockX, lockY, 6, 6);
    ctx.fillStyle = this.colorToHex(enemyColor);
    ctx.fillRect(lockX + 1, lockY + 1, 4, 4);
    ctx.fillStyle = this.colorToHex(enemyHighlight);
    ctx.fillRect(lockX + 1, lockY + 1, 2, 2);
    
    // Shine sparkles
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(chestX + 3, chestY - lidH + 2, 2, 2);
    ctx.fillRect(chestX + chestW - 6, chestY + 2, 1, 1);
    
    // Enemy indicator corners (small triangles/marks)
    // These help colorblind users and add visual interest
    ctx.fillStyle = this.colorToHex(enemyGlow);
    // Top-left corner mark
    ctx.fillRect(1, 1, 3, 1);
    ctx.fillRect(1, 1, 1, 3);
    // Top-right corner mark  
    ctx.fillRect(size - 4, 1, 3, 1);
    ctx.fillRect(size - 2, 1, 1, 3);
    // Bottom-left corner mark
    ctx.fillRect(1, size - 2, 3, 1);
    ctx.fillRect(1, size - 4, 1, 3);
    // Bottom-right corner mark
    ctx.fillRect(size - 4, size - 2, 3, 1);
    ctx.fillRect(size - 2, size - 4, 1, 3);
    
    this.addTexture(key, canvas);
  }
  
  private generateHoleTexture(key: string): void {
    const size = CONFIG.TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    
    // Deep black pit
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    
    // Inner gradient for depth effect
    ctx.fillStyle = '#0a0a15';
    ctx.fillRect(2, 2, size - 4, size - 4);
    ctx.fillStyle = '#000000';
    ctx.fillRect(4, 4, size - 8, size - 8);
    
    // Crumbling edges with brick debris
    const debrisColors = ['#2a2a3a', '#252535', '#1a1a2a', '#303045'];
    
    // Top edge debris
    for (let i = 0; i < size; i += 3) {
      const h = Math.floor(Math.random() * 4) + 2;
      ctx.fillStyle = debrisColors[Math.floor(Math.random() * debrisColors.length)];
      ctx.fillRect(i, 0, 2, h);
      if (Math.random() > 0.5) {
        ctx.fillRect(i + 1, h, 1, 1);
      }
    }
    
    // Bottom edge debris
    for (let i = 0; i < size; i += 3) {
      const h = Math.floor(Math.random() * 3) + 1;
      ctx.fillStyle = debrisColors[Math.floor(Math.random() * debrisColors.length)];
      ctx.fillRect(i, size - h, 2, h);
    }
    
    // Side debris
    for (let j = 3; j < size - 3; j += 4) {
      ctx.fillStyle = debrisColors[Math.floor(Math.random() * debrisColors.length)];
      if (Math.random() > 0.5) {
        ctx.fillRect(0, j, Math.floor(Math.random() * 2) + 1, 2);
      }
      if (Math.random() > 0.5) {
        ctx.fillRect(size - 2, j, Math.floor(Math.random() * 2) + 1, 2);
      }
    }
    
    // Falling debris particles
    ctx.fillStyle = '#353550';
    ctx.fillRect(4, 6, 1, 1);
    ctx.fillRect(size - 6, 8, 1, 1);
    ctx.fillRect(size / 2, 4, 1, 1);
    
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
    const highlight = this.lighten(color, 0.45);
    const midlight = this.lighten(color, 0.2);
    const shadow = this.darken(color, 0.3);
    const outline = this.darken(color, 0.55);
    const skinColor = isEnemy ? 0x885566 : 0xeebb99;
    const skinHighlight = this.lighten(skinColor, 0.3);
    const skinShadow = this.darken(skinColor, 0.2);
    
    // Base character dimensions
    const headSize = 7;
    const bodyWidth = 10;
    const bodyHeight = 8;
    const legWidth = 3;
    const legHeight = 5;
    const armWidth = 3;
    const armHeight = 5;
    
    const cx = size / 2;
    let headY = 1;
    let bodyY = headY + headSize;
    let legY = bodyY + bodyHeight;
    let armY = bodyY;
    
    // Frame-specific modifications
    let leftLegOffset = 0;
    let rightLegOffset = 0;
    let leftArmOffset = 0;
    let rightArmOffset = 0;
    let leftArmY = armY;
    let rightArmY = armY;
    let armRaised = false;
    
    switch (frame) {
      case 'walk1':
        leftLegOffset = -2;
        rightLegOffset = 2;
        leftArmOffset = 1;
        rightArmOffset = -1;
        break;
      case 'walk2':
        leftLegOffset = 2;
        rightLegOffset = -2;
        leftArmOffset = -1;
        rightArmOffset = 1;
        break;
      case 'climb1':
        leftArmY -= 3;
        rightArmY += 1;
        leftLegOffset = 1;
        rightLegOffset = -1;
        break;
      case 'climb2':
        leftArmY += 1;
        rightArmY -= 3;
        leftLegOffset = -1;
        rightLegOffset = 1;
        break;
      case 'hang':
        armRaised = true;
        bodyY += 3;
        legY += 3;
        leftArmY = headY - 1;
        rightArmY = headY - 1;
        break;
      case 'dig':
        rightArmOffset = 4;
        rightArmY += 3;
        break;
      case 'fall':
        leftArmOffset = -2;
        rightArmOffset = 2;
        leftArmY -= 2;
        rightArmY -= 2;
        leftLegOffset = -2;
        rightLegOffset = 2;
        break;
      case 'trapped':
        bodyY = size - bodyHeight - 2;
        headY = bodyY - headSize + 2;
        legY = size;
        leftArmY = bodyY + 1;
        rightArmY = bodyY + 1;
        break;
    }
    
    // Draw shadow/outline first
    ctx.fillStyle = this.colorToHex(outline);
    
    // Head outline
    if (isEnemy) {
      ctx.beginPath();
      ctx.arc(cx, headY + headSize / 2, headSize / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Player has helmet
      ctx.fillRect(cx - headSize / 2 - 1, headY - 1, headSize + 2, headSize + 2);
    }
    
    // Body outline
    ctx.fillRect(cx - bodyWidth / 2 - 1, bodyY - 1, bodyWidth + 2, bodyHeight + 2);
    
    // Leg outlines
    ctx.fillRect(cx - bodyWidth / 2 + leftLegOffset - 1, legY - 1, legWidth + 2, legHeight + 1);
    ctx.fillRect(cx + bodyWidth / 2 - legWidth + rightLegOffset - 1, legY - 1, legWidth + 2, legHeight + 1);
    
    // Arm outlines
    if (!armRaised) {
      ctx.fillRect(cx - bodyWidth / 2 - armWidth + leftArmOffset - 1, leftArmY - 1, armWidth + 1, armHeight + 2);
      ctx.fillRect(cx + bodyWidth / 2 + rightArmOffset, rightArmY - 1, armWidth + 1, armHeight + 2);
    }
    
    // Fill body
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(cx - bodyWidth / 2, bodyY, bodyWidth, bodyHeight);
    
    // Body shading for 3D effect
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(cx - bodyWidth / 2, bodyY, 2, bodyHeight);
    ctx.fillRect(cx - bodyWidth / 2, bodyY, bodyWidth, 2);
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(cx + bodyWidth / 2 - 2, bodyY, 2, bodyHeight);
    ctx.fillRect(cx - bodyWidth / 2, bodyY + bodyHeight - 2, bodyWidth, 2);
    
    // Belt detail
    ctx.fillStyle = this.colorToHex(outline);
    ctx.fillRect(cx - bodyWidth / 2 + 1, bodyY + bodyHeight - 3, bodyWidth - 2, 2);
    ctx.fillStyle = this.colorToHex(midlight);
    ctx.fillRect(cx - 1, bodyY + bodyHeight - 3, 2, 2);
    
    // Fill legs
    ctx.fillStyle = this.colorToHex(color);
    ctx.fillRect(cx - bodyWidth / 2 + leftLegOffset, legY, legWidth, legHeight);
    ctx.fillRect(cx + bodyWidth / 2 - legWidth + rightLegOffset, legY, legWidth, legHeight);
    
    // Leg shading
    ctx.fillStyle = this.colorToHex(highlight);
    ctx.fillRect(cx - bodyWidth / 2 + leftLegOffset, legY, 1, legHeight);
    ctx.fillRect(cx + bodyWidth / 2 - legWidth + rightLegOffset, legY, 1, legHeight);
    
    // Boot detail
    ctx.fillStyle = this.colorToHex(shadow);
    ctx.fillRect(cx - bodyWidth / 2 + leftLegOffset, legY + legHeight - 2, legWidth, 2);
    ctx.fillRect(cx + bodyWidth / 2 - legWidth + rightLegOffset, legY + legHeight - 2, legWidth, 2);
    
    // Fill arms
    ctx.fillStyle = this.colorToHex(color);
    if (armRaised) {
      ctx.fillRect(cx - bodyWidth / 2 - armWidth + 1, leftArmY, armWidth, armHeight + 5);
      ctx.fillRect(cx + bodyWidth / 2 - 1, rightArmY, armWidth, armHeight + 5);
    } else {
      ctx.fillRect(cx - bodyWidth / 2 - armWidth + 1 + leftArmOffset, leftArmY, armWidth, armHeight);
      ctx.fillRect(cx + bodyWidth / 2 - 1 + rightArmOffset, rightArmY, armWidth, armHeight);
    }
    
    // Head
    if (isEnemy) {
      // Enemy - round head (alien/robot)
      ctx.fillStyle = this.colorToHex(skinColor);
      ctx.beginPath();
      ctx.arc(cx, headY + headSize / 2, headSize / 2, 0, Math.PI * 2);
      ctx.fill();
      
      // Face shading
      ctx.fillStyle = this.colorToHex(skinHighlight);
      ctx.beginPath();
      ctx.arc(cx - 1, headY + headSize / 2 - 1, headSize / 3, 0, Math.PI * 2);
      ctx.fill();
      
      // Angry eyes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 3, headY + 2, 2, 3);
      ctx.fillRect(cx + 1, headY + 2, 2, 3);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(cx - 2, headY + 3, 1, 2);
      ctx.fillRect(cx + 1, headY + 3, 1, 2);
      
      // Angry eyebrows
      ctx.fillStyle = this.colorToHex(outline);
      ctx.fillRect(cx - 3, headY + 1, 3, 1);
      ctx.fillRect(cx + 1, headY + 1, 3, 1);
    } else {
      // Player - helmet
      ctx.fillStyle = this.colorToHex(color);
      ctx.fillRect(cx - headSize / 2, headY, headSize, headSize);
      
      // Helmet highlights
      ctx.fillStyle = this.colorToHex(highlight);
      ctx.fillRect(cx - headSize / 2, headY, headSize, 2);
      ctx.fillRect(cx - headSize / 2, headY, 2, headSize);
      
      // Visor
      ctx.fillStyle = '#115577';
      ctx.fillRect(cx - 2, headY + 2, 5, 3);
      ctx.fillStyle = '#22aadd';
      ctx.fillRect(cx - 1, headY + 2, 3, 2);
      ctx.fillStyle = '#88eeff';
      ctx.fillRect(cx - 1, headY + 2, 1, 1);
      
      // Helmet detail
      ctx.fillStyle = this.colorToHex(shadow);
      ctx.fillRect(cx - headSize / 2, headY + headSize - 1, headSize, 1);
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
  
  private blend(color1: number, color2: number, amount: number): number {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;
    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;
    const r = Math.floor(r1 * (1 - amount) + r2 * amount);
    const g = Math.floor(g1 * (1 - amount) + g2 * amount);
    const b = Math.floor(b1 * (1 - amount) + b2 * amount);
    return (r << 16) | (g << 8) | b;
  }
  
  getTextureKey(baseName: string): string {
    return this.textures.get(baseName) || baseName;
  }
  
  hasTexture(key: string): boolean {
    return this.textures.has(key);
  }
}
