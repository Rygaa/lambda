// A voxel worker (lib/voxelPool.js): it makes cubes away from the page, so the game does not stop. The world (a rock, a
// plant, a piece of cliff: systems/voxels.js) and the bodies (one frame of the human or a monster: lib/voxels.js
// voxelClips) send the same jobs.
//   A texture: { texture: { id, width, height, rgb (0xRRGGBB per texel) }, palette: [[rgb, palette index], ...] }. Sent
//   once to each worker before the jobs that use it.
//   A job: { id, sources: [{ tris, color } or { tris, texture: id }], size, opts, colors: how many meshes (one per
//   colour; a textured body: 1), key: its hash (lib/voxelSaved.js hashJob, only to keep it), keep: send its cubes packed too }. Out:
//   { id, meshes: [arrays of lib/voxelCore.js meshArrays, or null], key, kept: packed (with keep) }, with a uv on the
//   palette texel of each colour for a textured body.
// Nothing is saved on the disk: making the cubes again is fast enough (lib/voxelCore.js), and the saves took GBs.
import { voxelize, meshArrays } from './voxelCore.js';
import { pack, uvOf } from './voxelSaved.js';

const textures = new Map(), palette = new Map();

self.onmessage = ({ data }) => {
  if (data.texture) {
    textures.set(data.texture.id, data.texture);
    for (const [rgb, i] of data.palette) palette.set(rgb, i);
    return;
  }
  const { id, sources, size, opts, colors } = data, textured = sources.some((s) => s.texture !== undefined);
  const key = data.key;
  let meshes = make(sources, size, opts, colors, textured);
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
