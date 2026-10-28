// Two-dimensional simplex noise (Ken Perlin's algorithm as Stefan Gustavson wrote it, in the
// public domain): a smooth field in about −1..1 that the wind bends with. Seeded, so a test and a
// still picture get the same field every time.

const GRADIENTS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** A random source that repeats from a seed (a linear congruential generator). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export type Noise2 = (x: number, y: number) => number;

/** A noise field from a seed: the same seed gives the same field. */
export function noise2(seed = 0): Noise2 {
  const random = seeded(seed);
  const permutation = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j]!, permutation[i]!];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = permutation[i & 255]!;

  const corner = (x: number, y: number, gi: number): number => {
    const t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    const [gx, gy] = GRADIENTS[gi % 8]!;
    return t * t * t * t * (gx * x + gy * y);
  };

  return (x, y) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const n0 = corner(x0, y0, perm[ii + perm[jj]!]!);
    const n1 = corner(x1, y1, perm[ii + i1 + perm[jj + j1]!]!);
    const n2 = corner(x2, y2, perm[ii + 1 + perm[jj + 1]!]!);
    return 70 * (n0 + n1 + n2);
  };
}
