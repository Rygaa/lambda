import { cellKey } from './cells.js';
import { heightAt, STEP } from '../gen/terrain.js';

// is (x, z) inside any circle of a grid (BlockGrid or CoverGrid)?
export function isBlocked(grid, x, z) {
  const set = grid.cells.get(cellKey(x, z));
  if (!set) return false;
  for (const b of set) if (Math.hypot(b.x - x, b.z - z) < b.r) return true;
  return false;
}

// does a circle of radius r at (x, z) touch a blocker? With cliffs (grid.ground,
// gen/terrain.js), a cliff is in the way too: ground more than a STEP above or
// below y, the height it stands at (default: the ground at its middle)
export function circleBlocked(grid, x, z, r, y = heightAt(grid.ground, x, z)) {
  const stops = (px, pz) => isBlocked(grid, px, pz) || (grid.ground && Math.abs(heightAt(grid.ground, px, pz) - y) > STEP);
  if (stops(x, z)) return true;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (stops(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true;
  }
  return false;
}

// move a circle from (x, z) toward (nx, nz), sliding along blockers and
// cliffs: both axes, else one of them, else it stays -> [x, z]
export function slide(grid, x, z, nx, nz, r) {
  const y = heightAt(grid.ground, x, z);
  if (!circleBlocked(grid, nx, nz, r, y)) return [nx, nz];
  if (!circleBlocked(grid, nx, z, r, y)) return [nx, z];
  if (!circleBlocked(grid, x, nz, r, y)) return [x, nz];
  return [x, z];
}

// is the point (x, y, z) inside a blocker (a standing cylinder up to height h) or the ground?
export function blockedAbove(grid, x, z, y) {
  if (y < heightAt(grid.ground, x, z) + 0.05) return true;
  const set = grid.cells.get(cellKey(x, z));
  if (!set) return false;
  for (const b of set) if (y < b.h && Math.hypot(b.x - x, b.z - z) < b.r) return true;
  return false;
}
