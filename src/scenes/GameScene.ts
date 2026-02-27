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
import { MusicGenerator, MusicTrack } from '../audio/MusicGenerator';
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
  private hudControls!: Phaser.GameObjects.Text;
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
  private keyMusic!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  
  // Music system
  private currentMusicTrack: MusicTrack | null = null;
  
  // ESC menu tracking - use raw DOM listener for reliability
  private escPressCount: number = 0;
  private escLastPressTime: number = 0;
  private escKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private shouldReturnToMenu: boolean = false;

  
  // Animation tracking
  private lastStepTime: number = 0;
  private stepInterval: number = 150;
  
  // Game flow flags
  private playerHasMoved: boolean = false;
  private levelCompleting: boolean = false;
  
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
    // Reset ESC state
    this.escPressCount = 0;
    this.escLastPressTime = 0;
    this.shouldReturnToMenu = false;
    
    // Set up raw DOM listener for ESC key (more reliable than Phaser's)
    this.escKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const now = Date.now();
        
        if (this.escPressCount === 1 && now - this.escLastPressTime < 2000) {
          // Second press within 2 seconds - set flag to return to menu
          this.escPressCount = 0;
          this.shouldReturnToMenu = true; // Handle in update loop
        } else {
          // First press or timeout expired
          this.escPressCount = 1;
          this.escLastPressTime = now;
          this.showMessage('Press ESC again to return to menu', 2000);
        }
      }
    };
    window.addEventListener('keydown', this.escKeyHandler);
    
    // Clean up listener when scene shuts down
    this.events.on('shutdown', () => {
      if (this.escKeyHandler) {
        window.removeEventListener('keydown', this.escKeyHandler);
        this.escKeyHandler = null;
      }
    });
    
    // Reset all keyboard states
    this.input.keyboard!.resetKeys();
    
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
    this.keyMusic = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.keyEsc = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    
    // Also bind = for speed up
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD);
    
    // Create HUD background (taller to fit 2 lines)
    this.hudBg = this.add.rectangle(
      CONFIG.GAME_WIDTH / 2,
      CONFIG.GRID_HEIGHT * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE * 1.5,
      CONFIG.GAME_WIDTH,
      CONFIG.TILE_SIZE * 3,
      this.theme.hudBg
    );
    this.hudBg.setDepth(50);
    
    // Create HUD text (score, lives, etc) - centered
    this.hudText = this.add.text(CONFIG.GAME_WIDTH / 2, CONFIG.GRID_HEIGHT * CONFIG.TILE_SIZE + 4, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#' + this.theme.hudText.toString(16).padStart(6, '0')
    });
    this.hudText.setOrigin(0.5, 0);
    this.hudText.setDepth(51);
    
    // Create HUD controls text (keyboard shortcuts) - centered
    this.hudControls = this.add.text(CONFIG.GAME_WIDTH / 2, CONFIG.GRID_HEIGHT * CONFIG.TILE_SIZE + 22, 
      'Z/X:Dig | +/-:Speed | P:Pause | T:Theme | C:CRT | M:Mute | B:Music | R:Restart | ESC:Menu', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#666688'
    });
    this.hudControls.setOrigin(0.5, 0);
    this.hudControls.setDepth(51);
    
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
    this.events.on('goldPickedUpByEnemy', this.onGoldPickedUpByEnemy, this);
    this.events.on('goldDropped', this.onGoldDropped, this);
    this.events.on('playerDied', this.onPlayerDied, this);
    this.events.on('enemyTrapped', this.onEnemyTrapped, this);
    this.events.on('digStart', this.onDigStart, this);
    this.events.on('holeDug', this.onHoleDug, this);
    
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
    // Reset flow flags
    this.playerHasMoved = false;
    this.levelCompleting = false;
    
    // Clear previous
    this.clearLevel();
    
    // Generate new level with seed + level number
    const seed = `${this.seedCode}-L${this.level}`;
    const generator = new LevelGenerator(seed, this.difficulty, this.level);
    this.tileMap = generator.generate();
    
    // Apply difficulty's hole duration multiplier
    const difficultySettings = DIFFICULTIES[this.difficulty];
    this.tileMap.holeDurationMultiplier = difficultySettings?.holeTime || 1.0;
    
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
    
    // Set up trapped enemy checker - player can walk over trapped enemies
    this.player.isTrappedEnemyAt = (x: number, y: number) => {
      return this.enemies.some(e => 
        e.gridX === x && e.gridY === y && e.isTrapped()
      );
    };
    
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
    
    // Set up enemy checker callbacks for all enemies
    for (const enemy of this.enemies) {
      // Check for trapped enemies (for walking over)
      enemy.isTrappedEnemyAt = (x: number, y: number, excludeSelf: Enemy) => {
        return this.enemies.some(e => 
          e !== excludeSelf && e.gridX === x && e.gridY === y && e.isTrapped()
        );
      };
      // Check for ANY enemy at position (for preventing stacking)
      enemy.isEnemyAt = (x: number, y: number, excludeSelf: Enemy) => {
        return this.enemies.some(e => 
          e !== excludeSelf && e.gridX === x && e.gridY === y
        );
      };
      // Check for trapped enemy in hole (for preventing multiple in same hole)
      enemy.isTrappedEnemyInHole = (x: number, y: number, excludeSelf: Enemy) => {
        return this.enemies.some(e => 
          e !== excludeSelf && e.gridX === x && e.gridY === y && e.isTrapped()
        );
      };
    }
    
    this.updateHUD();
    
    // Generate and play level music
    this.generateAndPlayMusic();
  }
  
  private generateAndPlayMusic(): void {
    const musicSeed = `${this.seedCode}-L${this.level}`;
    const generator = new MusicGenerator(musicSeed, this.level, this.difficulty);
    this.currentMusicTrack = generator.generate();
    
    const sound = getSoundManager();
    sound.playMusic(this.currentMusicTrack);
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
    // Handle return to menu (set by ESC handler)
    if (this.shouldReturnToMenu) {
      this.shouldReturnToMenu = false;
      this.returnToMenu();
      return;
    }
    
    // Reset ESC state after timeout
    if (this.escPressCount === 1 && Date.now() - this.escLastPressTime >= 2000) {
      this.escPressCount = 0;
    }
    
    // Handle system keys
    if (Phaser.Input.Keyboard.JustDown(this.keyPause)) {
      this.paused = !this.paused;
      if (this.paused) {
        getSoundManager().stopMusic();
        this.showMessage('PAUSED\n\nP to resume');
      } else {
        if (this.currentMusicTrack && getSoundManager().isMusicEnabled()) {
          getSoundManager().playMusic(this.currentMusicTrack);
        }
        this.showMessage('');
      }
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
    
    if (Phaser.Input.Keyboard.JustDown(this.keyMusic)) {
      const musicEnabled = getSoundManager().toggleMusic();
      this.showMessage(musicEnabled ? 'MUSIC ON' : 'MUSIC OFF', 1000);
      this.updateHUD();
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
    const prevX = this.player.gridX;
    const prevY = this.player.gridY;
    this.player.update(delta, input.cursors, input.digKeys, speedMult);
    
    // Track if player has made their first move (enemies wait until then)
    if (!this.playerHasMoved) {
      const hasMoved = this.player.gridX !== prevX || 
                       this.player.gridY !== prevY ||
                       this.player.state === PlayerState.WALKING ||
                       this.player.state === PlayerState.CLIMBING ||
                       this.player.state === PlayerState.DIGGING;
      if (hasMoved) {
        this.playerHasMoved = true;
      }
    }
    
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
    
    // Update enemies (only move if player has started moving)
    for (const enemy of this.enemies) {
      const prevEnemyState = enemy.state;
      enemy.update(delta, speedMult, this.playerHasMoved);
      
      // Check if enemy just got trapped
      if (prevEnemyState !== EnemyState.TRAPPED && enemy.state === EnemyState.TRAPPED) {
        this.events.emit('enemyTrapped', enemy);
      }
    }
    
    // Update holes (pass delta in ms and speed multiplier)
    const { filled, warning } = this.tileMap.updateHoles(delta, speedMult);
    for (const hole of filled) {
      this.updateTileSprite(hole.x, hole.y);
      getSoundManager().playHoleFill();
      
      // Check if player or enemy is trapped
      if (this.player.gridX === hole.x && this.player.gridY === hole.y) {
        this.player.die();
      }
      for (const enemy of this.enemies) {
        // Only kill enemy if they're still trapped in the hole (not climbing out)
        if (enemy.gridX === hole.x && enemy.gridY === hole.y && enemy.isTrapped()) {
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
        if (sprite && hole.timerMs > CONFIG.HOLE_WARNING_MS) {
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
  
  private onDigStart(data: { x: number; y: number; duration: number }): void {
    // Create drilling animation on the brick being dug
    const px = data.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const py = data.y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    
    // Create crack/drilling effect overlay
    const crackOverlay = this.add.graphics();
    crackOverlay.setDepth(15);
    
    // Animate the drilling with expanding cracks
    const duration = data.duration;
    let elapsed = 0;
    
    const updateCracks = () => {
      elapsed += 16; // ~60fps
      const progress = Math.min(elapsed / duration, 1);
      
      crackOverlay.clear();
      
      // Draw expanding cracks based on progress
      const crackColor = 0x000000;
      const sparkColor = 0xffff00;
      
      crackOverlay.lineStyle(2, crackColor, 0.8);
      
      // Center point of the brick
      const cx = px;
      const cy = py;
      const maxRadius = CONFIG.TILE_SIZE / 2;
      const currentRadius = maxRadius * progress;
      
      // Draw cracks radiating from center
      const numCracks = 6;
      for (let i = 0; i < numCracks; i++) {
        const angle = (i / numCracks) * Math.PI * 2 + progress * 0.5;
        const length = currentRadius * (0.6 + Math.random() * 0.4);
        crackOverlay.beginPath();
        crackOverlay.moveTo(cx, cy);
        crackOverlay.lineTo(
          cx + Math.cos(angle) * length,
          cy + Math.sin(angle) * length
        );
        crackOverlay.strokePath();
      }
      
      // Add debris particles flying out
      if (progress > 0.2) {
        crackOverlay.fillStyle(this.theme.brick, 0.8);
        const numDebris = Math.floor(progress * 8);
        for (let i = 0; i < numDebris; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = currentRadius * 0.5 + Math.random() * currentRadius * 0.5;
          const size = 2 + Math.random() * 2;
          crackOverlay.fillRect(
            cx + Math.cos(angle) * dist - size / 2,
            cy + Math.sin(angle) * dist - size / 2,
            size, size
          );
        }
      }
      
      // Add sparks
      if (Math.random() > 0.5) {
        crackOverlay.fillStyle(sparkColor, 0.9);
        const sparkAngle = Math.random() * Math.PI * 2;
        const sparkDist = currentRadius * 0.3 + Math.random() * currentRadius * 0.3;
        crackOverlay.fillRect(
          cx + Math.cos(sparkAngle) * sparkDist - 1,
          cy + Math.sin(sparkAngle) * sparkDist - 1,
          2, 2
        );
      }
      
      // Shake the brick slightly
      const tileSprite = this.tileSprites[data.y]?.[data.x];
      if (tileSprite && progress < 1) {
        const shake = (1 - progress) * 2;
        tileSprite.x = px + (Math.random() - 0.5) * shake;
        tileSprite.y = py + (Math.random() - 0.5) * shake;
      }
      
      if (progress < 1) {
        this.time.delayedCall(16, updateCracks);
      } else {
        // Reset brick position and destroy overlay
        const tileSprite = this.tileSprites[data.y]?.[data.x];
        if (tileSprite) {
          tileSprite.x = px;
          tileSprite.y = py;
        }
        crackOverlay.destroy();
      }
    };
    
    updateCracks();
  }
  
  private onHoleDug(data: { x: number; y: number }): void {
    // Update the tile sprite to show the hole
    this.updateTileSprite(data.x, data.y);
  }
  
  private onGoldCollected(data: { x: number; y: number }): void {
    this.score += 100;
    getSoundManager().playGold();
    this.updateTileSprite(data.x, data.y);
    
    // Remove gold sprite
    const goldKey = `${data.x},${data.y}`;
    const goldSprite = this.goldSprites.get(goldKey);
    if (goldSprite) {
      goldSprite.destroy();
      this.goldSprites.delete(goldKey);
    }
    
    // Check for floating gold above and make it fall
    this.checkFloatingGold(data.x, data.y - 1);
    
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
  
  /**
   * Check if there's floating gold at a position and make it fall
   */
  private checkFloatingGold(x: number, y: number): void {
    if (y < 0 || y >= this.tileMap.height) return;
    
    const tile = this.tileMap.getTile(x, y);
    if (tile !== TileType.GOLD) return;
    
    // Gold found - check if it's floating (no support below)
    const goldIdx = this.tileMap.goldPositions.findIndex(g => g.x === x && g.y === y);
    if (goldIdx === -1) return;
    
    // Find where the gold should fall to
    let newY = y;
    for (let checkY = y + 1; checkY < this.tileMap.height; checkY++) {
      const belowTile = this.tileMap.getTile(x, checkY);
      
      // Stop at solid ground, ladder, or another gold
      if (belowTile === TileType.BRICK || 
          belowTile === TileType.BRICK_HARD ||
          belowTile === TileType.BRICK_TRAP ||
          belowTile === TileType.LADDER ||
          belowTile === TileType.LADDER_EXIT ||
          belowTile === TileType.GOLD) {
        newY = checkY - 1;
        break;
      }
      
      // At bottom of map
      if (checkY === this.tileMap.height - 1) {
        newY = checkY;
        break;
      }
    }
    
    // If gold needs to fall
    if (newY !== y) {
      // Remove old gold
      this.tileMap.setTile(x, y, TileType.EMPTY);
      this.updateTileSprite(x, y);
      
      const oldKey = `${x},${y}`;
      const oldSprite = this.goldSprites.get(oldKey);
      if (oldSprite) {
        oldSprite.destroy();
        this.goldSprites.delete(oldKey);
      }
      
      // Update position in goldPositions
      this.tileMap.goldPositions[goldIdx] = { x, y: newY };
      
      // Add gold at new position
      this.tileMap.setTile(x, newY, TileType.GOLD);
      this.createGoldSprite(x, newY);
      
      // Recursively check above the old position
      this.checkFloatingGold(x, y - 1);
    }
  }
  
  private onGoldPickedUpByEnemy(data: { x: number; y: number }): void {
    // Remove gold sprite when enemy picks it up
    const goldKey = `${data.x},${data.y}`;
    const goldSprite = this.goldSprites.get(goldKey);
    if (goldSprite) {
      goldSprite.destroy();
      this.goldSprites.delete(goldKey);
    }
    this.updateHUD();
  }
  
  private onGoldDropped(data: { x: number; y: number }): void {
    // Create gold sprite when enemy drops gold
    this.createGoldSprite(data.x, data.y);
    this.updateHUD();
  }
  
  private checkWinCondition(): void {
    // Prevent multiple calls
    if (this.levelCompleting) return;
    
    // Player must be at top row on exit ladder
    if (this.player.gridY === 0) {
      const tile = this.tileMap.getTile(this.player.gridX, 0);
      if (tile === TileType.LADDER_EXIT || tile === TileType.LADDER) {
        this.levelCompleting = true;
        this.winLevel();
      }
    }
  }
  
  private winLevel(): void {
    const levelBonus = 500 + this.level * 100;
    this.score += levelBonus; // Level bonus increases with level
    
    // Gain a life every level (capped at starting lives + 5)
    const maxLives = (DIFFICULTIES[this.difficulty]?.lives || 5) + 5;
    const gainedLife = this.lives < maxLives;
    if (gainedLife) {
      this.lives++;
    }
    
    this.level++;
    getSoundManager().stopMusic();  // Stop level music for victory fanfare
    getSoundManager().playLevelComplete();
    
    const lifeMsg = gainedLife ? '\n+1 LIFE!' : '';
    this.showMessage(`LEVEL ${this.level - 1} COMPLETE!\n\n+${levelBonus} BONUS${lifeMsg}`, 2000);
    
    this.time.delayedCall(2000, () => {
      this.generateLevel();
    });
  }
  
  private onPlayerDied(): void {
    this.lives--;
    getSoundManager().playDeath();
    
    if (this.lives <= 0) {
      this.gameOver = true;
      getSoundManager().stopMusic();
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
  
  private returnToMenu(): void {
    // Prevent multiple calls
    if (this.shouldReturnToMenu) return;
    this.shouldReturnToMenu = true;
    
    // Clean up ESC listener
    if (this.escKeyHandler) {
      window.removeEventListener('keydown', this.escKeyHandler);
      this.escKeyHandler = null;
    }
    
    // Show returning message
    this.showMessage('Returning to menu...');
    
    // Page reload is the only reliable way to return to menu
    // Use replace to not add to browser history
    window.location.replace(window.location.pathname);
  }
  
  private updateHUD(): void {
    const speed = CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
    const diffName = DIFFICULTIES[this.difficulty]?.name || 'NORMAL';
    const goldRemaining = this.tileMap?.goldPositions?.length ?? 0;
    const sound = getSoundManager();
    const musicIcon = sound.isMusicEnabled() ? '♪' : '♪̶';  // Music note (struck through if off)
    
    this.hudText.setText(
      `SCORE: ${this.score.toString().padStart(6, '0')}  ` +
      `LIVES: ${this.lives}  ` +
      `LEVEL: ${this.level}  ` +
      `GOLD: ${goldRemaining}  ` +
      `SPD: ${speed}x  ` +
      `${musicIcon}  ` +
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
    // Stop music when leaving the scene
    getSoundManager().stopMusic();
    this.crtEffect?.destroy();
    this.touchControls?.destroy();
  }
}
