import { CONFIG, TileType } from '../config';

export interface Hole {
  x: number;
  y: number;
  timer: number;
  originalTile: TileType;
}

export class TileMap {
  public width: number;
  public height: number;
  public tiles: TileType[][];
  public holes: Hole[] = [];
  public playerStart: { x: number; y: number } = { x: 0, y: 0 };
  public enemyStarts: { x: number; y: number }[] = [];
  public goldPositions: { x: number; y: number }[] = [];
  public exitLadders: { x: number; y: number }[] = [];
  public holeDurationMultiplier: number = 1.0; // Set by difficulty
  
  constructor(width = CONFIG.GRID_WIDTH, height = CONFIG.GRID_HEIGHT) {
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.clear();
  }
  
  clear(): void {
    this.tiles = [];
    for (let y = 0; y < this.height; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.tiles[y][x] = TileType.EMPTY;
      }
    }
    this.holes = [];
    this.goldPositions = [];
    this.enemyStarts = [];
    this.exitLadders = [];
  }
  
  getTile(x: number, y: number): TileType {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return TileType.BRICK_HARD; // Out of bounds = solid
    }
    return this.tiles[y][x];
  }
  
  setTile(x: number, y: number, type: TileType): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.tiles[y][x] = type;
    }
  }
  
  // Check if position is solid (blocks movement)
  isSolid(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    return tile === TileType.BRICK || 
           tile === TileType.BRICK_HARD || 
           tile === TileType.BRICK_TRAP;
  }
  
  // Check if position can be stood on
  isSupport(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    return tile === TileType.BRICK || 
           tile === TileType.BRICK_HARD || 
           tile === TileType.LADDER ||
           tile === TileType.LADDER_EXIT;
  }
  
  // Check if position allows climbing
  isClimbable(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    return tile === TileType.LADDER || tile === TileType.LADDER_EXIT;
  }
  
  // Check if position allows horizontal bar traverse
  isBar(x: number, y: number): boolean {
    return this.getTile(x, y) === TileType.POLE;
  }
  
  // Check if can dig at position
  canDig(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    return tile === TileType.BRICK || tile === TileType.BRICK_TRAP;
  }
  
  // Create a hole (dug brick)
  digHole(x: number, y: number): boolean {
    if (!this.canDig(x, y)) return false;
    
    const originalTile = this.getTile(x, y);
    this.setTile(x, y, TileType.HOLE);
    // Apply difficulty multiplier to hole duration
    const duration = Math.floor(CONFIG.HOLE_DURATION * this.holeDurationMultiplier);
    this.holes.push({
      x, y,
      timer: duration,
      originalTile
    });
    return true;
  }
  
  // Update holes (call each frame)
  updateHoles(): { filled: Hole[], warning: Hole[] } {
    const filled: Hole[] = [];
    const warning: Hole[] = [];
    
    this.holes = this.holes.filter(hole => {
      hole.timer--;
      
      if (hole.timer <= CONFIG.HOLE_WARNING && hole.timer > 0) {
        warning.push(hole);
      }
      
      if (hole.timer <= 0) {
        this.setTile(hole.x, hole.y, hole.originalTile);
        filled.push(hole);
        return false;
      }
      return true;
    });
    
    return { filled, warning };
  }
  
  // Check if entity would fall at position
  wouldFall(x: number, y: number): boolean {
    // On ladder = no fall
    if (this.isClimbable(x, y)) return false;
    // On bar = no fall
    if (this.isBar(x, y)) return false;
    // Check below
    const below = y + 1;
    if (below >= this.height) return false; // Bottom of level
    // Something solid below = no fall
    if (this.isSupport(x, below)) return false;
    // Hole or empty below = fall
    return true;
  }
  
  // Clone the tilemap
  clone(): TileMap {
    const copy = new TileMap(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        copy.tiles[y][x] = this.tiles[y][x];
      }
    }
    copy.playerStart = { ...this.playerStart };
    copy.enemyStarts = this.enemyStarts.map(e => ({ ...e }));
    copy.goldPositions = this.goldPositions.map(g => ({ ...g }));
    copy.exitLadders = this.exitLadders.map(l => ({ ...l }));
    return copy;
  }
}
