// Trap/assist check: npx esbuild tools/trapcheck.ts --bundle --platform=node --outfile=/tmp/tc.cjs && node /tmp/tc.cjs [seeds]
// (A) guard-assisted gold: idle player (unkillable), do guards deliver each assisted gold to a player-reachable cell?
// (B) trap pits: player-reachable trap cells from which the exit can't be reached / gold is lost.
declare const process: { argv: string[] };
import { LevelGenerator } from '../src/level/LevelGenerator';
import { analyzeLevel, maxEnemyAssistedGold, MoveGraph } from '../src/level/SolvabilityChecker';
import { TileType as T } from '../src/config';
import { World } from '../src/sim/World';
import { NO_INPUT, TICK_HZ } from '../src/sim/types';

const nSeeds = +(process.argv[2] ?? 200);
const LIMIT = +(process.argv[3] ?? 60);
for (const diff of ['normal', 'hard', 'ninja']) {
  let aTot = 0, aDel = 0, exitPits = 0, goldPits = 0;
  const failA: string[] = [], failB: string[] = []; const why: Record<string, number> = {};
  for (let s = 0; s < nSeeds; s++) {
    const seed = `S${s}-L${1 + (s % 10)}`;
    const map = new LevelGenerator(seed, diff, 1 + (s % 10)).generateWithInfo().map;
    const W = map.width;
    const res = analyzeLevel(map, map.enemyAssistedGoldPositions, maxEnemyAssistedGold(diff));
    const an = res.analysis!;
    // (B)
    const g = new MoveGraph(map, false);
    const golds: number[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < W; x++) if (map.tiles[y][x] === T.GOLD) golds.push(y * W + x);
    let ep = false, gp = false;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (map.tiles[y][x] !== T.BRICK_TRAP || !an.reachNoDig[i]) continue;
      if (!an.canExit[i]) ep = true;
      const r = g.bfs([i]);
      if (golds.some(k => an.reach[k] && !r[k]) && !r[map.playerStart.y * W + map.playerStart.x]) gp = true;
    }
    if (ep) { exitPits++; failB.push(seed + '(exit)'); } else if (gp) { goldPits++; failB.push(seed + '(gold)'); }
    // (A)
    const assisted = map.enemyAssistedGoldPositions;
    if (!assisted.length) continue;
    const w = new World(map, { seed: 1 } as any);
    // unkillable player that keeps relocating to safe cells (keeps guards moving, like a live player)
    let rs = s * 7919 + 1;
    const hop = () => { const p = w.players[0], c = map.goldDropCells[(rs = (rs * 1103515245 + 12345) & 0x7fffffff) % map.goldDropCells.length]; p.cx = c.x; p.cy = c.y; p.ox = 0; p.oy = 0; p.mode = 'idle' as any; };
    (w as any).killPlayer = hop;
    w.started = true;
    const reach = (x: number, y: number) => an.reach[y * W + x] || map.goldDropCells.some(c => c.x === x && c.y === y);
    const ag = w.golds.filter(o => o.assisted);
    const delivered = new Set<number>(); // ever dropped on a player-reachable cell
    const done = () => ag.every(o => o.collected || delivered.has(o.id) || (o.carriedBy < 0 && reach(o.x, o.y) && !(assisted.some(a => a.x === o.x && a.y === o.y))));
    for (let t = 0; t < LIMIT * TICK_HZ && !done(); t++) { w.tick([NO_INPUT]); for (const e of w.drainEvents()) if (e.t === 'goldDrop' && reach(e.x, e.y)) for (const o of ag) if (o.x === e.x && o.y === e.y && o.carriedBy < 0) delivered.add(o.id); if (t % (4 * TICK_HZ) === 0) hop(); }
    const ok = ag.filter(o => o.collected || delivered.has(o.id) || (o.carriedBy < 0 && reach(o.x, o.y) && !assisted.some(a => a.x === o.x && a.y === o.y))).length;
    aTot += ag.length; aDel += ok;
    if (ok < ag.length) { failA.push(seed); for (const o of ag) { const orig = assisted.some(a => a.x === o.x && a.y === o.y); const k = o.collected || delivered.has(o.id) ? 'C' : o.collected ? 'C' : o.carriedBy >= 0 ? 'carried' : orig ? 'untouched' : reach(o.x, o.y) ? 'ok' : 'badDrop'; why[k] = (why[k] ?? 0) + 1; } }
  }
  console.log(`${diff}: assisted delivered ${aDel}/${aTot} (${aTot ? (100 * aDel / aTot).toFixed(1) : '-'}%) why=${JSON.stringify(why)} fail=[${failA.slice(0, 12).join(' ')}]`);
  console.log(`   trap pits: exit-softlock levels=${exitPits} gold-loss levels=${goldPits} [${failB.slice(0, 10).join(' ')}]`);
}
