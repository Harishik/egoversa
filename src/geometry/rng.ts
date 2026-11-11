/**
 * Deterministic, seedable pseudo-random numbers.
 * xmur3 string hash -> mulberry32 generator. No Math.random anywhere in
 * scene generation, task sampling or evaluation, so every result is
 * reproducible from its seed string on any machine.
 */

export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hashHex(str: string): string {
  return hashString(str).toString(16).padStart(8, '0');
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  private gen: () => number;
  constructor(seed: string) {
    this.gen = mulberry32(hashString(seed));
  }
  next(): number {
    return this.gen();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.gen();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.gen() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.gen() * arr.length)];
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.gen() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

const WORDS_A = ['amber', 'cobalt', 'lunar', 'quiet', 'vivid', 'north', 'ember', 'tidal', 'paper', 'velvet', 'copper', 'frost'];
const WORDS_B = ['harbor', 'lattice', 'meadow', 'prism', 'orbit', 'canyon', 'signal', 'garden', 'echo', 'atlas', 'delta', 'kiln'];

/** Human-friendly seed string. The only place wall-clock entropy enters, and only on explicit user request. */
export function randomSeedName(): string {
  const n = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  return `${WORDS_A[n % WORDS_A.length]}-${WORDS_B[(n >>> 8) % WORDS_B.length]}-${(n >>> 16) % 1000}`;
}
