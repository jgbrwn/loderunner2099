import { TileType } from '../config';
import { TileMap } from './TileMap';

interface Position {
  x: number;
  y: number;
}

// State for pathfinding (position + collected gold)
interface State {
  x: number;
  y: number;
  collected: Set<string>;
}

export class SolvabilityChecker {
  
  /**
   * Check if a level is solvable:
   * 1. All gold is reachable from player start
   * 2. Exit is reachable after collecting all gold
   */
  isSolvable(map: TileMap): boolean {
    // Quick checks
    if (map.goldPositions.length === 0) return false;
    if (map.exitLadders.length === 0) return false;
    
    // Build reachability graph
    const reachable = this.findAllReachable(map, map.playerStart);
    
    // Check all gold is reachable
    for (const gold of map.goldPositions) {
      const key = `${gold.x},${gold.y}`;
      if (!reachable.has(key)) {
        return false;
      }
    }
    
    // Check exit is reachable (top row with exit ladder)
    let exitReachable = false;
    for (const exit of map.exitLadders) {
      if (exit.y === 0) {
        const key = `${exit.x},${exit.y}`;
        if (reachable.has(key)) {
          exitReachable = true;
          break;
        }
      }
    }
    
    return exitReachable;
  }
  
  /**
   * Find all positions reachable from start using BFS.
   * Considers: walking, climbing, falling, traversing bars, and digging.
   */
  private findAllReachable(map: TileMap, start: Position): Set<string> {
    const visited = new Set<string>();
    const queue: Position[] = [start];
    visited.add(`${start.x},${start.y}`);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = this.getReachableNeighbors(map, current, visited);
      
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
   * Get all positions reachable from current position in one "move".
   */
  private getReachableNeighbors(map: TileMap, pos: Position, visited: Set<string>): Position[] {
    const neighbors: Position[] = [];
    const { x, y } = pos;
    
    // Current tile properties
    const onLadder = map.isClimbable(x, y);
    const onBar = map.isBar(x, y);
    const hasSupport = this.hasSupport(map, x, y);
    
    // Movement rules:
    
    // 1. Walk left/right (if supported or on ladder/bar)
    if (hasSupport || onLadder || onBar) {
      // Left
      if (this.canMoveTo(map, x - 1, y)) {
        this.addWithFall(map, x - 1, y, neighbors, visited);
      }
      // Right
      if (this.canMoveTo(map, x + 1, y)) {
        this.addWithFall(map, x + 1, y, neighbors, visited);
      }
    }
    
    // 2. Climb up (if on ladder)
    if (onLadder && this.canMoveTo(map, x, y - 1)) {
      neighbors.push({ x, y: y - 1 });
    }
    
    // 3. Climb down (if ladder below or currently on ladder)
    if ((onLadder || map.isClimbable(x, y + 1)) && this.canMoveTo(map, x, y + 1)) {
      neighbors.push({ x, y: y + 1 });
    }
    
    // 4. Fall through empty space (handled by addWithFall)
    
    // 5. Dig left/right (creates temporary path)
    // For solvability, we assume digging is available
    if (hasSupport || onLadder) {
      // Dig left - brick below-left becomes accessible
      if (map.canDig(x - 1, y + 1)) {
        // After digging, we can move left and fall into the hole
        this.addWithFall(map, x - 1, y, neighbors, visited, true);
      }
      // Dig right
      if (map.canDig(x + 1, y + 1)) {
        this.addWithFall(map, x + 1, y, neighbors, visited, true);
      }
    }
    
    return neighbors;
  }
  
  /**
   * Check if entity has support at position (won't fall).
   */
  private hasSupport(map: TileMap, x: number, y: number): boolean {
    // On ladder = supported
    if (map.isClimbable(x, y)) return true;
    // On bar = supported
    if (map.isBar(x, y)) return true;
    // Check below
    if (y + 1 >= map.height) return true; // Bottom of level
    return map.isSupport(x, y + 1);
  }
  
  /**
   * Check if a position can be moved into.
   */
  private canMoveTo(map: TileMap, x: number, y: number): boolean {
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
      return false;
    }
    const tile = map.getTile(x, y);
    // Can't move into solid blocks
    return tile !== TileType.BRICK && 
           tile !== TileType.BRICK_HARD && 
           tile !== TileType.BRICK_TRAP;
  }
  
  /**
   * Add position to neighbors, accounting for falling.
   */
  private addWithFall(
    map: TileMap, 
    x: number, 
    y: number, 
    neighbors: Position[], 
    visited: Set<string>,
    throughDugHole = false
  ): void {
    // If moving through a dug hole, start one level lower
    if (throughDugHole) {
      y = y + 1;
    }
    
    // Simulate falling
    while (y < map.height - 1) {
      const tile = map.getTile(x, y);
      
      // Stop falling if on ladder or bar
      if (map.isClimbable(x, y) || map.isBar(x, y)) {
        break;
      }
      
      // Check support below
      if (map.isSupport(x, y + 1)) {
        break;
      }
      
      // Check if below is blocked
      const belowTile = map.getTile(x, y + 1);
      if (belowTile === TileType.BRICK_HARD) {
        break;
      }
      
      // Continue falling (through empty or diggable bricks if we're simulating)
      y++;
    }
    
    const key = `${x},${y}`;
    if (!visited.has(key) && y >= 0 && y < map.height) {
      neighbors.push({ x, y });
    }
  }
}
