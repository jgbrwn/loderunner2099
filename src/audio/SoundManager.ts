import { MusicTrack } from './MusicGenerator';
import { composeSong, composeMenu, StingerKind } from './Composer';
import { MusicEngine } from './MusicEngine';
import { RadioPlayer, NowPlaying } from './Radio';

export type MusicMode = 'procedural' | 'radio' | 'soma' | 'off';
const MODE_KEY = 'lr2099.musicMode';
const PATH_KEY = 'lr2099.audioPath';
/** How Web Audio reaches the speakers. 'low' = default interactive latency; 'safe' = latencyHint 'playback'
 *  (larger buffers; the same kind of output stream <audio> uses); 'media' = render into a MediaStream played
 *  by an <audio> element. Android TV boxes (Onn 4K) can run an AudioContext whose low-latency output is silent
 *  while <audio> (radio) plays fine, so TV defaults to 'safe'. */
export type AudioPath = 'auto' | 'low' | 'safe' | 'media';
const isTVPage = () => !!(window as any).__LR_TV__ || /LR2099TV/.test(navigator.userAgent);
type MusicRequest = { kind: 'level'; seed: string; level: number; difficulty: string } | { kind: 'menu' };

/**
 * Procedural SFX + adaptive procedural music (MusicEngine/Composer) + Radio Paradise mode.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.5;
  private musicVolume = 0.32;
  private mode: MusicMode = 'procedural';
  private lastNonOff: MusicMode = 'procedural';
  private engine: MusicEngine | null = null;
  private request: MusicRequest | null = null;
  private requestKey = '';
  private paused = false;
  private intensity = 0.5;
  private escape = false;
  private radio = new RadioPlayer();
  private out: AudioNode | null = null;          // where the master chain ends (destination or MediaStream)
  private mediaEl: HTMLAudioElement | null = null;
  private path: AudioPath = 'auto';
  private lastT = -1;
  private stalls = 0;

  constructor() {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === 'procedural' || m === 'radio' || m === 'soma' || m === 'off') this.mode = m;
      if (this.mode !== 'off') this.lastNonOff = this.mode;
      const p = localStorage.getItem(PATH_KEY);
      if (p === 'low' || p === 'safe' || p === 'media') this.path = p;
    } catch { /* no storage */ }
    this.initAudio();
    // Watchdog: an AudioContext that says 'running' but whose clock stopped has lost its output stream
    // (e.g. HDMI/audio route change on a TV box). Rebuild it.
    if (isTVPage()) setInterval(() => {
      const c = this.ctx;
      if (!c || c.state !== 'running' || document.hidden) { this.lastT = -1; return; }
      if (this.lastT >= 0 && c.currentTime === this.lastT && this.stalls < 5) { this.stalls++; this.rebuildAudio(); return; }
      this.lastT = c.currentTime;
    }, 3000);
  }

  getAudioPath(): AudioPath { return this.path; }
  /** Effective path after resolving 'auto'. */
  resolvedPath(): Exclude<AudioPath, 'auto'> { return this.path === 'auto' ? (isTVPage() ? 'safe' : 'low') : this.path; }

  setAudioPath(p: AudioPath): void {
    this.path = p;
    try { localStorage.setItem(PATH_KEY, p); } catch { /* ignore */ }
    this.rebuildAudio();
  }

  /** Tear down and recreate the AudioContext + graph (path change, or a stalled output). */
  rebuildAudio(): void {
    this.killEngine();
    try { void this.ctx?.close(); } catch { /* ignore */ }
    if (this.mediaEl) { try { this.mediaEl.pause(); this.mediaEl.srcObject = null; } catch { /* ignore */ } this.mediaEl = null; }
    this.ctx = null; this.masterGain = this.sfxGain = this.musicGain = null; this.out = null; this.noise = null;
    this.lastT = -1;
    this.initAudio();
    void this.resume();
    this.applyMusic(true);
  }

  private initAudio(): void {
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const path = this.resolvedPath();
      let c: AudioContext;
      try { c = new AC({ latencyHint: path === 'low' ? 'interactive' : 'playback' }); } catch { c = new AC(); }
      this.ctx = c;
      this.out = c.destination;
      if (path === 'media' && typeof c.createMediaStreamDestination === 'function') {
        const dest = c.createMediaStreamDestination();
        const el = new Audio();
        el.autoplay = true;
        el.srcObject = dest.stream;
        el.play().catch(() => { /* retried on next input via resume() */ });
        this.mediaEl = el;
        this.out = dest;
      }
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(this.out);
      this.masterGain = c.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(comp);
      this.sfxGain = c.createGain();
      this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.masterGain);
      this.musicGain = c.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.masterGain);
      const len = c.sampleRate; // 1s white noise shared by drums/SFX
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      console.warn('Web Audio API not available');
    }
  }

  /** Fire a single audible oscillator straight to the output (bypasses music engine + gains).
   *  If you hear this, Web Audio output works and the bug is in the music scheduler/gains. */
  testTone(): string {
    try {
      if (!this.ctx) return 'no ctx';
      const c = this.ctx;
      void c.resume();
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = 880;
      g.gain.value = 0.3;
      o.connect(g); g.connect(this.out ?? c.destination);
      o.start(); o.stop(c.currentTime + 0.6);
      this.mediaEl?.play().catch(() => { /* ignore */ });
      return `BEEP via ${this.resolvedPath().toUpperCase()} · t=${c.currentTime.toFixed(1)} ${c.state} ${c.sampleRate}Hz`;
    } catch (e) { return 'err ' + (e as Error).message; }
  }

  /** Diagnostic: current AudioContext state + whether a synth engine exists. */
  audioDebug(): string {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    const lat = c ? ` lat=${Math.round(((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000)}ms` : '';
    return `${this.resolvedPath()} ${c?.state ?? 'none'} t=${c ? c.currentTime.toFixed(1) : '-'}${lat} ${this.mode}${this.engine ? '+eng' : ''}${this.enabled ? '' : ' sfx-off'}${this.stalls ? ` stalls=${this.stalls}` : ''}`;
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    if (this.mediaEl?.paused) this.mediaEl.play().catch(() => { /* needs gesture */ });
    if ((this.mode === 'radio' || this.mode === 'soma') && this.enabled) this.radio.tryPlay();
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
    this.radio.setVolume(this.radioVolume());
  }

  private radioVolume(): number { return Math.min(1, this.volume * 1.4); }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.killEngine();
      this.radio.stop();
    } else {
      this.applyMusic(true);
    }
    return this.enabled;
  }

  toggleMusic(): boolean {
    this.setMusicMode(this.mode === 'off' ? this.lastNonOff : 'off');
    return this.isMusicEnabled();
  }

  isMusicEnabled(): boolean { return this.mode !== 'off'; }
  isEnabled(): boolean { return this.enabled; }

  // === Music API ===

  getMusicMode(): MusicMode { return this.mode; }

  setMusicMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'off') this.lastNonOff = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
    this.applyMusic(true);
  }

  nowPlaying(): NowPlaying | null { return this.mode === 'radio' || this.mode === 'soma' ? this.radio.nowPlaying() : null; }

  startLevelMusic(seed: string, level: number, difficulty: string): void {
    this.setRequest({ kind: 'level', seed, level, difficulty });
  }

  playMenuMusic(): void { this.setRequest({ kind: 'menu' }); }

  /** Legacy shim. */
  playMusic(track: MusicTrack): void {
    this.startLevelMusic(track.seed ?? 'legacy', track.level ?? 1, track.difficulty ?? 'normal');
  }

  stopMusic(): void {
    this.request = null;
    this.requestKey = '';
    this.paused = false;
    this.killEngine();
  }

  pauseMusic(): void {
    this.paused = true;
    this.engine?.halt();
  }

  resumeMusic(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.engine && this.enabled && this.mode === 'procedural') this.engine.start();
    else this.applyMusic(false);
  }

  setIntensity(x: number): void {
    this.intensity = Math.max(0, Math.min(1, x));
    this.engine?.setIntensity(this.intensity);
  }

  setEscape(on: boolean): void {
    this.escape = on;
    this.engine?.setEscape(on);
  }

  stinger(kind: StingerKind): void {
    if (this.enabled && this.mode === 'procedural') this.engine?.stinger(kind);
  }

  private setRequest(req: MusicRequest): void {
    const key = JSON.stringify(req);
    if (key === this.requestKey && (this.engine || this.mode !== 'procedural')) { this.resumeMusic(); return; }
    this.request = req;
    this.requestKey = key;
    this.paused = false;
    this.escape = false;
    if (req.kind === 'menu') this.intensity = 0.5;
    this.applyMusic(true);
  }

  /** Bring playback in line with mode / enabled / request. */
  private applyMusic(restart: boolean): void {
    if (!this.enabled || this.mode === 'off') { this.killEngine(); this.radio.stop(); return; }
    if (this.mode === 'radio' || this.mode === 'soma') {
      this.killEngine();
      void this.radio.start(this.radioVolume(), this.mode === 'soma' ? 'soma' : 'rp');
      return;
    }
    this.radio.stop();
    if (!this.ctx || !this.musicGain || !this.noise || !this.request) return;
    if (this.engine && !restart) { if (!this.paused) this.engine.start(); return; }
    this.killEngine();
    const r = this.request;
    const song = r.kind === 'menu' ? composeMenu() : composeSong(r.seed, r.level, r.difficulty);
    this.engine = new MusicEngine(this.ctx, this.musicGain, song, this.noise);
    this.engine.setIntensity(this.intensity);
    if (this.escape) this.engine.setEscape(true);
    if (!this.paused) this.engine.start();
  }

  private killEngine(): void {
    if (this.engine) { this.engine.dispose(); this.engine = null; }
  }

  // === Sound Effects (same names as before) ===

  private tone(wave: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, attack = 0.004): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this.sfxGain!);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    o.onended = () => g.disconnect();
  }

  private noiseBurst(t0: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfxGain!);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.02);
    s.onended = () => g.disconnect();
  }

  private get now(): number { return this.ctx!.currentTime; }

  playJump(): void {
    if (!this.canPlay()) return;
    this.tone('square', 220, 440, this.now, 0.12, 0.12);
  }

  playStep(): void {
    if (!this.canPlay()) return;
    this.tone('triangle', 90 + Math.random() * 30, 60, this.now, 0.05, 0.12);
    this.noiseBurst(this.now, 0.025, 0.05, 'highpass', 4000);
  }

  playClimb(): void {
    if (!this.canPlay()) return;
    const f = 520 + Math.random() * 60;
    this.tone('triangle', f, f * 1.12, this.now, 0.06, 0.07);
  }

  playDig(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    this.noiseBurst(t, 0.22, 0.35, 'bandpass', 2400, 500, 1.2);
    this.tone('square', 180, 70, t, 0.12, 0.08);
  }

  playGold(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    [988, 1319, 1976].forEach((f, i) => this.tone('square', f, f, t + i * 0.045, 0.16, 0.07));
    this.tone('sine', 2637, 2637, t + 0.1, 0.25, 0.05);
  }

  playLevelComplete(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      this.tone('square', f, f, t + i * 0.12, i === 4 ? 0.6 : 0.16, 0.09);
      this.tone('triangle', f / 2, f / 2, t + i * 0.12, 0.2, 0.12);
    });
  }

  playDeath(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    this.tone('sawtooth', 660, 70, t, 0.7, 0.13);
    this.tone('square', 440, 50, t + 0.05, 0.7, 0.07);
    this.noiseBurst(t, 0.5, 0.18, 'lowpass', 3000, 200);
  }

  playEnemyTrapped(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    this.tone('square', 880, 220, t, 0.18, 0.09);
    this.tone('square', 660, 165, t + 0.08, 0.18, 0.07);
  }

  playHoleFill(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    this.noiseBurst(t, 0.18, 0.25, 'lowpass', 400, 1600, 2);
    this.tone('triangle', 70, 140, t, 0.15, 0.12);
  }

  playMenuSelect(): void {
    if (!this.canPlay()) return;
    this.tone('square', 1200, 1200, this.now, 0.05, 0.06);
  }

  playMenuConfirm(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    this.tone('square', 880, 880, t, 0.08, 0.08);
    this.tone('square', 1320, 1320, t + 0.07, 0.15, 0.08);
  }

  playFall(): void {
    if (!this.canPlay()) return;
    this.tone('triangle', 700, 180, this.now, 0.3, 0.07);
  }

  playExitAppear(): void {
    if (!this.canPlay()) return;
    const t = this.now;
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, t + i * 0.07, 0.3, 0.06));
    this.noiseBurst(t, 0.6, 0.06, 'bandpass', 800, 6000, 3);
  }

  private canPlay(): boolean {
    return this.enabled && this.ctx !== null && this.sfxGain !== null && this.noise !== null;
  }
}

let instance: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!instance) instance = new SoundManager();
  return instance;
}
