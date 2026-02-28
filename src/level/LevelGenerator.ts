import { CONFIG, TileType, DIFFICULTIES, DifficultySettings } from '../config';
import { SeededRandom } from '../utils/SeededRandom';
import { TileMap } from './TileMap';
import { SolvabilityChecker } from './SolvabilityChecker';

export class LevelGenerator {
  private rng: SeededRandom;
  private difficulty: DifficultySettings;
  private checker: SolvabilityChecker;
  private levelNumber: number;
  private difficultyKey: string;
  
  constructor(seed: string | number, difficultyKey: string = 'normal', levelNumber: number = 1) {
    this.rng = new SeededRandom(seed);
    this.difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    this.checker = new SolvabilityChecker();
    this.levelNumber = levelNumber;
    this.difficultyKey = difficultyKey;
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
    
    // Only use best candidate if ALL gold is reachable AND exit is reachable
    // Score = goldScore * exitScore, so we need score = 1.0 for perfect level
    // Allow 0.99 to handle floating point issues
    if (bestMap && bestScore >= 0.99) {
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
    // Create a main ladder that goes from bottom to near-top
    // This guarantees basic vertical connectivity
    // For harder difficulties, make the spine less direct (zigzag)
    const complexity = this.difficulty.complexity ?? 0.6;
    let spineX = this.rng.range(Math.floor(map.width * 0.25), Math.floor(map.width * 0.75));
    
    // Decide if spine should zigzag (more likely at high complexity)
    const zigzag = complexity > 0.5 && this.rng.next() < complexity;
    const zigzagInterval = zigzag ? this.rng.range(3, 5) : 999;
    
    // Start spine from row 4 (leave top rows for exit ladder only)
    const spineStartY = 4;
    for (let y = spineStartY; y < map.height - 1; y++) {
      map.setTile(spineX, y, TileType.LADDER);
      
      // Zigzag: shift spine left or right periodically
      if (zigzag && y > 0 && y % zigzagInterval === 0 && y < map.height - 3) {
        const shift = this.rng.range(2, 5) * (this.rng.next() < 0.5 ? -1 : 1);
        const newX = Math.max(2, Math.min(map.width - 3, spineX + shift));
        
        // Create horizontal connection
        const startX = Math.min(spineX, newX);
        const endX = Math.max(spineX, newX);
        for (let x = startX; x <= endX; x++) {
          if (map.getTile(x, y) === TileType.EMPTY) {
            map.setTile(x, y, TileType.LADDER);
          }
        }
        spineX = newX;
      }
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
    // More complex levels have more platform rows to navigate
    const platformRows = [map.height - 4, map.height - 7, map.height - 10, 3, map.height - 13];
    
    // Complexity controls how many platform layers we have
    // complexity 0.4 = 2 platforms, 0.6 = 3, 0.8 = 4, 1.0 = 5
    const complexity = this.difficulty.complexity ?? 0.6;
    const numPlatforms = Math.floor(1 + complexity * 4);
    const activePlatforms = platformRows.slice(0, Math.min(numPlatforms, platformRows.length));
    
    let previousLadderPositions: number[] = [];
    
    for (let i = 0; i < activePlatforms.length; i++) {
      const row = activePlatforms[i];
      const ladderPositions = this.createPlatformWithLadders(map, row, previousLadderPositions);
      previousLadderPositions = ladderPositions;
    }
  }
  
  private createPlatformWithLadders(map: TileMap, row: number, connectFrom: number[]): number[] {
    const ladderPositions: number[] = [];
    
    // Create platform segments - more complex levels have more segments
    const complexity = this.difficulty.complexity ?? 0.6;
    const minSegments = Math.floor(2 + complexity);
    const maxSegments = Math.floor(3 + complexity * 3);
    const numSegments = this.rng.range(minSegments, maxSegments + 1);
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
      
      // Add ladder somewhere in this segment - probability based on ladder density
      if (this.rng.next() < this.difficulty.ladderDensity) {
        const ladderX = startX + this.rng.range(1, Math.max(2, endX - startX - 1));
        if (ladderX >= startX && ladderX <= endX) {
          this.extendLadderDown(map, ladderX, row);
          ladderPositions.push(ladderX);
        }
      }
    }
    
    // Ensure at least one ladder connects to a previous ladder position (for solvability)
    if (connectFrom.length > 0) {
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
    // Ladder density controls how many extra easy routes exist
    const extraLadders = Math.floor(this.difficulty.ladderDensity * 10);
    
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
    // Poles in classic Lode Runner serve specific purposes:
    // 1. Bridge gaps between platforms (ONLY when they connect two reachable areas)
    // 2. Provide access to isolated areas that would otherwise be unreachable
    // 3. Create strategic routes for escaping enemies
    // 
    // Poles should NEVER:
    // - Hang over empty space with no purpose
    // - Be placed directly above solid floor where walking would suffice
    // - Lead to dead ends
    
    // First, identify all platform segments and their edges
    interface Platform {
      y: number;        // Row (surface level - the row you walk on is y+1)
      startX: number;
      endX: number;
    }
    
    const platforms: Platform[] = [];
    
    for (let y = 1; y < map.height - 1; y++) {
      let platformStart = -1;
      for (let x = 0; x < map.width; x++) {
        const isWalkable = this.isWalkableSurface(map, x, y);
        
        if (isWalkable && platformStart === -1) {
          platformStart = x;
        } else if (!isWalkable && platformStart !== -1) {
          platforms.push({ y: y - 1, startX: platformStart, endX: x - 1 });
          platformStart = -1;
        }
      }
      if (platformStart !== -1) {
        platforms.push({ y: y - 1, startX: platformStart, endX: map.width - 1 });
      }
    }
    
    // Find pairs of platforms at the same height that could be connected
    const polesCreated: { y: number; startX: number; endX: number }[] = [];
    
    for (let i = 0; i < platforms.length; i++) {
      for (let j = i + 1; j < platforms.length; j++) {
        const p1 = platforms[i];
        const p2 = platforms[j];
        
        // Must be at same height
        if (p1.y !== p2.y) continue;
        
        // Determine gap between them
        const leftPlatform = p1.endX < p2.startX ? p1 : p2;
        const rightPlatform = p1.endX < p2.startX ? p2 : p1;
        
        const gapStart = leftPlatform.endX + 1;
        const gapEnd = rightPlatform.startX - 1;
        const gapLength = gapEnd - gapStart + 1;
        
        // Gap must be meaningful (3-15 tiles) - walking over small gaps defeats the purpose
        if (gapLength < 3 || gapLength > 15) continue;
        
        // Check if path is clear (no obstructions)
        let pathClear = true;
        for (let x = gapStart; x <= gapEnd; x++) {
          const tile = map.getTile(x, p1.y);
          if (tile !== TileType.EMPTY && tile !== TileType.GOLD) {
            pathClear = false;
            break;
          }
        }
        if (!pathClear) continue;
        
        // IMPORTANT: Don't create pole if there's solid ground directly below the entire gap
        // (that would be pointless - you could just walk)
        let hasDropZone = false;
        for (let x = gapStart; x <= gapEnd; x++) {
          const below = map.getTile(x, p1.y + 1);
          if (below !== TileType.BRICK && below !== TileType.BRICK_HARD && below !== TileType.BRICK_TRAP) {
            hasDropZone = true;
            break;
          }
        }
        if (!hasDropZone) continue;
        
        // Don't overlap with existing poles
        let overlaps = false;
        for (const existing of polesCreated) {
          if (existing.y === p1.y && 
              !(gapEnd < existing.startX || gapStart > existing.endX)) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        
        // Create pole with some randomness (not all valid gaps get poles)
        const connectionChance = 0.5 + this.difficulty.complexity * 0.3;
        if (this.rng.chance(connectionChance)) {
          // Create pole from platform edge to platform edge
          for (let x = leftPlatform.endX; x <= rightPlatform.startX; x++) {
            const current = map.getTile(x, p1.y);
            if (current === TileType.EMPTY) {
              map.setTile(x, p1.y, TileType.POLE);
            }
          }
          polesCreated.push({ y: p1.y, startX: leftPlatform.endX, endX: rightPlatform.startX });
        }
      }
    }
    
    // Secondary: Create poles that extend from ladders to reach isolated platforms
    // This is for cases where a ladder is near a platform but doesn't quite connect
    for (let y = 2; y < map.height - 3; y++) {
      for (let x = 2; x < map.width - 2; x++) {
        if (map.getTile(x, y) !== TileType.LADDER) continue;
        
        // Check each direction for a nearby platform that's not directly reachable
        for (const dir of [-1, 1]) {
          // Look for a platform edge in this direction
          let targetX = -1;
          for (let dx = 1; dx <= 8; dx++) {
            const checkX = x + dir * dx;
            if (checkX < 0 || checkX >= map.width) break;
            
            const tile = map.getTile(checkX, y);
            if (tile !== TileType.EMPTY && tile !== TileType.POLE) break;
            
            // Check if there's a platform to land on here
            const below = map.getTile(checkX, y + 1);
            if (below === TileType.BRICK || below === TileType.BRICK_HARD || below === TileType.LADDER) {
              targetX = checkX;
              break;
            }
          }
          
          // Only create pole if target is at least 3 tiles away and we found a landing spot
          if (targetX !== -1 && Math.abs(targetX - x) >= 3) {
            // Check there's no floor directly connecting these positions
            let needsPole = false;
            for (let checkX = Math.min(x, targetX); checkX <= Math.max(x, targetX); checkX++) {
              const below = map.getTile(checkX, y + 1);
              if (below !== TileType.BRICK && below !== TileType.BRICK_HARD && below !== TileType.LADDER) {
                needsPole = true;
                break;
              }
            }
            
            if (needsPole && this.rng.chance(0.35)) {
              const startX = Math.min(x, targetX);
              const endX = Math.max(x, targetX);
              for (let fillX = startX; fillX <= endX; fillX++) {
                const current = map.getTile(fillX, y);
                if (current === TileType.EMPTY) {
                  map.setTile(fillX, y, TileType.POLE);
                }
              }
            }
          }
        }
      }
    }
  }
  
  /**
   * Check if a position has a walkable surface (player can stand on the tile below)
   */
  private isWalkableSurface(map: TileMap, x: number, y: number): boolean {
    if (y >= map.height) return false;
    const tile = map.getTile(x, y);
    return tile === TileType.BRICK || 
           tile === TileType.BRICK_HARD || 
           tile === TileType.BRICK_TRAP ||
           tile === TileType.LADDER;
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
    const [baseMin, baseMax] = this.difficulty.enemies;
    
    // Scale enemy count with level progression
    // Every 5 levels, add 1 to both min and max (capped)
    const levelBonus = Math.floor((this.levelNumber - 1) / 5);
    
    // Max enemies caps based on difficulty:
    // Easy: max 4, Normal: max 5, Hard: max 6, Ninja: max 7
    const maxCaps: { [key: string]: number } = {
      easy: 4,
      normal: 5,
      hard: 6,
      ninja: 7
    };
    const maxCap = maxCaps[this.difficultyKey] || 5;
    
    const minEnemies = Math.min(baseMin + levelBonus, maxCap - 1);
    const maxEnemies = Math.min(baseMax + levelBonus, maxCap);
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
    // In classic Lode Runner, the exit ladder is hidden until all gold is collected.
    // The exit ladder extends from the top of an existing ladder to row 0.
    // IMPORTANT: No ladder should visibly reach row 0-3 at level start.
    
    const EXIT_HIDDEN_ROWS = 4; // Rows 0-3 are always hidden initially
    
    // First, clear any ladders that might have been placed in the top rows
    // (they should all be hidden exit ladders)
    for (let y = 0; y < EXIT_HIDDEN_ROWS; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getTile(x, y) === TileType.LADDER) {
          map.setTile(x, y, TileType.EMPTY);
        }
      }
    }
    
    // Find existing ladders that reach the upper area (row 4-6, just below hidden zone)
    // Only consider positions where the exit path (rows 0-3) is clear of poles/obstacles
    const exitCandidates: { x: number; topY: number }[] = [];
    for (let x = 2; x < map.width - 2; x++) {
      // Check if exit path is clear (no poles or solid blocks in rows 0-3)
      let pathClear = true;
      for (let y = 0; y < EXIT_HIDDEN_ROWS; y++) {
        const tile = map.getTile(x, y);
        if (tile === TileType.POLE || tile === TileType.BRICK || 
            tile === TileType.BRICK_HARD || tile === TileType.BRICK_TRAP) {
          pathClear = false;
          break;
        }
      }
      if (!pathClear) continue;
      
      // Find the topmost ladder segment at this x
      for (let y = EXIT_HIDDEN_ROWS; y < EXIT_HIDDEN_ROWS + 3; y++) {
        if (map.getTile(x, y) === TileType.LADDER) {
          exitCandidates.push({ x, topY: y });
          break;
        }
      }
    }
    
    // Sort by topmost (lowest Y) and pick one
    exitCandidates.sort((a, b) => a.topY - b.topY);
    
    let exitX: number;
    
    if (exitCandidates.length > 0) {
      // Pick from top candidates with randomness
      const candidateCount = Math.min(3, exitCandidates.length);
      const pickIdx = this.rng.range(0, candidateCount);
      exitX = exitCandidates[pickIdx].x;
    } else {
      // No suitable ladder found - use spine position or center
      exitX = Math.floor(map.width / 2);
      // Make sure there's a ladder leading up to the exit zone
      for (let y = EXIT_HIDDEN_ROWS; y < EXIT_HIDDEN_ROWS + 4; y++) {
        if (map.getTile(exitX, y) !== TileType.LADDER) {
          map.setTile(exitX, y, TileType.LADDER);
        }
      }
    }
    
    // Create hidden exit ladder from row 0 to row 3 (the hidden zone)
    for (let y = 0; y < EXIT_HIDDEN_ROWS; y++) {
      map.exitLadders.push({ x: exitX, y });
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
    // Add visible ladder leading up to row 4 (NOT to top - exit is hidden)
    for (let y = 4; y < 6; y++) {
      map.setTile(20, y, TileType.LADDER);
    }
    // Hidden exit ladder from row 0-3 (revealed when all gold collected)
    for (let y = 0; y < 4; y++) {
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
