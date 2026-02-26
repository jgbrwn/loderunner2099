/**
 * Procedural audio generation using Web Audio API.
 * Creates retro-futuristic sound effects without external files.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  private volume: number = 0.5;
  
  constructor() {
    this.initAudio();
  }
  
  private initAudio(): void {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.value = this.volume;
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
  
  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  
  // === Sound Effects ===
  
  playJump(): void {
    if (!this.canPlay()) return;
    
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
      gain.connect(this.masterGain!);
      
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
      gain.connect(this.masterGain!);
      
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
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
    gain.connect(this.masterGain!);
    
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
      gain.connect(this.masterGain!);
      
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
    return this.enabled && this.ctx !== null && this.masterGain !== null;
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
