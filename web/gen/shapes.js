// Makes the shapes of an asset type once per world and keeps them: every
// object of a type and size shares one of its few variants (shared geometry).
import { getBuilder } from './registry.js';
import { getType, paramsOf, paletteChoices } from './assets.js';
import { FAMILY } from './palettes.js';
import { hashSeed } from '../lib/random.js';

// ctx: { meta, sunL, mid, seed } -> a cache of shape sets
export function createShapes(ctx) {
  return { ctx, sets: new Map() };
}

// the shape set of (asset type 'family/type', size, overrides), made the first time it is asked for
//   -> { key, asset, family, size, params, shapes: [Shape], palettes: name -> { family: palette }, palette: the default name }
export function shapeSet(cache, asset, size, overrides = {}) {
  const type = getType(asset);
  const params = paramsOf(type, size, overrides);
  const key = `${asset}/${size}/${JSON.stringify(params)}`;
  let set = cache.sets.get(key);
  if (!set) {
    const builder = getBuilder(type.builder);
    const shapes = [];
    for (let i = 0; i < type.variants; i++) {
      const rng = { seed: hashSeed(cache.ctx.seed, key, i) };
      shapes.push(withDefaults(builder.build(params, rng, cache.ctx, i)));
    }
    // the colour families its parts use (a part with its own palette keeps it)
    const families = [...new Set(shapes.flatMap((s) => s.parts.filter((p) => !p.palette).map((p) => FAMILY[p.role])))];
    const palettes = paletteChoices(type, families);
    set = { key, asset, family: type.family, size, params, shapes, palettes, palette: Object.keys(palettes)[0] };
    cache.sets.set(key, set);
  }
  return set;
}

const withDefaults = (s) => ({ turns: true, ...s, blocker: s.blocker || { r: s.radius, h: s.height } });
