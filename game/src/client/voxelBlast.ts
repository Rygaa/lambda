// A rock or stone that blows up: its pieces fly out, fall, bounce and shrink away. All the cubes of one blast are
// one mesh with the game's voxel material, so they get the same light, outlines and shadows as the rest. The cubes
// keep their size and stay on the axes: only their place changes, each frame.
import * as THREE from "three";
import type { PixelRenderer } from "../engine/renderer/index.ts";
import type { VoxelList } from "./terrainChunk.ts";
import type { Voxels } from "./voxels.ts";

const GRAVITY = 18;
const MIN_SPEED = 2;
const MAX_SPEED = 6;
const MIN_LIFE = 1.2;
const MAX_LIFE = 2.2;
// the last seconds of a piece, when it shrinks to nothing
const SHRINK = 0.4;
const BOUNCE = 0.35;
const FRICTION = 0.6;

// The 6 faces of a cube of side 1 around the origin: a normal and 4 corners, counter-clockwise from outside.
const FACES: [number[], number[][]][] = [
  [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
];
const CORNERS = FACES.flatMap(([, corners]) => corners.flatMap((c) => c.map((v) => v - 0.5)));
const NORMALS = FACES.flatMap(([normal]) => [normal, normal, normal, normal].flat());
const VERTICES = CORNERS.length / 3;

type Blast = {
  mesh: THREE.Mesh;
  positions: THREE.BufferAttribute;
  size: number;
  count: number;
  place: Float32Array;
  speed: Float32Array;
  life: Float32Array;
};

export function createVoxelBlast(renderer: PixelRenderer, voxels: Voxels) {
  const blasts = new Set<Blast>();

  const start = (list: VoxelList, x: number, z: number) => {
    const count = list.rgb.length;
    if (!count) return;
    const palette = voxels.palette;
    const place = list.centers.slice();
    const speed = new Float32Array(count * 3);
    const life = new Float32Array(count);
    const uv = new Float32Array(count * VERTICES * 2);
    const normal = new Float32Array(count * VERTICES * 3);
    const index = new Uint32Array(count * 36);
    for (let i = 0; i < count; i++) {
      // out from the middle and up, each piece at its own speed
      const dx = place[i * 3]! - x + (Math.random() - 0.5) * 0.1;
      const dz = place[i * 3 + 2]! - z + (Math.random() - 0.5) * 0.1;
      const len = Math.hypot(dx, dz) || 1;
      const v = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
      speed[i * 3] = (dx / len) * v;
      speed[i * 3 + 1] = 2 + Math.random() * 5;
      speed[i * 3 + 2] = (dz / len) * v;
      life[i] = MIN_LIFE + Math.random() * (MAX_LIFE - MIN_LIFE);
      const color = palette.add(list.rgb[i]!);
      const u = palette.u(color), w = palette.v(color);
      for (let k = 0; k < VERTICES; k++) {
        uv[(i * VERTICES + k) * 2] = u;
        uv[(i * VERTICES + k) * 2 + 1] = w;
      }
      normal.set(NORMALS, i * VERTICES * 3);
      for (let f = 0; f < 6; f++) {
        const a = i * VERTICES + f * 4;
        index.set([a, a + 1, a + 2, a, a + 2, a + 3], i * 36 + f * 6);
      }
    }
    palette.flush();
    const positions = new THREE.BufferAttribute(new Float32Array(count * VERTICES * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", positions);
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(geometry, voxels.material);
    // the cubes move all the time: no bounding sphere to keep
    mesh.frustumCulled = false;
    renderer.castShadows(mesh);
    renderer.scene.add(mesh);
    blasts.add({ mesh, positions, size: list.size, count, place, speed, life });
  };

  const step = (b: Blast, dt: number) => {
    const out = b.positions.array as Float32Array;
    let alive = false;
    for (let i = 0; i < b.count; i++) {
      const left = (b.life[i] = b.life[i]! - dt);
      if (left > 0) {
        alive = true;
        const p = i * 3;
        b.speed[p + 1] = b.speed[p + 1]! - GRAVITY * dt;
        b.place[p] = b.place[p]! + b.speed[p]! * dt;
        b.place[p + 1] = b.place[p + 1]! + b.speed[p + 1]! * dt;
        b.place[p + 2] = b.place[p + 2]! + b.speed[p + 2]! * dt;
        if (b.place[p + 1]! < b.size / 2) {
          b.place[p + 1] = b.size / 2;
          b.speed[p] = b.speed[p]! * FRICTION;
          b.speed[p + 1] = -b.speed[p + 1]! * BOUNCE;
          b.speed[p + 2] = b.speed[p + 2]! * FRICTION;
        }
      }
      // a finished piece is a point: nothing to draw
      const k = left > 0 ? b.size * Math.min(1, left / SHRINK) : 0;
      const x = b.place[i * 3]!, y = b.place[i * 3 + 1]!, z = b.place[i * 3 + 2]!;
      for (let c = 0, o = i * VERTICES * 3; c < VERTICES * 3; c += 3, o += 3) {
        out[o] = x + CORNERS[c]! * k;
        out[o + 1] = y + CORNERS[c + 1]! * k;
        out[o + 2] = z + CORNERS[c + 2]! * k;
      }
    }
    b.positions.needsUpdate = true;
    return alive;
  };

  const update = (dt: number) => {
    for (const b of blasts) {
      if (step(b, dt)) continue;
      renderer.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      blasts.delete(b);
    }
  };
  return { start, update };
}
