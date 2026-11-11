// A voxel worker (lib/voxelPool.js): it makes cubes away from the page, so the game does not stop. The world (a rock, a
// plant, a piece of cliff: systems/voxels.js) and the bodies (one frame of the human or a monster: lib/voxels.js
// voxelClips) send the same jobs.
//   A texture: { texture: { id, width, height, rgb (0xRRGGBB per texel) }, palette: [[rgb, palette index], ...] }. Sent
//   once to each worker before the jobs that use it.
//   A job: { id, sources: [{ tris, color } or { tris, texture: id }], size, opts, colors: how many meshes (one per
//   colour; a textured body: 1) }. Out: { id, meshes: [arrays of lib/voxelCore.js meshArrays, or null] }, with a uv
//   on the palette texel of each colour for a textured body.
// Each result is saved in IndexedDB under the hash of its job, so the same job later (the same world, outfit and cube
// size, even after a reload) is read back instead of made again. The colours are saved as 0xRRGGBB, not as palette
// places, because the palette is made again in another order at each load. The disk is slow (the human alone is
// hundreds of MB), so a job never waits for it: the worker knows the saved keys, and the writes go on behind.
import { voxelize, meshArrays } from './voxelCore.js';

// bump it when the cubes made change (lib/voxelCore.js), so the saved ones are not used any more
const VERSION = 1;
const SIDE = 256;        // the palette texture is SIDE x SIDE colours (lib/voxels.js createPalette)
const textures = new Map(), palette = new Map();

self.onmessage = async ({ data }) => {
  if (data.texture) {
    textures.set(data.texture.id, data.texture);
    for (const [rgb, i] of data.palette) palette.set(rgb, i);
    return;
  }
  const { id, sources, size, opts, colors } = data, textured = sources.some((s) => s.texture !== undefined);
  const key = hashJob(data);
  let meshes = await load(key, size);
  if (!meshes) {
    meshes = make(sources, size, opts, colors, textured);
    await save(key, meshes, size);
  }
  if (textured) meshes = meshes.map((m) => m && { ...m, uv: uvOf(m.color), color: null });
  self.postMessage({ id, meshes }, meshes.flatMap((m) => (m ? [m.position.buffer, m.normal.buffer, m.index.buffer, ...(m.uv ? [m.uv.buffer] : [])] : [])));
};

function make(sources, size, opts, colors, textured) {
  const volume = voxelize(sources.map((s) => (s.texture === undefined ? s : { ...s, colorAt: colorAt(textures.get(s.texture)) })), size, opts);
  return Array.from({ length: colors }, (_, c) => (volume ? meshArrays(volume, { only: textured ? -1 : c, colors: textured }) : null));
}

// (u, v) -> the 0xRRGGBB of a texture there (repeated, nearest texel, flipY false like lib/bake.js)
const colorAt = ({ width, height, rgb }) => (u, v) =>
  rgb[Math.min(height - 1, Math.floor((v - Math.floor(v)) * height)) * width + Math.min(width - 1, Math.floor((u - Math.floor(u)) * width))];

// the uv of each corner: the palette texel of its colour
function uvOf(color) {
  const uv = new Float32Array(color.length * 2);
  for (let i = 0; i < color.length; i++) {
    const c = palette.get(color[i]) ?? 0;
    uv[i * 2] = ((c % SIDE) + 0.5) / SIDE;
    uv[i * 2 + 1] = (Math.floor(c / SIDE) + 0.5) / SIDE;
  }
  return uv;
}

// ------------------------------------------------------------------ the saved results
// two 32-bit hashes of everything that makes the result: the triangles, the colours, the size and the options
function hashJob({ sources, size, opts, colors }) {
  let a = 0x811c9dc5 ^ VERSION, b = 0x9747b28c;
  const add = (x) => { a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ x, 0x5bd1e995); b ^= b >>> 15; };
  const addText = (text) => { for (let i = 0; i < text.length; i++) add(text.charCodeAt(i)); };
  addText(JSON.stringify({ size, opts, colors }));
  for (const s of sources) {
    for (const array of [s.tris.p, s.tris.nrm, s.tris.uv]) {
      if (!array) { add(0); continue; }
      add(array.length);
      const words = new Uint32Array(array.buffer, array.byteOffset, array.length);
      for (let i = 0; i < words.length; i++) add(words[i]);
    }
    addText(String(s.texture ?? s.color ?? 0));
  }
  return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}

// the database, or null where there is none (a private window); a result that cannot be read or saved is made again
const db = new Promise((resolve) => {
  try {
    const open = indexedDB.open('lambda-voxels', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('meshes');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => resolve(null);
  } catch { resolve(null); }
});

// the keys saved when the worker starts, and the ones it saves itself
const known = db.then((d) => new Promise((resolve) => {
  try {
    const keys = d.transaction('meshes').objectStore('meshes').getAllKeys();
    keys.onsuccess = () => resolve(new Set(keys.result));
    keys.onerror = () => resolve(new Set());
  } catch { resolve(new Set()); }
}));

async function load(key, size) {
  if (!(await known).has(key)) return null;
  const d = await db;
  return new Promise((resolve) => {
    try {
      const get = d.transaction('meshes').objectStore('meshes').get(key);
      get.onsuccess = () => resolve(get.result ? get.result.map((m) => m && unpack(m, size)) : null);
      get.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

// put() copies the result at once, so it can be sent to the page right after; the writing goes on behind
async function save(key, meshes, size) {
  const d = await db, keys = await known;
  try {
    const put = d.transaction('meshes', 'readwrite').objectStore('meshes').put(meshes.map((m) => m && pack(m, size)), key);
    put.onsuccess = () => keys.add(key);
  } catch { /* full: not saved */ }
}

// a mesh of meshArrays, smaller for the disk: each face is 4 corners on the grid (whole numbers), one normal and one
// colour; the index is always the same (two triangles a face), so it is not saved. unpack gives back the same numbers
function pack({ position, normal, color, index }, size) {
  const quads = index.length / 6, grid = position.map((x) => Math.round(x / size));
  const small = grid.every((g) => g >= -32768 && g < 32768);
  const n = new Float32Array(quads * 3), c = color ? new Uint32Array(quads) : null;
  for (let q = 0; q < quads; q++) {
    n.set(normal.subarray(q * 12, q * 12 + 3), q * 3);
    if (c) c[q] = color[q * 4];
  }
  return { quads, grid: small ? Int16Array.from(grid) : Int32Array.from(grid), normal: n, color: c };
}

function unpack({ quads, grid, normal: n, color: c }, size) {
  const position = new Float32Array(quads * 12), normal = new Float32Array(quads * 12), color = c ? new Uint32Array(quads * 4) : null;
  const index = quads * 4 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  for (let i = 0; i < position.length; i++) position[i] = grid[i] * size;
  for (let q = 0; q < quads; q++) {
    for (let k = 0; k < 4; k++) {
      normal.set(n.subarray(q * 3, q * 3 + 3), (q * 4 + k) * 3);
      if (color) color[q * 4 + k] = c[q];
    }
    const b = q * 4;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  return { position, normal, color, index };
}
