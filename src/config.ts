// Game Configuration
export const CONFIG = {
  // Grid dimensions (original Lode Runner)
  GRID_WIDTH: 28,
  GRID_HEIGHT: 16,
  
  // Tile size in pixels
  TILE_SIZE: 24,
  
  // Calculated game dimensions
  get GAME_WIDTH() { return this.GRID_WIDTH * this.TILE_SIZE; }, // 672
  get GAME_HEIGHT() { return (this.GRID_HEIGHT + 2) * this.TILE_SIZE; }, // 432 (extra rows for HUD)
  
  // Viewport (16:9 with letterboxing)
  VIEWPORT_WIDTH: 896,
  VIEWPORT_HEIGHT: 504,
  
  // Speed settings
  BASE_SPEED: 150, // pixels per second
  FALL_SPEED: 200,
  SPEED_MULTIPLIERS: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
  DEFAULT_SPEED_INDEX: 2,
  
  // Timing
  HOLE_DURATION: 600, // frames until hole refills (~10 seconds at 60fps)
  HOLE_WARNING: 120,  // frames before refill to show warning
  DIG_DURATION: 12,   // frames to dig
  
  // Enemies
  MAX_ENEMIES: 5,
  ENEMY_SPAWN_DELAY: 180, // frames after death
  
  // Colors (Cyber Blue theme - default)
  COLORS: {
    BACKGROUND: 0x0a0a1a,
    BRICK: 0x2a1a4a,
    BRICK_HARD: 0x1a1a3a,
    LADDER: 0x00ffff,
    POLE: 0x666699,
    GOLD: 0xff00ff,
    PLAYER: 0x00ff88,
    ENEMY: 0xff3333,
    EMPTY: 0x0a0a1a,
    HUD_TEXT: 0x00ffff,
    HUD_BG: 0x0a0a2a,
  }
};

// Tile types matching original
export enum TileType {
  EMPTY = 0,
  BRICK = 1,
  BRICK_HARD = 2,
  LADDER = 3,
  POLE = 4,
  BRICK_TRAP = 5,
  LADDER_EXIT = 6,
  GOLD = 7,
  ENEMY = 8,
  PLAYER = 9,
  HOLE = 10, // Runtime only - dug brick
}

// Difficulty settings
export interface DifficultySettings {
  name: string;
  lives: number;              // starting lives
  enemies: [number, number];  // min, max
  gold: [number, number];
  ladderDensity: number;      // 0-1
  trapBrickChance: number;    // 0-1
  enemySpeed: number;         // multiplier
  holeTime: number;           // multiplier for hole duration
}

export const DIFFICULTIES: Record<string, DifficultySettings> = {
  easy: {
    name: 'EASY',
    lives: 5,
    enemies: [1, 2],
    gold: [5, 8],
    ladderDensity: 0.7,
    trapBrickChance: 0.05,
    enemySpeed: 0.7,
    holeTime: 1.3,
  },
  normal: {
    name: 'NORMAL',
    lives: 7,
    enemies: [2, 3],
    gold: [8, 12],
    ladderDensity: 0.5,
    trapBrickChance: 0.1,
    enemySpeed: 1.0,
    holeTime: 1.0,
  },
  hard: {
    name: 'HARD',
    lives: 9,
    enemies: [3, 4],
    gold: [12, 16],
    ladderDensity: 0.35,
    trapBrickChance: 0.15,
    enemySpeed: 1.2,
    holeTime: 0.8,
  },
  ninja: {
    name: 'NINJA',
    lives: 11,
    enemies: [4, 5],
    gold: [16, 20],
    ladderDensity: 0.25,
    trapBrickChance: 0.2,
    enemySpeed: 1.4,
    holeTime: 0.6,
  },
};

// Themes
export interface Theme {
  name: string;
  background: number;
  brick: number;
  brickHard: number;
  ladder: number;
  pole: number;
  gold: number;
  player: number;
  enemy: number;
  hudText: number;
  hudBg: number;
  glow?: boolean;
  scanlines?: boolean;
}

export const THEMES: Record<string, Theme> = {
  cyber: {
    name: 'CYBER BLUE',
    background: 0x0a0a1a,
    brick: 0x2a3a6a,
    brickHard: 0x1a2a4a,
    ladder: 0x00ffff,
    pole: 0x6666aa,
    gold: 0xff00ff,
    player: 0x00ff88,
    enemy: 0xff3344,
    hudText: 0x00ffff,
    hudBg: 0x0a0a2a,
    glow: true,
  },
  matrix: {
    name: 'MATRIX',
    background: 0x000a00,
    brick: 0x003300,
    brickHard: 0x001a00,
    ladder: 0x00ff00,
    pole: 0x006600,
    gold: 0x88ff88,
    player: 0xffffff,
    enemy: 0x00aa00,
    hudText: 0x00ff00,
    hudBg: 0x001100,
    glow: true,
    scanlines: true,
  },
  sunset: {
    name: 'SUNSET CHROME',
    background: 0x1a0a2a,
    brick: 0x4a2a3a,
    brickHard: 0x2a1a2a,
    ladder: 0xff8844,
    pole: 0xaa6633,
    gold: 0xffff00,
    player: 0xcccccc,
    enemy: 0xff4444,
    hudText: 0xff8844,
    hudBg: 0x1a0a1a,
    glow: true,
  },
  neon: {
    name: 'NEON NOIR',
    background: 0x000000,
    brick: 0x1a1a1a,
    brickHard: 0x0a0a0a,
    ladder: 0x00ffff,
    pole: 0x333333,
    gold: 0xff0088,
    player: 0xffffff,
    enemy: 0xff0044,
    hudText: 0xff0088,
    hudBg: 0x0a0a0a,
    glow: true,
  },
  classic: {
    name: 'CLASSIC C64',
    background: 0x352879,
    brick: 0x6c5eb5,
    brickHard: 0x505050,
    ladder: 0x7abfc7,
    pole: 0x808080,
    gold: 0xbfce72,
    player: 0xffffff,
    enemy: 0x68372b,
    hudText: 0x7abfc7,
    hudBg: 0x352879,
  },
};
