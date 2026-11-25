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

interface Params { c: number; ld: number; trap: number; assisted: number; pocket?: boolean; }

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
    // LAST-GOLD SECTION is decided per level (all candidates share it, so best-of-N doesn't filter it out).
    // Not on the first levels of easy / normal.
    const pocket = this.levelNumber >= (d.lastSection <= 0.1 ? 3 : 2) && this.rng.chance(d.lastSection);
    // ENEMY-ASSISTED GOLD (the bracketed gold only a guard can fetch) is also decided per level, so the
    // best-of-N choice can't quietly filter it out; candidates that pull it off get a big score bonus.
    const assistRate = ({ easy: 0.12, normal: 0.33, hard: 0.5, ninja: 0.7 } as Record<string, number>)[this.difficultyKey] ?? 0;
    const want = maxA && this.levelNumber >= (this.difficultyKey === 'easy' ? 4 : 2) && this.rng.chance(assistRate)
      ? this.rng.range(1, maxA + 1) : 0;
    let best: { map: TileMap; res: SolvabilityResult; score: number } | null = null;
    let attempts = 0, valid = 0;
    for (; attempts < 60 && valid < candidates; attempts++) {
      const r = this.candidate({ ...params, assisted: attempts < 50 ? want : 0, pocket: pocket && attempts < 45 });
      if (!r) continue;
      valid++;
      const s = this.funScore(r.map, r.res, want) + (want && r.res.enemyAssistedGold ? 1000 : 0);
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
    const minTop = p.assisted ? 6 : rng.pick([3, 3, 4]);
    type Seg = { y: number; x0: number; x1: number };
    const segs: Seg[] = [];
    const sp = () => rng.pick(p.c > 0.7 ? [2, 2, 3, 3, 3] : [2, 3, 3, 3, 4]);
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

    // ladders: from segments down to support (flush with the segment); repair pass adds more.
    // Original-style variety: ladders on the edge columns, ladders that run THROUGH a floor and on down to the
    // next one (one long ladder serving several floors), the odd side-by-side double ladder.
    const ladderCols: number[] = [];
    const placeLadder = (x: number, y0: number, through = 0) => {
      set(x, y0, T.LADDER);
      for (let y = y0 + 1; y < H; y++) {
        const t = get(x, y);
        if (t === T.BRICK_TRAP) break;
        if (isBrick(x, y)) {
          // pass through a plain-brick floor (not the ground) with standing room below it
          if (through > 0 && t === T.BRICK && y < H - 2 && get(x, y + 1) === T.EMPTY && get(x, y - 1) === T.LADDER) { through--; set(x, y, T.LADDER); continue; }
          break;
        }
        set(x, y, T.LADDER);
      }
      ladderCols.push(x);
    };
    // a ladder that stops 1-2 cells short of the floor below (originals: ~25% of ladders end over air) is a
    // one-way way down: climb down, let go. Applied to long ladders only; the solver/repair pass keep it fair.
    const shortenLadder = (x: number, y0: number) => {
      let yb = y0;
      while (yb + 1 < H && get(x, yb + 1) === T.LADDER) yb++;
      const cut = rng.range(1, 3);
      if (yb - y0 + 1 - cut < 3 || yb >= H - 1) return;
      for (let y = yb - cut + 1; y <= yb; y++) set(x, y, T.EMPTY);
    };
    for (const tc of towerCols) placeLadder(tc, top);
    const levels = [H - 1, ...floors];
    const segOrder = rng.shuffle(segs.slice());
    for (const s of segOrder) {
      const wide = s.x1 - s.x0 + 1;
      let k = (rng.chance(0.65 + p.ld * 0.35) ? 1 : 0) + (wide >= 10 && rng.chance(0.25 + p.ld * 0.5) ? 1 : 0) + (wide >= 18 && rng.chance(0.35) ? 1 : 0);
      for (let tries = 0; tries < 14 && k > 0; tries++) {
        const x = rng.range(Math.max(0, s.x0), Math.min(W, s.x1 + 1));
        if (get(x, s.y - 1) !== T.EMPTY || get(x, s.y) !== T.BRICK) continue;
        let near = false;
        for (let y = s.y - 1; y < Math.min(H, s.y + 4); y++) for (let dx = -2; dx <= 2; dx++) if (get(x + dx, y) === T.LADDER) near = true;
        if (near) continue;
        placeLadder(x, s.y, rng.chance(0.35) ? rng.range(1, 3) : 0); k--;
        if (rng.chance(0.12 + 0.1 * p.c)) shortenLadder(x, s.y);
        // double ladder (side by side), occasionally
        const x2 = x + (rng.chance(0.5) ? 1 : -1);
        if (rng.chance(0.08) && x2 >= s.x0 && x2 <= s.x1 && get(x2, s.y - 1) === T.EMPTY && get(x2, s.y) === T.BRICK) placeLadder(x2, s.y);
      }
    }

    // THICK FLOORS (original levels are much denser: ~35% of solid cells sit on another solid cell, ours were 8%):
    // some floor segments get a second brick layer where there is still standing room below.
    for (const sg of segs) {
      if (sg.y >= H - 2 || !rng.chance(0.25 + 0.25 * p.c)) continue;
      for (let x = sg.x0; x <= sg.x1; x++) {
        if (get(x, sg.y) === T.BRICK && get(x, sg.y + 1) === T.EMPTY && get(x, sg.y + 2) === T.EMPTY && sg.y + 2 < H - 1) set(x, sg.y + 1, T.BRICK);
      }
    }
    // BRICK WALLS between two floors split a band into rooms (classic; the repair pass links rooms with ladders)
    for (let k = (rng.chance(0.3 + 0.3 * p.c) ? 1 : 0) + (rng.chance(0.25 * p.c) ? 1 : 0); k > 0; k--) {
      for (let tries = 0; tries < 20; tries++) {
        const x = rng.range(2, W - 2), f = rng.pick(floors.length ? floors : [H - 1]);
        if (!isBrick(x, f) || get(x, f - 1) === T.LADDER) continue;
        let yb = f + 1;
        while (yb < H && get(x, yb) === T.EMPTY) yb++;
        if (yb - f - 1 < 2 || yb - f - 1 > 4 || !isBrick(x, yb)) continue;
        let ok = true;
        for (let y = f + 1; y < yb && ok; y++) for (const dx of [-1, 1]) if (get(x + dx, y) === T.LADDER || get(x + dx, y) === T.POLE) ok = false;
        if (!ok) continue;
        for (let y = f + 1; y < yb; y++) set(x, y, T.BRICK);
        break;
      }
    }

    // POLES. Originals average ~17 pole cells in ~5 runs (ours had ~3 in 1). Original roles, all used here:
    // bridges across floor gaps, rails hung directly under a floor ceiling off a ladder, ladder-to-ladder
    // traverses over open space, ladder spurs that rise above a floor into a rail, free ends you drop off
    // (often onto / through gold below).
    const gapsByFloor = new Map<number, [number, number][]>();
    for (const y of rowsUsed) {
      const row = segs.filter(s => s.y === y).sort((a, b) => a.x0 - b.x0);
      const gaps: [number, number][] = [];
      for (let i = 1; i < row.length; i++) if (row[i].x0 - row[i - 1].x1 - 1 <= 7) gaps.push([row[i - 1].x1 + 1, row[i].x0 - 1]);
      gapsByFloor.set(y, gaps);
    }
    const escapeCells: P[] = [];       // gold in a drop-in / dig-out floor pit
    const pitCells: P[] = [];
    // PURPOSE CHECK. In the originals ~57% of pole runs connect two places that are otherwise unconnected (33%)
    // or only connected by a long detour (24%); only ~16% are "trivial" (both ends already a short walk apart).
    // Ours were 50% trivial. Every candidate run is now tested on the move graph (no digging) without it:
    // where does each end lead (the cell beyond it, or where you land if you drop off), and how far apart are
    // those two places without the bar? LINK / detour runs are kept, trivial ones only rarely.
    // v2 (re-measured against the originals with drops counted): letting go of a bar is a move too, so a run's
    // purpose is the best of end-to-end AND end-to-drop-landing. Originals: 58% of runs are true links, only
    // ~11% are mild detours (ratio 3-10) and ~22% trivial. Ours kept every "detour" (dist > 2*len+6), which let
    // through lots of bars you could just as well walk around (40% of runs) - those felt pointless. Now: links
    // and strong detours (ratio > 10) are kept, mild detours sometimes, trivial ones rarely.
    const KEEP: Record<string, number> = { link: 1, detour: 1, mild: 0.2, trivial: 0.08 };
    const landAt = (x: number, y: number): number => {
      if (x < 0 || x >= W || isBrick(x, y)) return -1;
      let yy = y;
      while (yy + 1 < H && get(x, yy) !== T.LADDER && get(x, yy) !== T.POLE && get(x, yy + 1) !== T.LADDER && !isBrick(x, yy + 1)) yy++;
      return yy * W + x;
    };
    const purposeOf = (cells: P[]): 'link' | 'detour' | 'mild' | 'trivial' => {
      const y = cells[0].y, a = Math.min(...cells.map(c => c.x)), b = Math.max(...cells.map(c => c.x)), len = b - a + 1;
      const ends = [{ at: landAt(a - 1, y), x: a - 1 }, { at: landAt(b + 1, y), x: b + 1 }].filter(e => e.at >= 0);
      if (!ends.length) return 'trivial';
      const gr = new MoveGraph(m, false), N2 = 2 * W * H;
      const dist = ends.map(e => { const d = new Int16Array(N2).fill(-1); gr.bfs([e.at], true, undefined, d); return d; });
      let best = 0;
      if (ends.length === 2) {
        const u = dist[0][ends[1].at], v = dist[1][ends[0].at];
        best = u < 0 || v < 0 ? 999 : Math.max(u, v) / len;
      }
      for (let x = a; x <= b && best < 999; x++) {
        if (y + 1 >= H || isBrick(x, y + 1)) continue;
        const L = landAt(x, y + 1);
        if (L < 0) continue;
        for (let k = 0; k < ends.length; k++) {
          const d = dist[k][L];
          best = Math.max(best, d < 0 ? 999 : d / (Math.abs(x - ends[k].x) + 2));
        }
      }
      return best >= 999 ? 'link' : best > 10 ? 'detour' : best > 3 ? 'mild' : 'trivial';
    };
    const tryPole = (cells: P[]): boolean => {
      if (cells.length < 2) return false;
      const keep = rng.chance(KEEP[purposeOf(cells)]);
      if (keep) for (const c of cells) set(c.x, c.y, T.POLE);
      return keep;
    };
    const railCells = (x0: number, y: number, dir: number, maxLen: number, needCeil: boolean): P[] => {
      const cells: P[] = [];
      for (let x = x0; cells.length < maxLen && x >= 0 && x < W; x += dir) {
        if (get(x, y) !== T.EMPTY || get(x, y + 1) !== T.EMPTY || get(x, y - 1) === T.LADDER) break;
        if (needCeil && cells.length < 2 && !isBrick(x, y - 1)) break;
        cells.push({ x, y });
      }
      return cells;
    };
    // a rail is tried at its full length first, then shorter (a shorter bar may end over a different landing)
    const rail = (x0: number, y: number, dir: number, maxLen: number, needCeil: boolean): number => {
      const cells = railCells(x0, y, dir, maxLen, needCeil);
      for (let n = cells.length; n >= 3; n -= rng.range(1, 3)) if (tryPole(cells.slice(0, n))) return n;
      return 0;
    };
    // bridges across gaps (at standing height)
    for (const [fy, gaps] of gapsByFloor) for (const [a, b] of gaps) {
      if (b - a >= 1 && rng.chance(0.8)) {
        let ok = true;
        for (let x = a; x <= b; x++) if (get(x, fy - 1) !== T.EMPTY) ok = false;
        if (ok) { const cells: P[] = []; for (let x = a; x <= b; x++) cells.push({ x, y: fy - 1 }); tryPole(cells); }
      }
    }
    // ceiling rails: off a ladder, directly under the floor it comes down from
    for (const lx of rng.shuffle(ladderCols.slice())) {
      if (!rng.chance(0.5 + 0.3 * p.c)) continue;
      for (let y = top + 1; y < H - 2; y++) {
        if (get(lx, y) !== T.LADDER) continue;
        const dir = rng.chance(0.5) ? 1 : -1;
        if (isBrick(lx + dir, y - 1) && rail(lx + dir, y, dir, rng.range(4, 11), true)) break;
      }
    }
    // ladder-to-ladder traverses over open space
    for (let k = rng.chance(0.4 + 0.3 * p.c) ? 1 : 0; k > 0; k--) {
      const cols = [...new Set(ladderCols)].sort((a, b) => a - b);
      outer: for (let tries = 0; tries < 12; tries++) {
        const a = rng.pick(cols), b = cols.find(c => c - a >= 4 && c - a <= 14);
        if (b === undefined) continue;
        for (let y = top + 1; y < H - 3; y++) {
          if (get(a, y) !== T.LADDER || get(b, y) !== T.LADDER) continue;
          let ok = true;
          for (let x = a + 1; x < b && ok; x++) if (get(x, y) !== T.EMPTY || get(x, y + 1) !== T.EMPTY) ok = false;
          if (ok) { const cells: P[] = []; for (let x = a + 1; x < b; x++) cells.push({ x, y }); if (tryPole(cells)) break outer; }
        }
      }
    }
    // LEDGE LINKS: from the open edge of a floor segment, a bar at standing height across open air to a ladder
    // (or another ledge) — the classic way to reach a section from the side (orig levels 7, 12, 23...)
    for (const sg of rng.shuffle(segs.slice())) {
      if (!rng.chance(0.7 + 0.3 * p.c)) continue;
      const y = sg.y - 1;
      if (y <= top - 1 || y < 1) continue;
      for (const dir of rng.shuffle([-1, 1])) {
        const x0 = dir > 0 ? sg.x1 + 1 : sg.x0 - 1;
        const cells: P[] = [];
        let hit = false;
        for (let x = x0; x >= 0 && x < W && cells.length <= 12; x += dir) {
          const t = get(x, y);
          if (t === T.LADDER || (t === T.EMPTY && isBrick(x, y + 1))) { hit = true; break; }
          if (t !== T.EMPTY || get(x, y + 1) !== T.EMPTY || get(x, y - 1) === T.LADDER) break;
          cells.push({ x, y });
        }
        if (hit && cells.length >= 3 && tryPole(cells)) break;
      }
    }
    // hanging poles off ladders mid-climb (free end = drop-off point)
    for (let k = rng.range(3, 5 + Math.round(p.c * 3)); k > 0; k--) {
      for (let tries = 0; tries < 14; tries++) {
        const lx = rng.pick(ladderCols.length ? ladderCols : [0]);
        const r = rng.range(top + 1, H - 2);
        if (get(lx, r) !== T.LADDER) continue;
        const dir = rng.chance(0.5) ? 1 : -1;
        if (rail(lx + dir, r, dir, rng.range(3, 10), false) || rail(lx - dir, r, -dir, rng.range(3, 10), false)) break;
      }
    }
    // ladder spur: a ladder that rises 2-3 cells above its floor into open air, with a rail off its top
    for (let k = rng.chance(0.3 + 0.3 * p.c) ? 1 : 0; k > 0; k--) {
      for (let tries = 0; tries < 10; tries++) {
        const lx = rng.pick(ladderCols.length ? ladderCols : [0]);
        let f = -1;
        for (let y = top + 1; y < H; y++) if (get(lx, y) === T.LADDER && get(lx, y - 1) === T.EMPTY) { f = y; break; }
        const h = rng.range(2, 4), r = f - h;
        if (f < 0 || r <= top) continue;
        let ok = true;
        for (let y = r; y < f && ok; y++) for (const dx of [-1, 0, 1]) if (get(lx + dx, y) !== T.EMPTY) ok = false;
        if (!ok) continue;
        for (let y = r; y < f; y++) set(lx, y, T.LADDER);
        const dir = rng.chance(0.5) ? 1 : -1;
        if (rail(lx + dir, r, dir, rng.range(3, 9), false) || rail(lx - dir, r, -dir, rng.range(3, 9), false)) break;
        for (let y = r; y < f; y++) set(lx, y, T.EMPTY); // spur without a purposeful rail: take it back
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

    // BURIED GOLD (the original's "gold under layers of brick", e.g. levels 17/29/101): a thick brick mass
    // hanging under a floor, with sealed gold pockets inside. You dig down through the top layer(s), drop into
    // a pocket and grab the gold; every pocket is 2-3 wide so you can dig its floor diagonally, drop into the
    // next pocket, and finally dig the bottom layer at the gold's level and DROP OUT underneath into open air
    // (no ladders, no climbing back up). 1-layer floors are a single dig+drop; 2-layer floors use the classic
    // trench (dig two, drop, dig again). Depth/pocket count scale with difficulty and level. Solver-verified.
    const buriedGold: P[] = [];
    const sealed = new Set<number>(); // pocket cells: no guard spawns inside
    if (rng.chance(0.22 + 0.3 * p.c + Math.min(0.15, this.levelNumber * 0.01))) {
      const lv = Math.min(this.levelNumber, 40);
      for (let tries = 0; tries < 80; tries++) {
        // pocket plan (top-down): t0 = top thickness, K pockets, th[k] = thickness below pocket k (last = 1)
        let K = Math.max(1, Math.min(4, 1 + Math.floor(p.c * 1.5 + lv / 10 + rng.next())));
        // layer thickness 1-3. Three solid layers (original level 12 style) is the rare deep variant: a 3-wide
        // staircase cut (dig three, drop, dig two, drop, dig one) — never on the very first levels.
        const p2 = 0.2 + 0.4 * p.c + lv * 0.01, p3 = this.levelNumber < 3 ? 0 : 0.06 + 0.2 * p.c + lv * 0.004;
        const thick = () => { const r = rng.next(); return r < p3 ? 3 : r < p3 + p2 ? 2 : 1; };
        const t0 = thick();
        const th: number[] = [];
        for (let k = 0; k < K; k++) th.push(k === K - 1 ? 1 : thick());
        const rowsFor = (n: number) => t0 + n + th.slice(0, n - 1).reduce((s, v) => s + v, 0) + 1; // f..y1
        // deepest plan that fits under some floor (deep masses need a high floor)
        let fits: number[] = [];
        for (; K >= 1; K--, th.length = K, K && (th[K - 1] = 1)) {
          fits = floors.filter(y => y < H - 4 && y + rowsFor(K) - 1 <= H - 3);
          if (fits.length) break;
        }
        if (!fits.length || K < 1) continue;
        const f = rng.pick(fits);
        const y1 = f + rowsFor(K) - 1;
        // pockets: widths (3 when a 2-thick floor lies below, for the trench; 4 above a 3-thick one), staircase drift
        const pw = th.map(t => (t === 3 ? 4 : t === 2 ? 3 : rng.chance(0.3) ? 3 : 2));
        const w = Math.max(...pw) + 2 + rng.range(0, 4);
        const siteOk = (a: number) => {
          for (let x = a - 1; x <= a + w; x++) {
            if (!isBrick(x, f) || (get(x, f) === T.BRICK_HARD && x >= a && x < a + w) || get(x, f - 1) !== T.EMPTY || reserved[x]) return false;
          }
          for (let x = a; x < a + w; x++) for (let y = f + 1; y <= y1; y++) { const t = get(x, y); if (t !== T.EMPTY && t !== T.BRICK) return false; }
          return true;
        };
        const sites: number[] = [];
        for (let a = 1; a + w < W; a++) if (siteOk(a)) sites.push(a);
        if (!sites.length) continue;
        const a = rng.pick(sites);
        const pr: number[] = [], px: number[] = [], drop: number[] = [];
        let r = f + t0, ok = true;
        let x0 = a + 1 + rng.range(0, w - 1 - pw[0]);
        if (t0 === 2 && x0 === a + 1 && rng.chance(0.5)) x0++;
        for (let k = 0; k < K && ok; k++) {
          pr.push(r); px.push(x0);
          if (k === K - 1) { drop.push(x0 + rng.range(0, pw[k])); break; }
          // drop column into the next pocket (1-thick: any pocket column; 2-thick: an end cell of the 3-wide pocket)
          const dc = th[k] >= 2 ? (rng.chance(0.5) ? x0 : x0 + pw[k] - 1) : x0 + rng.range(0, pw[k]);
          drop.push(dc);
          const nw = pw[k + 1];
          const lo = Math.max(a + 1, dc - nw + 1), hi = Math.min(a + w - 1 - nw, dc);
          if (lo > hi) ok = false; else x0 = rng.range(lo, hi + 1);
          r += th[k] + 1;
        }
        if (!ok) continue;
        const ex = drop[K - 1];
        if (get(ex, y1 + 1) !== T.EMPTY) continue;
        for (let x = a; x < a + w; x++) for (let y = f; y <= y1; y++) set(x, y, T.BRICK);
        for (let k = 0; k < K; k++) for (let i = 0; i < pw[k]; i++) { set(px[k] + i, pr[k], T.EMPTY); sealed.add(pr[k] * W + px[k] + i); }
        // gold: deepest pocket always (not on its exit cell), shallower pockets sometimes (not on a drop/trench cell)
        for (let k = K - 1; k >= 0; k--) {
          if (k < K - 1 && !rng.chance(0.45)) continue;
          const cells: number[] = [];
          for (let i = 0; i < pw[k]; i++) {
            const x = px[k] + i;
            if (x === drop[k]) continue;
            if (k < K - 1 && th[k] >= 2 && x !== (drop[k] === px[k] ? px[k] + pw[k] - 1 : px[k])) continue; // trench back cell
            cells.push(x);
          }
          if (cells.length) buriedGold.push({ x: rng.pick(cells), y: pr[k] });
        }
        for (let x = a - 1; x <= a + w; x++) reserved[x] = 1;
        break;
      }
    }

    // GOLD PIT (one-way drop pocket): a 2-wide pit cut into a floor, its own diggable floor one row down with open
    // air beneath. Walk over it and you drop in; walls on both sides, so the only way on is to grab the gold and
    // dig the pit floor diagonally (2 wide makes that possible) and drop out below. Solver-verified.
    for (let k = rng.chance(0.18 + 0.25 * p.c) ? 1 : 0; k > 0; k--) {
      for (let tries = 0; tries < 20; tries++) {
        const f = rng.pick(floors.length ? floors : [H - 1]), x = rng.range(2, W - 3);
        if (f >= H - 3) continue;
        let ok = true;
        for (let dx = -1; dx <= 2 && ok; dx++) {
          if (get(x + dx, f) !== T.BRICK || get(x + dx, f - 1) !== T.EMPTY || reserved[x + dx]) ok = false;
        }
        for (let dx = 0; dx <= 1 && ok; dx++) if (get(x + dx, f + 1) !== T.EMPTY || get(x + dx, f + 2) !== T.EMPTY) ok = false;
        if (!ok) continue;
        set(x, f, T.EMPTY); set(x + 1, f, T.EMPTY);
        set(x, f + 1, T.BRICK); set(x + 1, f + 1, T.BRICK);
        escapeCells.push({ x: x + rng.range(0, 2), y: f });
        pitCells.push({ x, y: f }, { x: x + 1, y: f });
        for (let dx = -1; dx <= 2; dx++) reserved[x + dx] = 1;
        break;
      }
    }

    // trap bricks over open space
    for (let k = (rng.chance(p.trap * 4) ? 1 : 0) + (rng.chance(p.trap * 2) ? 1 : 0); k > 0; k--) {
      for (let tries = 0; tries < 20; tries++) {
        const fy = rng.pick(floors.length ? floors : [H - 1]), x = rng.range(1, W - 1);
        if (fy === H - 1 || get(x, fy) !== T.BRICK || get(x, fy - 1) !== T.EMPTY || get(x, fy + 1) !== T.EMPTY || reserved[x]) continue;
        set(x, fy, T.BRICK_TRAP); break;
      }
    }

    // enemy-assisted gold: each slot is a SKY LEDGE (open platform a respawning guard falls onto) or a
    // GUARD CORRIDOR: a sealed hard-brick passage up in the sky the player can never enter (hard floor, roof and
    // back wall — nothing to climb, nothing to dig). Guards drop in through a chimney at the closed end, walk the
    // roofed passage, pick the gold up and carry it out the open end, falling into the level. The only way to
    // get that gold is to let a guard bring it to you. Solver-verified: unreachable to the player, guard route
    // chimney -> gold -> >=2 player-safe drop cells.
    const assisted: P[] = [];
    const corridorGold = new Set<string>();
    const ledges: P[][] = [];
    const spawnX = new Map<string, number>();
    // several placement tries per slot: a single random spot is often blocked by the level's top floor
    for (let k = p.assisted, tries = 0; k > 0 && tries < 10; tries++) {
      if (rng.chance(0.45) && top >= 6) {
        const y = rng.range(2, top - 3), len = rng.range(5, 9), dir = rng.chance(0.5) ? 1 : -1;
        const lx = rng.range(2, W - len - 2); // passage cells lx..lx+len-1
        let ok = true;
        for (let x = lx - 2; x <= lx + len + 1 && ok; x++) for (let yy = 0; yy <= Math.min(y + 2, top - 1); yy++) if (get(x, yy) !== T.EMPTY) { ok = false; break; }
        if (!ok) continue;
        const back = dir === 1 ? lx - 1 : lx + len, chim = dir === 1 ? lx : lx + len - 1;
        const cells: P[] = [];
        const put = (x: number, yy: number) => { set(x, yy, T.BRICK_HARD); cells.push({ x, y: yy }); };
        put(back, y); put(back, y + 1); put(back, y - 1);
        for (let x = lx; x < lx + len; x++) { put(x, y + 1); if (x !== chim) put(x, y - 1); }
        ledges.push(cells);
        const gx = dir === 1 ? rng.range(lx + 2, lx + len - 1) : rng.range(lx + 1, lx + len - 2);
        const gold = { x: gx, y };
        assisted.push(gold);
        corridorGold.add(`${gold.x},${gold.y}`);
        spawnX.set(`${gold.x},${gold.y}`, chim);
        m.corridorGoldPositions.push({ ...gold, sx: chim });
        k--;
        continue;
      }
      const ly = top - rng.range(2, 4), len = rng.range(3, 6), lx = rng.range(1, W - len - 1);
      if (ly < 2) continue;
      let ok = true;
      for (let x = lx - 2; x <= lx + len + 1; x++) for (let y = 0; y <= Math.min(ly + 2, top - 1); y++) if (get(x, y) !== T.EMPTY) ok = false;
      if (!ok) continue;
      const cells: P[] = [];
      for (let x = lx; x < lx + len; x++) { set(x, ly, T.BRICK_HARD); cells.push({ x, y: ly }); }
      ledges.push(cells);
      assisted.push({ x: lx + rng.range(0, len), y: ly - 1 });
      k--;
    }

    // player start on the ground
    let sx = -1;
    for (let tries = 0; tries < 30 && sx < 0; tries++) {
      const x = rng.range(1, W - 1);
      if (get(x, H - 2) === T.EMPTY && isBrick(x, H - 1)) sx = x;
    }
    if (sx < 0) return null;
    let sy = H - 2;
    m.playerStart = { x: sx, y: sy };

    // connectivity repair: give every standing area outside the start SCC a ladder down
    const N = W * H;
    let start = (H - 2) * W + sx;
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
          // SECTION LINK BY POLE (the classic idiom): instead of a ladder down, hang a bar from the region's edge
          // across open air to a ladder / standing cell that is already connected to the start.
          if (rng.chance(0.6)) {
            let linked = false;
            for (const [x0, dir] of rng.shuffle([[row[i].x - 1, -1], [row[j].x + 1, 1]] as [number, number][])) {
              const cells: P[] = [];
              let hit = false;
              for (let x = x0; x >= 0 && x < W && cells.length <= 12; x += dir) {
                const t = get(x, yy), ci = yy * W + x;
                if (t === T.LADDER && comp[ci] === main) { hit = true; break; }
                if (t === T.EMPTY && isBrick(x, yy + 1)) { hit = comp[ci] === main; break; }
                if (t !== T.EMPTY || get(x, yy + 1) !== T.EMPTY || get(x, yy - 1) === T.LADDER) break;
                cells.push({ x, y: yy });
              }
              if (hit && cells.length >= 2) { for (const c of cells) set(c.x, c.y, T.POLE); linked = true; placed++; break; }
            }
            if (linked) { i = j + 1; continue; }
          }
          const c = row[rng.range(i, j + 1)];
          let near = false;
          for (let dy = 0; dy < 4; dy++) for (const dx of [-1, 1]) if (get(c.x + dx, c.y + dy) === T.LADDER) near = true;
          if (!near && get(c.x, c.y + 1) === T.BRICK) { placeLadder(c.x, c.y + 1); placed++; }
          i = j + 1;
        }
      }
      if (!placed) iter = 9;
    }
    // Later stages (repair ladders, vaults, masses) can make a pole pointless after the fact. Re-check every
    // run on the finished layout; drop the trivial ones (keep a few, like the originals) when doing so loses
    // no standing room from the start's component.
    {
      const sccSize = (cc: Int32Array) => { let n = 0; const mc = cc[start]; for (let i = 0; i < W * H; i++) if (cc[i] === mc) n++; return n; };
      let base = sccSize(comp), changed = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (get(x, y) !== T.POLE || get(x - 1, y) === T.POLE) continue;
        const cells: P[] = [];
        for (let xx = x; get(xx, y) === T.POLE; xx++) cells.push({ x: xx, y });
        for (const c of cells) set(c.x, c.y, T.EMPTY);
        const k = purposeOf(cells);
        let keep = k === 'link' || k === 'detour' || rng.chance(KEEP[k]);
        if (!keep) {
          const g2 = new MoveGraph(m, false), c2 = g2.scc();
          if (sccSize(c2) < base - cells.length) keep = true; else { base = sccSize(c2); changed = true; }
        }
        if (keep) for (const c of cells) set(c.x, c.y, T.POLE);
      }
      if (changed) { g = new MoveGraph(m, false); comp = g.scc(); reach = g.bfs([start]); }
    }

    // LAST-GOLD SECTION (originals ~7% of levels: 8, 46, 58, 96, 113, 123...). A room under the end of a floor
    // that you can only drop into (mouth = a 1-wide shaft past the floor's edge; hard walls and floor, so no
    // digging out). Its gold can't be the first you take — go in early and you're stuck. Take it last and the
    // escape ladder appears right there, rising from the room's floor up the shaft you fell down.
    let pocketLadder: P[] = [], pocketGold: P[] = [];
    if (p.pocket) {
      const mainOf = (cc: Int32Array, gr: MoveGraph) => { const o: number[] = []; const mc = cc[start];
        for (let i = 0; i < N; i++) if (cc[i] === mc && gr.stable(i % W, (i / W) | 0) && get(i % W, (i / W) | 0) === T.EMPTY) o.push(i); return o; };
      const before = mainOf(comp, g);
      let ok = false;
      for (let tries = 0; tries < 80 && !ok; tries++) {
        const sg = rng.pick(segs), f = sg.y, h = rng.range(2, 4), fy = f + h + 1, dir = rng.chance(0.5) ? 1 : -1;
        const mx = dir > 0 ? sg.x1 + 1 : sg.x0 - 1, w = rng.range(3, 7);
        if (f < top || fy > H - 1 || mx < 1 || mx > W - 2 || w - 1 > sg.x1 - sg.x0 + 1) continue;
        const xa = dir > 0 ? mx - w + 1 : mx, xb = dir > 0 ? mx : mx + w - 1;      // interior columns
        const xi = dir > 0 ? xa - 1 : xb + 1, xo = mx + dir;                      // inner / outer wall
        if (Math.min(xi, xo) < 0 || Math.max(xi, xo) >= W) continue;
        if (get(mx, f) !== T.EMPTY || get(mx, f - 1) !== T.EMPTY || reserved[mx]) continue;
        const inner: P[] = [], walls: P[] = [];
        for (let y = f + 1; y <= f + h; y++) for (let x = xa; x <= xb; x++) inner.push({ x, y });
        for (let y = f + 1; y <= f + h; y++) walls.push({ x: xi, y });
        for (let y = f; y <= f + h; y++) walls.push({ x: xo, y });
        for (let x = Math.min(xi, xo); x <= Math.max(xi, xo); x++) walls.push({ x, y: fy });
        const okT = (q: P, allow: TileType[]) => allow.includes(get(q.x, q.y));
        if (!inner.every(q => okT(q, [T.EMPTY, T.BRICK])) || !walls.every(q => okT(q, [T.EMPTY, T.BRICK, T.BRICK_HARD]))) continue;
        if (pitCells.some(q => inner.some(c => c.x === q.x && c.y === q.y))) continue;
        const saved = [...inner, ...walls].map(q => ({ ...q, t: get(q.x, q.y) }));
        for (const q of inner) set(q.x, q.y, T.EMPTY);
        for (const q of walls) set(q.x, q.y, T.BRICK_HARD);
        const inside = (f + h) * W + (dir > 0 ? xa : xb);   // far corner of the room floor
        // Shaft styles: MISSING RUNG (originals 88, 113) = a visible ladder down into the room with a 1-2 cell
        // gap you can climb down through but not back up; the hidden ladder fills the gap. Else (or if no gap
        // works) the whole shaft is hidden and you just fall in.
        const shafts: P[][] = [];
        if (rng.chance(0.5)) {
          const gaps: [number, number][] = [];
          for (let a = f + 1; a < f + h; a++) for (let b = a; b < Math.min(a + 2, f + h); b++) gaps.push([a, b]);
          for (const [a, b] of rng.shuffle(gaps)) { const q: P[] = []; for (let y = a; y <= b; y++) q.push({ x: mx, y }); shafts.push(q); }
        }
        const full: P[] = [];
        for (let y = f; y <= f + h; y++) full.push({ x: mx, y });
        shafts.push(full);
        let ladder: P[] = [], g2: MoveGraph | null = null, c2 = comp, r2 = reach;
        for (const hid of shafts) {
          const vis = full.filter(q => !hid.some(c => c.y === q.y));
          for (const q of vis) set(q.x, q.y, T.LADDER);
          g2 = new MoveGraph(m, false); c2 = g2.scc(); r2 = g2.bfs([start]);
          const lostCells = before.filter(i => c2[i] !== c2[start] && !inner.some(q => q.y * W + q.x === i));
          // small dead corners that become unreachable are fine; nothing may become a one-way trap by accident
          const lost = lostCells.length > 4 || lostCells.some(i => r2[i]);
          let good = !lost && !!r2[inside] && !g2.bfs([inside])[start];
          if (good) { m.exitLadders = hid; good = !!new MoveGraph(m, true).bfs([inside])[start]; m.exitLadders = []; }
          if (good) { ladder = hid; break; }
          for (const q of vis) set(q.x, q.y, T.EMPTY);
        }
        if (!ladder.length || !g2) { for (const q of saved) set(q.x, q.y, q.t); continue; }
        // 1-2 gold on the room's floor (never on the ladder column)
        const spots = rng.shuffle(inner.filter(q => q.y === f + h && q.x !== mx));
        pocketGold = spots.slice(0, w >= 5 && rng.chance(0.5) ? 2 : 1);
        pocketLadder = ladder;
        m.lastSection = { x0: xa, x1: xb, y0: f + 1, y1: f + h, mx };
        g = g2; comp = c2; reach = r2; ok = true;
      }
      if (!ok) return null;
    }
    const main = comp[start];

    // PLAYER START HEIGHT (originals: ~half start on the bottom floor, the rest anywhere up the screen,
    // fairly evenly spread). The repair pass anchors on the ground; we then move the start to any standing
    // cell in the same strongly-connected component, so every place reachable from the ground start (and
    // back) stays reachable. Needs a standable neighbour on the same row for a second player.
    if (rng.chance(0.55)) {
      const opts: P[] = [];
      const standOk = (x: number, y: number) => x >= 0 && x < W && comp[y * W + x] === main && get(x, y) === T.EMPTY
        && (isBrick(x, y + 1) || get(x, y + 1) === T.LADDER) && !sealed.has(y * W + x);
      for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
        if (!standOk(x, y) || !(standOk(x - 1, y) || standOk(x + 1, y))) continue;
        if (get(x, y + 1) === T.BRICK_TRAP || assisted.some(q => Math.abs(q.x - x) <= 1 && Math.abs(q.y - y) <= 1)) continue;
        if (pitCells.some(q => q.x === x && Math.abs(q.y - y) <= 1)) continue;
        opts.push({ x, y });
      }
      if (opts.length) {
        // pick a row first (even spread over heights like the originals), then a cell on it
        const rows = [...new Set(opts.map(o => o.y))];
        const ry = rng.pick(rows), c = rng.pick(opts.filter(o => o.y === ry));
        sx = c.x; sy = c.y; m.playerStart = { x: sx, y: sy };
        start = sy * W + sx;
        reach = g.bfs([start]);
      }
    }

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
    // originals: ~28% of levels reveal 2+ hidden ladder columns (one each side, or one per tower)
    const exCols = [ex];
    if (rng.chance(0.25)) { const far = exits.filter(x => Math.abs(x - ex) >= 6); if (far.length) exCols.push(rng.pick(far)); }
    for (const c of exCols) for (let y = 0; y < top; y++) m.exitLadders.push({ x: c, y });
    m.exitLadders.push(...pocketLadder);

    // gold
    const noDig = g.bfs([start], true);
    const cand: P[] = [];
    const digCand: P[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (comp[i] !== main || get(x, y) !== T.EMPTY || !(isBrick(x, y + 1) || get(x, y + 1) === T.LADDER) || exCols.includes(x)) continue;
      if (Math.abs(x - sx) + Math.abs(y - sy) < 3) continue;
      (noDig[i] ? cand : digCand).push({ x, y });
    }
    const d = this.difficulty;
    const nAssist = assisted.length;
    const nGold = Math.max(1, rng.range(d.gold[0], d.gold[1] + 1) - nAssist);
    const chosen: P[] = [];
    // a pit you can fall into but not get out of (and back to the exit) would be a pure death trap
    if (pitCells.some(c => comp[c.y * W + c.x] !== main)) return null;
    // buried gold is the point of the mass: if the solver can't route in-and-out of it, reject the candidate
    for (const q of pocketGold) chosen.push(q);
    for (const b of buriedGold) {
      if (comp[b.y * W + b.x] !== main) return null;
      chosen.push(b);
      m.buriedGoldPositions.push(b);
    }
    // POLE-DROP GOLD (originals: ~16% of gold sits under a pole, ~10% hangs in mid-air): gold floating 1-2 cells
    // under a pole — hang along the bar, let go, collect it on the way down — or sitting on a floor just below.
    const floatGold: P[] = [], underPole: P[] = [];
    for (let y = 1; y < H - 2; y++) for (let x = 0; x < W; x++) {
      if (get(x, y) !== T.POLE) continue;
      for (const yy of [y + 1, y + 2]) {
        const i = yy * W + x;
        if (comp[i] !== main || get(x, yy) !== T.EMPTY || exCols.includes(x)) continue;
        if (!g.stable(x, yy)) { if (yy === y + 1 || get(x, y + 1) === T.EMPTY) floatGold.push({ x, y: yy }); }
        else if (isBrick(x, yy + 1)) underPole.push({ x, y: yy });
      }
    }
    rng.shuffle(floatGold); rng.shuffle(underPole);
    const poleGold = [...floatGold.slice(0, rng.chance(0.3 * p.c) ? 2 : 1), ...underPole.slice(0, rng.chance(0.5) ? 1 : 0)];
    const escapeGold = escapeCells.filter(c => comp[c.y * W + c.x] === main);
    const vaultGold = vaultCells.filter(v => digCand.some(c => c.x === v.x && c.y === v.y));
    rng.shuffle(vaultGold); rng.shuffle(digCand);
    const idiomGold = [...poleGold, ...escapeGold.slice(0, 1), ...vaultGold.slice(0, 1)];
    for (const v of [...idiomGold, ...digCand]) {
      if (chosen.length >= Math.ceil(nGold / 4) && !idiomGold.includes(v)) break;
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
      m.enemyAssistedGoldPositions.push(a); m.enemyAssistedSpawns.push({ x: spawnX.get(`${a.x},${a.y}`) ?? a.x, y: 0 });
    }

    // validate (drop assisted gold that does not qualify)
    let res = analyzeLevel(m, m.enemyAssistedGoldPositions, p.assisted);
    if (!res.solvable && assisted.length) {
      assisted.forEach((a, li) => {
        if (res.enemyAssistedPositions.some(q => q.x === a.x && q.y === a.y)) return;
        set(a.x, a.y, T.EMPTY);
        if (ledges[li]) for (const c of ledges[li]) set(c.x, c.y, T.EMPTY);
        const sx = spawnX.get(`${a.x},${a.y}`) ?? a.x;
        m.goldPositions = m.goldPositions.filter(q => q !== a);
        m.enemyAssistedGoldPositions = m.enemyAssistedGoldPositions.filter(q => q !== a);
        m.enemyAssistedSpawns = m.enemyAssistedSpawns.filter(q => q.x !== sx);
        m.corridorGoldPositions = m.corridorGoldPositions.filter(q => q.x !== a.x || q.y !== a.y);
      });
      res = analyzeLevel(m, m.enemyAssistedGoldPositions, p.assisted);
    }
    if (!res.solvable) return null;
    // a guard corridor the player can walk/dig into is just ordinary gold — not this idiom
    if (m.corridorGoldPositions.some(c => res.analysis!.reach[c.y * W + c.x])) return null;
    m.goldDropCells = res.analysis!.dropCells;

    // guards: assisted spawns first, then spread over the main area away from the player
    const nEnemies = rng.range(d.enemies[0], d.enemies[1] + 1);
    for (const s of m.enemyAssistedSpawns) if (m.enemyStarts.length < nEnemies) m.enemyStarts.push({ ...s });
    const ecand: P[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (i >= N || comp[i] !== main || !reach[i] || get(x, y) !== T.EMPTY || !g.stable(x, y) || exCols.includes(x) || sealed.has(i)) continue;
      if (Math.abs(x - sx) + Math.abs(y - sy) < 10) continue;
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
