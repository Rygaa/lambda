// Components: plain data only. Systems in systems/ give them meaning.
import { defineComponent } from './ecs/world.js';

// the human (lib/character.js, systems/player.js): its Three.js group and meshes, its baked clips
// (state -> frames -> one geometry per part), where it stands and faces, its clip and time in it;
// y: the height of its feet (null: on the ground under it); jump: the time left of its crouch, in the air or not,
// its speed up, the time left of its landing; attack: its hit (1 to 4, 0: none), the time left of it, whether
// the next hit follows, and whether this hit has struck (systems/player.js); hurt: the time left of its hurt clip;
// dead: the time left before it stands up again (0: alive)
export const Player = defineComponent('Player', () => ({
  group: null, meshes: [], clips: {}, fps: 15, foot: 0, x: 0, z: 0, y: null, rot: 0, state: 'idle', t: 0,
  jump: { crouch: 0, air: false, vy: 0, land: 0 },
  attack: { hit: 0, end: 0, left: 0, queued: false, struck: false, kind: 'attack' },
  hurt: 0, dead: 0,
}));

// the stats of the human (lib/combat.js): its level, its experience in this level, STR, STA, points not spent yet,
// skill points not spent yet (systems/skills.js)
export const Stats = defineComponent('Stats', () => ({ level: 1, xp: 0, str: 15, sta: 15, points: 0, skillPoints: 0 }));

// the MP of the human: the skills cost it (systems/skills.js), it comes back slowly and with MP potions
export const Mana = defineComponent('Mana', () => ({ mp: 1, max: 1 }));

// the skills of the human (lib/skills.js, systems/skills.js): skill id -> its level (0: not open yet) and the
// seconds before it can start again; active: the step of a skill playing now (null: none); combo: the next step of a
// combo and the seconds left to press its key ({ id, step, left }, null: none); aim: the monster under the mouse
export const Skills = defineComponent('Skills', () => ({ levels: {}, cooldowns: {}, active: null, combo: null, aim: null }));

// a ki blast of a skill (systems/blasts.js, skills.json step `blast`): its spec, its power (times the damage), its
// time (seconds of the clip of the skill, faster by rate); phase: charge (a ball grows in the hands), fly (a ball goes
// forward), beam (a beam goes forward and stays), fade (it shrinks and is gone); x, y, z: where it leaves from and
// dx, dz its way (set when it is fired); head: how far it has gone; dug: how far its trench is dug; fade: the seconds
// left of its end; hit: the monsters it has hit
export const Blast = defineComponent('Blast', () => ({
  spec: null, power: 1, rate: 1, t: 0, phase: 'charge', x: 0, y: 0, z: 0, dx: 0, dz: 1, head: 0, dug: 0, fade: 0, hit: [],
}));

// a potion on the ground (systems/drops.js): which one, where, its meshes, and the seconds it has been there
// a person who does not fight (assets/character/npc/npcs.json, systems/npcs.js): who it is, its body (made like a monster:
// lib/npc.js), where it stands and faces; near: the human is close enough to talk
export const Npc = defineComponent('Npc', () => ({ id: '', name: '', group: null, meshes: [], clips: {}, look: null, fps: 15, foot: 0, height: 1, x: 0, z: 0, rot: 0, home: 0, t: 0, near: false, el: null }));

export const Drop = defineComponent('Drop', () => ({ potion: 'hp', x: 0, z: 0, y: 0, group: null, t: 0 }));

// the HP of the human or of a monster
export const Health = defineComponent('Health', () => ({ hp: 1, max: 1 }));

// a monster (lib/monsters.js, systems/monsters.js): its type (a line of assets/monsters/monsters.json), its Three.js
// group and meshes, its baked clips, its feet, height and circle, where it stands and faces, its clip and time in
// it, its spawn point (home).
//   mode: calm (stands, looks around, walks near home), angry (follows the human and attacks), or dead;
//   goal: where a calm walk goes; wait: the time before the next calm walk or look; swing: the time in its attack
//   (null: none); struck: the blow of this swing is dealt; cooldown: the time before the next swing; hurt: the time
//   left of its hit clip; shown: the time left of its HP bar (systems/hud.js); fade: 1 seen, 0 gone (uFade);
//   look: the look its meshes and clips are in (lib/voxels.js lookOf key, null: as it is); stun: the time left it
//   cannot move or hit (systems/skills.js Shield Bash); spot: the place of the world recipe it comes back to after
//   its death ({ type, x, z }, null: spawned by the admin menu)
export const Monster = defineComponent('Monster', () => ({
  type: null, group: null, meshes: [], clips: {}, look: null, fps: 15, foot: 0, height: 1, radius: 0.3, x: 0, z: 0, y: 0, rot: 0,
  state: 'idle', t: 0, home: [0, 0], mode: 'calm', goal: null, wait: 2, swing: null, struck: false, cooldown: 0,
  hurt: 0, shown: 0, fade: 1, stun: 0, spot: null,
}));

// a FlyFF decor object (assets/objects, systems/objects.js): its name in objects.json, where it stands and its turn;
// group: its meshes (fine pass, with their textures), once its model is loaded; cubes: { key, mesh } its last look
// made of cubes (lib/voxels.js lookOf key); busy: cubes are being made; box: its box in the world; placed: put by the
// admin menu (systems/adminObjects.js), not by the world recipe
// y, k: its height and its world units per FlyFF unit, when they are given (a FlyFF map, gen/map.js), else on the
// ground at our sizes (systems/objects.js objectScale)
export const Decor = defineComponent('Decor', () => ({ object: '', x: 0, z: 0, rot: 0, y: null, k: 0, group: null, cubes: null, busy: false, box: null, placed: false }));

// position on the ground and turn around the up axis
export const Transform = defineComponent('Transform', () => ({ x: 0, z: 0, rotY: 0 }));

// a generated object (gen/): variant `variant` of the shape set `set`;
// name: family/type/size/palette/variant (documentation/assets.md);
// palette: colour family -> palette row (gen/palettes.js)
export const Prop = defineComponent('Prop', () => ({ name: '', set: '', variant: 0, palette: {} }));
// grass and flowers do not grow inside this circle
export const Footprint = defineComponent('Footprint', () => ({ x: 0, z: 0, r: 0 }));
// nothing walks through this standing cylinder (radius r, height h); only on
// things that are tall enough (gen/collision.js)
export const Blocker = defineComponent('Blocker', () => ({ x: 0, z: 0, r: 0, h: 1 }));
export const ShadowCaster = defineComponent('ShadowCaster');

// Three.js handles, filled in by the mesh system
//   meshes: [{ mesh, role }] with role = stone | trunk | canopy | leaves | water
export const SceneObject = defineComponent('SceneObject', () => ({ group: null, meshes: [] }));

// the big ground plane
export const GroundPlane = defineComponent('GroundPlane');

// one instance layer of grass tufts or flowers
//   home: draw positions, light: where each instance samples light,
//   params: [atlas cell, material id, 0, 0], grid: cell key -> instance indices,
//   chunk: the name of its square in a big world (systems/coverChunks.js), or null
export const GroundCover = defineComponent('GroundCover', () => ({
  kind: 'grass', home: null, pos: null, light: null, params: null, grid: null, chunk: null,
}));

// floating dust motes, shown only inside light beams
export const DustField = defineComponent('DustField', () => ({ positions: null, boxMin: [0, 0, 0], boxSize: [1, 1, 1] }));

// the top-view camera: where it looks, and its idle walk
//   snap: the pixel-snap error the blit pass shifts by; follow: false once the
//   arrows (or a script) move it, so it stops its idle walk
export const CameraRig = defineComponent('CameraRig', () => ({
  target: [0, 0, 0], driftPhase: 0.6, lastInput: -1e9, snap: [0, 0], follow: true,
}));
export const OrthoView = defineComponent('OrthoView', () => ({ camera: null }));

// canopy / cloud shadows that drift with the wind
export const CloudLayer = defineComponent('CloudLayer', () => ({
  offset: [0, 0], wind: [0.16, 0.05], scale: 0.23, lo: -0.05, hi: 0.02, moving: true,
}));
// a clearing where light falls through the canopy
export const Glade = defineComponent('Glade', () => ({ x: 0, z: 0, r: 1, k: 0 }));
