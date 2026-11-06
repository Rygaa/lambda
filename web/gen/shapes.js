// Makes the shapes of a kind once per world and keeps them: every object of a
// kind shares one of its few variants (shared geometry).
import { getKind, paramsOf } from './registry.js';
import { hashSeed } from '../lib/random.js';

// ctx: { meta, sunL, mid, seed } -> a cache of shape sets
export function createShapes(ctx) {
  return { ctx, sets: new Map() };     // key -> { key, kind, preset, params, shapes: [Shape] }
}

// the shape set of (kind, preset, overrides), made the first time it is asked for
export function shapeSet(cache, kindName, preset, overrides = {}) {
  const kind = getKind(kindName);
  const p = paramsOf(kind, preset, overrides);
  const key = `${kindName}/${p.preset}/${JSON.stringify(p.params)}`;
  let set = cache.sets.get(key);
  if (!set) {
    const n = typeof kind.variants === 'function' ? kind.variants(p.params) : kind.variants ?? 1;
    const shapes = [];
    for (let i = 0; i < n; i++) {
      const rng = { seed: hashSeed(cache.ctx.seed, key, i) };
      shapes.push(withDefaults(kind.build(p.params, rng, cache.ctx, i)));
    }
    set = { key, kind: kindName, preset: p.preset, params: p.params, shapes, palettes: kind.palettes || {} };
    cache.sets.set(key, set);
  }
  return set;
}

const withDefaults = (s) => ({ turns: true, ...s, blocker: s.blocker || { r: s.radius, h: s.height } });
