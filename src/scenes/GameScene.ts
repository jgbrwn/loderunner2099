import Phaser from 'phaser';
import { CONFIG, TileType, THEMES, Theme, DIFFICULTIES } from '../config';
import { TileMap } from '../level/TileMap';
import { LevelGenerator } from '../level/LevelGenerator';
import { Player, PlayerState } from '../entities/Player';
import { Enemy, EnemyState } from '../entities/Enemy';
import { generateSeedCode } from '../utils/SeededRandom';
import { TileGraphics } from '../graphics/TileGraphics';
import { CRTEffect } from '../graphics/CRTEffect';
import { TouchControls } from '../ui/TouchControls';
import { getSoundManager } from '../audio/SoundManager';
import { getHighScores } from '../systems/HighScores';

export class GameScene extends Phaser.Scene {
  private tileMap!: TileMap;
  private tileSprites: (Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle)[][] = [];
  private goldSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private player!: Player;
  private enemies: Enemy[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private digKeys!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  
  // Graphics system
  private tileGraphics!: TileGraphics;
  private crtEffect!: CRTEffect;
  private touchControls!: TouchControls;
  
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
  private gameOver: boolean = false;
  
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
  private keyCRT!: Phaser.Input.Keyboard.Key;
  private keyMute!: Phaser.Input.Keyboard.Key;
  
  // Animation tracking
  private lastStepTime: number = 0;
  private stepInterval: number = 150;
  
  constructor() {
    super({ key: 'GameScene' });
  }
  
  init(data: { difficulty?: string; seed?: string }): void {
    this.difficulty = data.difficulty || 'normal';
    this.seedCode = data.seed || generateSeedCode();
    this.score = 0;
    this.lives = DIFFICULTIES[this.difficulty]?.lives || 5;
    this.level = 1;
    this.gameOver = false;
  }
  
  create(): void {
    // Initialize sound
    getSoundManager().resume();
    
    // Initialize graphics system
    this.tileGraphics = new TileGraphics(this);
    this.tileGraphics.generateTextures(this.theme);
    
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
    this.keyCRT = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.C);
    this.keyMute = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    
    // Also bind = for speed up
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD);
    
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
      fontSize: '14px',
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
        align: 'center',
        stroke: '#000000',
        strokeThickness: 4
      }
    );
    this.messageText.setOrigin(0.5);
    this.messageText.setDepth(100);
    
    // Generate and load level
    this.generateLevel();
    
    // Set up events
    this.events.on('goldCollected', this.onGoldCollected, this);
    this.events.on('playerDied', this.onPlayerDied, this);
    this.events.on('enemyTrapped', this.onEnemyTrapped, this);
    
    // Camera setup
    this.cameras.main.setBackgroundColor(this.theme.background);
    
    // CRT Effect (after everything else)
    this.crtEffect = new CRTEffect(this);
    if (!this.theme.scanlines) {
      this.crtEffect.setIntensity(0.3);
    }
    
    // Touch controls (on top of CRT)
    this.touchControls = new TouchControls(this);
    
    // Update URL for sharing
    this.updateShareURL();
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
  
  private createTileSprite(x: number, y: number, tile: TileType): Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle {
    const px = x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const py = y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    
    let textureKey: string | null = null;
    let fallbackColor = this.theme.background;
    let width = CONFIG.TILE_SIZE;
    let height = CONFIG.TILE_SIZE;
    
    switch (tile) {
      case TileType.BRICK:
        textureKey = 'brick';
        fallbackColor = this.theme.brick;
        break;
      case TileType.BRICK_TRAP:
        textureKey = 'brick_trap';
        fallbackColor = this.theme.brick;
        break;
      case TileType.BRICK_HARD:
        textureKey = 'brick_hard';
        fallbackColor = this.theme.brickHard;
        break;
      case TileType.LADDER:
        textureKey = 'ladder';
        fallbackColor = this.theme.ladder;
        break;
      case TileType.LADDER_EXIT:
        textureKey = 'ladder_exit';
        fallbackColor = this.theme.ladder;
        break;
      case TileType.POLE:
        textureKey = 'pole';
        fallbackColor = this.theme.pole;
        break;
      case TileType.GOLD:
        // Create separate gold sprite with animation
        this.createGoldSprite(x, y);
        fallbackColor = this.theme.background;
        break;
      case TileType.HOLE:
        textureKey = 'hole';
        fallbackColor = 0x000000;
        break;
      default:
        fallbackColor = this.theme.background;
    }
    
    // Try to use texture, fall back to rectangle
    if (textureKey && this.textures.exists(textureKey)) {
      const sprite = this.add.sprite(px, py, textureKey);
      sprite.setDepth(tile === TileType.POLE ? 1 : 0);
      return sprite;
    } else {
      const rect = this.add.rectangle(px, py, width, height, fallbackColor);
      rect.setDepth(tile === TileType.POLE ? 1 : 0);
      return rect;
    }
  }
  
  private createGoldSprite(x: number, y: number): void {
    const px = x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const py = y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    
    let goldSprite: Phaser.GameObjects.Sprite;
    
    if (this.textures.exists('gold')) {
      goldSprite = this.add.sprite(px, py, 'gold');
    } else {
      // Fallback to rectangle if texture not available
      const rect = this.add.rectangle(px, py, 12, 12, this.theme.gold) as any;
      rect.setDepth(5);
      this.goldSprites.set(`${x},${y}`, rect);
      return;
    }
    
    goldSprite.setDepth(5);
    
    // Add sparkle animation
    this.tweens.add({
      targets: goldSprite,
      scaleX: { from: 1, to: 1.1 },
      scaleY: { from: 1, to: 1.1 },
      alpha: { from: 1, to: 0.8 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    
    this.goldSprites.set(`${x},${y}`, goldSprite);
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
  
  update(time: number, delta: number): void {
    // Handle system keys
    if (Phaser.Input.Keyboard.JustDown(this.keyPause)) {
      this.paused = !this.paused;
      this.showMessage(this.paused ? 'PAUSED\n\nP to resume' : '');
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyTheme)) {
      this.cycleTheme();
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyCRT)) {
      const enabled = this.crtEffect.toggle();
      this.showMessage(enabled ? 'CRT ON' : 'CRT OFF', 1000);
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyMute)) {
      const enabled = getSoundManager().toggle();
      this.showMessage(enabled ? 'SOUND ON' : 'SOUND OFF', 1000);
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyRestart)) {
      this.restartLevel();
    }
    
    if (Phaser.Input.Keyboard.JustDown(this.keyNewLevel)) {
      this.seedCode = generateSeedCode();
      this.level = 1;
      this.score = 0;
      this.lives = DIFFICULTIES[this.difficulty]?.lives || 5;
      this.gameOver = false;
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
    
    if (this.paused || this.gameOver) return;
    if (this.player.state === PlayerState.DEAD) return;
    
    const speedMult = CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
    
    // Create combined input from keyboard and touch
    const input = this.getCombinedInput();
    
    // Update player
    const prevState = this.player.state;
    this.player.update(delta, input.cursors, input.digKeys, speedMult);
    
    // Play step sounds
    if (this.player.state === PlayerState.WALKING && time - this.lastStepTime > this.stepInterval / speedMult) {
      getSoundManager().playStep();
      this.lastStepTime = time;
    } else if (this.player.state === PlayerState.CLIMBING && time - this.lastStepTime > this.stepInterval * 1.5 / speedMult) {
      getSoundManager().playClimb();
      this.lastStepTime = time;
    }
    
    // Detect state changes for sounds
    if (prevState !== PlayerState.FALLING && this.player.state === PlayerState.FALLING) {
      getSoundManager().playFall();
    }
    if (prevState !== PlayerState.DIGGING && this.player.state === PlayerState.DIGGING) {
      getSoundManager().playDig();
    }
    
    // Update enemies
    for (const enemy of this.enemies) {
      const prevEnemyState = enemy.state;
      enemy.update(delta, speedMult);
      
      // Check if enemy just got trapped
      if (prevEnemyState !== EnemyState.TRAPPED && enemy.state === EnemyState.TRAPPED) {
        this.events.emit('enemyTrapped', enemy);
      }
    }
    
    // Update holes
    const { filled, warning } = this.tileMap.updateHoles();
    for (const hole of filled) {
      this.updateTileSprite(hole.x, hole.y);
      getSoundManager().playHoleFill();
      
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
        const flash = Math.sin(time / 50) > 0;
        if (sprite instanceof Phaser.GameObjects.Rectangle) {
          sprite.setFillStyle(flash ? 0xff0000 : 0x000000);
        } else {
          sprite.setTint(flash ? 0xff0000 : 0xffffff);
        }
      }
    }
    
    // Check for dug holes (update visuals)
    for (const hole of this.tileMap.holes) {
      if (this.tileMap.getTile(hole.x, hole.y) === TileType.HOLE) {
        const sprite = this.tileSprites[hole.y]?.[hole.x];
        if (sprite && hole.timer > CONFIG.HOLE_WARNING) {
          const currentColor = sprite instanceof Phaser.GameObjects.Rectangle ? 
            sprite.fillColor : 0;
          if (currentColor !== 0x000000) {
            this.updateTileSprite(hole.x, hole.y);
          }
        }
      }
    }
    
    // Check win condition
    if (this.tileMap.goldPositions.length === 0) {
      this.checkWinCondition();
    }
    
    // Update CRT effect
    this.crtEffect.update();
    
    // Update touch control prev state
    this.touchControls.updatePrevState();
    
    this.updateHUD();
  }
  
  private getCombinedInput(): { 
    cursors: Phaser.Types.Input.Keyboard.CursorKeys; 
    digKeys: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key } 
  } {
    // Create a virtual cursor state that combines keyboard and touch
    const tc = this.touchControls;
    
    // Override isDown checks with touch state
    const cursors = {
      left: { isDown: this.cursors.left.isDown || tc.left } as Phaser.Input.Keyboard.Key,
      right: { isDown: this.cursors.right.isDown || tc.right } as Phaser.Input.Keyboard.Key,
      up: { isDown: this.cursors.up.isDown || tc.up } as Phaser.Input.Keyboard.Key,
      down: { isDown: this.cursors.down.isDown || tc.down } as Phaser.Input.Keyboard.Key,
      space: this.cursors.space,
      shift: this.cursors.shift
    } as Phaser.Types.Input.Keyboard.CursorKeys;
    
    // For dig keys, check JustDown OR touch just pressed
    const digLeft = {
      ...this.digKeys.left,
      _justDown: Phaser.Input.Keyboard.JustDown(this.digKeys.left) || tc.justPressedDigLeft()
    };
    const digRight = {
      ...this.digKeys.right,
      _justDown: Phaser.Input.Keyboard.JustDown(this.digKeys.right) || tc.justPressedDigRight()
    };
    
    return { 
      cursors, 
      digKeys: { left: digLeft as any, right: digRight as any } 
    };
  }
  
  private onEnemyTrapped(_enemy: Enemy): void {
    getSoundManager().playEnemyTrapped();
    this.score += 50; // Bonus for trapping enemy
  }
  
  private onGoldCollected(data: { x: number; y: number }): void {
    this.score += 100;
    getSoundManager().playGold();
    this.updateTileSprite(data.x, data.y);
    
    // Show exit ladders when all gold collected
    if (this.tileMap.goldPositions.length === 0) {
      getSoundManager().playExitAppear();
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
    this.score += 500 + this.level * 100; // Level bonus increases with level
    this.level++;
    getSoundManager().playLevelComplete();
    this.showMessage(`LEVEL ${this.level - 1} COMPLETE!\n\n+${500 + (this.level - 1) * 100} BONUS`, 2000);
    
    this.time.delayedCall(2000, () => {
      this.generateLevel();
    });
  }
  
  private onPlayerDied(): void {
    this.lives--;
    getSoundManager().playDeath();
    
    if (this.lives <= 0) {
      this.gameOver = true;
      this.checkHighScore();
    } else {
      this.showMessage(`LIVES: ${this.lives}`, 1500);
      this.time.delayedCall(1500, () => {
        this.restartLevel();
      });
    }
  }
  
  private checkHighScore(): void {
    const highScores = getHighScores();
    
    if (highScores.isHighScore(this.score)) {
      // Simple name entry - in a real game you'd have a proper UI
      const rank = highScores.addScore({
        name: 'PLAYER',
        score: this.score,
        level: this.level,
        difficulty: this.difficulty,
        seed: this.seedCode
      });
      
      this.showMessage(
        `GAME OVER\n\nNEW HIGH SCORE!\nRANK: #${rank}\nSCORE: ${this.score}\n\nPress R to restart`
      );
    } else {
      const top = highScores.getTopScore();
      const topText = top ? `\nHIGH SCORE: ${top.score}` : '';
      this.showMessage(`GAME OVER\n\nSCORE: ${this.score}${topText}\n\nPress R to restart`);
    }
  }
  
  private restartLevel(): void {
    if (this.gameOver) {
      this.lives = DIFFICULTIES[this.difficulty]?.lives || 5;
      this.score = 0;
      this.level = 1;
      this.gameOver = false;
    }
    this.generateLevel();
    this.showMessage('');
  }
  
  private cycleTheme(): void {
    this.themeIndex = (this.themeIndex + 1) % this.themeKeys.length;
    this.theme = THEMES[this.themeKeys[this.themeIndex]];
    this.applyTheme();
    getSoundManager().playMenuSelect();
  }
  
  private applyTheme(): void {
    // Regenerate textures for new theme
    this.tileGraphics.generateTextures(this.theme);
    
    this.cameras.main.setBackgroundColor(this.theme.background);
    
    // Update HUD
    this.hudBg.setFillStyle(this.theme.hudBg);
    this.hudText.setColor('#' + this.theme.hudText.toString(16).padStart(6, '0'));
    
    // Update player (recreate sprite with new texture)
    this.player.recreateSprite(this.theme.player);
    
    // Update enemies
    for (const enemy of this.enemies) {
      enemy.recreateSprite(this.theme.enemy);
    }
    
    // Re-render tiles
    for (let y = 0; y < this.tileMap.height; y++) {
      for (let x = 0; x < this.tileMap.width; x++) {
        this.updateTileSprite(x, y);
      }
    }
    
    // Update CRT effect
    this.crtEffect.applyTheme(this.theme);
  }
  
  private showMessage(text: string, duration?: number): void {
    this.messageText.setText(text);
    
    if (duration) {
      this.time.delayedCall(duration, () => {
        if (this.messageText.text === text) {
          this.messageText.setText('');
        }
      });
    }
  }
  
  private updateHUD(): void {
    const speed = CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
    const diffName = DIFFICULTIES[this.difficulty]?.name || 'NORMAL';
    const goldRemaining = this.tileMap?.goldPositions?.length ?? 0;
    
    this.hudText.setText(
      `SCORE: ${this.score.toString().padStart(6, '0')}  ` +
      `LIVES: ${this.lives}  ` +
      `LEVEL: ${this.level}  ` +
      `GOLD: ${goldRemaining}  ` +
      `SPD: ${speed}x  ` +
      `[${diffName}]  ` +
      `SEED: ${this.seedCode}`
    );
  }
  
  /**
   * Update URL with current game state for sharing
   */
  private updateShareURL(): void {
    const params = new URLSearchParams();
    params.set('seed', this.seedCode);
    params.set('diff', this.difficulty);
    const newURL = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newURL);
  }
  
  /**
   * Get the shareable URL for current game
   */
  getShareURL(): string {
    const params = new URLSearchParams();
    params.set('seed', this.seedCode);
    params.set('diff', this.difficulty);
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }
  
  shutdown(): void {
    this.crtEffect?.destroy();
    this.touchControls?.destroy();
  }
}
