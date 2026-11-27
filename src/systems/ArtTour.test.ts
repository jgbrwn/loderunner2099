import { describe, it, expect } from 'vitest';
import { tourAt, TOUR_POOL } from './ArtTour';
import { LevelGenerator } from '../level/LevelGenerator';

describe('ArtTour', () => {
  it('is deterministic, chapters last 2–3 levels, no back-to-back repeats, every set appears', () => {
    for (const seed of ['ABC', 'XYZ123', 'DAILY-2026-11-27', '']) {
      expect(tourAt(seed, 7)).toEqual(tourAt(seed, 7));
      const stops = Array.from({ length: 60 }, (_, i) => tourAt(seed, i + 1));
      let runLen = 1;
      for (let i = 1; i < stops.length; i++) {
        if (stops[i].chapter === stops[i - 1].chapter) { runLen++; expect(stops[i].key).toBe(stops[i - 1].key); expect(stops[i].first).toBe(false); }
        else { expect([2, 3]).toContain(runLen); expect(stops[i].key).not.toBe(stops[i - 1].key); expect(stops[i].first).toBe(true); runLen = 1; }
      }
      expect(new Set(stops.slice(0, 21).map(s => s.key)).size).toBe(TOUR_POOL.length);
    }
  });
  it('does not affect level generation', () => {
    const a = new LevelGenerator('ABC-L3', 'normal', 3).generateWithInfo().map;
    tourAt('ABC', 3);
    const b = new LevelGenerator('ABC-L3', 'normal', 3).generateWithInfo().map;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
