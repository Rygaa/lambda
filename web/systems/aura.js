// The aura of the transformation (the Form component, systems/transform.js): small gold cubes rise around the human
// like a flame, more of them when the aura is strong (Form aura: 0 none, 1 transformed, 1.5 the burst); at the burst
// a ring of cubes flies out along the ground. They are drawn by the fine pass, like the human (render/shaders.js
// AURA_VERT, AURA_FRAG), and shrink as they fade.
import * as THREE from 'three';
import { query, getComponent, getResource } from '../ecs/world.js';
import { Player, Form } from '../components.js';
import { Gpu, Time } from '../resources.js';
import * as S from '../render/shaders.js';
import { shaderMaterial } from '../render/materials.js';

const COUNT = 400;     // cubes at most
const RATE = 220;      // cubes a second at aura 1
const RING = 70;       // cubes of the ring of the burst
const FIRE = [[1, 0.82, 0.22], [1, 0.93, 0.45], [1, 0.98, 0.78]];   // gold to white

let aura = null;       // { mesh, col, live: [{ x, y, z, vx, vy, vz, age, life, size, c }], level, phase, owed }

export function auraSystem(world) {
  const e = query(world, [Player, Form])[0], gpu = getResource(world, Gpu);
  if (e === undefined || !gpu.fine) return;
  const p = getComponent(world, e, Player), f = getComponent(world, e, Form), dt = getResource(world, Time).dt;
  aura ??= create(gpu);
  aura.level += (f.aura - aura.level) * Math.min(1, dt * 5);
  const y0 = p.y ?? 0;
  if (f.phase === 'burst' && aura.phase !== 'burst') {
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * Math.PI * 2, v = 3 + Math.random() * 1.5;
      add({ x: p.x + Math.sin(a) * 0.3, y: y0 + 0.05, z: p.z + Math.cos(a) * 0.3, vx: Math.sin(a) * v, vy: 0.3, vz: Math.cos(a) * v, life: 0.45, size: 0.06, c: 2 });
    }
  }
  aura.phase = f.phase;
  // the flame: cubes born around the feet and the body, going up and in
  aura.owed += aura.level * RATE * dt;
  for (; aura.owed >= 1; aura.owed--) {
    const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.16, y = Math.random() * 0.6;
    add({ x: p.x + Math.sin(a) * r, y: y0 + y, z: p.z + Math.cos(a) * r, vx: -Math.sin(a) * r * 0.6, vy: 1.3 + Math.random() * 1.5,
      vz: -Math.cos(a) * r * 0.6, life: 0.35 + Math.random() * 0.35, size: 0.025 + Math.random() * 0.03, c: Math.floor(Math.random() * 2) });
  }
  const M = aura.mesh.instanceMatrix.array, col = aura.col.array;
  aura.live = aura.live.filter((q) => (q.age += dt) < q.life);
  M.fill(0);
  aura.live.forEach((q, i) => {
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    const k = q.age / q.life, s = q.size * (1 - k);
    M[i * 16] = M[i * 16 + 5] = M[i * 16 + 10] = s; M[i * 16 + 15] = 1;
    M[i * 16 + 12] = q.x; M[i * 16 + 13] = q.y; M[i * 16 + 14] = q.z;
    col.set([...FIRE[k < 0.3 ? 2 : q.c], 1], i * 4);
  });
  aura.mesh.count = aura.live.length;
  aura.mesh.instanceMatrix.needsUpdate = true;
  aura.col.needsUpdate = true;
}

function add(q) {
  if (aura.live.length < COUNT) aura.live.push({ ...q, age: 0 });
}

function create(gpu) {
  const geometry = new THREE.BoxGeometry(1, 1, 1), col = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 4), 4);
  col.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iCol', col);
  const mesh = new THREE.InstancedMesh(geometry, shaderMaterial(gpu.shared, S.AURA_VERT, S.AURA_FRAG, { ...gpu.fine.uniforms }), COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.layers.set(2);   // the fine pass
  gpu.scene.add(mesh);
  return { mesh, col, live: [], level: 0, phase: null, owed: 0 };
}
