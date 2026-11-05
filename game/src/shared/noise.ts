// Seeded random numbers and 2D simplex noise. Same results on the server and the client.

export function hashSeed(...parts: (number | string)[]) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
  }
  return h >>> 0;
}

// mulberry32: a small fast PRNG. Returns numbers in [0, 1).
export function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export type Random = ReturnType<typeof createRandom>;

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 2D simplex noise in about [-1, 1].
export function createNoise2D(seed: number) {
  const random = createRandom(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  return (x: number, y: number) => {
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
    let n = 0;
    const corner = (gx: number, gy: number, g: number) => {
      let tt = 0.5 - gx * gx - gy * gy;
      if (tt < 0) return 0;
      tt *= tt;
      const grad = GRAD[g & 7]!;
      return tt * tt * (grad[0] * gx + grad[1] * gy);
    };
    n += corner(x0, y0, perm[ii + perm[jj]!]!);
    n += corner(x1, y1, perm[ii + i1 + perm[jj + j1]!]!);
    n += corner(x2, y2, perm[ii + 1 + perm[jj + 1]!]!);
    return 70 * n;
  };
}
export type Noise2D = ReturnType<typeof createNoise2D>;

// Fractal noise: several octaves, each twice as fine and `gain` as strong. About [-1, 1].
export function fbm(noise: Noise2D, x: number, y: number, octaves = 4, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let k = 0; k < octaves; k++) {
    sum += amplitude * noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / norm;
}

// Ridged noise: sharp crests where the noise crosses 0. In [0, 1].
export function ridged(noise: Noise2D, x: number, y: number, octaves = 4) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let k = 0; k < octaves; k++) {
    const r = 1 - Math.abs(noise(x * frequency, y * frequency));
    sum += amplitude * r * r;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
