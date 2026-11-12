// Voxels: a model becomes small cubes on a grid, only for the eye. Ported from the voxel branch
// (game/src/engine/voxel). Nothing else changes: the shapes, what stops a walker, and the game stay the same; only
// the geometry drawn is swapped (systems/voxels.js). The materials do not change either: a voxel mesh has the
// position and normal attributes of any mesh, and a textured one (the human, the monsters) a uv on the texel of its
// colour in one palette texture.
// The converter is lib/voxelCore.js; it runs in the voxel workers (lib/voxelPool.js, lib/voxelWorker.js). This file
// gives them the triangles of Three.js geometries and makes geometries of their answers.
import * as THREE from 'three';
import { getResource } from '../ecs/world.js';
import { Look, Settings, Voxels } from '../resources.js';

// the look now (the Look resource): null when things are drawn as they are, else { key, size (the cube edge, world
// units), normals (surface light), world: { key, size } }. The human and the monsters are drawn 4 times finer than
// the world, so they show cubes down to a quarter of a pixel; the rocks, plants and cliffs (world) show nothing
// smaller than a pixel, so their cubes are never smaller than WORLD_MIN pixels
const WORLD_MIN = 1;
export function lookOf(world) {
  const look = getResource(world, Look);
  if (!look.voxel) return null;
  const ppu = getResource(world, Settings).ppu, px = Math.max(WORLD_MIN, look.px);
  return { key: `${look.px}/${look.light}`, size: look.px / ppu, normals: look.light === 'surface',
    world: { key: `${px}/${look.light}`, size: px / ppu } };
}

// ------------------------------------------------------------------ palette
// every colour a textured voxel can have, in one texture: colour i is texel (i % SIDE, i / SIDE). It holds the
// sRGB bytes, like the textures of the human (lib/bake.js), so the fine material reads it the same way
const SIDE = 256;        // also in lib/voxelWorker.js

export function createPalette() {
  const data = new Uint8Array(SIDE * SIDE * 4);
  const texture = new THREE.DataTexture(data, SIDE, SIDE, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { data, texture, index: new Map() };
}

// the palette index of an sRGB colour 0xRRGGBB (added if new; when it is full, the nearest colour)
export function paletteAdd(pal, rgb) {
  let i = pal.index.get(rgb);
  if (i !== undefined) return i;
  i = pal.index.size;
  if (i >= SIDE * SIDE) return nearest(pal, rgb);
  pal.index.set(rgb, i);
  pal.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
  pal.texture.needsUpdate = true;
  return i;
}

function nearest(pal, rgb) {
  let best = 0, bestD = Infinity;
  for (const [c, i] of pal.index) {
    const d = (((c >> 16) & 255) - ((rgb >> 16) & 255)) ** 2 + (((c >> 8) & 255) - ((rgb >> 8) & 255)) ** 2 + ((c & 255) - (rgb & 255)) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// the id of a texture in the voxel workers: the first time, its colours go to the palette and the texture to every
// worker (lib/voxelWorker.js). The id is the hash of its texels, so a saved result is used again only for the same
// texture. Made once per texture
const shared = new WeakMap();
function shareTexture(v, texture) {
  if (shared.has(texture)) return shared.get(texture);
  const img = texture.image, cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const { width, height, data } = cx.getImageData(0, 0, cv.width, cv.height);
  const rgb = new Uint32Array(width * height), palette = new Map();
  let h = Math.imul(width, 31) ^ height;
  for (let k = 0; k < rgb.length; k++) {
    const c = (rgb[k] = (data[k * 4] << 16) | (data[k * 4 + 1] << 8) | data[k * 4 + 2]);
    if (!palette.has(c)) palette.set(c, paletteAdd(v.palette, c));
    h = Math.imul(h ^ c, 0x01000193);
  }
  const id = `${(h >>> 0).toString(36)}-${width}x${height}`;
  v.pool.tell({ texture: { id, width, height, rgb }, palette: [...palette] });
  shared.set(texture, id);
  return id;
}

// the arrays of a voxel worker as a BufferGeometry, or null
export function toGeometry(arrays) {
  if (!arrays) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3));
  if (arrays.uv) g.setAttribute('uv', new THREE.BufferAttribute(arrays.uv, 2));
  g.setIndex(new THREE.BufferAttribute(arrays.index, 1));
  g.computeBoundingSphere();
  return g;
}

// the triangles of a geometry, moved by a matrix (or none): positions p and normals nrm (9 numbers a triangle), uv (6)
export function triangles(geometry, matrix = null) {
  const pos = geometry.getAttribute('position'), nr = geometry.getAttribute('normal'), uvs = geometry.getAttribute('uv');
  const index = geometry.index ? geometry.index.array : null, count = index ? index.length : pos.count;
  const p = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = uvs ? new Float32Array(count * 2) : null;
  const e = matrix?.elements, nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix).elements : null;
  for (let t = 0; t < count; t++) {
    const i = index ? index[t] : t;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (e) {
      p[t * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      p[t * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      p[t * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    } else { p[t * 3] = x; p[t * 3 + 1] = y; p[t * 3 + 2] = z; }
    if (nr) {
      const a = nr.getX(i), b = nr.getY(i), c = nr.getZ(i);
      if (nm) {
        nrm[t * 3] = nm[0] * a + nm[3] * b + nm[6] * c;
        nrm[t * 3 + 1] = nm[1] * a + nm[4] * b + nm[7] * c;
        nrm[t * 3 + 2] = nm[2] * a + nm[5] * b + nm[8] * c;
      } else { nrm[t * 3] = a; nrm[t * 3 + 1] = b; nrm[t * 3 + 2] = c; }
    }
    if (uv) { uv[t * 2] = uvs.getX(i); uv[t * 2 + 1] = uvs.getY(i); }
  }
  // no normals: each triangle its face normal
  if (!nr) for (let t = 0; t < count; t += 3) {
    const ux = p[t * 3 + 3] - p[t * 3], uy = p[t * 3 + 4] - p[t * 3 + 1], uz = p[t * 3 + 5] - p[t * 3 + 2];
    const vx = p[t * 3 + 6] - p[t * 3], vy = p[t * 3 + 7] - p[t * 3 + 1], vz = p[t * 3 + 8] - p[t * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (let c = 0; c < 3; c++) nrm.set([fx, fy, fz], (t + c) * 3);
  }
  return { p, nrm, uv };
}

// a sheet seen from both sides (gen/solids.js sheet: each triangle twice, one per side) has only its side facing up
// left: else its two sides make two layers of cubes, and the top one gets the normal of the side under it (it looks
// dark). Other triangles stay. tris: of triangles(), without uv
export function oneSided({ p, nrm }) {
  const key = (t, order) => order.map((c) => `${p[t + c * 3].toFixed(4)},${p[t + c * 3 + 1].toFixed(4)},${p[t + c * 3 + 2].toFixed(4)}`).join('|');
  const seen = new Map();
  for (let t = 0; t < p.length; t += 9) seen.set(key(t, [0, 1, 2]), t);
  const drop = new Set();
  for (let t = 0; t < p.length; t += 9) {
    if (drop.has(t)) continue;
    // the same corners turned the other way (any start)
    const twin = [[0, 2, 1], [2, 1, 0], [1, 0, 2]].map((o) => seen.get(key(t, o))).find((u) => u !== undefined && u !== t);
    if (twin === undefined) continue;
    const ny = (q) => (p[q + 5] - p[q + 2]) * (p[q + 6] - p[q]) - (p[q + 3] - p[q]) * (p[q + 8] - p[q + 2]);
    drop.add(ny(t) >= ny(twin) ? twin : t);
  }
  if (!drop.size) return { p, nrm, uv: null };
  const keep = [];
  for (let t = 0; t < p.length; t += 9) if (!drop.has(t)) keep.push(t);
  const P = new Float32Array(keep.length * 9), N = new Float32Array(keep.length * 9);
  keep.forEach((t, i) => { P.set(p.subarray(t, t + 9), i * 9); N.set(nrm.subarray(t, t + 9), i * 9); });
  return { p: P, nrm: N, uv: null };
}

// ------------------------------------------------------------------ still textured meshes
// textured meshes that do not move (a FlyFF decor object, systems/objects.js) made of cubes on the grid of the world:
// one geometry (world units, with the uv of the palette), or null. size: the cube edge in world units. Their side
// toward the camera wins, like the rocks (lib/voxelCore.js voxelize view). local: in the units of their parent
// instead (the cubes of a model, for all its copies, whatever their turn: so the side facing up wins)
export async function voxelStill(world, meshes, size, normals, local = false) {
  const v = getResource(world, Voxels), view = local ? [0, 1, 0] : getResource(world, Settings).basis.F.clone().negate().toArray();
  const sources = meshes.map((mesh) => {
    mesh.updateMatrixWorld(true);
    return { tris: triangles(mesh.geometry, local ? mesh.matrix : mesh.matrixWorld), texture: shareTexture(v, mesh.material.uniforms.uMap.value) };
  });
  const { meshes: [arrays] } = await v.pool.run({ sources, size, opts: { normals, fill: true, view }, colors: 1 },
    sources.flatMap((s) => [s.tris.p.buffer, s.tris.nrm.buffer, s.tris.uv?.buffer].filter(Boolean)));
  return toGeometry(arrays);
}

// ------------------------------------------------------------------ baked clips
// the baked frames of a body (lib/bake.js: state -> frames -> one geometry per part) made of cubes: state -> frames
// -> [one geometry], with the colours of the textures of its parts in the palette (the Voxels resource). size: the
// cube edge in the units of the body. The frames are jobs of the voxel workers, before the jobs of the world, the idle
// clip first; only a few at a time wait, so their triangles do not fill the memory
export async function voxelClips(world, body, clips, size, normals) {
  const v = getResource(world, Voxels), textures = body.parts.map((part) => shareTexture(v, part.texture));
  const opts = { normals, fill: true, view: [0, 0, 0] };   // it turns, so no side faces the camera: the outer face wins
  const out = {}, pending = new Set();
  let since = performance.now();
  for (const state of ['idle', ...Object.keys(clips).filter((s) => s !== 'idle')]) {
    if (!clips[state]) continue;
    out[state] = clips[state].map(() => null);
    for (const [f, frame] of clips[state].entries()) {
      while (pending.size >= v.pool.size * 3) await Promise.race(pending);
      const sources = frame.map((geometry, m) => ({ tris: triangles(geometry), texture: textures[m] }));
      const job = v.pool.run({ sources, size, opts, colors: 1 }, sources.flatMap((s) => [s.tris.p.buffer, s.tris.nrm.buffer, s.tris.uv?.buffer].filter(Boolean)), true)
        .then(({ meshes: [arrays] }) => { out[state][f] = [toGeometry(arrays) ?? new THREE.BufferGeometry()]; pending.delete(job); });
      pending.add(job);
      if (performance.now() - since > 30) { await new Promise((r) => setTimeout(r)); since = performance.now(); }
    }
  }
  await Promise.all(pending);
  return out;
}
