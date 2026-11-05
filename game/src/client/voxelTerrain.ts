// The mountains, rocks and stones in voxels, in chunks (voxels.json: chunkMeters) that are made when the camera
// comes near and dropped when it goes away (a 256 m map in small voxels is far too big to keep whole).
// - Mountains: voxel columns. Each column goes up to the low-poly mountain surface above its center (the same
//   triangles as the mesh mountains), rock or snow like the triangle over it. Only the tops and the sides that
//   show are made (hidden faces removed), merged into large quads.
// - Rocks and stones: their low-poly shapes voxelized on the world grid, filled, cut at the ground.
// The chunks are made in workers (voxelWorker.ts), nearest first; in the page if workers are not available.
import * as THREE from "three";
import { CAMERA_FORWARD, PIXELS_PER_METER, type PixelRenderer } from "../engine/renderer/index.ts";
import type { GameMap } from "../shared/worldgen.ts";
import { createChunkBuilder, type ChunkData, type ChunkSetup } from "./terrainChunk.ts";
import { mountainTriangles } from "./terrainShapes.ts";
import type { Voxels } from "./voxels.ts";

const WORKER_URL = "dist/voxel-worker.js";

export function createVoxelTerrain(renderer: PixelRenderer, map: GameMap, voxels: Voxels) {
  const s = voxels.size;
  const cells = Math.max(8, Math.round(map.config.voxels.chunkMeters / s));
  const mt = map.config.terrain.mountains;
  const { points, snow } = mountainTriangles(map);
  const setup: ChunkSetup = {
    size: s, cells, points, snow, rockColor: mt.rockColor, snowColor: mt.snowColor, surfaceNormals: voxels.surfaceNormals,
    rocks: [...map.rocks.map((r) => [r, 1] as [typeof r, number]), ...map.stones.map((r) => [r, 0] as [typeof r, number])],
  };
  // the page keeps a builder too: to know the empty chunks at once, and to build when there is no worker
  const local = createChunkBuilder(setup);
  const chunkM = local.chunkMeters;

  // workers: one or two, each with one chunk at a time
  const workers: { worker: Worker; busy: boolean }[] = [];
  const count = Math.max(1, Math.min(2, (navigator.hardwareConcurrency ?? 2) - 1));
  try {
    for (let w = 0; w < count; w++) {
      const worker = new Worker(WORKER_URL, { type: "module" });
      worker.postMessage({ setup });
      const slot = { worker, busy: false };
      worker.onmessage = (event) => {
        slot.busy = false;
        const { id, data, ms } = event.data as { id: number; data: ChunkData | null; ms: number };
        finish(id, data, ms);
      };
      worker.onerror = () => {
        // a worker that fails is dropped; its chunk is asked again
        workers.splice(workers.indexOf(slot), 1);
        worker.terminate();
        for (const [key, job] of pending) if (job.slot === slot) pending.delete(key);
      };
      workers.push(slot);
    }
  } catch {
    workers.length = 0;
  }

  // a chunk is null (nothing to draw), a mesh, or being made
  const chunks = new Map<string, THREE.Mesh | null>();
  const pending = new Map<string, { id: number; slot: (typeof workers)[number] | null }>();
  const byId = new Map<number, string>();
  let nextId = 1;
  let buildMs = 0, built = 0;

  const toMesh = (data: ChunkData) => {
    const uv = new Float32Array(data.rgb.length * 2);
    const palette = voxels.palette;
    let last = -1, index = 0;
    for (let i = 0; i < data.rgb.length; i++) {
      if (data.rgb[i] !== last) {
        last = data.rgb[i]!;
        index = palette.add(last);
      }
      uv[i * 2] = palette.u(index);
      uv[i * 2 + 1] = palette.v(index);
    }
    palette.flush();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, voxels.material);
    renderer.castShadows(mesh);
    return mesh;
  };

  const finish = (id: number, data: ChunkData | null, ms: number) => {
    const key = byId.get(id);
    byId.delete(id);
    if (!key || pending.get(key)?.id !== id) return;
    pending.delete(key);
    buildMs += ms;
    built++;
    const mesh = data ? toMesh(data) : null;
    if (mesh) renderer.scene.add(mesh);
    chunks.set(key, mesh);
  };

  const pitch = Math.asin(-CAMERA_FORWARD[1]);
  // Asks for the chunks the view shows (with a margin for what casts shadows into it and for the tall mountains in
  // front of the view), nearest first; drops the ones far away. Returns how many are still missing.
  const update = (cx: number, cz: number) => {
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
        if (chunks.has(key) || pending.has(key)) continue;
        if (local.isEmpty(ci, cj)) {
          chunks.set(key, null);
          continue;
        }
        want.push([ci, cj, Math.hypot((ci + 0.5) * chunkM - cx, (cj + 0.5) * chunkM - cz)]);
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    if (workers.length) {
      for (const [ci, cj] of want) {
        const slot = workers.find((w) => !w.busy);
        if (!slot) break;
        const id = nextId++;
        const key = `${ci},${cj}`;
        slot.busy = true;
        pending.set(key, { id, slot });
        byId.set(id, key);
        slot.worker.postMessage({ ci, cj, id });
      }
    } else if (want.length) {
      // no worker: one chunk per frame in the page
      const [ci, cj] = want[0]!;
      const id = nextId++;
      byId.set(id, `${ci},${cj}`);
      pending.set(`${ci},${cj}`, { id, slot: null });
      const t0 = performance.now();
      const data = local.build(ci, cj);
      finish(id, data, performance.now() - t0);
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
    return want.length + pending.size;
  };
  const stats = () => {
    let quads = 0, meshes = 0;
    for (const mesh of chunks.values()) if (mesh) { meshes++; quads += (mesh.geometry.index?.count ?? 0) / 6; }
    return { chunks: chunks.size, meshes, quads, built, msPerChunk: built ? buildMs / built : 0, chunkMeters: chunkM, workers: workers.length, pending: pending.size };
  };
  return { update, stats };
}
