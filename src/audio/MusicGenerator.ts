import { SeededRandom } from '../utils/SeededRandom';

export interface MusicNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

export interface MusicTrack {
  melody: MusicNote[];
  bass: MusicNote[];
  arpeggio: MusicNote[];
  tempo: number;
  loopDuration: number;
  key: number;
}

// Scale definitions
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

// More varied rhythm patterns
const MELODY_RHYTHMS = [
  [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0],  // Varied
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],  // Syncopated
  [1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1],  // Punchy
  [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],  // Off-beat
  [1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0],  // Sparse swing
  [1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0],  // Busy then sparse
  [1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0],  // Call-response
];

// Melodic motifs (pitch movements)
const MOTIFS = [
  [0, 2, 4, 2],           // Up and back
  [0, -1, -2, 0],         // Neighbor tone
  [0, 4, 2, 5],           // Leap up
  [0, -2, -4, -2],        // Down and back  
  [0, 1, 2, 1],           // Step up
  [0, 0, 2, 0],           // Pedal with escape
  [0, 3, 2, 4],           // Zig-zag up
  [0, -3, -2, -4],        // Zig-zag down
];

const CHORD_PROGRESSIONS = [
  [0, 3, 4, 4],
  [0, 5, 3, 4],
  [0, 0, 3, 4],
  [0, 3, 0, 4],
  [0, 4, 5, 3],
  [0, 2, 5, 4],
  [0, 3, 5, 4],
];

type BassPattern = 'root-fifth' | 'octave-pulse' | 'walking' | 'arpeggio' | 'driving';

export class MusicGenerator {
  private rng: SeededRandom;
  private difficulty: string;
  
  constructor(seed: string | number, levelNumber: number, difficulty: string = 'normal') {
    this.rng = new SeededRandom(`${seed}-music-${levelNumber}`);
    this.difficulty = difficulty;
  }
  
  generate(): MusicTrack {
    const key = this.rng.range(0, 12);
    const scale = this.selectScale();
    const tempo = this.selectTempo();
    const bars = 8;  // 8 bar loop for more variety
    const sixteenthDuration = 60 / tempo / 4;
    const totalSixteenths = bars * 16;
    const loopDuration = totalSixteenths * sixteenthDuration;
    
    const chordProgression = this.rng.pick(CHORD_PROGRESSIONS);
    const bassPattern = this.selectBassPattern();
    
    // Generate with more sophisticated algorithms
    const melody = this.generateMelody(key, scale, chordProgression, bars, sixteenthDuration);
    const bass = this.generateBass(key, scale, bassPattern, chordProgression, bars, sixteenthDuration);
    const arpeggio = this.generateArpeggio(key, scale, chordProgression, bars, sixteenthDuration);
    
    return { melody, bass, arpeggio, tempo, loopDuration, key };
  }
  
  private selectScale(): number[] {
    const diffScales: { [key: string]: number[][] } = {
      easy: [SCALES.pentatonic, SCALES.major],
      normal: [SCALES.minor, SCALES.dorian],
      hard: [SCALES.dorian, SCALES.phrygian],
      ninja: [SCALES.phrygian, SCALES.minor],
    };
    return this.rng.pick(diffScales[this.difficulty] ?? diffScales.normal);
  }
  
  private selectTempo(): number {
    // Gentle tempo progression - Easy feels good, others just slightly faster
    const ranges: { [key: string]: [number, number] } = {
      easy: [100, 115],
      normal: [110, 125],
      hard: [115, 130],
      ninja: [120, 138]
    };
    const [min, max] = ranges[this.difficulty] ?? [110, 125];
    return this.rng.range(min, max + 1);
  }
  
  private selectBassPattern(): BassPattern {
    return this.rng.pick(['root-fifth', 'octave-pulse', 'walking', 'arpeggio', 'driving']);
  }
  
  private generateMelody(
    key: number,
    scale: number[],
    chordProg: number[],
    bars: number,
    sixteenthDuration: number
  ): MusicNote[] {
    const notes: MusicNote[] = [];
    let currentPitch = 60 + key; // Start at middle C + key
    
    // Pick different rhythms for different sections
    const rhythm1 = this.rng.pick(MELODY_RHYTHMS);
    const rhythm2 = this.rng.pick(MELODY_RHYTHMS);
    
    // Pick motifs for melodic coherence
    const motif1 = this.rng.pick(MOTIFS);
    const motif2 = this.rng.pick(MOTIFS);
    
    for (let bar = 0; bar < bars; bar++) {
      const chord = chordProg[bar % chordProg.length];
      const chordRoot = key + scale[chord % scale.length];
      
      // Use different rhythm for A and B sections
      const rhythm = bar < 4 ? rhythm1 : rhythm2;
      const motif = bar < 4 ? motif1 : motif2;
      
      // Every 2 bars, consider resetting to a chord tone for coherence
      if (bar % 2 === 0 && this.rng.chance(0.7)) {
        const chordTones = [0, 2, 4].map(i => chordRoot + (i < scale.length ? scale[i] : 0));
        currentPitch = this.rng.pick(chordTones) + 60;
      }
      
      let motifIndex = 0;
      
      for (let i = 0; i < 16; i++) {
        if (rhythm[i] === 1) {
          // Apply motif movement
          const movement = motif[motifIndex % motif.length];
          motifIndex++;
          
          // Add some randomness to movement
          let actualMovement = movement;
          if (this.rng.chance(0.3)) {
            actualMovement += this.rng.range(-1, 2);
          }
          
          // Apply movement within scale
          const currentScaleIndex = this.findClosestScaleIndex(currentPitch - key, scale);
          let newScaleIndex = currentScaleIndex + actualMovement;
          let octaveShift = 0;
          
          while (newScaleIndex < 0) {
            newScaleIndex += scale.length;
            octaveShift -= 12;
          }
          while (newScaleIndex >= scale.length) {
            newScaleIndex -= scale.length;
            octaveShift += 12;
          }
          
          currentPitch = key + scale[newScaleIndex] + 60 + octaveShift;
          
          // Keep in playable range
          while (currentPitch < 48) currentPitch += 12;
          while (currentPitch > 84) currentPitch -= 12;
          
          // Vary note duration based on position and random
          let duration = sixteenthDuration;
          if (i % 4 === 0 && this.rng.chance(0.4)) {
            duration = sixteenthDuration * 2; // Longer on beats
          } else if (this.rng.chance(0.2)) {
            duration = sixteenthDuration * 1.5;
          }
          
          // Vary velocity for dynamics
          let velocity = 0.6;
          if (i === 0) velocity = 0.9;  // Downbeat accent
          else if (i % 4 === 0) velocity = 0.75;  // Beat accent
          else if (i % 2 === 1) velocity = 0.5;  // Off-beats softer
          
          // Add occasional grace notes for interest
          if (this.rng.chance(0.1) && i > 0) {
            const graceNote = currentPitch + (this.rng.chance(0.5) ? 2 : -2);
            notes.push({
              pitch: graceNote,
              startTime: (bar * 16 + i) * sixteenthDuration - sixteenthDuration * 0.15,
              duration: sixteenthDuration * 0.15,
              velocity: velocity * 0.6
            });
          }
          
          notes.push({
            pitch: currentPitch,
            startTime: (bar * 16 + i) * sixteenthDuration,
            duration: duration * 0.85,
            velocity
          });
        }
      }
    }
    
    return notes;
  }
  
  private findClosestScaleIndex(pitch: number, scale: number[]): number {
    const normalizedPitch = ((pitch % 12) + 12) % 12;
    let closest = 0;
    let minDist = 12;
    for (let i = 0; i < scale.length; i++) {
      const dist = Math.abs(scale[i] - normalizedPitch);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }
  
  private generateBass(
    key: number,
    scale: number[],
    pattern: BassPattern,
    chordProg: number[],
    bars: number,
    sixteenthDuration: number
  ): MusicNote[] {
    const notes: MusicNote[] = [];
    const baseOctave = 3;
    
    for (let bar = 0; bar < bars; bar++) {
      const chord = chordProg[bar % chordProg.length];
      const rootPitch = key + scale[chord % scale.length] + (baseOctave * 12);
      const fifthPitch = key + scale[(chord + 4) % scale.length] + (baseOctave * 12);
      const thirdPitch = key + scale[(chord + 2) % scale.length] + (baseOctave * 12);
      const barStart = bar * 16 * sixteenthDuration;
      
      // Vary pattern slightly each bar
      const variation = bar % 2;
      
      switch (pattern) {
        case 'root-fifth':
          for (let beat = 0; beat < 4; beat++) {
            const pitch = variation === 0 
              ? (beat % 2 === 0 ? rootPitch : fifthPitch)
              : (beat === 0 ? rootPitch : beat === 2 ? fifthPitch : thirdPitch);
            notes.push({
              pitch,
              startTime: barStart + beat * 4 * sixteenthDuration,
              duration: sixteenthDuration * 3,
              velocity: beat === 0 ? 0.8 : 0.6
            });
          }
          break;
          
        case 'octave-pulse':
          for (let eighth = 0; eighth < 8; eighth++) {
            const octaveShift = (eighth + variation) % 2 === 0 ? 0 : 12;
            notes.push({
              pitch: rootPitch + octaveShift,
              startTime: barStart + eighth * 2 * sixteenthDuration,
              duration: sixteenthDuration * 1.5,
              velocity: eighth % 4 === 0 ? 0.75 : 0.5
            });
          }
          break;
          
        case 'walking':
          const walkPatterns = [
            [0, 2, 4, 5],
            [0, 4, 2, 6],
            [0, 2, 4, 2],
            [0, -1, 0, 2]
          ];
          const walkPattern = walkPatterns[(bar + variation) % walkPatterns.length];
          for (let beat = 0; beat < 4; beat++) {
            const walkDegree = (chord + walkPattern[beat] + scale.length) % scale.length;
            notes.push({
              pitch: key + scale[walkDegree] + (baseOctave * 12),
              startTime: barStart + beat * 4 * sixteenthDuration,
              duration: sixteenthDuration * 3.5,
              velocity: beat === 0 ? 0.7 : 0.55
            });
          }
          break;
          
        case 'arpeggio':
          const arpPatterns = [
            [0, 2, 4, 2, 0, 4, 2, 4],
            [0, 4, 2, 4, 0, 2, 4, 2],
            [0, 2, 0, 4, 2, 4, 0, 2]
          ];
          const arpPattern = arpPatterns[(bar + variation) % arpPatterns.length];
          for (let eighth = 0; eighth < 8; eighth++) {
            const arpDegree = (chord + arpPattern[eighth]) % scale.length;
            notes.push({
              pitch: key + scale[arpDegree] + (baseOctave * 12),
              startTime: barStart + eighth * 2 * sixteenthDuration,
              duration: sixteenthDuration * 1.8,
              velocity: eighth % 4 === 0 ? 0.7 : 0.45
            });
          }
          break;
          
        case 'driving':
          // Steady 16th notes with accents
          for (let i = 0; i < 16; i++) {
            const useFifth = i % 8 >= 4;
            notes.push({
              pitch: useFifth ? fifthPitch : rootPitch,
              startTime: barStart + i * sixteenthDuration,
              duration: sixteenthDuration * 0.8,
              velocity: i % 4 === 0 ? 0.7 : i % 2 === 0 ? 0.5 : 0.35
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
    bars: number,
    sixteenthDuration: number
  ): MusicNote[] {
    const notes: MusicNote[] = [];
    const baseOctave = 4;
    
    // Pick an arpeggio style
    const styles = ['up', 'down', 'updown', 'random'];
    const style = this.rng.pick(styles);
    
    // Pick timing pattern
    const timings = [
      [0, 4, 8, 12],
      [0, 3, 6, 9, 12],
      [2, 6, 10, 14],
      [0, 2, 4, 8, 10, 12]
    ];
    const timing = this.rng.pick(timings);
    
    for (let bar = 0; bar < bars; bar++) {
      const chord = chordProg[bar % chordProg.length];
      const barStart = bar * 16 * sixteenthDuration;
      
      // Build chord tones with octave variety
      const chordTones = [
        key + scale[chord % scale.length] + (baseOctave * 12),
        key + scale[(chord + 2) % scale.length] + (baseOctave * 12),
        key + scale[(chord + 4) % scale.length] + (baseOctave * 12),
        key + scale[chord % scale.length] + ((baseOctave + 1) * 12),
      ];
      
      let arpIndex = 0;
      const direction = style === 'down' ? -1 : 1;
      
      for (const pos of timing) {
        if (bar * 16 + pos >= bars * 16) continue;
        
        let toneIndex: number;
        switch (style) {
          case 'up':
            toneIndex = arpIndex % chordTones.length;
            arpIndex++;
            break;
          case 'down':
            toneIndex = (chordTones.length - 1 - (arpIndex % chordTones.length));
            arpIndex++;
            break;
          case 'updown':
            const cycle = arpIndex % (chordTones.length * 2 - 2);
            toneIndex = cycle < chordTones.length ? cycle : (chordTones.length * 2 - 2 - cycle);
            arpIndex++;
            break;
          case 'random':
          default:
            toneIndex = this.rng.range(0, chordTones.length);
            break;
        }
        
        notes.push({
          pitch: chordTones[toneIndex],
          startTime: barStart + pos * sixteenthDuration,
          duration: sixteenthDuration * 2,
          velocity: pos === 0 ? 0.4 : 0.3
        });
      }
    }
    
    return notes;
  }
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
