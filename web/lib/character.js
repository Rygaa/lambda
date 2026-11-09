// The human (assets/character/player, the FlyFF male): ported from the voxel branch
// (game/src/client/character.ts). Its clips (idle, walk, run, the 4 parts of a jump, 4 hits, hurt, dead) are baked at
// load into frames of posed vertices (bakeFps a second, lib/bake.js); systems/player.js swaps the frames and moves it.
// Its parts come from its outfit (the Wardrobe resource, items.json): a head, hair, clothes, a weapon, and a shield; a new
// outfit is baked again (dress, systems/outfit.js). Parts that are not skinned follow one bone: a weapon or a shield its
// attach point (attach_rhand, attach_lhand, attach_knuckle, attach_shield), a cap or a mask the head.
import * as THREE from 'three';
import { getResource, spawn } from '../ecs/world.js';
import { Player, Health, Stats } from '../components.js';
import { Gpu, Settings, Wardrobe } from '../resources.js';
import { loadBody, bakeClips, measure, fineMeshes } from './bake.js';
import { maxHp } from './combat.js';

const BASE = '../assets/character/player/', TEXTURES = BASE + 'parts/textures/';
export const HEIGHT = 1.05;    // world units: a person is about 1 unit tall (gen/collision.js)
const STATES = ['idle', 'walk', 'run', 'jumpStart', 'jumpUp', 'jumpDown', 'jumpLand', 'attack1', 'attack2', 'attack3', 'attack4', 'hit', 'dead'];
const ONCE = (state) => /^(jump|attack|hit|dead)/.test(state);   // these clips play once and stop on their last frame

// the parts of an outfit (slot -> file, null: none or the bare body), as [{ url, bone }] (bone: the attach point of a
// weapon or a shield). A suit replaces the bare upper and lower body, a cap can hide the hair or the head, and a weapon
// held with both hands leaves no room for a shield
export function partsOf(outfit, slots) {
  const find = (slot) => slots[slot].find((c) => c.file === outfit[slot]);
  const cap = find('cap'), weapon = find('weapon'), shield = !weapon?.bothHands && find('shield');
  return [
    cap?.hides !== 'head' && outfit.head, cap?.hides !== 'hair' && outfit.hair,
    ...(outfit.upper ? [outfit.upper] : ['part_maleupper', 'part_malelower']),
    outfit.hand ?? 'part_malehand', outfit.foot ?? 'part_malefoot', outfit.cap, outfit.cloak, outfit.mask,
  ].filter(Boolean).map((file) => ({ url: `${BASE}parts/${file}.glb` })).concat(
    [weapon, shield].filter(Boolean).flatMap(({ file, hold }) => hold.map((h) => ({ url: `${BASE}parts/${file}.glb`, bone: 'attach_' + h }))));
}

// the body of an outfit (lib/bake.js loadBody)
const bodyOf = (cache, config, outfit, slots) => loadBody(cache, partsOf(outfit, slots), BASE + config.animations, TEXTURES);

// the clips and meshes of an outfit (slot -> file): systems/outfit.js puts them on the human
export async function dress(world, outfit) {
  const gpu = getResource(world, Gpu), { config, slots, cache } = getResource(world, Wardrobe);
  const body = await bodyOf(cache, config, outfit, slots);
  const clips = bakeClips(body, Object.fromEntries(STATES.map((s) => [s, config.clips[s]])), config.bakeFps, ONCE);
  return { clips, meshes: fineMeshes(gpu, body, clips.idle[0]) };
}

// world units per FlyFF unit: the human is HEIGHT tall, measured on the body of the default outfit at the start of
// its idle clip (the same size in every outfit: a hat does not make it smaller). Monsters use it too (lib/monsters.js)
export async function unitScale(world) {
  const { config, slots, cache } = getResource(world, Wardrobe);
  const box = measure(await bodyOf(cache, config, config.outfit, slots), config.clips.idle);
  return { k: HEIGHT / (box.max.y - box.min.y), box };
}

// spawns the human at (x, z), or at the start of the world, in the outfit of the Wardrobe resource, with its stats
// (lib/combat.js) and full HP
export async function addCharacter(world, at, stats) {
  const gpu = getResource(world, Gpu), settings = getResource(world, Settings);
  // the fine pass (systems/render.js): its camera and the uniforms all its materials share
  gpu.fine = {
    camera: new THREE.OrthographicCamera(),
    uniforms: { tNorm: { value: null }, uLowSize: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() },
      uOffset: gpu.blit.uniforms.uOffset, uScale: gpu.blit.uniforms.uScale, uMargin: gpu.blit.uniforms.uMargin },
  };
  gpu.fine.camera.layers.set(2);
  const { config, outfit } = getResource(world, Wardrobe);
  const { clips, meshes } = await dress(world, outfit);
  const group = new THREE.Group();
  for (const mesh of meshes) group.add(mesh);
  // feet on the ground, HEIGHT tall
  const { k, box } = await unitScale(world);
  group.scale.setScalar(k);
  gpu.scene.add(group);
  gpu.shadowsDirty = true;
  const [x, z] = at ?? [settings.land.start[0], settings.land.start[settings.land.start.length - 1]];
  return spawn(world, [Player, { group, meshes, clips, fps: config.bakeFps, foot: -box.min.y * k, x, z, rot: 0, state: 'idle', t: 0 }],
    [Stats, { ...stats }], [Health, { hp: maxHp(stats), max: maxHp(stats) }]);
}
