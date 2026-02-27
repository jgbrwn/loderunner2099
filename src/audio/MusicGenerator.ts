import { SeededRandom } from '../utils/SeededRandom';

/**
 * Procedural music generator for Lode Runner 2099.
 * Generates deterministic retro chiptune music from a seed.
 */

export interface MusicNote {
  pitch: number;      // MIDI note number (60 = middle C)
  startTime: number;  // seconds from loop start
  duration: number;   // note length in seconds
  velocity: number;   // 0-1 volume
}

export interface MusicTrack {
  melody: MusicNote[];
  bass: MusicNote[];
  arpeggio: MusicNote[];
  tempo: number;        // BPM
  loopDuration: number; // seconds
  key: number;          // root note (0-11, 0=C)
}

// Scale definitions (intervals from root)
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],           // Natural minor
  pentatonic: [0, 3, 5, 7, 10],            // Minor pentatonic (safe, always sounds good)
  dorian: [0, 2, 3, 5, 7, 9, 10],          // Dorian (classic game feel)
  phrygian: [0, 1, 3, 5, 7, 8, 10],        // Phrygian (darker, intense)
  major: [0, 2, 4, 5, 7, 9, 11],           // Major (brighter)
};

// Bass pattern types
type BassPattern = 'root-fifth' | 'octave-pulse' | 'walking' | 'arpeggio';

// Melody rhythm patterns (in 16th notes, 1 = note, 0 = rest)
const MELODY_RHYTHMS = [
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],  // Steady 8ths
  [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],  // Syncopated
  [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0],  // Driving
  [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],  // Bouncy
  [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],  // Sparse
  [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0],  // Triplet feel
];

// Chord progressions (scale degrees, 0-indexed)
const CHORD_PROGRESSIONS = [
  [0, 3, 4, 4],    // i - iv - v - v
  [0, 5, 3, 4],    // i - VI - iv - v
  [0, 0, 3, 4],    // i - i - iv - v
  [0, 3, 0, 4],    // i - iv - i - v
  [0, 4, 5, 3],    // i - v - VI - iv
  [0, 2, 3, 4],    // i - iii - iv - v
];

export class MusicGenerator {
  private rng: SeededRandom;
  private difficulty: string;
  
  constructor(seed: string | number, levelNumber: number, difficulty: string = 'normal') {
    // Combine seed with level for unique music per level
    this.rng = new SeededRandom(`${seed}-music-${levelNumber}`);
    this.difficulty = difficulty;
  }
  
  /**
   * Generate a complete music track for the level
   */
  generate(): MusicTrack {
    const key = this.rng.range(0, 12);  // Random key
    const scale = this.selectScale();
    const tempo = this.selectTempo();
    const bars = 4;  // 4 bar loop
    const beatsPerBar = 4;
    const sixteenthsPerBeat = 4;
    const totalSixteenths = bars * beatsPerBar * sixteenthsPerBeat;
    const sixteenthDuration = 60 / tempo / 4;  // Duration of one 16th note
    const loopDuration = totalSixteenths * sixteenthDuration;
    
    // Select patterns
    const chordProgression = this.rng.pick(CHORD_PROGRESSIONS);
    const melodyRhythm = this.rng.pick(MELODY_RHYTHMS);
    const bassPattern = this.selectBassPattern();
    
    // Generate tracks
    const melody = this.generateMelody(key, scale, melodyRhythm, chordProgression, totalSixteenths, sixteenthDuration);
    const bass = this.generateBass(key, scale, bassPattern, chordProgression, totalSixteenths, sixteenthDuration);
    const arpeggio = this.generateArpeggio(key, scale, chordProgression, totalSixteenths, sixteenthDuration);
    
    return {
      melody,
      bass,
      arpeggio,
      tempo,
      loopDuration,
      key
    };
  }
  
  private selectScale(): number[] {
    const scaleWeights: { [key: string]: number } = {
      easy: 0,    // Pentatonic/major (safe)
      normal: 1,  // Minor/dorian
      hard: 2,    // Dorian/phrygian
      ninja: 3    // Phrygian (intense)
    };
    
    const weight = scaleWeights[this.difficulty] ?? 1;
    const scales = [
      [SCALES.pentatonic, SCALES.major],           // Easy
      [SCALES.minor, SCALES.dorian],               // Normal
      [SCALES.dorian, SCALES.phrygian],            // Hard
      [SCALES.phrygian, SCALES.minor],             // Ninja
    ];
    
    return this.rng.pick(scales[weight]);
  }
  
  private selectTempo(): number {
    const tempoRanges: { [key: string]: [number, number] } = {
      easy: [100, 120],
      normal: [120, 140],
      hard: [140, 160],
      ninja: [160, 180]
    };
    
    const [min, max] = tempoRanges[this.difficulty] ?? [120, 140];
    return this.rng.range(min, max + 1);
  }
  
  private selectBassPattern(): BassPattern {
    const patterns: BassPattern[] = ['root-fifth', 'octave-pulse', 'walking', 'arpeggio'];
    return this.rng.pick(patterns);
  }
  
  private generateMelody(
    key: number,
    scale: number[],
    rhythm: number[],
    chordProg: number[],
    totalSixteenths: number,
    sixteenthDuration: number
  ): MusicNote[] {
    const notes: MusicNote[] = [];
    const baseOctave = 5;  // Octave 5 (middle-high range)
    
    // Start on a chord tone
    let currentScaleIndex = this.rng.range(0, 3);  // Start on 1st, 3rd, or 5th
    let currentOctave = baseOctave;
    
    for (let i = 0; i < totalSixteenths; i++) {
      const rhythmIndex = i % rhythm.length;
      const barIndex = Math.floor(i / 16);
      const chordRoot = chordProg[barIndex % chordProg.length];
      
      if (rhythm[rhythmIndex] === 1) {
        // Decide movement
        const movement = this.selectMelodyMovement();
        currentScaleIndex += movement;
        
        // Keep in reasonable range
        while (currentScaleIndex < 0) {
          currentScaleIndex += scale.length;
          currentOctave--;
        }
        while (currentScaleIndex >= scale.length) {
          currentScaleIndex -= scale.length;
          currentOctave++;
        }
        
        // Clamp octave
        if (currentOctave < 4) {
          currentOctave = 4;
          currentScaleIndex = this.rng.range(0, scale.length);
        }
        if (currentOctave > 6) {
          currentOctave = 6;
          currentScaleIndex = this.rng.range(0, scale.length);
        }
        
        // On strong beats, tend toward chord tones
        if (i % 4 === 0 && this.rng.chance(0.6)) {
          // Snap to chord tone (root, 3rd, or 5th of current chord)
          const chordTones = [0, 2, 4].map(ct => (chordRoot + ct) % scale.length);
          currentScaleIndex = this.rng.pick(chordTones);
        }
        
        const pitch = key + scale[currentScaleIndex] + (currentOctave * 12);
        
        // Determine note duration (look ahead for rests)
        let duration = sixteenthDuration * 0.9;  // Default: one 16th
        let lookAhead = 1;
        while (i + lookAhead < totalSixteenths && 
               lookAhead < 4 && 
               rhythm[(i + lookAhead) % rhythm.length] === 0) {
          duration += sixteenthDuration;
          lookAhead++;
        }
        
        notes.push({
          pitch,
          startTime: i * sixteenthDuration,
          duration: duration * 0.8,  // Slight gap between notes
          velocity: i % 4 === 0 ? 0.8 : 0.6  // Accent on beats
        });
      }
    }
    
    return notes;
  }
  
  private selectMelodyMovement(): number {
    // Weighted random movement favoring small steps
    const movements = [-2, -1, -1, 0, 0, 0, 1, 1, 2];
    
    // Occasionally add larger jumps based on difficulty
    if (this.difficulty === 'hard' || this.difficulty === 'ninja') {
      if (this.rng.chance(0.15)) {
        return this.rng.pick([-3, 3, -4, 4]);
      }
    }
    
    return this.rng.pick(movements);
  }
  
  private generateBass(
    key: number,
    scale: number[],
    pattern: BassPattern,
    chordProg: number[],
    totalSixteenths: number,
    sixteenthDuration: number
  ): MusicNote[] {
    const notes: MusicNote[] = [];
    const baseOctave = 2;  // Low octave for bass
    
    for (let bar = 0; bar < totalSixteenths / 16; bar++) {
      const chordRoot = chordProg[bar % chordProg.length];
      const rootPitch = key + scale[chordRoot % scale.length] + (baseOctave * 12);
      const fifthPitch = key + scale[(chordRoot + 4) % scale.length] + (baseOctave * 12);
      const barStart = bar * 16 * sixteenthDuration;
      
      switch (pattern) {
        case 'root-fifth':
          // Root-5th alternating pattern
          for (let beat = 0; beat < 4; beat++) {
            notes.push({
              pitch: beat % 2 === 0 ? rootPitch : fifthPitch,
              startTime: barStart + beat * 4 * sixteenthDuration,
              duration: sixteenthDuration * 3,
              velocity: 0.7
            });
          }
          break;
          
        case 'octave-pulse':
          // Steady 8th note pulse on root
          for (let eighth = 0; eighth < 8; eighth++) {
            const octaveShift = eighth % 2 === 0 ? 0 : 12;
            notes.push({
              pitch: rootPitch + octaveShift,
              startTime: barStart + eighth * 2 * sixteenthDuration,
              duration: sixteenthDuration * 1.5,
              velocity: eighth % 2 === 0 ? 0.7 : 0.5
            });
          }
          break;
          
        case 'walking':
          // Walking bass line
          const walkNotes = [0, 2, 4, 2];  // Scale degrees to walk through
          for (let beat = 0; beat < 4; beat++) {
            const walkIndex = (chordRoot + walkNotes[beat]) % scale.length;
            notes.push({
              pitch: key + scale[walkIndex] + (baseOctave * 12),
              startTime: barStart + beat * 4 * sixteenthDuration,
              duration: sixteenthDuration * 3.5,
              velocity: 0.65
            });
          }
          break;
          
        case 'arpeggio':
          // Arpeggiated bass
          const arpNotes = [0, 2, 4, 2, 0, 4, 2, 4];  // Arpeggio pattern
          for (let eighth = 0; eighth < 8; eighth++) {
            const arpIndex = (chordRoot + arpNotes[eighth]) % scale.length;
            notes.push({
              pitch: key + scale[arpIndex] + (baseOctave * 12),
              startTime: barStart + eighth * 2 * sixteenthDuration,
              duration: sixteenthDuration * 1.8,
              velocity: eighth % 4 === 0 ? 0.7 : 0.5
            });
          }
          break;
      }
    }
    
    return notes;
  }
  
  private generateArpeggio(
    key: number,
    scale: number[],
    chordProg: number[],
    totalSixteenths: number,
    sixteenthDuration: number
  ): MusicNote[] {
    const notes: MusicNote[] = [];
    const baseOctave = 4;  // Mid range
    
    // Arpeggio patterns (in 16ths within a bar)
    const patterns = [
      [0, 4, 8, 12],           // Quarter notes
      [0, 2, 4, 6, 8, 10, 12, 14],  // 8th notes
      [0, 3, 6, 9, 12, 15],   // Dotted 8ths feel
    ];
    const pattern = this.rng.pick(patterns);
    
    for (let bar = 0; bar < totalSixteenths / 16; bar++) {
      const chordRoot = chordProg[bar % chordProg.length];
      const barStart = bar * 16 * sixteenthDuration;
      
      // Chord tones: root, 3rd, 5th
      const chordTones = [0, 2, 4].map(ct => 
        key + scale[(chordRoot + ct) % scale.length] + (baseOctave * 12)
      );
      
      pattern.forEach((pos, idx) => {
        if (bar * 16 + pos < totalSixteenths) {
          notes.push({
            pitch: chordTones[idx % chordTones.length],
            startTime: barStart + pos * sixteenthDuration,
            duration: sixteenthDuration * 1.5,
            velocity: 0.35  // Quieter, background texture
          });
        }
      });
    }
    
    return notes;
  }
}

/**
 * Convert MIDI note number to frequency in Hz
 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
