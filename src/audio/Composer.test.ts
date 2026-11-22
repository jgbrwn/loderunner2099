import { describe, it, expect } from 'vitest';
import { composeSong, composeMenu, stingerNotes } from './Composer';

describe('Composer', () => {
  it('is deterministic and varies by seed', () => {
    const a = JSON.stringify(composeSong('ABC', 3, 'normal'));
    expect(JSON.stringify(composeSong('ABC', 3, 'normal'))).toBe(a);
    expect(JSON.stringify(composeSong('ABC', 4, 'normal'))).not.toBe(a);
  });
  it('produces sane notes in every section', () => {
    const styles = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = composeSong('seed' + i, i % 10, ['easy', 'normal', 'hard'][i % 3]);
      styles.add(s.style.name);
      expect(s.bpm).toBeGreaterThan(80);
      expect(s.bpm).toBeLessThan(175);
      for (const sec of [...s.sections, ...s.escape]) {
        expect(sec.steps.length).toBe(sec.bars * 16);
        const evs = sec.steps.flat();
        const pitched = evs.filter(e => !['kick', 'snare', 'hat', 'perc'].includes(e.ch));
        for (const e of pitched) {
          expect(Number.isFinite(e.midi)).toBe(true);
          expect(e.midi).toBeGreaterThanOrEqual(28);
          expect(e.midi).toBeLessThanOrEqual(108);
          expect(e.dur).toBeGreaterThan(0);
        }
        if (sec.name !== 'intro') expect(evs.some(e => e.ch === 'lead')).toBe(true);
        expect(evs.some(e => e.ch === 'bass')).toBe(true);
      }
      expect(s.escapeBpm).toBeGreaterThan(s.bpm);
    }
    expect(styles.size).toBe(4);
    expect(composeMenu().style.name).toBe('synthwave');
    expect(stingerNotes(composeMenu(), 'clear').length).toBe(5);
  });
});
