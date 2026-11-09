// Components: plain data only. Systems in systems/ give them meaning.
import { defineComponent } from './ecs/world.js';

// the human (lib/character.js, systems/player.js): its Three.js group and meshes, its baked clips
// (state -> frames -> one geometry per part), where it stands and faces, its clip and time in it;
// y: the height of its feet (null: on the ground under it); jump: the time left of its crouch, in the air or not,
// its speed up, the time left of its landing; attack: its hit (1 to 4, 0: none), the time left of it, and whether
// the next hit follows (systems/player.js)
export const Player = defineComponent('Player', () => ({
  group: null, meshes: [], clips: {}, fps: 15, foot: 0, x: 0, z: 0, y: null, rot: 0, state: 'idle', t: 0,
  jump: { crouch: 0, air: false, vy: 0, land: 0 },
  attack: { hit: 0, left: 0, queued: false },
}));

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
//   params: [atlas cell, material id, 0, 0], grid: cell key -> instance indices
export const GroundCover = defineComponent('GroundCover', () => ({
  kind: 'grass', home: null, pos: null, light: null, params: null, grid: null,
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
