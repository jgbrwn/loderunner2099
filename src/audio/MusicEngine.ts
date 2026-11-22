import { Song, Section, NoteEvent, StingerKind, stingerNotes, midiToFrequency } from './Composer';

const TICK_MS = 25;
const LOOKAHEAD = 0.12;         // seconds when visible
const LOOKAHEAD_HIDDEN = 1.5;   // background tabs throttle timers to ~1s

const MIX: Record<string, number> = {
  lead: 0.16, counter: 0.08, bass: 0.34, arp: 0.07, pad: 0.05,
  kick: 0.75, snare: 0.32, hat: 0.11, perc: 0.14, stinger: 0.15,
};

/**
 * Plays a Song on an AudioContext with a lookahead scheduler.
 * One engine instance = one song; call dispose() to tear down completely.
 */
export class MusicEngine {
  private bus: GainNode;      // per-song bus -> out (faded on stop)
  private delay: DelayNode;
  private delayFb: GainNode;
  private delaySend: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private formPos = 0;
  private step = 0;
  private escaping = false;
  private escapePending: boolean | null = null;
  private escPos = 0;
  private intensity = 0.5;
  private disposed = false;
  private waves = new Map<number, PeriodicWave>();

  constructor(private ctx: AudioContext, out: AudioNode, private song: Song, private noise: AudioBuffer) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    // Echo bus: dotted-8th delay with damped feedback
    this.delay = ctx.createDelay(2);
    this.delayFb = ctx.createGain();
    this.delaySend = ctx.createGain();
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    this.delaySend.gain.value = song.style.delayMix;
    this.delayFb.gain.value = 0.33;
    this.delaySend.connect(this.delay);
    this.delay.connect(damp);
    damp.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    damp.connect(this.bus);
    this.setDelayTime();
  }

  private get bpm(): number { return this.escaping ? this.song.escapeBpm : this.song.bpm; }
  private get stepDur(): number { return 60 / this.bpm / 4; }
  private setDelayTime(): void { this.delay.delayTime.setTargetAtTime(this.stepDur * 3, this.ctx.currentTime, 0.05); }

  start(): void {
    if (this.disposed || this.timer !== null) return;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(1, t + 0.15);
    this.nextTime = t + 0.06;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stop scheduling but keep position (for pause). */
  halt(fade = 0.12): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0, t + fade);
  }

  /** Full teardown: no timers survive; already-scheduled nodes are cut off by disconnecting the bus. */
  dispose(): void {
    this.halt(0.08);
    if (this.disposed) return;
    this.disposed = true;
    const bus = this.bus, fb = this.delayFb;
    fb.gain.value = 0;
    // Disconnect after the fade; uses a source node's onended (audio clock) instead of a JS timer.
    const s = this.ctx.createConstantSource();
    s.onended = () => { try { bus.disconnect(); this.delay.disconnect(); fb.disconnect(); this.delaySend.disconnect(); } catch { /* ignore */ } };
    s.start();
    s.stop(this.ctx.currentTime + 0.15);
  }

  setIntensity(x: number): void { this.intensity = Math.max(0, Math.min(1, x)); }
  setEscape(on: boolean): void { if (on !== this.escaping) this.escapePending = on; else this.escapePending = null; }

  private currentSection(): Section {
    return this.escaping ? this.song.escape[this.escPos % this.song.escape.length] : this.song.sections[this.song.form[this.formPos]];
  }

  private advance(): void {
    this.step++;
    if (this.step % 16 === 0 && this.escapePending !== null) { // switch at bar line
      this.escaping = this.escapePending;
      this.escapePending = null;
      this.step = 0;
      if (this.escaping) this.escPos = 0;
      else this.formPos = this.song.loopFrom;
      this.setDelayTime();
      return;
    }
    if (this.step >= this.currentSection().steps.length) {
      this.step = 0;
      if (this.escaping) this.escPos++;
      else {
        this.formPos++;
        if (this.formPos >= this.song.form.length) this.formPos = this.song.loopFrom;
      }
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    if (this.ctx.state !== 'running') { this.nextTime = now + 0.05; return; }
    // Fell far behind (e.g. long stall) — skip ahead rather than bursting notes.
    if (this.nextTime < now - 0.05) {
      const missed = Math.ceil((now - this.nextTime) / this.stepDur);
      for (let i = 0; i < missed; i++) this.advance();
      this.nextTime += missed * this.stepDur;
    }
    const ahead = typeof document !== 'undefined' && document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
    while (this.nextTime < now + ahead) {
      const sec = this.currentSection();
      const evs = sec.steps[this.step] || [];
      const swing = this.step % 2 === 1 ? this.song.style.swing * this.stepDur : 0;
      for (const e of evs) if (this.intensity >= e.minI) this.play(e, this.nextTime + swing);
      this.nextTime += this.stepDur;
      this.advance();
    }
  }

  // ---------- Stingers ----------
  stinger(kind: StingerKind): void {
    if (this.disposed || this.timer === null) return;
    const now = this.ctx.currentTime;
    // Light quantize: snap to next 16th if it's close, else play right away.
    const t0 = this.nextTime - now < 0.09 ? this.nextTime : now + 0.01;
    const sd = Math.min(this.stepDur, 0.11);
    for (const [off, midi, dur] of stingerNotes(this.song, kind)) {
      this.pulse(midi, t0 + off * sd, dur * sd, MIX.stinger, kind === 'death' ? 0.5 : 0.125, true, true);
    }
  }

  // ---------- Instruments ----------
  private play(e: NoteEvent, t: number): void {
    const sd = this.stepDur;
    const st = this.song.style;
    switch (e.ch) {
      case 'lead': this.pulse(e.midi, t, e.dur * sd, MIX.lead * e.vel, st.leadDuty, true, true); break;
      case 'counter': this.pulse(e.midi, t, e.dur * sd, MIX.counter * e.vel, 0.5, false, true); break;
      case 'arp': this.pulse(e.midi, t, Math.min(e.dur * sd, 0.12), MIX.arp * e.vel, st.arpDuty, false, true); break;
      case 'bass': this.bass(e.midi, t, e.dur * sd * 0.9, MIX.bass * e.vel); break;
      case 'pad': if (st.pad) this.pad(e.midi, t, e.dur * sd, MIX.pad * e.vel); break;
      case 'kick': this.kick(t, MIX.kick * e.vel); break;
      case 'snare': this.snare(t, MIX.snare * e.vel); break;
      case 'hat': this.hat(t, MIX.hat * e.vel); break;
      case 'perc': this.perc(t, MIX.perc * e.vel); break;
    }
  }

  private pulseWave(duty: number): PeriodicWave {
    let w = this.waves.get(duty);
    if (!w) {
      const N = 40;
      const real = new Float32Array(N), imag = new Float32Array(N);
      for (let n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
      w = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(duty, w);
    }
    return w;
  }

  private env(g: GainNode, t: number, dur: number, peak: number, a: number, d: number, s: number, r: number): number {
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * s, t + a, d / 3);
    const end = Math.max(t + a, t + dur);
    p.setValueAtTime(peak * s, end);
    p.setTargetAtTime(0, end, r / 4);
    return end + r;
  }

  private pulse(midi: number, t: number, dur: number, vol: number, duty: number, vibrato: boolean, send: boolean): void {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.setPeriodicWave(this.pulseWave(duty));
    o.frequency.value = midiToFrequency(midi);
    o.connect(g);
    g.connect(this.bus);
    if (send) g.connect(this.delaySend);
    const end = this.env(g, t, dur, vol, 0.005, 0.12, 0.6, 0.08);
    let lfo: OscillatorNode | null = null;
    if (vibrato && dur > 0.25) {
      lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(14, t + Math.min(dur, 0.4)); // cents, delayed onset
      lfo.connect(lg);
      lg.connect(o.detune);
      lfo.start(t);
      lfo.stop(end);
    }
    o.start(t);
    o.stop(end);
    o.onended = () => { g.disconnect(); };
  }

  private bass(midi: number, t: number, dur: number, vol: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = midiToFrequency(midi);
    o.connect(g);
    g.connect(this.bus);
    const end = this.env(g, t, dur, vol, 0.004, 0.1, 0.75, 0.04);
    o.start(t);
    o.stop(end);
    o.onended = () => g.disconnect();
  }

  private pad(midi: number, t: number, dur: number, vol: number): void {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(800, t + dur);
    f.connect(g);
    g.connect(this.bus);
    g.connect(this.delaySend);
    const end = this.env(g, t, dur, vol, Math.min(0.3, dur * 0.3), 0.4, 0.8, 0.25);
    for (const det of [-7, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToFrequency(midi);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(end);
      if (det > 0) o.onended = () => { f.disconnect(); g.disconnect(); };
    }
  }

  private noiseHit(t: number, vol: number, type: BiquadFilterType, freq: number, q: number, decay: number): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    s.connect(f);
    f.connect(g);
    g.connect(this.bus);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    s.start(t, Math.random() * 0.5);
    s.stop(t + decay + 0.02);
    s.onended = () => g.disconnect();
  }

  private kick(t: number, vol: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g);
    g.connect(this.bus);
    o.start(t);
    o.stop(t + 0.32);
    o.onended = () => g.disconnect();
    this.noiseHit(t, vol * 0.15, 'highpass', 3000, 0.7, 0.012); // click
  }

  private snare(t: number, vol: number): void {
    this.noiseHit(t, vol, 'bandpass', 1900, 0.8, 0.16);
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g);
    g.connect(this.bus);
    o.start(t);
    o.stop(t + 0.1);
    o.onended = () => g.disconnect();
  }

  private hat(t: number, vol: number): void { this.noiseHit(t, vol, 'highpass', 7500, 0.8, 0.045); }
  private perc(t: number, vol: number): void { this.noiseHit(t, vol, 'bandpass', 3800, 4, 0.06); }
}
