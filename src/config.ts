// Game Configuration
export const CONFIG = {
  // Grid dimensions (original Lode Runner)
  GRID_WIDTH: 28,
  GRID_HEIGHT: 16,
  
  // Tile size in pixels (logical). Field 28x16 @32 = 896x512.
  TILE_SIZE: 32,

  // Base render resolution: 960x540 (16:9) -> exact 2x for 1080p, 4x for 4K.
  GAME_WIDTH: 960,
  GAME_HEIGHT: 540,
  HUD_HEIGHT: 28,

  // Viewport (16:9 with letterboxing)
  VIEWPORT_WIDTH: 960,
  VIEWPORT_HEIGHT: 540,

  // Speed settings
  BASE_SPEED: 100, // pixels per second (reduced for better gameplay)
  FALL_SPEED: 140,
  SPEED_MULTIPLIERS: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
  DEFAULT_SPEED_INDEX: 2,
  
  // Timing - all values in MILLISECONDS for frame-rate independence
  HOLE_DURATION_MS: 5000,       // 5 seconds for hole to refill
  HOLE_WARNING_MS: 1000,        // warning flash starts 1 sec before refill
  
  // Enemy escape timing - enemy can escape if they fell in early enough
  // Enemy trapped time MUST be less than hole duration for escape to work!
  ENEMY_IN_HOLE_MS: 3500,       // enemy trapped for 3.5 sec (1.5 sec less than hole)
  ENEMY_SHAKE_MS: 800,          // start shaking with 0.8 sec left on their timer
  ENEMY_ESCAPE_MS: 400,         // climb out with 0.4 sec left on their timer
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
  complexity: number;         // 0-1, structural complexity (platforms, segments)
  ladderDensity: number;      // 0-1, how many easy ladders/connections
  trapBrickChance: number;    // 0-1
  enemySpeed: number;         // multiplier
  holeTime: number;           // multiplier for hole duration
  /** chance of a LAST-GOLD SECTION: a drop-in room you can't leave until its hidden ladder appears (originals ~7%) */
  lastSection: number;
}

export const DIFFICULTIES: Record<string, DifficultySettings> = {
  easy: {
    name: 'EASY',
    lives: 5,
    enemies: [1, 2],
    gold: [5, 8],
    complexity: 0.4,          // simpler levels
    ladderDensity: 0.8,       // lots of easy ladders
    trapBrickChance: 0.05,
    enemySpeed: 0.7,
    holeTime: 1.3,
    lastSection: 0.05,
  },
  // v2 tuning: NORMAL sits midway between the old EASY and old NORMAL, HARD is roughly the old NORMAL
  // (a notch above), NINJA midway between the old HARD and old NINJA.
  normal: {
    name: 'NORMAL',
    lives: 7,
    enemies: [1, 3],
    gold: [6, 10],
    complexity: 0.5,
    ladderDensity: 0.65,
    trapBrickChance: 0.075,
    enemySpeed: 0.85,
    holeTime: 1.15,
    lastSection: 0.08,
  },
  hard: {
    name: 'HARD',
    lives: 9,
    enemies: [2, 3],
    gold: [9, 13],
    complexity: 0.65,
    ladderDensity: 0.47,
    trapBrickChance: 0.11,
    enemySpeed: 1.05,
    holeTime: 0.95,
    lastSection: 0.12,
  },
  ninja: {
    name: 'NINJA',
    lives: 11,
    enemies: [3, 5],
    gold: [14, 18],
    complexity: 0.9,
    ladderDensity: 0.3,
    trapBrickChance: 0.175,
    enemySpeed: 1.3,
    holeTime: 0.7,
    lastSection: 0.17,
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
  /** escape (hidden) ladder colour; default = ladder alloyed with gold */
  exitLadder?: number;
  glow?: boolean;
  scanlines?: boolean;
  /** stable id (= THEMES key; filled in below) — used for texture cache keys and backdrops */
  id?: string;
  /** tile construction style: neon circuit bricks (default), dungeon stone, palace sandstone/marble, foundry steel */
  material?: 'circuit' | 'stone' | 'palace' | 'metal';
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
  dungeon: {
    name: 'DUNGEON DEPTHS',
    background: 0x0b090c,
    brick: 0x6a5444,
    brickHard: 0x4a4e5a,
    ladder: 0xa8743c,
    exitLadder: 0xe8c050,
    pole: 0xb4b4c4,
    gold: 0xffcc33,
    player: 0x66e0ff,
    enemy: 0xff4433,
    hudText: 0xffaa55,
    hudBg: 0x140e0c,
    glow: true,
    material: 'stone',
  },
  palace: {
    name: 'ANCIENT PALACE',
    background: 0x170f08,
    brick: 0x9a7a4e,
    brickHard: 0xcfc6b4,
    ladder: 0xb07a3a,
    exitLadder: 0x40e0d0,
    pole: 0xd4a040,
    gold: 0xfff060,
    player: 0x40ffb0,
    enemy: 0xe83060,
    hudText: 0xf0c060,
    hudBg: 0x1a1208,
    glow: true,
    material: 'palace',
  },
  foundry: {
    name: 'ORBITAL FOUNDRY',
    background: 0x05070c,
    brick: 0x56606e,
    brickHard: 0x3a3c44,
    ladder: 0xffaa22,
    exitLadder: 0xfff0a0,
    pole: 0x9aa4b0,
    gold: 0x55ffdd,
    player: 0xa8ff44,
    enemy: 0xff3344,
    hudText: 0xffaa22,
    hudBg: 0x0a0c12,
    glow: true,
    material: 'metal',
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
    exitLadder: 0x9a8cff,  // cyan+pink alloy reads as dull steel here; neon violet instead
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
for (const [k, t] of Object.entries(THEMES)) t.id = k;
