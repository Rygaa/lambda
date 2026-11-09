// Spawning generated objects (gen/world.js props) as entities.
import { spawn, getResource } from '../ecs/world.js';
import { Transform, Prop, Footprint, Blocker, ShadowCaster } from '../components.js';
import { Assets, Settings, Tops } from '../resources.js';
import { blocks, BY_SHAPE } from '../gen/collision.js';
import { addShape } from './tops.js';
import { paletteRows } from '../gen/palettes.js';
import { heightAt } from '../gen/terrain.js';

export function spawnProp(world, p) {
  const shape = getResource(world, Assets).shapes.sets.get(p.set).shapes[p.variant];
  const { x, z } = p;
  // blockers reach up from the level the object stands on (the camera tests their top)
  const y = heightAt(getResource(world, Settings).land.terrain, x, z);
  const pairs = [
    [Transform, { x, z, rotY: p.rot }],
    [Prop, { name: p.name, set: p.set, variant: p.variant, palette: paletteRows(p.palette) }],
  ];
  if (!shape.circles) pairs.push([Footprint, { x, z, r: shape.radius }]);
  pairs.push([ShadowCaster]);
  // a rock or a building stops a walker by its shape, the others by a circle
  if (BY_SHAPE.includes(p.family)) addShape(getResource(world, Tops), shape.parts, x, y, z, p.rot);
  else if (blocks(shape) && !shape.circles) pairs.push([Blocker, { x, z, r: shape.blocker.r, h: y + shape.blocker.h }]);
  const e = spawn(world, ...pairs);
  // a shape that is not round (water): a footprint, and a blocker, per circle;
  // the grass is hidden a little past the circles, up to the shore
  if (shape.circles) for (const c of p.discs) {
    const more = blocks(shape) ? [[Blocker, { x: c.x, z: c.z, r: c.r, h: y + shape.blocker.h }]] : [];
    spawn(world, [Footprint, { x: c.x, z: c.z, r: c.r + COVER_PAD }], ...more);
  }
  return e;
}

const COVER_PAD = 0.2;
