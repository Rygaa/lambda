// The people who do not fight (assets/character/npc/npcs.json): the FlyFF female in the parts each one wears. A person
// is baked once (lib/bake.js, its idle clip), drawn at the scale of the human (lib/character.js unitScale, so the
// FlyFF sizes stay true), and in the Voxel look made of cubes once, with the cubes of the human (lookOf human).
import { getResource } from '../ecs/world.js';
import { Gpu, Npcs } from '../resources.js';
import { loadBody, bakeClips, measure, fineMeshes } from './bake.js';
import { unitScale } from './character.js';
import { lookOf } from './voxels.js';
import { voxelBody } from './voxelBody.js';

const BASE = '../assets/character/npc/', FPS = 15;

// the bake of the person `id`: { promise, baked: { body, clips, box, k } once done, error }
export function bakeNpc(world, id) {
  const npcs = getResource(world, Npcs);
  if (!npcs.bakes.has(id)) {
    const who = npcs.people[id], bake = { baked: null, error: null, looks: new Map() };
    bake.promise = (async () => {
      const k = (await unitScale(world)).k;
      const body = await loadBody(new Map(), who.parts.map((file) => ({ url: `${BASE}parts/${file}.glb` })), `${BASE}${npcs.body}.glb`, BASE + 'parts/textures/');
      bake.baked = { body, clips: await bakeClips(body, { idle: who.idle }, FPS), box: measure(body, who.idle), k };
    })().catch((err) => { bake.error = err; console.error(`npc ${id}:`, err); });
    npcs.bakes.set(id, bake);
  }
  return npcs.bakes.get(id);
}

// the clips and meshes of a baked person in the look now: { clips, meshes, look }, or null while its cubes are made
export function npcLook(world, bake) {
  const gpu = getResource(world, Gpu), look = lookOf(world), { body, clips, k } = bake.baked;
  if (!look) return { clips, meshes: fineMeshes(gpu, body, clips.idle[0]), look: null };
  let cubes = bake.looks.get(look.human.key);
  if (!cubes) {
    bake.looks.set(look.human.key, (cubes = { body: null }));
    voxelBody(world, body, clips, look.human.size / k, look.normals).then((b) => { cubes.body = b; }, (err) => console.error(err));
  }
  return cubes.body && { clips, meshes: [cubes.body.mesh()], look: look.human.key };
}

export { FPS };
