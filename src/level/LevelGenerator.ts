import { TileType, DIFFICULTIES, DifficultySettings } from '../config';
import { SeededRandom } from '../utils/SeededRandom';
import { TileMap } from './TileMap';
import { SolvabilityResult, analyzeLevel, maxEnemyAssistedGold, MoveGraph } from './SolvabilityChecker';

/**
 * Level generator v2: constructive layout from classic idioms (brick floors with gaps, ladders
 * flush with floors, gap/hanging poles, dig-in vaults, trap bricks, sky ledges for
 * enemy-assisted gold), a connectivity repair pass driven by the solver's SCCs, then
 * best-of-N selection by a deterministic fun score. Everything derives from the seed.
 */

export interface GeneratedLevel {
  map: TileMap;
  enemyAssistedGoldPositions: { x: number; y: number }[];
  stats?: LevelStats;
}

export interface LevelStats {
  attempts: number;
  valid: number;
  fallback: 0 | 1 | 2; // 0 = normal, 1 = simplified retry, 2 = fixed layout
  score: number;
  gold: number;
  assisted: number;
  digRequiredGold: number;
  tourLength: number;
  deathTrapHoles: number;
  oneWayCells: number;
  ladders: number;
  enemies: number;
}

export const GENERATOR_VERSION = 2;
const T = TileType;
type P = { x: number; y: number };

interface Params { c: number; ld: number; trap: number; assisted: number; }

export class LevelGenerator {
  private rng: SeededRandom;
  private difficulty: DifficultySettings;
  private levelNumber: number;
  private difficultyKey: string;
  private lastResult: SolvabilityResult | null = null;
  public lastStats: LevelStats | null = null;
  public lastArch = '';

  constructor(seed: string | number, difficultyKey: string = 'normal', levelNumber: number = 1) {
    this.rng = new SeededRandom(seed);
    this.difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    this.levelNumber = levelNumber;
    this.difficultyKey = DIFFICULTIES[difficultyKey] ? difficultyKey : 'normal';
  }

  getEnemyAssistedGoldPositions(): P[] {
    return this.lastResult?.enemyAssistedPositions || [];
  }

  generateWithInfo(candidates = 6): GeneratedLevel {
    const map = this.generate(candidates);
    return { map, enemyAssistedGoldPositions: map.enemyAssistedGoldPositions, stats: this.lastStats ?? undefined };
  }

  /** `candidates` = number of valid candidates to compare (best-of-N). */
  generate(candidates = 6): TileMap {
    if (candidates > 50) candidates = 6; // old API passed maxAttempts=500
    const d = this.difficulty, L = this.levelNumber - 1;
    const maxA = maxEnemyAssistedGold(this.difficultyKey);
    const params: Params = {
      c: Math.min(1, d.complexity + L * 0.015),
      ld: Math.max(0.15, d.ladderDensity - L * 0.01),
      trap: d.trapBrickChance,
      assisted: maxA,
    };
    let best: { map: TileMap; res: SolvabilityResult; score: number } | null = null;
    let attempts = 0, valid = 0;
    for (; attempts < 60 && valid < candidates; attempts++) {
      const want = this.rng.chance(0.25 + 0.25 * maxA) ? this.rng.range(1, maxA + 1) : 0;
      const r = this.candidate({ ...params, assisted: maxA ? want : 0 });
      if (!r) continue;
      valid++;
      const s = this.funScore(r.map, r.res, want);
      if (!best || s > best.score) best = { ...r, score: s };
    }
    let fallback: 0 | 1 | 2 = 0;
    if (!best) {
      fallback = 1;
      for (let i = 0; i < 40 && !best; i++, attempts++) {
        const r = this.candidate({ c: 0.2, ld: 1, trap: 0, assisted: 0 });
        if (r) best = { ...r, score: 0 };
      }
    }
    if (!best) {
      fallback = 2;
      const map = this.fixedFallback();
      best = { map, res: analyzeLevel(map, [], 0), score: 0 };
    }
    const { map, res } = best;
    this.lastResult = res;
    const a = res.analysis!;
    let ladders = 0;
    for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) {
      if (map.tiles[y][x] === T.LADDER && (y === 0 || map.tiles[y - 1][x] !== T.LADDER)) ladders++;
    }
    this.lastStats = {
      attempts, valid, fallback, score: best.score, gold: map.goldPositions.length,
      assisted: res.enemyAssistedGold, digRequiredGold: a.digRequiredGold, tourLength: a.tourLength,
      deathTrapHoles: a.deathTrapHoles, oneWayCells: a.oneWayCells, ladders, enemies: map.enemyStarts.length,
    };
    return map;
  }

  private funScore(map: TileMap, res: SolvabilityResult, wantAssisted: number): number {
    const a = res.analysis!;
    const rows = new Set(map.goldPositions.map(g => g.y)).size;
    return a.tourLength * 0.6 + a.digRequiredGold * 8 + rows * 4 + Math.min(wantAssisted, res.enemyAssistedGold) * 6
      + Math.min(a.mainSize, 200) * 0.05 - a.oneWayCells * 0.4 - a.deathTrapHoles * 0.1 + this.rng.next();
  }

  // ---------------------------------------------------------------- candidate

  private candidate(p: Params): { map: TileMap; res: SolvabilityResult } | null {
    const rng = this.rng, m = new TileMap(), W = m.width, H = m.height;
    const get = (x: number, y: number) => m.getTile(x, y);
    const set = (x: number, y: number, t: TileType) => m.setTile(x, y, t);
    const isBrick = (x: number, y: number) => { const t = get(x, y); return t === T.BRICK || t === T.BRICK_HARD; };
    const reserved = new Uint8Array(W); // columns where repair ladders are forbidden (vaults)

    // ground
    for (let x = 0; x < W; x++) set(x, H - 1, T.BRICK);
    for (let k = rng.range(0, 3); k > 0; k--) {
      const len = rng.range(2, 6), x0 = rng.range(0, W - len);
      for (let x = x0; x < x0 + len; x++) set(x, H - 1, T.BRICK_HARD);
    }

    // floors: layout archetype chosen per seed (difficulty-weighted), produced as brick segments
    const minTop = p.assisted ? 6 : 4;
    type Seg = { y: number; x0: number; x1: number };
    const segs: Seg[] = [];
    const sp = () => rng.pick(p.c > 0.7 ? [2, 3, 3, 3, 4] : [3, 3, 3, 4, 4]);
    const stack = (yStart: number, f: (y: number, i: number) => void) => {
      for (let y = yStart, i = 0; ; i++) {
        let next = y - sp();
        if (next < minTop) { if (y - minTop >= 3) next = minTop; else break; }
        f(next, i); y = next;
      }
    };
    const withGaps = (y: number, x0: number, x1: number, n: number) => {
      let a = x0;
      for (let k = 0; k < n; k++) {
        const gw = rng.pick([1, 1, 2, 2, 3, 4]), gx = rng.range(a + 3, x1 - 2 - gw);
        if (gx < a + 3) break;
        segs.push({ y, x0: a, x1: gx - 1 }); a = gx + gw;
      }
      segs.push({ y, x0: a, x1 });
    };
    const archetypes = ['classic', 'terraced', 'tower', 'islands', 'pyramid'];
    const weights = [3 - p.c * 2, 1 + p.c * 2, 2, p.c * 3, 2 - p.c];
    let roll = rng.next() * weights.reduce((s, w) => s + w, 0), arch = 'classic';
    for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll < 0) { arch = archetypes[i]; break; } }
    this.lastArch = arch;
    let towerCols: number[] = [];
    if (arch === 'classic') {
      stack(H - 1, y => {
        const x0 = rng.chance(0.5) ? 0 : rng.range(1, 4), x1 = rng.chance(0.5) ? W - 1 : W - 1 - rng.range(1, 4);
        withGaps(y, x0, x1, rng.range(1, 2 + Math.round(p.c * 2)));
      });
    } else if (arch === 'terraced') {
      const nb = rng.range(2, 4), cuts = [0];
      for (let b = 1; b < nb; b++) cuts.push(Math.round((W * b) / nb) + rng.range(-2, 3));
      cuts.push(W);
      for (let b = 0; b < nb; b++) {
        const x0 = cuts[b] + (b && rng.chance(0.4) ? 1 : 0), x1 = cuts[b + 1] - 1;
        stack(H - 1 - rng.range(0, 2), y => withGaps(y, x0, x1, rng.chance(0.3) ? 1 : 0));
      }
    } else if (arch === 'tower') {
      towerCols = p.c > 0.6 && rng.chance(0.6) ? [rng.range(7, 11), rng.range(17, 21)] : [rng.range(9, 19)];
      const bounds = [-1, ...towerCols, W];
      for (let b = 0; b + 1 < bounds.length; b++) {
        const x0 = bounds[b] + 1, x1 = bounds[b + 1] - 1;
        if (x1 - x0 < 2) continue;
        stack(H - 1 - rng.range(0, 2), y => {
          const s0 = b === 0 && rng.chance(0.4) ? x0 + rng.range(1, 4) : x0;
          const s1 = b === bounds.length - 2 && rng.chance(0.4) ? x1 - rng.range(1, 4) : x1;
          withGaps(y, s0, s1, rng.chance(0.4) ? 1 : 0);
        });
      }
    } else if (arch === 'islands') {
      stack(H - 1, y => {
        for (let x = rng.range(0, 3); x < W - 2;) {
          const len = rng.range(3, 9), yy = Math.max(minTop, Math.min(H - 3, y + rng.range(-1, 2)));
          segs.push({ y: yy, x0: x, x1: Math.min(W - 1, x + len - 1) });
          x += len + rng.range(2, 5);
        }
      });
    } else {
      const inverted = rng.chance(0.35), cx = rng.range(11, 17);
      const rows: number[] = [];
      stack(H - 1, y => rows.push(y));
      rows.forEach((y, i) => {
        const k = inverted ? rows.length - 1 - i : i;
        const half = Math.max(3, 13 - k * rng.range(2, 4));
        withGaps(y, Math.max(0, cx - half), Math.min(W - 1, cx + half), rng.chance(0.4) ? 1 : 0);
        if (!inverted && rng.chance(0.5)) { // side ledges
          const side = rng.chance(0.5), len = rng.range(3, 6);
          const a = side ? 0 : W - len, yy = y - 1;
          if (side ? cx - half > len + 2 : cx + half < W - len - 2) segs.push({ y: yy, x0: a, x1: a + len - 1 });
        }
      });
    }
    const rowsUsed = [...new Set(segs.map(s => s.y))].sort((a, b) => b - a);
    for (const s of segs) {
      for (let x = s.x0; x <= s.x1; x++) set(x, s.y, T.BRICK);
      if (s.x1 - s.x0 >= 5 && rng.chance(0.15 + 0.25 * p.c)) {
        const len = rng.range(2, 5), hx = rng.range(s.x0, s.x1 - len + 2);
        for (let x = hx; x < hx + len && x <= s.x1; x++) set(x, s.y, T.BRICK_HARD);
      }
    }
    const floors = rowsUsed;
    const top = floors.length ? floors[floors.length - 1] : H - 1;

    // ladders: from segments down to support (flush with the segment); repair pass adds more
    const ladderCols: number[] = [];
    const placeLadder = (x: number, y0: number) => {
      set(x, y0, T.LADDER);
      for (let y = y0 + 1; y < H && !isBrick(x, y) && get(x, y) !== T.BRICK_TRAP; y++) set(x, y, T.LADDER);
      ladderCols.push(x);
    };
    for (const tc of towerCols) placeLadder(tc, top);
    const levels = [H - 1, ...floors];
    const segOrder = rng.shuffle(segs.slice());
    for (const s of segOrder) {
      const wide = s.x1 - s.x0 + 1;
      let k = (rng.chance(0.55 + p.ld * 0.4) ? 1 : 0) + (wide >= 14 && rng.chance(p.ld * 0.7) ? 1 : 0);
      for (let tries = 0; tries < 12 && k > 0; tries++) {
        const x = rng.range(Math.max(1, s.x0), Math.min(W - 1, s.x1 + 1));
        if (get(x, s.y - 1) !== T.EMPTY || get(x, s.y) !== T.BRICK) continue;
        let near = false;
        for (let y = s.y - 1; y < Math.min(H, s.y + 4); y++) for (let dx = -2; dx <= 2; dx++) if (get(x + dx, y) === T.LADDER) near = true;
        if (near) continue;
        placeLadder(x, s.y); k--;
      }
    }

    // poles across same-row gaps between segments (at standing height)
    const gapsByFloor = new Map<number, [number, number][]>();
    for (const y of rowsUsed) {
      const row = segs.filter(s => s.y === y).sort((a, b) => a.x0 - b.x0);
      const gaps: [number, number][] = [];
      for (let i = 1; i < row.length; i++) if (row[i].x0 - row[i - 1].x1 - 1 <= 7) gaps.push([row[i - 1].x1 + 1, row[i].x0 - 1]);
      gapsByFloor.set(y, gaps);
    }

    const poleIslandCells: P[] = [];   // gold sitting on a pole over open air (hang to collect)
    const escapeCells: P[] = [];       // gold in a dig-out alcove (timed escape)
    // poles across gaps (at standing height)
    for (const [fy, gaps] of gapsByFloor) for (const [a, b] of gaps) {
      if (b - a >= 1 && rng.chance(0.4)) {
        let ok = true;
        for (let x = a; x <= b; x++) if (get(x, fy - 1) !== T.EMPTY) ok = false;
        if (ok) for (let x = a; x <= b; x++) set(x, fy - 1, T.POLE);
      }
    }
    // hanging poles off ladders
    for (let k = rng.range(0, 2 + Math.round(p.c * 2)); k > 0; k--) {
      const lx = rng.pick(ladderCols.length ? ladderCols : [0]);
      const r = rng.range(top + 1, H - 2);
      if (get(lx, r) !== T.LADDER) continue;
      const dir = rng.chance(0.5) ? 1 : -1, len = rng.range(3, 9);
      const cells: P[] = [];
      for (let s = 1; s <= len; s++) {
        const x = lx + dir * s;
        if (get(x, r) !== T.EMPTY || get(x, r + 1) !== T.EMPTY || get(x, r - 1) === T.LADDER) break;
        cells.push({ x, y: r });
      }
      if (cells.length >= 3) for (const c of cells) set(c.x, c.y, T.POLE);
      // POLE-ISLAND GOLD: gold on the bar, open air below — collect by hanging across, not standing.
      if (cells.length >= 4 && rng.chance(0.3 + 0.3 * p.c)) {
        const c = cells[rng.range(1, cells.length - 1)];
        if (get(c.x, c.y + 1) === T.EMPTY && get(c.x, c.y + 2) === T.EMPTY) poleIslandCells.push({ x: c.x, y: c.y });
      }
    }

    // vaults: hard walls, diggable brick ceiling & floor, gold inside (dig in, dig out)
    const vaultCells: P[] = [];
    for (let k = (rng.chance(0.3 + 0.6 * p.c) ? 1 : 0) + (rng.chance(p.c - 0.5) ? 1 : 0); k > 0; k--) {
      if (levels.length < 4) break;
      const i = rng.range(2, levels.length);
      const yu = levels[i], yl = levels[i - 1];
      const w = rng.range(2, 5), a = rng.range(2, W - w - 2);
      let ok = yl < H - 1;
      for (let x = a - 1; ok && x <= a + w; x++) {
        if (!isBrick(x, yu) || get(x, yl) !== T.BRICK || get(x, yu - 1) !== T.EMPTY || reserved[x]) ok = false;
        for (let y = yu + 1; ok && y < yl; y++) if (get(x, y) !== T.EMPTY) ok = false;
      }
      if (!ok) continue;
      for (let y = yu; y <= yl; y++) { set(a - 1, y, T.BRICK_HARD); set(a + w, y, T.BRICK_HARD); }
      for (let x = a; x < a + w; x++) { set(x, yu, T.BRICK); vaultCells.push({ x, y: yl - 1 }); }
      for (let x = a - 1; x <= a + w; x++) reserved[x] = 1;
    }

    // BURIED VAULT (classic multi-layer dig-down): a 1-wide hard-walled shaft with a diggable brick roof
    // of `depth` layers, gold at the bottom, and a ladder inside so the player can always climb out (never
    // a death trap). The player digs through the roof layers one at a time. Depth scales with difficulty and
    // level number (mirrors the original's deeper mines on later levels): 2-4 early/easy up to 5-13 deep on
    // hard/ninja at higher levels. A free-standing shaft is carved straight down through whatever is below,
    // so it does not depend on floor spacing.
    for (let k = rng.chance(0.22 + 0.3 * p.c) ? 1 : 0; k > 0; k--) {
      const lv = Math.min(this.levelNumber, 40);
      const maxDepth = Math.min(13, 3 + Math.round(p.c * 4) + Math.floor(lv / 4)); // easy~3-4, ninja up to 13
      const depth = rng.range(2, Math.max(3, maxDepth + 1));
      const x = rng.range(2, W - 2);
      const yTop = rng.range(2, Math.max(3, H - depth - 3)); // roof row; room below for the shaft
      const yBot = yTop + depth;                             // gold sits here (on yBot+1 floor)
      if (yBot + 1 >= H) continue;
      let ok = true;
      for (let dx = -1; dx <= 1 && ok; dx++) if (reserved[x + dx]) ok = false;
      // need empty space above the roof to stand & dig, and a floor to hold the gold
      if (get(x, yTop - 1) !== T.EMPTY || get(x, yTop) !== T.EMPTY) ok = false;
      if (!ok) continue;
      // roof row = diggable brick (the top of the shaft you dig first)
      set(x, yTop, T.BRICK);
      // interior diggable layers below the roof; hard side walls; internal ladder for escape
      for (let y = yTop + 1; y <= yBot; y++) {
        set(x - 1, y, T.LADDER);          // climbable left wall = guaranteed escape
        set(x + 1, y, T.BRICK_HARD);      // right hard wall
        if (y < yBot) set(x, y, T.BRICK); // diggable layers; bottom cell left empty for gold
        else set(x, y, T.EMPTY);
      }
      set(x, yBot + 1, T.BRICK);          // floor under the gold
      set(x - 1, yBot + 1, T.BRICK); set(x + 1, yBot + 1, T.BRICK_HARD);
      vaultCells.push({ x, y: yBot });
      for (let dx = -1; dx <= 1; dx++) reserved[x + dx] = 1;
    }

    // TIMED-ESCAPE ALCOVE: a 1-wide hard-walled nook holding gold, with a diggable brick floor as the only
    // way out. The player drops in (or digs in), grabs the gold, then digs the floor and drops out before the
    // entry hole refills — a classic single-dig timed escape. The floor below the alcove is open, so the drop
    // always lands on a real floor (never a death trap).
    for (let k = rng.chance(0.18 + 0.25 * p.c) ? 1 : 0; k > 0; k--) {
      const x = rng.range(2, W - 2);
      const y = rng.range(3, H - 4);
      let ok = true;
      for (let dx = -1; dx <= 1 && ok; dx++) if (reserved[x + dx]) ok = false;
      // nook cell + open below-below for a safe landing
      if (get(x, y) !== T.EMPTY || get(x, y + 2) !== T.EMPTY) ok = false;
      if (!isBrick(x, y + 3)) ok = false;              // landing floor two below the dig floor
      if (get(x - 1, y) !== T.EMPTY && get(x + 1, y) !== T.EMPTY) ok = false; // an open side to enter from
      if (!ok) continue;
      set(x - 1, y, T.BRICK_HARD); set(x + 1, y, T.BRICK_HARD);  // hard side walls (only floor exit)
      set(x, y + 1, T.BRICK);                                       // diggable floor = the escape
      escapeCells.push({ x, y });
      reserved[x - 1] = reserved[x] = reserved[x + 1] = 1;
    }

    // trap bricks over open space
    for (let k = (rng.chance(p.trap * 4) ? 1 : 0) + (rng.chance(p.trap * 2) ? 1 : 0); k > 0; k--) {
      for (let tries = 0; tries < 20; tries++) {
        const fy = rng.pick(floors.length ? floors : [H - 1]), x = rng.range(1, W - 1);
        if (fy === H - 1 || get(x, fy) !== T.BRICK || get(x, fy - 1) !== T.EMPTY || get(x, fy + 1) !== T.EMPTY || reserved[x]) continue;
        set(x, fy, T.BRICK_TRAP); break;
      }
    }

    // sky ledges for enemy-assisted gold
    const assisted: P[] = [];
    const corridorGold = new Set<string>();
    const ledges: P[][] = [];
    for (let k = p.assisted; k > 0; k--) {
      const ly = top - rng.range(2, 4), len = rng.range(3, 6), lx = rng.range(1, W - len - 1);
      if (ly < 2) continue;
      let ok = true;
      for (let x = lx - 2; x <= lx + len + 1; x++) for (let y = 0; y <= Math.min(ly + 2, top - 1); y++) if (get(x, y) !== T.EMPTY) ok = false;
      if (!ok) continue;
      const cells: P[] = [];
      for (let x = lx; x < lx + len; x++) { set(x, ly, T.BRICK_HARD); cells.push({ x, y: ly }); }
      ledges.push(cells);
      assisted.push({ x: lx + rng.range(0, len), y: ly - 1 });
    }

    // GUARD-CORRIDOR GOLD (distinct from sky-ledge assisted gold): a 1-tall, hard-roofed passage holding
    // gold. Guards walk straight through it (open both ends); the player would be cornered walking in, so
    // the intended play is to let a guard pick the gold up and carry it out to a safe drop cell. Reachable
    // by the player, but a "bait" layout. Guard delivery is verified separately (roofed, so walk-in not fall-in).
    const corridors: P[] = [];
    for (let k = rng.chance(0.3 + 0.3 * p.c) ? 1 : 0; k > 0; k--) {
      const y = rng.range(top + 2, H - 2), len = rng.range(4, 7), lx = rng.range(1, W - len - 1);
      let ok = true;
      for (let x = lx; x < lx + len && ok; x++) {
        if (get(x, y) !== T.EMPTY || get(x, y - 1) !== T.EMPTY) ok = false;   // passage + roof space empty
        if (!isBrick(x, y + 1)) ok = false;                                    // floor to walk on
        if (reserved[x]) ok = false;
      }
      // both ends must be open so guards walk through
      if (!isBrick(lx - 1, y + 1) || !isBrick(lx + len, y + 1)) ok = false;
      if (!ok) continue;
      for (let x = lx; x < lx + len; x++) set(x, y - 1, T.BRICK_HARD);        // hard roof (can't dig in)
      const gold = { x: lx + rng.range(1, len - 1), y };
      corridors.push(gold);
      assisted.push(gold);
      corridorGold.add(`${gold.x},${gold.y}`);
      m.corridorGoldPositions.push(gold);                                                     // mark as guard-assisted gold
      for (let x = lx; x < lx + len; x++) reserved[x] = 1;
    }

    // player start on the ground
    let sx = -1;
    for (let tries = 0; tries < 30 && sx < 0; tries++) {
      const x = rng.range(1, W - 1);
      if (get(x, H - 2) === T.EMPTY && isBrick(x, H - 1)) sx = x;
    }
    if (sx < 0) return null;
    m.playerStart = { x: sx, y: H - 2 };

    // connectivity repair: give every standing area outside the start SCC a ladder down
    const N = W * H, start = (H - 2) * W + sx;
    let g!: MoveGraph, comp!: Int32Array, reach!: Uint8Array;
    for (let iter = 0; ; iter++) {
      g = new MoveGraph(m, false);
      comp = g.scc(); reach = g.bfs([start]);
      if (iter >= 10) break;
      const main = comp[start];
      const bad: P[] = [];
      for (let y = top - 1; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
        if (comp[y * W + x] === main || get(x, y) !== T.EMPTY || get(x, y + 1) !== T.BRICK || reserved[x]) continue;
        if (assisted.some(q => q.y === y)) continue;
        let near = false;
        for (let dy = 0; dy < 4; dy++) for (const dx of [-1, 1]) if (get(x + dx, y + dy) === T.LADDER) near = true;
        if (near) continue;
        bad.push({ x, y });
      }
      if (!bad.length) break;
      // one ladder per contiguous run of bad cells, on the two lowest bad rows
      let placed = 0;
      const ys = [...new Set(bad.map(b => b.y))].sort((a, b) => b - a).slice(0, 2);
      for (const yy of ys) {
        const row = bad.filter(b => b.y === yy);
        for (let i = 0; i < row.length;) {
          let j = i;
          while (j + 1 < row.length && row[j + 1].x === row[j].x + 1) j++;
          const c = row[rng.range(i, j + 1)];
          let near = false;
          for (let dy = 0; dy < 4; dy++) for (const dx of [-1, 1]) if (get(c.x + dx, c.y + dy) === T.LADDER) near = true;
          if (!near && get(c.x, c.y + 1) === T.BRICK) { placeLadder(c.x, c.y + 1); placed++; }
          i = j + 1;
        }
      }
      if (!placed) iter = 9;
    }
    const main = comp[start];

    // exit column above the top floor
    const exits: number[] = [];
    for (let x = 2; x < W - 2; x++) {
      const i = (top - 1) * W + x;
      if (comp[i] !== main || !(isBrick(x, top) || get(x, top) === T.LADDER)) continue;
      let clear = true;
      for (let y = 0; y < top; y++) if (get(x, y) !== T.EMPTY) clear = false;
      if (assisted.some(q => Math.abs(q.x - x) <= 1)) clear = false;
      if (clear) { exits.push(x); if (get(x, top) === T.LADDER) exits.push(x, x); }
    }
    if (!exits.length) return null;
    const ex = rng.pick(exits);
    for (let y = 0; y < top; y++) m.exitLadders.push({ x: ex, y });

    // gold
    const noDig = g.bfs([start], true);
    const cand: P[] = [];
    const digCand: P[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (comp[i] !== main || get(x, y) !== T.EMPTY || !isBrick(x, y + 1) || x === ex) continue;
      if (Math.abs(x - sx) + Math.abs(y - (H - 2)) < 3) continue;
      (noDig[i] ? cand : digCand).push({ x, y });
    }
    const d = this.difficulty;
    const nAssist = assisted.length;
    const nGold = Math.max(1, rng.range(d.gold[0], d.gold[1] + 1) - nAssist);
    const chosen: P[] = [];
    const poleGold = poleIslandCells.filter(c => comp[c.y * W + c.x] === main);
    const escapeGold = escapeCells.filter(c => comp[c.y * W + c.x] === main);
    const vaultGold = vaultCells.filter(v => digCand.some(c => c.x === v.x && c.y === v.y));
    rng.shuffle(vaultGold); rng.shuffle(digCand);
    for (const v of [...poleGold.slice(0, 1), ...escapeGold.slice(0, 1), ...vaultGold.slice(0, 1), ...digCand]) {
      if (chosen.length >= Math.ceil(nGold / 4)) break;
      if (!chosen.some(c => Math.abs(c.x - v.x) < 3 && c.y === v.y)) chosen.push(v);
    }
    const pool = [...cand, ...digCand];
    const rowCount = (y: number) => chosen.filter(c => c.y === y).length;
    while (chosen.length < nGold && pool.length) {
      let bi = -1, bs = -1e9;
      for (let s = 0; s < 24; s++) {
        const j = rng.range(0, pool.length), q = pool[j];
        let md = 99;
        for (const c of chosen) md = Math.min(md, Math.abs(c.x - q.x) + Math.abs(c.y - q.y) * 2);
        const sc = Math.min(md, 12) - rowCount(q.y) * 2 + rng.next() * 3;
        if (md > 0 && sc > bs) { bs = sc; bi = j; }
      }
      if (bi < 0) break;
      chosen.push(pool[bi]); pool.splice(bi, 1);
    }
    if (chosen.length < Math.min(nGold, 3)) return null;
    for (const c of chosen) { set(c.x, c.y, T.GOLD); m.goldPositions.push(c); }
    for (const a of assisted) {
      set(a.x, a.y, T.GOLD); m.goldPositions.push(a);
      m.enemyAssistedGoldPositions.push(a); m.enemyAssistedSpawns.push({ x: a.x, y: 0 });
    }

    // validate (drop assisted gold that does not qualify)
    let res = analyzeLevel(m, m.enemyAssistedGoldPositions, p.assisted);
    if (!res.solvable && assisted.length) {
      assisted.forEach((a, li) => {
        if (res.enemyAssistedPositions.some(q => q.x === a.x && q.y === a.y)) return;
        set(a.x, a.y, T.EMPTY);
        if (!corridorGold.has(`${a.x},${a.y}`) && ledges[li]) for (const c of ledges[li]) set(c.x, c.y, T.EMPTY);
        m.goldPositions = m.goldPositions.filter(q => q !== a);
        m.enemyAssistedGoldPositions = m.enemyAssistedGoldPositions.filter(q => q !== a);
        m.enemyAssistedSpawns = m.enemyAssistedSpawns.filter(q => q.x !== a.x);
      });
      res = analyzeLevel(m, m.enemyAssistedGoldPositions, p.assisted);
    }
    if (!res.solvable) return null;
    m.goldDropCells = res.analysis!.dropCells;

    // guards: assisted spawns first, then spread over the main area away from the player
    const nEnemies = rng.range(d.enemies[0], d.enemies[1] + 1);
    for (const s of m.enemyAssistedSpawns) if (m.enemyStarts.length < nEnemies) m.enemyStarts.push({ ...s });
    const ecand: P[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (i >= N || comp[i] !== main || !reach[i] || get(x, y) !== T.EMPTY || !g.stable(x, y) || x === ex) continue;
      if (Math.abs(x - sx) + Math.abs(y - (H - 2)) < 10) continue;
      ecand.push({ x, y });
    }
    while (m.enemyStarts.length < nEnemies && ecand.length) {
      let bi = 0, bs = -1e9;
      for (let s = 0; s < 16; s++) {
        const j = rng.range(0, ecand.length), q = ecand[j];
        let md = 20;
        for (const e of m.enemyStarts) md = Math.min(md, Math.abs(e.x - q.x) + Math.abs(e.y - q.y));
        const sc = md + rng.next() * 4;
        if (sc > bs) { bs = sc; bi = j; }
      }
      m.enemyStarts.push(ecand[bi]); ecand.splice(bi, 1);
    }
    if (!m.enemyStarts.length) return null;
    return { map: m, res };
  }

  /** Last resort: fixed frame with seeded gold. Always solvable. */
  private fixedFallback(): TileMap {
    const m = new TileMap(), W = m.width, H = m.height, rng = this.rng;
    for (let x = 0; x < W; x++) { m.setTile(x, H - 1, T.BRICK); m.setTile(x, 11, T.BRICK); m.setTile(x, 7, T.BRICK); }
    for (const [x, y0, y1] of [[4, 11, 14], [23, 11, 14], [13, 7, 10]]) for (let y = y0; y <= y1; y++) m.setTile(x, y, T.LADDER);
    m.playerStart = { x: 2, y: H - 2 };
    for (let y = 0; y < 7; y++) m.exitLadders.push({ x: 13, y });
    const spots = [[8, 14], [18, 14], [2, 10], [9, 10], [20, 10], [25, 10], [5, 6], [21, 6]];
    for (const [x, y] of rng.shuffle(spots).slice(0, 6)) { m.setTile(x, y, T.GOLD); m.goldPositions.push({ x, y }); }
    m.enemyStarts.push({ x: 26, y: 6 });
    m.goldDropCells = analyzeLevel(m, [], 0).analysis!.dropCells;
    return m;
  }
}
