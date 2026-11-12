// Copies a part of a FlyFF map into worlds/maps/<name>.json, for the recipe field "map" (documentation/worlds.md):
// the ground heights, the water, the ground textures as our paints, and the decor objects, all in FlyFF units.
//   node worlds/maps/import-map.mjs /path/to/flarine_city flarine 6871 3109 7231 3469
// The folder holds original/<World><x>-<z>.lnd (the FlyFF land files) and converted/objects.ron (the objects of those
// lands, with their model, place, turn and scale). The 4 numbers are the square kept: x0 z0 x1 z1 (FlyFF units).
// A .lnd file (FlyFF source, CLandscape::LoadLandscape): version, x, z, the heights (129 x 129 floats, one every 4
// units; 1000, 2000, 3000 or 4000 added for "no walk", "no fly"...), the water (16 x 16 patches of 32 units: height,
// kind; kind 2 is water), 256 bytes, then the texture layers: texture id, 256 patch flags, a 128 x 128 map whose
// alpha says how much of the texture covers the ground (only 112 x 112 of it is used, stretched over the land).
import fs from 'node:fs';
import path from 'node:path';
import { boxOf } from '../../assets/flyff.mjs';

const [SRC, NAME, ...box] = process.argv.slice(2);
if (!SRC || !NAME || box.length !== 4) throw new Error('usage: node import-map.mjs /path/to/folder name x0 z0 x1 z1');
const [X0, Z0, X1, Z1] = box.map(Number);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LAND = 512, STEP = 4, SIDE = 129, BASE = 96;     // BASE: the height of the water, our y = 0
const FLOAT = 5;     // an object whose lowest point is more than this over the ground under it floats in the air
// FlyFF ground textures (Resource/Terrain.inc) -> our paints (gen/ground.js); the others are grass
const PAINT_OF = {
  0: 'sand',                                   // default.dds: the light sand ground
  8: 'pavement', 215: 'pavement',              // brick_MaFl01: the squares and streets of Flarine
  54: 'dirt', 18: 'dirt', 17: 'dirt', 19: 'dirt', 13: 'dirt', 88: 'dirt', 89: 'dirt',   // the rocky grounds
};
const PAINTS = ['sand', 'dirt', 'pavement'];

// the lands of the folder: (x, z) -> { heights, water, layers: [{ tex, alpha }] }
const lands = new Map();
for (const f of fs.readdirSync(path.join(SRC, 'original')).filter((f) => f.endsWith('.lnd'))) {
  const buf = fs.readFileSync(path.join(SRC, 'original', f)), v = new DataView(buf.buffer, buf.byteOffset, buf.length);
  const x = v.getInt32(4, true), z = v.getInt32(8, true);
  let o = 12;
  const heights = new Float32Array(SIDE * SIDE);
  for (let i = 0; i < heights.length; i++, o += 4) heights[i] = v.getFloat32(o, true) % 1000;
  const water = [];
  for (let i = 0; i < 256; i++, o += 2) water.push({ y: buf[o], kind: buf[o + 1] & 3 });
  o += 256;
  const layers = [];
  for (let n = buf[o++], j = 0; j < n; j++) {
    const tex = v.getUint16(o, true), alpha = new Uint8Array(128 * 128);
    o += 2 + 256 * 4;
    for (let i = 0; i < alpha.length; i++, o += 4) alpha[i] = buf[o + 3];
    layers.push({ tex, alpha });
  }
  lands.set(`${x},${z}`, { heights, water, layers });
}

// what is at the corner (x, z) of the grid (FlyFF units): its land and its place in it (i, j: 0 to 128). A corner on
// the edge of two lands is in both
function at(x, z) {
  const near = (v) => (v % LAND === 0 ? [v / LAND, v / LAND - 1] : [Math.floor(v / LAND)]);
  for (const lx of near(x)) for (const lz of near(z)) {
    const land = lands.get(`${lx},${lz}`);
    if (land) return { land, i: Math.round((x - lx * LAND) / STEP), j: Math.round((z - lz * LAND) / STEP) };
  }
  throw new Error(`no land file for (${x}, ${z})`);
}
// the alpha of a layer at tile corner (i, j), as FlyFF reads it: 112 texels over the land, filtered
function alphaAt(alpha, i, j) {
  const fx = Math.min(127, i * 0.875), fz = Math.min(127, j * 0.875), x = Math.floor(fx), z = Math.floor(fz), tx = fx - x, tz = fz - z;
  const a = (u, w) => alpha[Math.min(127, w) * 128 + Math.min(127, u)];
  return ((a(x, z) * (1 - tx) + a(x + 1, z) * tx) * (1 - tz) + (a(x, z + 1) * (1 - tx) + a(x + 1, z + 1) * tx) * tz) / 255;
}

const nx = (X1 - X0) / STEP, nz = (Z1 - Z0) / STEP;
const heights = [], water = [], paints = [];
for (let r = 0; r <= nz; r++) {
  const hRow = [], wRow = [], pRow = [];
  for (let c = 0; c <= nx; c++) {
    const { land, i, j } = at(X0 + c * STEP, Z0 + r * STEP);
    hRow.push(+(land.heights[j * SIDE + i] - BASE).toFixed(2));
    const patch = land.water[Math.min(15, Math.floor(j / 8)) * 16 + Math.min(15, Math.floor(i / 8))];
    wRow.push(patch.kind === 2 ? 1 : 0);
    // each layer covers the ones before it by its alpha; the first covers all
    const w = Object.fromEntries(PAINTS.map((p) => [p, 0]));
    let left = 1;
    for (let n = land.layers.length - 1; n >= 0 && left > 0; n--) {
      const a = n === 0 ? 1 : alphaAt(land.layers[n].alpha, i, j), paint = PAINT_OF[land.layers[n].tex];
      if (paint) w[paint] += a * left;
      left *= 1 - a;
    }
    pRow.push(PAINTS.map((p) => Math.round(w[p] * 255)));
  }
  heights.push(hRow); water.push(wRow); paints.push(pRow);
}

// the height of the ground at (x, z) (FlyFF units), between the corners around it
function groundAt(x, z) {
  const c = Math.floor(x / STEP) * STEP, r = Math.floor(z / STEP) * STEP, u = (x - c) / STEP, v = (z - r) / STEP;
  const h = (dc, dr) => { const { land, i, j } = at(c + dc, r + dr); return land.heights[j * SIDE + i]; };
  return (h(0, 0) * (1 - u) + h(STEP, 0) * u) * (1 - v) + (h(0, STEP) * (1 - u) + h(STEP, STEP) * u) * v;
}

// the objects: [name, x, z, y, turn (degrees), scale], x z from the corner (X0, Z0), y from BASE. The archived ones
// (assets/objects/archived.json) are left out, and the trees and leafy plants among them go into the trees and the plants:
// [x, z, turn, height], its height (FlyFF units), for ours (gen/map.js); a plant also says which of the archived plants
// it is (0, 1, 2: our plant/leafy has a shape for each, in that order). A floating object not archived yet is named:
// archive it
const names = JSON.parse(fs.readFileSync(path.join(HERE, '../../assets/objects/objects.json'), 'utf8')).objects;
const archived = JSON.parse(fs.readFileSync(path.join(HERE, '../../assets/objects/archived.json'), 'utf8'));
const bottoms = {};     // name -> the lowest point of its model
const bottom = (name) => (bottoms[name] ??= boxOf(fs.readFileSync(path.join(HERE, '../../assets/objects/models', `${names[name].model}.glb`)))[1]);
const ron = fs.readFileSync(path.join(SRC, 'converted/objects.ron'), 'utf8').replace(/\r/g, '');
const re = /model: Some\("models\/obj_([^"]+)\.glb"\),\s*pos: \(([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\),\s*angle_y: ([-\d.e]+),[^)]*?scale: \(([-\d.e]+)/g;
const objects = [], trees = [], plants = [], missing = new Set(), floating = new Set();
let left = 0;
for (const [, model, x, y, z, turn, scale] of ron.matchAll(re)) {
  const name = model.trim(), [fx, fz] = [Number(x), Number(z)];
  if (fx < X0 || fx >= X1 || fz < Z0 || fz >= Z1) continue;
  if (!names[name]) { missing.add(name); continue; }
  if (archived.floating[name]) { left++; continue; }
  if (archived.trees[name] || archived.plants[name]) {
    const row = [+(fx - X0).toFixed(2), +(fz - Z0).toFixed(2), +Number(turn).toFixed(1), +(Number(scale) * names[name].size[1]).toFixed(2)];
    if (archived.trees[name]) trees.push(row);
    else plants.push([...row, Object.keys(archived.plants).indexOf(name)]);    // which one: our plant/leafy has them in this order
    continue;
  }
  if (Number(y) + Number(scale) * bottom(name) - groundAt(fx, fz) > FLOAT) floating.add(name);
  objects.push([name, +(fx - X0).toFixed(2), +(fz - Z0).toFixed(2), +(Number(y) - BASE).toFixed(2), +Number(turn).toFixed(1), +Number(scale).toFixed(3)]);
}

const rows = (grid) => '[\n' + grid.map((row) => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]';
const out = `{
  "source": "FlyFF ${path.basename(SRC)}: ${[...lands.keys()].join(' ')} (worlds/maps/import-map.mjs)",
  "box": [${X0}, ${Z0}, ${X1}, ${Z1}],
  "step": ${STEP},
  "heights": ${rows(heights)},
  "water": ${rows(water)},
  "paints": ${JSON.stringify(PAINTS)},
  "ground": ${rows(paints)},
  "objects": ${rows(objects)},
  "trees": ${rows(trees)},
  "plants": ${rows(plants)}
}
`;
fs.writeFileSync(path.join(HERE, `${NAME}.json`), out);
console.log(`${NAME}.json: ${nx + 1} x ${nz + 1} corners, ${objects.length} objects, ${trees.length} trees, ${plants.length} leafy plants, ${left} floating left out${floating.size ? `, floating and not archived: ${[...floating].join(' ')}` : ''}${missing.size ? `, not in objects.json: ${[...missing].join(' ')}` : ''}`);
