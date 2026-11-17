// The cubes kept for later, shared by the voxel workers (lib/voxelWorker.js: their saves in IndexedDB) and the page
// (lib/voxelPool.js: the cubes of a world made beforehand, worlds/baked/<world>.bin). Plain numbers, no Three.js.
//   hashJob: the key of a job: the same job (the same triangles, colours, size and options) has the same key
//   pack, unpack: the cubes of a job, smaller (whole numbers on the grid) and back
//   uvOf: the uv of each corner of a textured mesh: the palette texel of its colour
//   toFile, fromFile: the kept cubes of many jobs (key -> packed meshes) as one file (a Blob: its pieces are not copied
//   into one more big array, the page has little memory left) and back
// A world made beforehand: open it with ?bake; when its loading screen is gone, every job it made or read is sent to
// web/serve.py, which writes worlds/baked/<world>.bin (systems/loading.js). The next loads read that file first: a job
// found in it is answered at once, without a worker. A job not in it (the world, a shape or the outfit changed since)
// is made as before, so an old file is never wrong, only less useful.

import { encodeNormal, decodeNormal } from './voxelCore.js';

// bump it when the cubes made change (lib/voxelCore.js) or how they are kept, so the saved ones are not used any more
export const VERSION = 2;
export const SIDE = 256;        // the palette texture is SIDE x SIDE colours (lib/voxels.js createPalette)

// two 32-bit hashes of everything that makes the result: the triangles, the colours, the size and the options
export function hashJob({ sources, size, opts, colors }) {
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

// a mesh of meshArrays, smaller for the disk: each face is 4 corners on the grid (whole numbers), one normal (16 bits,
// lib/voxelCore.js encodeNormal: the voxels keep their normals in that code, so nothing is lost) and one colour; the
// index is always the same (two triangles a face), so it is not saved. unpack gives back the same numbers
export function pack({ position, normal, color, index }, size) {
  const quads = index.length / 6, grid = position.map((x) => Math.round(x / size));
  const small = grid.every((g) => g >= -32768 && g < 32768);
  const n = new Uint16Array(quads), c = color ? new Uint32Array(quads) : null;
  for (let q = 0; q < quads; q++) {
    n[q] = encodeNormal(normal[q * 12], normal[q * 12 + 1], normal[q * 12 + 2]);
    if (c) c[q] = color[q * 4];
  }
  return { quads, grid: small ? Int16Array.from(grid) : Int32Array.from(grid), normal: n, color: c };
}

export function unpack({ quads, grid, normal: n, color: c }, size) {
  const position = new Float32Array(quads * 12), normal = new Float32Array(quads * 12), color = c ? new Uint32Array(quads * 4) : null;
  const index = quads * 4 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6), nrm = [0, 0, 0];
  for (let i = 0; i < position.length; i++) position[i] = grid[i] * size;
  for (let q = 0; q < quads; q++) {
    decodeNormal(n[q], nrm);
    for (let k = 0; k < 4; k++) {
      normal.set(nrm, (q * 4 + k) * 3);
      if (color) color[q * 4 + k] = c[q];
    }
    const b = q * 4;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  return { position, normal, color, index };
}

// the uv of each corner: the palette texel of its colour (palette: 0xRRGGBB -> palette index)
export function uvOf(color, palette) {
  const uv = new Float32Array(color.length * 2);
  for (let i = 0; i < color.length; i++) {
    const c = palette.get(color[i]) ?? 0;
    uv[i * 2] = ((c % SIDE) + 0.5) / SIDE;
    uv[i * 2 + 1] = (Math.floor(c / SIDE) + 0.5) / SIDE;
  }
  return uv;
}

// ------------------------------------------------------------------ the file
// [4 bytes: length of the head] [the head: JSON { version, jobs: [[key, [mesh or null, ...]], ...] }, each mesh
// { quads, big: grid in 32 bits, color: has colours, at: where its arrays start }] [the arrays, each on 4 bytes]:
// grid (Int16 or Int32, quads * 12), normal (Uint16, quads), color (Uint32, quads)
export function toFile(kept) {
  const jobs = [], parts = [];
  let at = 0;
  const put = (array) => {
    const start = at, pad = Math.ceil(array.byteLength / 4) * 4 - array.byteLength;
    parts.push(array, ...(pad ? [new Uint8Array(pad)] : []));
    at += array.byteLength + pad;
    return start;
  };
  for (const [key, meshes] of kept)
    jobs.push([key, meshes.map((m) => m && { quads: m.quads, big: m.grid instanceof Int32Array, color: !!m.color,
      at: [put(m.grid), put(m.normal), m.color ? put(m.color) : -1] })]);
  const head = new TextEncoder().encode(JSON.stringify({ version: VERSION, jobs }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, head.length, true);
  return new Blob([length, head, new Uint8Array(Math.ceil(head.length / 4) * 4 - head.length), ...parts]);
}

// a file of toFile -> key -> packed meshes (views on the file, nothing copied); empty for another VERSION
export function fromFile(buffer) {
  const length = new DataView(buffer).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
  const kept = new Map();
  if (head.version !== VERSION) return kept;
  const start = 4 + Math.ceil(length / 4) * 4;
  for (const [key, meshes] of head.jobs)
    kept.set(key, meshes.map((m) => m && {
      quads: m.quads,
      grid: new (m.big ? Int32Array : Int16Array)(buffer, start + m.at[0], m.quads * 12),
      normal: new Uint16Array(buffer, start + m.at[1], m.quads),
      color: m.color ? new Uint32Array(buffer, start + m.at[2], m.quads) : null,
    }));
  return kept;
}
