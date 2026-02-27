# Procedural Music Generation Research for Lode Runner 2099

## Requirements
- Each level should have unique procedurally generated retro video game music
- Same seed = same music (deterministic generation)
- Music toggle separate from sound effects mute
- Retro/chiptune aesthetic matching the game's visual style
- Lightweight implementation (no massive ML model downloads)

## Research Summary

### 1. short-vgm-generator (ABA Games)
**URL**: https://github.com/abagames/short-vgm-generator

**Approach**: Uses Magenta.js MusicRNN to generate new phrases based on seed phrases from classic games (Dig Dug, Xevious, Gradius, etc.)

**Pros**:
- Specifically designed for retro VGM style
- Can generate melodies and bass lines
- Uses MML (Music Macro Language) format

**Cons**:
- Requires loading Magenta.js (~2-5MB ML model)
- Model inference takes time (async)
- Not truly seeded - uses random temperature in generation
- Demo page is 404 (abandoned?)

**Key Code Insights**:
```typescript
// Uses @magenta/music for ML generation
const musicRnn = new mm.MusicRNN('https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn');
musicRnn.continueSequence(melody, notesSteps, temperature);
```

### 2. Magenta.js
**URL**: https://magenta.github.io/glitch/hello-magenta/

**Approach**: Google's ML library for music generation with models like MusicRNN and MusicVAE

**Pros**:
- Well-documented
- Browser-based
- Can interpolate between sequences
- Has built-in players and visualizers

**Cons**:
- Large model downloads required
- Not designed for deterministic seeded output
- Overkill for simple chiptune music
- Adds significant bundle size and load time

### 3. runn (vibertthio)
**URL**: https://github.com/vibertthio/runn

**Approach**: RNN-generated game where player controls music

**Pros**:
- Interesting concept of music tied to gameplay

**Cons**:
- More of an art project than a reusable library
- 7 years old, not maintained
- Uses older webpack setup

### 4. Alternative: Pure Procedural Generation (RECOMMENDED)

Given the requirements and constraints, I recommend a **custom procedural music generator** that doesn't rely on ML models:

**Architecture**:
1. Use the existing `SeededRandom` class for deterministic generation
2. Build music from algorithmic rules (scales, chord progressions, patterns)
3. Use Web Audio API (already in `SoundManager.ts`) for playback
4. Generate short looping phrases (4-8 bars) appropriate for retro games

**Key Components**:

#### A. Music Theory Rules
- **Scales**: Pentatonic (safe), minor, dorian (classic game feel)
- **Chord Progressions**: i-iv-v-i, i-VI-III-VII (common in VGM)
- **Bass Patterns**: Root-5th oscillation, walking bass, arpeggios
- **Melody Patterns**: Step-wise motion, octave jumps, repeated notes

#### B. Seeded Generation Algorithm
```typescript
class ProceduralMusicGenerator {
  private rng: SeededRandom;
  
  constructor(seed: string | number, levelNumber: number) {
    // Combine seed with level for unique music per level
    this.rng = new SeededRandom(`${seed}-music-${levelNumber}`);
  }
  
  generate(): MusicTrack {
    const key = this.selectKey();           // C, D, E, etc.
    const scale = this.selectScale();       // minor, pentatonic, dorian
    const tempo = this.selectTempo();       // 120-180 BPM
    const pattern = this.selectPattern();   // arpeggio, pulse, walking
    
    return {
      melody: this.generateMelody(key, scale, pattern),
      bass: this.generateBass(key, scale, pattern),
      tempo,
      duration: 4 * (60 / tempo) * 4  // 4 bars
    };
  }
}
```

#### C. Audio Playback with Tone.js or Raw Web Audio
Two options:

**Option 1: Tone.js** (npm package, ~50KB gzipped)
- Built-in synths with retro waveforms (square, triangle, sawtooth)
- Sequencer/Transport for timing
- Effects like bitcrusher for lo-fi feel

**Option 2: Pure Web Audio API** (no dependencies)
- Already using this for sound effects
- Create oscillators with square/triangle waves
- Schedule notes with precise timing
- More control, smaller bundle

## Recommended Implementation Plan

### Phase 1: Core Generator
1. Create `src/audio/MusicGenerator.ts`
   - Seeded melody generation
   - Seeded bass line generation  
   - Note scheduling logic

2. Extend `SoundManager.ts`
   - Add music playback methods
   - Separate music gain node from SFX
   - Music enable/disable toggle

### Phase 2: Music Parameters
Base parameters on difficulty for variety:
- **Easy**: Slower tempo (100-120 BPM), major/pentatonic scales, simpler patterns
- **Normal**: Medium tempo (120-140 BPM), minor scales, moderate complexity
- **Hard**: Faster tempo (140-160 BPM), dorian/phrygian, complex arpeggios
- **Ninja**: Fast tempo (160-180 BPM), chromatic elements, intense patterns

### Phase 3: UI Integration
1. Add music toggle button/key (separate from mute)
2. HUD indicator showing music on/off
3. Keyboard shortcut (suggested: 'N' for music)

### Phase 4: Polish
- Crossfade between levels
- Victory/death music variants
- Volume balancing with SFX

## Technical Specification

### MusicTrack Interface
```typescript
interface MusicNote {
  pitch: number;      // MIDI note number (60 = middle C)
  startTime: number;  // seconds from loop start
  duration: number;   // note length in seconds
  velocity: number;   // 0-1 volume
}

interface MusicTrack {
  melody: MusicNote[];
  bass: MusicNote[];
  percussion?: MusicNote[];  // optional drums
  tempo: number;             // BPM
  loopDuration: number;      // seconds
  key: number;               // root note (0-11)
  scale: number[];           // intervals from root
}
```

### Retro Sound Characteristics
- **Square wave** for melody (classic NES/C64 sound)
- **Triangle wave** for bass (softer, less harsh)
- **Noise** for percussion (hi-hat, snare)
- **Duty cycle modulation** for variety
- **Simple envelopes**: quick attack, short decay
- **No reverb/delay** (authentic retro)

### Generation Algorithm Pseudocode
```
function generateMelody(rng, scale, bars=4):
  notes = []
  currentPitch = rng.pick(scale) + 60  // Start in middle octave
  
  for beat in range(bars * 4):  // 4 beats per bar
    if rng.chance(0.8):  // 80% chance of note
      // Movement: step, skip, repeat, or jump
      movement = rng.pick([-2, -1, 0, 1, 2, 7, -7])
      currentPitch = clamp(currentPitch + movement, 48, 84)
      
      // Snap to scale
      currentPitch = snapToScale(currentPitch, scale)
      
      // Duration varies
      duration = rng.pick([0.125, 0.25, 0.5])  // 16th, 8th, quarter
      
      notes.push({pitch: currentPitch, time: beat * 0.25, duration})
    else:
      // Rest
  
  return notes
```

## Conclusion

**Recommended approach**: Custom procedural generation using Web Audio API

**Why not ML-based (Magenta.js)?**
1. Large download size impacts load time
2. Model inference is slow and async
3. Not truly deterministic/seedable
4. Overkill for 8-bit style music

**Why custom is better?**
1. Zero additional dependencies
2. Instant generation
3. Fully deterministic from seed
4. Complete control over style
5. Matches existing SoundManager architecture

The game already has excellent procedural level generation - applying the same philosophy to music keeps the codebase consistent and the bundle lean.
