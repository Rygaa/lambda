// Seeded random numbers (mulberry32). The state is a { seed } object, like
// the Random resource.
export function nextRandom(rng) {
  rng.seed |= 0;
  rng.seed = (rng.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(rng.seed ^ (rng.seed >>> 15), 1 | rng.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// a seed from any values (FNV-1a over their text), so the same names give the same numbers
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h | 0;
}

// a random number in [a, b], or a itself when it is a single number
export const between = (rng, v) => (Array.isArray(v) ? v[0] + (v[1] - v[0]) * nextRandom(rng) : v);
