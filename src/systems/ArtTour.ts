// "Auto Tour": every level gets a fresh, randomly ordered environment. Purely visual — derived from its own
// hash of the seed so it never touches LevelGenerator's RNG (layouts, gold, guards and shared seeds are unaffected).
import { Rng } from '../graphics/color';

export const AUTO = 'auto';
/** Every environment participates in Auto Tour, including the Classic C64 palette. */
export const TOUR_POOL = ['cyber', 'dungeon', 'palace', 'foundry', 'neon', 'matrix', 'sunset', 'classic'];
const VERSION = 'art2';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** chapter = Auto Tour level index; visit = earlier stops using this key (picks the backdrop variant). */
export interface TourStop { key: string; chapter: number; first: boolean; visit: number }

/** Environment for `level` (1-based) of the run with `seed`. A shuffled bag gives every level a different
 *  environment and avoids a repeat at bag boundaries. Deterministic per seed/level, including death retries. */
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
    const len = 1;
    if (level < start + len) return { key, chapter, first: level === start, visit: visits[key] ?? 0 };
    visits[key] = (visits[key] ?? 0) + 1;
    last = key; start += len; chapter++;
  }
}

/** Fixed-theme backdrop chapters retain their original 2–3-level rhythm independently of the Auto Tour schedule. */
export function backdropChapter(seed: string, level: number): number {
  const rng = new Rng(hash(`${seed}|${VERSION}|backdrop`));
  let start = 1, chapter = 0;
  while (level >= start) {
    const len = rng.next() < 0.5 ? 2 : 3;
    if (level < start + len) return chapter;
    start += len; chapter++;
  }
  return 0;
}
