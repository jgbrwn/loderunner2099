import { describe, it, expect } from 'vitest';
import { TileMap } from '../src/level/TileMap';
import { analyzeLevel } from '../src/level/SolvabilityChecker';
import { LevelGenerator } from '../src/level/LevelGenerator';
import { TileType as T } from '../src/config';

// ' '=empty #=brick @=hard H=ladder -=pole x=trap $=gold P=start :=hidden exit
function parse(rows: string[]): TileMap {
  const m = new TileMap(rows[0].length, rows.length);
  const k: Record<string, T> = { ' ': T.EMPTY, '#': T.BRICK, '@': T.BRICK_HARD, H: T.LADDER, '-': T.POLE, x: T.BRICK_TRAP, $: T.GOLD };
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'P') m.playerStart = { x, y };
    else if (c === ':') m.exitLadders.push({ x, y });
    else { m.tiles[y][x] = k[c]; if (c === '$') m.goldPositions.push({ x, y }); }
  }));
  return m;
}

describe('solver', () => {
  it('walk + ladder + exit', () => {
    expect(analyzeLevel(parse([
      '   :  ',
      '   H  ',
      'P  H $',
      '@@@@@@']), []).solvable).toBe(true);
  });
  it('gold under a single brick: dig in, walk out', () => {
    const r = analyzeLevel(parse([
      ' :     ',
      ' H     ',
      ' H P   ',
      '@H@#@@@',
      '@H@$  @',
      '@H@###@',
      '@H     ',
      '@@@@@@@']), []);
    expect(r.solvable).toBe(true);
    expect(r.analysis!.digRequiredGold).toBe(1);
  });
  it('gold in a sealed pit = death trap', () => {
    expect(analyzeLevel(parse([
      ' :     ',
      ' H     ',
      ' H P   ',
      '@H@#@@@',
      '@H@$@  ',
      '@@@@@@@']), []).solvable).toBe(false);
  });
  it('one-way drop to gold with no way back fails exit', () => {
    expect(analyzeLevel(parse([
      ' :      ',
      ' H      ',
      ' H P    ',
      '@H@@@ @@',
      '@H   @$ ',
      '@@@@@@@@']), []).solvable).toBe(false);
  });
  it('two-layer trench dig', () => {
    expect(analyzeLevel(parse([
      ':        ',
      'H        ',
      'H   P    ',
      'H@@###@@@',
      'H@@###@@@',
      'H     $  ',
      '@@@@@@@@@']), []).solvable).toBe(true);
  });
  it('enemy-assisted gold on a sky ledge', () => {
    const m = parse([
      '         :',
      '  $      :',
      ' @@@     :',
      '         H',
      'P        H',
      '##########']);
    const r = analyzeLevel(m, undefined, 1);
    expect(r.solvable).toBe(true);
    expect(r.enemyAssistedPositions).toEqual([{ x: 2, y: 1 }]);
  });
});

describe('normal guard distribution', () => {
  const count = (seed: number, level: number): number => (new LevelGenerator(`GUARD${seed}`, 'normal', level) as any).enemyCount();
  it('favours two or three guards early, and lone guards become rarer later', () => {
    for (const [level, maxLone] of [[1, 0.24], [6, 0.15], [11, 0.07]]) {
      let lone = 0;
      for (let seed = 0; seed < 2000; seed++) if (count(seed, level) === 1) lone++;
      expect(lone / 2000).toBeLessThan(maxLone);
    }
    const rate = (level: number) => Array.from({ length: 1000 }, (_, i) => count(i + 3000, level)).filter(n => n === 1).length;
    expect(rate(11)).toBeLessThan(rate(1));
  });
  it('keeps other difficulties unchanged', () => {
    for (const d of ['easy', 'hard', 'ninja']) {
      const counts = Array.from({ length: 100 }, (_, i) => (new LevelGenerator(`OTHER${i}`, d, 10) as any).enemyCount());
      expect(Math.min(...counts)).toBeGreaterThanOrEqual(d === 'easy' ? 1 : d === 'hard' ? 2 : 3);
    }
  });
});

describe('generator', () => {
  it('deterministic and solvable', () => {
    for (const d of ['easy', 'normal', 'hard', 'ninja']) for (let s = 0; s < 25; s++) {
      const a = new LevelGenerator(`T${s}`, d, 3).generateWithInfo();
      const b = new LevelGenerator(`T${s}`, d, 3).generateWithInfo();
      expect(JSON.stringify(a.map.tiles)).toBe(JSON.stringify(b.map.tiles));
      expect(analyzeLevel(a.map, a.map.enemyAssistedGoldPositions, 3).solvable).toBe(true);
    }
  });
});
