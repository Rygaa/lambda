import { cellKey } from './cells.js';

// is (x, z) inside any circle of a grid (BlockGrid or CoverGrid)?
export function isBlocked(grid, x, z) {
  const set = grid.cells.get(cellKey(x, z));
  if (!set) return false;
  for (const b of set) if (Math.hypot(b.x - x, b.z - z) < b.r) return true;
  return false;
}
