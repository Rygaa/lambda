// A world under construction: the objects placed so far and the tests that
// placement rules need (is this spot free?). Recipes (gen/recipe.js) fill one.
import { shapeSet } from './shapes.js';
import { nextRandom } from '../lib/random.js';

const CELL = 2;
const key = (i, j) => i * 100003 + j;

// cache: gen/shapes.js createShapes(); half: the world is the square [-half, half]
export function createWorldBuilder(cache, seed, half) {
  const rng = { seed };
  const cells = new Map();          // grid cell -> discs of the props ({ x, z, r }), for the free() test
  let maxR = 0;
  const b = {
    cache, half,
    props: [],      // { name, set, asset, family, variant, x, z, rot, palette, radius, discs }
    glades: [],     // { x, z, r, k }: clearings where light falls through the canopy
    start: [0, 0.6, 0],
    terrain: null,  // the level map (gen/terrain.js), when the recipe has cliffs
    ground: null,   // the ground paints (gen/ground.js), when the recipe has "ground"
    rays: 1,        // strength of the god rays (recipe "rays")
    clouds: null,   // [lo, hi] edges of the cloud shadows (recipe "clouds"), or the CloudLayer default
    rand: () => nextRandom(rng),
    range: (lo, hi) => lo + (hi - lo) * nextRandom(rng),
    pick: (arr) => arr[Math.floor(nextRandom(rng) * arr.length)],
    set: (asset, size, overrides) => shapeSet(cache, asset, size, overrides),

    // is a circle of radius r at (x, z) clear of everything placed so far?
    free(x, z, r) {
      const reach = r + maxR;
      for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++)
        for (let j = Math.floor((z - reach) / CELL); j <= Math.floor((z + reach) / CELL); j++)
          for (const c of cells.get(key(i, j)) || []) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
      return true;
    },

    // place variant `variant` (0, 1, ...) of a shape set; palette: one of the
    // set's palette names (default: its first). Its name: family/type/size/palette/variant (from 1)
    add(set, variant, x, z, rot = 0, palette = set.palette) {
      const shape = set.shapes[variant];
      const p = { name: `${set.asset}/${set.size}/${palette}/${variant + 1}`, set: set.key, asset: set.asset, family: set.family,
        variant, x, z, rot: shape.turns ? rot : 0, palette: set.palettes[palette], radius: shape.radius };
      p.discs = discsOf(shape, p);
      b.props.push(p);
      for (const c of p.discs) {
        const k = key(Math.floor(c.x / CELL), Math.floor(c.z / CELL));
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(c);
        maxR = Math.max(maxR, c.r);
      }
      return p;
    },
  };
  return b;
}

// the ground a shape placed at p = { x, z, rot } covers: its circles (water),
// turned like the object, else one circle of its radius -> [{ x, z, r }]
export function discsOf(shape, p) {
  if (!shape.circles) return [{ x: p.x, z: p.z, r: shape.radius }];
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return shape.circles.map(([x, z, r]) => ({ x: p.x + x * c + z * s, z: p.z - x * s + z * c, r }));
}

// what the game needs from a finished builder
export const finish = (b) => ({ props: b.props, glades: b.glades, half: b.half, start: b.start, shapes: b.cache, terrain: b.terrain, ground: b.ground, clouds: b.clouds, rays: b.rays, objects: b.objects ?? [] });
