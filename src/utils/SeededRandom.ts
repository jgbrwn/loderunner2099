// Seeded random number generator (Mulberry32)
export class SeededRandom {
  private seed: number;
  
  constructor(seed: number | string) {
    if (typeof seed === 'string') {
      // Convert string to number hash
      this.seed = this.hashString(seed);
    } else {
      this.seed = seed;
    }
  }
  
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  // Returns 0-1
  next(): number {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  
  // Returns min (inclusive) to max (exclusive)
  range(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }
  
  // Returns true with given probability (0-1)
  chance(probability: number): boolean {
    return this.next() < probability;
  }
  
  // Pick random element from array
  pick<T>(array: T[]): T {
    return array[this.range(0, array.length)];
  }
  
  // Shuffle array in place
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.range(0, i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

// Generate a shareable seed code
export function generateSeedCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
