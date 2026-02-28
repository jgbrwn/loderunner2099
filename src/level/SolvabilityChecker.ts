import { TileType } from '../config';
import { TileMap } from './TileMap';

interface Position {
  x: number;
  y: number;
}

export interface SolvabilityResult {
  solvable: boolean;
  score: number;
  debug: string;
  directGold: number;
  enemyAssistedGold: number;
  unreachableGold: number;
  enemyAssistedPositions: Position[];  // For visual hints
}

export class SolvabilityChecker {
  // Set of exit ladder positions (treated as climbable during solvability check)
  private exitLadderPositions: Set<string> = new Set();
  
  // Whether to include exit ladders in reachability (used for exit check only)
  private includeExitLadders: boolean = false;
  
  // Difficulty key for determining enemy-assisted gold limits
  private difficultyKey: string = 'normal';
  
  /**
   * Set the difficulty for enemy-assisted gold limits
   */
  setDifficulty(key: string): void {
    this.difficultyKey = key;
  }
  
  /**
   * Get max allowed enemy-assisted gold for current difficulty
   */
  private getMaxEnemyAssistedGold(): number {
    switch (this.difficultyKey) {
      case 'easy':
      case 'normal':
        return 0;  // Strict: all gold must be player-reachable
      case 'hard':
        return 1;  // Allow max 1 enemy-assisted gold
      case 'ninja':
        return 2;  // Allow max 1-2 enemy-assisted gold
      default:
        return 0;
    }
  }
  
  /**
   * Check if a level is solvable and return detailed info.
   */
  checkSolvability(map: TileMap): SolvabilityResult {
    // Build set of exit ladder positions for quick lookup
    this.exitLadderPositions = new Set(map.exitLadders.map(e => `${e.x},${e.y}`));
    
    // Quick checks
    if (map.goldPositions.length === 0) {
      return { 
        solvable: false, 
        score: 0, 
        debug: 'no gold',
        directGold: 0,
        enemyAssistedGold: 0,
        unreachableGold: 0,
        enemyAssistedPositions: []
      };
    }
    if (map.exitLadders.length === 0) {
      return { 
        solvable: false, 
        score: 0, 
        debug: 'no exit ladders',
        directGold: 0,
        enemyAssistedGold: 0,
        unreachableGold: 0,
        enemyAssistedPositions: []
      };
    }
    
    // Build reachability from player start WITHOUT exit ladders
    // (exit ladders only appear after all gold is collected)
    this.includeExitLadders = false;
    const playerReachable = this.findAllReachable(map, map.playerStart);
    
    // Compute enemy spawn positions and enemy-reachable areas
    const enemySpawnPositions = this.computeEnemySpawnPositions(map);
    const enemyReachable = this.computeEnemyReachablePositions(map, enemySpawnPositions);
    
    // Categorize gold
    let directGold = 0;
    let enemyAssistedGold = 0;
    let unreachableGold = 0;
    const enemyAssistedPositions: Position[] = [];
    
    for (const gold of map.goldPositions) {
      const key = `${gold.x},${gold.y}`;
      if (playerReachable.has(key)) {
        directGold++;
      } else if (enemyReachable.has(key) && 
                 this.canEnemyDeliverGold(map, gold, playerReachable, enemyReachable)) {
        enemyAssistedGold++;
        enemyAssistedPositions.push({ x: gold.x, y: gold.y });
      } else {
        unreachableGold++;
      }
    }
    
    // Now build reachability WITH exit ladders (for checking if exit is reachable)
    this.includeExitLadders = true;
    const reachableWithExit = this.findAllReachable(map, map.playerStart);
    
    // Check exit reachability - need to reach row 0 on an exit ladder column
    let exitReachable = false;
    const exitColumns = new Set(map.exitLadders.map(e => e.x));
    
    for (const col of exitColumns) {
      // Check if row 0 of this column is reachable (with exit ladders enabled)
      const key = `${col},0`;
      if (reachableWithExit.has(key)) {
        exitReachable = true;
        break;
      }
      // Or check if any exit ladder tile in this column is reachable
      for (const exit of map.exitLadders.filter(e => e.x === col)) {
        const exitKey = `${exit.x},${exit.y}`;
        if (reachableWithExit.has(exitKey)) {
          exitReachable = true;
          break;
        }
      }
    }
    
    const totalGold = map.goldPositions.length;
    const collectableGold = directGold + enemyAssistedGold;
    const goldScore = collectableGold / totalGold;
    const exitScore = exitReachable ? 1 : 0;
    // Score must require BOTH components - multiply instead of average
    const score = goldScore * exitScore;
    
    // Check if level is solvable based on difficulty limits
    const maxEnemyAssisted = this.getMaxEnemyAssistedGold();
    const allGoldCollectable = collectableGold === totalGold;
    const enemyAssistedWithinLimit = enemyAssistedGold <= maxEnemyAssisted;
    
    const solvable = allGoldCollectable && enemyAssistedWithinLimit && exitReachable;
    const debug = `gold=${directGold}+${enemyAssistedGold}/${totalGold}, exit=${exitReachable}, limit=${maxEnemyAssisted}`;
    
    return { 
      solvable, 
      score, 
      debug, 
      directGold,
      enemyAssistedGold,
      unreachableGold,
      enemyAssistedPositions
    };
  }
  
  /**
   * Simple check wrapper for compatibility.
   */
  isSolvable(map: TileMap): boolean {
    return this.checkSolvability(map).solvable;
  }
  
  /**
   * Compute all positions where enemies can spawn/respawn.
   * Enemies respawn at the top of the level, preferring ladders.
   */
  private computeEnemySpawnPositions(map: TileMap): Position[] {
    const spawns: Position[] = [];
    
    // Primary spawns: top rows on ladders or empty space
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.getTile(x, y);
        if (tile === TileType.LADDER || tile === TileType.LADDER_EXIT ||
            tile === TileType.EMPTY || tile === TileType.POLE) {
          spawns.push({ x, y });
        }
      }
    }
    
    // Also include initial enemy start positions
    for (const start of map.enemyStarts) {
      if (!spawns.some(s => s.x === start.x && s.y === start.y)) {
        spawns.push(start);
      }
    }
    
    return spawns;
  }
  
  /**
   * Compute all positions reachable by enemies from spawn positions.
   * Enemies use similar movement rules but can't dig.
   */
  private computeEnemyReachablePositions(map: TileMap, spawns: Position[]): Set<string> {
    const visited = new Set<string>();
    const queue: Position[] = [];
    
    // Start from all spawn positions
    for (const spawn of spawns) {
      const key = `${spawn.x},${spawn.y}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(spawn);
      }
    }
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = this.getEnemyReachableNeighbors(map, current);
      
      for (const next of neighbors) {
        const key = `${next.x},${next.y}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
    
    return visited;
  }
  
  /**
   * Get positions reachable by enemy from current position.
   * Enemies can walk, climb, fall, but NOT dig.
   */
  private getEnemyReachableNeighbors(map: TileMap, pos: Position): Position[] {
    const neighbors: Position[] = [];
    const { x, y } = pos;
    
    const onLadder = map.isClimbable(x, y);
    const onBar = map.isBar(x, y);
    const hasSupport = this.hasEnemySupport(map, x, y);
    
    const canMove = onLadder || onBar || hasSupport;
    
    if (canMove) {
      // Walk left
      if (this.canEnemyEnter(map, x - 1, y)) {
        this.addEnemyFallDestination(map, x - 1, y, neighbors);
      }
      // Walk right
      if (this.canEnemyEnter(map, x + 1, y)) {
        this.addEnemyFallDestination(map, x + 1, y, neighbors);
      }
    }
    
    // Climb up - must be ON a ladder
    if (onLadder) {
      if (this.canEnemyEnter(map, x, y - 1)) {
        neighbors.push({ x, y: y - 1 });
      }
    }
    
    // Climb down
    if (onLadder || map.isClimbable(x, y + 1)) {
      if (this.canEnemyEnter(map, x, y + 1)) {
        neighbors.push({ x, y: y + 1 });
      }
    }
    
    // NOTE: Enemies can NOT dig, so no dig-based reachability
    
    return neighbors;
  }
  
  private hasEnemySupport(map: TileMap, x: number, y: number): boolean {
    if (map.isClimbable(x, y)) return true;
    if (map.isBar(x, y)) return true;
    if (y + 1 >= map.height) return true;
    return map.isSupport(x, y + 1);
  }
  
  private canEnemyEnter(map: TileMap, x: number, y: number): boolean {
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
      return false;
    }
    const tile = map.getTile(x, y);
    // Can enter if not solid brick
    return tile !== TileType.BRICK && 
           tile !== TileType.BRICK_HARD && 
           tile !== TileType.BRICK_TRAP;
  }
  
  private addEnemyFallDestination(map: TileMap, x: number, y: number, neighbors: Position[]): void {
    // Simulate falling
    while (y < map.height - 1) {
      if (map.isClimbable(x, y)) break;
      if (map.isBar(x, y)) break;
      if (map.isSupport(x, y + 1)) break;
      if (map.isSolid(x, y + 1)) break;
      y++;
    }
    
    neighbors.push({ x, y });
  }
  
  /**
   * Check if an enemy can pick up gold at a position and deliver it to player-reachable area.
   * 
   * For gold to be deliverable:
   * 1. Enemy must be able to reach the gold position
   * 2. After picking up gold, enemy must be able to reach a player-reachable area
   * 3. When enemy dies in player-reachable area, gold drops there
   * 
   * Risks addressed:
   * - Enemy must be able to escape after picking up gold (not get stuck)
   * - There must be intersection between enemy path and player-reachable areas
   */
  private canEnemyDeliverGold(
    map: TileMap, 
    goldPos: Position, 
    playerReachable: Set<string>,
    enemyReachable: Set<string>
  ): boolean {
    // Enemy must be able to reach the gold
    const goldKey = `${goldPos.x},${goldPos.y}`;
    if (!enemyReachable.has(goldKey)) {
      return false;
    }
    
    // After enemy picks up gold, they chase the player.
    // The gold will be dropped when:
    // 1. Enemy falls into a hole dug by player (in player-reachable area)
    // 2. Enemy dies and respawns (gold drops at death location)
    // 
    // For delivery to work, there must be positions that are:
    // - Reachable by enemy FROM the gold position
    // - Also reachable by player (so player can collect dropped gold)
    
    // Compute what enemy can reach starting from gold position
    const enemyPathFromGold = this.findAllEnemyReachable(map, goldPos);
    
    // Check if enemy can reach ANY player-reachable position
    // This is the "delivery zone" where gold can be transferred
    let hasDeliveryPath = false;
    for (const playerKey of playerReachable) {
      if (enemyPathFromGold.has(playerKey)) {
        hasDeliveryPath = true;
        break;
      }
    }
    
    if (!hasDeliveryPath) {
      return false;
    }
    
    // Additional safety check: enemy must not be in a "trap" position
    // where they can reach the gold but can't escape back out.
    // This is already handled by the above check - if enemy can reach
    // player-reachable area from gold, they can "escape" to there.
    
    // Verify enemy can actually escape from gold area (not stuck in dead-end)
    // Count how many player-reachable tiles enemy can reach from gold
    let deliveryTileCount = 0;
    for (const playerKey of playerReachable) {
      if (enemyPathFromGold.has(playerKey)) {
        deliveryTileCount++;
        // If we have multiple delivery options, that's good enough
        if (deliveryTileCount >= 3) break;
      }
    }
    
    // Require at least a few tiles of overlap for reliable delivery
    // This prevents edge cases where there's only 1 tiny connection point
    return deliveryTileCount >= 2;
  }
  
  /**
   * Find all positions reachable by enemy from a specific start position.
   */
  private findAllEnemyReachable(map: TileMap, start: Position): Set<string> {
    const visited = new Set<string>();
    const queue: Position[] = [start];
    visited.add(`${start.x},${start.y}`);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = this.getEnemyReachableNeighbors(map, current);
      
      for (const next of neighbors) {
        const key = `${next.x},${next.y}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
    
    return visited;
  }
  
  /**
   * Find all positions reachable from start using BFS.
   */
  private findAllReachable(map: TileMap, start: Position): Set<string> {
    const visited = new Set<string>();
    const queue: Position[] = [start];
    visited.add(`${start.x},${start.y}`);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = this.getReachableNeighbors(map, current);
      
      for (const next of neighbors) {
        const key = `${next.x},${next.y}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
    
    return visited;
  }
  
  /**
   * Get all positions reachable from current position.
   */
  private getReachableNeighbors(map: TileMap, pos: Position): Position[] {
    const neighbors: Position[] = [];
    const { x, y } = pos;
    
    const onLadder = this.isClimbable(map, x, y);
    const onBar = map.isBar(x, y);
    const hasSupport = this.hasSupport(map, x, y);
    
    // Can move if: on ladder, on bar, or has support below
    const canMove = onLadder || onBar || hasSupport;
    
    if (canMove) {
      // Walk left
      if (this.canEnter(map, x - 1, y)) {
        this.addFallDestination(map, x - 1, y, neighbors);
      }
      // Walk right
      if (this.canEnter(map, x + 1, y)) {
        this.addFallDestination(map, x + 1, y, neighbors);
      }
    }
    
    // Climb up - must be ON a ladder to climb up (can't grab ladder above you)
    // This matches original Lode Runner behavior
    if (onLadder) {
      if (this.canEnter(map, x, y - 1)) {
        neighbors.push({ x, y: y - 1 });
      }
    }
    
    // Climb down (need ladder at current or target)
    if (onLadder || this.isClimbable(map, x, y + 1)) {
      if (this.canEnter(map, x, y + 1)) {
        neighbors.push({ x, y: y + 1 });
      }
    }
    
    // Dig left (if there's a diggable brick below-left, we can dig and move there)
    if (canMove && map.canDig(x - 1, y + 1)) {
      // After digging, we can walk left and fall into the hole, then potentially continue
      this.addFallDestination(map, x - 1, y + 1, neighbors);
    }
    
    // Dig right
    if (canMove && map.canDig(x + 1, y + 1)) {
      this.addFallDestination(map, x + 1, y + 1, neighbors);
    }
    
    return neighbors;
  }
  
  /**
   * Check if position is climbable (optionally including hidden exit ladders)
   */
  private isClimbable(map: TileMap, x: number, y: number): boolean {
    if (map.isClimbable(x, y)) return true;
    // Only treat exit ladders as climbable when checking exit reachability
    // (they don't exist when collecting gold)
    if (this.includeExitLadders) {
      return this.exitLadderPositions.has(`${x},${y}`);
    }
    return false;
  }
  
  private hasSupport(map: TileMap, x: number, y: number): boolean {
    if (this.isClimbable(map, x, y)) return true;
    if (map.isBar(x, y)) return true;
    if (y + 1 >= map.height) return true;
    // Exit ladders count as support only when we're checking exit reachability
    if (this.includeExitLadders && this.exitLadderPositions.has(`${x},${y + 1}`)) return true;
    return map.isSupport(x, y + 1);
  }
  
  private canEnter(map: TileMap, x: number, y: number): boolean {
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
      return false;
    }
    const tile = map.getTile(x, y);
    // Can enter if not solid brick
    return tile !== TileType.BRICK && 
           tile !== TileType.BRICK_HARD && 
           tile !== TileType.BRICK_TRAP;
  }
  
  /**
   * Add the position where we'd end up after falling.
   */
  private addFallDestination(map: TileMap, x: number, y: number, neighbors: Position[]): void {
    // Simulate falling
    while (y < map.height - 1) {
      // Stop if on ladder (including hidden exit ladders)
      if (this.isClimbable(map, x, y)) break;
      // Stop if on bar
      if (map.isBar(x, y)) break;
      // Stop if support below
      if (map.isSupport(x, y + 1)) break;
      // Stop if solid below (shouldn't happen but safety check)
      if (map.isSolid(x, y + 1)) break;
      
      y++;
    }
    
    neighbors.push({ x, y });
  }
}
