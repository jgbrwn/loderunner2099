import { TileType } from '../config';
import { TileMap } from './TileMap';

/**
 * Level solver v2 (classic Lode Runner movement model).
 *
 * Nodes: one per grid cell ("static" cell) plus one "in a freshly dug hole" node per cell.
 * Edges: walk L/R (when supported / on ladder / on pole), climb up (on ladder), climb/drop down,
 * fall (unsupported), dig L/R (then drop into the hole), and a 2-layer trench macro
 * (dig x+d, step back, dig x, drop, dig x+d one row lower, drop).
 * A hole node with no outgoing edge is a death trap (hole refills on the player).
 *
 * Solvable iff the gold SCCs (Tarjan condensation) form a chain reachable from the start and the
 * exit (row 0, exit ladders enabled) is reachable from the last gold's SCC.
 * Enemy-assisted gold: gold the player can't reach, sitting under open sky (guard respawns at
 * (x,0) and falls onto it) from where a guard (no digging) can walk to >=2 "drop cells" in the
 * terminal SCC (the SCC the player finishes in).
 */

export interface Position { x: number; y: number; }

export interface SolvabilityResult {
  solvable: boolean;
  score: number;
  debug: string;
  directGold: number;
  enemyAssistedGold: number;
  unreachableGold: number;
  enemyAssistedPositions: Position[];
  analysis?: LevelAnalysis;
}

export interface LevelAnalysis {
  W: number; H: number;
  /** player-reachable from start (static cells + hole nodes at index N+i) */
  reach: Uint8Array;
  /** player-reachable without any digging */
  reachNoDig: Uint8Array;
  comp: Int32Array;
  startComp: number;
  terminalComp: number;
  /** cells from which row 0 is reachable once exit ladders are shown */
  canExit: Uint8Array;
  /** player-safe cells where carried gold may be dropped (in terminal SCC, can exit) */
  dropCells: Position[];
  digRequiredGold: number;
  deathTrapHoles: number;
  oneWayCells: number;
  mainSize: number;
  tourLength: number;
}

const DIG = 1;
const MAXE = 8;

export class MoveGraph {
  readonly W: number; readonly H: number; readonly N: number;
  readonly cnt: Uint8Array;
  readonly to: Int16Array;
  readonly kind: Uint8Array;
  deathTrapHoles = 0;
  private t: Uint8Array;
  private built = new Set<number>();

  constructor(map: TileMap, exitEnabled: boolean) {
    const W = (this.W = map.width), H = (this.H = map.height), N = (this.N = W * H);
    const t = (this.t = new Uint8Array(N));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = map.tiles[y][x];
      if (v === TileType.HOLE) v = TileType.BRICK;
      t[y * W + x] = v;
    }
    if (exitEnabled) for (const e of map.exitLadders) t[e.y * W + e.x] = TileType.LADDER;
    this.cnt = new Uint8Array(2 * N);
    this.to = new Int16Array(2 * N * MAXE);
    this.kind = new Uint8Array(2 * N * MAXE);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.buildCell(x, y);
  }

  tile(x: number, y: number): number {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return TileType.BRICK_HARD;
    return this.t[y * this.W + x];
  }
  /** blocks horizontal entry / climbing into */
  solid(x: number, y: number): boolean {
    const v = this.tile(x, y);
    return v === TileType.BRICK || v === TileType.BRICK_HARD || v === TileType.BRICK_TRAP;
  }
  ladder(x: number, y: number): boolean {
    const v = this.tile(x, y);
    return v === TileType.LADDER || v === TileType.LADDER_EXIT;
  }
  /** something to stand on below (x,y) */
  supportBelow(x: number, y: number): boolean {
    const v = this.tile(x, y + 1);
    return v === TileType.BRICK || v === TileType.BRICK_HARD || v === TileType.LADDER || v === TileType.LADDER_EXIT;
  }
  stable(x: number, y: number): boolean {
    return this.ladder(x, y) || this.tile(x, y) === TileType.POLE || this.supportBelow(x, y);
  }

  private add(from: number, to: number, kind: number): void {
    const c = this.cnt[from];
    for (let k = 0; k < c; k++) if (this.to[from * MAXE + k] === to) return;
    if (c >= MAXE) return;
    this.to[from * MAXE + c] = to;
    this.kind[from * MAXE + c] = kind;
    this.cnt[from] = c + 1;
  }

  private buildCell(x: number, y: number): void {
    const W = this.W, H = this.H, i = y * W + x, v = this.tile(x, y);
    if (v === TileType.BRICK || v === TileType.BRICK_HARD) return;
    if (!this.stable(x, y)) {
      if (y + 1 < H) this.add(i, i + W, 0);
      return;
    }
    if (x > 0 && !this.solid(x - 1, y)) this.add(i, i - 1, 0);
    if (x < W - 1 && !this.solid(x + 1, y)) this.add(i, i + 1, 0);
    if (y > 0 && this.ladder(x, y) && !this.solid(x, y - 1)) this.add(i, i - W, 0);
    if (y + 1 < H) {
      const b = this.tile(x, y + 1);
      if (this.ladder(x, y + 1)) this.add(i, i + W, 0);
      else if ((this.ladder(x, y) || v === TileType.POLE) && b !== TileType.BRICK && b !== TileType.BRICK_HARD) this.add(i, i + W, 0);
    }
    // digging: must be standing on something (not hanging)
    if (v === TileType.POLE || !this.supportBelow(x, y)) return;
    for (const d of [-1, 1]) {
      const tx = x + d, ty = y + 1;
      if (tx < 0 || tx >= W || ty >= H) continue;
      if (this.tile(tx, ty) !== TileType.BRICK || this.tile(tx, y) !== TileType.EMPTY) continue;
      this.add(i, this.holeNode(tx, ty), DIG);
      // 2-layer trench: step back to x-d, dig (x,y+1), drop in, dig (x+d,y+2), drop in
      const bx = x - d;
      if (ty + 1 < H && v === TileType.EMPTY && this.tile(x, ty) === TileType.BRICK &&
          bx >= 0 && bx < W && !this.solid(bx, y) && this.tile(bx, y) !== TileType.POLE && this.supportBelow(bx, y)) {
        const under = this.tile(x, ty + 1);
        if ((under === TileType.BRICK || under === TileType.BRICK_HARD) && this.tile(tx, ty + 1) === TileType.BRICK) {
          this.add(i, this.holeNode(tx, ty + 1), DIG);
        }
      }
    }
  }

  /** Node for "player just dropped into a dug hole at (hx,hy)"; builds its edges lazily. */
  private holeNode(hx: number, hy: number): number {
    const W = this.W, n = this.N + hy * W + hx;
    if (this.built.has(n)) return n;
    this.built.add(n);
    if (!this.supportBelow(hx, hy)) {
      if (hy + 1 < this.H) this.add(n, n - this.N + W, 0);
    } else {
      if (hx > 0 && !this.solid(hx - 1, hy)) this.add(n, n - this.N - 1, 0);
      if (hx < W - 1 && !this.solid(hx + 1, hy)) this.add(n, n - this.N + 1, 0);
      if (this.cnt[n] === 0) this.deathTrapHoles++;
    }
    return n;
  }

  bfs(sources: number[], noDig = false, out?: Uint8Array, dist?: Int16Array): Uint8Array {
    const seen = out ?? new Uint8Array(2 * this.N);
    const q = new Int16Array(2 * this.N);
    let h = 0, tl = 0;
    for (const s of sources) if (!seen[s]) { seen[s] = 1; q[tl++] = s; if (dist) dist[s] = 0; }
    while (h < tl) {
      const u = q[h++], c = this.cnt[u];
      for (let k = 0; k < c; k++) {
        if (noDig && this.kind[u * MAXE + k] === DIG) continue;
        const w = this.to[u * MAXE + k];
        if (!seen[w]) { seen[w] = 1; q[tl++] = w; if (dist) dist[w] = dist[u] + 1; }
      }
    }
    return seen;
  }

  /** Tarjan SCC (iterative). Component ids are in reverse topological order (sinks first). */
  scc(): Int32Array {
    const M = 2 * this.N;
    const index = new Int32Array(M).fill(-1), low = new Int32Array(M), comp = new Int32Array(M).fill(-1);
    const stack: number[] = [], onStack = new Uint8Array(M);
    const cs: number[] = [], ks: number[] = [];
    let idx = 0, nc = 0;
    for (let s = 0; s < M; s++) {
      if (index[s] !== -1) continue;
      cs.push(s); ks.push(0); index[s] = low[s] = idx++; stack.push(s); onStack[s] = 1;
      while (cs.length) {
        const u = cs[cs.length - 1], k = ks[ks.length - 1];
        if (k < this.cnt[u]) {
          ks[ks.length - 1] = k + 1;
          const w = this.to[u * MAXE + k];
          if (index[w] === -1) {
            index[w] = low[w] = idx++; stack.push(w); onStack[w] = 1; cs.push(w); ks.push(0);
          } else if (onStack[w] && index[w] < low[u]) low[u] = index[w];
        } else {
          cs.pop(); ks.pop();
          if (cs.length) { const p = cs[cs.length - 1]; if (low[u] < low[p]) low[p] = low[u]; }
          if (low[u] === index[u]) {
            let w: number;
            do { w = stack.pop()!; onStack[w] = 0; comp[w] = nc; } while (w !== u);
            nc++;
          }
        }
      }
    }
    return comp;
  }
}

export function maxEnemyAssistedGold(difficultyKey: string): number {
  return ({ easy: 0, normal: 1, hard: 2, ninja: 3 } as Record<string, number>)[difficultyKey] ?? 0;
}

/**
 * Full analysis. `assisted` = gold positions the caller declares enemy-assisted (they are
 * validated); if undefined, unreachable gold that qualifies is auto-classified as assisted.
 */
export function analyzeLevel(map: TileMap, assisted?: Position[], maxAssisted = 3): SolvabilityResult {
  const W = map.width, H = map.height, N = W * H;
  const g = new MoveGraph(map, false);
  const start = map.playerStart.y * W + map.playerStart.x;
  const reach = g.bfs([start]);
  const reachNoDig = g.bfs([start], true);
  const comp = g.scc();
  const startComp = comp[start];

  const golds: Position[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.tiles[y][x] === TileType.GOLD) golds.push({ x, y });
  const isDeclared = (p: Position) => !!assisted && assisted.some(a => a.x === p.x && a.y === p.y);

  const direct: Position[] = [], other: Position[] = [];
  for (const p of golds) {
    if (!isDeclared(p) && reach[p.y * W + p.x]) direct.push(p); else other.push(p);
  }
  // chain gold SCCs in topological order (higher comp id = earlier)
  const comps = [...new Set(direct.map(p => comp[p.y * W + p.x]))].sort((a, b) => b - a);
  let chainOk = true, broken = 0;
  let prev = startComp;
  const firstNodeOf = new Map<number, number>();
  for (const p of direct) { const c = comp[p.y * W + p.x]; if (!firstNodeOf.has(c)) firstNodeOf.set(c, p.y * W + p.x); }
  let prevNode = start;
  for (const c of comps) {
    if (c !== prev) {
      const r = g.bfs([prevNode]);
      if (!r[firstNodeOf.get(c)!]) { chainOk = false; broken++; continue; }
    }
    prev = c; prevNode = firstNodeOf.get(c)!;
  }
  const terminalComp = prev;

  // exit reachability (reverse BFS on G2 from row 0)
  const g2 = new MoveGraph(map, true);
  const canExit = reverseReach(g2, Array.from({ length: W }, (_, x) => x));
  const lastCells: number[] = [];
  for (let i = 0; i < N; i++) if (comp[i] === terminalComp && reach[i]) lastCells.push(i);
  const terminalGold = direct.filter(p => comp[p.y * W + p.x] === terminalComp).map(p => p.y * W + p.x);
  const exitFrom = terminalGold.length ? terminalGold : [start];
  const exitOk = exitFrom.some(i => canExit[i]);

  // drop cells: empty standing cells in terminal comp that can exit
  const dropCells: Position[] = [];
  const dropMask = new Uint8Array(N);
  for (const i of lastCells) {
    const x = i % W, y = (i / W) | 0;
    if (y < 1 || map.tiles[y][x] !== TileType.EMPTY || !canExit[i]) continue;
    const b = g.tile(x, y + 1);
    if (b !== TileType.BRICK && b !== TileType.BRICK_HARD) continue;
    dropCells.push({ x, y }); dropMask[i] = 1;
  }

  // enemy-assisted classification
  const assistedOk: Position[] = [];
  let unreachable = 0;
  for (const p of other) {
    if (assistedOk.length < maxAssisted && isAssistable(map, g, p, dropMask)) assistedOk.push(p);
    else unreachable++;
  }
  const solvable = chainOk && exitOk && unreachable === 0 && golds.length > 0;

  // metrics
  let digReq = 0;
  for (const p of direct) if (!reachNoDig[p.y * W + p.x]) digReq++;
  let mainSize = 0, oneWay = 0;
  for (let i = 0; i < N; i++) if (reach[i]) { if (comp[i] === startComp) mainSize++; else if (!canExit[i]) oneWay++; }
  const tourLength = solvable ? tour(g, start, direct.map(p => p.y * W + p.x)) : 0;

  const total = golds.length || 1;
  const score = (direct.length + assistedOk.length) / total * (exitOk ? 1 : 0.5) * (chainOk ? 1 : 0.8);
  return {
    solvable, score,
    debug: `gold=${golds.length} direct=${direct.length} assisted=${assistedOk.length} unreach=${unreachable} chain=${chainOk ? 'ok' : 'broken:' + broken} exit=${exitOk}`,
    directGold: direct.length, enemyAssistedGold: assistedOk.length, unreachableGold: unreachable,
    enemyAssistedPositions: assistedOk,
    analysis: {
      W, H, reach, reachNoDig, comp, startComp, terminalComp, canExit, dropCells,
      digRequiredGold: digReq, deathTrapHoles: g.deathTrapHoles, oneWayCells: oneWay, mainSize, tourLength,
    },
  };
}

function reverseReach(g: MoveGraph, targets: number[]): Uint8Array {
  const M = 2 * g.N;
  // build reverse adjacency (CSR)
  const deg = new Int32Array(M + 1);
  for (let u = 0; u < M; u++) for (let k = 0; k < g.cnt[u]; k++) deg[g.to[u * MAXE + k] + 1]++;
  for (let i = 0; i < M; i++) deg[i + 1] += deg[i];
  const fill = deg.slice(), rev = new Int32Array(deg[M]);
  for (let u = 0; u < M; u++) for (let k = 0; k < g.cnt[u]; k++) rev[fill[g.to[u * MAXE + k]]++] = u;
  const seen = new Uint8Array(M), q = new Int32Array(M);
  let h = 0, tl = 0;
  for (const s of targets) if (!seen[s]) { seen[s] = 1; q[tl++] = s; }
  while (h < tl) {
    const v = q[h++];
    for (let j = deg[v]; j < deg[v + 1]; j++) { const u = rev[j]; if (!seen[u]) { seen[u] = 1; q[tl++] = u; } }
  }
  return seen;
}

/** Guard falls from (x,0) onto the gold, then walks (no digging) to >=2 drop cells. */
export function isAssistable(map: TileMap, g: MoveGraph, p: Position, dropMask: Uint8Array): boolean {
  for (let y = 0; y < p.y; y++) if (map.tiles[y][p.x] !== TileType.EMPTY) return false;
  if (!g.supportBelow(p.x, p.y)) return false;
  const r = g.bfs([p.y * g.W + p.x], true);
  let n = 0;
  for (let i = 0; i < g.N; i++) if (r[i] && dropMask[i]) n++;
  return n >= 2;
}

/** Greedy nearest-neighbour tour length start -> all gold (BFS steps). */
function tour(g: MoveGraph, start: number, golds: number[]): number {
  const left = new Set(golds);
  let cur = start, total = 0;
  const dist = new Int16Array(2 * g.N);
  while (left.size) {
    dist.fill(-1);
    g.bfs([cur], false, undefined, dist);
    let best = -1, bd = 1e9;
    for (const q of left) if (dist[q] >= 0 && dist[q] < bd) { bd = dist[q]; best = q; }
    if (best < 0) break;
    total += bd; left.delete(best); cur = best;
  }
  return total;
}

/** Backward-compatible wrapper. */
export class SolvabilityChecker {
  private difficultyKey = 'normal';
  setDifficulty(key: string): void { this.difficultyKey = key; }
  checkSolvability(map: TileMap): SolvabilityResult {
    const declared = map.enemyAssistedGoldPositions.length ? map.enemyAssistedGoldPositions : undefined;
    return analyzeLevel(map, declared, maxEnemyAssistedGold(this.difficultyKey));
  }
  isSolvable(map: TileMap): boolean { return this.checkSolvability(map).solvable; }
}
