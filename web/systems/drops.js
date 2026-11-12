// The potions a dead monster drops (a Kill event, systems/combat.js): each potion of assets/items/potions.json falls
// with its chance, near the place of the monster, as its FlyFF model (loaded once, drawn by the fine pass like the
// human), turning and going up and down a little. The human picks it when it walks within PICK: it goes into the bag
// (the Inventory resource) and a text says so. A potion nobody picks is gone after LIFE seconds.
import * as THREE from 'three';
import { query, getComponent, getResource, readEvents, sendEvent, spawn, destroyEntity } from '../ecs/world.js';
import { Drop, Player } from '../components.js';
import { Gpu, Inventory, Time } from '../resources.js';
import { Kill, Damage } from '../events.js';
import { loadPart, fineMesh } from '../lib/bake.js';

const BASE = '../assets/items/models/';
const PICK = 0.7;    // world units
const LIFE = 60;     // seconds
const SHOW = 0.5;    // seconds it lies there before the human can pick it (so it is seen)
const HEIGHT = 0.4;  // world units: its height on the ground (the human is 1.05), so it can be seen from the top
const models = new Map();   // model -> a promise of its parts [{ geometry, texture }]

export function dropSystem(world) {
  const inv = getResource(world, Inventory), gpu = getResource(world, Gpu), dt = getResource(world, Time).dt;
  for (const { x, z, y } of readEvents(world, Kill)) {
    for (const [id, potion] of Object.entries(inv.potions)) {
      if (Math.random() >= potion.chance) continue;
      const a = Math.random() * Math.PI * 2, e = spawn(world, [Drop, { potion: id, x: x + Math.cos(a) * 0.4, z: z + Math.sin(a) * 0.4, y }]);
      partsOf(potion.model).then((parts) => {
        const d = getComponent(world, e, Drop);
        if (!d) return;
        d.group = new THREE.Group();
        for (const { geometry, texture } of parts) d.group.add(fineMesh(gpu, texture, geometry));
        const box = new THREE.Box3();
        for (const { geometry } of parts) { geometry.computeBoundingBox(); box.union(geometry.boundingBox); }
        d.group.scale.setScalar(HEIGHT / Math.max(1e-6, box.max.y - box.min.y));
        d.group.userData.lift = -box.min.y * d.group.scale.y;   // its bottom on the ground
        gpu.scene.add(d.group);
      }, (err) => console.error(`potion ${potion.model}:`, err));
    }
  }

  const human = query(world, [Player])[0], p = human === undefined ? null : getComponent(world, human, Player);
  for (const e of query(world, [Drop])) {
    const d = getComponent(world, e, Drop);
    d.t += dt;
    const picked = p && p.dead <= 0 && d.t > SHOW && Math.hypot(p.x - d.x, p.z - d.z) < PICK;
    if (picked) {
      const it = inv.bag.find((i) => i.potion === d.potion);
      if (it) it.count++; else inv.bag.push({ potion: d.potion, count: 1 });
      inv.version++;
      sendEvent(world, Damage, { x: p.x, y: (p.y ?? 0) + 1.2, z: p.z, text: `+1 ${inv.potions[d.potion].name}`, human: true, kind: d.potion });
    }
    if (picked || d.t > LIFE) {
      if (d.group) { gpu.scene.remove(d.group); for (const mesh of d.group.children) mesh.material.dispose(); }
      gpu.bodiesDirty = true;
      destroyEntity(world, e);
      continue;
    }
    if (!d.group) continue;
    d.group.position.set(d.x, d.y + d.group.userData.lift + 0.05 + 0.05 * Math.sin(d.t * 3), d.z);
    d.group.rotation.y = d.t * 1.5;
    gpu.bodiesDirty = true;
  }
}

// the meshes of a potion model, still, each at its place in the file (lib/bake.js loadPart)
function partsOf(model) {
  if (!models.has(model)) {
    models.set(model, loadPart(BASE + model + '.glb', BASE + 'textures/').then(({ parts }) => parts.map((part) => {
      const geometry = new THREE.BufferGeometry(), src = part.mesh.geometry;
      for (const name of ['position', 'normal', 'uv']) if (src.getAttribute(name)) geometry.setAttribute(name, src.getAttribute(name).clone());
      if (src.index) geometry.setIndex(src.index.clone());
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
      geometry.applyMatrix4(part.local);
      return { geometry, texture: part.texture };
    })));
  }
  return models.get(model);
}
