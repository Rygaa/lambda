// The Kikoha beam: a bright bar that shoots out from the player and is gone a moment later. It uses the game's voxel
// material, so it has the same pixels, outlines and light as the rest.
import * as THREE from "three";
import type { PixelRenderer } from "../engine/renderer/index.ts";
import type { Voxels } from "./voxels.ts";

const SPEED = 45;
const WIDTH = 0.3;
// how long the tail waits (seconds)
const TAIL_DELAY = 0.18;
// the height it leaves from, and the height it ends at when it touches no rock
const START_Y = 0.9;
const END_Y = 0.5;

type Beam = {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  length: number;
  time: number;
  onArrive: (() => void) | null;
};

export function createKikohaBeams(renderer: PixelRenderer, voxels: Voxels) {
  const geometry = new THREE.BoxGeometry(WIDTH, WIDTH, 1);
  const color = voxels.palette.addColor("#ffe45c");
  voxels.palette.flush();
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, voxels.palette.u(color), voxels.palette.v(color));

  const beams = new Set<Beam>();
  const head = new THREE.Vector3();
  const tail = new THREE.Vector3();

  // endY: the height at the far end (a tunnel), or null. onArrive: called when the front of the beam gets there.
  const fire = (x: number, z: number, dx: number, dz: number, length: number, endY: number | null, onArrive: () => void) => {
    const mesh = new THREE.Mesh(geometry, voxels.material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    renderer.scene.add(mesh);
    const from = new THREE.Vector3(x, START_Y, z);
    const to = new THREE.Vector3(x + dx * length, endY ?? END_Y, z + dz * length);
    beams.add({ mesh, from, to, length, time: 0, onArrive });
  };

  const update = (dt: number) => {
    for (const beam of beams) {
      beam.time += dt;
      const front = (beam.time * SPEED) / beam.length;
      const back = ((beam.time - TAIL_DELAY) * SPEED) / beam.length;
      if (front >= 1 && beam.onArrive) {
        beam.onArrive();
        beam.onArrive = null;
      }
      if (back >= 1) {
        renderer.scene.remove(beam.mesh);
        beams.delete(beam);
        continue;
      }
      head.lerpVectors(beam.from, beam.to, Math.min(1, front));
      tail.lerpVectors(beam.from, beam.to, Math.max(0, back));
      beam.mesh.visible = true;
      beam.mesh.position.lerpVectors(tail, head, 0.5);
      beam.mesh.scale.z = Math.max(0.01, head.distanceTo(tail));
      beam.mesh.lookAt(head);
    }
  };
  return { fire, update };
}
