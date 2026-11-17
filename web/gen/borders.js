// Borders: what closes a side of the world (recipe "borders"): a wall of
// mountains (asset type terrain/mountain, gen/terrain.js) or the ocean (asset
// type water/ocean). Both are bands along the side, reaching in as far as a wavy line.
import { nextRandom, between } from '../lib/random.js';

// north: -z (the top of the screen), south: +z (towards the camera)
export const SIDES = ['north', 'south', 'west', 'east'];

// -> [how far (x, z) is in from that side of the world, where it is along the side]
export function fromSide(side, half, x, z) {
  if (side === 'east') return [half - x, z];
  if (side === 'west') return [half + x, z];
  if (side === 'south') return [half - z, x];
  return [half + z, x];
}

// a line along a side: depth(along), `depth` give or take up to about 2 * `wobble`
export function wavyLine(rng, depth, wobble) {
  const d = between(rng, depth), w = between(rng, wobble);
  const waves = [0.09, 0.21, 0.47].map((f, k) => ({ f: f * (0.8 + 0.4 * nextRandom(rng)), a: w / (k + 1), ph: nextRandom(rng) * Math.PI * 2 }));
  return (along) => d + waves.reduce((s, v) => s + v.a * Math.sin(v.f * along + v.ph), 0);
}
