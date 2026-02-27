import { MusicTrack, MusicNote, midiToFrequency } from './MusicGenerator';

/**
 * Procedural audio generation using Web Audio API.
 * Creates retro-futuristic sound effects and music without external files.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private enabled: boolean = true;  // Master mute (affects both SFX and music)
  private musicEnabled: boolean = true;  // Music-specific toggle
  private volume: number = 0.5;
  private musicVolume: number = 0.4;  // Music slightly quieter than SFX
  
  // Music playback state
  private currentTrack: MusicTrack | null = null;
  private musicScheduledUntil: number = 0;
  private musicStartTime: number = 0;
  private musicPlaying: boolean = false;
  private scheduledNodes: OscillatorNode[] = [];
  private scheduleInterval: number | null = null;
  
  constructor() {
    this.initAudio();
  }
  
  private initAudio(): void {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Master gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.value = this.volume;
      
      // Separate gain nodes for SFX and Music
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);
      this.sfxGain.gain.value = 1.0;
      
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);
      this.musicGain.gain.value = this.musicVolume;
    } catch (e) {
      console.warn('Web Audio API not available');
    }
  }
  
  /**
   * Resume audio context (must be called from user interaction)
   */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }
  
  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }
  
  setMusicVolume(vol: number): void {
    this.musicVolume = Math.max(0, Math.min(1, vol));
    if (this.musicGain) {
      this.musicGain.gain.value = this.musicVolume;
    }
  }
  
  /**
   * Toggle master mute (affects both SFX and music)
   */
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.stopMusic();
    }
    return this.enabled;
  }
  
  /**
   * Toggle music only (separate from master mute)
   */
  toggleMusic(): boolean {
    this.musicEnabled = !this.musicEnabled;
    if (!this.musicEnabled) {
      this.stopMusic();
    } else if (this.currentTrack && this.enabled) {
      this.playMusic(this.currentTrack);
    }
    return this.musicEnabled;
  }
  
  isMusicEnabled(): boolean {
    return this.musicEnabled;
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  // === Music Playback ===
  
  /**
   * Start playing a music track (loops automatically)
   */
  playMusic(track: MusicTrack): void {
    if (!this.ctx || !this.musicGain || !this.enabled || !this.musicEnabled) return;
    
    // Stop any existing music
    this.stopMusic();
    
    this.currentTrack = track;
    this.musicPlaying = true;
    this.musicStartTime = this.ctx.currentTime;
    this.musicScheduledUntil = this.musicStartTime;
    
    // Schedule initial notes
    this.scheduleMusic();
    
    // Keep scheduling ahead
    this.scheduleInterval = window.setInterval(() => this.scheduleMusic(), 100);
  }
  
  /**
   * Stop music playback
   */
  stopMusic(): void {
    this.musicPlaying = false;
    
    if (this.scheduleInterval !== null) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
    }
    
    // Stop and disconnect all scheduled nodes
    this.scheduledNodes.forEach(node => {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // Node may have already stopped
      }
    });
    this.scheduledNodes = [];
    
    // Fade out music gain
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, this.ctx.currentTime);
      this.musicGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
      setTimeout(() => {
        if (this.musicGain) {
          this.musicGain.gain.value = this.musicVolume;
        }
      }, 150);
    }
  }
  
  private scheduleMusic(): void {
    if (!this.ctx || !this.currentTrack || !this.musicPlaying || !this.musicGain) return;
    
    const scheduleAhead = 0.5;  // Schedule 500ms ahead
    const currentTime = this.ctx.currentTime;
    const track = this.currentTrack;
    
    while (this.musicScheduledUntil < currentTime + scheduleAhead) {
      const loopOffset = this.musicScheduledUntil - this.musicStartTime;
      const loopTime = loopOffset % track.loopDuration;
      const loopStart = this.musicScheduledUntil - loopTime;
      
      // Schedule melody notes
      this.scheduleTrackNotes(track.melody, loopStart, loopTime, 'square', 0.5);
      
      // Schedule bass notes
      this.scheduleTrackNotes(track.bass, loopStart, loopTime, 'triangle', 0.7);
      
      // Schedule arpeggio notes
      this.scheduleTrackNotes(track.arpeggio, loopStart, loopTime, 'square', 0.3);
      
      // Move to next loop
      this.musicScheduledUntil = loopStart + track.loopDuration;
    }
    
    // Cleanup old nodes
    this.scheduledNodes = this.scheduledNodes.filter(node => {
      try {
        // Check if node is still active (this is a bit hacky)
        return node.context.currentTime < (node as any)._endTime;
      } catch (e) {
        return false;
      }
    });
  }
  
  private scheduleTrackNotes(
    notes: MusicNote[],
    loopStart: number,
    loopTime: number,
    waveform: OscillatorType,
    baseVelocity: number
  ): void {
    if (!this.ctx || !this.musicGain) return;
    
    const scheduleAhead = 0.5;
    const currentTime = this.ctx.currentTime;
    
    for (const note of notes) {
      const noteTime = loopStart + note.startTime;
      
      // Only schedule notes that are upcoming and not already scheduled
      if (noteTime >= currentTime && noteTime < currentTime + scheduleAhead) {
        this.scheduleNote(
          midiToFrequency(note.pitch),
          noteTime,
          note.duration,
          note.velocity * baseVelocity,
          waveform
        );
      }
    }
  }
  
  private scheduleNote(
    frequency: number,
    startTime: number,
    duration: number,
    velocity: number,
    waveform: OscillatorType
  ): void {
    if (!this.ctx || !this.musicGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.musicGain);
    
    osc.type = waveform;
    osc.frequency.value = frequency;
    
    // Simple envelope for retro feel
    const attackTime = 0.01;
    const releaseTime = 0.05;
    
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(velocity, startTime + attackTime);
    gain.gain.setValueAtTime(velocity, startTime + duration - releaseTime);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
    
    // Store for cleanup
    (osc as any)._endTime = startTime + duration + 0.1;
    this.scheduledNodes.push(osc);
  }
  
  // === Sound Effects ===
  
  playJump(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx!.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.3, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.15);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.15);
  }
  
  playStep(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(80 + Math.random() * 40, this.ctx!.currentTime);
    
    gain.gain.setValueAtTime(0.15, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.05);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.05);
  }
  
  playClimb(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, this.ctx!.currentTime);
    osc.frequency.setValueAtTime(350, this.ctx!.currentTime + 0.03);
    
    gain.gain.setValueAtTime(0.1, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.08);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.08);
  }
  
  playDig(): void {
    if (!this.canPlay()) return;
    
    // Noise burst for digging
    const duration = 0.2;
    const bufferSize = this.ctx!.sampleRate * duration;
    const buffer = this.ctx!.createBuffer(1, bufferSize, this.ctx!.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    
    const source = this.ctx!.createBufferSource();
    const filter = this.ctx!.createBiquadFilter();
    const gain = this.ctx!.createGain();
    
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain!);
    
    gain.gain.setValueAtTime(0.4, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + duration);
    
    source.start();
  }
  
  playGold(): void {
    if (!this.canPlay()) return;
    
    // Magical chime for gold collection
    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6 arpeggio
    
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      const startTime = this.ctx!.currentTime + i * 0.05;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
      
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    });
  }
  
  playLevelComplete(): void {
    if (!this.canPlay()) return;
    
    // Victory fanfare
    const melody = [
      { freq: 523, time: 0, dur: 0.15 },
      { freq: 659, time: 0.15, dur: 0.15 },
      { freq: 784, time: 0.3, dur: 0.15 },
      { freq: 1047, time: 0.45, dur: 0.4 },
    ];
    
    melody.forEach(note => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      
      osc.type = 'square';
      osc.frequency.value = note.freq;
      
      const startTime = this.ctx!.currentTime + note.time;
      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + note.dur);
      
      osc.start(startTime);
      osc.stop(startTime + note.dur);
    });
  }
  
  playDeath(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.ctx!.currentTime + 0.5);
    
    gain.gain.setValueAtTime(0.3, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.5);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.5);
  }
  
  playEnemyTrapped(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, this.ctx!.currentTime + 0.2);
    
    gain.gain.setValueAtTime(0.2, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.2);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.2);
  }
  
  playHoleFill(): void {
    if (!this.canPlay()) return;
    
    // Rumble sound
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(60, this.ctx!.currentTime);
    osc.frequency.linearRampToValueAtTime(100, this.ctx!.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.25, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.15);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.15);
  }
  
  playMenuSelect(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, this.ctx!.currentTime);
    osc.frequency.setValueAtTime(550, this.ctx!.currentTime + 0.05);
    
    gain.gain.setValueAtTime(0.15, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.1);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.1);
  }
  
  playMenuConfirm(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, this.ctx!.currentTime);
    osc.frequency.setValueAtTime(660, this.ctx!.currentTime + 0.08);
    osc.frequency.setValueAtTime(880, this.ctx!.currentTime + 0.16);
    
    gain.gain.setValueAtTime(0.15, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.25);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.25);
  }
  
  playFall(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.sfxGain!);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx!.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.1, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.3);
    
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.3);
  }
  
  playExitAppear(): void {
    if (!this.canPlay()) return;
    
    // Magical shimmer
    for (let i = 0; i < 5; i++) {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      
      osc.type = 'sine';
      osc.frequency.value = 800 + i * 200;
      
      const startTime = this.ctx!.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
      
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    }
  }
  
  private canPlay(): boolean {
    return this.enabled && this.ctx !== null && this.sfxGain !== null;
  }
}

// Singleton instance
let instance: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!instance) {
    instance = new SoundManager();
  }
  return instance;
}
