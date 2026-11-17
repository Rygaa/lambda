// Grass and flowers inside a footprint drop below the ground.
import { query, added, getComponent, readEvents, getResource } from '../ecs/world.js';
import { GroundCover, SceneObject } from '../components.js';
import { CoverGrid } from '../resources.js';
import { FootprintChanged } from '../events.js';
import { eachCell } from '../lib/cells.js';
import { isBlocked } from '../lib/footprints.js';

export function groundCoverSystem(world) {
  const grid = getResource(world, CoverGrid);
  const events = readEvents(world, FootprintChanged);
  const fresh = new Set(added(world, GroundCover));
  for (const e of query(world, [GroundCover, SceneObject])) {
    if (!fresh.has(e) && !events.length) continue;
    const c = getComponent(world, e, GroundCover);
    const update = (i) => {
      c.pos[i * 3 + 1] = isBlocked(grid, c.light[i * 3], c.light[i * 3 + 2]) ? -1000 : c.home[i * 3 + 1];
    };
    if (fresh.has(e)) {
      for (let i = 0; i < c.pos.length / 3; i++) update(i);
    } else {
      for (const ev of events) eachCell(ev.x, ev.z, ev.r + 0.01, (k) => c.grid.get(k)?.forEach(update));
    }
    getComponent(world, e, SceneObject).group.geometry.attributes.iPos.needsUpdate = true;
  }
}
