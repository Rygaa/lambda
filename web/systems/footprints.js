// Keeps the grids in step with the components:
//   Footprint -> CoverGrid (no grass here), Blocker -> BlockGrid (nothing walks here)
import { added, removed, getComponent, sendEvent, getResource } from '../ecs/world.js';
import { Footprint, Blocker } from '../components.js';
import { BlockGrid, CoverGrid } from '../resources.js';
import { FootprintChanged } from '../events.js';
import { eachCell } from '../lib/cells.js';

function track(world, type, grid, onChange) {
  for (const e of added(world, type)) {
    const f = getComponent(world, e, type);
    eachCell(f.x, f.z, f.r, (k) => { if (!grid.cells.has(k)) grid.cells.set(k, new Set()); grid.cells.get(k).add(f); });
    onChange?.(f);
  }
  for (const [, f] of removed(world, type)) {
    eachCell(f.x, f.z, f.r, (k) => grid.cells.get(k)?.delete(f));
    onChange?.(f);
  }
}

export function footprintSystem(world) {
  track(world, Footprint, getResource(world, CoverGrid), (f) => sendEvent(world, FootprintChanged, { x: f.x, z: f.z, r: f.r }));
  track(world, Blocker, getResource(world, BlockGrid));
}
