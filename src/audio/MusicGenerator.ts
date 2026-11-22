/**
 * Legacy shim: scenes used `new MusicGenerator(seed, level, diff).generate()` + `playMusic(track)`.
 * Real composition now lives in Composer.ts; the track just carries the seed info.
 */
import { composeSong } from './Composer';
export { midiToFrequency } from './Composer';

export interface MusicNote { pitch: number; startTime: number; duration: number; velocity: number }

export interface MusicTrack {
  melody: MusicNote[];
  bass: MusicNote[];
  arpeggio: MusicNote[];
  tempo: number;
  loopDuration: number;
  key: number;
  seed: string;
  level: number;
  difficulty: string;
}

export class MusicGenerator {
  constructor(private seed: string, private level: number, private difficulty: string) {}
  generate(): MusicTrack {
    const s = composeSong(this.seed, this.level, this.difficulty);
    return {
      melody: [], bass: [], arpeggio: [], tempo: s.bpm, loopDuration: 0, key: s.key,
      seed: this.seed, level: this.level, difficulty: this.difficulty,
    };
  }
}
