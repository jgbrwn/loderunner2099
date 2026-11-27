// "Auto Tour": the level art changes every 2–3 levels. Purely visual — derived from its own hash of the seed so
// it never touches LevelGenerator's RNG (layouts, gold, guards and shared seeds are unaffected).
import { Rng } from '../graphics/color';

export const AUTO = 'auto';
/** environments in the tour (Classic C64 is fixed-choice only) */
export const TOUR_POOL = ['cyber', 'dungeon', 'palace', 'foundry', 'neon', 'matrix', 'sunset'];
const VERSION = 'art1';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** chapter = index of the 2–3 level block; visit = how many earlier chapters used this same key (picks the backdrop variant) */
export interface TourStop { key: string; chapter: number; first: boolean; visit: number }

/** Environment for `level` (1-based) of the run with `seed`. Shuffled bag, chapters of 2–3 levels, no repeats back-to-back. */
export function tourAt(seed: string, level: number, pool: string[] = TOUR_POOL): TourStop {
  const rng = new Rng(hash(`${seed}|${VERSION}`));
  let bag: string[] = [], last = '', start = 1, chapter = 0;
  const visits: Record<string, number> = {};
  for (;;) {
    if (!bag.length) {
      bag = pool.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag[0] === last && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    const key = bag.shift()!;
    const len = rng.next() < 0.5 ? 2 : 3;
    if (level < start + len) return { key, chapter, first: level === start, visit: visits[key] ?? 0 };
    visits[key] = (visits[key] ?? 0) + 1;
    last = key; start += len; chapter++;
  }
}
