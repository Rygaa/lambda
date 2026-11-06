// Pushes anything with a Knockback (a hit slime, the player hit by a slime),
// sliding along stones; the push slows down and ends after its time.
import { query, getComponent, removeComponent, markChanged, getResource } from '../ecs/world.js';
import { Knockback, Transform, Player, Slime } from '../components.js';
import { Time, Settings, BlockGrid } from '../resources.js';
import { slide } from '../lib/footprints.js';
import { SLIME_AI } from '../prefabs/slime.js';

export function knockbackSystem(world) {
  const time = getResource(world, Time);
  if (time.paused) return;
  const grid = getResource(world, BlockGrid);
  const lim = getResource(world, Settings).edgeLimit;
  const clamp = (v) => Math.max(-lim, Math.min(lim, v));
  for (const e of query(world, [Knockback, Transform])) {
    const k = getComponent(world, e, Knockback);
    const t = getComponent(world, e, Transform);
    const r = getComponent(world, e, Player)?.radius ?? (getComponent(world, e, Slime) ? SLIME_AI.radius : 0.2);
    [t.x, t.z] = slide(grid, t.x, t.z, clamp(t.x + k.vx * time.dt), clamp(t.z + k.vz * time.dt), r);
    markChanged(world, e, Transform);
    const fade = Math.exp(-8 * time.dt);
    k.vx *= fade;
    k.vz *= fade;
    k.time -= time.dt;
    if (k.time <= 0) removeComponent(world, e, Knockback);
  }
}
