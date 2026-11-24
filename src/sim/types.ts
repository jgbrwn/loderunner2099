// Pure simulation types (no Phaser). Positions: cell (cx,cy) + sub-tile offset (ox,oy) in units.
export const SUB = 24;           // units per tile (== pixels at 24px tiles)
export const HALF = 12;
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

// Speeds in milli-units per tick (1000 = 1 unit/tick)
export const RUN_SPEED = 1667;   // 100 px/s
export const FALL_SPEED = 2333;  // 140 px/s
export const GUARD_SPEED_FACTOR = 0.8;
export const DIG_TICKS = 13;
export const HOLE_TICKS = 300;   // 5 s, scaled by difficulty holeTime
export const HOLE_WARN_TICKS = 60;
export const GUARD_RESPAWN_TICKS = 120;
export const GUARD_SPAWN_ANIM_TICKS = 30;
export const PLAYER_RESPAWN_TICKS = 120;

export const SCORE = { GOLD: 250, TRAP: 75, GUARD_DEATH: 75, LEVEL: 1500 } as const;

/** Per-player input for one tick. Dig is edge-triggered inside the sim. */
export interface SimInput {
  left: boolean; right: boolean; up: boolean; down: boolean;
  digLeft: boolean; digRight: boolean;
}
export const NO_INPUT: SimInput = { left: false, right: false, up: false, down: false, digLeft: false, digRight: false };

export type Dir = 'L' | 'R' | 'U' | 'D' | null;

export type ActorMode = 'idle' | 'run' | 'climb' | 'hang' | 'fall' | 'dig' | 'dead'
  | 'trapped' | 'escape' | 'spawning';

export interface Actor {
  id: number;
  cx: number; cy: number; ox: number; oy: number;
  mode: ActorMode;
  facing: -1 | 1;
  acc: number;
}

export interface SimPlayer extends Actor {
  alive: boolean;
  startX: number; startY: number;
  digTicks: number; digX: number; digY: number;
  prevDigL: boolean; prevDigR: boolean;
  vertBuf: Dir; vertBufTicks: number;
  prevVert: Dir;
  respawnTicks: number;
  score: number;   // score earned this level
}

export interface SimGuard extends Actor {
  dir: Dir;
  carry: number;        // gold id or -1
  carryTimer: number;   // cells to walk before dropping
  carryAge: number;     // ticks carrying an assisted gold (forced drop after ASSIST_MAX_CARRY_TICKS)
  trapTicks: number;
  holeX: number; holeY: number;  // hole being escaped (-1 none)
  escapeTicks: number;
  spawnTicks: number;
  noPickX: number; noPickY: number;
}

export interface SimGold {
  id: number; x: number; y: number;
  assisted: boolean;
  spawnX?: number;     // column a fetching guard respawns into (guard-corridor chimney)
  carriedBy: number;   // guard id, -1 if on floor
  collected: boolean;
}

export interface SimHole {
  x: number; y: number;
  ticks: number; total: number;
  by: number;          // player id that dug it
}

export type SimEvent =
  | { t: 'digStart'; p: number; x: number; y: number; ticks: number }
  | { t: 'digAbort'; p: number; x: number; y: number }
  | { t: 'holeOpen'; x: number; y: number }
  | { t: 'holeFill'; x: number; y: number }
  | { t: 'gold'; p: number; x: number; y: number }
  | { t: 'guardGold'; g: number; x: number; y: number }
  | { t: 'goldDrop'; g: number; x: number; y: number }
  | { t: 'trap'; g: number; x: number; y: number }
  | { t: 'guardDeath'; g: number; x: number; y: number }
  | { t: 'guardSpawn'; g: number; x: number; y: number }
  | { t: 'playerDeath'; p: number; x: number; y: number }
  | { t: 'playerSpawn'; p: number }
  | { t: 'fall'; p: number }
  | { t: 'land'; p: number }
  | { t: 'step'; p: number; climb: boolean }
  | { t: 'score'; p: number; amount: number }
  | { t: 'exitReveal' }
  | { t: 'complete'; p: number }
  | { t: 'failed' };

export type SimStatus = 'playing' | 'complete' | 'failed';

export interface SimOptions {
  seed: string | number;
  players?: number;       // 1 or 2 (co-op on one board)
  enemySpeed?: number;    // difficulty multiplier
  holeTime?: number;      // difficulty multiplier
}
