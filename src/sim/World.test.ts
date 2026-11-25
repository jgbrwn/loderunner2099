import { describe, it, expect } from 'vitest';
import { TileType } from '../config';
import { TileMap } from '../level/TileMap';
import { LevelGenerator } from '../level/LevelGenerator';
import { SeededRandom } from '../utils/SeededRandom';
import { World } from './World';
import { NO_INPUT, type SimEvent, type SimInput } from './types';

// Legend: . empty  # brick  = hard  H ladder  - pole  X trap  $ gold  P player  E guard  A assisted gold
function mapFrom(rows: string[]): TileMap {
  const m = new TileMap(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    const t = ({ '#': TileType.BRICK, '=': TileType.BRICK_HARD, H: TileType.LADDER, '-': TileType.POLE, X: TileType.BRICK_TRAP } as Record<string, TileType>)[c];
    if (t !== undefined) m.setTile(x, y, t);
    if (c === '$' || c === 'A') m.goldPositions.push({ x, y });
    if (c === 'A') m.enemyAssistedGoldPositions.push({ x, y });
    if (c === 'P') m.playerStart = { x, y };
    if (c === 'E') m.enemyStarts.push({ x, y });
  }));
  return m;
}
const inp = (p: Partial<SimInput>): SimInput => ({ ...NO_INPUT, ...p });
function run(w: World, n: number, input: SimInput = NO_INPUT, log?: SimEvent[]) {
  for (let i = 0; i < n; i++) { w.tick([input]); const e = w.drainEvents(); log?.push(...e); }
}

describe('sim', () => {
  it('guard is trapped in a hole in an elevated single-thickness floor', () => {
    const w = new World(mapFrom([
      '..........',
      '.P....E...',
      '##########',
      '..........',
      '==========',
    ]), { seed: 1 });
    run(w, 2, inp({ digRight: true }));
    const log: SimEvent[] = [];
    let maxY = 0;
    for (let i = 0; i < 250; i++) { run(w, 1, NO_INPUT, log); maxY = Math.max(maxY, w.guards[0].cy); }
    expect(log.some(e => e.t === 'holeOpen' && e.x === 2 && e.y === 2)).toBe(true);
    expect(log.some(e => e.t === 'trap')).toBe(true);
    expect(maxY).toBe(2);
    expect(w.players[0].score).toBeGreaterThanOrEqual(75);
  });

  for (const holeTime of [1, 0.6]) it(`buried gold (holeTime ${holeTime}): trench through a 2-thick roof, pocket to pocket, grab gold, dig out the bottom`, () => {
    const w = new World(mapFrom([
      '..............',
      '.P............',
      '##############',
      '##############',
      '####...#######',
      '##############',
      '##############',
      '######.$######',
      '##############',
      '..............',
      '==============',
    ]), { seed: 1, holeTime });
    const p = w.players[0];
    const settle = () => { for (let i = 0; i < 60 && (w.shouldFall(p) || p.ox !== 0 || p.oy !== 0 || p.mode === 'dig'); i++) run(w, 1); };
    const walkTo = (x: number) => {
      for (let i = 0; i < 200 && p.cx !== x; i++) run(w, 1, inp(p.cx < x ? { right: true } : { left: true }));
      settle();
    };
    const dig = (d: -1 | 1) => { run(w, 1, inp(d < 0 ? { digLeft: true } : { digRight: true })); settle(); };
    walkTo(3); dig(1);            // hole (4,2)
    walkTo(2); dig(1);            // hole (3,2)
    walkTo(3);                    // drop into (3,2), stand on (3,3)
    expect([p.cx, p.cy]).toEqual([3, 2]);
    dig(1);                       // hole (4,3) under the first hole
    walkTo(4);                    // fall through into pocket 0
    expect([p.cx, p.cy]).toEqual([4, 4]);
    walkTo(5); dig(1);            // hole (6,5)
    walkTo(4); dig(1);            // hole (5,5)
    walkTo(5);                    // drop into (5,5)
    expect([p.cx, p.cy]).toEqual([5, 5]);
    dig(1);                       // hole (6,6)
    walkTo(6);                    // fall into pocket 1
    expect([p.cx, p.cy]).toEqual([6, 7]);
    walkTo(7);                    // gold
    expect(w.players[0].score).toBeGreaterThan(0);
    dig(-1);                      // dig the pocket floor at the gold's level
    walkTo(6);                    // ...and drop out underneath
    expect(p.alive).toBe(true);
    expect([p.cx, p.cy]).toEqual([6, 9]);
  });

  it('trap brick can be entered from the side and fallen through', () => {
    const w = new World(mapFrom([
      'PX.....$',
      '#X######',
      '=.=.....',
      '========',
    ]), { seed: 1 });
    run(w, 40, inp({ right: true }));
    run(w, 40);
    expect(w.players[0].cx).toBe(1);
    expect(w.players[0].cy).toBe(2);
    expect(w.tile(1, 0)).toBe(TileType.BRICK_TRAP);
  });

  it('player falls through his own hole when nothing is below', () => {
    const w = new World(mapFrom([
      '.P.......$',
      '##########',
      '..........',
      '==========',
    ]), { seed: 1 });
    run(w, 1, inp({ digRight: true }));
    run(w, 30);
    expect(w.tile(2, 1)).toBe(TileType.HOLE);
    run(w, 60, inp({ right: true }));
    run(w, 30);
    expect(w.players[0].cy).toBe(2);
    expect(w.players[0].alive).toBe(true);
  });

  it('cannot dig with something on top of the brick', () => {
    const w = new World(mapFrom(['P$..', '####', '====']), { seed: 1 });
    run(w, 1, inp({ digRight: true }));
    run(w, 30);
    expect(w.tile(1, 1)).toBe(TileType.BRICK);
  });

  it('hole refilling on the player kills him', () => {
    const w = new World(mapFrom(['P...$', '#####', '#####']), { seed: 1 });
    const log: SimEvent[] = [];
    run(w, 1, inp({ digRight: true }), log);
    run(w, 30, NO_INPUT, log);
    run(w, 30, inp({ right: true }), log);
    expect(w.players[0].cy).toBe(1);
    run(w, 400, NO_INPUT, log);
    expect(log.some(e => e.t === 'playerDeath')).toBe(true);
    expect(w.status).toBe('failed');
  });

  it('guard killed by refilling hole respawns at the top', () => {
    const w = new World(mapFrom([
      '..........',
      '..........',
      'P.......E.',
      '##########',
      '==========',
    ]), { seed: 7 });
    w.started = true;
    const g = w.guards[0];
    (w as any).openHole(8, 3, 0);
    const log: SimEvent[] = [];
    run(w, 40, NO_INPUT, log);
    expect(g.mode).toBe('trapped');
    w.holes[0].ticks = 5;
    run(w, 10, NO_INPUT, log);
    expect(log.some(e => e.t === 'guardDeath')).toBe(true);
    run(w, 200, NO_INPUT, log);
    const sp = log.find(e => e.t === 'guardSpawn') as Extract<SimEvent, { t: 'guardSpawn' }>;
    expect(sp?.y).toBe(0);
    expect(w.players[0].score).toBe(150);
  });

  it('trapped guard drops carried gold above the hole', () => {
    const w = new World(mapFrom([
      '..........',
      'P...$...E.',
      '##########',
      '==========',
    ]), { seed: 3 });
    w.started = true;
    (w as any).openHole(2, 2, 0);
    const log: SimEvent[] = [];
    run(w, 200, NO_INPUT, log);
    expect(log.some(e => e.t === 'guardGold')).toBe(true);
    expect(log.some(e => e.t === 'goldDrop' && e.x === 2 && e.y === 1)).toBe(true);
  });

  it('enemy-assisted gold is fetched and dropped at a player-reachable spot', () => {
    const w = new World(mapFrom([
      '....................',
      '....................',
      '...........A........',
      '...........=........',
      '....................',
      'P..=......E.........',
      '====================',
    ]), { seed: 5 });
    w.started = true;
    expect(w.reach[2][11]).toBe(false);
    w.reach[5][15] = true;
    const log: SimEvent[] = [];
    run(w, 3000, NO_INPUT, log);
    expect(log.some(e => e.t === 'guardGold')).toBe(true);
    const drop = log.find(e => e.t === 'goldDrop') as Extract<SimEvent, { t: 'goldDrop' }>;
    expect(drop).toBeTruthy();
    expect(w.reach[drop.y][drop.x]).toBe(true);
  });

  it('is deterministic for the same seed and inputs, on generated levels', () => {
    for (const seed of ['ABCDEF', 'QWERTY', 'ZZ9XK2']) {
      const lvl = new LevelGenerator(`${seed}-L1`, 'hard', 1).generateWithInfo().map;
      const a = new World(lvl, { seed, enemySpeed: 1.2, holeTime: 0.8 });
      const b = new World(lvl, { seed, enemySpeed: 1.2, holeTime: 0.8 });
      const r = new SeededRandom(seed);
      let cur = NO_INPUT;
      for (let i = 0; i < 3000; i++) {
        if (i % 20 === 0) cur = inp({ left: r.chance(0.3), right: r.chance(0.3), up: r.chance(0.3), down: r.chance(0.2), digLeft: r.chance(0.1), digRight: r.chance(0.1) });
        a.tick([cur]); b.tick([cur]); a.drainEvents(); b.drainEvents();
        for (const g of a.guards) if (g.mode === 'trapped') expect(a.tile(g.cx, g.cy)).toBe(TileType.HOLE);
      }
      expect(a.snapshot()).toBe(b.snapshot());
    }
  });
});

describe('enemy-assisted gold on generated levels', () => {
  it('a guard picks it up and drops it only on drop cells', () => {
    let tested = 0, delivered = 0;
    for (let i = 0; i < 60 && tested < 6; i++) {
      const lvl = new LevelGenerator(`AS${i}-L3`, i % 2 ? 'ninja' : 'hard', 3).generateWithInfo().map;
      if (!lvl.enemyAssistedGoldPositions.length) continue;
      tested++;
      const w = new World(lvl, { seed: i });
      w.started = true;
      // Keep the idle player out of harm's way so the run isn't cut short.
      w.players[0].cx = -5; w.players[0].cy = -5;
      const log: SimEvent[] = [];
      for (let t = 0; t < 4000 && !log.some(e => e.t === 'goldDrop'); t++) { w.tick([]); log.push(...w.drainEvents()); }
      const assisted = new Set(lvl.enemyAssistedGoldPositions.map(g => `${g.x},${g.y}`));
      const pick = log.find(e => e.t === 'guardGold' && assisted.has(`${e.x},${e.y}`));
      expect(pick, `seed AS${i}`).toBeTruthy();
      for (const e of log) if (e.t === 'goldDrop') { expect(lvl.isGoldDropCell(e.x, e.y)).toBe(true); delivered++; }
    }
    console.log("assisted tested", tested, "delivered", delivered);
    expect(tested).toBeGreaterThan(0);
    expect(delivered).toBeGreaterThan(0);
  });
});

describe('last-gold section', () => {
  // drop-in room (hard walls) whose only way out is the hidden ladder in its mouth shaft
  const room = () => {
    const m = mapFrom([
      '..........',
      '..........',
      '..P.......',
      '#####.====',
      '=.....=...',
      '=$....=...',
      '==========',
    ]);
    for (let y = 0; y <= 5; y++) m.exitLadders.push({ x: 5, y });
    return m;
  };
  it('falling in before the rest of the gold leaves you stuck; last gold opens the shaft ladder out', () => {
    const w = new World(room(), { seed: 't', players: 1 });
    const log: SimEvent[] = [];
    run(w, 120, inp({ right: true }), log);
    expect([w.players[0].cx, w.players[0].cy]).toEqual([5, 5]);
    run(w, 120, inp({ up: true }), log);
    expect(w.players[0].cy).toBe(5);              // no way up yet
    run(w, 160, inp({ left: true }), log);        // grab the (last) gold
    expect(log.some(e => e.t === 'exitReveal')).toBe(true);
    run(w, 160, inp({ right: true }), log);
    run(w, 300, inp({ up: true }), log);
    expect(log.some(e => e.t === 'complete')).toBe(true);
  });
  it('generator: forced last sections are one-way rooms with a hidden ladder escape and stay solvable', async () => {
    const { DIFFICULTIES } = await import('../config');
    const { analyzeLevel, MoveGraph } = await import('../level/SolvabilityChecker');
    const keep = DIFFICULTIES.normal.lastSection;
    DIFFICULTIES.normal.lastSection = 1;
    try {
      let built = 0;
      for (let s = 0; s < 12; s++) {
        const m = new LevelGenerator(`LS${s}`, 'normal', 5).generate();
        expect(analyzeLevel(m, m.enemyAssistedGoldPositions).solvable).toBe(true);
        const r = m.lastSection;
        if (!r) continue;
        built++;
        const W = m.width, start = m.playerStart.y * W + m.playerStart.x, inside = r.y1 * W + (r.mx === r.x1 ? r.x0 : r.x1);
        expect(m.goldPositions.some(g => g.x >= r.x0 && g.x <= r.x1 && g.y === r.y1)).toBe(true);
        const g = new MoveGraph(m, false);
        expect(g.bfs([start])[inside]).toBe(1);         // you can drop in
        expect(g.bfs([inside])[start]).toBe(0);         // ...but not get back out
        expect(new MoveGraph(m, true).bfs([inside])[start]).toBe(1); // until the ladder shows
      }
      expect(built).toBeGreaterThan(8);
    } finally { DIFFICULTIES.normal.lastSection = keep; }
  });
});
