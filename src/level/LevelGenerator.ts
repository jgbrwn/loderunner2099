import { CONFIG, TileType, DIFFICULTIES, DifficultySettings } from '../config';
import { SeededRandom } from '../utils/SeededRandom';
import { TileMap } from './TileMap';
import { SolvabilityChecker } from './SolvabilityChecker';

export class LevelGenerator {
  private rng: SeededRandom;
  private difficulty: DifficultySettings;
  private checker: SolvabilityChecker;
  
  constructor(seed: string | number, difficultyKey: string = 'normal') {
    this.rng = new SeededRandom(seed);
    this.difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    this.checker = new SolvabilityChecker();
  }
  
  generate(maxAttempts = 100): TileMap {
    let bestMap: TileMap | null = null;
    let bestScore = -1;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const map = this.generateCandidate();
      const { solvable, score, debug } = this.checker.checkSolvability(map);
      
      if (solvable) {
        console.log(`Generated solvable level on attempt ${attempt + 1}`);
        return map;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMap = map;
      }
      
      if (attempt < 5) {
        console.log(`Attempt ${attempt + 1}: score=${score}, ${debug}`);
      }
    }
    
    // Use best candidate if it's reasonably good
    if (bestMap && bestScore >= 0.5) {
      console.log(`Using best candidate with score ${bestScore}`);
      return bestMap;
    }
    
    // Fallback: generate a simple guaranteed-solvable level
    console.warn('Failed to generate solvable level, using fallback');
    return this.generateFallback();
  }
  
  private generateCandidate(): TileMap {
    const map = new TileMap();
    
    // Step 1: Create ground floor
    this.createGround(map);
    
    // Step 2: Create a main vertical "spine" ladder first
    this.createMainSpine(map);
    
    // Step 3: Create platforms with guaranteed connectivity
    this.createConnectedPlatforms(map);
    
    // Step 4: Add additional ladders
    this.addExtraLadders(map);
    
    // Step 5: Add poles/bars
    this.createPoles(map);
    
    // Step 6: Add some hard bricks (but not blocking ladders)
    this.addHardBricks(map);
    
    // Step 7: Convert some bricks to trap bricks
    this.addTrapBricks(map);
    
    // Step 8: Ensure ladders are accessible (clear blocking bricks)
    this.ensureLadderAccessibility(map);
    
    // Step 9: Place player start (bottom area)
    this.placePlayer(map);
    
    // Step 10: Place gold (only in reachable spots)
    this.placeGold(map);
    
    // Step 11: Place enemies
    this.placeEnemies(map);
    
    // Step 12: Add exit ladders at top (using existing ladders)
    this.addExitLadders(map);
    
    return map;
  }
  
  private createMainSpine(map: TileMap): void {
    // Create a main ladder that goes from bottom to top
    // This guarantees vertical connectivity
    const spineX = this.rng.range(Math.floor(map.width * 0.3), Math.floor(map.width * 0.7));
    
    for (let y = 0; y < map.height - 1; y++) {
      map.setTile(spineX, y, TileType.LADDER);
    }
  }
  
  private createGround(map: TileMap): void {
    // Bottom row is mostly solid
    const y = map.height - 1;
    for (let x = 0; x < map.width; x++) {
      map.setTile(x, y, TileType.BRICK);
    }
  }
  
  private createConnectedPlatforms(map: TileMap): void {
    // Create platform rows with ladders connecting them
    const platformRows = [map.height - 4, map.height - 7, map.height - 10, 3];
    
    // Filter based on difficulty (fewer platforms = harder)
    const numPlatforms = Math.floor(2 + this.difficulty.ladderDensity * 3);
    const activePlatforms = platformRows.slice(0, numPlatforms);
    
    let previousLadderPositions: number[] = [];
    
    for (let i = 0; i < activePlatforms.length; i++) {
      const row = activePlatforms[i];
      const ladderPositions = this.createPlatformWithLadders(map, row, previousLadderPositions);
      previousLadderPositions = ladderPositions;
    }
  }
  
  private createPlatformWithLadders(map: TileMap, row: number, connectFrom: number[]): number[] {
    const ladderPositions: number[] = [];
    
    // Create 2-4 platform segments
    const numSegments = this.rng.range(2, 5);
    const segmentWidth = Math.floor(map.width / numSegments);
    
    for (let seg = 0; seg < numSegments; seg++) {
      const startX = seg * segmentWidth + this.rng.range(0, 3);
      const endX = Math.min(startX + this.rng.range(4, segmentWidth), map.width - 1);
      
      // Leave gap between segments
      if (seg > 0 && startX < seg * segmentWidth + 2) continue;
      
      // Create platform
      for (let x = startX; x <= endX; x++) {
        map.setTile(x, row, TileType.BRICK);
      }
      
      // Add ladder somewhere in this segment
      const ladderX = startX + this.rng.range(1, Math.max(2, endX - startX - 1));
      if (ladderX >= startX && ladderX <= endX) {
        this.extendLadderDown(map, ladderX, row);
        ladderPositions.push(ladderX);
      }
    }
    
    // Ensure at least one ladder connects to a previous ladder position
    if (connectFrom.length > 0 && ladderPositions.length > 0) {
      const targetX = this.rng.pick(connectFrom);
      // Find nearest platform position
      for (let dx = 0; dx < 5; dx++) {
        for (const offset of [dx, -dx]) {
          const x = targetX + offset;
          if (x >= 0 && x < map.width && map.getTile(x, row) === TileType.BRICK) {
            this.extendLadderDown(map, x, row);
            if (!ladderPositions.includes(x)) {
              ladderPositions.push(x);
            }
            break;
          }
        }
      }
    }
    
    return ladderPositions;
  }
  
  private extendLadderDown(map: TileMap, x: number, fromRow: number): void {
    // Extend ladder downward to next solid surface
    // The ladder should reach the platform surface (so player can step off)
    for (let y = fromRow; y < map.height; y++) {
      const tile = map.getTile(x, y);
      // Stop when we hit a hard brick or the bottom
      if (tile === TileType.BRICK_HARD) {
        break;
      }
      // If this is a regular brick, replace it with ladder (creating access point)
      // but stop - don't go below solid ground
      if (tile === TileType.BRICK || tile === TileType.BRICK_TRAP) {
        // Don't dig into the ground floor
        if (y < map.height - 1) {
          map.setTile(x, y, TileType.LADDER);
        }
        break;
      }
      map.setTile(x, y, TileType.LADDER);
    }
  }
  
  private addExtraLadders(map: TileMap): void {
    // Add some random ladders for more paths
    const extraLadders = Math.floor(this.difficulty.ladderDensity * 8);
    
    for (let i = 0; i < extraLadders; i++) {
      const x = this.rng.range(2, map.width - 2);
      
      // Find a platform
      for (let y = 2; y < map.height - 2; y++) {
        if (map.getTile(x, y) === TileType.BRICK && map.getTile(x, y - 1) === TileType.EMPTY) {
          this.extendLadderDown(map, x, y - 1);
          break;
        }
      }
    }
  }
  
  private createPoles(map: TileMap): void {
    // Add horizontal poles strategically to connect platforms
    // Poles should bridge gaps between platforms at the same height
    
    // Find all platform endpoints (edges where you could fall off)
    const platformEdges: { x: number; y: number; side: 'left' | 'right' }[] = [];
    
    for (let y = 1; y < map.height - 2; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        const tile = map.getTile(x, y);
        const above = map.getTile(x, y - 1);
        
        // This is a platform surface (brick with empty above)
        if ((tile === TileType.BRICK || tile === TileType.BRICK_HARD || tile === TileType.LADDER) && 
            (above === TileType.EMPTY || above === TileType.GOLD)) {
          // Check if left edge
          const leftTile = map.getTile(x - 1, y);
          if (leftTile === TileType.EMPTY || leftTile === TileType.POLE) {
            platformEdges.push({ x, y: y - 1, side: 'left' });
          }
          // Check if right edge
          const rightTile = map.getTile(x + 1, y);
          if (rightTile === TileType.EMPTY || rightTile === TileType.POLE) {
            platformEdges.push({ x, y: y - 1, side: 'right' });
          }
        }
      }
    }
    
    // Try to connect platform edges with poles
    const usedEdges = new Set<string>();
    
    for (const edge of platformEdges) {
      const edgeKey = `${edge.x},${edge.y},${edge.side}`;
      if (usedEdges.has(edgeKey)) continue;
      
      // Look for a matching edge on the same row
      const matchingEdges = platformEdges.filter(e => 
        e.y === edge.y && 
        e !== edge &&
        !usedEdges.has(`${e.x},${e.y},${e.side}`)
      );
      
      for (const match of matchingEdges) {
        // Calculate gap
        const startX = Math.min(edge.x, match.x);
        const endX = Math.max(edge.x, match.x);
        const gapLen = endX - startX;
        
        // Only connect reasonable gaps (3-12 tiles)
        if (gapLen < 3 || gapLen > 12) continue;
        
        // Verify the path is clear
        let pathClear = true;
        for (let px = startX; px <= endX; px++) {
          const t = map.getTile(px, edge.y);
          if (t !== TileType.EMPTY && t !== TileType.POLE && t !== TileType.GOLD) {
            pathClear = false;
            break;
          }
        }
        
        if (pathClear && this.rng.chance(0.6)) {
          // Create the pole bridge
          for (let px = startX; px <= endX; px++) {
            // Preserve gold if present
            if (map.getTile(px, edge.y) !== TileType.GOLD) {
              map.setTile(px, edge.y, TileType.POLE);
            }
          }
          usedEdges.add(edgeKey);
          usedEdges.add(`${match.x},${match.y},${match.side}`);
          break;
        }
      }
    }
    
    // Add a few extra poles where they connect ladders to platforms
    for (let y = 2; y < map.height - 3; y++) {
      for (let x = 2; x < map.width - 2; x++) {
        // If there's a ladder with empty space to the side
        if (map.getTile(x, y) === TileType.LADDER) {
          // Check left side
          if (map.getTile(x - 1, y) === TileType.EMPTY && this.rng.chance(0.3)) {
            // Extend pole left until we hit something
            for (let px = x - 1; px >= 0; px--) {
              const t = map.getTile(px, y);
              if (t !== TileType.EMPTY) break;
              // Check if there's a platform below to land on
              const below = map.getTile(px, y + 1);
              if (below === TileType.BRICK || below === TileType.LADDER || below === TileType.BRICK_HARD) {
                // Good endpoint - create pole from here to ladder
                for (let fillX = px; fillX < x; fillX++) {
                  map.setTile(fillX, y, TileType.POLE);
                }
                break;
              }
            }
          }
          // Check right side
          if (map.getTile(x + 1, y) === TileType.EMPTY && this.rng.chance(0.3)) {
            for (let px = x + 1; px < map.width; px++) {
              const t = map.getTile(px, y);
              if (t !== TileType.EMPTY) break;
              const below = map.getTile(px, y + 1);
              if (below === TileType.BRICK || below === TileType.LADDER || below === TileType.BRICK_HARD) {
                for (let fillX = x + 1; fillX <= px; fillX++) {
                  map.setTile(fillX, y, TileType.POLE);
                }
                break;
              }
            }
          }
        }
      }
    }
  }
  
  private addHardBricks(map: TileMap): void {
    // Scatter some hard bricks
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getTile(x, y) === TileType.BRICK && this.rng.chance(0.05)) {
          map.setTile(x, y, TileType.BRICK_HARD);
        }
      }
    }
  }
  
  private addTrapBricks(map: TileMap): void {
    const chance = this.difficulty.trapBrickChance;
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getTile(x, y) === TileType.BRICK && this.rng.chance(chance)) {
          // Don't trap brick if it's directly above a ladder
          if (map.getTile(x, y + 1) === TileType.LADDER) continue;
          map.setTile(x, y, TileType.BRICK_TRAP);
        }
      }
    }
  }
  
  /**
   * Ensure ladders have accessible entry/exit points.
   * Remove bricks that block ladder tops.
   */
  private ensureLadderAccessibility(map: TileMap): void {
    for (let x = 0; x < map.width; x++) {
      for (let y = 1; y < map.height - 1; y++) {
        const tile = map.getTile(x, y);
        
        // If there's a ladder here
        if (tile === TileType.LADDER || tile === TileType.LADDER_EXIT) {
          // Check if there's a brick directly above that would block it
          const above = map.getTile(x, y - 1);
          if (above === TileType.BRICK || above === TileType.BRICK_TRAP) {
            // Check if there's a way to reach the ladder from the side
            const leftClear = x > 0 && !map.isSolid(x - 1, y);
            const rightClear = x < map.width - 1 && !map.isSolid(x + 1, y);
            
            // If no side access and ladder continues up, we need platform access
            if (!leftClear && !rightClear) {
              // Remove the blocking brick and make it a platform edge
              map.setTile(x, y - 1, TileType.EMPTY);
            }
          }
          
          // Ensure ladder top has an accessible entry point
          // Find the top of this ladder
          let ladderTop = y;
          while (ladderTop > 0 && (map.getTile(x, ladderTop - 1) === TileType.LADDER || map.getTile(x, ladderTop - 1) === TileType.LADDER_EXIT)) {
            ladderTop--;
          }
          
          // If at the very top of map, it's an exit - ok
          if (ladderTop === 0) continue;
          
          // Otherwise, ensure there's a platform to step onto at ladder top
          // The tile above ladder top should be empty, and there should be
          // at least one side accessible
          const aboveTop = map.getTile(x, ladderTop - 1);
          if (aboveTop === TileType.BRICK || aboveTop === TileType.BRICK_HARD || aboveTop === TileType.BRICK_TRAP) {
            // Ladder is blocked! Check if we can access from sides at ladderTop
            const leftAccessible = x > 0 && !map.isSolid(x - 1, ladderTop) && map.isSupport(x - 1, ladderTop + 1);
            const rightAccessible = x < map.width - 1 && !map.isSolid(x + 1, ladderTop) && map.isSupport(x + 1, ladderTop + 1);
            
            if (!leftAccessible && !rightAccessible) {
              // No side access, need to clear the blocking brick
              map.setTile(x, ladderTop - 1, TileType.EMPTY);
            }
          }
        }
      }
    }
  }
  
  private placePlayer(map: TileMap): void {
    // Place player on ground floor
    const groundY = map.height - 2;
    
    // Find valid spot on ground
    for (let attempts = 0; attempts < 20; attempts++) {
      const x = this.rng.range(2, map.width - 2);
      if (map.getTile(x, groundY) === TileType.EMPTY || 
          map.getTile(x, groundY) === TileType.LADDER) {
        map.playerStart = { x, y: groundY };
        return;
      }
    }
    
    // Fallback - find any empty spot on ground
    for (let x = 1; x < map.width - 1; x++) {
      if (!map.isSolid(x, groundY)) {
        map.playerStart = { x, y: groundY };
        return;
      }
    }
    
    map.playerStart = { x: 2, y: groundY };
  }
  
  private placeGold(map: TileMap): void {
    const [minGold, maxGold] = this.difficulty.gold;
    const goldCount = this.rng.range(minGold, maxGold + 1);
    
    // Collect all valid positions
    const validSpots: { x: number; y: number }[] = [];
    
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 0; x < map.width; x++) {
        if (this.isValidGoldSpot(map, x, y)) {
          validSpots.push({ x, y });
        }
      }
    }
    
    this.rng.shuffle(validSpots);
    
    // Place gold, preferring distributed placement
    const placed: { x: number; y: number }[] = [];
    
    for (const spot of validSpots) {
      if (placed.length >= goldCount) break;
      
      // Check distance from other gold
      const tooClose = placed.some(p => 
        Math.abs(p.x - spot.x) + Math.abs(p.y - spot.y) < 4
      );
      
      if (!tooClose) {
        map.setTile(spot.x, spot.y, TileType.GOLD);
        map.goldPositions.push(spot);
        placed.push(spot);
      }
    }
    
    // If we couldn't place enough with spacing, place remaining anywhere
    for (const spot of validSpots) {
      if (placed.length >= goldCount) break;
      if (placed.some(p => p.x === spot.x && p.y === spot.y)) continue;
      
      map.setTile(spot.x, spot.y, TileType.GOLD);
      map.goldPositions.push(spot);
      placed.push(spot);
    }
  }
  
  private isValidGoldSpot(map: TileMap, x: number, y: number): boolean {
    if (map.getTile(x, y) !== TileType.EMPTY) return false;
    
    // Need support below
    const below = map.getTile(x, y + 1);
    return below === TileType.BRICK || 
           below === TileType.BRICK_HARD || 
           below === TileType.LADDER ||
           below === TileType.BRICK_TRAP;
  }
  
  private placeEnemies(map: TileMap): void {
    const [minEnemies, maxEnemies] = this.difficulty.enemies;
    const enemyCount = this.rng.range(minEnemies, maxEnemies + 1);
    
    const validSpots: { x: number; y: number }[] = [];
    
    for (let y = 0; y < map.height - 1; y++) {
      for (let x = 0; x < map.width; x++) {
        if (this.isValidEnemySpot(map, x, y)) {
          // Must be far from player start
          const dist = Math.abs(x - map.playerStart.x) + Math.abs(y - map.playerStart.y);
          if (dist > 8) {
            validSpots.push({ x, y });
          }
        }
      }
    }
    
    this.rng.shuffle(validSpots);
    
    // Place enemies ensuring no duplicates and minimum spacing
    const placedPositions: Set<string> = new Set();
    for (const spot of validSpots) {
      if (map.enemyStarts.length >= enemyCount) break;
      
      const key = `${spot.x},${spot.y}`;
      if (placedPositions.has(key)) continue;
      
      // Ensure minimum spacing from other enemies (at least 3 tiles apart)
      const tooClose = map.enemyStarts.some(e => 
        Math.abs(e.x - spot.x) + Math.abs(e.y - spot.y) < 3
      );
      if (tooClose) continue;
      
      placedPositions.add(key);
      map.enemyStarts.push(spot);
    }
  }
  
  private isValidEnemySpot(map: TileMap, x: number, y: number): boolean {
    const tile = map.getTile(x, y);
    if (tile !== TileType.EMPTY && tile !== TileType.LADDER) return false;
    
    const below = map.getTile(x, y + 1);
    return below === TileType.BRICK || 
           below === TileType.BRICK_HARD || 
           below === TileType.LADDER;
  }
  
  private addExitLadders(map: TileMap): void {
    // Find existing ladders that could become exit ladders
    const existingLadders: number[] = [];
    for (let x = 2; x < map.width - 2; x++) {
      // Check if there's a ladder reaching close to the top
      for (let y = 0; y < 5; y++) {
        if (map.getTile(x, y) === TileType.LADDER) {
          existingLadders.push(x);
          break;
        }
      }
    }
    
    // Extend 1-2 existing ladders to be exit ladders
    this.rng.shuffle(existingLadders);
    const numExits = Math.min(this.rng.range(1, 3), existingLadders.length);
    
    for (let i = 0; i < numExits; i++) {
      const x = existingLadders[i];
      // Extend ladder to top
      for (let y = 0; y < map.height; y++) {
        const tile = map.getTile(x, y);
        if (tile === TileType.LADDER || tile === TileType.EMPTY) {
          map.setTile(x, y, TileType.LADDER_EXIT);
          map.exitLadders.push({ x, y });
        }
        if (tile === TileType.BRICK || tile === TileType.BRICK_HARD) {
          break;
        }
      }
    }
    
    // If no existing ladders, create new exit ladder from highest platform
    if (map.exitLadders.length === 0) {
      // Find highest platform
      let highestPlatformY = map.height;
      let highestPlatformX = map.width / 2;
      
      for (let y = 1; y < map.height - 3; y++) {
        for (let x = 3; x < map.width - 3; x++) {
          if (map.getTile(x, y) === TileType.BRICK && map.getTile(x, y - 1) === TileType.EMPTY) {
            if (y < highestPlatformY) {
              highestPlatformY = y;
              highestPlatformX = x;
            }
          }
        }
      }
      
      // Create exit ladder from this platform to top
      for (let y = 0; y < highestPlatformY; y++) {
        map.setTile(highestPlatformX, y, TileType.LADDER_EXIT);
        map.exitLadders.push({ x: highestPlatformX, y });
      }
      
      // Also add ladder going down from this platform
      this.extendLadderDown(map, highestPlatformX, highestPlatformY);
    }
  }
  
  private generateFallback(): TileMap {
    const map = new TileMap();
    
    // Ground
    for (let x = 0; x < map.width; x++) {
      map.setTile(x, map.height - 1, TileType.BRICK);
    }
    
    // Platform 1 (middle height)
    for (let x = 3; x < 18; x++) {
      map.setTile(x, 10, TileType.BRICK);
    }
    
    // Platform 2 (higher)
    for (let x = 10; x < 25; x++) {
      map.setTile(x, 6, TileType.BRICK);
    }
    
    // Ladders
    for (let y = 10; y < map.height - 1; y++) {
      map.setTile(8, y, TileType.LADDER);
    }
    for (let y = 6; y < 10; y++) {
      map.setTile(14, y, TileType.LADDER);
    }
    for (let y = 0; y < 6; y++) {
      map.setTile(20, y, TileType.LADDER_EXIT);
      map.exitLadders.push({ x: 20, y });
    }
    
    // Poles
    for (let x = 18; x < 24; x++) {
      map.setTile(x, 10, TileType.POLE);
    }
    
    // Player start
    map.playerStart = { x: 3, y: map.height - 2 };
    
    // Gold
    const goldSpots = [
      { x: 5, y: 9 }, { x: 10, y: 9 }, { x: 15, y: 9 },
      { x: 12, y: 5 }, { x: 18, y: 5 }, { x: 22, y: 5 }
    ];
    for (const spot of goldSpots) {
      map.setTile(spot.x, spot.y, TileType.GOLD);
      map.goldPositions.push(spot);
    }
    
    // Enemies
    map.enemyStarts.push({ x: 22, y: map.height - 2 });
    map.enemyStarts.push({ x: 16, y: 9 });
    
    return map;
  }
}
