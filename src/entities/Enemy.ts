import Phaser from 'phaser';
import { CONFIG, TileType } from '../config';
import { TileMap } from '../level/TileMap';
import { Player } from './Player';

type SpriteOrRect = Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;

export enum EnemyState {
  IDLE,
  CHASING,
  FALLING,
  TRAPPED,
  CLIMBING_OUT,
  DEAD,
  RESPAWNING
}

export class Enemy {
  public sprite: SpriteOrRect;
  public gridX: number;
  public gridY: number;
  public state: EnemyState = EnemyState.IDLE;
  public hasGold: boolean = false;
  
  /** Check if enemy is currently trapped in a hole */
  public isTrapped(): boolean {
    return this.state === EnemyState.TRAPPED;
  }
  
  private scene: Phaser.Scene;
  private tileMap: TileMap;
  private player: Player;
  private moveProgress: number = 0;
  private targetX: number;
  private targetY: number;
  private trappedTimer: number = 0;
  private respawnTimer: number = 0;
  private startX: number;
  private startY: number;
  private moveDelay: number = 0;
  private speedMultiplier: number = 1;
  private animTimer: number = 0;
  private animFrame: number = 0;
  
  constructor(
    scene: Phaser.Scene, 
    tileMap: TileMap, 
    player: Player,
    gridX: number, 
    gridY: number, 
    color: number,
    speedMultiplier: number = 1
  ) {
    this.scene = scene;
    this.tileMap = tileMap;
    this.player = player;
    this.gridX = gridX;
    this.gridY = gridY;
    this.targetX = gridX;
    this.targetY = gridY;
    this.startX = gridX;
    this.startY = gridY;
    this.speedMultiplier = speedMultiplier;
    
    const px = gridX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    const py = gridY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    
    // Try to use texture, fall back to rectangle
    if (scene.textures.exists('enemy')) {
      this.sprite = scene.add.sprite(px, py, 'enemy');
    } else {
      this.sprite = scene.add.rectangle(px, py, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 2, color);
    }
    this.sprite.setDepth(9);
  }
  
  update(delta: number, gameSpeedMultiplier: number): void {
    if (this.state === EnemyState.DEAD) return;
    
    const speedMult = gameSpeedMultiplier * this.speedMultiplier;
    const moveSpeed = CONFIG.BASE_SPEED * speedMult * 0.85; // Enemies slightly slower
    const dt = delta / 1000;
    
    // Handle respawning
    if (this.state === EnemyState.RESPAWNING) {
      this.respawnTimer -= delta;
      this.sprite.setAlpha(0.3 + 0.2 * Math.sin(Date.now() / 100));
      if (this.respawnTimer <= 0) {
        this.respawn();
      }
      return;
    }
    
    // Handle trapped state
    if (this.state === EnemyState.TRAPPED) {
      this.trappedTimer -= delta;
      if (this.trappedTimer <= 0) {
        // Try to climb out
        this.state = EnemyState.CLIMBING_OUT;
      }
      this.updateSpritePosition();
      return;
    }
    
    // Check if we fell into a hole
    const currentTile = this.tileMap.getTile(this.gridX, this.gridY);
    if (currentTile === TileType.HOLE && this.state !== EnemyState.FALLING) {
      this.state = EnemyState.TRAPPED;
      this.trappedTimer = CONFIG.HOLE_DURATION * (1000 / 60) * 0.7; // Slightly less than hole duration
      
      // Drop gold if carrying
      if (this.hasGold) {
        this.dropGold();
      }
      return;
    }
    
    // Handle climbing out
    if (this.state === EnemyState.CLIMBING_OUT) {
      this.moveProgress += moveSpeed * 0.5 * dt / CONFIG.TILE_SIZE;
      if (this.moveProgress >= 1) {
        this.gridY--;
        this.targetY = this.gridY;
        this.moveProgress = 0;
        this.state = EnemyState.IDLE;
      }
      this.updateSpritePosition();
      return;
    }
    
    // Check for falling
    if (this.shouldFall()) {
      this.state = EnemyState.FALLING;
    }
    
    // Handle falling
    if (this.state === EnemyState.FALLING) {
      this.moveProgress += CONFIG.FALL_SPEED * speedMult * dt / CONFIG.TILE_SIZE;
      if (this.moveProgress >= 1) {
        this.moveProgress = 0;
        this.gridY = this.targetY;
        this.targetY++;
        
        if (!this.shouldFall()) {
          this.state = EnemyState.IDLE;
          this.targetY = this.gridY;
        }
      }
      this.updateSpritePosition();
      return;
    }
    
    // Chase player (with delay)
    this.moveDelay -= delta;
    if (this.moveDelay <= 0 && this.moveProgress === 0) {
      this.moveDelay = 100 / speedMult; // Move every ~100ms
      this.chooseMove();
    }
    
    // Continue movement
    if (this.moveProgress > 0) {
      this.moveProgress += moveSpeed * dt / CONFIG.TILE_SIZE;
      
      if (this.moveProgress >= 1) {
        this.moveProgress = 0;
        this.gridX = this.targetX;
        this.gridY = this.targetY;
        this.state = EnemyState.IDLE;
        
        // Check for gold pickup (only if not carrying)
        this.checkGoldPickup();
      }
    }
    
    // Check collision with player
    this.checkPlayerCollision();
    
    this.updateSpritePosition();
    this.updateAnimation(delta);
  }
  
  private shouldFall(): boolean {
    if (this.tileMap.isClimbable(this.gridX, this.gridY)) return false;
    if (this.tileMap.isBar(this.gridX, this.gridY)) return false;
    if (this.gridY + 1 >= this.tileMap.height) return false;
    if (this.tileMap.isSupport(this.gridX, this.gridY + 1)) return false;
    // Can fall through holes
    if (this.tileMap.getTile(this.gridX, this.gridY + 1) === TileType.HOLE) return true;
    return true;
  }
  
  private chooseMove(): void {
    // Simple AI: Move towards player
    const dx = this.player.gridX - this.gridX;
    const dy = this.player.gridY - this.gridY;
    
    // Priority: Try to get on same level first, then chase horizontally
    const moves: { dx: number; dy: number; score: number }[] = [];
    
    // Try all four directions
    const directions = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 }
    ];
    
    for (const dir of directions) {
      if (this.canMove(dir.dx, dir.dy)) {
        // Score based on how much this move reduces distance to player
        let score = 0;
        if (dir.dx !== 0 && Math.sign(dir.dx) === Math.sign(dx)) {
          score += 10 - Math.abs(dx);
        }
        if (dir.dy !== 0 && Math.sign(dir.dy) === Math.sign(dy)) {
          score += 10 - Math.abs(dy);
        }
        // Prefer horizontal movement
        if (dir.dy === 0) score += 2;
        
        moves.push({ ...dir, score });
      }
    }
    
    if (moves.length > 0) {
      // Sort by score (descending) and pick best move
      moves.sort((a, b) => b.score - a.score);
      
      // Add some randomness - 20% chance to pick non-optimal move
      const move = Math.random() < 0.2 && moves.length > 1 ? 
        moves[Math.floor(Math.random() * moves.length)] : moves[0];
      
      this.targetX = this.gridX + move.dx;
      this.targetY = this.gridY + move.dy;
      this.moveProgress = 0.01;
      this.state = EnemyState.CHASING;
    }
  }
  
  private canMove(dx: number, dy: number): boolean {
    const newX = this.gridX + dx;
    const newY = this.gridY + dy;
    
    if (newX < 0 || newX >= this.tileMap.width) return false;
    if (newY < 0 || newY >= this.tileMap.height) return false;
    
    // Can't move into solid
    if (this.tileMap.isSolid(newX, newY)) return false;
    
    // Vertical movement
    if (dy < 0) {
      // Up - need ladder
      if (!this.tileMap.isClimbable(this.gridX, this.gridY) &&
          !this.tileMap.isClimbable(newX, newY)) {
        return false;
      }
    }
    if (dy > 0) {
      // Down - need ladder or falling
      const targetTile = this.tileMap.getTile(newX, newY);
      if (!this.tileMap.isClimbable(this.gridX, this.gridY) &&
          !this.tileMap.isClimbable(newX, newY) &&
          targetTile !== TileType.HOLE &&
          targetTile !== TileType.EMPTY) {
        return false;
      }
    }
    
    // Horizontal movement
    if (dx !== 0) {
      const onLadder = this.tileMap.isClimbable(this.gridX, this.gridY);
      const onBar = this.tileMap.isBar(this.gridX, this.gridY);
      const hasSupport = this.tileMap.isSupport(this.gridX, this.gridY + 1);
      if (!onLadder && !onBar && !hasSupport) return false;
    }
    
    return true;
  }
  
  private checkGoldPickup(): void {
    if (this.hasGold) return;
    
    const tile = this.tileMap.getTile(this.gridX, this.gridY);
    if (tile === TileType.GOLD) {
      this.hasGold = true;
      this.tileMap.setTile(this.gridX, this.gridY, TileType.EMPTY);
    }
  }
  
  private dropGold(): void {
    if (!this.hasGold) return;
    
    this.hasGold = false;
    // Drop gold at current position
    this.tileMap.setTile(this.gridX, this.gridY, TileType.GOLD);
    this.tileMap.goldPositions.push({ x: this.gridX, y: this.gridY });
  }
  
  private checkPlayerCollision(): void {
    if (this.state === EnemyState.TRAPPED || this.state === EnemyState.RESPAWNING) return;
    
    // Check if overlapping with player
    const dist = Math.abs(this.gridX - this.player.gridX) + Math.abs(this.gridY - this.player.gridY);
    if (dist === 0) {
      this.player.die();
    }
    
    // Also check if moving through each other
    if (this.moveProgress > 0.3 && this.moveProgress < 0.7) {
      if (this.targetX === this.player.gridX && this.targetY === this.player.gridY) {
        this.player.die();
      }
    }
  }
  
  trapInHole(): void {
    this.state = EnemyState.TRAPPED;
    this.trappedTimer = CONFIG.HOLE_DURATION * (1000 / 60) * 0.7;
    if (this.hasGold) {
      this.dropGold();
    }
  }
  
  kill(): void {
    this.state = EnemyState.RESPAWNING;
    this.respawnTimer = CONFIG.ENEMY_SPAWN_DELAY * (1000 / 60);
    this.sprite.setAlpha(0.3);
    if (this.hasGold) {
      this.dropGold();
    }
  }
  
  private respawn(): void {
    // Respawn at top of level
    this.gridY = 0;
    this.targetY = 0;
    this.gridX = Math.floor(Math.random() * this.tileMap.width);
    this.targetX = this.gridX;
    
    // Find valid spawn column
    for (let attempts = 0; attempts < 10; attempts++) {
      const tile = this.tileMap.getTile(this.gridX, 0);
      if (!this.tileMap.isSolid(this.gridX, 0)) break;
      this.gridX = (this.gridX + 1) % this.tileMap.width;
      this.targetX = this.gridX;
    }
    
    this.state = EnemyState.IDLE;
    this.moveProgress = 0;
    this.sprite.setAlpha(1);
  }
  
  private updateSpritePosition(): void {
    let visualX = this.gridX;
    let visualY = this.gridY;
    
    if (this.moveProgress > 0) {
      const dx = this.targetX - this.gridX;
      const dy = this.targetY - this.gridY;
      visualX += dx * this.moveProgress;
      visualY += dy * this.moveProgress;
    }
    
    // Climbing out animation
    if (this.state === EnemyState.CLIMBING_OUT) {
      visualY = this.gridY - this.moveProgress;
    }
    
    this.sprite.x = visualX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    this.sprite.y = visualY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
  }
  
  setColor(color: number): void {
    if (this.sprite instanceof Phaser.GameObjects.Rectangle) {
      this.sprite.setFillStyle(color);
    }
  }
  
  recreateSprite(color: number): void {
    const px = this.sprite.x;
    const py = this.sprite.y;
    const depth = this.sprite.depth;
    const alpha = this.sprite.alpha;
    this.sprite.destroy();
    
    // Create new sprite with updated textures
    if (this.scene.textures.exists('enemy')) {
      this.sprite = this.scene.add.sprite(px, py, 'enemy');
    } else {
      this.sprite = this.scene.add.rectangle(px, py, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 2, color);
    }
    this.sprite.setDepth(depth);
    this.sprite.setAlpha(alpha);
  }
  
  updateAnimation(delta: number): void {
    if (!(this.sprite instanceof Phaser.GameObjects.Sprite)) return;
    
    this.animTimer += delta;
    const animSpeed = 180; // ms per frame (slightly slower than player)
    
    if (this.animTimer >= animSpeed) {
      this.animTimer = 0;
      this.animFrame = (this.animFrame + 1) % 2;
    }
    
    let frame = 'idle';
    
    switch (this.state) {
      case EnemyState.CHASING:
        frame = this.animFrame === 0 ? 'walk1' : 'walk2';
        break;
      case EnemyState.FALLING:
        frame = this.animFrame === 0 ? 'walk1' : 'walk2';
        break;
      case EnemyState.TRAPPED:
        frame = 'trapped';
        break;
      case EnemyState.CLIMBING_OUT:
        frame = this.animFrame === 0 ? 'climb1' : 'climb2';
        break;
    }
    
    // Apply frame if texture exists
    const textureKey = `enemy_${frame}`;
    if (this.scene.textures.exists(textureKey)) {
      (this.sprite as Phaser.GameObjects.Sprite).setTexture(textureKey);
    }
    
    // Face toward player
    const facingLeft = this.player.gridX < this.gridX;
    this.sprite.setFlipX(facingLeft);
  }
  
  reset(): void {
    this.gridX = this.startX;
    this.gridY = this.startY;
    this.targetX = this.startX;
    this.targetY = this.startY;
    this.moveProgress = 0;
    this.state = EnemyState.IDLE;
    this.hasGold = false;
    this.sprite.setAlpha(1);
    this.updateSpritePosition();
  }
}
