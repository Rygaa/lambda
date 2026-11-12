// The monsters (assets/monsters, the FlyFF monsters, import-monsters.mjs): a model is baked once, the first time a
// monster of it spawns (lib/bake.js, FPS frames a second), and every monster of that model shares its frames.
// The FlyFF sizes stay true to each other: a model is drawn with the scale of the human (lib/character.js
// unitScale), times the size of its type (small 0.8, giant 2...). systems/monsters.js moves them.
// Made of cubes (the Look resource, lib/voxels.js), a model gets its frames of cubes once for each look and scale, so
// the cubes of a giant are as big as the cubes of a small one.
import * as THREE from 'three';
import { getResource, spawn } from '../ecs/world.js';
import { Monster, Health } from '../components.js';
import { Gpu, Bestiary, Voxels } from '../resources.js';
import { loadBody, bakeClips, measure, fineMeshes, fineMesh } from './bake.js';
import { unitScale } from './character.js';
import { lookOf, voxelClips } from './voxels.js';
import { voxelBody, BODIES } from './voxelBody.js';

export const BASE = '../assets/monsters/models/';
const FPS = 15;
const ONCE = (state) => state !== 'idle' && state !== 'walk';   // these clips play once and stop on their last frame

// the bake of a model: { promise, baked: { body, clips, box } once done, error }
export function bakeModel(world, model) {
  const b = getResource(world, Bestiary);
  if (!b.bakes.has(model)) {
    const bake = { baked: null, error: null };
    bake.promise = (async () => {
      b.unit ||= (await unitScale(world)).k;
      const url = BASE + model + '.glb', { clips: names } = b.models[model];
      const body = await loadBody(new Map(), [{ url }], url, BASE + 'textures/');
      bake.baked = { body, clips: await bakeClips(body, names, FPS, ONCE), box: measure(body, names.idle), looks: new Map() };
    })().catch((err) => { bake.error = err; console.error(`monster ${model}:`, err); });
    b.bakes.set(model, bake);
  }
  return b.bakes.get(model);
}

// the clips and meshes of a monster of `type` in the look now, from the bake of its model: { clips, meshes, look }, or
// null while its frames of cubes are being made
export function monsterLook(world, type, baked) {
  const gpu = getResource(world, Gpu), look = lookOf(world);
  if (!look) return { clips: baked.clips, meshes: fineMeshes(gpu, baked.body, baked.clips.idle[0]), look: null };
  const k = getResource(world, Bestiary).unit * type.size, key = `${look.key}@${k}`;
  let cubes = baked.looks.get(key);
  if (BODIES !== 'frames') {
    if (!cubes) {
      baked.looks.set(key, (cubes = { body: null }));
      voxelBody(world, baked.body, baked.clips, look.size / k, look.normals, BODIES === 'snap').then((body) => { cubes.body = body; }, (err) => console.error(err));
    }
    if (!cubes.body) return null;
    return { clips: baked.clips, meshes: [cubes.body.mesh()], look: look.key };
  }
  if (!cubes) {
    baked.looks.set(key, (cubes = { clips: null }));
    voxelClips(world, baked.body, baked.clips, look.size / k, look.normals).then((clips) => { cubes.clips = clips; }, (err) => console.error(err));
  }
  if (!cubes.clips) return null;
  return { clips: cubes.clips, meshes: [fineMesh(gpu, getResource(world, Voxels).palette.texture, cubes.clips.idle[0][0])], look: look.key };
}

// a monster of `type` at (x, z), from the bake of its model, in a look (monsterLook); rot: where it faces
export function spawnMonster(world, type, baked, drawn, x, z, rot = Math.random() * Math.PI * 2) {
  const gpu = getResource(world, Gpu), b = getResource(world, Bestiary);
  const k = b.unit * type.size, { box } = baked, { meshes, clips, look } = drawn;
  const group = new THREE.Group();
  for (const mesh of meshes) group.add(mesh);
  group.scale.setScalar(k);
  gpu.scene.add(group);
  gpu.shadowsDirty = true;
  // its feet: the origin of the model (a flying monster stays up), lifted if a part goes below it; its height (the
  // HP bar, systems/hud.js); its circle on the ground: half its width, kept between a small and a big monster
  const radius = THREE.MathUtils.clamp(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 * k, 0.15, 1.5);
  return spawn(world,
    [Monster, { type, group, meshes, clips, look, fps: FPS, foot: Math.max(0, -box.min.y * k), height: box.max.y * k, radius,
      x, z, rot, home: [x, z], wait: 1 + Math.random() * 3 }],
    [Health, { hp: type.hp, max: type.hp }]);
}
