// Holes in the ground (the Craters resource): the Kamehameha digs a trench where it passes (systems/blasts.js).
// The ground is cut in cells of CELL world units; a dug cell goes down a whole number of cubes (CELL high each). The
// ground is not drawn on a dug cell (render/shaders.js groundFrag reads the depths as a texture), and the hole is drawn
// in its place with cubes of earth: the floor of each cell and the walls where a neighbour is less deep
// (craterGeometry, systems/craters.js). A walker goes down into it (lib/walk.js groundAt).
import * as THREE from 'three';
import { heightAt } from '../gen/terrain.js';

export const CELL = 0.1;
const MAX = 8;        // cubes deep at most

// the holes of a world whose ground goes from -ext to ext: no cell dug yet
export function createCraters(ext) {
  const n = Math.ceil((2 * ext) / CELL), depth = new Uint8Array(n * n);
  const texture = new THREE.DataTexture(depth, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { ext, n, depth, texture, dug: new Set(), fresh: [], dirty: false, mesh: null };
}

const cellOf = (c, v) => Math.floor((v + c.ext) / CELL);

// how deep the hole is at (x, z), in world units (0: not dug)
export function depthAt(c, x, z) {
  if (!c) return 0;
  const i = cellOf(c, x), j = cellOf(c, z);
  return i < 0 || j < 0 || i >= c.n || j >= c.n ? 0 : c.depth[j * c.n + i] * CELL;
}

// digs a bowl of radius r around (x, z), `deep` cubes deep in its middle, less to its edge, ragged (rand: numbers in
// [0, 1)). A cell never gets less deep. The cells dug deeper go to `fresh` (dirt flies from them)
export function dig(c, x, z, r, deep, rand) {
  for (let j = cellOf(c, z - r); j <= cellOf(c, z + r); j++)
    for (let i = cellOf(c, x - r); i <= cellOf(c, x + r); i++) {
      if (i < 1 || j < 1 || i >= c.n - 1 || j >= c.n - 1) continue;
      const cx = -c.ext + (i + 0.5) * CELL, cz = -c.ext + (j + 0.5) * CELL, d = Math.hypot(cx - x, cz - z) / r;
      if (d > 1) continue;
      const want = Math.min(MAX, Math.round(deep * (1 - d * d) + (rand() - 0.5) * 1.6));
      const k = j * c.n + i;
      if (want <= c.depth[k]) continue;
      c.depth[k] = want;
      c.dug.add(k);
      c.fresh.push([cx, cz]);
      c.dirty = true;
    }
}

// the hole as one geometry (world units): the floor of each dug cell and its walls up to each neighbour less deep, with
// how far under the ground each corner is (aDug, render/shaders.js CRATER_FRAG). The cubes stand on the ground under
// each cell (gen/terrain.js heightAt)
export function craterGeometry(c, terrain) {
  const pos = [], nrm = [], dug = [], index = [];
  let g = 0;
  const quad = (a, b, cc, d, n) => {
    const v = pos.length / 3;
    pos.push(...a, ...b, ...cc, ...d);
    for (const p of [a, b, cc, d]) dug.push(g - p[1]);
    for (let q = 0; q < 4; q++) nrm.push(...n);
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  for (const k of c.dug) {
    const i = k % c.n, j = Math.floor(k / c.n), lv = c.depth[k];
    const x0 = -c.ext + i * CELL, z0 = -c.ext + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    g = heightAt(terrain, x0 + CELL / 2, z0 + CELL / 2);
    const y = g - lv * CELL;
    quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0]);
    // the walls: toward each neighbour less deep, from this floor up to its floor (the ground: 0)
    const side = (dk, mk) => { const m = c.depth[k + dk]; if (m < lv) mk(g - m * CELL); };
    side(-1, (top) => quad([x0, y, z0], [x0, top, z0], [x0, top, z1], [x0, y, z1], [1, 0, 0]));
    side(1, (top) => quad([x1, y, z1], [x1, top, z1], [x1, top, z0], [x1, y, z0], [-1, 0, 0]));
    side(-c.n, (top) => quad([x1, y, z0], [x1, top, z0], [x0, top, z0], [x0, y, z0], [0, 0, 1]));
    side(c.n, (top) => quad([x0, y, z1], [x0, top, z1], [x1, top, z1], [x1, y, z1], [0, 0, -1]));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('aDug', new THREE.Float32BufferAttribute(dug, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}
