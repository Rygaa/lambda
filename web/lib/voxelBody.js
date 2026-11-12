// A body made of cubes once (the human, lib/character.js, or a monster model, lib/monsters.js): its first idle frame is
// made of cubes, and each cube of its outside keeps the place on the triangle it comes from (the triangle, and where on
// it). In every other frame, each cube follows that place on the posed triangle, so the cubes move with the body: one
// conversion instead of one per frame (the human has 907), and no frames of cubes in memory. The cubes are drawn as
// instances of one cube (an InstancedMesh, so the shadow pass draws them too), axis-aligned in the units of the body.
// With `snap`, each cube goes to the nearest cell of the grid of the body, so each frame looks made of cubes again.
import * as THREE from 'three';
import { getResource } from '../ecs/world.js';
import { Gpu, Voxels } from '../resources.js';
import { paletteAdd } from './voxels.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';

// (u, v) -> 0xRRGGBB of a texture (repeated, nearest texel, flipY false like lib/bake.js), read once per texture
const readers = new WeakMap();
function colorsOf(texture) {
  if (readers.has(texture)) return readers.get(texture);
  const img = texture.image, cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const { width, height, data } = cx.getImageData(0, 0, cv.width, cv.height);
  const at = (u, v) => {
    const k = Math.min(height - 1, Math.floor((v - Math.floor(v)) * height)) * width + Math.min(width - 1, Math.floor((u - Math.floor(u)) * width));
    return (data[k * 4] << 16) | (data[k * 4 + 1] << 8) | data[k * 4 + 2];
  };
  readers.set(texture, at);
  return at;
}

// after each SLICE ms of work the page draws a frame, so the game does not stop while a body gets its cubes (the
// human at half a pixel: about 150 ms)
const SLICE = 8;
function breather() {
  let since = performance.now();
  return async () => {
    if (performance.now() - since < SLICE) return;
    await new Promise((r) => setTimeout(r));
    since = performance.now();
  };
}

// the outside cubes of one frame (one geometry per part), with where each comes from. size: the cube edge, in the
// units of the body. -> { count, part, tri (3 vertex indices a cube), bary (2), local (3: the centre from its place,
// along the triangle edge, across it, along its normal), rgb }
async function shellOf(parts, frame, size) {
  const breathe = breather();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const g of frame) {
    const p = g.getAttribute('position').array;
    for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[i + a]); hi[a] = Math.max(hi[a], p[i + a]); }
  }
  const min = lo.map((v) => Math.floor(v / size) - 1), n = hi.map((v, a) => Math.floor(v / size) + 2 - min[a]);
  const [nx, ny, nz] = n, cells = nx * ny * nz;
  const score = new Float32Array(cells).fill(-9), src = new Int32Array(cells).fill(-1);
  const triOf = new Int32Array(cells), ba = new Float32Array(cells), bb = new Float32Array(cells);
  for (const [m, g] of frame.entries()) {
    const p = g.getAttribute('position').array, index = g.index.array;
    for (let t = 0; t < index.length; t += 3) {
      if (t % 300 === 0) await breathe();
      const i0 = index[t] * 3, i1 = index[t + 1] * 3, i2 = index[t + 2] * 3;
      const ax = p[i0], ay = p[i0 + 1], az = p[i0 + 2];
      const abx = p[i1] - ax, aby = p[i1 + 1] - ay, abz = p[i1 + 2] - az;
      const acx = p[i2] - ax, acy = p[i2 + 1] - ay, acz = p[i2 + 2] - az;
      let Nx = aby * acz - abz * acy, Ny = abz * acx - abx * acz, Nz = abx * acy - aby * acx;
      const nl = Math.hypot(Nx, Ny, Nz);
      if (nl === 0) continue;
      Nx /= nl; Ny /= nl; Nz /= nl;
      const axn = Math.abs(Nx), ayn = Math.abs(Ny), azn = Math.abs(Nz);
      const thin = size * Math.max(axn, ayn, azn) + 1e-6;
      const sx = axn >= ayn && axn >= azn ? Math.sign(Nx) : 0, sy = !sx && ayn >= azn ? Math.sign(Ny) : 0, sz = !sx && !sy ? Math.sign(Nz) : 0;
      const longest = Math.max(Math.hypot(abx, aby, abz), Math.hypot(acx, acy, acz), Math.hypot(acx - abx, acy - aby, acz - abz));
      const steps = Math.max(1, Math.ceil(longest / (size * 0.5)));
      for (let i = 0; i <= steps; i++) for (let j = 0; i + j <= steps; j++) {
        const a = i / steps, b = j / steps;
        const x = ax + abx * a + acx * b, y = ay + aby * a + acy * b, z = az + abz * a + acz * b;
        const bx = Math.floor(x / size) - min[0], by = Math.floor(y / size) - min[1], bz = Math.floor(z / size) - min[2];
        for (let c = 0; c < 2; c++) {
          const vx = bx - (c ? sx : 0), vy = by - (c ? sy : 0), vz = bz - (c ? sz : 0);
          if (vx < 0 || vy < 0 || vz < 0 || vx >= nx || vy >= ny || vz >= nz) continue;
          const cx = (vx + min[0] + 0.5) * size, cy = (vy + min[1] + 0.5) * size, cz = (vz + min[2] + 0.5) * size;
          const depth = (cx - ax) * Nx + (cy - ay) * Ny + (cz - az) * Nz;
          if (depth > 1e-6 || depth < -thin) continue;
          const k = vx + nx * (vy + ny * vz);
          // the outer face wins (it turns, so no side faces the camera), then the sample nearest to the centre
          const rank = -(0.5 * depth) / size - (0.2 * Math.hypot(x - cx, y - cy, z - cz)) / size;
          if (rank <= score[k]) continue;
          score[k] = rank; src[k] = m; triOf[k] = t; ba[k] = a; bb[k] = b;
        }
      }
    }
  }
  await breathe();
  // the outside: the empty cells reached from the border of the box; a cube is kept if it touches one
  const outside = new Uint8Array(cells), queue = new Int32Array(cells);
  let head = 0, tail = 0;
  const seed = (k) => { if (src[k] < 0 && !outside[k]) { outside[k] = 1; queue[tail++] = k; } };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { seed(nx * (y + ny * z)); seed(nx - 1 + nx * (y + ny * z)); }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { seed(x + nx * ny * z); seed(x + nx * (ny - 1 + ny * z)); }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { seed(x + nx * y); seed(x + nx * (y + ny * (nz - 1))); }
  const sxy = nx * ny;
  while (head < tail) {
    if (head % 65536 === 0) await breathe();
    const k = queue[head++], x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / sxy);
    if (x > 0) seed(k - 1); if (x < nx - 1) seed(k + 1);
    if (y > 0) seed(k - nx); if (y < ny - 1) seed(k + nx);
    if (z > 0) seed(k - sxy); if (z < nz - 1) seed(k + sxy);
  }
  const kept = [];
  for (let k = 0; k < cells; k++) {
    if (k % 65536 === 0) await breathe();
    if (src[k] < 0) continue;
    const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / sxy);
    if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1 ||
      outside[k - 1] || outside[k + 1] || outside[k - nx] || outside[k + nx] || outside[k - sxy] || outside[k + sxy]) kept.push(k);
  }
  const count = kept.length, part = new Uint8Array(count), tri = new Uint32Array(count * 3), bary = new Float32Array(count * 2);
  const local = new Float32Array(count * 3), rgb = new Uint32Array(count);
  const colors = parts.map((pt) => colorsOf(pt.texture)), P = [0, 0, 0], E = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [q, k] of kept.entries()) {
    if (q % 4096 === 0) await breathe();
    const m = src[k], g = frame[m], index = g.index.array, t = triOf[k];
    part[q] = m;
    tri.set([index[t], index[t + 1], index[t + 2]], q * 3);
    bary[q * 2] = ba[k]; bary[q * 2 + 1] = bb[k];
    placeOn(g.getAttribute('position').array, index[t], index[t + 1], index[t + 2], ba[k], bb[k], P, E);
    const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / sxy);
    const d = [(x + min[0] + 0.5) * size - P[0], (y + min[1] + 0.5) * size - P[1], (z + min[2] + 0.5) * size - P[2]];
    for (let e = 0; e < 3; e++) local[q * 3 + e] = d[0] * E[e][0] + d[1] * E[e][1] + d[2] * E[e][2];
    const uv = g.getAttribute('uv'), w = 1 - ba[k] - bb[k];
    const u = uv.getX(index[t]) * w + uv.getX(index[t + 1]) * ba[k] + uv.getX(index[t + 2]) * bb[k];
    const v = uv.getY(index[t]) * w + uv.getY(index[t + 1]) * ba[k] + uv.getY(index[t + 2]) * bb[k];
    rgb[q] = colors[m](u, v);
  }
  return { count, part, tri, bary, local, rgb };
}

// the place (a, b) on a triangle of positions p (vertex indices i, j, k) -> P, and its frame E: along its first edge,
// across it, its normal
function placeOn(p, i, j, k, a, b, P, E) {
  i *= 3; j *= 3; k *= 3;
  const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
  const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
  P[0] = p[i] + ux * a + vx * b; P[1] = p[i + 1] + uy * a + vy * b; P[2] = p[i + 2] + uz * a + vz * b;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  E[0][0] = ux / ul; E[0][1] = uy / ul; E[0][2] = uz / ul;
  E[2][0] = nx; E[2][1] = ny; E[2][2] = nz;
  E[1][0] = ny * E[0][2] - nz * E[0][1]; E[1][1] = nz * E[0][0] - nx * E[0][2]; E[1][2] = nx * E[0][1] - ny * E[0][0];
}

const CUBE = new THREE.BoxGeometry(1, 1, 1);

// for the try: ?bodies=frames (the cubes of every frame, as before), free (the cubes follow the body, off the grid),
// snap (the default: on the grid)
export const BODIES = new URLSearchParams(location.search).get('bodies') ?? 'snap';
// the places are taken DENSE times closer than the cubes, so where the body stretches (a skirt that walks) no hole opens
// between them; on the grid, the cubes that fall in one cell are drawn on top of each other
const DENSE = Number(new URLSearchParams(location.search).get('dense') ?? 2);

// the cubes of a body: made once from the first idle frame of `clips` (lib/bake.js bakeClips). -> a promise of
// { mesh(): a new mesh of them for one body (lib/bake.js showFrame shows a frame on it), count }. size: the cube edge
// in the units of the body; normals: each cube lit like the surface it comes from (else each face by its own normal);
// snap: on the grid
export async function voxelBody(world, body, clips, size, normals, snap = true) {
  const shell = await shellOf(body.parts, clips.idle[0], size / DENSE), v = getResource(world, Voxels), gpu = getResource(world, Gpu);
  const SIDE = 256, uv = new Float32Array(shell.count * 2);
  for (let q = 0; q < shell.count; q++) {
    const i = paletteAdd(v.palette, shell.rgb[q]);
    uv[q * 2] = ((i % SIDE) + 0.5) / SIDE; uv[q * 2 + 1] = (Math.floor(i / SIDE) + 0.5) / SIDE;
  }
  const iUv = new THREE.InstancedBufferAttribute(uv, 2);
  function mesh() {
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal']) geometry.setAttribute(name, CUBE.getAttribute(name));
    geometry.setIndex(CUBE.index);
    geometry.setAttribute('iUv', iUv);
    const iNrm = new THREE.InstancedBufferAttribute(new Float32Array(shell.count * 3), 3);
    iNrm.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iNrm', iNrm);
    const material = shaderMaterial(gpu.shared, S.FINE_VERT, S.FINE_FRAG,
      { uMap: { value: v.palette.texture }, uFade: { value: 1 }, uFaces: { value: normals ? 0 : 1 }, ...gpu.fine.uniforms });
    const out = new THREE.InstancedMesh(geometry, material, shell.count);
    out.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const M = out.instanceMatrix.array;
    for (let q = 0; q < shell.count; q++) { M[q * 16] = M[q * 16 + 5] = M[q * 16 + 10] = size; M[q * 16 + 15] = 1; }
    out.frustumCulled = false;
    out.layers.set(2);
    out.layers.enable(3);
    let shown = null;
    const P = [0, 0, 0], E = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], N = iNrm.array;
    out.userData.showFrame = (frame) => {
      if (frame === shown) return;
      shown = frame;
      const pos = frame.map((g) => g.getAttribute('position').array), nrm = frame.map((g) => g.getAttribute('normal').array);
      const { part, tri, bary, local } = shell;
      for (let q = 0; q < shell.count; q++) {
        const m = part[q], i = tri[q * 3], j = tri[q * 3 + 1], k = tri[q * 3 + 2], a = bary[q * 2], b = bary[q * 2 + 1];
        placeOn(pos[m], i, j, k, a, b, P, E);
        const lx = local[q * 3], ly = local[q * 3 + 1], lz = local[q * 3 + 2];
        let x = P[0] + lx * E[0][0] + ly * E[1][0] + lz * E[2][0];
        let y = P[1] + lx * E[0][1] + ly * E[1][1] + lz * E[2][1];
        let z = P[2] + lx * E[0][2] + ly * E[1][2] + lz * E[2][2];
        if (snap) { x = (Math.floor(x / size) + 0.5) * size; y = (Math.floor(y / size) + 0.5) * size; z = (Math.floor(z / size) + 0.5) * size; }
        M[q * 16 + 12] = x; M[q * 16 + 13] = y; M[q * 16 + 14] = z;
        const w = 1 - a - b, n = nrm[m];
        N[q * 3] = n[i * 3] * w + n[j * 3] * a + n[k * 3] * b;
        N[q * 3 + 1] = n[i * 3 + 1] * w + n[j * 3 + 1] * a + n[k * 3 + 1] * b;
        N[q * 3 + 2] = n[i * 3 + 2] * w + n[j * 3 + 2] * a + n[k * 3 + 2] * b;
      }
      out.instanceMatrix.needsUpdate = true;
      iNrm.needsUpdate = true;
    };
    out.userData.showFrame(clips.idle[0]);
    return out;
  }
  return { mesh, count: shell.count };
}
