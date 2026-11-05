// The mountains, rocks and stones in voxels, in chunks of about 8 m that are made when the camera comes near and
// dropped when it goes away (a 256 m map in small voxels is far too big to keep whole).
// - Mountains: voxel columns. Each column goes up to the low-poly mountain surface above its center (the same
//   triangles as the mesh mountains), rock or snow like the triangle over it. Only the tops and the sides that
//   show are made (hidden faces removed), merged into large quads.
// - Rocks and stones: their low-poly shapes voxelized on the world grid, filled, cut at the ground.
import * as THREE from "three";
import { CAMERA_FORWARD, PIXELS_PER_METER, type PixelRenderer } from "../engine/renderer/index.ts";
import { meshHeightField, meshVolume, QuadBuilder, voxelize } from "../engine/voxel/index.ts";
import type { GameMap, Rock } from "../shared/worldgen.ts";
import { mountainTriangles, rockGeometry } from "./terrain.ts";
import type { Voxels } from "./voxels.ts";

const CHUNK_METERS = 8;

export function createVoxelTerrain(renderer: PixelRenderer, map: GameMap, voxels: Voxels) {
  const s = voxels.size;
  const palette = voxels.palette;
  const CH = Math.max(8, Math.round(CHUNK_METERS / s));
  const chunkM = CH * s;
  const mt = map.config.terrain.mountains;
  const rockIndex = palette.addColor(mt.rockColor);
  const snowIndex = palette.addColor(mt.snowColor);

  // the triangles and the rocks of each chunk
  const { points, snow } = mountainTriangles(map);
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
  for (const [list, detail] of [[map.rocks, 1], [map.stones, 0]] as const) {
    for (const rock of list) {
      const key = `${Math.floor(rock.x / chunkM)},${Math.floor(rock.z / chunkM)}`;
      if (!rocks.has(key)) rocks.set(key, []);
      rocks.get(key)!.push([rock, detail]);
    }
  }

  const buildChunk = (ci: number, cj: number) => {
    const key = `${ci},${cj}`;
    const builder = new QuadBuilder(palette);
    const tris = triangles.get(key);
    if (tris) {
      const i0 = ci * CH, k0 = cj * CH, W = CH + 2;
      const height = new Int32Array(W * W);
      const color = new Uint32Array(W * W);
      for (const t of tris) {
        const o = t * 9;
        const ax = points[o]!, ay = points[o + 1]!, az = points[o + 2]!;
        const bx = points[o + 3]!, by = points[o + 4]!, bz = points[o + 5]!;
        const cx = points[o + 6]!, cy = points[o + 7]!, cz = points[o + 8]!;
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-9) continue;
        const x0 = Math.max(i0 - 1, Math.floor(Math.min(ax, bx, cx) / s)), x1 = Math.min(i0 + CH, Math.floor(Math.max(ax, bx, cx) / s));
        const z0 = Math.max(k0 - 1, Math.floor(Math.min(az, bz, cz) / s)), z1 = Math.min(k0 + CH, Math.floor(Math.max(az, bz, cz) / s));
        let c = snow[t] ? snowIndex : rockIndex;
        if (voxels.surfaceNormals) {
          // the normal of the triangle (counter-clockwise seen from above)
          const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const len = Math.hypot(nx, ny, nz) * (ny < 0 ? -1 : 1);
          c = palette.add(palette.rgbOf(c), nx / len, ny / len, nz / len);
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
            }
          }
        }
      }
      meshHeightField({ size: s, i0, k0, nx: CH, nz: CH, height, color }, builder);
    }
    for (const [rock, detail] of rocks.get(key) ?? []) {
      const material = { uniforms: { uColor: { value: new THREE.Color(rock.color) } } } as unknown as THREE.Material;
      const volume = voxelize([{ geometry: rockGeometry(rock, detail), matrix: new THREE.Matrix4(), material }], s, palette, { clipBelowGround: true, fill: true, surfaceNormals: voxels.surfaceNormals });
      if (volume) meshVolume(volume, palette, { cullGround: true }, builder);
    }
    const geometry = builder.build();
    if (!geometry) return null;
    const mesh = new THREE.Mesh(geometry, voxels.material);
    renderer.castShadows(mesh);
    return mesh;
  };

  const chunks = new Map<string, THREE.Mesh | null>();
  const pitch = Math.asin(-CAMERA_FORWARD[1]);
  // Makes the chunks the view shows (with a margin for what casts shadows into it and for the tall mountains in
  // front of the view), nearest first, for at most `budgetMs` milliseconds; drops the ones far away.
  const update = (cx: number, cz: number, budgetMs = 12) => {
    const container = renderer.canvas.parentElement!;
    const scale = (renderer as any).pixelScale as number;
    const halfW = container.clientWidth / 2 / scale / PIXELS_PER_METER;
    const halfD = container.clientHeight / 2 / scale / PIXELS_PER_METER / Math.sin(pitch);
    const minX = cx - halfW - 18, maxX = cx + halfW + 8, minZ = cz - halfD - 12, maxZ = cz + halfD + 22;
    const want: [number, number, number][] = [];
    const keep = new Set<string>();
    for (let cj = Math.floor(minZ / chunkM); cj <= Math.floor(maxZ / chunkM); cj++) {
      for (let ci = Math.floor(minX / chunkM); ci <= Math.floor(maxX / chunkM); ci++) {
        if (Math.abs((ci + 0.5) * chunkM) > map.half + chunkM || Math.abs((cj + 0.5) * chunkM) > map.half + chunkM) continue;
        const key = `${ci},${cj}`;
        keep.add(key);
        if (!chunks.has(key)) want.push([ci, cj, Math.hypot((ci + 0.5) * chunkM - cx, (cj + 0.5) * chunkM - cz)]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    const start = performance.now();
    for (const [ci, cj] of want) {
      if (performance.now() - start > budgetMs) break;
      const mesh = buildChunk(ci, cj);
      if (mesh) renderer.scene.add(mesh);
      chunks.set(`${ci},${cj}`, mesh);
    }
    // dropped: more than 2 chunks out of the wanted area
    for (const [key, mesh] of chunks) {
      if (keep.has(key)) continue;
      const [ci, cj] = key.split(",").map(Number) as [number, number];
      if ((ci + 3) * chunkM > minX && (ci - 2) * chunkM < maxX && (cj + 3) * chunkM > minZ && (cj - 2) * chunkM < maxZ) continue;
      if (mesh) {
        renderer.scene.remove(mesh);
        mesh.geometry.dispose();
      }
      chunks.delete(key);
    }
    return want.length;
  };
  const stats = () => {
    let quads = 0, meshes = 0;
    for (const mesh of chunks.values()) if (mesh) { meshes++; quads += (mesh.geometry.index?.count ?? 0) / 6; }
    return { chunks: chunks.size, meshes, quads };
  };
  return { update, stats };
}
