import { describe, it, expect } from 'vitest';
import { backdropChapter, tourAt, TOUR_POOL } from './ArtTour';
import { LevelGenerator } from '../level/LevelGenerator';

describe('ArtTour', () => {
  it('is deterministic, changes every level, and shuffles every set before repeating one', () => {
    for (const seed of ['ABC', 'XYZ123', 'DAILY-2026-11-27', '']) {
      expect(tourAt(seed, 7)).toEqual(tourAt(seed, 7));
      const stops = Array.from({ length: 60 }, (_, i) => tourAt(seed, i + 1));
      for (let i = 0; i < stops.length; i++) {
        expect(stops[i].chapter).toBe(i);
        expect(stops[i].first).toBe(true);
        if (i) expect(stops[i].key).not.toBe(stops[i - 1].key);
      }
      for (let start = 0; start < stops.length; start += TOUR_POOL.length) {
        const bag = stops.slice(start, start + TOUR_POOL.length);
        if (bag.length === TOUR_POOL.length) expect(new Set(bag.map(s => s.key)).size).toBe(TOUR_POOL.length);
      }
    }
  });
  it('alternates a set\'s backdrop on return visits', () => {
    const stops = Array.from({ length: TOUR_POOL.length * 4 }, (_, i) => tourAt('ABC', i + 1));
    for (const key of TOUR_POOL) expect(stops.filter(s => s.key === key).map(s => s.visit)).toEqual([0, 1, 2, 3]);
  });
  it('avoids adjacent duplicates even for a one-set custom pool', () => {
    expect(tourAt('ABC', 1, ['classic']).key).toBe('classic');
    expect(tourAt('ABC', 2, ['classic']).key).toBe('classic');
  });
  it('keeps fixed-theme backdrop chapters at 2–3 levels', () => {
    for (const seed of ['ABC', 'XYZ123', '']) {
      const chapters = Array.from({ length: 50 }, (_, i) => backdropChapter(seed, i + 1));
      expect(chapters[0]).toBe(0);
      let runLength = 1;
      for (let i = 1; i < chapters.length; i++) {
        expect(chapters[i] - chapters[i - 1]).toBeGreaterThanOrEqual(0);
        expect(chapters[i] - chapters[i - 1]).toBeLessThanOrEqual(1);
        if (chapters[i] === chapters[i - 1]) runLength++;
        else { expect([2, 3]).toContain(runLength); runLength = 1; }
      }
    }
  });
  it('does not affect level generation', () => {
    const a = new LevelGenerator('ABC-L3', 'normal', 3).generateWithInfo().map;
    tourAt('ABC', 3);
    const b = new LevelGenerator('ABC-L3', 'normal', 3).generateWithInfo().map;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
