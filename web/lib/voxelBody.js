// A body made of cubes once (the human, lib/character.js, or a monster model, lib/monsters.js): its first idle frame is
// made of cubes, and each cube of its outside keeps the place on the triangle it comes from (the triangle, and where on
// it). In every other frame, each cube follows that place on the posed triangle, so the cubes move with the body: one
// conversion instead of one per frame (the human has 907), and no frames of cubes in memory. The cubes are drawn as
// instances of one cube (an InstancedMesh, so the shadow pass draws them too), axis-aligned in the units of the body.
// With `snap`, each cube goes to the nearest cell of the grid of the body, so each frame looks made of cubes again.
// The cubes are made in a worker (lib/shell.js, lib/shellWorker.js), which keeps the cubes of each part: a new
// outfit makes again only the parts that changed (about 50 ms instead of 300), and the game does not wait meanwhile.
import * as THREE from 'three';
import { getResource } from '../ecs/world.js';
import { Gpu, Voxels } from '../resources.js';
import { paletteAdd } from './voxels.js';
import { placeOn } from './shell.js';
import { OWN } from './bake.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';

// the RGBA texels of a texture, read once, and its id in the shell worker (sent to it once)
const texels = new WeakMap();
let nextTexture = 0;
function texelsOf(texture) {
  if (texels.has(texture)) return texels.get(texture);
  const img = texture.image, cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const { width, height, data } = cx.getImageData(0, 0, cv.width, cv.height), id = nextTexture++;
  shellWorker().postMessage({ texture: { id, width, height, data } });
  texels.set(texture, id);
  return id;
}

// the uvs of a part as BufferAttribute getX and getY give them (2 a vertex), read once
const uvs = new WeakMap();
function uvsOf(attribute) {
  if (!uvs.has(attribute)) {
    const a = new Float64Array(attribute.count * 2);
    for (let i = 0; i < attribute.count; i++) { a[i * 2] = attribute.getX(i); a[i * 2 + 1] = attribute.getY(i); }
    uvs.set(attribute, a);
  }
  return uvs.get(attribute);
}

// the worker that makes the cubes of bodies (lib/shellWorker.js), one for all of them, made when first needed; its jobs
// wait their turn
let worker = null;
const waiting = new Map();
let nextJob = 0;
function shellWorker() {
  if (!worker) {
    worker = new Worker(new URL('./shellWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { waiting.get(data.id)(data.shell); waiting.delete(data.id); };
  }
  return worker;
}

// the outside cubes of one frame (one geometry per part), made by the worker (lib/shell.js shellOf): a promise of
// { count, part, tri, bary, local, rgb }. The game goes on meanwhile
function shellOf(parts, frame, size, all = false) {
  const message = {
    parts: parts.map((p) => ({ cut: !!p.cut, tex: texelsOf(p.texture) })),
    frame: frame.map((g) => ({ p: g.getAttribute('position').array.slice(), index: g.index.array.slice(), uv: uvsOf(g.getAttribute('uv')).slice() })),
    size, all,
  };
  const id = nextJob++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    shellWorker().postMessage({ ...message, id }, message.frame.flatMap((f) => [f.p.buffer, f.index.buffer, f.uv.buffer]));
  });
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
// snap: on the grid; all: every cube, not only those of the outside (shellOf)
export async function voxelBody(world, body, clips, size, normals, snap = true, all = false) {
  const shell = await shellOf(body.parts, clips.idle[0], size / DENSE, all), v = getResource(world, Voxels), gpu = getResource(world, Gpu);
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
      { uMap: { value: v.palette.texture }, uFade: { value: 1 }, uFaces: { value: normals ? 0 : 1 }, ...OWN(), ...gpu.fine.uniforms });
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
