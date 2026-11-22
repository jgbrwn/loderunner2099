import { describe, it, expect } from 'vitest';
import { DIFFICULTIES } from '../config';
import { LevelGenerator } from '../level/LevelGenerator';
import { World } from '../sim/World';
import { botInput } from './bot';

describe('attract bot', () => {
  it('collects gold on most boards', () => {
    let total = 0, got = 0;
    for (let i = 0; i < 6; i++) {
      const seed = `BOT${i}`;
      const map = new LevelGenerator(seed, 'easy', 1).generateWithInfo(1).map;
      const d = DIFFICULTIES.easy;
      const w = new World(map, { seed, players: 1, enemySpeed: d.enemySpeed, holeTime: d.holeTime });
      const memo = { dir: null as any, at: -99 };
      for (let t = 0; t < 60 * 60 && w.status === 'playing'; t++) w.tick([botInput(w, memo)]);
      total += w.golds.length; got += w.golds.filter(g => g.collected).length;
    }
    console.log(`bot gold ${got}/${total}`);
    expect(got).toBeGreaterThan(total / 2);
  });
});
