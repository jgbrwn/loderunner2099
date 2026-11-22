// Headless level stats: npx esbuild tools/levelstats.ts --bundle --platform=node --outfile=/tmp/ls.cjs && node /tmp/ls.cjs [seeds] [render]
declare const process: { argv: string[] };
import { LevelGenerator, LevelStats } from '../src/level/LevelGenerator';
import { analyzeLevel, maxEnemyAssistedGold } from '../src/level/SolvabilityChecker';
import { TileMap } from '../src/level/TileMap';
import { TileType as T } from '../src/config';

export function renderAscii(m: TileMap): string {
  const ch: Record<number, string> = { [T.EMPTY]: ' ', [T.BRICK]: '#', [T.BRICK_HARD]: '@', [T.LADDER]: 'H', [T.POLE]: '-', [T.BRICK_TRAP]: 'x', [T.GOLD]: '$' };
  const rows = m.tiles.map(r => r.map(t => ch[t] ?? '?'));
  for (const e of m.exitLadders) rows[e.y][e.x] = ':';
  for (const g of m.enemyAssistedGoldPositions) rows[g.y][g.x] = '%';
  for (const e of m.enemyStarts) rows[e.y][e.x] = 'E';
  rows[m.playerStart.y][m.playerStart.x] = 'P';
  return rows.map(r => '|' + r.join('') + '|').join('\n');
}

const nSeeds = +(process.argv[2] ?? 500), nRender = +(process.argv[3] ?? 0);
for (const diff of ['easy', 'normal', 'hard', 'ninja']) {
  const times: number[] = []; let unsolved = 0, fb = 0;
  const sum: Record<string, number> = {};
  for (let s = 0; s < nSeeds; s++) {
    const seed = `S${s}-L${1 + (s % 10)}`;
    const t0 = performance.now();
    const gen = new LevelGenerator(seed, diff, 1 + (s % 10));
    const { map, stats } = gen.generateWithInfo();
    times.push(performance.now() - t0);
    const r = analyzeLevel(map, map.enemyAssistedGoldPositions, maxEnemyAssistedGold(diff));
    if (!r.solvable) { unsolved++; if (unsolved <= 2) console.log('UNSOLVED', diff, seed, r.debug); }
    if (stats!.fallback) fb++;
    for (const [k, v] of Object.entries(stats as LevelStats)) sum[k] = (sum[k] ?? 0) + (v as number);
    if (s < nRender) console.log(`${diff} ${seed} ${(gen as any).lastArch} ${r.debug}\n${renderAscii(map)}`);
  }
  times.sort((a, b) => a - b);
  const avg = Object.entries(sum).map(([k, v]) => `${k}=${(v / nSeeds).toFixed(2)}`).join(' ');
  console.log(`${diff.padEnd(6)} solved=${((1 - unsolved / nSeeds) * 100).toFixed(2)}% fallback=${fb} p50=${times[nSeeds >> 1].toFixed(1)}ms p95=${times[Math.floor(nSeeds * 0.95)].toFixed(1)}ms max=${times[nSeeds - 1].toFixed(0)}ms\n   ${avg}`);
}
