import Phaser from 'phaser';
import { CONFIG, TileType, THEMES, Theme, DIFFICULTIES } from '../config';
import { TileMap } from '../level/TileMap';
import { LevelGenerator } from '../level/LevelGenerator';
import { Player, PlayerState } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { generateSeedCode } from '../utils/SeededRandom';

export class GameScene extends Phaser.Scene {
  private tileMap!: TileMap;
  private tileSprites: Phaser.GameObjects.Rectangle[][] = [];
  private goldSprites: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private player!: Player;
  private enemies: Enemy[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private digKeys!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  
  // Game state
  private score: number = 0;
  private lives: number = 3;
  private level: number = 1;
  private seedCode: string = '';
  private difficulty: string = 'normal';
  private theme: Theme = THEMES.cyber;
  private themeKeys = Object.keys(THEMES);
  private themeIndex: number = 0;
  
  // Speed control
  private speedIndex: number = CONFIG.DEFAULT_SPEED_INDEX;
  private paused: boolean = false;
  
  // HUD elements
  private hudText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private hudBg!: Phaser.GameObjects.Rectangle;
  
  // Controls
  private keySpeed!: { plus: Phaser.Input.Keyboard.Key; minus: Phaser.Input.Keyboard.Key };
  private keyPause!: Phaser.Input.Keyboard.Key;
  private keyRestart!: Phaser.Input.Keyboard.Key;
  private keyNewLevel!: Phaser.Input.Keyboard.Key;
  private keyTheme!: Phaser.Input.Keyboard.Key;
  
  constructor() {
    super({ key: 'GameScene' });
  }
  
  init(data: { difficulty?: string; seed?: string }): void {
    this.difficulty = data.difficulty || 'normal';
    this.seedCode = data.seed || generateSeedCode();
    this.score = 0;
    this.lives = 3;
    this.level = 1;
  }
  
  create(): void {
    // Set up input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.digKeys = {
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X)
    };
    this.keySpeed = {
      plus: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS),
      minus: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS)
    };
    this.keyPause = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.keyRestart = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyNewLevel = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.N);
    this.keyTheme = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.T);
    
    // Also bind = for speed up (next to -)
    const keyEquals = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH);
    
    // Create HUD background
    this.hudBg = this.add.rectangle(
      CONFIG.GAME_WIDTH / 2,
      CONFIG.GRID_HEIGHT * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE,
      CONFIG.GAME_WIDTH,
      CONFIG.TILE_SIZE * 2,
      this.theme.hudBg
    );
    this.hudBg.setDepth(50);
    
    // Create HUD text
    this.hudText = this.add.text(10, CONFIG.GRID_HEIGHT * CONFIG.TILE_SIZE + 8, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#' + this.theme.hudText.toString(16).padStart(6, '0')
    });
    this.hudText.setDepth(51);
    
    // Message text (centered)
    this.messageText = this.add.text(
      CONFIG.GAME_WIDTH / 2, 
      CONFIG.GAME_HEIGHT / 2 - 50, 
      '', 
      {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
        align: 'center'
      }
    );
    this.messageText.setOrigin(0.5);
    this.messageText.setDepth(100);
    
    // Generate and load level
    this.generateLevel();
    
    // Set up events
    this.events.on('goldCollected', this.onGoldCollected, this);
    this.events.on('playerDied', this.onPlayerDied, this);
    
    // Camera setup
    this.cameras.main.setBackgroundColor(this.theme.background);
  }
  
  private generateLevel(): void {
    // Clear previous
    this.clearLevel();
    
    // Generate new level with seed + level number
    const seed = `${this.seedCode}-L${this.level}`;
    const generator = new LevelGenerator(seed, this.difficulty);
    this.tileMap = generator.generate();
    
    // Render tiles
    this.renderTiles();
    
    // Create player
    this.player = new Player(
      this, 
      this.tileMap, 
      this.tileMap.playerStart.x, 
      this.tileMap.playerStart.y,
      this.theme.player
    );
    
    // Create enemies
    const diffSettings = DIFFICULTIES[this.difficulty];
    for (const start of this.tileMap.enemyStarts) {
      const enemy = new Enemy(
        this, 
        this.tileMap, 
        this.player,
        start.x, 
        start.y, 
        this.theme.enemy,
        diffSettings.enemySpeed
      );
      this.enemies.push(enemy);
    }
    
    this.updateHUD();
  }
  
  private clearLevel(): void {
    // Destroy tile sprites
    for (const row of this.tileSprites) {
      for (const sprite of row) {
        sprite?.destroy();
      }
    }
    this.tileSprites = [];
    
    // Destroy gold sprites
    for (const sprite of this.goldSprites.values()) {
      sprite.destroy();
    }
    this.goldSprites.clear();
    
    // Destroy player
    if (this.player) {
      this.player.sprite.destroy();
    }
    
    // Destroy enemies
    for (const enemy of this.enemies) {
      enemy.sprite.destroy();
    }
    this.enemies = [];
  }
  
  private renderTiles(): void {
    this.tileSprites = [];
    
    for (let y = 0; y < this.tileMap.height; y++) {
      this.tileSprites[y] = [];
      for (let x = 0; x < this.tileMap.width; x++) {
        const tile = this.tileMap.getTile(x, y);
        const sprite = this.createTileSprite(x, y, tile);
        this.tileSprites[y][x] = sprite;
      }
    }
  }
  
  private createTileSprite(x: number, y: number, tile: TileType): Phaser.GameObjects.Rectangle {
    const px = x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const py = y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    
    let color = this.theme.background;
    let width = CONFIG.TILE_SIZE;
    let height = CONFIG.TILE_SIZE;
    
    switch (tile) {
      case TileType.BRICK:
      case TileType.BRICK_TRAP: // Looks same as brick
        color = this.theme.brick;
        break;
      case TileType.BRICK_HARD:
        color = this.theme.brickHard;
        break;
      case TileType.LADDER:
        color = this.theme.ladder;
        width = 8;
        break;
      case TileType.LADDER_EXIT:
        color = this.theme.ladder;
        width = 8;
        // Exit ladders flash when all gold collected
        break;
      case TileType.POLE:
        color = this.theme.pole;
        height = 4;
        break;
      case TileType.GOLD:
        // Create separate gold sprite
        const goldSprite = this.add.rectangle(px, py, 12, 12, this.theme.gold);
        goldSprite.setDepth(5);
        this.goldSprites.set(`${x},${y}`, goldSprite);
        color = this.theme.background; // Background tile
        break;
      case TileType.HOLE:
        color = 0x000000;
        break;
      default:
        color = this.theme.background;
    }
    
    const sprite = this.add.rectangle(px, py, width, height, color);
    sprite.setDepth(tile === TileType.POLE ? 1 : 0);
    return sprite;
  }
  
  private updateTileSprite(x: number, y: number): void {
    const tile = this.tileMap.getTile(x, y);
    const oldSprite = this.tileSprites[y][x];
    oldSprite?.destroy();
    
    // Remove gold sprite if exists
    const goldKey = `${x},${y}`;
    const goldSprite = this.goldSprites.get(goldKey);
    if (goldSprite) {
      goldSprite.destroy();
      this.goldSprites.delete(goldKey);
    }
    
    this.tileSprites[y][x] = this.createTileSprite(x, y, tile);
  }
  
  update(_time: number, delta: number): void {
    // Handle system keys
    if (Phaser.Input.Keyboard.JustDown(this.keyPause)) {
      this.paused = !this.paused;
      this.showMessage(this.paused ? 'PAUSED' : '');
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyTheme)) {
      this.cycleTheme();
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyRestart)) {
      this.restartLevel();
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyNewLevel)) {
      this.seedCode = generateSeedCode();
      this.level = 1;
      this.score = 0;
      this.lives = 3;
      this.generateLevel();
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keySpeed.plus)) {
      this.speedIndex = Math.min(this.speedIndex + 1, CONFIG.SPEED_MULTIPLIERS.length - 1);
      this.updateHUD();
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keySpeed.minus)) {
      this.speedIndex = Math.max(this.speedIndex - 1, 0);
      this.updateHUD();
    }
    
    if (this.paused) return;
    if (this.player.state === PlayerState.DEAD) return;
    
    const speedMult = CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
    
    // Update player
    this.player.update(delta, this.cursors, this.digKeys, speedMult);
    
    // Update enemies
    for (const enemy of this.enemies) {
      enemy.update(delta, speedMult);
    }
    
    // Update holes
    const { filled, warning } = this.tileMap.updateHoles();
    for (const hole of filled) {
      this.updateTileSprite(hole.x, hole.y);
      
      // Check if player or enemy is trapped
      if (this.player.gridX === hole.x && this.player.gridY === hole.y) {
        this.player.die();
      }
      for (const enemy of this.enemies) {
        if (enemy.gridX === hole.x && enemy.gridY === hole.y) {
          enemy.kill();
        }
      }
    }
    
    // Flash warning holes
    for (const hole of warning) {
      const sprite = this.tileSprites[hole.y]?.[hole.x];
      if (sprite) {
        const flash = Math.sin(Date.now() / 50) > 0;
        sprite.setFillStyle(flash ? 0xff0000 : 0x000000);
      }
    }
    
    // Check for dug holes (update visuals)
    for (const hole of this.tileMap.holes) {
      if (this.tileMap.getTile(hole.x, hole.y) === TileType.HOLE) {
        const sprite = this.tileSprites[hole.y]?.[hole.x];
        if (sprite && sprite.fillColor !== 0x000000 && hole.timer > CONFIG.HOLE_WARNING) {
          this.updateTileSprite(hole.x, hole.y);
        }
      }
    }
    
    // Check win condition
    if (this.tileMap.goldPositions.length === 0) {
      this.checkWinCondition();
    }
    
    this.updateHUD();
  }
  
  private onGoldCollected(data: { x: number; y: number }): void {
    this.score += 100;
    this.updateTileSprite(data.x, data.y);
    
    // Show exit ladders when all gold collected
    if (this.tileMap.goldPositions.length === 0) {
      for (const exit of this.tileMap.exitLadders) {
        this.tileMap.setTile(exit.x, exit.y, TileType.LADDER_EXIT);
        this.updateTileSprite(exit.x, exit.y);
      }
      this.showMessage('EXIT AT TOP!', 2000);
    }
  }
  
  private checkWinCondition(): void {
    // Player must be at top row on exit ladder
    if (this.player.gridY === 0) {
      const tile = this.tileMap.getTile(this.player.gridX, 0);
      if (tile === TileType.LADDER_EXIT || tile === TileType.LADDER) {
        this.winLevel();
      }
    }
  }
  
  private winLevel(): void {
    this.score += 500; // Level bonus
    this.level++;
    this.showMessage(`LEVEL ${this.level - 1} COMPLETE!`, 2000);
    
    this.time.delayedCall(2000, () => {
      this.generateLevel();
    });
  }
  
  private onPlayerDied(): void {
    this.lives--;
    
    if (this.lives <= 0) {
      this.showMessage('GAME OVER\n\nPress R to restart');
      // Could transition to game over scene
    } else {
      this.showMessage(`LIVES: ${this.lives}`, 1500);
      this.time.delayedCall(1500, () => {
        this.restartLevel();
      });
    }
  }
  
  private restartLevel(): void {
    if (this.lives <= 0) {
      this.lives = 3;
      this.score = 0;
      this.level = 1;
    }
    this.generateLevel();
    this.showMessage('');
  }
  
  private cycleTheme(): void {
    this.themeIndex = (this.themeIndex + 1) % this.themeKeys.length;
    this.theme = THEMES[this.themeKeys[this.themeIndex]];
    this.applyTheme();
  }
  
  private applyTheme(): void {
    this.cameras.main.setBackgroundColor(this.theme.background);
    
    // Update HUD
    this.hudBg.setFillStyle(this.theme.hudBg);
    this.hudText.setColor('#' + this.theme.hudText.toString(16).padStart(6, '0'));
    
    // Update player
    this.player.setColor(this.theme.player);
    
    // Update enemies
    for (const enemy of this.enemies) {
      enemy.setColor(this.theme.enemy);
    }
    
    // Re-render tiles
    for (let y = 0; y < this.tileMap.height; y++) {
      for (let x = 0; x < this.tileMap.width; x++) {
        this.updateTileSprite(x, y);
      }
    }
  }
  
  private showMessage(text: string, duration?: number): void {
    this.messageText.setText(text);
    
    if (duration) {
      this.time.delayedCall(duration, () => {
        this.messageText.setText('');
      });
    }
  }
  
  private updateHUD(): void {
    const speed = CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
    const diffName = DIFFICULTIES[this.difficulty]?.name || 'NORMAL';
    
    this.hudText.setText(
      `SCORE: ${this.score.toString().padStart(6, '0')}  ` +
      `LIVES: ${this.lives}  ` +
      `LEVEL: ${this.level}  ` +
      `GOLD: ${this.tileMap.goldPositions.length}  ` +
      `SPEED: ${speed}x  ` +
      `[${diffName}]  ` +
      `SEED: ${this.seedCode}`
    );
  }
}
