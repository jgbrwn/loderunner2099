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
  
  // Callback to check if there's another trapped enemy at a position (for walking over)
  public isTrappedEnemyAt: (x: number, y: number, excludeSelf: Enemy) => boolean = () => false;
  
  // Callback to check if there's ANY enemy at a position (for preventing multiple enemies in same hole)
  public isEnemyAt: (x: number, y: number, excludeSelf: Enemy) => boolean = () => false;
  
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
  
  update(delta: number, gameSpeedMultiplier: number, playerHasMoved: boolean = true): void {
    if (this.state === EnemyState.DEAD) return;
    
    const speedMult = gameSpeedMultiplier * this.speedMultiplier;
    const moveSpeed = CONFIG.BASE_SPEED * speedMult * 0.85; // Enemies slightly slower
    const dt = delta / 1000;
    
    // Don't move until player makes first move (except for falling/trapped states)
    const canAct = playerHasMoved || 
                   this.state === EnemyState.FALLING || 
                   this.state === EnemyState.TRAPPED ||
                   this.state === EnemyState.CLIMBING_OUT ||
                   this.state === EnemyState.RESPAWNING;
    
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
      // Apply speed multiplier to trapped timer (faster game = escape faster)
      this.trappedTimer -= delta * speedMult;
      
      // Use millisecond constants directly
      const escapeThresholdMs = CONFIG.ENEMY_ESCAPE_MS || 300;
      const shakeThresholdMs = CONFIG.ENEMY_SHAKE_MS || 600;
      
      // Shake effect when close to escaping
      if (this.trappedTimer < shakeThresholdMs && this.trappedTimer > 0) {
        const shakeAmount = 2 * Math.sin(Date.now() / 30);
        this.sprite.x += shakeAmount;
      }
      
      // Enemy escapes before hole fills (like C64)
      if (this.trappedTimer <= escapeThresholdMs) {
        this.state = EnemyState.CLIMBING_OUT;
        this.moveProgress = 0;
      }
      
      this.updateSpritePosition();
      return;
    }
    
    // Check if we fell into a hole
    const currentTile = this.tileMap.getTile(this.gridX, this.gridY);
    if (currentTile === TileType.HOLE && this.state !== EnemyState.FALLING) {
      this.state = EnemyState.TRAPPED;
      // Enemy trapped time is LESS than hole duration so they can escape
      // if they fell in early enough
      this.trappedTimer = CONFIG.ENEMY_IN_HOLE_MS || 2800;
      
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
    
    // Don't chase until player has moved
    if (!canAct) {
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
    // Don't fall if there's another trapped enemy below (can walk over them)
    if (this.isTrappedEnemyAt(this.gridX, this.gridY + 1, this)) return false;
    // Can fall through holes, but not if another enemy is already there
    if (this.tileMap.getTile(this.gridX, this.gridY + 1) === TileType.HOLE) {
      // Don't fall into hole if another enemy is already in it
      if (this.isEnemyAt(this.gridX, this.gridY + 1, this)) return false;
      return true;
    }
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
      const hasSupport = this.tileMap.isSupport(this.gridX, this.gridY + 1) ||
                         this.isTrappedEnemyAt(this.gridX, this.gridY + 1, this);
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
      // Remove from gold positions (will be re-added when dropped or enemy killed)
      const idx = this.tileMap.goldPositions.findIndex(
        g => g.x === this.gridX && g.y === this.gridY
      );
      if (idx !== -1) {
        this.tileMap.goldPositions.splice(idx, 1);
      }
      // Emit event to remove gold sprite
      this.scene.events.emit('goldPickedUpByEnemy', { x: this.gridX, y: this.gridY });
    }
  }
  
  private dropGold(): void {
    if (!this.hasGold) return;
    
    this.hasGold = false;
    
    // Find a valid position to drop gold
    // Valid = empty/pole/ladder, has support below (floor or ladder), no existing gold
    let dropX = this.gridX;
    let dropY = this.gridY;
    
    const isValidForGold = (x: number, y: number): boolean => {
      if (x < 0 || x >= this.tileMap.width || y < 0 || y >= this.tileMap.height) {
        return false;
      }
      
      const tile = this.tileMap.getTile(x, y);
      
      // Must be empty, pole, or ladder
      const isSafeTile = tile === TileType.EMPTY || 
                         tile === TileType.POLE || 
                         tile === TileType.LADDER || 
                         tile === TileType.LADDER_EXIT;
      if (!isSafeTile) return false;
      
      // Check no existing gold at this position
      const hasGold = this.tileMap.goldPositions.some(g => g.x === x && g.y === y);
      if (hasGold) return false;
      
      // Must have support below (unless on ladder or at bottom)
      if (y >= this.tileMap.height - 1) return true; // Bottom row
      if (tile === TileType.LADDER || tile === TileType.LADDER_EXIT) return true;
      
      const below = this.tileMap.getTile(x, y + 1);
      const hasSupport = below === TileType.BRICK || 
                         below === TileType.BRICK_HARD || 
                         below === TileType.LADDER || 
                         below === TileType.LADDER_EXIT ||
                         below === TileType.BRICK_TRAP;
      return hasSupport;
    };
    
    // First, try to find a valid position by falling down from current position
    let foundValid = false;
    
    // Start from current position and fall until we hit support
    let fallX = this.gridX;
    let fallY = this.gridY;
    while (fallY < this.tileMap.height) {
      if (isValidForGold(fallX, fallY)) {
        dropX = fallX;
        dropY = fallY;
        foundValid = true;
        break;
      }
      fallY++;
    }
    
    // If falling didn't work, search nearby valid positions
    if (!foundValid) {
      const candidates = [
        { x: this.gridX - 1, y: this.gridY },
        { x: this.gridX + 1, y: this.gridY },
        { x: this.gridX, y: this.gridY - 1 },
        { x: this.gridX - 1, y: this.gridY - 1 },
        { x: this.gridX + 1, y: this.gridY - 1 },
      ];
      
      for (const pos of candidates) {
        // For each candidate, also try falling from there
        let testY = pos.y;
        while (testY < this.tileMap.height) {
          if (isValidForGold(pos.x, testY)) {
            dropX = pos.x;
            dropY = testY;
            foundValid = true;
            break;
          }
          testY++;
        }
        if (foundValid) break;
      }
    }
    
    // If still not found, do an expanding radius search
    if (!foundValid) {
      for (let radius = 1; radius < Math.max(this.tileMap.width, this.tileMap.height) && !foundValid; radius++) {
        for (let dy = -radius; dy <= radius && !foundValid; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = this.gridX + dx;
            const ny = this.gridY + dy;
            if (isValidForGold(nx, ny)) {
              dropX = nx;
              dropY = ny;
              foundValid = true;
              break;
            }
          }
        }
      }
    }
    
    if (!foundValid) {
      console.error('CRITICAL: Could not find ANY valid spot for gold!');
      // Last resort: just place it at original position
      dropX = this.gridX;
      dropY = this.gridY;
    }
    
    // Drop gold at the valid position
    this.tileMap.setTile(dropX, dropY, TileType.GOLD);
    this.tileMap.goldPositions.push({ x: dropX, y: dropY });
    // Emit event to create gold sprite
    this.scene.events.emit('goldDropped', { x: dropX, y: dropY });
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
    this.trappedTimer = CONFIG.ENEMY_IN_HOLE_MS || 2800;
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
    // Respawn at top of level - find a valid spawn position
    // Try to find an empty spot on a ladder or on top of a platform near the top
    
    let bestX = Math.floor(this.tileMap.width / 2);
    let bestY = 0;
    let foundValid = false;
    
    // First priority: find a ladder near the top
    for (let y = 0; y < 5 && !foundValid; y++) {
      for (let x = 0; x < this.tileMap.width; x++) {
        const tile = this.tileMap.getTile(x, y);
        if (tile === TileType.LADDER || tile === TileType.LADDER_EXIT) {
          bestX = x;
          bestY = y;
          foundValid = true;
          break;
        }
      }
    }
    
    // Second priority: any empty space near top
    if (!foundValid) {
      for (let y = 0; y < this.tileMap.height && !foundValid; y++) {
        for (let x = 0; x < this.tileMap.width; x++) {
          const tile = this.tileMap.getTile(x, y);
          if (tile === TileType.EMPTY || tile === TileType.POLE) {
            bestX = x;
            bestY = y;
            foundValid = true;
            break;
          }
        }
      }
    }
    
    // Randomize horizontally among valid top-row positions
    const validTopPositions: number[] = [];
    for (let x = 0; x < this.tileMap.width; x++) {
      const tile = this.tileMap.getTile(x, bestY);
      if (!this.tileMap.isSolid(x, bestY)) {
        validTopPositions.push(x);
      }
    }
    
    if (validTopPositions.length > 0) {
      bestX = validTopPositions[Math.floor(Math.random() * validTopPositions.length)];
    }
    
    this.gridX = bestX;
    this.gridY = bestY;
    this.targetX = bestX;
    this.targetY = bestY;
    
    this.state = EnemyState.IDLE;
    this.moveProgress = 0;
    this.hasGold = false; // Make sure we don't have gold after respawn
    this.sprite.setAlpha(1);
    this.updateSpritePosition();
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
