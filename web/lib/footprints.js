import { cellKey, eachCell } from './cells.js';

// is (x, z) inside any circle of a grid (BlockGrid or CoverGrid)?
export function isBlocked(grid, x, z) {
  const set = grid.cells.get(cellKey(x, z));
  if (!set) return false;
  for (const b of set) if (Math.hypot(b.x - x, b.z - z) < b.r) return true;
  return false;
}

// a step (dx, dz) of a walker of radius r at (x, z) that runs into a circle of the grid, turned to go round it: only
// its part along the edge of that circle is kept (the classic slide), or null when it runs into none
export function slideRound(grid, x, z, dx, dz, r) {
  let out = null;
  eachCell(x + dx, z + dz, r, (k) => {
    if (out) return;
    for (const b of grid.cells.get(k) ?? []) {
      const nx = x - b.x, nz = z - b.z, d = Math.hypot(nx, nz);
      if (Math.hypot(x + dx - b.x, z + dz - b.z) >= b.r + r || d < 1e-6) continue;
      const along = (dx * nx + dz * nz) / d;
      if (along >= 0) continue;
      out = [dx - (along * nx) / d, dz - (along * nz) / d];
      return;
    }
  });
  return out;
}

// does a walker, a circle of radius r, going from (x0, z0) to (x, z), run into a circle of the grid? It runs into one
// it would overlap and get nearer to; one it already overlaps lets it go away (so it slides off instead of sticking)
export function bumps(grid, x0, z0, x, z, r) {
  let hit = false;
  eachCell(x, z, r, (k) => {
    if (hit) return;
    for (const b of grid.cells.get(k) ?? []) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < b.r + r && d < Math.hypot(b.x - x0, b.z - z0)) { hit = true; return; }
    }
  });
  return hit;
}
