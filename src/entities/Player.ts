import Phaser from 'phaser';
import { CONFIG, TileType } from '../config';
import { TileMap } from '../level/TileMap';

export enum PlayerState {
  IDLE,
  WALKING,
  CLIMBING,
  HANGING, // On bar
  FALLING,
  DIGGING,
  DEAD
}

export class Player {
  public sprite: Phaser.GameObjects.Rectangle;
  public gridX: number;
  public gridY: number;
  public state: PlayerState = PlayerState.IDLE;
  public facing: 'left' | 'right' = 'right';
  
  private scene: Phaser.Scene;
  private tileMap: TileMap;
  private moveProgress: number = 0;
  private targetX: number;
  private targetY: number;
  private digTimer: number = 0;
  private digX: number = 0;
  private digY: number = 0;
  
  constructor(scene: Phaser.Scene, tileMap: TileMap, gridX: number, gridY: number, color: number) {
    this.scene = scene;
    this.tileMap = tileMap;
    this.gridX = gridX;
    this.gridY = gridY;
    this.targetX = gridX;
    this.targetY = gridY;
    
    // Create player sprite (rectangle for now)
    this.sprite = scene.add.rectangle(
      gridX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
      gridY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
      CONFIG.TILE_SIZE - 4,
      CONFIG.TILE_SIZE - 2,
      color
    );
    this.sprite.setDepth(10);
  }
  
  update(delta: number, cursors: Phaser.Types.Input.Keyboard.CursorKeys, digKeys: { left: Phaser.Input.Keyboard.Key, right: Phaser.Input.Keyboard.Key }, speedMultiplier: number): void {
    if (this.state === PlayerState.DEAD) return;
    
    const moveSpeed = CONFIG.BASE_SPEED * speedMultiplier;
    const dt = delta / 1000;
    
    // Handle digging
    if (this.state === PlayerState.DIGGING) {
      this.digTimer -= delta;
      if (this.digTimer <= 0) {
        // Complete the dig
        this.tileMap.digHole(this.digX, this.digY);
        this.state = PlayerState.IDLE;
      }
      return;
    }
    
    // Check for falling
    if (this.shouldFall()) {
      this.state = PlayerState.FALLING;
    }
    
    // Handle falling
    if (this.state === PlayerState.FALLING) {
      this.moveProgress += CONFIG.FALL_SPEED * speedMultiplier * dt / CONFIG.TILE_SIZE;
      if (this.moveProgress >= 1) {
        this.moveProgress = 0;
        this.gridY = this.targetY;
        this.targetY++;
        
        // Check if we've landed
        if (!this.shouldFall()) {
          this.state = PlayerState.IDLE;
          this.targetY = this.gridY;
        }
      }
      this.updateSpritePosition();
      return;
    }
    
    // Handle movement input
    if (this.moveProgress === 0) {
      // Check dig inputs first
      if (Phaser.Input.Keyboard.JustDown(digKeys.left)) {
        this.tryDig(-1);
      } else if (Phaser.Input.Keyboard.JustDown(digKeys.right)) {
        this.tryDig(1);
      }
      // Movement
      else if (cursors.left.isDown) {
        this.tryMove(-1, 0);
      } else if (cursors.right.isDown) {
        this.tryMove(1, 0);
      } else if (cursors.up.isDown) {
        this.tryMove(0, -1);
      } else if (cursors.down.isDown) {
        this.tryMove(0, 1);
      }
    }
    
    // Continue movement in progress
    if (this.moveProgress > 0) {
      this.moveProgress += moveSpeed * dt / CONFIG.TILE_SIZE;
      
      if (this.moveProgress >= 1) {
        this.moveProgress = 0;
        this.gridX = this.targetX;
        this.gridY = this.targetY;
        this.state = PlayerState.IDLE;
        
        // Check for gold collection
        this.checkGoldCollection();
      }
    }
    
    this.updateSpritePosition();
  }
  
  private shouldFall(): boolean {
    // Don't fall if on ladder
    if (this.tileMap.isClimbable(this.gridX, this.gridY)) return false;
    // Don't fall if on bar
    if (this.tileMap.isBar(this.gridX, this.gridY)) return false;
    // Don't fall if there's support below
    if (this.gridY + 1 >= this.tileMap.height) return false;
    if (this.tileMap.isSupport(this.gridX, this.gridY + 1)) return false;
    
    return true;
  }
  
  private tryMove(dx: number, dy: number): boolean {
    const newX = this.gridX + dx;
    const newY = this.gridY + dy;
    
    // Bounds check
    if (newX < 0 || newX >= this.tileMap.width) return false;
    if (newY < 0 || newY >= this.tileMap.height) return false;
    
    const targetTile = this.tileMap.getTile(newX, newY);
    const currentTile = this.tileMap.getTile(this.gridX, this.gridY);
    
    // Can't move into solid blocks
    if (this.tileMap.isSolid(newX, newY)) return false;
    
    // Vertical movement rules
    if (dy !== 0) {
      // Can only go up if on ladder
      if (dy < 0) {
        if (!this.tileMap.isClimbable(this.gridX, this.gridY) && 
            !this.tileMap.isClimbable(newX, newY)) {
          return false;
        }
      }
      // Can only go down if ladder below or on ladder
      if (dy > 0) {
        if (!this.tileMap.isClimbable(this.gridX, this.gridY) && 
            !this.tileMap.isClimbable(newX, newY) &&
            targetTile !== TileType.HOLE) {
          return false;
        }
      }
      this.state = PlayerState.CLIMBING;
    }
    
    // Horizontal movement rules
    if (dx !== 0) {
      this.facing = dx < 0 ? 'left' : 'right';
      
      // Need support to walk, unless on ladder or bar
      const onLadder = this.tileMap.isClimbable(this.gridX, this.gridY);
      const onBar = this.tileMap.isBar(this.gridX, this.gridY);
      const hasSupport = this.tileMap.isSupport(this.gridX, this.gridY + 1);
      
      if (!onLadder && !onBar && !hasSupport) return false;
      
      // Check if target has bar (will hang)
      if (this.tileMap.isBar(newX, newY)) {
        this.state = PlayerState.HANGING;
      } else {
        this.state = PlayerState.WALKING;
      }
    }
    
    // Start movement
    this.targetX = newX;
    this.targetY = newY;
    this.moveProgress = 0.01; // Start moving
    
    return true;
  }
  
  private tryDig(direction: number): boolean {
    // Can only dig if we have support
    const onLadder = this.tileMap.isClimbable(this.gridX, this.gridY);
    const hasSupport = this.tileMap.isSupport(this.gridX, this.gridY + 1);
    
    if (!onLadder && !hasSupport) return false;
    
    // Target position for digging (one tile down and to the side)
    const digX = this.gridX + direction;
    const digY = this.gridY + 1;
    
    // Check if we can dig there
    if (!this.tileMap.canDig(digX, digY)) return false;
    
    // Start digging
    this.facing = direction < 0 ? 'left' : 'right';
    this.state = PlayerState.DIGGING;
    this.digTimer = CONFIG.DIG_DURATION * (1000 / 60); // Convert frames to ms
    this.digX = digX;
    this.digY = digY;
    
    return true;
  }
  
  private checkGoldCollection(): void {
    const tile = this.tileMap.getTile(this.gridX, this.gridY);
    if (tile === TileType.GOLD) {
      this.tileMap.setTile(this.gridX, this.gridY, TileType.EMPTY);
      // Remove from gold positions
      const idx = this.tileMap.goldPositions.findIndex(
        g => g.x === this.gridX && g.y === this.gridY
      );
      if (idx !== -1) {
        this.tileMap.goldPositions.splice(idx, 1);
      }
      // Emit event for score
      this.scene.events.emit('goldCollected', { x: this.gridX, y: this.gridY });
    }
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
    
    this.sprite.x = visualX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
    this.sprite.y = visualY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
  }
  
  die(): void {
    this.state = PlayerState.DEAD;
    this.scene.events.emit('playerDied');
  }
  
  setColor(color: number): void {
    this.sprite.setFillStyle(color);
  }
  
  reset(gridX: number, gridY: number): void {
    this.gridX = gridX;
    this.gridY = gridY;
    this.targetX = gridX;
    this.targetY = gridY;
    this.moveProgress = 0;
    this.state = PlayerState.IDLE;
    this.updateSpritePosition();
  }
}
