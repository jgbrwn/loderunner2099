// Deterministic Lode Runner simulation. No Phaser / DOM imports.
import { TileType } from '../config';
import type { TileMap } from '../level/TileMap';
import { SeededRandom } from '../utils/SeededRandom';
import {
  SUB, HALF, RUN_SPEED, FALL_SPEED, GUARD_SPEED_FACTOR, DIG_TICKS, HOLE_TICKS,
  GUARD_RESPAWN_TICKS, GUARD_SPAWN_ANIM_TICKS, PLAYER_RESPAWN_TICKS, SCORE, NO_INPUT, TICK_HZ,
  type Actor, type Dir, type SimEvent, type SimGold, type SimGuard, type SimHole,
  type SimInput, type SimOptions, type SimPlayer, type SimStatus,
} from './types';
const ASSIST_MAX_CARRY_TICKS = 25 * TICK_HZ;
import { classicGuardMove, bfsFirstDir, bfsDist, moveGraph } from './guardAI';

const T = TileType;
export const isSolid = (t: TileType) => t === T.BRICK || t === T.BRICK_HARD;  // BRICK_TRAP is not solid (original "false brick")
export const isLadder = (t: TileType) => t === T.LADDER || t === T.LADDER_EXIT;
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

export class World {
  readonly width: number;
  readonly height: number;
  tiles: TileType[][];
  players: SimPlayer[] = [];
  guards: SimGuard[] = [];
  golds: SimGold[] = [];
  holes: SimHole[] = [];
  exitLadders: { x: number; y: number }[];
  exitsRevealed = false;
  status: SimStatus = 'playing';
  tickCount = 0;
  started = false;
  /** cells the player can (optimistically) reach from the start; guards only drop carried gold here */
  reach: boolean[][];
  courier = -1;
  private assistStuck = 0;
  private events: SimEvent[] = [];
  private rng: SeededRandom;
  private guardSpeed: number;
  private holeTicks: number;
  private trapTicks: number;

  constructor(map: TileMap, opts: SimOptions) {
    this.width = map.width;
    this.height = map.height;
    this.rng = new SeededRandom(`${opts.seed}:sim`);
    this.guardSpeed = Math.round(RUN_SPEED * GUARD_SPEED_FACTOR * (opts.enemySpeed ?? 1));
    this.holeTicks = Math.round(HOLE_TICKS * (opts.holeTime ?? 1));
    this.trapTicks = Math.round(this.holeTicks * 0.7);
    this.tiles = map.tiles.map(r => r.slice());
    this.exitLadders = map.exitLadders.map(e => ({ ...e }));

    // Gold lives in its own list; tiles keep EMPTY.
    const goldSet = new Map<string, { x: number; y: number }>();
    for (const g of map.goldPositions) goldSet.set(`${g.x},${g.y}`, g);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      if (this.tiles[y][x] === T.GOLD) { goldSet.set(`${x},${y}`, { x, y }); this.tiles[y][x] = T.EMPTY; }
      if (this.tiles[y][x] === T.HOLE || this.tiles[y][x] === T.ENEMY || this.tiles[y][x] === T.PLAYER) this.tiles[y][x] = T.EMPTY;
    }
    for (const e of this.exitLadders) if (this.tiles[e.y]?.[e.x] === T.LADDER_EXIT) this.tiles[e.y][e.x] = T.EMPTY;
    const assisted = new Set(map.enemyAssistedGoldPositions.map(g => `${g.x},${g.y}`));
    let id = 0;
    for (const [k, g] of goldSet) this.golds.push({ id: id++, x: g.x, y: g.y, assisted: assisted.has(k), carriedBy: -1, collected: false });

    const n = Math.max(1, Math.min(2, opts.players ?? 1));
    const starts = [map.playerStart, ...(n > 1 ? [this.findSecondStart(map.playerStart)] : [])];
    starts.forEach((s, i) => this.players.push(this.makePlayer(i, s.x, s.y)));
    map.enemyStarts.forEach((s, i) => this.guards.push(this.makeGuard(i, s.x, s.y)));
    this.reach = this.computePlayerReach();
    // Level generator v2 supplies vetted drop cells; guards may only drop carried gold there.
    if (map.goldDropCells?.length) {
      this.reach = this.tiles.map(r => r.map(() => false));
      for (const c of map.goldDropCells) if (this.reach[c.y]) this.reach[c.y][c.x] = true;
    }
  }

  // ---------- public API ----------
  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }
  goldRemaining(): number { return this.golds.filter(g => !g.collected).length; }
  tile(x: number, y: number): TileType {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return T.BRICK_HARD;
    return this.tiles[y][x];
  }
  goldAt(x: number, y: number): SimGold | undefined {
    return this.golds.find(g => !g.collected && g.carriedBy < 0 && g.x === x && g.y === y);
  }
  guardAt(x: number, y: number, self?: Actor): SimGuard | undefined {
    return this.guards.find(g => g !== self && g.mode !== 'dead' && g.cx === x && g.cy === y);
  }
  holeAt(x: number, y: number): SimHole | undefined { return this.holes.find(h => h.x === x && h.y === y); }

  tick(inputs: SimInput[] = []): void {
    if (this.status !== 'playing') return;
    this.tickCount++;
    this.players.forEach((p, i) => this.tickPlayer(p, inputs[i] ?? NO_INPUT));
    this.updateCourier();
    for (const g of this.guards) this.tickGuard(g);
    this.tickHoles();
    this.checkPlayers();
  }

  snapshot(): string {
    return JSON.stringify({ t: this.tickCount, p: this.players, g: this.guards, gold: this.golds, h: this.holes, s: this.status, tiles: this.tiles });
  }

  // ---------- setup helpers ----------
  private makePlayer(id: number, x: number, y: number): SimPlayer {
    return { id, cx: x, cy: y, ox: 0, oy: 0, mode: 'idle', facing: 1, acc: 0, alive: true, startX: x, startY: y,
      digTicks: 0, digX: 0, digY: 0, prevDigL: false, prevDigR: false, vertBuf: null, vertBufTicks: 0, prevVert: null,
      respawnTicks: 0, score: 0 };
  }
  private makeGuard(id: number, x: number, y: number): SimGuard {
    return { id, cx: x, cy: y, ox: 0, oy: 0, mode: 'idle', facing: -1, acc: 0, dir: null, carry: -1, carryTimer: 0, carryAge: 0,
      trapTicks: 0, holeX: -1, holeY: -1, escapeTicks: 0, spawnTicks: 0, noPickX: -1, noPickY: -1 };
  }
  private findSecondStart(s: { x: number; y: number }): { x: number; y: number } {
    for (let d = 1; d < this.width; d++) for (const x of [s.x + d, s.x - d]) {
      const t = this.tile(x, s.y);
      if (x < 0 || x >= this.width || isSolid(t)) continue;
      if (this.standableTile(x, s.y + 1) || isLadder(t)) return { x, y: s.y };
    }
    return { ...s };
  }

  // ---------- physics ----------
  /** Can an actor stand on top of cell (x,y)? */
  standable(x: number, y: number, self?: Actor): boolean {
    if (this.standableTile(x, y)) return true;
    return !!this.guardAt(x, y, self);
  }
  private standableTile(x: number, y: number): boolean {
    const t = this.tile(x, y);
    return t === T.BRICK || t === T.BRICK_HARD || isLadder(t);
  }
  shouldFall(a: Actor): boolean {
    const t = this.tile(a.cx, a.cy);
    if (isLadder(t)) return false;
    if (t === T.POLE && a.oy === 0) return false;
    if (a.oy < 0) return true;
    if (a.oy > 0) return !isLadder(this.tile(a.cx, a.cy + 1));
    return !this.standable(a.cx, a.cy + 1, a);
  }
  private fallStep(a: Actor): void {
    if (a.ox !== 0) a.ox -= sign(a.ox);
    a.oy++;
    if (a.oy >= HALF) { a.cy++; a.oy -= SUB; }
  }
  /** One unit step in direction dir. Returns false if blocked. */
  private tryMove(a: Actor, dir: Dir, guard: boolean): boolean {
    const t = this.tile(a.cx, a.cy);
    if (dir === 'U') {
      if (!(isLadder(t) || (a.oy > 0 && isLadder(this.tile(a.cx, a.cy + 1))))) return false;
      if (a.oy <= 0 && (a.cy === 0 || isSolid(this.tile(a.cx, a.cy - 1)) || (guard && this.guardAt(a.cx, a.cy - 1, a)))) return false;
      if (a.ox !== 0) { a.ox -= sign(a.ox); return true; }
      a.oy--; if (a.oy < -HALF) { a.cy--; a.oy += SUB; }
      return true;
    }
    if (dir === 'D') {
      const below = this.tile(a.cx, a.cy + 1);
      if (!(isLadder(t) || isLadder(below) || (t === T.POLE && a.oy === 0))) return false;
      if (a.oy >= 0 && (isSolid(below) || (guard && this.guardAt(a.cx, a.cy + 1, a)))) return false;
      if (a.ox !== 0) { a.ox -= sign(a.ox); return true; }
      a.oy++; if (a.oy >= HALF) { a.cy++; a.oy -= SUB; }
      return true;
    }
    if (dir === 'L' || dir === 'R') {
      const d = dir === 'L' ? -1 : 1;
      a.facing = d;
      const towardCenter = a.ox !== 0 && sign(a.ox) !== d;
      if (!towardCenter) {
        const nx = a.cx + d;
        if (isSolid(this.tile(nx, a.cy)) || (guard && this.guardAt(nx, a.cy, a))) return false;
      }
      if (a.oy !== 0) { a.oy -= sign(a.oy); return true; }
      a.ox += d;
      if (a.ox >= HALF) { a.cx++; a.ox -= SUB; } else if (a.ox < -HALF) { a.cx--; a.ox += SUB; }
      return true;
    }
    return false;
  }
  private restMode(a: Actor, moved: boolean, vertical: boolean): void {
    const t = this.tile(a.cx, a.cy);
    if (t === T.POLE && a.oy === 0) a.mode = 'hang';
    else if (isLadder(t) || (a.oy > 0 && isLadder(this.tile(a.cx, a.cy + 1)))) a.mode = moved && !vertical ? 'run' : 'climb';
    else a.mode = moved ? 'run' : 'idle';
  }

  // ---------- players ----------
  private tickPlayer(p: SimPlayer, inp: SimInput): void {
    if (!p.alive) {
      if (p.respawnTicks > 0 && --p.respawnTicks === 0) {
        Object.assign(p, { cx: p.startX, cy: p.startY, ox: 0, oy: 0, alive: true, mode: 'idle', acc: 0 });
        this.emit({ t: 'playerSpawn', p: p.id });
      }
      return;
    }
    const digL = inp.digLeft && !p.prevDigL, digR = inp.digRight && !p.prevDigR;
    p.prevDigL = inp.digLeft; p.prevDigR = inp.digRight;
    if (inp.left || inp.right || inp.up || inp.down || inp.digLeft || inp.digRight) this.started = true;

    if (p.mode === 'dig') {
      if (this.guardAt(p.digX, p.digY - 1) || this.guardAt(p.digX, p.digY) || this.goldAt(p.digX, p.digY - 1)) {
        p.mode = 'idle';
        this.emit({ t: 'digAbort', p: p.id, x: p.digX, y: p.digY });
      } else if (--p.digTicks <= 0) {
        p.mode = 'idle';
        this.openHole(p.digX, p.digY, p.id);
      }
      return;
    }

    const vert: Dir = inp.up ? 'U' : inp.down ? 'D' : null;
    if (vert && vert !== p.prevVert) { p.vertBuf = vert; p.vertBufTicks = 10; }
    p.prevVert = vert;
    if (p.vertBufTicks > 0) p.vertBufTicks--;
    const hor: Dir = inp.left && !inp.right ? 'L' : inp.right && !inp.left ? 'R' : null;

    if ((digL || digR) && !this.shouldFall(p) && this.tryDig(p, digL ? -1 : 1)) return;

    p.acc += this.shouldFall(p) ? FALL_SPEED : RUN_SPEED;
    let moved = false, vertical = false;
    while (p.acc >= 1000) {
      p.acc -= 1000;
      const pcx = p.cx, pcy = p.cy;
      if (this.shouldFall(p)) {
        if (p.mode !== 'fall') this.emit({ t: 'fall', p: p.id });
        p.mode = 'fall';
        this.fallStep(p);
        continue;
      }
      if (p.mode === 'fall') { p.mode = 'idle'; this.emit({ t: 'land', p: p.id }); }
      const v = vert ?? (p.vertBufTicks > 0 ? p.vertBuf : null);
      let ok = false, usedV = false;
      if (v) { ok = this.tryMove(p, v, false); usedV = ok; }
      if (!ok && hor) ok = this.tryMove(p, hor, false);
      if (!ok) { p.acc = 0; break; }
      moved = true; vertical = usedV;
      if (!vert && usedV && p.ox === 0) p.vertBufTicks = 0; // buffered turn: aligned onto ladder, stop
      if (p.cx !== pcx || p.cy !== pcy) this.emit({ t: 'step', p: p.id, climb: usedV });
    }
    if (p.mode !== 'fall') this.restMode(p, moved, vertical);
  }

  private tryDig(p: SimPlayer, d: -1 | 1): boolean {
    if (p.oy !== 0 || this.tile(p.cx, p.cy) === T.POLE) return false;
    const x = p.cx + d, y = p.cy + 1;
    p.facing = d;
    if (this.tile(x, y) !== T.BRICK) return false;
    if (this.tile(x, p.cy) !== T.EMPTY) return false;
    if (this.goldAt(x, p.cy) || this.guardAt(x, p.cy) || this.guardAt(x, y)) return false;
    p.ox = 0;
    p.mode = 'dig'; p.digTicks = DIG_TICKS; p.digX = x; p.digY = y;
    this.emit({ t: 'digStart', p: p.id, x, y, ticks: DIG_TICKS });
    return true;
  }

  private openHole(x: number, y: number, by: number): void {
    this.tiles[y][x] = T.HOLE;
    this.holes.push({ x, y, ticks: this.holeTicks, total: this.holeTicks, by });
    this.emit({ t: 'holeOpen', x, y });
  }

  private killPlayer(p: SimPlayer): void {
    if (!p.alive) return;
    p.alive = false; p.mode = 'dead';
    this.emit({ t: 'playerDeath', p: p.id, x: p.cx, y: p.cy });
    if (this.players.some(o => o.alive)) p.respawnTicks = PLAYER_RESPAWN_TICKS;
    else { this.status = 'failed'; this.emit({ t: 'failed' }); }
  }

  private addScore(p: number, amount: number): void {
    const pl = this.players[p] ?? this.players[0];
    pl.score += amount;
    this.emit({ t: 'score', p: pl.id, amount });
  }

  private checkPlayers(): void {
    for (const p of this.players) {
      if (!p.alive || this.status !== 'playing') continue;
      const g = this.goldAt(p.cx, p.cy);
      if (g) {
        g.collected = true;
        this.emit({ t: 'gold', p: p.id, x: g.x, y: g.y });
        this.addScore(p.id, SCORE.GOLD);
        this.settleGold(g.x, g.y - 1);
      }
      const px = p.cx * SUB + p.ox, py = p.cy * SUB + p.oy;
      for (const gd of this.guards) {
        if (gd.mode === 'dead' || gd.mode === 'spawning') continue;
        if (Math.abs(gd.cx * SUB + gd.ox - px) < 18 && Math.abs(gd.cy * SUB + gd.oy - py) < 18) { this.killPlayer(p); break; }
      }
    }
    if (!this.exitsRevealed && this.goldRemaining() === 0) {
      this.exitsRevealed = true;
      for (const e of this.exitLadders) if (this.tiles[e.y][e.x] === T.EMPTY) this.tiles[e.y][e.x] = T.LADDER_EXIT;
      this.emit({ t: 'exitReveal' });
    }
    if (this.exitsRevealed && this.status === 'playing') {
      const p = this.players.find(p => p.alive && p.cy === 0 && p.oy <= 0);
      if (p) {
        this.addScore(p.id, SCORE.LEVEL);
        this.status = 'complete';
        this.emit({ t: 'complete', p: p.id });
      }
    }
  }

  private settleGold(x: number, y: number): void {
    const g = this.goldAt(x, y);
    if (!g) return;
    let ny = y;
    while (ny + 1 < this.height) {
      const t = this.tile(x, ny + 1);
      if (t === T.BRICK || t === T.BRICK_HARD || isLadder(t) || t === T.HOLE || this.goldAt(x, ny + 1)) break;
      ny++;
    }
    if (ny !== y) { g.y = ny; this.settleGold(x, y - 1); }
  }

  // ---------- holes ----------
  private tickHoles(): void {
    for (const h of this.holes) {
      if (--h.ticks > 0) continue;
      this.tiles[h.y][h.x] = T.BRICK;
      this.emit({ t: 'holeFill', x: h.x, y: h.y });
      for (const p of this.players) if (p.alive && p.cx === h.x && p.cy === h.y) this.killPlayer(p);
      for (const g of this.guards) if (g.mode !== 'dead' && g.cx === h.x && g.cy === h.y) this.killGuard(g, h.by);
    }
    this.holes = this.holes.filter(h => h.ticks > 0);
  }

  // ---------- guards ----------
  private killGuard(g: SimGuard, by: number): void {
    this.emit({ t: 'guardDeath', g: g.id, x: g.cx, y: g.cy });
    if (by >= 0) this.addScore(by, SCORE.GUARD_DEATH);
    g.mode = 'dead'; g.spawnTicks = GUARD_RESPAWN_TICKS; g.holeX = -1; g.dir = null;
  }

  private floorAssistedGold(): SimGold | undefined {
    return this.golds.find(g => g.assisted && !g.collected && g.carriedBy < 0);
  }

  private spawnGuard(g: SimGuard): void {
    const target = this.floorAssistedGold();
    const col = target ? target.x : this.rng.range(0, this.width);
    let pos: { x: number; y: number } | null = null;
    for (let y = 0; y < this.height && !pos; y++) {
      for (let d = 0; d < this.width && !pos; d++) {
        for (const x of d === 0 ? [col] : [col - d, col + d]) {
          if (x < 0 || x >= this.width) continue;
          const t = this.tile(x, y);
          if ((t === T.EMPTY || isLadder(t) || t === T.POLE) && !this.guardAt(x, y, g) && !this.goldAt(x, y)) { pos = { x, y }; break; }
        }
      }
    }
    pos ??= { x: col, y: 0 };
    Object.assign(g, { cx: pos.x, cy: pos.y, ox: 0, oy: 0, acc: 0, dir: null, mode: 'spawning', spawnTicks: GUARD_SPAWN_ANIM_TICKS, holeX: -1 });
    if (g.carry >= 0) g.carryTimer = this.rng.range(4, 16);
    this.emit({ t: 'guardSpawn', g: g.id, x: pos.x, y: pos.y });
  }

  private trapGuard(g: SimGuard): void {
    g.mode = 'trapped'; g.trapTicks = this.trapTicks; g.ox = 0; g.oy = 0; g.dir = null;
    g.holeX = g.cx; g.holeY = g.cy;
    const hole = this.holeAt(g.cx, g.cy);
    this.emit({ t: 'trap', g: g.id, x: g.cx, y: g.cy });
    this.addScore(hole ? hole.by : 0, SCORE.TRAP);
    if (g.carry >= 0 && this.tile(g.cx, g.cy - 1) === T.EMPTY && !this.goldAt(g.cx, g.cy - 1) && this.reach[g.cy - 1]?.[g.cx]) {
      const gold = this.golds[g.carry];
      gold.carriedBy = -1; gold.x = g.cx; gold.y = g.cy - 1;
      g.carry = -1;
      this.emit({ t: 'goldDrop', g: g.id, x: gold.x, y: gold.y });
    }
  }

  private tickGuard(g: SimGuard): void {
    if (g.mode === 'dead') { if (--g.spawnTicks <= 0) this.spawnGuard(g); return; }
    if (g.mode === 'spawning') { if (--g.spawnTicks <= 0) g.mode = 'idle'; return; }
    if (!this.started) return;
    if (g.carry >= 0 && this.golds[g.carry].assisted) { if (++g.carryAge >= ASSIST_MAX_CARRY_TICKS) this.forceDrop(g); } else g.carryAge = 0;
    if (g.mode === 'trapped') { if (--g.trapTicks <= 0) g.mode = 'escape'; return; }
    g.acc += g.mode === 'fall' ? FALL_SPEED : this.guardSpeed;
    while (g.acc >= 1000) {
      g.acc -= 1000;
      if (!this.guardStep(g)) { g.acc = 0; break; }
      if ((g.mode as string) === 'trapped') { g.acc = 0; break; }
    }
  }

  /** Hard guarantee: hand assisted gold over at the nearest drop cell (BFS from the guard, else Manhattan). */
  private forceDrop(g: SimGuard): void {
    let pos: [number, number] | null = null;
    const seen = new Set<number>([g.cy * this.width + g.cx]), q: [number, number][] = [[g.cx, g.cy]];
    while (q.length && !pos) {
      const [x, y] = q.shift()!;
      if (this.canDrop(x, y)) { pos = [x, y]; break; }
      for (const [, nx, ny] of moveGraph(this, x, y, false)) {
        const k = ny * this.width + nx;
        if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    if (!pos) {
      let bd = Infinity;
      for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
        const d = Math.abs(x - g.cx) + Math.abs(y - g.cy);
        if (d < bd && this.canDrop(x, y)) { bd = d; pos = [x, y]; }
      }
    }
    if (!pos) return;
    const gold = this.golds[g.carry];
    gold.carriedBy = -1; gold.x = pos[0]; gold.y = pos[1];
    g.carry = -1; g.carryAge = 0; g.noPickX = pos[0]; g.noPickY = pos[1];
    this.emit({ t: 'goldDrop', g: g.id, x: pos[0], y: pos[1] });
  }

  private canDrop(x: number, y: number): boolean {
    return this.tile(x, y) === T.EMPTY && !this.goldAt(x, y) && this.standableTile(x, y + 1) && this.reach[y][x];
  }

  private guardStep(g: SimGuard): boolean {
    if (g.mode === 'escape') {
      if (g.oy <= 0 && g.cy <= g.holeY - 1) { g.mode = 'run'; g.escapeTicks = 30; g.dir = this.escapeDir(g); return true; }
      if (g.oy === 0 && (isSolid(this.tile(g.cx, g.cy - 1)) || this.guardAt(g.cx, g.cy - 1, g))) return false;
      g.mode = 'escape';
      g.oy--; if (g.oy < -HALF) { g.cy--; g.oy += SUB; }
      return true;
    }
    const exempt = g.holeX >= 0 && g.cx === g.holeX && g.cy === g.holeY - 1 && this.tile(g.holeX, g.holeY) === T.HOLE;
    if (!exempt) g.holeX = -1;
    if (!exempt && this.shouldFall(g)) {
      g.mode = 'fall';
      this.fallStep(g);
      if (g.oy === 0 && this.tile(g.cx, g.cy) === T.HOLE && !this.guardAt(g.cx, g.cy, g)) this.trapGuard(g);
      return true;
    }
    if (g.ox === 0 && g.oy === 0) {
      if (!exempt && this.tile(g.cx, g.cy) === T.HOLE && !this.guardAt(g.cx, g.cy, g)) { this.trapGuard(g); return true; }
      this.guardAtCenter(g);
      if (exempt) {
        if (g.escapeTicks-- <= 0) g.holeX = -1; // give up; fall back in
        if (!g.dir) g.dir = this.escapeDir(g);
      } else g.dir = this.decide(g);
    }
    if (!g.dir) { this.restMode(g, false, false); return false; }
    if (!this.tryMove(g, g.dir, true)) {
      if (g.ox !== 0 || g.oy !== 0) { // blocked mid-cell: back to center
        if (g.ox !== 0) g.ox -= sign(g.ox); else g.oy -= sign(g.oy);
        return true;
      }
      g.dir = exempt ? this.escapeDir(g, g.dir) : null;
      this.restMode(g, false, false);
      return false;
    }
    this.restMode(g, true, g.dir === 'U' || g.dir === 'D');
    return true;
  }

  private escapeDir(g: SimGuard, notDir?: Dir): Dir {
    const tgt = this.targetPlayer(g);
    const pref: Dir = tgt && tgt.cx < g.cx ? 'L' : 'R';
    const order: Dir[] = pref === 'L' ? ['L', 'R'] : ['R', 'L'];
    for (const d of order) {
      if (d === notDir) continue;
      const nx = g.cx + (d === 'L' ? -1 : 1);
      if (!isSolid(this.tile(nx, g.cy)) && !this.guardAt(nx, g.cy, g)) return d;
    }
    return null;
  }

  private guardAtCenter(g: SimGuard): void {
    if (g.cx !== g.noPickX || g.cy !== g.noPickY) { g.noPickX = -1; g.noPickY = -1; }
    const t = this.tile(g.cx, g.cy);
    if (g.carry < 0) {
      const gold = this.goldAt(g.cx, g.cy);
      if (gold && g.noPickX < 0 && t !== T.HOLE) {
        gold.carriedBy = g.id; g.carry = gold.id; g.carryTimer = this.rng.range(8, 36);
        this.emit({ t: 'guardGold', g: g.id, x: g.cx, y: g.cy });
      }
    } else {
      if (g.carryTimer > 0) g.carryTimer--;
      let dx: number | null = null;
      if (g.carryTimer <= 0) {
        if (this.canDrop(g.cx, g.cy)) dx = g.cx;
        // stuck (e.g. no route to a player) while standing where it can't drop: put the gold down beside it
        else if (g.mode === 'idle') dx = [g.cx - 1, g.cx + 1].find(x => x >= 0 && x < this.width && this.canDrop(x, g.cy)) ?? null;
      }
      if (dx !== null) {
        const gold = this.golds[g.carry];
        gold.carriedBy = -1; gold.x = dx; gold.y = g.cy;
        g.carry = -1; g.noPickX = dx; g.noPickY = g.cy;
        this.emit({ t: 'goldDrop', g: g.id, x: dx, y: g.cy });
      }
    }
  }

  targetPlayer(g: Actor): SimPlayer | undefined {
    let best: SimPlayer | undefined, bd = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = Math.abs(p.cy - g.cy) * 4 + Math.abs(p.cx - g.cx);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private decide(g: SimGuard): Dir {
    // Carrying gold whose drop time is up but not at a valid spot: head to nearest droppable cell.
    if (g.carry >= 0 && g.carryTimer <= 0) {
      const d = bfsFirstDir(this, g.cx, g.cy, (x, y) => this.canDrop(x, y));
      if (d) return d;
    }
    if (this.courier === g.id && g.carry < 0) {
      const gold = this.floorAssistedGold();
      if (gold) {
        const d = bfsFirstDir(this, g.cx, g.cy, (x, y) => x === gold.x && y === gold.y);
        if (d) return d;
      }
    }
    const tgt = this.targetPlayer(g);
    if (!tgt) return null;
    return classicGuardMove(this, g, tgt);
  }

  /** Pick a guard to fetch enemy-assisted gold; warp one to the top if none can reach it for 10 s. */
  private updateCourier(): void {
    const gold = this.floorAssistedGold();
    if (!gold) { this.courier = -1; this.assistStuck = 0; return; }
    const cur = this.guards[this.courier];
    if (this.tickCount % 30 === 0 || !cur || cur.mode === 'dead' || cur.carry >= 0) {
      this.courier = -1;
      let bestD = Infinity;
      for (const g of this.guards) {
        if (g.mode === 'dead' || g.carry >= 0) continue;
        const d = bfsDist(this, g.cx, g.cy, (x, y) => x === gold.x && y === gold.y);
        if (d >= 0 && d < bestD) { bestD = d; this.courier = g.id; }
      }
    }
    if (this.courier >= 0 || !this.started) { this.assistStuck = 0; return; }
    if (++this.assistStuck >= 600) {
      this.assistStuck = 0;
      const cand = this.guards.filter(g => g.carry < 0 && (g.mode === 'idle' || g.mode === 'run' || g.mode === 'climb' || g.mode === 'hang'));
      const g = cand[cand.length - 1];
      if (g) this.spawnGuard(g);
    }
  }

  // ---------- reachability ----------
  private computePlayerReach(): boolean[][] {
    const r = this.tiles.map(row => row.map(() => false));
    const q: [number, number][] = [];
    for (const p of this.players) { r[p.cy][p.cx] = true; q.push([p.cx, p.cy]); }
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [, nx, ny] of moveGraph(this, x, y, true)) {
        if (!r[ny][nx]) { r[ny][nx] = true; q.push([nx, ny]); }
      }
    }
    return r;
  }

  private emit(e: SimEvent): void { this.events.push(e); }
}
