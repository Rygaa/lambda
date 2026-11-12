// A voxel worker (lib/voxelPool.js): it makes cubes away from the page, so the game does not stop. The world (a rock, a
// plant, a piece of cliff: systems/voxels.js) and the bodies (one frame of the human or a monster: lib/voxels.js
// voxelClips) send the same jobs.
//   A texture: { texture: { id, width, height, rgb (0xRRGGBB per texel) }, palette: [[rgb, palette index], ...] }. Sent
//   once to each worker before the jobs that use it.
//   A job: { id, sources: [{ tris, color } or { tris, texture: id }], size, opts, colors: how many meshes (one per
//   colour; a textured body: 1), key: its hash (lib/voxelSaved.js hashJob), keep: send its cubes packed too }. Out:
//   { id, meshes: [arrays of lib/voxelCore.js meshArrays, or null], key, kept: packed (with keep) }, with a uv on the
//   palette texel of each colour for a textured body.
// Each result is saved in IndexedDB under the hash of its job, so the same job later (the same world, outfit and cube
// size, even after a reload) is read back instead of made again. The colours are saved as 0xRRGGBB, not as palette
// places, because the palette is made again in another order at each load. The disk is slow (the human alone is
// hundreds of MB), so a job never waits for it: the worker knows the saved keys, and the writes go on behind.
import { voxelize, meshArrays } from './voxelCore.js';
import { hashJob, pack, unpack, uvOf } from './voxelSaved.js';

const textures = new Map(), palette = new Map();

self.onmessage = async ({ data }) => {
  if (data.texture) {
    textures.set(data.texture.id, data.texture);
    for (const [rgb, i] of data.palette) palette.set(rgb, i);
    return;
  }
  const { id, sources, size, opts, colors } = data, textured = sources.some((s) => s.texture !== undefined);
  const key = data.key ?? hashJob(data);
  let meshes = await load(key, size);
  if (!meshes) {
    meshes = make(sources, size, opts, colors, textured);
    await save(key, meshes, size);
  }
  const kept = data.keep ? meshes.map((m) => m && pack(m, size)) : null;
  if (textured) meshes = meshes.map((m) => m && { ...m, uv: uvOf(m.color, palette), color: null });
  self.postMessage({ id, meshes, key, kept }, [
    ...meshes.flatMap((m) => (m ? [m.position.buffer, m.normal.buffer, m.index.buffer, ...(m.uv ? [m.uv.buffer] : [])] : [])),
    ...(kept ?? []).flatMap((m) => (m ? [m.grid.buffer, m.normal.buffer, ...(m.color ? [m.color.buffer] : [])] : [])),
  ]);
};

function make(sources, size, opts, colors, textured) {
  const volume = voxelize(sources.map((s) => (s.texture === undefined ? s : { ...s, colorAt: colorAt(textures.get(s.texture)) })), size, opts);
  return Array.from({ length: colors }, (_, c) => (volume ? meshArrays(volume, { only: textured ? -1 : c, colors: textured }) : null));
}

// (u, v) -> the 0xRRGGBB of a texture there (repeated, nearest texel, flipY false like lib/bake.js)
const colorAt = ({ width, height, rgb }) => (u, v) =>
  rgb[Math.min(height - 1, Math.floor((v - Math.floor(v)) * height)) * width + Math.min(width - 1, Math.floor((u - Math.floor(u)) * width))];



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


