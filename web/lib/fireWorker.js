// The fire worker (systems/burn.js): it makes the voxels of the fire of an object away from the page, so the game does
// not stop when a tree gets warm. Each part is voxelized alone (filled as one shape, so its inside takes its own
// material: in one volume the inside of the leaves next to the trunk took the colour of the trunk, a branch that is not
// there), then all go in one grid (the grid starts at 0 in the units of the object for every part); where they meet, a
// part that stays wins (the trunk goes on inside the leaves).
//   In:  { id, size, parts: [{ p, nrm (lib/voxels.js triangles), stays, water, leaves (its voxels hold the leaf clumps) }],
//        wet (times the water), seed, patch (voxels: the size of the patches where the water changes), patchWater (from
//        1 - this to 1 + this), clumps (x, y, z of each leaf clump, in the units of the object) }
//   Out: { id, min, n: [nx, ny, nz], count, grid (cell -> voxel or -1), at (voxel -> cell), xyz, part, nrm (3 a voxel,
//        0: it was inside the shape), water, shown (the voxels next to an empty cell), clumpAt (the voxel of a part with
//        leaves nearest to each clump, or -1), held (1: a voxel joined, voxel by voxel, to no part that stays and not to
//        the ground in the shape itself, a small bit of a canopy: it stays where it is, as it looks without fire) }
//        or { id, count: 0 }
import { voxelize, oneSided, decodeNormal } from './voxelCore.js';

self.onmessage = ({ data }) => {
  const { id, size, parts, wet, seed, patch, patchWater, clumps } = data;
  const vols = parts.map(({ p, nrm }) => voxelize([{ tris: oneSided({ p, nrm }), color: 0 }], size, { normals: true, fill: true, view: [0, 1, 0] }));
  const some = vols.filter(Boolean);
  if (!some.length) return self.postMessage({ id, count: 0 });
  const min = [0, 1, 2].map((a) => Math.min(...some.map((v) => v.min[a])));
  const n = [0, 1, 2].map((a) => Math.max(...some.map((v) => v.min[a] + v.n[a])) - min[a]);
  const [nx, ny, nz] = n, data3 = new Uint8Array(nx * ny * nz), normals = new Uint16Array(data3.length);
  const order = parts.map((_, c) => c).sort((a, b) => (parts[a].stays ? 1 : 0) - (parts[b].stays ? 1 : 0));
  for (const c of order) {
    const v = vols[c];
    if (!v) continue;
    const [vx, vy, vz] = v.n, [ox, oy, oz] = [0, 1, 2].map((a) => v.min[a] - min[a]);
    for (let z = 0; z < vz; z++) for (let y = 0; y < vy; y++) for (let x = 0; x < vx; x++) {
      const k = x + vx * (y + vy * z);
      if (!v.data[k]) continue;
      const K = x + ox + nx * (y + oy + ny * (z + oz));
      data3[K] = c + 1;
      normals[K] = v.normals[k];
    }
  }
  // the voxels
  const grid = new Int32Array(data3.length).fill(-1);
  let count = 0;
  for (let k = 0; k < data3.length; k++) if (data3[k]) grid[k] = count++;
  const at = new Int32Array(count), xyz = new Int16Array(count * 3), part = new Uint8Array(count), nrm = new Float32Array(count * 3), water = new Float32Array(count);
  const noise = patches(seed, patch), dec = [0, 0, 0];
  for (let k = 0; k < data3.length; k++) {
    const c = grid[k];
    if (c < 0) continue;
    const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / (nx * ny));
    at[c] = k;
    xyz[c * 3] = x; xyz[c * 3 + 1] = y; xyz[c * 3 + 2] = z;
    part[c] = data3[k] - 1;
    if (normals[k]) nrm.set(decodeNormal(normals[k], dec), c * 3);
    water[c] = parts[part[c]].water * wet * (1 + patchWater * (2 * noise(x, y, z) - 1));
  }
  // the voxels that show at first: next to an empty cell (the grid has an empty border)
  const offs = [1, -1, nx, -nx, nx * ny, -nx * ny], open = [];
  for (let c = 0; c < count; c++) if (offs.some((o) => grid[at[c] + o] < 0)) open.push(c);
  const shown = Int32Array.from(open);
  // the voxel each leaf clump goes with: the nearest of a part with leaves, first in the cells around it, else among all
  const clumpAt = new Int32Array(clumps.length / 3).fill(-1), R = 4;
  for (let i = 0; i < clumpAt.length; i++) {
    const gx = Math.floor(clumps[i * 3] / size) - min[0], gy = Math.floor(clumps[i * 3 + 1] / size) - min[1], gz = Math.floor(clumps[i * 3 + 2] / size) - min[2];
    let best = -1, bestD = Infinity;
    for (let z = gz - R; z <= gz + R; z++) for (let y = gy - R; y <= gy + R; y++) for (let x = gx - R; x <= gx + R; x++) {
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const c = grid[x + nx * (y + ny * z)];
      if (c < 0 || !parts[part[c]].leaves) continue;
      const d = (x - gx) ** 2 + (y - gy) ** 2 + (z - gz) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best < 0) for (let c = 0; c < count; c++) {
      if (!parts[part[c]].leaves) continue;
      const d = (xyz[c * 3] - gx) ** 2 + (xyz[c * 3 + 1] - gy) ** 2 + (xyz[c * 3 + 2] - gz) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    clumpAt[i] = best;
  }
  // the bits joined to nothing in the shape itself (systems/burn.js join: the same ground row)
  const floor = Math.max(1, Math.ceil(-min[1] - 0.5)), held = new Uint8Array(count).fill(1), stack = [];
  for (let c = 0; c < count; c++) if (parts[part[c]].stays || xyz[c * 3 + 1] <= floor) { held[c] = 0; stack.push(c); }
  while (stack.length) {
    const k = at[stack.pop()];
    for (const o of offs) { const d = grid[k + o]; if (d >= 0 && held[d]) { held[d] = 0; stack.push(d); } }
  }
  self.postMessage({ id, min, n, count, grid, at, xyz, part, nrm, water, shown, clumpAt, held },
    [grid.buffer, at.buffer, xyz.buffer, part.buffer, nrm.buffer, water.buffer, shown.buffer, clumpAt.buffer, held.buffer]);
};

// smooth noise from 0 to 1 that changes over about `size` voxels: a function of a cell
function patches(seed, size) {
  const hash = (x, y, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const ease = (t) => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
  return (x, y, z) => {
    x /= size; y /= size; z /= size;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = ease(x - X), v = ease(y - Y), w = ease(z - Z);
    const at = (i, j, k) => hash(X + i, Y + j, Z + k);
    return lerp(lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
      lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w);
  };
}
