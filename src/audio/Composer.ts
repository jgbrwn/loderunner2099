/**
 * Pure-TS procedural composer (no Web Audio). Produces a Song: sections of
 * per-16th-step note events that the scheduler in MusicEngine plays.
 * Deterministic per (seed, level, difficulty).
 */

export type Channel = 'lead' | 'counter' | 'bass' | 'arp' | 'pad' | 'kick' | 'snare' | 'hat' | 'perc';
export type StyleName = 'synthwave' | 'chiphouse' | 'darkwave' | 'arcade';
export type StingerKind = 'gold' | 'death' | 'clear' | 'trap' | 'exit';

export interface NoteEvent {
  ch: Channel;
  midi: number;   // ignored for drums
  dur: number;    // in 16th steps
  vel: number;    // 0..1
  minI: number;   // minimum intensity (0..1) at which this event plays
}

export interface Section {
  name: string;
  bars: number;
  steps: NoteEvent[][]; // length bars*16
}

export interface StyleParams {
  name: StyleName;
  leadDuty: number;
  arpDuty: number;
  pad: boolean;
  delayMix: number;
  swing: number;
}

export interface Song {
  bpm: number;
  escapeBpm: number;
  key: number;        // midi root (e.g. 45 = A2)
  scale: number[];
  style: StyleParams;
  sections: Section[];
  form: number[];     // indices into sections, played in order
  loopFrom: number;   // index into form to loop back to
  escape: Section[];  // looped in order while escaping
}

// ---------- RNG ----------
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]; }
  chance(p: number): boolean { return this.next() < p; }
}

// ---------- Theory ----------
const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

// Progressions as 0-based scale degrees (4 chords, one per bar).
const PROGRESSIONS: Record<'minor' | 'major', number[][]> = {
  minor: [[0, 5, 2, 6], [0, 5, 3, 4], [0, 3, 4, 0], [0, 6, 5, 6], [5, 3, 0, 4], [0, 2, 5, 4], [3, 4, 0, 0]],
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 4], [3, 4, 2, 5], [0, 3, 0, 4]],
};

export function degreeToMidi(key: number, scale: number[], deg: number): number {
  const n = scale.length;
  const oct = Math.floor(deg / n);
  const i = ((deg % n) + n) % n;
  return key + scale[i] + 12 * oct;
}

function chordDegrees(root: number): number[] { return [root, root + 2, root + 4]; }

/** Closest-voicing triad (voice leading) within [lo, hi]. */
function voiceLead(key: number, scale: number[], root: number, prev: number[] | null, lo = 55, hi = 76): number[] {
  const pcs = chordDegrees(root).map(d => degreeToMidi(key, scale, d) % 12);
  const cands: number[][] = [];
  for (let inv = 0; inv < 3; inv++) {
    for (let base = lo; base <= hi - 7; base++) {
      if (base % 12 !== pcs[inv]) continue;
      const v = [base];
      for (let k = 1; k < 3; k++) {
        let m = v[k - 1] + 1;
        while (m % 12 !== pcs[(inv + k) % 3]) m++;
        v.push(m);
      }
      if (v[2] <= hi) cands.push(v);
    }
  }
  if (!prev) return cands[Math.floor(cands.length / 2)];
  let best = cands[0], bestD = Infinity;
  for (const c of cands) {
    const d = c.reduce((s, m, i) => s + Math.abs(m - prev[i]), 0);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---------- Drum library (16 steps; x=accent, o=soft) ----------
interface DrumPat { kick: string; snare: string; hat: string; perc: string }
const DRUMS: Record<StyleName, DrumPat[]> = {
  synthwave: [
    { kick: 'x.......x.......', snare: '....x.......x...', hat: 'o.x.o.x.o.x.o.x.', perc: '..............o.' },
    { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', perc: '...o.......o....' },
  ],
  chiphouse: [
    { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', perc: 'o..o..o...o..o..' },
    { kick: 'x...x...x...x...', snare: '....x..o....x...', hat: '.ox..ox..ox..ox.', perc: '......o.......o.' },
  ],
  darkwave: [
    { kick: 'x.......x.x.....', snare: '........x.......', hat: 'o.o.o.o.o.o.o.o.', perc: '.....o.......o..' },
    { kick: 'x..x....x.......', snare: '....x.......x...', hat: 'x...x...x...x...', perc: '..o...o...o...o.' },
  ],
  arcade: [
    { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', perc: '.o...o...o...o..' },
    { kick: 'x..x..x...x.....', snare: '....x.......x..o', hat: 'xoxoxoxoxoxoxoxo', perc: '..o.......o.....' },
  ],
};

// Melodic rhythm cells for a 1-bar motif: [step, dur]
const RHYTHMS: [number, number][][] = [
  [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]],
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]],
  [[0, 1], [2, 1], [3, 3], [6, 2], [8, 2], [10, 1], [11, 5]],
  [[0, 6], [6, 2], [8, 2], [10, 2], [12, 4]],
  [[0, 2], [3, 2], [6, 2], [8, 2], [11, 2], [14, 2]],
];

interface Motif { rhythm: [number, number][]; contour: number[] }

function makeMotif(rng: Rng): Motif {
  const rhythm = rng.pick(RHYTHMS).map(r => [r[0], r[1]] as [number, number]);
  const contour: number[] = [0];
  for (let i = 1; i < rhythm.length; i++) {
    const step = rng.pick([-2, -1, -1, 1, 1, 2, 3, -3, 0]);
    contour.push(Math.max(-4, Math.min(6, contour[i - 1] + step)));
  }
  return { rhythm, contour };
}

const invert = (m: Motif): Motif => ({ rhythm: m.rhythm, contour: m.contour.map(c => -c) });
const retro = (m: Motif): Motif => ({ rhythm: m.rhythm, contour: [...m.contour].reverse() });
function rhythmVary(m: Motif, rng: Rng): Motif {
  const rhythm: [number, number][] = [];
  const contour: number[] = [];
  m.rhythm.forEach(([s, d], i) => {
    if (d >= 4 && rng.chance(0.5)) { // split a long note
      const h = Math.floor(d / 2);
      rhythm.push([s, h], [s + h, d - h]);
      contour.push(m.contour[i], m.contour[i] + rng.pick([-1, 1, 2]));
    } else if (i > 0 && d <= 2 && rng.chance(0.25)) { // drop a short note (extend previous)
      rhythm[rhythm.length - 1][1] += d;
    } else {
      rhythm.push([s, d]);
      contour.push(m.contour[i]);
    }
  });
  return { rhythm, contour };
}

// ---------- Builder ----------
class SectionBuilder {
  steps: NoteEvent[][];
  constructor(public name: string, public bars: number) {
    this.steps = Array.from({ length: bars * 16 }, () => []);
  }
  add(step: number, e: NoteEvent): void {
    if (step >= 0 && step < this.steps.length) this.steps[step].push(e);
  }
  build(): Section { return { name: this.name, bars: this.bars, steps: this.steps }; }
}

interface Ctx {
  rng: Rng; key: number; scale: number[]; style: StyleName;
  drums: DrumPat[];
}

interface SectionOpts {
  name: string;
  prog: number[];      // chord roots per bar (repeats if shorter)
  bars: number;
  motif: Motif | null;
  leadOct: number;     // degree offset for lead register
  drums: 'full' | 'light' | 'none' | 'urgent';
  arp: 'off' | 'normal' | 'always';
  bassMode: 'normal' | 'sparse' | 'drive';
  counter: boolean;
  fill: boolean;
}

function placeDrums(b: SectionBuilder, bar: number, pat: DrumPat, mode: SectionOpts['drums'], ctx: Ctx): void {
  const base = bar * 16;
  for (let s = 0; s < 16; s++) {
    const k = pat.kick[s], sn = pat.snare[s], h = pat.hat[s], p = pat.perc[s];
    if (mode === 'none') continue;
    if (mode === 'light') {
      if (h !== '.') b.add(base + s, { ch: 'hat', midi: 0, dur: 1, vel: h === 'x' ? 0.5 : 0.3, minI: 0 });
      if (k !== '.' && s === 0) b.add(base + s, { ch: 'kick', midi: 0, dur: 1, vel: 0.6, minI: 0.3 });
      continue;
    }
    if (mode === 'urgent') {
      if (s % 4 === 0 || k !== '.') b.add(base + s, { ch: 'kick', midi: 0, dur: 1, vel: s % 4 === 0 ? 1 : 0.7, minI: 0 });
      if (s % 8 === 4 || sn === 'x') b.add(base + s, { ch: 'snare', midi: 0, dur: 1, vel: 0.9, minI: 0 });
      b.add(base + s, { ch: 'hat', midi: 0, dur: 1, vel: s % 2 ? 0.3 : 0.55, minI: 0 });
      if (p !== '.') b.add(base + s, { ch: 'perc', midi: 0, dur: 1, vel: 0.5, minI: 0.3 });
      continue;
    }
    if (k !== '.') b.add(base + s, { ch: 'kick', midi: 0, dur: 1, vel: k === 'x' ? 1 : 0.7, minI: s === 0 || s === 8 ? 0 : 0.25 });
    if (sn !== '.') b.add(base + s, { ch: 'snare', midi: 0, dur: 1, vel: sn === 'x' ? 0.9 : 0.45, minI: sn === 'x' ? 0.1 : 0.5 });
    if (h !== '.') b.add(base + s, { ch: 'hat', midi: 0, dur: 1, vel: h === 'x' ? 0.5 : 0.3, minI: h === 'x' ? 0.15 : 0.35 });
    if (p !== '.') b.add(base + s, { ch: 'perc', midi: 0, dur: 1, vel: 0.45, minI: 0.6 });
  }
  void ctx;
}

function placeFill(b: SectionBuilder, bar: number, rng: Rng, minI: number): void {
  const base = bar * 16;
  const start = rng.pick([8, 12]);
  for (let s = start; s < 16; s++) {
    if (s % (start === 8 ? 2 : 1) !== 0 && rng.chance(0.4)) continue;
    b.add(base + s, { ch: 'snare', midi: 0, dur: 1, vel: 0.35 + 0.5 * (s - start) / (16 - start), minI });
  }
  b.add(base + 15, { ch: 'perc', midi: 0, dur: 1, vel: 0.6, minI });
}

function nearestChordTone(deg: number, root: number, n: number): number {
  let best = deg, bestD = Infinity;
  for (const c of chordDegrees(root)) {
    for (let o = -2; o <= 2; o++) {
      const t = c + o * n;
      const d = Math.abs(t - deg);
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  return best;
}

function buildSection(ctx: Ctx, o: SectionOpts, motifs: Motif[]): Section {
  const { rng, key, scale, style } = ctx;
  const n = scale.length;
  const b = new SectionBuilder(o.name, o.bars);
  let voicing: number[] | null = null;
  for (let bar = 0; bar < o.bars; bar++) {
    const root = o.prog[bar % o.prog.length];
    const base = bar * 16;
    const last = bar === o.bars - 1;
    // Pad (voice-led triads)
    voicing = voiceLead(key + 12, scale, root, voicing, 55, 76);
    for (const m of voicing) b.add(base, { ch: 'pad', midi: m, dur: 16, vel: 0.5, minI: 0 });
    // Bass
    const br = degreeToMidi(key, scale, root);
    const fifth = degreeToMidi(key, scale, root + 4);
    for (let s = 0; s < 16; s++) {
      let note: number | null = null, dur = 2, vel = 0.8, minI = 0;
      if (o.bassMode === 'sparse') { if (s === 0) { note = br; dur = 8; } else if (s === 8) { note = br; dur = 6; minI = 0.2; } }
      else if (o.bassMode === 'drive') { note = s % 8 === 6 ? fifth : br; dur = 1; vel = s % 4 === 0 ? 0.9 : 0.6; minI = s % 2 ? 0.3 : 0; }
      else if (style === 'chiphouse') { if (s % 4 === 2) { note = s === 10 ? br + 12 : br; dur = 2; } else if (s === 0) { note = br; minI = 0.4; dur = 1; } }
      else if (style === 'arcade') { if (s % 2 === 0) { note = s % 4 === 2 ? fifth : br; dur = 2; minI = s % 4 ? 0.2 : 0; } }
      else if (style === 'darkwave') { if (s % 2 === 0) { note = br; dur = 2; vel = s % 4 ? 0.55 : 0.85; minI = s % 4 ? 0.25 : 0; } }
      else { if (s % 2 === 0) { note = s === 6 || s === 14 ? br + 12 : br; dur = 2; vel = s % 4 ? 0.6 : 0.85; minI = s % 4 ? 0.2 : 0; } }
      if (note !== null) b.add(base + s, { ch: 'bass', midi: note, dur, vel, minI });
    }
    // Arp
    if (o.arp !== 'off') {
      const tones = chordDegrees(root).map(d => degreeToMidi(key + 24, scale, d));
      tones.push(tones[0] + 12);
      const seq = style === 'darkwave' ? [0, 1, 2, 1] : style === 'arcade' ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 3];
      const rate = style === 'darkwave' ? 2 : 1;
      for (let s = 0, i = 0; s < 16; s += rate, i++) {
        b.add(base + s, { ch: 'arp', midi: tones[seq[i % seq.length]], dur: rate, vel: s % 4 === 0 ? 0.6 : 0.4, minI: o.arp === 'always' ? 0 : 0.4 });
      }
    }
    // Lead: motif per bar with development; cadence on last bar
    if (o.motif) {
      let m = motifs[bar % motifs.length];
      const transpose = root - o.prog[0];
      const rhythm = last ? m.rhythm.filter(r => r[0] < 8).concat([[8, 8]]) : m.rhythm;
      rhythm.forEach(([s, d], i) => {
        let deg = o.leadOct + (m.contour[i] ?? 0) + (bar % 2 ? transpose : 0);
        if (s === 0 || s === 8 || (last && s === 8)) deg = nearestChordTone(deg, root, n);
        if (last && s === 8) deg = nearestChordTone(o.leadOct + root, root, n);
        const midi = degreeToMidi(key + 12, scale, deg);
        b.add(base + s, { ch: 'lead', midi, dur: d, vel: s % 4 === 0 ? 0.85 : 0.7, minI: 0 });
        if (o.counter && d >= 2) b.add(base + s, { ch: 'counter', midi: degreeToMidi(key + 12, scale, deg - 2), dur: d, vel: 0.5, minI: 0.75 });
      });
    }
    if (o.drums !== 'none' || last) {
      const pat = ctx.drums[(last && ctx.drums.length > 1) ? 1 : bar % 2 === 1 && rng.chance(0.3) ? ctx.drums.length - 1 : 0];
      placeDrums(b, bar, pat, o.drums, ctx);
    }
    if (last && o.fill) placeFill(b, bar, rng, o.drums === 'urgent' ? 0 : 0.5);
  }
  return b.build();
}

const STYLES: Record<StyleName, { bpm: [number, number]; scales: string[]; lead: number[]; pad: boolean; delay: number }> = {
  synthwave: { bpm: [98, 112], scales: ['minor', 'dorian', 'minor'], lead: [0.25, 0.5], pad: true, delay: 0.32 },
  chiphouse: { bpm: [120, 128], scales: ['dorian', 'major', 'mixolydian'], lead: [0.125, 0.25], pad: false, delay: 0.22 },
  darkwave: { bpm: [92, 104], scales: ['phrygian', 'harmonic', 'minor'], lead: [0.5, 0.25], pad: true, delay: 0.38 },
  arcade: { bpm: [132, 148], scales: ['major', 'minor', 'dorian'], lead: [0.125, 0.25, 0.5], pad: false, delay: 0.18 },
};

const DIFF_TEMPO: Record<string, number> = { easy: 0.95, normal: 1, hard: 1.05, expert: 1.08, insane: 1.1, nightmare: 1.1 };

export interface ComposeOptions { style?: StyleName; mellow?: boolean }

export function composeSong(seed: string, level: number, difficulty: string, opts: ComposeOptions = {}): Song {
  const rng = new Rng(hashString(`${seed}|${level}|${difficulty}|music2`));
  const styleName: StyleName = opts.style ?? rng.pick(['synthwave', 'chiphouse', 'darkwave', 'arcade'] as const);
  const st = STYLES[styleName];
  const scaleName = rng.pick(st.scales);
  const scale = SCALES[scaleName];
  const key = 40 + rng.int(0, 11); // E2..D#3
  const tempoMul = (DIFF_TEMPO[difficulty] ?? 1) * (1 + Math.min(level, 30) * 0.003);
  const bpm = Math.round(rng.int(st.bpm[0], st.bpm[1]) * tempoMul * (opts.mellow ? 0.92 : 1));
  const progs = PROGRESSIONS[scaleName === 'major' || scaleName === 'mixolydian' ? 'major' : 'minor'];
  const progA = rng.pick(progs);
  let progB = rng.pick(progs);
  if (progB === progA) progB = progs[(progs.indexOf(progA) + 1) % progs.length];
  const ctx: Ctx = { rng, key, scale, style: styleName, drums: DRUMS[styleName] };
  const n = scale.length;

  const m1 = makeMotif(rng);
  const m1v = rhythmVary(m1, rng);
  const m2 = rhythmVary(invert(m1), rng);
  const m2b = retro(m2);
  const m3 = makeMotif(rng);
  const full = opts.mellow ? 'light' : 'full';

  const base: Omit<SectionOpts, 'name' | 'prog' | 'motif'> = {
    bars: 4, leadOct: n, drums: full, arp: 'normal', bassMode: 'normal', counter: false, fill: true,
  };
  const sections: Section[] = [
    buildSection(ctx, { ...base, name: 'intro', prog: progA, motif: null, drums: 'light', bassMode: 'sparse', fill: false }, [m1]),
    buildSection(ctx, { ...base, name: 'A', prog: progA, motif: m1 }, [m1, m1, m1v, m1]),
    buildSection(ctx, { ...base, name: 'B', prog: progB, motif: m2, leadOct: n + 2, counter: true }, [m2, m2b, m2, m3]),
    buildSection(ctx, { ...base, name: 'breakdown', prog: progB, motif: m3, leadOct: n - 2, drums: 'light', arp: 'always', bassMode: 'sparse', fill: true }, [m3, rhythmVary(m3, rng)]),
    buildSection(ctx, { ...base, name: "A'", prog: progA, motif: m1v, counter: true }, [m1v, rhythmVary(m1, rng), m1, invert(m1v)]),
    buildSection(ctx, { ...base, name: "B'", prog: progB, motif: m2b, leadOct: n + 4, counter: true, arp: 'always' }, [m2b, m2, m3, m2]),
  ];
  const escape: Section[] = [
    buildSection(ctx, { ...base, name: 'escA', prog: progA, motif: m1, leadOct: n + 2, drums: 'urgent', arp: 'always', bassMode: 'drive', counter: true }, [m1, m1v, m1, m2]),
    buildSection(ctx, { ...base, name: 'escB', prog: progB, motif: m2, leadOct: n + 4, drums: 'urgent', arp: 'always', bassMode: 'drive', counter: true }, [m2, m2b, m3, m1v]),
  ];
  return {
    bpm, escapeBpm: Math.round(bpm * 1.12), key, scale,
    style: { name: styleName, leadDuty: rng.pick(st.lead), arpDuty: rng.pick([0.125, 0.25]), pad: st.pad || !!opts.mellow, delayMix: st.delay, swing: styleName === 'chiphouse' ? 0.08 : 0 },
    sections, form: [0, 1, 2, 1, 3, 4, 5], loopFrom: 1, escape,
  };
}

export function composeMenu(): Song {
  return composeSong('menu-theme-2099', 0, 'normal', { style: 'synthwave', mellow: true });
}

/** In-key one-shot stinger: list of [offsetSteps, midi, durSteps]. */
export function stingerNotes(song: Pick<Song, 'key' | 'scale'>, kind: StingerKind): [number, number, number][] {
  const d = (deg: number) => degreeToMidi(song.key + 36, song.scale, deg);
  switch (kind) {
    case 'gold': return [[0, d(4), 1], [1, d(7), 2]];
    case 'trap': return [[0, d(2), 1], [1, d(0), 2]];
    case 'exit': return [[0, d(0), 1], [1, d(2), 1], [2, d(4), 1], [3, d(7), 4]];
    case 'clear': return [[0, d(0), 2], [2, d(4), 2], [4, d(7), 2], [6, d(9), 2], [8, d(11), 8]];
    case 'death': return [[0, d(4), 2], [2, d(3), 2], [4, d(1), 2], [6, d(-1), 8]];
  }
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
