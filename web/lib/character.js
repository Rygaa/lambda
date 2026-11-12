// The human (assets/character/player, the FlyFF male): ported from the voxel branch
// (game/src/client/character.ts). Its clips (the clips of character.json: idle, walk, run, the 4 parts of a jump, 4
// sword hits, 2 punches, hurt, dead, the skill clips; and each hit or punch while it walks or runs: attack1Walk,
// attack1Run, punch1Walk..., its legs from walk or run, and the end of each when no hit follows: attack1End,
// attack1EndWalk, attack1EndRun...) are baked at
// load into frames of posed vertices (bakeFps a second, lib/bake.js); systems/player.js swaps the frames and moves it.
// Its parts come from its outfit (the Wardrobe resource, items.json): a head, hair, clothes, a weapon, and a shield; a new
// outfit is baked again (dress, systems/outfit.js). Parts that are not skinned follow one bone: a weapon or a shield its
// attach point (attach_rhand, attach_lhand, attach_knuckle, attach_shield), a cap or a mask the head.
import * as THREE from 'three';
import { getResource, spawn } from '../ecs/world.js';
import { Player, Health, Stats, Mana, Skills } from '../components.js';
import { Gpu, Settings, Wardrobe, Voxels } from '../resources.js';
import { loadBody, bakeClips, measure, fineMeshes, fineMesh, loader } from './bake.js';
import { retarget } from './retarget.js';
import { lookOf, voxelClips } from './voxels.js';
import { voxelBody, BODIES } from './voxelBody.js';
import { maxHp, maxMp } from './combat.js';

const BASE = '../assets/character/player/', TEXTURES = BASE + 'parts/textures/';
export const HEIGHT = 1.05;    // world units: a person is about 1 unit tall (gen/collision.js)
const BLEND = 0.25;   // seconds: the end of a hit melts into idle, walk or run (ending)
export const ONCE = (state) => !/^(idle|walk|run)$/.test(state);   // these clips play once and stop on their last frame
const HITS = (state) => /^(attack|punch)\d$/.test(state);         // these get a version while it walks or runs, and an end

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
async function bodyOf(cache, config, outfit, slots) {
  const body = await loadBody(cache, partsOf(outfit, slots), BASE + config.animations, TEXTURES);
  return config.borrowed ? { ...body, clips: [...body.clips, ...await borrowed(cache, config)] } : body;
}

// the clips of other skeletons that the human uses (config.borrowed: [{ file, rig }], lib/retarget.js), moved onto
// ours once
function borrowed(cache, config) {
  if (!cache.has('borrowed')) {
    cache.set('borrowed', (async () => {
      const ours = (await loader(TEXTURES).loadAsync(BASE + config.animations)).scene, used = [...Object.values(config.clips), ...Object.values(config.recover ?? {})];
      const files = await Promise.all(config.borrowed.map(({ file }) => loader(TEXTURES).loadAsync(BASE + file)));
      return files.flatMap((gltf, i) => retarget(gltf, config.borrowed[i].rig, ours, used));
    })());
  }
  return cache.get('borrowed');
}

// the clips and meshes of an outfit (slot -> file), in the look now: systems/outfit.js puts them on the human.
// Made of cubes (lib/voxels.js), each frame is one mesh, with the colours of the voxel palette; the cubes are on the
// grid of the human, so they turn and move with it
export async function dress(world, outfit) {
  const gpu = getResource(world, Gpu), { config, slots, cache } = getResource(world, Wardrobe), look = lookOf(world);
  const body = await bodyOf(cache, config, outfit, slots);
  const names = { ...config.clips }, hits = Object.keys(config.clips).filter(HITS);
  for (const s of hits) {
    names[s + 'Walk'] = { clip: config.clips[s], legs: config.clips.walk };
    names[s + 'Run'] = { clip: config.clips[s], legs: config.clips.run };
  }
  for (const s of hits) {
    names[s + 'End'] = { frames: ending(config, s, null) };
    names[s + 'EndWalk'] = { frames: ending(config, s, config.clips.walk) };
    names[s + 'EndRun'] = { frames: ending(config, s, config.clips.run) };
  }
  const clips = bakeClips(body, names, config.bakeFps, ONCE);
  if (!look) return { clips, meshes: fineMeshes(gpu, body, clips.idle[0]), look: null };
  if (BODIES !== 'frames') {
    const t = performance.now(), cubes = voxelBody(world, body, clips, look.size / (await unitScale(world)).k, look.normals, BODIES === 'snap');
    console.log(`[bench] human: ${cubes.count} cubes in ${Math.round(performance.now() - t)} ms`);
    return { clips, meshes: [cubes.mesh()], look: look.key };
  }
  const cubes = await voxelClips(world, body, clips, look.size / (await unitScale(world)).k, look.normals);
  for (const frames of Object.values(clips)) for (const frame of frames) for (const g of frame) g.dispose();
  return { clips: cubes, meshes: [fineMesh(gpu, getResource(world, Voxels).palette.texture, cubes.idle[0][0])], look: look.key };
}

// the end of the hit `state` when no hit follows it: its way back (config.recover: a clip, if it has one), then its
// last pose melts in BLEND seconds into the start of idle (legs null), or of walk or run (legs: the clip of the legs,
// which walk all along)
function ending(config, state, legs) {
  return (find, fps) => {
    const back = config.recover?.[state] && find(config.recover[state]), last = back ?? find(config.clips[state]);
    const to = find(legs ?? config.clips.idle), nBack = back ? Math.round(back.duration * fps) : 0, nBlend = Math.round(BLEND * fps);
    return Array.from({ length: nBack + nBlend + 1 }, (_, k) => {
      const w = Math.max(0, (k - nBack) / nBlend), from = { clip: last, time: back ? Math.min(k / fps, last.duration) : last.duration, weight: 1 - w };
      return legs ? [{ ...from, only: 'top' }, { clip: to, time: k / fps, weight: w, only: 'top', loop: true }, { clip: to, time: k / fps, only: 'legs', loop: true }]
        : [from, { clip: to, time: 0, weight: w }];
    });
  };
}

// world units per FlyFF unit: the human is HEIGHT tall, measured on the body of the default outfit at the start of
// its idle clip (the same size in every outfit: a hat does not make it smaller). Monsters use it too (lib/monsters.js)
export async function unitScale(world) {
  const { config, slots, cache } = getResource(world, Wardrobe);
  const box = measure(await bodyOf(cache, config, config.outfit, slots), config.clips.idle);
  return { k: HEIGHT / (box.max.y - box.min.y), box };
}

// spawns the human at (x, z), or at the start of the world, in the outfit of the Wardrobe resource, with its stats
// (lib/combat.js), full HP and MP, and the levels of its skills (skill id -> level, 0: not learned)
export async function addCharacter(world, at, stats, levels = {}) {
  const gpu = getResource(world, Gpu), settings = getResource(world, Settings);
  // the fine pass (systems/render.js): its camera and the uniforms all its materials share
  gpu.fine = {
    camera: new THREE.OrthographicCamera(),
    uniforms: { tNorm: { value: null }, uLowSize: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() },
      uOffset: gpu.blit.uniforms.uOffset, uScale: gpu.blit.uniforms.uScale, uMargin: gpu.blit.uniforms.uMargin },
  };
  gpu.fine.camera.layers.set(2);
  const wardrobe = getResource(world, Wardrobe), { config, outfit } = wardrobe;
  wardrobe.look = lookOf(world)?.key ?? null;
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
    [Stats, { ...stats }], [Health, { hp: maxHp(stats), max: maxHp(stats) }], [Mana, { mp: maxMp(stats), max: maxMp(stats) }],
    [Skills, { levels: { ...levels } }]);
}
