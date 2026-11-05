// One chunk of the voxel terrain: its mountain columns and its rocks and stones, meshed (hidden faces removed,
// faces merged). No DOM and no GameMap here: it runs in the voxel workers (voxelWorker.ts), or in the page when
// workers are not available. The colors come back as sRGB per vertex; the page puts them in its palette.
import * as THREE from "three";
import { encodeNormal, meshHeightField, meshVolume, QuadBuilder, VoxelPalette, voxelize, type VoxelVolume } from "../engine/voxel/index.ts";
import type { Rock } from "../shared/worldgen.ts";
import { rockGeometry } from "./terrainShapes.ts";

export type ChunkSetup = {
  // meters per voxel, voxels per chunk side
  size: number;
  cells: number;
  // the mountain triangles (9 numbers each) and 1 where a triangle is snow
  points: Float32Array;
  snow: Uint8Array;
  rockColor: string;
  snowColor: string;
  // rocks (detail 1) and stones (detail 0)
  rocks: [Rock, number][];
  surfaceNormals: boolean;
  // the seeds of the rocks and stones that are gone
  removed: number[];
  // the tunnels already cut, each with the seed of its rock
  cuts: [number, HoleCut][];
};

// A tunnel: a line at height y through (x, z) with the direction (dx, dz), of this radius.
export type HoleCut = { x: number; z: number; dx: number; dz: number; y: number; radius: number };

export type ChunkData = { positions: Float32Array; normals: Float32Array; rgb: Uint32Array; index: Uint32Array };
// The pieces of one shape, cubes of `size` meters: the center of each (3 numbers) and its sRGB color.
export type VoxelList = { size: number; centers: Float32Array; rgb: Uint32Array };

// how many pieces a rock gives at most (about) when it explodes, and a tunnel when it is cut
const MAX_PIECES = 5000;
const MAX_HOLE_PIECES = 400;

// Calls `visit` with the place of each voxel of a volume, and how far it is from the middle line of a tunnel: side
// and up, in meters.
function eachVoxelAround(volume: VoxelVolume, cut: HoleCut, visit: (q: number, side: number, up: number) => void) {
  const [nx, ny, nz] = volume.n;
  const s = volume.size;
  for (let z = 0, q = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++, q++) {
        if (!volume.data[q]) continue;
        const ox = (volume.min[0] + x + 0.5) * s - cut.x, oz = (volume.min[2] + z + 0.5) * s - cut.z;
        visit(q, ox * cut.dz - oz * cut.dx, (volume.min[1] + y + 0.5) * s - cut.y);
      }
    }
  }
}

// Takes the voxels of a tunnel out of a volume. The voxels of its wall were inside the rock, with no surface: they
// are lit as if they look at the middle of the tunnel.
function carve(volume: VoxelVolume, cut: HoleCut) {
  const wall = cut.radius + volume.size * 1.5;
  eachVoxelAround(volume, cut, (q, side, up) => {
    const d = Math.hypot(side, up);
    if (d <= cut.radius) volume.data[q] = 0;
    else if (d <= wall && volume.normals) volume.normals[q] = encodeNormal((-side * cut.dz) / d, -up / d, (side * cut.dx) / d);
  });
}

export function createChunkBuilder(setup: ChunkSetup) {
  const { size: s, cells: CH, points, snow, surfaceNormals } = setup;
  const chunkM = CH * s;
  const palette = new VoxelPalette();
  const rockIndex = palette.addColor(setup.rockColor);
  const snowIndex = palette.addColor(setup.snowColor);

  // the triangles and the rocks of each chunk
  const triangles = new Map<string, number[]>();
  for (let t = 0; t < snow.length; t++) {
    const o = t * 9;
    const minX = Math.min(points[o]!, points[o + 3]!, points[o + 6]!) - s, maxX = Math.max(points[o]!, points[o + 3]!, points[o + 6]!) + s;
    const minZ = Math.min(points[o + 2]!, points[o + 5]!, points[o + 8]!) - s, maxZ = Math.max(points[o + 2]!, points[o + 5]!, points[o + 8]!) + s;
    for (let cj = Math.floor(minZ / chunkM); cj <= Math.floor(maxZ / chunkM); cj++) {
      for (let ci = Math.floor(minX / chunkM); ci <= Math.floor(maxX / chunkM); ci++) {
        const key = `${ci},${cj}`;
        if (!triangles.has(key)) triangles.set(key, []);
        triangles.get(key)!.push(t);
      }
    }
  }
  const rocks = new Map<string, [Rock, number][]>();
  for (const [rock, detail] of setup.rocks) {
    const key = `${Math.floor(rock.x / chunkM)},${Math.floor(rock.z / chunkM)}`;
    if (!rocks.has(key)) rocks.set(key, []);
    rocks.get(key)!.push([rock, detail]);
  }

  // the seeds of the rocks and stones that are gone: their chunks are made without them
  const removed = new Set(setup.removed);
  const remove = (seed: number) => removed.add(seed);
  const cuts = new Map<number, HoleCut[]>();
  const addCut = (seed: number, cut: HoleCut) => {
    if (!cuts.has(seed)) cuts.set(seed, []);
    cuts.get(seed)!.push(cut);
  };
  for (const [seed, cut] of setup.cuts) addCut(seed, cut);

  // a rock or stone voxelized on the world grid, filled, cut at the ground
  const rockVolume = (rock: Rock, detail: number) => {
    const material = { uniforms: { uColor: { value: new THREE.Color(rock.color) } } } as unknown as THREE.Material;
    const volume = voxelize([{ geometry: rockGeometry(rock, detail), matrix: new THREE.Matrix4(), material }], s, palette, { clipBelowGround: true, fill: true, surfaceNormals });
    if (volume) for (const cut of cuts.get(rock.seed) ?? []) carve(volume, cut);
    return volume;
  };

  // The voxels a new tunnel takes out of a rock (not all of them for a big one), to throw them out.
  const holePieces = (rock: Rock, detail: number, cut: HoleCut): VoxelList => {
    const volume = rockVolume(rock, detail);
    const inside: number[] = [];
    if (volume) eachVoxelAround(volume, cut, (q, side, up) => {
      if (Math.hypot(side, up) <= cut.radius) inside.push(q);
    });
    const stride = Math.ceil(inside.length / MAX_HOLE_PIECES);
    const count = stride ? Math.ceil(inside.length / stride) : 0;
    const centers = new Float32Array(count * 3);
    const rgb = new Uint32Array(count);
    if (volume) {
      const [nx, ny] = volume.n;
      for (let i = 0; i < count; i++) {
        const q = inside[i * stride]!;
        const x = q % nx, y = Math.floor(q / nx) % ny, z = Math.floor(q / nx / ny);
        centers.set([(volume.min[0] + x + 0.5) * s, (volume.min[1] + y + 0.5) * s, (volume.min[2] + z + 0.5) * s], i * 3);
        rgb[i] = palette.rgbOf(volume.data[q]! - 1);
      }
    }
    return { size: s, centers, rgb };
  };

  // The pieces of a rock or stone. A stone gives its own voxels, one by one. A big rock has hundreds of thousands,
  // so its voxels are grouped in blocks of the same grid, with at most about MAX_PIECES pieces.
  const rockPieces = (rock: Rock, detail: number): VoxelList => {
    const volume = rockVolume(rock, detail);
    if (!volume) return { size: s, centers: new Float32Array(0), rgb: new Uint32Array(0) };
    const [nx, ny, nz] = volume.n;
    let filled = 0;
    for (const voxel of volume.data) if (voxel) filled++;
    const step = Math.max(1, Math.ceil(Math.cbrt(filled / MAX_PIECES)));
    // each block takes the color of the first voxel found in it
    const side = Math.ceil(Math.max(nx, ny, nz) / step) + 1;
    const blocks = new Map<number, number>();
    for (let z = 0, q = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++, q++) {
          const voxel = volume.data[q]!;
          if (!voxel) continue;
          const block = Math.floor(x / step) + side * (Math.floor(y / step) + side * Math.floor(z / step));
          if (!blocks.has(block)) blocks.set(block, voxel);
        }
      }
    }
    const centers = new Float32Array(blocks.size * 3);
    const rgb = new Uint32Array(blocks.size);
    let i = 0;
    for (const [block, voxel] of blocks) {
      const bx = block % side, by = Math.floor(block / side) % side, bz = Math.floor(block / side / side);
      centers[i * 3] = (volume.min[0] + (bx + 0.5) * step) * s;
      centers[i * 3 + 1] = (volume.min[1] + (by + 0.5) * step) * s;
      centers[i * 3 + 2] = (volume.min[2] + (bz + 0.5) * step) * s;
      rgb[i++] = palette.rgbOf(voxel - 1);
    }
    return { size: step * s, centers, rgb };
  };

  // true when the chunk has nothing to draw (most of the map: no mountain, no rock)
  const isEmpty = (ci: number, cj: number) => !triangles.has(`${ci},${cj}`) && !rocks.has(`${ci},${cj}`);

  const build = (ci: number, cj: number): ChunkData | null => {
    const key = `${ci},${cj}`;
    const builder = new QuadBuilder(palette);
    const tris = triangles.get(key);
    if (tris) {
      // mountains: each column goes up to the triangle above its center
      const i0 = ci * CH, k0 = cj * CH, W = CH + 2;
      const height = new Int32Array(W * W);
      const color = new Uint32Array(W * W);
      const normal = surfaceNormals ? new Uint16Array(W * W) : undefined;
      for (const t of tris) {
        const o = t * 9;
        const ax = points[o]!, ay = points[o + 1]!, az = points[o + 2]!;
        const bx = points[o + 3]!, by = points[o + 4]!, bz = points[o + 5]!;
        const cx = points[o + 6]!, cy = points[o + 7]!, cz = points[o + 8]!;
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-9) continue;
        const x0 = Math.max(i0 - 1, Math.floor(Math.min(ax, bx, cx) / s)), x1 = Math.min(i0 + CH, Math.floor(Math.max(ax, bx, cx) / s));
        const z0 = Math.max(k0 - 1, Math.floor(Math.min(az, bz, cz) / s)), z1 = Math.min(k0 + CH, Math.floor(Math.max(az, bz, cz) / s));
        const c = snow[t] ? snowIndex : rockIndex;
        let code = 0;
        if (normal) {
          // the normal of the triangle, facing up
          const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const sign = ny < 0 ? -1 : 1;
          code = encodeNormal(nx * sign, ny * sign, nz * sign);
        }
        for (let k = z0; k <= z1; k++) {
          const pz = (k + 0.5) * s;
          for (let i = x0; i <= x1; i++) {
            const px = (i + 0.5) * s;
            const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
            const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
            const h = Math.round((l1 * ay + l2 * by + l3 * cy) / s);
            const q = i - i0 + 1 + W * (k - k0 + 1);
            if (h > height[q]!) {
              height[q] = h;
              color[q] = c;
              if (normal) normal[q] = code;
            }
          }
        }
      }
      meshHeightField({ size: s, i0, k0, nx: CH, nz: CH, height, color, normal }, builder);
    }
    for (const [rock, detail] of rocks.get(key) ?? []) {
      if (removed.has(rock.seed)) continue;
      const volume = rockVolume(rock, detail);
      if (volume) meshVolume(volume, palette, { cullGround: true }, builder);
    }
    const geometry = builder.build();
    if (!geometry) return null;
    const uv = geometry.getAttribute("uv");
    const rgb = new Uint32Array(uv.count);
    for (let i = 0; i < uv.count; i++) rgb[i] = palette.rgbOf(palette.indexAt(uv.getX(i), uv.getY(i)));
    return {
      positions: geometry.getAttribute("position").array as Float32Array,
      normals: geometry.getAttribute("normal").array as Float32Array,
      rgb,
      index: Uint32Array.from(geometry.index!.array as ArrayLike<number>),
    };
  };
  return { build, isEmpty, remove, addCut, rockPieces, holePieces, chunkMeters: chunkM };
}
