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
  
  generate(maxAttempts = 50): TileMap {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const map = this.generateCandidate();
      if (this.checker.isSolvable(map)) {
        return map;
      }
    }
    // Fallback: generate a simple guaranteed-solvable level
    console.warn('Failed to generate solvable level, using fallback');
    return this.generateFallback();
  }
  
  private generateCandidate(): TileMap {
    const map = new TileMap();
    
    // Step 1: Create ground floor
    this.createGround(map);
    
    // Step 2: Create platforms
    this.createPlatforms(map);
    
    // Step 3: Add ladders to connect platforms
    this.createLadders(map);
    
    // Step 4: Add poles/bars
    this.createPoles(map);
    
    // Step 5: Add hard bricks (obstacles)
    this.addHardBricks(map);
    
    // Step 6: Convert some bricks to trap bricks
    this.addTrapBricks(map);
    
    // Step 7: Place player start
    this.placePlayer(map);
    
    // Step 8: Place gold
    this.placeGold(map);
    
    // Step 9: Place enemies
    this.placeEnemies(map);
    
    // Step 10: Add exit ladders at top
    this.addExitLadders(map);
    
    return map;
  }
  
  private createGround(map: TileMap): void {
    // Bottom row is solid (with some gaps for interest)
    const y = map.height - 1;
    for (let x = 0; x < map.width; x++) {
      // Leave occasional gaps (but not at edges)
      if (x > 2 && x < map.width - 3 && this.rng.chance(0.1)) {
        // Gap - skip
      } else {
        map.setTile(x, y, TileType.BRICK);
      }
    }
  }
  
  private createPlatforms(map: TileMap): void {
    // Create 4-7 platform rows at varying heights
    const numPlatforms = this.rng.range(4, 8);
    const usedRows = new Set<number>();
    usedRows.add(map.height - 1); // Ground
    usedRows.add(0); // Top row reserved
    
    for (let i = 0; i < numPlatforms; i++) {
      // Pick a row not too close to others
      let row: number;
      let attempts = 0;
      do {
        row = this.rng.range(2, map.height - 2);
        attempts++;
      } while (this.isTooCloseToUsedRow(row, usedRows) && attempts < 20);
      
      if (attempts >= 20) continue;
      usedRows.add(row);
      
      // Create platform segments
      this.createPlatformRow(map, row);
    }
  }
  
  private isTooCloseToUsedRow(row: number, usedRows: Set<number>): boolean {
    for (const used of usedRows) {
      if (Math.abs(row - used) < 2) return true;
    }
    return false;
  }
  
  private createPlatformRow(map: TileMap, row: number): void {
    // Create several platform segments
    const numSegments = this.rng.range(2, 5);
    let x = this.rng.range(0, 5);
    
    for (let seg = 0; seg < numSegments && x < map.width - 3; seg++) {
      const length = this.rng.range(4, 12);
      const endX = Math.min(x + length, map.width);
      
      for (let px = x; px < endX; px++) {
        map.setTile(px, row, TileType.BRICK);
      }
      
      // Gap before next segment
      x = endX + this.rng.range(2, 6);
    }
  }
  
  private createLadders(map: TileMap): void {
    // Find platform edges and middle areas, add ladders
    const ladderDensity = this.difficulty.ladderDensity;
    
    for (let x = 1; x < map.width - 1; x++) {
      for (let y = 1; y < map.height - 1; y++) {
        // Skip if not a good ladder spot
        if (!this.isGoodLadderSpot(map, x, y)) continue;
        
        // Random chance based on difficulty
        if (!this.rng.chance(ladderDensity * 0.3)) continue;
        
        // Extend ladder up/down to connect platforms
        this.extendLadder(map, x, y);
      }
    }
    
    // Ensure at least some ladders exist
    this.ensureMinimumLadders(map);
  }
  
  private isGoodLadderSpot(map: TileMap, x: number, y: number): boolean {
    const current = map.getTile(x, y);
    const below = map.getTile(x, y + 1);
    
    // Good spot: empty space above a brick
    return current === TileType.EMPTY && 
           (below === TileType.BRICK || below === TileType.BRICK_HARD);
  }
  
  private extendLadder(map: TileMap, x: number, startY: number): void {
    // Extend upward until hitting something or reaching a platform above
    let y = startY;
    while (y >= 0) {
      const tile = map.getTile(x, y);
      if (tile === TileType.BRICK || tile === TileType.BRICK_HARD) {
        break; // Hit a platform from below
      }
      map.setTile(x, y, TileType.LADDER);
      y--;
      
      // Check if we've connected to a platform above
      if (y >= 0 && (map.getTile(x, y) === TileType.BRICK || map.getTile(x, y) === TileType.BRICK_HARD)) {
        break;
      }
    }
    
    // Also extend downward through empty space
    y = startY + 1;
    while (y < map.height) {
      const tile = map.getTile(x, y);
      if (tile === TileType.BRICK || tile === TileType.BRICK_HARD) {
        // Optionally replace brick with ladder to go through
        if (this.rng.chance(0.3)) {
          map.setTile(x, y, TileType.LADDER);
        }
        break;
      } else if (tile === TileType.EMPTY || tile === TileType.LADDER) {
        map.setTile(x, y, TileType.LADDER);
      }
      y++;
    }
  }
  
  private ensureMinimumLadders(map: TileMap): void {
    // Count ladders
    let ladderCount = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getTile(x, y) === TileType.LADDER) ladderCount++;
      }
    }
    
    // Need at least 15 ladder tiles
    const minLadders = 15;
    if (ladderCount < minLadders) {
      // Add more ladders at random valid positions
      for (let i = ladderCount; i < minLadders; i++) {
        const x = this.rng.range(2, map.width - 2);
        const y = this.rng.range(2, map.height - 2);
        if (this.isGoodLadderSpot(map, x, y)) {
          this.extendLadder(map, x, y);
        }
      }
    }
  }
  
  private createPoles(map: TileMap): void {
    // Add horizontal poles/bars across gaps
    for (let y = 2; y < map.height - 2; y++) {
      if (!this.rng.chance(0.25)) continue; // 25% chance per row
      
      // Find gaps in this row
      let inGap = false;
      let gapStart = 0;
      
      for (let x = 0; x < map.width; x++) {
        const tile = map.getTile(x, y);
        const isEmpty = tile === TileType.EMPTY;
        
        if (isEmpty && !inGap) {
          inGap = true;
          gapStart = x;
        } else if (!isEmpty && inGap) {
          // End of gap - maybe add pole
          const gapLength = x - gapStart;
          if (gapLength >= 3 && gapLength <= 10 && this.rng.chance(0.4)) {
            for (let px = gapStart; px < x; px++) {
              map.setTile(px, y, TileType.POLE);
            }
          }
          inGap = false;
        }
      }
    }
  }
  
  private addHardBricks(map: TileMap): void {
    // Scatter some hard (indestructible) bricks
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getTile(x, y) === TileType.BRICK && this.rng.chance(0.08)) {
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
          map.setTile(x, y, TileType.BRICK_TRAP);
        }
      }
    }
  }
  
  private placePlayer(map: TileMap): void {
    // Place player on ground floor or low platform
    const validSpots: { x: number; y: number }[] = [];
    
    for (let x = 1; x < map.width - 1; x++) {
      for (let y = map.height - 3; y < map.height; y++) {
        if (this.isValidSpawnSpot(map, x, y)) {
          validSpots.push({ x, y });
        }
      }
    }
    
    if (validSpots.length > 0) {
      map.playerStart = this.rng.pick(validSpots);
    } else {
      // Fallback: bottom left area
      map.playerStart = { x: 2, y: map.height - 2 };
    }
  }
  
  private isValidSpawnSpot(map: TileMap, x: number, y: number): boolean {
    const tile = map.getTile(x, y);
    const below = map.getTile(x, y + 1);
    return (tile === TileType.EMPTY || tile === TileType.LADDER) &&
           (below === TileType.BRICK || below === TileType.BRICK_HARD || below === TileType.LADDER);
  }
  
  private placeGold(map: TileMap): void {
    const [minGold, maxGold] = this.difficulty.gold;
    const goldCount = this.rng.range(minGold, maxGold + 1);
    
    // Find all valid gold positions
    const validSpots: { x: number; y: number }[] = [];
    
    for (let x = 0; x < map.width; x++) {
      for (let y = 0; y < map.height - 1; y++) {
        if (this.isValidGoldSpot(map, x, y)) {
          validSpots.push({ x, y });
        }
      }
    }
    
    // Shuffle and pick
    this.rng.shuffle(validSpots);
    const goldSpots = validSpots.slice(0, Math.min(goldCount, validSpots.length));
    
    for (const spot of goldSpots) {
      map.setTile(spot.x, spot.y, TileType.GOLD);
      map.goldPositions.push(spot);
    }
  }
  
  private isValidGoldSpot(map: TileMap, x: number, y: number): boolean {
    const tile = map.getTile(x, y);
    const below = map.getTile(x, y + 1);
    
    // Gold needs empty space with support below
    return tile === TileType.EMPTY &&
           (below === TileType.BRICK || 
            below === TileType.BRICK_HARD || 
            below === TileType.LADDER ||
            below === TileType.POLE);
  }
  
  private placeEnemies(map: TileMap): void {
    const [minEnemies, maxEnemies] = this.difficulty.enemies;
    const enemyCount = this.rng.range(minEnemies, maxEnemies + 1);
    
    // Find valid enemy spawn positions (not too close to player)
    const validSpots: { x: number; y: number }[] = [];
    
    for (let x = 0; x < map.width; x++) {
      for (let y = 0; y < map.height - 1; y++) {
        if (this.isValidEnemySpot(map, x, y)) {
          // Check distance from player
          const dist = Math.abs(x - map.playerStart.x) + Math.abs(y - map.playerStart.y);
          if (dist > 8) {
            validSpots.push({ x, y });
          }
        }
      }
    }
    
    this.rng.shuffle(validSpots);
    const enemySpots = validSpots.slice(0, Math.min(enemyCount, validSpots.length));
    
    for (const spot of enemySpots) {
      map.enemyStarts.push(spot);
    }
  }
  
  private isValidEnemySpot(map: TileMap, x: number, y: number): boolean {
    return this.isValidSpawnSpot(map, x, y) &&
           map.getTile(x, y) !== TileType.GOLD;
  }
  
  private addExitLadders(map: TileMap): void {
    // Add 1-3 exit ladders at the top
    const numExits = this.rng.range(1, 4);
    const positions: number[] = [];
    
    for (let i = 0; i < numExits; i++) {
      let x: number;
      let attempts = 0;
      do {
        x = this.rng.range(3, map.width - 3);
        attempts++;
      } while (positions.some(p => Math.abs(p - x) < 5) && attempts < 20);
      
      if (attempts < 20) {
        positions.push(x);
        
        // Place exit ladder from top down to first platform
        let y = 0;
        while (y < 5) {
          const tile = map.getTile(x, y);
          if (tile === TileType.EMPTY || tile === TileType.LADDER) {
            map.setTile(x, y, TileType.LADDER_EXIT);
            map.exitLadders.push({ x, y });
          } else {
            break;
          }
          y++;
        }
      }
    }
  }
  
  private generateFallback(): TileMap {
    // Simple guaranteed-solvable level
    const map = new TileMap();
    
    // Ground
    for (let x = 0; x < map.width; x++) {
      map.setTile(x, map.height - 1, TileType.BRICK);
    }
    
    // Middle platform
    for (let x = 5; x < 20; x++) {
      map.setTile(x, 8, TileType.BRICK);
    }
    
    // Ladders
    for (let y = 8; y < map.height - 1; y++) {
      map.setTile(10, y, TileType.LADDER);
    }
    
    // Exit ladder
    for (let y = 0; y < 8; y++) {
      map.setTile(15, y, TileType.LADDER_EXIT);
      map.exitLadders.push({ x: 15, y });
    }
    
    // Player start
    map.playerStart = { x: 3, y: map.height - 2 };
    
    // Gold
    map.setTile(8, 7, TileType.GOLD);
    map.goldPositions.push({ x: 8, y: 7 });
    map.setTile(12, 7, TileType.GOLD);
    map.goldPositions.push({ x: 12, y: 7 });
    map.setTile(18, 7, TileType.GOLD);
    map.goldPositions.push({ x: 18, y: 7 });
    
    // Enemy
    map.enemyStarts.push({ x: 22, y: map.height - 2 });
    
    return map;
  }
}
