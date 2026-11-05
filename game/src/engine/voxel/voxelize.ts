import * as THREE from "three";
import { CAMERA_FORWARD } from "../renderer/constants.ts";
import type { VoxelPalette } from "./palette.ts";

// A box of voxels on the grid of `size` meters: voxel (i, j, k) covers [i, i + 1] × [j, j + 1] × [k, k + 1] × size.
// data[x + nx * (y + ny * z)] is the palette index + 1 of the voxel at (min + (x, y, z)), 0 where it is empty.
// normals (optional): the normal of the surface each voxel was made from (encodeNormal); its faces are lit with it.
export type VoxelVolume = {
  size: number;
  min: [number, number, number];
  n: [number, number, number];
  data: Uint32Array;
  normals?: Uint16Array;
};

// A unit normal in 16 bits (octahedral, 8 bits per axis). Equal normals give equal codes, so the voxels of one
// flat face still merge.
export function encodeNormal(x: number, y: number, z: number) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = z / l;
  if (y < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  return (Math.round((u * 0.5 + 0.5) * 255) << 8) | Math.round((v * 0.5 + 0.5) * 255);
}
export function decodeNormal(code: number, out: number[]) {
  const u = ((code >> 8) / 255) * 2 - 1, v = ((code & 255) / 255) * 2 - 1;
  let x = u, z = v;
  const y = 1 - Math.abs(u) - Math.abs(v);
  if (y < 0) {
    x = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
    z = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
  }
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

export function createVolume(size: number, min: [number, number, number], n: [number, number, number]): VoxelVolume {
  return { size, min, n, data: new Uint32Array(n[0] * n[1] * n[2]) };
}

// Meshes to voxelize: a geometry, where it is, and its game material(s) (a texture or a flat color).
export type VoxelSource = { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; material: THREE.Material | THREE.Material[] };

// Every mesh of an object, with its matrix relative to the object (or to the world with world = true).
export function collectMeshes(object: THREE.Object3D, world = false): VoxelSource[] {
  object.updateMatrixWorld(true);
  const toObject = world ? new THREE.Matrix4() : object.matrixWorld.clone().invert();
  const out: VoxelSource[] = [];
  object.traverse((child: any) => {
    if (!child.isMesh || !child.geometry) return;
    out.push({ geometry: child.geometry, matrix: toObject.clone().multiply(child.matrixWorld), material: child.material });
  });
  return out;
}

// --------------------------------------------------------------- colors
type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
const pixelCache = new WeakMap<object, Pixels>();

function readPixels(texture: THREE.Texture): Pixels | null {
  const image: any = texture.image;
  if (!image) return null;
  const cached = pixelCache.get(image);
  if (cached) return cached;
  let pixels: Pixels;
  if (image.data) {
    pixels = { width: image.width, height: image.height, data: image.data };
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    pixels = { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }
  pixelCache.set(image, pixels);
  return pixels;
}

// The sRGB color (0xRRGGBB) a game solid material shows at a UV: its texture (repeated, nearest texel), or its color.
export type ColorAt = (u: number, v: number) => number;
export function materialColor(material: THREE.Material): ColorAt {
  const uniforms = (material as THREE.ShaderMaterial).uniforms ?? {};
  const map = uniforms.uUseMap?.value > 0.5 ? (uniforms.uMap?.value as THREE.Texture | null) : null;
  const pixels = map ? readPixels(map) : null;
  if (!map || !pixels) {
    const color = uniforms.uColor?.value ?? (material as any).color ?? new THREE.Color("#a0a0a0");
    const rgb = (color as THREE.Color).getHex();
    return () => rgb;
  }
  const repeat = (uniforms.uRepeat?.value as THREE.Vector2 | undefined) ?? new THREE.Vector2(1, 1);
  const { width, height, data } = pixels;
  const flip = map.flipY;
  return (u, v) => {
    let s = u * repeat.x;
    let t = v * repeat.y;
    s -= Math.floor(s);
    t -= Math.floor(t);
    const x = Math.min(width - 1, Math.floor(s * width));
    const y = Math.min(height - 1, Math.floor((flip ? 1 - t : t) * height));
    const k = (y * width + x) * 4;
    return (data[k]! << 16) | (data[k + 1]! << 8) | data[k + 2]!;
  };
}

// --------------------------------------------------------------- voxelize
export type VoxelizeOptions = {
  // nothing under the ground (y < 0): the ground hides it
  clipBelowGround?: boolean;
  // fill the inside of closed shapes, so no face is made inside them
  fill?: boolean;
  // each voxel keeps the normal of the surface it was made from (the geometry's normals), for its light
  surfaceNormals?: boolean;
};

// Toward the camera: when several faces fall in one voxel, the one that faces the camera most gives its color
// (a wall front wins over the bottom of the roof above it).
const VIEW = new THREE.Vector3(...CAMERA_FORWARD).negate().normalize();

// The voxels every triangle passes through: each triangle is sampled every half voxel, and each sample takes
// the color of its material at its UV (so the voxels keep the texels of the textures).
export function voxelize(sources: VoxelSource[], size: number, palette: VoxelPalette, options: VoxelizeOptions = {}): VoxelVolume | null {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const source of sources) {
    const pos = source.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(source.matrix));
  }
  if (box.isEmpty()) return null;
  if (options.clipBelowGround) box.min.y = Math.max(0, box.min.y);
  if (box.max.y < box.min.y) return null;
  const min: [number, number, number] = [Math.floor(box.min.x / size) - 1, Math.floor(box.min.y / size) - 1, Math.floor(box.min.z / size) - 1];
  if (options.clipBelowGround) min[1] = Math.max(0, min[1]);
  const n: [number, number, number] = [
    Math.floor(box.max.x / size) + 2 - min[0],
    Math.floor(box.max.y / size) + 2 - min[1],
    Math.floor(box.max.z / size) + 2 - min[2],
  ];
  const volume = createVolume(size, min, n);
  if (options.surfaceNormals) volume.normals = new Uint16Array(volume.data.length);
  const score = new Float32Array(volume.data.length).fill(-9);
  const [nx, ny, nz] = n;

  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const AB = new THREE.Vector3(), AC = new THREE.Vector3(), N = new THREE.Vector3();
  const NA = new THREE.Vector3(), NB = new THREE.Vector3(), NC = new THREE.Vector3(), NP = new THREE.Vector3();
  for (const source of sources) {
    const g = source.geometry;
    const pos = g.getAttribute("position");
    const uv = g.getAttribute("uv");
    const nrm = options.surfaceNormals ? g.getAttribute("normal") : undefined;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(source.matrix);
    const index = g.index;
    const count = index ? index.count : pos.count;
    const materials = Array.isArray(source.material) ? source.material : [source.material];
    const colorAts = materials.map((m) => materialColor(m));
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      const colorAt = colorAts[group.materialIndex ?? 0] ?? colorAts[0]!;
      const end = Math.min(count, group.start + group.count);
      for (let t = group.start; t + 2 < end; t += 3) {
        const ia = index ? index.getX(t) : t, ib = index ? index.getX(t + 1) : t + 1, ic = index ? index.getX(t + 2) : t + 2;
        A.fromBufferAttribute(pos, ia).applyMatrix4(source.matrix);
        B.fromBufferAttribute(pos, ib).applyMatrix4(source.matrix);
        C.fromBufferAttribute(pos, ic).applyMatrix4(source.matrix);
        AB.subVectors(B, A);
        AC.subVectors(C, A);
        N.crossVectors(AB, AC);
        if (N.lengthSq() === 0) continue;
        const facing = N.normalize().dot(VIEW);
        if (nrm) {
          NA.fromBufferAttribute(nrm, ia).applyMatrix3(normalMatrix);
          NB.fromBufferAttribute(nrm, ib).applyMatrix3(normalMatrix);
          NC.fromBufferAttribute(nrm, ic).applyMatrix3(normalMatrix);
        } else if (options.surfaceNormals) {
          NA.copy(N);
          NB.copy(N);
          NC.copy(N);
        }
        const ua = uv ? uv.getX(ia) : 0, va = uv ? uv.getY(ia) : 0;
        const ub = uv ? uv.getX(ib) : 0, vb = uv ? uv.getY(ib) : 0;
        const uc = uv ? uv.getX(ic) : 0, vc = uv ? uv.getY(ic) : 0;
        const longest = Math.max(AB.length(), AC.length(), B.distanceTo(C));
        const steps = Math.max(1, Math.ceil(longest / (size * 0.5)));
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; i + j <= steps; j++) {
            const a = i / steps, b = j / steps;
            const x = A.x + AB.x * a + AC.x * b;
            const y = A.y + AB.y * a + AC.y * b;
            const z = A.z + AB.z * a + AC.z * b;
            if (options.clipBelowGround && y < 0) continue;
            const vx = Math.floor(x / size) - min[0], vy = Math.floor(y / size) - min[1], vz = Math.floor(z / size) - min[2];
            if (vx < 0 || vy < 0 || vz < 0 || vx >= nx || vy >= ny || vz >= nz) continue;
            const k = vx + nx * (vy + ny * vz);
            if (facing <= score[k]!) continue;
            score[k] = facing;
            const rgb = colorAt(ua + (ub - ua) * a + (uc - ua) * b, va + (vb - va) * a + (vc - va) * b);
            volume.data[k] = palette.add(rgb) + 1;
            if (volume.normals) {
              NP.set(0, 0, 0).addScaledVector(NA, 1 - a - b).addScaledVector(NB, a).addScaledVector(NC, b).normalize();
              volume.normals[k] = encodeNormal(NP.x, NP.y, NP.z);
            }
          }
        }
      }
    }
  }
  if (options.fill) fillInside(volume, options.clipBelowGround === true && min[1] === 0);
  return volume;
}

// Fills every empty voxel that cannot be reached from outside the box (6 neighbours). With `floor`, the bottom
// layer of the box is the ground: nothing comes in from under it.
export function fillInside(volume: VoxelVolume, floor: boolean) {
  const [nx, ny, nz] = volume.n;
  const data = volume.data;
  const outside = new Uint8Array(data.length);
  const queue = new Int32Array(data.length);
  let head = 0, tail = 0;
  const seed = (k: number) => {
    if (data[k] || outside[k]) return;
    outside[k] = 1;
    queue[tail++] = k;
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    seed(0 + nx * (y + ny * z));
    seed(nx - 1 + nx * (y + ny * z));
  }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    if (!floor) seed(x + nx * (0 + ny * z));
    seed(x + nx * (ny - 1 + ny * z));
  }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    seed(x + nx * (y + ny * 0));
    seed(x + nx * (y + ny * (nz - 1)));
  }
  const sx = 1, sy = nx, sz = nx * ny;
  while (head < tail) {
    const k = queue[head++]!;
    const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / sz);
    if (x > 0) seed(k - sx);
    if (x < nx - 1) seed(k + sx);
    if (y > 0) seed(k - sy);
    if (y < ny - 1) seed(k + sy);
    if (z > 0) seed(k - sz);
    if (z < nz - 1) seed(k + sz);
  }
  // inside voxels are never seen: they take the color of the last solid voxel of their row
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    let last = 0;
    for (let x = 0; x < nx; x++) {
      const k = x + nx * (y + ny * z);
      if (data[k]) last = data[k]!;
      else if (!outside[k] && last) data[k] = last;
    }
  }
}

// A solid box of voxels of one color: nx × ny × nz voxels from the origin.
export function boxVolume(size: number, nx: number, ny: number, nz: number, colorIndex: number): VoxelVolume {
  const volume = createVolume(size, [0, 0, 0], [nx, ny, nz]);
  volume.data.fill(colorIndex + 1);
  return volume;
}
