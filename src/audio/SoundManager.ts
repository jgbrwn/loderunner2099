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
  private enabled: boolean = true;
  private musicEnabled: boolean = true;
  private volume: number = 0.5;
  private musicVolume: number = 0.5;
  
  // Music state
  private currentTrack: MusicTrack | null = null;
  private musicPlaying: boolean = false;
  private loopTimeoutId: number | null = null;
  private activeOscillators: OscillatorNode[] = [];
  
  constructor() {
    this.initAudio();
  }
  
  private initAudio(): void {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.value = this.volume;
      
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
  
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }
  
  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }
  
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopMusic();
    return this.enabled;
  }
  
  toggleMusic(): boolean {
    this.musicEnabled = !this.musicEnabled;
    if (!this.musicEnabled) {
      this.stopMusic();
    } else if (this.currentTrack && this.enabled) {
      this.playMusic(this.currentTrack);
    }
    return this.musicEnabled;
  }
  
  isMusicEnabled(): boolean { return this.musicEnabled; }
  isEnabled(): boolean { return this.enabled; }
  
  // === Music Playback ===
  
  playMusic(track: MusicTrack): void {
    if (!this.ctx || !this.musicGain || !this.enabled || !this.musicEnabled) return;
    
    this.stopMusic();
    this.currentTrack = track;
    this.musicPlaying = true;
    
    // Start the loop
    this.playMusicLoop();
  }
  
  private playMusicLoop(): void {
    if (!this.ctx || !this.currentTrack || !this.musicPlaying || !this.musicGain) return;
    
    const track = this.currentTrack;
    const now = this.ctx.currentTime;
    
    // Schedule all notes for this loop
    const allNotes = [
      ...track.melody.map(n => ({ ...n, type: 'melody' as const })),
      ...track.bass.map(n => ({ ...n, type: 'bass' as const })),
      ...track.arpeggio.map(n => ({ ...n, type: 'arpeggio' as const })),
    ];
    
    for (const note of allNotes) {
      const startTime = now + note.startTime;
      const freq = midiToFrequency(note.pitch);
      const vol = note.type === 'melody' ? 0.3 : note.type === 'bass' ? 0.4 : 0.15;
      const wave: OscillatorType = note.type === 'bass' ? 'triangle' : 'square';
      
      this.playMusicNote(freq, startTime, note.duration, vol * note.velocity, wave);
    }
    
    // Schedule next loop
    const loopMs = track.loopDuration * 1000;
    this.loopTimeoutId = window.setTimeout(() => this.playMusicLoop(), loopMs - 50);
  }
  
  private playMusicNote(freq: number, startTime: number, duration: number, velocity: number, wave: OscillatorType): void {
    if (!this.ctx || !this.musicGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.type = wave;
    osc.frequency.value = freq;
    
    // Envelope
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(velocity, startTime + 0.01);
    gain.gain.setValueAtTime(velocity, startTime + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
    
    this.activeOscillators.push(osc);
    
    // Cleanup after note ends
    osc.onended = () => {
      const idx = this.activeOscillators.indexOf(osc);
      if (idx > -1) this.activeOscillators.splice(idx, 1);
    };
  }
  
  stopMusic(): void {
    this.musicPlaying = false;
    
    if (this.loopTimeoutId !== null) {
      clearTimeout(this.loopTimeoutId);
      this.loopTimeoutId = null;
    }
    
    // Stop all active oscillators
    for (const osc of this.activeOscillators) {
      try { osc.stop(); } catch (e) { /* already stopped */ }
    }
    this.activeOscillators = [];
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
    const notes = [523, 659, 784, 1047];
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

let instance: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!instance) {
    instance = new SoundManager();
  }
  return instance;
}
