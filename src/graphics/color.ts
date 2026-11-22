/** Small colour helpers for code-generated pixel art (0xRRGGBB numbers). */
const ch = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const pack = (r: number, g: number, b: number) =>
  (Math.max(0, Math.min(255, Math.round(r))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(b)));

export function rgba(c: number, a = 1): string { const [r, g, b] = ch(c); return `rgba(${r},${g},${b},${a})`; }
/** Multiply towards black (f<1). */
export function shade(c: number, f: number): number { const [r, g, b] = ch(c); return pack(r * f, g * f, b * f); }
/** Brighten (f>1) with a lift so dark colours still get lighter; f<1 darkens. */
export function tint(c: number, f: number): number {
  const [r, g, b] = ch(c);
  if (f <= 1) return pack(r * f, g * f, b * f);
  const lift = (f - 1) * 40;
  return pack(r * f + lift, g * f + lift, b * f + lift);
}
export function mix(a: number, b: number, t: number): number {
  const A = ch(a), B = ch(b);
  return pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function hex(c: number): string { return '#' + c.toString(16).padStart(6, '0'); }

/** Tiny deterministic PRNG for art (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
