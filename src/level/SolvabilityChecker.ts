import { TileType } from '../config';
import { TileMap } from './TileMap';

interface Position {
  x: number;
  y: number;
}

export class SolvabilityChecker {
  
  /**
   * Check if a level is solvable and return detailed info.
   */
  checkSolvability(map: TileMap): { solvable: boolean; score: number; debug: string } {
    // Quick checks
    if (map.goldPositions.length === 0) {
      return { solvable: false, score: 0, debug: 'no gold' };
    }
    if (map.exitLadders.length === 0) {
      return { solvable: false, score: 0, debug: 'no exit ladders' };
    }
    
    // Build reachability from player start
    const reachable = this.findAllReachable(map, map.playerStart);
    
    // Count reachable gold
    let goldReachable = 0;
    for (const gold of map.goldPositions) {
      const key = `${gold.x},${gold.y}`;
      if (reachable.has(key)) {
        goldReachable++;
      }
    }
    
    // Check exit reachability - need to reach row 0 on an exit ladder column
    let exitReachable = false;
    const exitColumns = new Set(map.exitLadders.map(e => e.x));
    
    for (const col of exitColumns) {
      // Check if row 0 of this column is reachable
      const key = `${col},0`;
      if (reachable.has(key)) {
        exitReachable = true;
        break;
      }
      // Or check if any exit ladder tile in this column is reachable
      for (const exit of map.exitLadders.filter(e => e.x === col)) {
        const exitKey = `${exit.x},${exit.y}`;
        if (reachable.has(exitKey)) {
          exitReachable = true;
          break;
        }
      }
    }
    
    const goldScore = goldReachable / map.goldPositions.length;
    const exitScore = exitReachable ? 1 : 0;
    const score = (goldScore + exitScore) / 2;
    
    const solvable = goldReachable === map.goldPositions.length && exitReachable;
    const debug = `gold=${goldReachable}/${map.goldPositions.length}, exit=${exitReachable}, reachable=${reachable.size}`;
    
    return { solvable, score, debug };
  }
  
  /**
   * Simple check wrapper for compatibility.
   */
  isSolvable(map: TileMap): boolean {
    return this.checkSolvability(map).solvable;
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
    
    const onLadder = map.isClimbable(x, y);
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
    
    // Climb up (need ladder at current or target)
    if (onLadder || map.isClimbable(x, y - 1)) {
      if (this.canEnter(map, x, y - 1)) {
        neighbors.push({ x, y: y - 1 });
      }
    }
    
    // Climb down (need ladder at current or target)
    if (onLadder || map.isClimbable(x, y + 1)) {
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
  
  private hasSupport(map: TileMap, x: number, y: number): boolean {
    if (map.isClimbable(x, y)) return true;
    if (map.isBar(x, y)) return true;
    if (y + 1 >= map.height) return true;
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
      // Stop if on ladder
      if (map.isClimbable(x, y)) break;
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
