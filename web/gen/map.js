// A part of a FlyFF map as our world (recipe "map": worlds/maps/<name>.json, made by worlds/maps/import-map.mjs; see
// documentation/worlds.md): its ground heights, its water, its ground textures as our paints, and its decor objects,
// all as in FlyFF, at the size of the FlyFF human next to ours (FLYFF). FlyFF z goes north, so it is our -z.
//   buildMap: the terrain, the ground paints, the objects, the trees and the plants of a world builder (gen/world.js)
//   mapHeightAt, mapWetAt, mapGeometry: what gen/terrain.js answers for such a terrain
//   mapHighAt: the highest ground around a point (over what is a head, systems/objects.js)
import * as THREE from 'three';
import { createGround, GROUND_CELL, PAINTS } from './ground.js';
import { surface } from './builders/water.js';

export const FLYFF = 0.645;    // world units per FlyFF unit: the FlyFF human is 1.63 tall, ours 1.05 (lib/character.js)
const PAD = 30;                // the ground goes on this far past the map, flat at its edge (the camera sees past it)
const DEEP = 0.15;             // a walker stops where the water is deeper than this
const AROUND = 3;              // mapHighAt looks this many corners around (8 units: across a river, to its banks)

// b: a world builder, map: the parsed worlds/maps/<name>.json, ours: our types for its trees and its leafy plants
// ({ trees, plants }, recipe "trees" and "plants": each { asset, size }, or none: left out)
export function buildMap(b, map, ours = {}) {
  const n = map.heights.length - 1, step = map.step * FLYFF, half = (n * step) / 2;
  const t = { kind: 'map', n, step, half, height: new Float32Array((n + 1) ** 2), water: new Uint8Array((n + 1) ** 2) };
  for (let r = 0; r <= n; r++)
    for (let c = 0; c <= n; c++) {
      t.height[r * (n + 1) + c] = map.heights[r][c] * FLYFF;
      t.water[r * (n + 1) + c] = map.water[r][c];
    }
  b.terrain = t;
  b.ground = paintsOf(b.half, t, map);
  const mid = (n * map.step) / 2;
  // the turn stays as in FlyFF: its models are flipped in z like its places (the fence pieces then meet end to end)
  b.objects = map.objects.map(([object, x, z, y, turn, scale]) =>
    ({ object, x: (x - mid) * FLYFF, z: (mid - z) * FLYFF, y: y * FLYFF, rot: (turn * Math.PI) / 180, k: scale * FLYFF }));
  for (const kind of ['trees', 'plants']) if (ours[kind]) placeOurs(b, map[kind] ?? [], ours[kind], mid);
}

// the trees or the leafy plants of the map (FlyFF ones, assets/objects/archived.json) as ours, about as high: our type
// scaled in steps of 1/4, one shape set per step. A row that says which FlyFF plant it was ([x, z, turn, height, which])
// gets that shape of ours (plant/leafy has one per FlyFF plant), else one by chance
function placeOurs(b, rows, { asset, size }, mid) {
  const base = b.set(asset, size), sets = new Map();
  const scale = base.params.scale ?? [1, 1];
  for (const [x, z, turn, height, which] of rows) {
    const variant = which ?? Math.floor(b.rand() * base.shapes.length);
    const k = Math.max(0.5, Math.round(((height * FLYFF) / base.shapes[variant].height) * 4) / 4);
    if (!sets.has(k)) sets.set(k, k === 1 ? base : b.set(asset, size, { scale: scale.map((v) => v * k) }));
    b.add(sets.get(k), variant, (x - mid) * FLYFF, (mid - z) * FLYFF, (turn * Math.PI) / 180);
  }
}

// the grid place of (x, z): column, row (FlyFF z = our -z), clamped to the map
const place = (t, x, z) => [Math.min(t.n, Math.max(0, (x + t.half) / t.step)), Math.min(t.n, Math.max(0, (t.half - z) / t.step))];
const corner = (t, a, c, r) => a[Math.min(t.n, r) * (t.n + 1) + Math.min(t.n, c)];

// the height of the ground at (x, z): on the triangles of mapGeometry
export function mapHeightAt(t, x, z) {
  const [fc, fr] = place(t, x, z), c = Math.min(t.n - 1, Math.floor(fc)), r = Math.min(t.n - 1, Math.floor(fr)), u = fc - c, v = fr - r;
  const h = (dc, dr) => corner(t, t.height, c + dc, r + dr);
  return u + v <= 1 ? h(0, 0) + (h(1, 0) - h(0, 0)) * u + (h(0, 1) - h(0, 0)) * v
    : h(1, 1) + (h(0, 1) - h(1, 1)) * (1 - u) + (h(1, 0) - h(1, 1)) * (1 - v);
}

// the highest ground (or water) within AROUND corners of (x, z): a bridge over a river is as high as its banks
export function mapHighAt(t, x, z) {
  if (!t.high) {
    t.high = new Float32Array((t.n + 1) ** 2);
    for (let r = 0; r <= t.n; r++)
      for (let c = 0; c <= t.n; c++) {
        let h = 0;
        for (let dr = -AROUND; dr <= AROUND; dr++)
          for (let dc = -AROUND; dc <= AROUND; dc++) h = Math.max(h, corner(t, t.height, Math.max(0, c + dc), Math.max(0, r + dr)));
        t.high[r * (t.n + 1) + c] = h;
      }
  }
  const [fc, fr] = place(t, x, z);
  return corner(t, t.high, Math.round(fc), Math.round(fr));
}

// how deep the water is at (x, z): its surface is y = 0; 0 where there is none
export function mapDepthAt(t, x, z) {
  const [fc, fr] = place(t, x, z);
  return corner(t, t.water, Math.round(fc), Math.round(fr)) ? Math.max(0, -mapHeightAt(t, x, z)) : 0;
}

// does the water stop a walker at (x, z)?
export const mapWetAt = (t, x, z) => mapDepthAt(t, x, z) > DEEP;

// the ground (one vertex per corner, PAD more past the edge) and the water surface (water.js surface)
export function mapGeometry(t) {
  const xs = [-t.half - PAD, ...Array.from({ length: t.n + 1 }, (_, i) => -t.half + i * t.step), t.half + PAD], m = xs.length;
  const pos = [], index = [];
  for (const z of [...xs].reverse()) for (const x of xs) pos.push(x, mapHeightAt(t, x, z), z);
  for (let r = 0; r < m - 1; r++)
    for (let c = 0; c < m - 1; c++) {
      const a = r * m + c, b = a + 1, d = a + m, e = d + 1;      // rows go north to south, like the grid
      index.push(a, b, d, b, e, d);    // facing up, split like mapHeightAt
    }
  const tops = new THREE.BufferGeometry();
  tops.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tops.setIndex(index);
  tops.computeVertexNormals();
  const water = surface((x, z) => {
    const [fc, fr] = place(t, x, z);
    return corner(t, t.water, Math.round(fc), Math.round(fr)) ? -mapHeightAt(t, x, z) : -1;
  }, [-t.half, t.half, -t.half, t.half]);
  return { tops, water: water.index.count ? water : null };
}

// the ground paints of the map (its "ground": per corner, how much of each of its "paints", 0 to 255) on our paint
// grid (gen/ground.js), filtered between the corners
function paintsOf(half, t, map) {
  const g = createGround(half), channels = map.paints.map((p) => PAINTS.indexOf(p));
  for (let j = 0; j < g.n; j++)
    for (let i = 0; i < g.n; i++) {
      const [fc, fr] = place(t, -g.ext + (i + 0.5) * GROUND_CELL, -g.ext + (j + 0.5) * GROUND_CELL);
      const c = Math.min(t.n - 1, Math.floor(fc)), r = Math.min(t.n - 1, Math.floor(fr)), u = fc - c, v = fr - r;
      channels.forEach((ch, k) => {
        const at = (dc, dr) => map.ground[r + dr][c + dc][k];
        g.data[(j * g.n + i) * 4 + ch] = Math.round((at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v);
      });
    }
  return g;
}
